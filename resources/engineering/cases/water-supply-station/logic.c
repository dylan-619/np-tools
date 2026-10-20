#include "logic.h"
#include <stddef.h>

/* TK101清水箱：离散液位补水、双泵主备与双向电动阀。
 * 全部设备输出只有此工艺owner；时间均以无符号扫描时钟差计算。 */
typedef struct {
    uint32_t status, fault_code, since_ms, stop_since_ms;
    bool command, fault_latched, stopping;
} Pump;

static Pump ReadPump(LogicContext *context, unsigned n)
{
    Pump p;
#define READ_PUMP(prefix) \
    p.status=context->state.prefix##_status; p.fault_code=context->state.prefix##_fault_code; \
    p.since_ms=context->state.prefix##_since_ms; p.stop_since_ms=context->state.prefix##_stop_since_ms; \
    p.command=context->state.prefix##_command; p.fault_latched=context->state.prefix##_fault_latched; \
    p.stopping=context->state.prefix##_stopping
    if (n==1U) { READ_PUMP(pump1); } else { READ_PUMP(pump2); }
#undef READ_PUMP
    return p;
}
static void WritePump(LogicContext *context, unsigned n, const Pump *p)
{
#define WRITE_PUMP(prefix) \
    context->state.prefix##_status=p->status; context->state.prefix##_fault_code=p->fault_code; \
    context->state.prefix##_since_ms=p->since_ms; context->state.prefix##_stop_since_ms=p->stop_since_ms; \
    context->state.prefix##_command=p->command; context->state.prefix##_fault_latched=p->fault_latched; \
    context->state.prefix##_stopping=p->stopping
    if (n==1U) { WRITE_PUMP(pump1); } else { WRITE_PUMP(pump2); }
#undef WRITE_PUMP
}
static void PumpFault(Pump *p, uint32_t reason)
{
    if (!p->fault_latched) { p->fault_code=reason; }
    p->fault_latched=true;
}
static void CheckPump(LogicContext *context, Pump *p, bool run, bool fault, bool reset, bool monitor)
{
    uint32_t elapsed=context->now_ms-p->since_ms;
    if (fault) { PumpFault(p,1U); }
    if (monitor && p->command && p->status==1U)
    {
        /* 首次到达反馈若晚于T，不能覆盖已发生的超时；恰好T到达允许。 */
        if (elapsed>context->state.cycle_pump_start_timeout_ms ||
            (!run && elapsed>=context->state.cycle_pump_start_timeout_ms)) { PumpFault(p,2U); }
        else if (run) { p->status=2U; }
    }
    else if (monitor && p->command && p->status==2U && !run) { PumpFault(p,3U); }
    if (!p->command && run && !p->stopping)
    { p->stopping=true; p->stop_since_ms=context->now_ms; }
    if (p->stopping)
    {
        elapsed=context->now_ms-p->stop_since_ms;
        if (elapsed>context->state.cycle_pump_stop_timeout_ms ||
            (run && elapsed>=context->state.cycle_pump_stop_timeout_ms)) { PumpFault(p,4U); }
        if (!run) { p->stopping=false; }
    }
    if (reset && !fault && !run && !p->command)
    { p->fault_latched=false; p->fault_code=0U; p->stopping=false; p->status=0U; }
}
static void DrivePump(LogicContext *context, Pump *p, bool wanted, bool run)
{
    wanted=wanted && !p->fault_latched;
    if (p->command && !wanted)
    { p->stop_since_ms=context->now_ms; p->stopping=run; }
    if (!p->command && wanted) { p->since_ms=context->now_ms; p->status=1U; }
    p->command=wanted;
    if (p->fault_latched) { p->status=4U; }
    else if (!wanted) { p->status=run?3U:0U; }
}
static bool InputGood(LogicContext *context)
{
    return IO_IN(context,tank_low).quality==POINT_CONFIG_QUALITY_GOOD &&
        IO_IN(context,tank_high).quality==POINT_CONFIG_QUALITY_GOOD &&
        IO_IN(context,source_available).quality==POINT_CONFIG_QUALITY_GOOD &&
        IO_IN(context,supply_demand).quality==POINT_CONFIG_QUALITY_GOOD &&
        IO_IN(context,pump1_run_fb).quality==POINT_CONFIG_QUALITY_GOOD &&
        IO_IN(context,pump1_fault).quality==POINT_CONFIG_QUALITY_GOOD &&
        IO_IN(context,pump2_run_fb).quality==POINT_CONFIG_QUALITY_GOOD &&
        IO_IN(context,pump2_fault).quality==POINT_CONFIG_QUALITY_GOOD &&
        IO_IN(context,valve_open_limit).quality==POINT_CONFIG_QUALITY_GOOD &&
        IO_IN(context,valve_close_limit).quality==POINT_CONFIG_QUALITY_GOOD &&
        IO_IN(context,run_permit).quality==POINT_CONFIG_QUALITY_GOOD;
}
static void ValveOff(LogicContext *context)
{
    if (context->state.valve_direction!=0U)
    {
        context->state.valve_last_direction=context->state.valve_direction;
        context->state.valve_off_since_ms=context->now_ms;
        context->state.valve_direction=0U;
    }
}
static void ValveFault(LogicContext *context, uint32_t reason)
{
    if (!context->state.valve_fault_latched) { context->state.valve_fault_code=reason; }
    context->state.valve_fault_latched=true;
    ValveOff(context);
}
static void ValveStep(LogicContext *context, uint32_t wanted, bool good)
{
    bool opened=IO_IN(context,valve_open_limit).value;
    bool closed=IO_IN(context,valve_close_limit).value;
    uint32_t direction=context->state.valve_direction;
    bool arrived=(direction==1U && opened)||(direction==2U && closed);
    uint32_t elapsed=context->now_ms-context->state.valve_since_ms;
    if (good && opened && closed) { ValveFault(context,1U); }
    if (good && direction!=0U)
    {
        if (elapsed>context->state.cycle_valve_travel_timeout_ms ||
            (!arrived && elapsed>=context->state.cycle_valve_travel_timeout_ms)) { ValveFault(context,2U); }
        else if (arrived) { ValveOff(context); }
    }
    if (good && context->command.valve_reset_faults && !opened && !closed && wanted==0U)
    { context->state.valve_fault_latched=false; context->state.valve_fault_code=0U; }
    else if (good && context->command.valve_reset_faults && opened!=closed && context->state.valve_direction==0U)
    { context->state.valve_fault_latched=false; context->state.valve_fault_code=0U; }
    if (!good || context->state.valve_fault_latched || wanted==0U ||
        (wanted==1U && opened)||(wanted==2U && closed)) { ValveOff(context); }
    else if (context->state.valve_direction!=0U && context->state.valve_direction!=wanted) { ValveOff(context); }
    else if (context->state.valve_direction==0U)
    {
        elapsed=context->now_ms-context->state.valve_off_since_ms;
        if (context->state.valve_last_direction!=0U && context->state.valve_last_direction!=wanted && elapsed<2000U)
        { context->state.remain_ms=2000U-elapsed; }
        else { context->state.valve_direction=wanted; context->state.valve_since_ms=context->now_ms; }
    }
    context->state.valve_status=context->state.valve_fault_latched?5U:
        (context->state.valve_direction==1U?2U:(context->state.valve_direction==2U?3U:
        (opened?1U:(closed?0U:4U))));
}
static void PublishOutputs(LogicContext *context, const Pump *p1, const Pump *p2)
{
    IO_OUT(context,pump1_output)=p1->command;
    IO_OUT(context,pump2_output)=p2->command;
    IO_OUT(context,valve_open_output)=context->state.valve_direction==1U;
    IO_OUT(context,valve_close_output)=context->state.valve_direction==2U;
}
static void SnapshotParameters(LogicContext *context)
{
    context->state.cycle_pump_start_timeout_ms=context->param.pump_start_timeout_ms;
    context->state.cycle_pump_stop_timeout_ms=context->param.pump_stop_timeout_ms;
    context->state.cycle_valve_travel_timeout_ms=context->param.valve_travel_timeout_ms;
    context->state.cycle_switch_delay_ms=context->param.switch_delay_ms;
}
bool Logic_Init(LogicContext *context)
{
    if (context==NULL) { return false; }
    Pump empty={0};
    context->state.automatic=false; context->state.fill_request=false; context->state.close_request=false;
    context->state.sampled=false; context->state.blocked_previous=false;
    context->state.system_status=0U; context->state.block_reason=0U; context->state.selected_pump=0U;
    context->state.off_since_ms=0U; context->state.valve_direction=0U; context->state.valve_last_direction=0U;
    context->state.valve_off_since_ms=0U; context->state.valve_fault_latched=false;
    context->state.valve_fault_code=0U; context->state.valve_status=4U; context->state.remain_ms=0U;
    SnapshotParameters(context); WritePump(context,1U,&empty); WritePump(context,2U,&empty);
    PublishOutputs(context,&empty,&empty); return true;
}
bool Logic_Scan(LogicContext *context)
{
    if (context==NULL) { return false; }
    Pump p1=ReadPump(context,1U),p2=ReadPump(context,2U);
    bool good=InputGood(context), permit=IO_IN(context,run_permit).value;
    bool low=IO_IN(context,tank_low).value, high=IO_IN(context,tank_high).value;
    bool run1=IO_IN(context,pump1_run_fb).value,run2=IO_IN(context,pump2_run_fb).value;
    bool invalid_level=high && !low;
    bool reset=context->command.pump1_reset_faults||context->command.pump2_reset_faults||context->command.valve_reset_faults;
    bool inhibited=!good||!permit||invalid_level;
    bool recovering=context->state.blocked_previous;
    bool was_running=p1.command||p2.command;
    uint32_t valve_wanted=0U;
    context->state.remain_ms=0U;
    context->state.block_reason=!good?2U:(!permit?1U:(invalid_level?7U:0U));
    bool monitor=!inhibited && !context->command.system_trip && !context->command.system_stop && context->state.automatic && low && IO_IN(context,supply_demand).value;
    if (good)
    {
        CheckPump(context,&p1,run1,IO_IN(context,pump1_fault).value,context->command.pump1_reset_faults,monitor);
        CheckPump(context,&p2,run2,IO_IN(context,pump2_fault).value,context->command.pump2_reset_faults,monitor);
    }
    if (inhibited || context->command.system_trip)
    { context->state.automatic=false; context->state.fill_request=false; context->state.close_request=false; }
    else if (context->command.system_stop)
    { context->state.automatic=false; context->state.fill_request=false; context->state.close_request=true; }
    else if (!recovering && !reset && context->state.sampled && context->command.system_start && !context->state.automatic)
    { SnapshotParameters(context); context->state.automatic=true; context->state.close_request=false; }
    if (context->state.automatic)
    {
        if (!low) { context->state.fill_request=true; }
        if (high) { context->state.fill_request=false; }
        valve_wanted=context->state.fill_request && IO_IN(context,source_available).value?1U:2U;
    }
    else if (context->state.close_request) { valve_wanted=2U; }
    if (inhibited || context->command.system_trip || (context->command.valve_reset_faults && context->state.valve_fault_latched)) { valve_wanted=0U; }
    if (!context->state.automatic || !low || !IO_IN(context,supply_demand).value || inhibited)
    { context->state.selected_pump=0U; }
    else
    {
        if ((context->state.selected_pump==1U && p1.fault_latched)||
            (context->state.selected_pump==2U && p2.fault_latched)) { context->state.selected_pump=0U; }
        if (context->state.selected_pump==0U && !was_running && !run1 && !run2 && !reset)
        {
            uint32_t elapsed=context->now_ms-context->state.off_since_ms;
            if (elapsed>=context->state.cycle_switch_delay_ms)
            { context->state.selected_pump=!p1.fault_latched?1U:(!p2.fault_latched?2U:0U); }
            else { context->state.remain_ms=context->state.cycle_switch_delay_ms-elapsed; }
        }
    }
    DrivePump(context,&p1,context->state.selected_pump==1U,run1);
    DrivePump(context,&p2,context->state.selected_pump==2U,run2);
    if (was_running && !p1.command && !p2.command) { context->state.off_since_ms=context->now_ms; }
    ValveStep(context,valve_wanted,!inhibited);
    if (IO_IN(context,valve_close_limit).value && context->state.valve_direction==0U) { context->state.close_request=false; }
    if (context->state.automatic && context->state.block_reason==0U)
    {
        if (!low) { context->state.block_reason=3U; }
        else if (p1.fault_latched && p2.fault_latched) { context->state.block_reason=5U; }
        else if (context->state.selected_pump==0U && (run1||run2)) { context->state.block_reason=6U; }
        else if (!IO_IN(context,source_available).value && context->state.fill_request) { context->state.block_reason=4U; }
    }
    context->state.system_status=inhibited?5U:(!context->state.automatic?(context->state.close_request?7U:0U):
        (p1.command?2U:(p2.command?3U:(!low?1U:(context->state.remain_ms>0U?6U:4U)))));
    context->state.sampled=true; context->state.blocked_previous=inhibited;
    WritePump(context,1U,&p1); WritePump(context,2U,&p2); PublishOutputs(context,&p1,&p2);
    return true;
}
void Logic_Stop(LogicContext *context)
{
    if (context==NULL) { return; }
    Pump p1=ReadPump(context,1U),p2=ReadPump(context,2U);
    p1.command=false; p2.command=false; context->state.automatic=false;
    context->state.fill_request=false; context->state.close_request=false; ValveOff(context);
    WritePump(context,1U,&p1); WritePump(context,2U,&p2); PublishOutputs(context,&p1,&p2);
}
