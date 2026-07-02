// lib.rs — Tauri application library root
//
// Exposes `run()` which is called by main.rs.  Plugin registration and
// the command handler are all wired here so the binary entry point stays
// minimal and the lib crate can be unit-tested independently.

mod commands;
mod songsterr;

// use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // ── Plugins ───────────────────────────────────────────────────────
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())

        // ── IPC commands ──────────────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            commands::read_gp_file,
            commands::save_gp_file,
            commands::save_gp_file_to_dir,
            commands::import_gp_file,
            commands::get_app_data_dir,
            commands::scan_directory_for_gp,
            commands::file_metadata,
            commands::rename_gp_file,
            commands::delete_gp_file,
            songsterr::songsterr_search,
            songsterr::songsterr_fetch_tab,
            songsterr::songsterr_check_restriction,
        ])

        // ── Window setup ──────────────────────────────────────────────────
        .setup(|_app| {
            // #[cfg(debug_assertions)]
            // {
            //     // Open DevTools automatically in debug builds
            //     if let Some(window) = app.get_webview_window("main") {
            //         window.open_devtools();
            //     }
            // }
            Ok(())
        })

        .run(tauri::generate_context!())
        .expect("error while running TabEngine");
}
