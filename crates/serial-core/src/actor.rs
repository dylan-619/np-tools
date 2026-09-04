use app_types::IoChunk;
use std::io::ErrorKind;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};
use tokio_serial::{SerialPort, SerialStream};

pub enum SerialCommand {
    Close(oneshot::Sender<()>),
    Write(Vec<u8>, oneshot::Sender<Result<(), String>>),
    SetDtr(bool, oneshot::Sender<Result<(), String>>),
    SetRts(bool, oneshot::Sender<Result<(), String>>),
    StartRecording(String, oneshot::Sender<Result<(), String>>),
    StopRecording(oneshot::Sender<Result<(), String>>),
}

pub enum SerialExit {
    CloseRequested(oneshot::Sender<()>),
    CommandChannelClosed,
    DataChannelClosed,
    IoError(String),
}

impl SerialExit {
    pub fn failure_message(&self) -> Option<&str> {
        match self {
            Self::DataChannelClosed => Some("前端数据接收通道已关闭"),
            Self::IoError(message) => Some(message),
            Self::CloseRequested(_) | Self::CommandChannelClosed => None,
        }
    }
}

pub struct SerialActor {
    port: SerialStream,
    receiver: mpsc::Receiver<SerialCommand>,
    on_data: mpsc::Sender<Vec<IoChunk>>,
}

impl SerialActor {
    pub fn new(
        port: SerialStream,
        receiver: mpsc::Receiver<SerialCommand>,
        on_data: mpsc::Sender<Vec<IoChunk>>,
    ) -> Self {
        Self {
            port,
            receiver,
            on_data,
        }
    }

    pub async fn run(mut self) -> SerialExit {
        let mut buf = vec![0; 4096];
        let mut batch = Vec::new();
        let mut batch_bytes = 0;
        let mut ticker = tokio::time::interval(std::time::Duration::from_millis(33));
        let mut record_file: Option<tokio::fs::File> = None;

        loop {
            tokio::select! {
                cmd = self.receiver.recv() => {
                    match cmd {
                        Some(SerialCommand::Close(done)) => {
                            if let Some(mut file) = record_file.take() {
                                let _ = file.flush().await;
                            }
                            return SerialExit::CloseRequested(done);
                        }
                        None => return SerialExit::CommandChannelClosed,
                        Some(SerialCommand::Write(data, done)) => {
                            if let Err(error) = self.port.write_all(&data).await {
                                let message = format!(
                                    "串口写入失败（{:?}）：{}",
                                    error.kind(),
                                    error
                                );
                                let _ = done.send(Err(message.clone()));
                                return SerialExit::IoError(message);
                            }
                            if let Some(f) = &mut record_file {
                                let _ = f.write_all(&data).await;
                            }
                            let _ = done.send(Ok(()));
                        }
                        Some(SerialCommand::SetDtr(level, done)) => {
                            let result = self.port.write_data_terminal_ready(level)
                                .map_err(|error| format!("设置 DTR 失败：{}", error));
                            let _ = done.send(result);
                        }
                        Some(SerialCommand::SetRts(level, done)) => {
                            let result = self.port.write_request_to_send(level)
                                .map_err(|error| format!("设置 RTS 失败：{}", error));
                            let _ = done.send(result);
                        }
                        Some(SerialCommand::StartRecording(path, done)) => {
                            match tokio::fs::OpenOptions::new().create(true).append(true).open(&path).await {
                                Ok(file) => {
                                    record_file = Some(file);
                                    let _ = done.send(Ok(()));
                                }
                                Err(error) => {
                                    let _ = done.send(Err(format!("打开录制文件失败：{}", error)));
                                }
                            }
                        }
                        Some(SerialCommand::StopRecording(done)) => {
                            if let Some(mut f) = record_file.take() {
                                let result = f.flush().await
                                    .map_err(|error| format!("刷新录制文件失败：{}", error));
                                let _ = done.send(result);
                            } else {
                                let _ = done.send(Ok(()));
                            }
                        }
                    }
                }
                res = self.port.read(&mut buf) => {
                    match res {
                        Ok(n) => {
                            if n == 0 {
                                /* Windows 的 USB CDC/VCP 驱动可能在端口仍有效且暂时无数据时
                                 * 完成一次零字节 overlapped read。串口不是普通文件，单次 0
                                 * 字节不能作为永久 EOF，否则连接刚建立 Actor 就会退出。 */
                                #[cfg(windows)]
                                {
                                    tokio::time::sleep(Duration::from_millis(10)).await;
                                    continue;
                                }

                                #[cfg(not(windows))]
                                return SerialExit::IoError(
                                    "串口读取返回 EOF，设备可能已断开".to_string(),
                                );
                            }

                            let data = buf[..n].to_vec();
                            if let Some(f) = &mut record_file {
                                let _ = f.write_all(&data).await;
                            }

                            let chunk = IoChunk {
                                id: uuid::Uuid::new_v4().to_string(),
                                direction: "rx".to_string(),
                                timestamp_us: std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_micros() as u64,
                                payload: data,
                            };
                            batch_bytes += n;
                            batch.push(chunk);

                            if batch_bytes >= 65536 {
                                if self.on_data.send(std::mem::take(&mut batch)).await.is_err() {
                                    return SerialExit::DataChannelClosed;
                                }
                                batch_bytes = 0;
                            }
                        }
                        Err(error) if matches!(
                            error.kind(),
                            ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
                        ) => {
                            tokio::time::sleep(Duration::from_millis(5)).await;
                        }
                        Err(error) => {
                            return SerialExit::IoError(format!(
                                "串口读取失败（{:?}）：{}",
                                error.kind(),
                                error
                            ));
                        }
                    }
                }
                _ = ticker.tick() => {
                    if !batch.is_empty() {
                        if self.on_data.send(std::mem::take(&mut batch)).await.is_err() {
                            return SerialExit::DataChannelClosed;
                        }
                        batch_bytes = 0;
                    }
                }
            }
        }
    }
}
