// commands.rs — Tauri IPC commands exposed to the frontend
//
// Design rationale:
//   All filesystem I/O is performed here in Rust rather than via the
//   tauri-plugin-fs JS bindings. This avoids the need to configure FS
//   capability scopes for every possible user file-system path, while
//   still keeping file access auditable and sandboxed within named
//   commands.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

// ── Data types ───────────────────────────────────────────────────────────────

/// A Guitar Pro file entry discovered during a library scan.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibraryEntry {
    /// Absolute path to the file.
    pub path: String,
    /// Display name (filename without extension).
    pub name: String,
    /// File extension, lowercase (gp, gp3, gp4, gp5, gpx).
    pub ext: String,
    /// File size in bytes.
    pub size: u64,
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Read the raw bytes of a Guitar Pro file.
///
/// The frontend receives a JSON array of u8 values which it reconstructs
/// into a `Uint8Array` before passing to `alphaTab.AlphaTabApi.load()`.
#[tauri::command]
pub async fn read_gp_file(path: String) -> Result<Vec<u8>, String> {
    ensure_gp_path(Path::new(&path))?;
    fs::read(&path).map_err(|e| format!("Failed to read '{}': {}", path, e))
}

/// Return the application data directory path for this process.
///
/// Used by the frontend to resolve cached metadata paths if needed.
#[tauri::command]
pub async fn get_app_data_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("Could not resolve app data dir: {}", e))
}

/// Recursively scan `dir` for Guitar Pro files and return metadata entries.
///
/// Supported extensions: gp, gp3, gp4, gp5, gpx (case-insensitive).
#[tauri::command]
pub async fn scan_directory_for_gp(dir: String) -> Result<Vec<LibraryEntry>, String> {
    let root = Path::new(&dir);
    if !root.exists() {
        return Err(format!("Directory '{}' does not exist.", dir));
    }
    if !root.is_dir() {
        return Err(format!("'{}' is not a directory.", dir));
    }

    let mut entries: Vec<LibraryEntry> = Vec::new();
    scan_recursive(root, &mut entries, 0).map_err(|e| e.to_string())?;
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Build a single `LibraryEntry` for an individual file path.
///
/// Used when the user opens a single file via the native dialog rather than
/// scanning a whole folder.
#[tauri::command]
pub async fn file_metadata(path: String) -> Result<LibraryEntry, String> {
    let p = Path::new(&path);
    build_entry(p).map_err(|e| e.to_string())
}

/// Write bytes to a local Guitar Pro file path.
/// Creates parent directories if they don't exist.
#[tauri::command]
pub async fn save_gp_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let p = Path::new(&path);
    ensure_gp_path(p)?;
    if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
        validate_file_stem(stem)?;
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory '{}': {}", parent.display(), e))?;
    }
    fs::write(&path, bytes).map_err(|e| format!("Failed to save tab file to '{}': {}", path, e))
}

/// Save `bytes` into `dest_dir` under `filename` without clobbering existing
/// files: a name whose content is already identical is reused (re-download of
/// the same tab), other collisions fall back to a "name (1).ext" suffix.
/// Returns the entry for the file written or reused.
#[tauri::command]
pub async fn save_gp_file_to_dir(
    dest_dir: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<LibraryEntry, String> {
    if filename.contains('/') || filename.contains('\\') {
        return Err("File name cannot contain path separators.".to_string());
    }
    let file = Path::new(&filename);
    ensure_gp_path(file)?;
    if let Some(stem) = file.file_stem().and_then(|s| s.to_str()) {
        validate_file_stem(stem)?;
    }
    let dest = write_unique(Path::new(&dest_dir), &filename, &bytes)?;
    build_entry(&dest).map_err(|e| e.to_string())
}

/// Copy an external Guitar Pro file into `dest_dir` (the library). Returns the
/// existing entry unchanged when the file already lives inside `dest_dir` —
/// compared via canonicalized paths so symlinked or non-normalized library
/// locations are recognised. Collisions are handled like `save_gp_file_to_dir`.
#[tauri::command]
pub async fn import_gp_file(src_path: String, dest_dir: String) -> Result<LibraryEntry, String> {
    let src = Path::new(&src_path);
    ensure_gp_path(src)?;
    let dir = Path::new(&dest_dir);

    if let (Ok(csrc), Ok(cdir)) = (fs::canonicalize(src), fs::canonicalize(dir)) {
        if csrc.starts_with(&cdir) {
            return build_entry(src).map_err(|e| e.to_string());
        }
    }

    let bytes = fs::read(src).map_err(|e| format!("Failed to read '{}': {}", src_path, e))?;

    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("gp5")
        .to_lowercase();
    let filename = format!("{}.{}", sanitize_file_stem(stem), ext);

    let dest = write_unique(dir, &filename, &bytes)?;
    build_entry(&dest).map_err(|e| e.to_string())
}

/// Rename a Guitar Pro file on disk and return the updated library entry.
/// The new path uses the same directory and extension as the original.
#[tauri::command]
pub async fn rename_gp_file(old_path: String, new_name: String) -> Result<LibraryEntry, String> {
    let old = Path::new(&old_path);
    ensure_gp_path(old)?;
    let parent = old
        .parent()
        .ok_or_else(|| format!("Cannot determine parent directory of '{}'", old_path))?;
    let ext = old
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("gp5");

    let name = validate_file_stem(&new_name)?;
    let new_filename = format!("{}.{}", name, ext);
    let new_path = parent.join(&new_filename);

    if new_path.exists() && !is_same_file(old, &new_path) {
        return Err(format!(
            "A file named '{}' already exists in that folder.",
            new_filename
        ));
    }

    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename file: {}", e))?;

    build_entry(&new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_gp_file(path: String) -> Result<(), String> {
    ensure_gp_path(Path::new(&path))?;
    fs::remove_file(&path).map_err(|e| format!("Failed to delete '{}': {}", path, e))
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const GP_EXTENSIONS: &[&str] = &["gp", "gp3", "gp4", "gp5", "gpx"];

/// Directory depth limit for library scans (defense against pathological trees).
const MAX_SCAN_DEPTH: u32 = 32;

/// Guard shared by every file command: reject paths whose extension is not a
/// known Guitar Pro extension.
fn ensure_gp_path(path: &Path) -> Result<(), String> {
    if is_gp_file(path) {
        Ok(())
    } else {
        Err(format!("'{}' is not a Guitar Pro file.", path.display()))
    }
}

/// Validate a user-supplied file stem (name without extension).
/// Rejects path separators/traversal and characters invalid on Windows so a
/// library synced across machines never produces an unusable filename.
fn validate_file_stem(raw: &str) -> Result<&str, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err("File name cannot be empty.".to_string());
    }
    if name == "." || name == ".." || name.chars().any(|c| c == '/' || c == '\\') {
        return Err("File name cannot contain path separators.".to_string());
    }
    if name.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') || c.is_control())
        || name.ends_with('.')
    {
        return Err(format!(
            "'{}' contains characters that are not valid in file names.",
            name
        ));
    }
    Ok(name)
}

/// True when both paths resolve to the same file on disk. Lets a rename that
/// only changes letter case succeed on case-insensitive filesystems, where
/// `new_path.exists()` is already true for the file being renamed.
fn is_same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => false,
    }
}

/// Best-effort rewrite of an arbitrary stem into one that passes
/// `validate_file_stem` — used for imported filenames we don't control.
fn sanitize_file_stem(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '/' | '\\') || c.is_control()
            {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']);
    if cleaned.is_empty() {
        "imported tab".to_string()
    } else {
        cleaned.to_string()
    }
}

/// Create a file for `bytes` in `dest_dir` without clobbering. `create_new`
/// makes the existence check and the creation one atomic operation (no
/// check-then-write race); an existing file with identical content is reused,
/// and other name collisions fall back to a "name (1).ext" suffix.
fn write_unique(dest_dir: &Path, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create directory '{}': {}", dest_dir.display(), e))?;

    let file = Path::new(filename);
    let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or(filename);
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("gp5");

    for i in 0..100 {
        let candidate = if i == 0 {
            filename.to_string()
        } else {
            format!("{} ({}).{}", stem, i, ext)
        };
        let dest = dest_dir.join(&candidate);

        match fs::OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(mut f) => {
                f.write_all(bytes)
                    .map_err(|e| format!("Failed to save '{}': {}", dest.display(), e))?;
                return Ok(dest);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                // Name taken — reuse the existing file if the content matches.
                if fs::read(&dest).map(|existing| existing == bytes).unwrap_or(false) {
                    return Ok(dest);
                }
            }
            Err(e) => return Err(format!("Failed to save '{}': {}", dest.display(), e)),
        }
    }
    Err(format!("Too many files named '{}' in the library.", stem))
}

fn is_gp_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| GP_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn build_entry(path: &Path) -> std::io::Result<LibraryEntry> {
    let meta = fs::metadata(path)?;
    let name = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    Ok(LibraryEntry {
        path: path.to_string_lossy().into_owned(),
        name,
        ext,
        size: meta.len(),
    })
}

fn scan_recursive(dir: &Path, out: &mut Vec<LibraryEntry>, depth: u32) -> std::io::Result<()> {
    if depth > MAX_SCAN_DEPTH {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path  = entry.path();

        // Never follow symlinks — a link pointing at an ancestor directory
        // would otherwise recurse forever.
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            // Silently skip permission-denied sub-dirs
            let _ = scan_recursive(&path, out, depth + 1);
        } else if is_gp_file(&path) {
            if let Ok(lib_entry) = build_entry(&path) {
                out.push(lib_entry);
            }
        }
    }
    Ok(())
}
