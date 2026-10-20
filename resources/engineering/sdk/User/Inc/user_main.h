#ifndef KZ3_USER_MAIN_H_
#define KZ3_USER_MAIN_H_

#include "cm4_gpio_bitband.h"
#include "main.h"
#include <stdio.h>

#include "user_uart.h"
#include "iwdg.h"
#include "user_hmi.h"
#include "user_port.h"
#include "user_definitions.h"
#include "data_manager.h"
#include "logic_manager.h"
#include "runtime_fault.h"

//*****************************3：3代，7：407芯片，1：程序1，24：24年，12：12月，20：20日
#define APPLICATION_VERSION			000000000
#define BOOTLOADER_VERSION			0

extern uint32_t ResetFlag;//add by wei

const char *UserMain_GetResetReason(void);

#define	ENABLE_ETH					1

/************* 引脚定义 ***************************/
#define GRN_LED							PCO(2)
#define RED_LED							PCO(3)
#define KEY								PEI(1)

#define SLE_RST						PEO(0)
#define SLE_STA						PEI(2)

#define OLED_CS							PAO(15)
#define OLED_DC							PEO(5)
#define OLED_RST						PEO(4)
#define OLED_SCK						PBO(3)
#define OLED_SDIN						PBO(5)

#define EEP_WP							PBO(8)
#define EEP_SCL							PBO(6)
#define EEP_SDAI						PBI(7)
#define EEP_SDAO						PBO(7)

#define GP1_SCL							PAO(8)
#define GP1_SDAI						PCI(9)
#define GP1_SDAO						PCO(9)

#define GP2_SCL							PDO(3)
#define GP2_SDAI						PDI(4)
#define GP2_SDAO						PDO(4)

#define ETH_RST							PEO(3)

/*************Device type list***************************/
#define KZ_BSC						201//标准版
#define KZ_STD						202//基础版
#define KZ_HPF						203//高性能
#define KZ_PRO						204//pro版

#define OH_BSC						301//标准版
#define OH_STD						302//基础版
#define OH_HPF						303//高性能
#define OH_PRO						304//pro版

#define XT_BSC						401//标准版
#define XT_STD						402//基础版
#define XT_HPF						403//高性能
#define XT_PRO						404//pro版

/* 新固件不提供可编译开关来重新打开旧维护写入或旧 OTA/IAP 入口。 */

// 以下为通用设备参数结构定义。
/***************************结构体定义**************************************/
/* 新架构只保留当前运行路径需要的设备身份；可变运行状态由各 owner 提供。 */
#pragma pack(1)
typedef struct
{
	uint16_t DevType;		//设备类型
	uint8_t DevSN[13];		//设备序列号
} DeviceInfoTypeDef;
#pragma pack()

/* 设备身份由 user_main.c 从 SystemIdentity 投影；其他模块只能读取，不能自行扩展状态。 */
extern DeviceInfoTypeDef devInfo;

/**
 * @brief 读取统一 Runtime 的运行时间快照。
 *
 * 输出单位为秒；函数只读 RAM，不执行 EEPROM I/O，适用于 HMI、网络状态等读取任务。
 * 任一指针可以为 NULL，但不能同时为 NULL。
 */
/**
 * @brief 读取逻辑发布的控制模式快照。
 *
 * 输出值对应清单中的 control.mode（1=LOCAL、2=REMOTE）和
 * control.run_mode（1=MANUAL、2=AUTO）。函数只读 PointRegistry，不执行
 * EEPROM、协议或物理输出操作；点位尚未 GOOD 时返回 NOT_READY。
 */
LogicResult UserMain_GetControlState(uint16_t *mode, uint16_t *run_mode);

/** 向协议/HMI 提供 DataManager 的只读过程投影，不暴露可写 owner。 */
LogicResult UserMain_GetProcessSnapshot(DataManagerProcessSnapshot *snapshot);

/** 读取参数配置 revision；逻辑 owner 未就绪时返回 NOT_READY。 */
LogicResult UserMain_GetConfigRevision(uint32_t *revision);

/** 复制逻辑安全 API 首错诊断；无首错时返回 OK 并输出全零快照。 */
LogicResult UserMain_GetLogicApiFault(LogicApiFault *fault);

/** 复制参数恢复/提交诊断；不触发 EEPROM I/O。 */
LogicResult UserMain_GetParameterPersistenceDiagnostic(
    LogicParameterStoreDiagnostic *diagnostic, bool *ready);

/** 返回当前固件发布标识的只读字符串，不转移所有权。 */
const char *UserMain_GetFirmwareBuildId(void);

//设备通讯类型(本机作为从设备)
typedef enum 
{
	WC_SLE = 0U, //无线星闪通讯
	WL_THREAD,		//无线Thread通讯
	WC_CAN,			//有线CAN通讯
	WC_ETH			//有线以太网通讯
} DevCommTypeDef;

extern LedStaTypeDef hLedSta;//LED状态结构体变量，改变该变量值可以改变LED状态

#endif
