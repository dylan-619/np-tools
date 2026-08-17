pub mod connection;
pub mod actor;

use app_types::SerialPortDescriptor;
use tokio_serial::SerialPortType;

pub fn list_ports() -> Result<Vec<SerialPortDescriptor>, String> {
    let ports = tokio_serial::available_ports().map_err(|e| e.to_string())?;
    let mut descriptors = Vec::new();

    for port in ports {
        #[cfg(target_os = "macos")]
        {
            // On macOS, prefer /dev/cu.* calling unit devices to prevent DCD carrier blocking
            if port.port_name.starts_with("/dev/tty.") && !port.port_name.contains("usb") {
                continue;
            }
            if port.port_name.starts_with("/dev/tty.Bluetooth") || port.port_name.starts_with("/dev/cu.Bluetooth") {
                continue;
            }
        }

        let mut product_name = None;
        let mut manufacturer = None;
        let mut vid = None;
        let mut pid = None;

        if let SerialPortType::UsbPort(info) = &port.port_type {
            product_name = info.product.clone();
            manufacturer = info.manufacturer.clone();
            vid = Some(info.vid);
            pid = Some(info.pid);
        }

        descriptors.push(SerialPortDescriptor {
            port_name: port.port_name,
            product_name,
            manufacturer,
            vid,
            pid,
        });
    }

    Ok(descriptors)
}
