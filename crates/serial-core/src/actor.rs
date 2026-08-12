use tokio::sync::mpsc;
use tokio_serial::{SerialPortBuilderExt, SerialPort};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use app_types::{SerialOpenConfig, IoChunk};

pub enum SerialCommand {
    Close,
    Write(Vec<u8>),
    SetDtr(bool),
    SetRts(bool),
    StartRecording(String),
    StopRecording,
}

pub struct SerialActor {
    config: SerialOpenConfig,
    receiver: mpsc::Receiver<SerialCommand>,
    on_data: mpsc::Sender<Vec<IoChunk>>,
}

impl SerialActor {
    pub fn new(
        config: SerialOpenConfig,
        receiver: mpsc::Receiver<SerialCommand>,
        on_data: mpsc::Sender<Vec<IoChunk>>,
    ) -> Self {
        Self { config, receiver, on_data }
    }

    pub async fn run(mut self) {
        let port_res = tokio_serial::new(&self.config.path, self.config.baud_rate)
            .open_native_async();
            
        let mut port = match port_res {
            Ok(p) => p,
            Err(_) => return,
        };

        let mut buf = vec![0; 4096];
        let mut batch = Vec::new();
        let mut batch_bytes = 0;
        let mut ticker = tokio::time::interval(std::time::Duration::from_millis(33));
        let mut record_file: Option<tokio::fs::File> = None;

        loop {
            tokio::select! {
                cmd = self.receiver.recv() => {
                    match cmd {
                        Some(SerialCommand::Close) | None => break,
                        Some(SerialCommand::Write(data)) => {
                            if port.write_all(&data).await.is_err() {
                                break;
                            }
                            if let Some(f) = &mut record_file {
                                let _ = f.write_all(&data).await;
                            }
                        }
                        Some(SerialCommand::SetDtr(level)) => {
                            let _ = port.write_data_terminal_ready(level);
                        }
                        Some(SerialCommand::SetRts(level)) => {
                            let _ = port.write_request_to_send(level);
                        }
                        Some(SerialCommand::StartRecording(path)) => {
                            if let Ok(file) = tokio::fs::OpenOptions::new().create(true).append(true).open(&path).await {
                                record_file = Some(file);
                            }
                        }
                        Some(SerialCommand::StopRecording) => {
                            if let Some(mut f) = record_file.take() {
                                let _ = f.flush().await;
                            }
                        }
                    }
                }
                res = port.read(&mut buf) => {
                    match res {
                        Ok(n) if n > 0 => {
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
                                    break;
                                }
                                batch_bytes = 0;
                            }
                        }
                        Ok(_) => break, // EOF
                        Err(_) => break, // Error
                    }
                }
                _ = ticker.tick() => {
                    if !batch.is_empty() {
                        if self.on_data.send(std::mem::take(&mut batch)).await.is_err() {
                            break;
                        }
                        batch_bytes = 0;
                    }
                }
            }
        }
    }
}
