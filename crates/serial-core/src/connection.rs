use crate::actor::{SerialActor, SerialCommand, SerialExit};
use app_types::SerialOpenConfig;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio_serial::SerialPortBuilderExt;
use uuid::Uuid;

#[derive(Clone)]
struct ConnectionEntry {
    id: Uuid,
    sender: mpsc::Sender<SerialCommand>,
}

pub struct ConnectionManager {
    connections: Arc<Mutex<HashMap<String, ConnectionEntry>>>,
    last_failures: Arc<Mutex<HashMap<String, String>>>,
}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            last_failures: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn open(
        &self,
        config: SerialOpenConfig,
        on_data: mpsc::Sender<Vec<app_types::IoChunk>>,
    ) -> Result<(), String> {
        let mut conns = self.connections.lock().await;
        if let Some(entry) = conns.get(&config.path) {
            if !entry.sender.is_closed() {
                return Err(format!("串口 {} 已经处于打开状态", config.path));
            }
            conns.remove(&config.path);
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
            .map_err(|e| {
                format!(
                    "打开串口 {} 失败 (波特率 {}): {}",
                    config.path, config.baud_rate, e
                )
            })?;

        let (tx, rx) = mpsc::channel(64);
        let actor = SerialActor::new(port, rx, on_data);
        let connection_id = Uuid::new_v4();
        let path = config.path.clone();
        let connections = Arc::clone(&self.connections);
        let last_failures = Arc::clone(&self.last_failures);

        conns.insert(
            config.path,
            ConnectionEntry {
                id: connection_id,
                sender: tx,
            },
        );
        drop(conns);
        self.last_failures.lock().await.remove(&path);

        tokio::spawn(async move {
            let exit = actor.run().await;

            /* 只清理属于当前 Actor 的记录，避免旧任务迟到退出时误删同一路径的
             * 新连接。 */
            let mut conns = connections.lock().await;
            let is_current = conns
                .get(&path)
                .is_some_and(|entry| entry.id == connection_id);
            if is_current {
                conns.remove(&path);
            }
            drop(conns);

            if is_current && let Some(message) = exit.failure_message() {
                last_failures
                    .lock()
                    .await
                    .insert(path.clone(), message.to_string());
                eprintln!("serial actor exited for {}: {}", path, message);
            }

            if let SerialExit::CloseRequested(done) = exit {
                let _ = done.send(());
            }
        });

        Ok(())
    }

    pub async fn close(&self, path: &str) -> Result<(), String> {
        let entry = self.connections.lock().await.get(path).cloned();
        let Some(entry) = entry else {
            self.last_failures.lock().await.remove(path);
            return Ok(());
        };

        let (done_tx, done_rx) = oneshot::channel();
        if entry
            .sender
            .send(SerialCommand::Close(done_tx))
            .await
            .is_err()
        {
            self.remove_if_current(path, entry.id).await;
            self.last_failures.lock().await.remove(path);
            return Ok(());
        }

        tokio::time::timeout(Duration::from_secs(2), done_rx)
            .await
            .map_err(|_| format!("关闭串口 {} 超时，后台任务未在 2 秒内退出", path))?
            .map_err(|_| format!("关闭串口 {} 失败，后台任务异常结束", path))?;
        self.last_failures.lock().await.remove(path);
        Ok(())
    }

    pub async fn write(&self, path: &str, data: Vec<u8>) -> Result<(), String> {
        self.execute_command(path, "发送数据", |done| {
            SerialCommand::Write(data, done)
        })
        .await
    }

    pub async fn set_dtr(&self, path: &str, level: bool) -> Result<(), String> {
        self.execute_command(path, "设置 DTR", |done| {
            SerialCommand::SetDtr(level, done)
        })
        .await
    }

    pub async fn set_rts(&self, path: &str, level: bool) -> Result<(), String> {
        self.execute_command(path, "设置 RTS", |done| {
            SerialCommand::SetRts(level, done)
        })
        .await
    }

    pub async fn start_recording(&self, path: &str, file_path: String) -> Result<(), String> {
        self.execute_command(path, "启动录制", |done| {
            SerialCommand::StartRecording(file_path, done)
        })
        .await
    }

    pub async fn stop_recording(&self, path: &str) -> Result<(), String> {
        self.execute_command(path, "停止录制", SerialCommand::StopRecording)
            .await
    }

    async fn execute_command<F>(
        &self,
        path: &str,
        operation: &str,
        build_command: F,
    ) -> Result<(), String>
    where
        F: FnOnce(oneshot::Sender<Result<(), String>>) -> SerialCommand,
    {
        let entry = self.connections.lock().await.get(path).cloned();
        let Some(entry) = entry else {
            return Err(self.disconnected_message(path, operation).await);
        };

        let (done_tx, done_rx) = oneshot::channel();
        if entry.sender.send(build_command(done_tx)).await.is_err() {
            self.remove_if_current(path, entry.id).await;
            return Err(self.disconnected_message(path, operation).await);
        }

        match tokio::time::timeout(Duration::from_secs(5), done_rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                tokio::task::yield_now().await;
                Err(self.disconnected_message(path, operation).await)
            }
            Err(_) => Err(format!("{}失败：串口 {} 后台任务响应超时", operation, path)),
        }
    }

    async fn remove_if_current(&self, path: &str, id: Uuid) {
        let mut conns = self.connections.lock().await;
        if conns.get(path).is_some_and(|entry| entry.id == id) {
            conns.remove(path);
        }
    }

    async fn disconnected_message(&self, path: &str, operation: &str) -> String {
        match self.last_failures.lock().await.get(path).cloned() {
            Some(reason) => format!("{}失败：串口 {} 已断开；{}", operation, path, reason),
            None => format!("{}失败：串口 {} 未连接或后台任务已退出", operation, path),
        }
    }
}
