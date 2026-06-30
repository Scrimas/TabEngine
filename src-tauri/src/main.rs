// main.rs — Tauri application entry point
// `windows_subsystem = "windows"` hides the console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tabengine_lib::run();
}
