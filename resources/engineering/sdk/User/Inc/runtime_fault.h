#ifndef KZ3_RUNTIME_FAULT_H
#define KZ3_RUNTIME_FAULT_H

#include <stdint.h>

typedef enum
{
    RUNTIME_FAULT_NONE = 0U,
    RUNTIME_FAULT_ERROR_HANDLER,
    RUNTIME_FAULT_HARDFAULT,
    RUNTIME_FAULT_MEMMANAGE,
    RUNTIME_FAULT_BUSFAULT,
    RUNTIME_FAULT_USAGEFAULT,
    RUNTIME_FAULT_STACK_OVERFLOW,
    RUNTIME_FAULT_MALLOC_FAILED,
    RUNTIME_FAULT_DEFAULT_TASK_CREATE,
    RUNTIME_FAULT_CONTROL_OWNER,
    RUNTIME_FAULT_SAFE_SNAPSHOT,
    RUNTIME_FAULT_WATCHDOG_STOP,
    RUNTIME_FAULT_OWNER_INIT,
    RUNTIME_FAULT_SLE_MAP_BIND,
    RUNTIME_FAULT_REPORT_BIND,
    RUNTIME_FAULT_NORTH_BIND,
    RUNTIME_FAULT_NETWORK_SERVICE_START,
    RUNTIME_FAULT_MAINTENANCE_TASK_CREATE,
    RUNTIME_FAULT_WIRELESS_TASK_CREATE,
    RUNTIME_FAULT_STATUS_TASK_CREATE,
    RUNTIME_FAULT_HMI_TASK_CREATE,
    RUNTIME_FAULT_CONTROL_TASK_CREATE,
    RUNTIME_FAULT_HMI_SNAPSHOT_BIND,
    RUNTIME_FAULT_ETHERNET_RESOURCE_CREATE,
    RUNTIME_FAULT_NMI,
    RUNTIME_FAULT_KERNEL_START
} RuntimeFaultReason;

typedef struct
{
    RuntimeFaultReason previous_reason;
    uint32_t previous_detail;
    uint32_t reset_flags;
} RuntimeFaultBootDiagnostic;

/** 读取并消费跨 watchdog reset 保留的首个致命原因。 */
void RuntimeFault_Initialize(uint32_t reset_flags);
void RuntimeFault_GetBootDiagnostic(RuntimeFaultBootDiagnostic *diagnostic);
const char *RuntimeFault_ReasonString(RuntimeFaultReason reason);

/**
 * 记录本次启动的首个致命原因，直接关闭已确认低电平安全的 DO 后停机等待 IWDG。
 * 不调用 RTOS、堆、日志、EEPROM、AO I2C 或协议栈。
 */
__attribute__((noreturn)) void RuntimeFault_Enter(RuntimeFaultReason reason,
                                                  uint32_t detail);

#endif
