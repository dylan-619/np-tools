use app_types::{SerialPortDescriptor, SerialOpenConfig};
use serial_core::list_ports;
use serial_core::connection::ConnectionManager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn serial_list_ports() -> Result<Vec<SerialPortDescriptor>, String> {
    list_ports()
}

#[tauri::command]
async fn serial_open(
    config: SerialOpenConfig,
    on_data: tauri::ipc::Channel<Vec<app_types::IoChunk>>,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<(), String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(128);
    
    // Spawn task to forward data to frontend
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let _ = on_data.send(chunk);
        }
    });

    state.open(config, tx).await
}

#[tauri::command]
async fn serial_close(path: String, state: tauri::State<'_, ConnectionManager>) -> Result<(), String> {
    state.close(&path).await
}

#[tauri::command]
async fn serial_write(path: String, data: Vec<u8>, state: tauri::State<'_, ConnectionManager>) -> Result<(), String> {
    state.write(&path, data).await
}

#[tauri::command]
async fn serial_set_dtr(path: String, level: bool, state: tauri::State<'_, ConnectionManager>) -> Result<(), String> {
    state.set_dtr(&path, level).await
}

#[tauri::command]
async fn serial_set_rts(path: String, level: bool, state: tauri::State<'_, ConnectionManager>) -> Result<(), String> {
    state.set_rts(&path, level).await
}

#[tauri::command]
async fn serial_start_recording(path: String, file_path: String, state: tauri::State<'_, ConnectionManager>) -> Result<(), String> {
    state.start_recording(&path, file_path).await
}

#[tauri::command]
async fn serial_stop_recording(path: String, state: tauri::State<'_, ConnectionManager>) -> Result<(), String> {
    state.stop_recording(&path).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ConnectionManager::new())
        .invoke_handler(tauri::generate_handler![
            greet, 
            serial_list_ports, 
            serial_open, 
            serial_close, 
            serial_write,
            serial_set_dtr,
            serial_set_rts,
            serial_start_recording,
            serial_stop_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
