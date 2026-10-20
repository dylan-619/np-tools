#ifndef INC_DEVICE_CONFIG_RUNTIME_H_
#define INC_DEVICE_CONFIG_RUNTIME_H_

#include "device_config.h"

/** 返回 UART1 运维命令访问各配置 owner 的固定适配表。 */
const DeviceConfigCommandIo *DeviceConfigRuntime_GetCommandIo(void);

/** 仅供启动路径将已加载身份投影到本次启动冻结的运行期设备信息。 */
void DeviceConfigRuntime_ApplyIdentity(const DeviceIdentity *identity);

#endif
