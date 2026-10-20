#ifndef KZ3_CONTROL_CYCLE_MONITOR_H
#define KZ3_CONTROL_CYCLE_MONITOR_H

#include <stdint.h>

typedef struct
{
    uint32_t sample_us;
    uint32_t logic_us;
    uint32_t apply_us;
    uint32_t total_us;
    uint32_t sample_max_us;
    uint32_t logic_max_us;
    uint32_t apply_max_us;
    uint32_t total_max_us;
} ControlCycleTiming;

void ControlCycleMonitor_Init(void);
uint32_t ControlCycleMonitor_ReadCycles(void);
void ControlCycleMonitor_Record(uint32_t start_cycles, uint32_t sample_cycles,
                                uint32_t logic_cycles, uint32_t apply_cycles);
void ControlCycleMonitor_GetSnapshot(ControlCycleTiming *snapshot);

#endif
