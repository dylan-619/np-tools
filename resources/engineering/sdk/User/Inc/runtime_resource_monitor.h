#ifndef KZ3_RUNTIME_RESOURCE_MONITOR_H
#define KZ3_RUNTIME_RESOURCE_MONITOR_H

#include <stdint.h>

/*
 * 固定容量必须覆盖当前启动路径中的应用任务、LwIP tcpip 任务、软件定时器
 * 任务和空闲任务；超过上限时只报告容量不足，不在运行时申请内存。
 */
#define RUNTIME_RESOURCE_MONITOR_MAX_TASKS 16U
#define RUNTIME_RESOURCE_MONITOR_TASK_NAME_LENGTH 16U

typedef enum
{
    RUNTIME_RESOURCE_LWIP_POOL_NETCONN = 0U,
    RUNTIME_RESOURCE_LWIP_POOL_TCP_PCB,
    RUNTIME_RESOURCE_LWIP_POOL_TCP_SEG,
    RUNTIME_RESOURCE_LWIP_POOL_PBUF,
    RUNTIME_RESOURCE_LWIP_POOL_PBUF_POOL,
    RUNTIME_RESOURCE_LWIP_POOL_COUNT
} RuntimeResourceLwipPool;

typedef struct
{
    uint32_t capacity_blocks;
    uint32_t used_blocks;
    uint32_t high_water_blocks;
    uint32_t error_count;
} RuntimeResourceLwipPoolSnapshot;

typedef struct
{
    char name[RUNTIME_RESOURCE_MONITOR_TASK_NAME_LENGTH];
    uint32_t state;
    uint32_t priority;
    uint32_t runtime_counter;
    uint32_t stack_high_water_words;
    uint32_t stack_high_water_bytes;
} RuntimeResourceTaskSnapshot;

typedef struct
{
    uint8_t initialized;
    uint8_t sample_valid;
    uint8_t task_capacity_exceeded;
    uint8_t task_snapshot_valid;
    uint16_t task_count;
    uint16_t task_count_total;
    uint32_t sample_tick_ms;
    uint32_t free_heap_bytes;
    uint32_t minimum_ever_free_heap_bytes;
    uint8_t lwip_mem_stats_available;
    uint8_t lwip_memp_stats_available;
    uint16_t lwip_memp_pool_count;
    uint32_t lwip_mem_available_bytes;
    uint32_t lwip_mem_used_bytes;
    uint32_t lwip_mem_high_water_bytes;
    uint32_t lwip_mem_error_count;
    uint32_t lwip_memp_available_blocks;
    uint32_t lwip_memp_used_blocks;
    uint32_t lwip_memp_high_water_blocks;
    uint32_t lwip_memp_error_count;
    RuntimeResourceLwipPoolSnapshot
        lwip_critical_pools[RUNTIME_RESOURCE_LWIP_POOL_COUNT];
    uint32_t control_scan_count;
    uint32_t control_late_count;
    uint32_t control_late_warning_count;
    uint32_t control_consecutive_late_count;
    uint32_t control_sample_error_count;
    uint32_t control_apply_error_count;
    uint32_t control_sample_us;
    uint32_t control_logic_us;
    uint32_t control_apply_us;
    uint32_t control_total_us;
    uint32_t control_sample_max_us;
    uint32_t control_logic_max_us;
    uint32_t control_apply_max_us;
    uint32_t control_total_max_us;
    uint32_t rtu_completed_count[2];
    uint32_t rtu_error_count[2];
    uint32_t rtu_drop_count[2];
    uint8_t rtu_active[2];
    uint8_t wireless_mode;
    uint8_t wireless_state;
    uint8_t wireless_error;
    uint8_t wireless_reserved;
    uint32_t wireless_step_us;
    uint32_t wireless_step_max_us;
    uint32_t wireless_reconnect_count;
    uint8_t edge_state;
    uint8_t edge_error;
    uint8_t edge_online;
    uint8_t edge_reserved;
    uint32_t edge_reconnect_count;
    uint32_t edge_rx_count;
    uint32_t edge_tx_count;
    uint32_t edge_rejected_count;
    uint32_t edge_dropped_count;
    uint32_t edge_step_us;
    uint32_t edge_step_max_us;
    RuntimeResourceTaskSnapshot tasks[RUNTIME_RESOURCE_MONITOR_MAX_TASKS];
} RuntimeResourceSnapshot;

/** @brief 初始化固定容量资源监视器；必须在创建应用任务前调用。 */
void RuntimeResourceMonitor_Init(void);

/**
 * @brief 采集一次 FreeRTOS、heap 和 LwIP 资源快照。
 *
 * 只能从任务上下文调用；FreeRTOS 会在收集任务表期间暂时挂起调度器，
 * 调用方不得在中断或持有业务互斥锁时调用。
 */
void RuntimeResourceMonitor_Sample(void);

/**
 * @brief 写入 V2 控制扫描和双总线 RTU 计数器，供下一条资源日志带出。
 *
 * 仅复制计数值，不保存业务对象指针；调用方无需提供这些指标。
 */
void RuntimeResourceMonitor_SetV2Metrics(
    uint32_t control_scan_count, uint32_t control_late_count,
    uint32_t control_late_warning_count, uint32_t control_consecutive_late_count,
    uint32_t control_sample_error_count, uint32_t control_apply_error_count,
    uint32_t control_sample_us, uint32_t control_logic_us,
    uint32_t control_apply_us, uint32_t control_total_us,
    uint32_t control_sample_max_us, uint32_t control_logic_max_us,
    uint32_t control_apply_max_us, uint32_t control_total_max_us,
    uint32_t rtu0_completed_count, uint32_t rtu0_error_count,
    uint32_t rtu0_drop_count, uint8_t rtu0_active,
    uint32_t rtu1_completed_count, uint32_t rtu1_error_count,
    uint32_t rtu1_drop_count, uint8_t rtu1_active);

/** 无线任务写入固定长度运行指标；不触发采样或日志。 */
void RuntimeResourceMonitor_SetWirelessMetrics(
    uint8_t mode, uint8_t state, uint8_t error, uint32_t reconnect_count,
    uint32_t step_us, uint32_t step_max_us);

/** Edge TCP owner 写入固定长度运行指标；不触发采样或日志。 */
void RuntimeResourceMonitor_SetEdgeMetrics(
    uint8_t state, uint8_t error, uint8_t online, uint32_t reconnect_count,
    uint32_t rx_count, uint32_t tx_count, uint32_t rejected_count,
    uint32_t dropped_count, uint32_t step_us, uint32_t step_max_us);

/**
 * @brief 采集并输出一组固定格式的资源日志。
 *
 * 始终刷新内存快照；仅在 `KZ3_UART1_RESOURCE_LOG_ENABLED=1` 的专用长稳构建且
 * 运行期 DEBUG 开关已开启时输出 `RES`/`RES_TASK`。
 */
void RuntimeResourceMonitor_Log(void);

#endif
