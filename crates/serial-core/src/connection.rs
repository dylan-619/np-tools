use std::collections::HashMap;
use tokio::sync::{Mutex, mpsc};
use app_types::SerialOpenConfig;
use crate::actor::{SerialActor, SerialCommand};

pub struct ConnectionManager {
    pub connections: Mutex<HashMap<String, mpsc::Sender<SerialCommand>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }

    pub async fn open(&self, config: SerialOpenConfig, on_data: mpsc::Sender<Vec<app_types::IoChunk>>) -> Result<(), String> {
        let mut conns = self.connections.lock().await;
        if conns.contains_key(&config.path) {
            return Err(format!("Port {} is already open", config.path));
        }

        let (tx, rx) = mpsc::channel(32);
        let actor = SerialActor::new(config.clone(), rx, on_data);
        
        tokio::spawn(async move {
            actor.run().await;
        });

        conns.insert(config.path, tx);
        
        Ok(())
    }

    pub async fn close(&self, path: &str) -> Result<(), String> {
        let mut conns = self.connections.lock().await;
        if let Some(tx) = conns.remove(path) {
            let _ = tx.send(SerialCommand::Close).await;
            Ok(())
        } else {
            Err(format!("Port {} is not open", path))
        }
    }

    pub async fn write(&self, path: &str, data: Vec<u8>) -> Result<(), String> {
        let conns = self.connections.lock().await;
        if let Some(tx) = conns.get(path) {
            tx.send(SerialCommand::Write(data)).await.map_err(|e| e.to_string())
        } else {
            Err(format!("Port {} is not open", path))
        }
    }

    pub async fn set_dtr(&self, path: &str, level: bool) -> Result<(), String> {
        let conns = self.connections.lock().await;
        if let Some(tx) = conns.get(path) {
            tx.send(SerialCommand::SetDtr(level)).await.map_err(|e| e.to_string())
        } else {
            Err(format!("Port {} is not open", path))
        }
    }

    pub async fn set_rts(&self, path: &str, level: bool) -> Result<(), String> {
        let conns = self.connections.lock().await;
        if let Some(tx) = conns.get(path) {
            tx.send(SerialCommand::SetRts(level)).await.map_err(|e| e.to_string())
        } else {
            Err(format!("Port {} is not open", path))
        }
    }

    pub async fn start_recording(&self, path: &str, file_path: String) -> Result<(), String> {
        let conns = self.connections.lock().await;
        if let Some(tx) = conns.get(path) {
            tx.send(SerialCommand::StartRecording(file_path)).await.map_err(|e| e.to_string())
        } else {
            Err(format!("Port {} is not open", path))
        }
    }

    pub async fn stop_recording(&self, path: &str) -> Result<(), String> {
        let conns = self.connections.lock().await;
        if let Some(tx) = conns.get(path) {
            tx.send(SerialCommand::StopRecording).await.map_err(|e| e.to_string())
        } else {
            Err(format!("Port {} is not open", path))
        }
    }
}
