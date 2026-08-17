use std::collections::HashMap;
use tokio::sync::{Mutex, mpsc};
use tokio_serial::SerialPortBuilderExt;
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

    pub async fn open(
        &self,
        config: SerialOpenConfig,
        on_data: mpsc::Sender<Vec<app_types::IoChunk>>,
    ) -> Result<(), String> {
        let mut conns = self.connections.lock().await;
        if conns.contains_key(&config.path) {
            return Err(format!("串口 {} 已经处于打开状态", config.path));
        }

        let data_bits = match config.data_bits.to_lowercase().as_str() {
            "seven" | "7" => tokio_serial::DataBits::Seven,
            "six" | "6" => tokio_serial::DataBits::Six,
            "five" | "5" => tokio_serial::DataBits::Five,
            _ => tokio_serial::DataBits::Eight,
        };

        let stop_bits = match config.stop_bits.to_lowercase().as_str() {
            "two" | "2" => tokio_serial::StopBits::Two,
            _ => tokio_serial::StopBits::One,
        };

        let parity = match config.parity.to_lowercase().as_str() {
            "odd" => tokio_serial::Parity::Odd,
            "even" => tokio_serial::Parity::Even,
            _ => tokio_serial::Parity::None,
        };

        let flow_control = match config.flow_control.to_lowercase().as_str() {
            "software" | "xonxoff" => tokio_serial::FlowControl::Software,
            "hardware" | "rtscts" => tokio_serial::FlowControl::Hardware,
            _ => tokio_serial::FlowControl::None,
        };

        let port = tokio_serial::new(&config.path, config.baud_rate)
            .data_bits(data_bits)
            .stop_bits(stop_bits)
            .parity(parity)
            .flow_control(flow_control)
            .open_native_async()
            .map_err(|e| format!("打开串口 {} 失败 (波特率 {}): {}", config.path, config.baud_rate, e))?;

        let (tx, rx) = mpsc::channel(64);
        let actor = SerialActor::new(port, rx, on_data);

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
            Err(format!("串口 {} 未连接", path))
        }
    }

    pub async fn write(&self, path: &str, data: Vec<u8>) -> Result<(), String> {
        let conns = self.connections.lock().await;
        if let Some(tx) = conns.get(path) {
            tx.send(SerialCommand::Write(data))
                .await
                .map_err(|e| format!("发送数据失败: {}", e))
        } else {
            Err(format!("串口 {} 未连接，无法发送", path))
        }
    }

    pub async fn set_dtr(&self, path: &str, level: bool) -> Result<(), String> {
        let conns = self.connections.lock().await;
        if let Some(tx) = conns.get(path) {
            tx.send(SerialCommand::SetDtr(level))
                .await
                .map_err(|e| format!("设置 DTR 失败: {}", e))
        } else {
            Err(format!("串口 {} 未连接", path))
        }
    }

    pub async fn set_rts(&self, path: &str, level: bool) -> Result<(), String> {
        let conns = self.connections.lock().await;
        if let Some(tx) = conns.get(path) {
            tx.send(SerialCommand::SetRts(level))
                .await
                .map_err(|e| format!("设置 RTS 失败: {}", e))
        } else {
            Err(format!("串口 {} 未连接", path))
        }
    }

    pub async fn start_recording(&self, path: &str, file_path: String) -> Result<(), String> {
        let conns = self.connections.lock().await;
        if let Some(tx) = conns.get(path) {
            tx.send(SerialCommand::StartRecording(file_path))
                .await
                .map_err(|e| format!("启动录制失败: {}", e))
        } else {
            Err(format!("串口 {} 未连接", path))
        }
    }

    pub async fn stop_recording(&self, path: &str) -> Result<(), String> {
        let conns = self.connections.lock().await;
        if let Some(tx) = conns.get(path) {
            tx.send(SerialCommand::StopRecording)
                .await
                .map_err(|e| format!("停止录制失败: {}", e))
        } else {
            Err(format!("串口 {} 未连接", path))
        }
    }
}
