#ifndef KZ3_SOUTHBOUND_H
#define KZ3_SOUTHBOUND_H

#include <stdbool.h>
#include <stdint.h>

#include "data_manager.h"
/*
 * 南向运行时预留的 RTU 设备数。它仅限制固件内部诊断状态容量，不替代
 * 项目生成器对 RS485 轮询数和总线占用率的校验。
 */
#define SOUTHBOUND_MAX_RTU_DEVICES 16U

/* 从首拍采样起的整机硬件启动上限，重试/STOP/reset 不续期。 */
#define SOUTHBOUND_STARTUP_TIMEOUT_MS 10000U

/*
 * 覆盖 16 个 RTU 设备诊断、12 路扩展输出确认及 FC16 写组缓存。
 * southbound.c 的静态断言防止内部状态溢出。
 */
#define SOUTHBOUND_PRIVATE_STORAGE_SIZE 4768U

/* 板载 IO 和两路 RS485 的唯一物理访问 owner。内部 RTU 状态不属于公共 API。 */
typedef union
{
    uint64_t alignment;
    uint8_t storage[SOUTHBOUND_PRIVATE_STORAGE_SIZE];
} Southbound;

typedef struct
{
    uint32_t completed_count[2];
    uint32_t error_count[2];
    bool active[2];
    uint8_t board_output_result;
    uint32_t board_output_error_count[2];
    bool board_output_activated[2];
    bool board_output_deferred[2];
} SouthboundDiagnostics;

typedef enum
{
    SOUTHBOUND_SERVICE_READY = 0,
    SOUTHBOUND_SERVICE_PENDING,
    SOUTHBOUND_SERVICE_FAILED
} SouthboundServiceResult;

bool Southbound_Init(Southbound *southbound, DataManager *data);
/** 控制任务创建前启用一次；仅初始安全输出允许在启动上限内重试。 */
bool Southbound_EnableStartupGate(Southbound *southbound);
/** 控制 owner 每拍调用；检查板载采集/逐读块通信的新鲜完成证据及安全输出当前代次确认。
 * 输入quality另由业务判断，越量程/NaN不会冒充硬件通信失败。
 * READY 为单向启动完成；FAILED 锁存控制器南向故障，不通过 reset 续期。 */
SouthboundServiceResult Southbound_GetStartupStatus(Southbound *southbound,
                                                   uint32_t now_ms);
bool Southbound_Sample(Southbound *southbound, uint32_t now_ms);
bool Southbound_Apply(Southbound *southbound, const LogicContext *context,
                      uint32_t now_ms);
/** @brief 每拍唯一输出服务点；safe_required 时维持安全优先级与有界重试。 */
SouthboundServiceResult Southbound_ServiceOutputs(
    Southbound *southbound, const LogicContext *context,
    bool safe_required, uint32_t now_ms);
void Southbound_EnterSafe(Southbound *southbound);
void Southbound_RxFrame(Southbound *southbound, uint8_t port_id,
                        const uint8_t *frame, uint16_t length,
                        uint32_t now_ms);
bool Southbound_CopyDiagnostics(const Southbound *southbound,
                                SouthboundDiagnostics *diagnostics);

#if defined(KZ3_SOUTHBOUND_UNIT_TEST)
bool Southbound_TestIsRtuReady(const Southbound *southbound);
bool Southbound_TestGetOutputState(const Southbound *southbound,
                                  uint16_t output_index, bool *write_queued,
                                  bool *pending, bool *confirmed);
bool Southbound_TestGetOutputGenerations(
    const Southbound *southbound, uint16_t output_index,
    uint32_t *desired_generation, uint32_t *in_flight_generation,
    uint32_t *ack_generation, uint32_t *feedback_generation);
bool Southbound_TestScheduleRequest(Southbound *southbound, uint8_t port_id,
                                   uint8_t slave_address, uint8_t function,
                                   uint16_t pdu_address, uint32_t now_ms);
bool Southbound_TestGetLastRtuElapsedMs(const Southbound *southbound,
                                       uint8_t port_id, uint32_t *elapsed_ms);
bool Southbound_TestIsFaultRecoveryReady(const Southbound *southbound);
#endif

#endif
