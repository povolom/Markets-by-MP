// Markets by MP desktop shell. The whole Markets API runs inside the app's own web view (with SQLite
// compiled to WebAssembly); this native side provides the window, file storage, notifications, opening
// links in your browser, and HTTP for fetching prices from the allowed data sources only.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // Debug builds open the web inspector, for diagnosing problems.
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(w) = _app.get_webview_window("main") {
                    w.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Markets by MP");
}
