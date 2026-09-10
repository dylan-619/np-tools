use serde::{Deserialize, Serialize};
use std::{
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    str::FromStr,
    sync::atomic::{AtomicU16, Ordering},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::Mutex,
    time::timeout,
};

const MIN_TIMEOUT_MS: u64 = 150;
const MAX_TIMEOUT_MS: u64 = 10_000;
const MAX_TCP_MBAP_LENGTH: usize = 254;

/// 通用 Modbus TCP 读请求。地址已由前端从 PLC 参考地址换算为 PDU 零基偏移。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusTcpReadRequest {
    pub host: String,
    pub port: u16,
    pub unit_id: u8,
    pub function_code: u8,
    pub address: u16,
    pub quantity: u16,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusTcpReadResponse {
    pub unit_id: u8,
    pub function_code: u8,
    pub data: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exception_code: Option<u8>,
    pub tx_adu: Vec<u8>,
    pub rx_adu: Vec<u8>,
    pub elapsed_ms: u64,
}

#[derive(Debug)]
struct ParsedResponse {
    unit_id: u8,
    function_code: u8,
    data: Vec<u8>,
    exception_code: Option<u8>,
}

/// 同一工具实例只保留一个 TCP 事务在途，保护现场网关和低性能从站。
pub struct ModbusTcpClient {
    next_transaction_id: AtomicU16,
    request_lock: Mutex<()>,
}

impl ModbusTcpClient {
    pub fn new() -> Self {
        Self {
            next_transaction_id: AtomicU16::new(1),
            request_lock: Mutex::new(()),
        }
    }

    async fn read(&self, request: ModbusTcpReadRequest) -> Result<ModbusTcpReadResponse, String> {
        let target = validate_request(&request)?;
        let _request_guard = self.request_lock.lock().await;
        let started = Instant::now();
        let duration = Duration::from_millis(request.timeout_ms);
        let transaction_id = self.next_transaction_id.fetch_add(1, Ordering::Relaxed);
        let tx_adu = build_read_adu(transaction_id, &request);

        let mut stream = timeout(duration, TcpStream::connect(target))
            .await
            .map_err(|_| format!("Modbus TCP 连接超时（{} ms）", request.timeout_ms))?
            .map_err(|error| format!("Modbus TCP 连接失败：{error}"))?;
        stream
            .set_nodelay(true)
            .map_err(|error| format!("设置 Modbus TCP 连接参数失败：{error}"))?;

        timeout(duration, stream.write_all(&tx_adu))
            .await
            .map_err(|_| format!("Modbus TCP 发送超时（{} ms）", request.timeout_ms))?
            .map_err(|error| format!("Modbus TCP 发送失败：{error}"))?;

        let mut header = [0_u8; 7];
        timeout(duration, stream.read_exact(&mut header))
            .await
            .map_err(|_| format!("Modbus TCP 等待响应头超时（{} ms）", request.timeout_ms))?
            .map_err(|error| format!("Modbus TCP 读取响应头失败：{error}"))?;

        let mbap_length = u16::from_be_bytes([header[4], header[5]]) as usize;
        if !(3..=MAX_TCP_MBAP_LENGTH).contains(&mbap_length) {
            return Err(format!("Modbus TCP 响应 MBAP 长度无效：{mbap_length}"));
        }
        let mut rx_adu = header.to_vec();
        let mut body = vec![0_u8; mbap_length - 1];
        timeout(duration, stream.read_exact(&mut body))
            .await
            .map_err(|_| format!("Modbus TCP 等待响应体超时（{} ms）", request.timeout_ms))?
            .map_err(|error| format!("Modbus TCP 读取响应体失败：{error}"))?;
        rx_adu.extend_from_slice(&body);

        let parsed = parse_response(transaction_id, &request, &rx_adu)?;
        Ok(ModbusTcpReadResponse {
            unit_id: parsed.unit_id,
            function_code: parsed.function_code,
            data: parsed.data,
            exception_code: parsed.exception_code,
            tx_adu,
            rx_adu,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }
}

fn validate_request(request: &ModbusTcpReadRequest) -> Result<SocketAddr, String> {
    let host = request.host.trim();
    let ip = Ipv4Addr::from_str(host)
        .map_err(|_| "Modbus TCP 地址只能填写 IPv4 地址，例如 192.168.30.66".to_string())?;
    if ip.is_unspecified() || ip.is_multicast() || ip == Ipv4Addr::BROADCAST {
        return Err("Modbus TCP 地址不能是未指定、组播或广播地址".to_string());
    }
    if request.port == 0 {
        return Err("Modbus TCP 端口必须在 1 到 65535 之间".to_string());
    }
    if !(1..=247).contains(&request.unit_id) {
        return Err("从站 ID 必须在 1 到 247 之间".to_string());
    }
    if !(1..=4).contains(&request.function_code) {
        return Err("只支持 Modbus 只读功能码 01、02、03、04".to_string());
    }
    let max_quantity = if matches!(request.function_code, 1 | 2) {
        2000
    } else {
        125
    };
    if request.quantity == 0 || request.quantity > max_quantity {
        return Err(format!(
            "当前功能码的读取数量必须在 1 到 {max_quantity} 之间"
        ));
    }
    if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&request.timeout_ms) {
        return Err(format!(
            "通信超时必须在 {MIN_TIMEOUT_MS} 到 {MAX_TIMEOUT_MS} ms 之间"
        ));
    }
    Ok(SocketAddr::V4(SocketAddrV4::new(ip, request.port)))
}

fn build_read_adu(transaction_id: u16, request: &ModbusTcpReadRequest) -> Vec<u8> {
    let mut adu = Vec::with_capacity(12);
    adu.extend_from_slice(&transaction_id.to_be_bytes());
    adu.extend_from_slice(&0_u16.to_be_bytes()); // Modbus protocol identifier
    adu.extend_from_slice(&6_u16.to_be_bytes()); // Unit Id + Function + Address + Quantity
    adu.push(request.unit_id);
    adu.push(request.function_code);
    adu.extend_from_slice(&request.address.to_be_bytes());
    adu.extend_from_slice(&request.quantity.to_be_bytes());
    adu
}

fn expected_data_length(function_code: u8, quantity: u16) -> usize {
    if matches!(function_code, 1 | 2) {
        quantity.div_ceil(8) as usize
    } else {
        quantity as usize * 2
    }
}

fn parse_response(
    transaction_id: u16,
    request: &ModbusTcpReadRequest,
    adu: &[u8],
) -> Result<ParsedResponse, String> {
    // 异常响应的 PDU 仅为功能码 + 异常码，总 ADU 长度为 7 + 2 = 9 B。
    if adu.len() < 9 {
        return Err("Modbus TCP 响应帧长度不足".to_string());
    }
    let received_transaction_id = u16::from_be_bytes([adu[0], adu[1]]);
    if received_transaction_id != transaction_id {
        return Err(format!(
            "Modbus TCP 事务 ID 不匹配：期望 {transaction_id}，收到 {received_transaction_id}"
        ));
    }
    if adu[2] != 0 || adu[3] != 0 {
        return Err("Modbus TCP 协议标识必须为 0".to_string());
    }
    let mbap_length = u16::from_be_bytes([adu[4], adu[5]]) as usize;
    if mbap_length + 6 != adu.len() {
        return Err(format!(
            "Modbus TCP MBAP 长度不匹配：声明 {mbap_length} B，实际 {} B",
            adu.len() - 6
        ));
    }
    if adu[6] != request.unit_id {
        return Err(format!(
            "Modbus TCP 响应从站 ID 不匹配：期望 {}，收到 {}",
            request.unit_id, adu[6]
        ));
    }

    let pdu = &adu[7..];
    if pdu[0] == (request.function_code | 0x80) {
        if pdu.len() != 2 {
            return Err("Modbus TCP 异常响应长度错误".to_string());
        }
        return Ok(ParsedResponse {
            unit_id: adu[6],
            function_code: pdu[0],
            data: Vec::new(),
            exception_code: Some(pdu[1]),
        });
    }
    if pdu[0] != request.function_code {
        return Err(format!(
            "Modbus TCP 响应功能码不匹配：期望 {:02}，收到 {:02}",
            request.function_code, pdu[0]
        ));
    }
    if pdu.len() < 2 {
        return Err("Modbus TCP 正常响应缺少字节计数".to_string());
    }
    let byte_count = pdu[1] as usize;
    if pdu.len() != byte_count + 2 {
        return Err(format!(
            "Modbus TCP 响应字节数不匹配：声明 {byte_count} B，实际 {} B",
            pdu.len().saturating_sub(2)
        ));
    }
    let expected_length = expected_data_length(request.function_code, request.quantity);
    if byte_count != expected_length {
        return Err(format!(
            "Modbus TCP 响应数据长度不匹配：期望 {expected_length} B，收到 {byte_count} B"
        ));
    }
    Ok(ParsedResponse {
        unit_id: adu[6],
        function_code: pdu[0],
        data: pdu[2..].to_vec(),
        exception_code: None,
    })
}

#[tauri::command]
pub async fn modbus_tcp_read(
    request: ModbusTcpReadRequest,
    state: tauri::State<'_, ModbusTcpClient>,
) -> Result<ModbusTcpReadResponse, String> {
    state.read(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn request() -> ModbusTcpReadRequest {
        ModbusTcpReadRequest {
            host: "192.168.30.66".to_string(),
            port: 502,
            unit_id: 1,
            function_code: 3,
            address: 0,
            quantity: 2,
            timeout_ms: 800,
        }
    }

    #[test]
    fn 请求仅允许明确且有限的读操作() {
        assert!(validate_request(&request()).is_ok());
        let mut invalid_host = request();
        invalid_host.host = "device.local".to_string();
        assert!(validate_request(&invalid_host).is_err());
        let mut write_function = request();
        write_function.function_code = 16;
        assert!(validate_request(&write_function).is_err());
        let mut too_many_registers = request();
        too_many_registers.quantity = 126;
        assert!(validate_request(&too_many_registers).is_err());
    }

    #[test]
    fn 构建读请求包含正确_mbap() {
        let mut request = request();
        request.address = 0x0010;
        request.quantity = 2;
        assert_eq!(
            build_read_adu(0x1234, &request),
            vec![0x12, 0x34, 0, 0, 0, 6, 1, 3, 0, 0x10, 0, 2]
        );
    }

    #[test]
    fn 解析正常和异常响应() {
        let request = request();
        let normal = vec![0, 1, 0, 0, 0, 7, 1, 3, 4, 0x42, 0xf6, 0xe9, 0x79];
        let parsed = parse_response(1, &request, &normal).unwrap();
        assert_eq!(parsed.data, vec![0x42, 0xf6, 0xe9, 0x79]);
        assert_eq!(parsed.exception_code, None);

        let exception = vec![0, 1, 0, 0, 0, 3, 1, 0x83, 2];
        let parsed = parse_response(1, &request, &exception).unwrap();
        assert_eq!(parsed.exception_code, Some(2));
        assert!(parsed.data.is_empty());
    }

    #[tokio::test]
    async fn 客户端执行一次受限的本地_tcp_读事务() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 12];
            socket.read_exact(&mut request).await.unwrap();
            assert_eq!(&request[2..], &[0, 0, 0, 6, 1, 3, 0, 0, 0, 2]);

            let response = [
                request[0], request[1], 0, 0, 0, 7, 1, 3, 4, 0x42, 0xf6, 0xe9, 0x79,
            ];
            socket.write_all(&response).await.unwrap();
        });

        let client = ModbusTcpClient::new();
        let mut request = request();
        request.host = "127.0.0.1".to_string();
        request.port = port;
        let response = client.read(request).await.unwrap();
        assert_eq!(response.data, vec![0x42, 0xf6, 0xe9, 0x79]);
        assert_eq!(response.exception_code, None);
        server.await.unwrap();
    }
}
