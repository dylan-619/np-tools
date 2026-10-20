#ifndef INC_SLE_REPORT_H_
#define INC_SLE_REPORT_H_

#include <stdint.h>

struct PlcV2NorthVariableService;

#define SLE_REPORT_QUEUE_COMPLETE 0U
#define SLE_REPORT_QUEUE_MORE     1U
#define SLE_REPORT_QUEUE_BUSY     2U
#define SLE_REPORT_QUEUE_FAILED   3U

/** @brief 绑定 Network 拥有的唯一北向点位服务，不接管其生命周期。 */
uint8_t SleReport_BindPointService(
    const struct PlcV2NorthVariableService *service);

/** @brief 开始一轮配置点 SLE 遥测分包；尚未发送任何帧。 */
uint8_t SleReport_BeginConfiguredData(void);

/**
 * @brief 排队一个物理帧不超过 730 B 的 JSON 遥测分包。
 * @return COMPLETE 表示本轮结束，MORE 表示下一次调用继续，BUSY 表示未入队应重试。
 */
uint8_t SleReport_QueueConfiguredData(uint16_t dest_addr,
                                      uint8_t pack_index);

#endif
