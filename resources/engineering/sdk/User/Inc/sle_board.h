#ifndef INC_SLE_BOARD_H_
#define INC_SLE_BOARD_H_

#include <stdint.h>

/**
 * @brief 对星闪模组执行一次板级断电/上电重启。
 *
 * Python 控制器通过 Linux GPIO2 执行该动作；F427 沿用旧 Zigbee 板已验证的
 * `ZB_RST/PE0` 接口，执行低电平断电 2 秒、拉高上电并等待 3 秒。
 * @return 0 表示已执行；非 0 表示执行失败。
 */
uint8_t SleBoard_PowerCycleStarModule(void);

#endif
