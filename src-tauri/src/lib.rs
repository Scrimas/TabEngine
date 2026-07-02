// lib.rs — Tauri application library root
//
// Exposes `run()` which is called by main.rs.  Plugin registration and
// the command handler are all wired here so the binary entry point stays
// minimal and the lib crate can be unit-tested independently.

mod commands;
mod songsterr;

// use tauri::Manager;

pub fn run() {
    // WebKitGTK's DMA-BUF accelerated compositing path can fail to create an
    // EGL display when the AppImage's bundled (Ubuntu 22.04-era) Wayland libs
    // shadow the host's, aborting the process before any window opens (#2).
    // The release workflow strips those libs as the primary fix; this env var
    // is kept as defense-in-depth — but ONLY inside AppImage runs, because on
    // modern WebKitGTK/Wayland disabling the DMA-BUF renderer forces software
    // rendering of the whole webview (~10 fps UI, high CPU). AppRun exports
    // APPIMAGE, so its presence identifies that environment. Users can still
    // override by exporting the var themselves.
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_some()
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        // SAFETY: single-threaded at this point, before any webview/GTK init.
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

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
            songsterr::songsterr_fetch_url,
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
