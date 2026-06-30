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
use std::path::Path;
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
    scan_recursive(root, &mut entries).map_err(|e| e.to_string())?;
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
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory '{}': {}", parent.display(), e))?;
    }
    fs::write(&path, bytes).map_err(|e| format!("Failed to save tab file to '{}': {}", path, e))
}

/// Rename a Guitar Pro file on disk and return the updated library entry.
/// The new path uses the same directory and extension as the original.
#[tauri::command]
pub async fn rename_gp_file(old_path: String, new_name: String) -> Result<LibraryEntry, String> {
    let old = Path::new(&old_path);
    let parent = old
        .parent()
        .ok_or_else(|| format!("Cannot determine parent directory of '{}'", old_path))?;
    let ext = old
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("gp5");

    let new_filename = format!("{}.{}", new_name.trim(), ext);
    let new_path = parent.join(&new_filename);

    if new_path.exists() {
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
    fs::remove_file(&path).map_err(|e| format!("Failed to delete '{}': {}", path, e))
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const GP_EXTENSIONS: &[&str] = &["gp", "gp3", "gp4", "gp5", "gpx"];

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

fn scan_recursive(dir: &Path, out: &mut Vec<LibraryEntry>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path  = entry.path();

        if path.is_dir() {
            // Silently skip permission-denied sub-dirs
            let _ = scan_recursive(&path, out);
        } else if is_gp_file(&path) {
            if let Ok(lib_entry) = build_entry(&path) {
                out.push(lib_entry);
            }
        }
    }
    Ok(())
}
