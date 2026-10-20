#include "logic.h"
#include <math.h>
#include <stddef.h>

/* LAB_ONLY: one fixed VFD, two fixed-speed pumps. No physical commissioning claim.
 * Commands, measured feedback and capacity ownership are deliberately separate. */
typedef struct {
    uint32_t status, fault_code, since_ms, stop_since_ms, off_since_ms;
    uint32_t loss_since_ms, run_since_ms;
    bool command, stopping, loss_timing, last_good;
    bool total_fault, device_fault, start_fault, stop_fault, loss_fault;
    bool run, fault, remote, good, reset;
} Pump;

static Pump ReadPump(LogicContext *context, unsigned index)
{
    Pump p = {0};
#define READ(P) \
    p.status=context->state.P##_status; p.fault_code=context->state.P##_fault_code; \
    p.since_ms=context->state.P##_since_ms; p.stop_since_ms=context->state.P##_stop_since_ms; \
    p.off_since_ms=context->state.P##_off_since_ms; p.loss_since_ms=context->state.P##_loss_since_ms; \
    p.run_since_ms=context->state.P##_run_since_ms; p.command=context->state.P##_command; \
    p.stopping=context->state.P##_stopping; p.loss_timing=context->state.P##_loss_timing; \
    p.last_good=context->state.P##_last_good; \
    p.total_fault=context->state.P##_total_fault; p.device_fault=context->state.P##_device_fault; \
    p.start_fault=context->state.P##_start_fault; p.stop_fault=context->state.P##_stop_fault; \
    p.loss_fault=context->state.P##_loss_fault; p.run=IO_IN(context,P##_run_fb).value; \
    p.fault=IO_IN(context,P##_fault).value; p.remote=IO_IN(context,P##_remote).value; \
    p.good=IO_IN(context,P##_run_fb).quality==POINT_CONFIG_QUALITY_GOOD && \
        IO_IN(context,P##_fault).quality==POINT_CONFIG_QUALITY_GOOD && \
        IO_IN(context,P##_remote).quality==POINT_CONFIG_QUALITY_GOOD; \
    p.reset=context->command.P##_reset_faults
    if (index==0U) { READ(pump1); }
    else if (index==1U) { READ(pump2); }
    else { READ(pump3); }
#undef READ
    return p;
}
static void WritePump(LogicContext *context, unsigned index, const Pump *p)
{
#define WRITE(P) \
    context->state.P##_status=p->status; context->state.P##_fault_code=p->fault_code; \
    context->state.P##_since_ms=p->since_ms; context->state.P##_stop_since_ms=p->stop_since_ms; \
    context->state.P##_off_since_ms=p->off_since_ms; context->state.P##_loss_since_ms=p->loss_since_ms; \
    context->state.P##_run_since_ms=p->run_since_ms; context->state.P##_command=p->command; \
    context->state.P##_stopping=p->stopping; context->state.P##_loss_timing=p->loss_timing; \
    context->state.P##_last_good=p->last_good; \
    context->state.P##_total_fault=p->total_fault; context->state.P##_device_fault=p->device_fault; \
    context->state.P##_start_fault=p->start_fault; context->state.P##_stop_fault=p->stop_fault; \
    context->state.P##_loss_fault=p->loss_fault
    if (index==0U) { WRITE(pump1); }
    else if (index==1U) { WRITE(pump2); }
    else { WRITE(pump3); }
#undef WRITE
}
static bool Delay(bool input, bool *active, uint32_t *since, uint32_t now,
                  uint32_t duration, uint32_t *remain)
{
    if (!input) { *active=false; return false; }
    if (!*active) { *active=true; *since=now; }
    uint32_t elapsed=now-*since;
    if (elapsed>=duration) { return true; }
    *remain=duration-elapsed;
    return false;
}
static void Aggregate(Pump *p)
{
    p->total_fault=p->device_fault || p->start_fault || p->stop_fault || p->loss_fault;
    p->fault_code=p->device_fault?1U:(p->start_fault?2U:(p->stop_fault?3U:(p->loss_fault?4U:0U)));
}
static void CheckPump(LogicContext *context, Pump *p)
{
    bool recovered=p->good && !p->last_good && context->state.sampled;
    p->last_good=p->good;
    if (!p->good) { return; }
    if (recovered && !p->run) { p->off_since_ms=context->now_ms; }
    if (p->fault) { p->device_fault=true; }
    if (!p->remote) { p->loss_timing=false; p->stopping=false; }
    else if (p->command && p->status==1U)
    {
        uint32_t elapsed=context->now_ms-p->since_ms;
        if (elapsed>context->state.saved_pump_start_timeout_ms ||
            (!p->run && elapsed>=context->state.saved_pump_start_timeout_ms)) { p->start_fault=true; }
        else if (p->run) { p->status=2U; p->run_since_ms=context->now_ms; }
    }
    else if (p->command && p->status==2U)
    {
        uint32_t unused=0U;
        if (Delay(!p->run,&p->loss_timing,&p->loss_since_ms,context->now_ms,5000U,&unused)) { p->loss_fault=true; }
    }
    if (p->stopping && p->remote)
    {
        uint32_t elapsed=context->now_ms-p->stop_since_ms;
        if (elapsed>context->state.saved_pump_stop_timeout_ms ||
            (p->run && elapsed>=context->state.saved_pump_stop_timeout_ms)) { p->stop_fault=true; }
        if (!p->run) { p->stopping=false; p->off_since_ms=context->now_ms; }
    }
    Aggregate(p);
    if (p->reset && p->total_fault && !p->fault && !p->run && !p->command && p->remote)
    {
        p->device_fault=false; p->start_fault=false; p->stop_fault=false; p->loss_fault=false;
        p->loss_timing=false; p->stopping=false; p->status=0U;
        Aggregate(p);
    }
}
static bool Available(const Pump *p)
{ return p->good && p->remote && !p->total_fault && !p->fault; }
static unsigned Occupied(const Pump pumps[3])
{
    unsigned count=0U;
    for (unsigned i=0U;i<3U;i++)
    { if (!pumps[i].good || pumps[i].run || pumps[i].command || pumps[i].stopping) { count++; } }
    return count;
}
static void DrivePump(LogicContext *context, Pump *p, bool wanted)
{
    wanted=wanted && Available(p);
    if (p->command && !wanted)
    {
        p->stop_since_ms=context->now_ms; p->stopping=!p->good || (p->run && p->remote);
        if (!p->run && p->good) { p->off_since_ms=context->now_ms; }
        p->loss_timing=false;
    }
    if (!p->command && wanted) { p->since_ms=context->now_ms; p->status=1U; }
    p->command=wanted;
    if (!p->good) { p->status=5U; }
    else if (p->total_fault) { p->status=4U; }
    else if (!wanted) { p->status=p->run?3U:0U; }
}
static bool LevelsValid(const LogicContext *context)
{
    return isfinite(context->param.stop_level_m) && isfinite(context->param.target_level_m) &&
        isfinite(context->param.vfd_start_level_m) && isfinite(context->param.assist_start_level_m) &&
        context->param.stop_level_m>=0.1f && context->param.stop_level_m<context->param.target_level_m &&
        context->param.target_level_m<context->param.vfd_start_level_m &&
        context->param.vfd_start_level_m<context->param.assist_start_level_m && context->param.assist_start_level_m<=2.4f;
}
static bool ParametersChanged(LogicContext *context)
{
    bool changed=false;
#define SAVE(P) changed=changed || context->state.saved_##P!=context->param.P; context->state.saved_##P=context->param.P
    SAVE(stop_level_m); SAVE(target_level_m); SAVE(vfd_start_level_m); SAVE(assist_start_level_m);
    SAVE(pid_kp); SAVE(pid_ki); SAVE(start_confirm_ms); SAVE(stage_confirm_ms);
    SAVE(pump_start_timeout_ms); SAVE(pump_stop_timeout_ms);
#undef SAVE
    return changed;
}
static void ClearTransitions(LogicContext *context)
{
    context->state.start_timing=false; context->state.high_timing=false;
    context->state.add_timing=false; context->state.remove_timing=false;
}
static bool Measurements(LogicContext *context)
{
    float level=IO_IN(context,level_current).value, frequency=IO_IN(context,frequency_current).value;
    context->state.level_valid=IO_IN(context,level_current).quality==POINT_CONFIG_QUALITY_GOOD &&
        isfinite(level) && level>=4.0f && level<=20.0f;
    context->state.frequency_valid=IO_IN(context,frequency_current).quality==POINT_CONFIG_QUALITY_GOOD &&
        isfinite(frequency) && frequency>=4.0f && frequency<=20.0f;
    context->state.level_m=context->state.level_valid?(level-4.0f)*3.0f/16.0f:0.0f;
    context->state.frequency_hz=context->state.frequency_valid?(frequency-4.0f)*50.0f/16.0f:0.0f;
    context->state.config_ready=LevelsValid(context) && isfinite(context->param.pid_kp) && isfinite(context->param.pid_ki) &&
        context->param.pid_kp>0.0f && context->param.pid_kp<=30.0f && context->param.pid_ki>=0.0f && context->param.pid_ki<=5.0f;
    return context->state.level_valid &&
        IO_IN(context,run_permit).quality==POINT_CONFIG_QUALITY_GOOD && IO_IN(context,run_permit).value &&
        IO_IN(context,water_available).quality==POINT_CONFIG_QUALITY_GOOD;
}
static bool StartAllowed(LogicContext *context, const Pump *p, unsigned occupied)
{
    if (!Available(p) || p->run || p->stopping || p->reset || occupied>=2U) { return false; }
    uint32_t stopped=context->now_ms-p->off_since_ms;
    if (stopped<15000U) { context->state.remain_ms=15000U-stopped; context->state.block_reason=6U; return false; }
    uint32_t gap=context->now_ms-context->state.last_start_ms;
    if (context->state.start_recorded && gap<3000U)
    { context->state.remain_ms=3000U-gap; context->state.block_reason=6U; return false; }
    return true;
}
static void RecordStart(LogicContext *context)
{ context->state.last_start_ms=context->now_ms; context->state.start_recorded=true; }
static bool AddDemand(LogicContext *context, const Pump *lead)
{
    bool high=context->state.level_m>=context->param.assist_start_level_m && lead->status==2U && lead->command;
    if (context->state.degraded)
    { return Delay(high,&context->state.add_timing,&context->state.confirm_since,context->now_ms,context->param.stage_confirm_ms,&context->state.remain_ms); }
    high=high && context->state.frequency_valid && context->state.frequency_hz>=49.5f;
    if (!high) { context->state.high_timing=false; context->state.add_timing=false; return false; }
    if (!context->state.high_timing) { context->state.high_timing=true; context->state.high_since=context->now_ms; context->state.trend_level=context->state.level_m; }
    uint32_t elapsed=context->now_ms-context->state.high_since;
    context->state.block_reason=4U;
    if (elapsed<10000U) { context->state.remain_ms=10000U-elapsed+context->param.stage_confirm_ms; return false; }
    if (context->state.level_m<context->state.trend_level-0.02f)
    { context->state.high_since=context->now_ms; context->state.trend_level=context->state.level_m; context->state.add_timing=false; return false; }
    return Delay(true,&context->state.add_timing,&context->state.confirm_since,context->now_ms,context->param.stage_confirm_ms,&context->state.remain_ms);
}
static bool RemoveDemand(LogicContext *context, const Pump *aux)
{
    bool low=context->state.level_m<=context->param.vfd_start_level_m && aux->status==2U && aux->command &&
        (uint32_t)(context->now_ms-aux->run_since_ms)>=15000U;
    if (!context->state.degraded) { low=low && context->state.frequency_valid && context->state.frequency_hz<=26.0f; }
    return Delay(low,&context->state.remove_timing,&context->state.remove_since,context->now_ms,context->param.stage_confirm_ms,&context->state.remain_ms);
}
static void DispatchAux(LogicContext *context, Pump pumps[3], bool wanted[3])
{
    unsigned selected=context->state.selected_aux;
    if (selected>0U && !Available(&pumps[selected-1U])) { context->state.selected_aux=0U; selected=0U; }
    if (selected==0U)
    {
        unsigned first=1U, last=context->state.degraded?1U:2U;
        for (unsigned i=first;i<=last;i++)
        {
            if (!StartAllowed(context,&pumps[i],Occupied(pumps))) { continue; }
            unsigned other=i==1U?2U:1U;
            if (!context->state.degraded && (pumps[other].stopping || !pumps[other].good || pumps[other].run ||
                (uint32_t)(context->now_ms-pumps[other].off_since_ms)<2000U))
            {
                context->state.block_reason=7U;
                uint32_t elapsed=context->now_ms-pumps[other].off_since_ms;
                if (pumps[other].good && !pumps[other].run && !pumps[other].stopping && elapsed<2000U)
                { context->state.remain_ms=2000U-elapsed; }
                continue;
            }
            context->state.selected_aux=i+1U; selected=i+1U; RecordStart(context); break;
        }
    }
    if (selected>0U) { wanted[selected-1U]=true; }
    else if (context->state.block_reason==0U) { context->state.block_reason=7U; }
}
static void Process(LogicContext *context, Pump pumps[3], bool wanted[3])
{
    unsigned lead=context->state.degraded?2U:0U;
    if (!IO_IN(context,water_available).value || context->state.level_m<=context->param.stop_level_m)
    {
        context->state.cycling=false; context->state.aux_demand=false; context->state.selected_aux=0U;
        context->state.block_reason=3U; ClearTransitions(context); return;
    }
    if (!context->state.cycling)
    {
        if (Delay(context->state.level_m>=context->param.vfd_start_level_m,&context->state.start_timing,
            &context->state.start_since,context->now_ms,context->param.start_confirm_ms,&context->state.remain_ms)) { context->state.cycling=true; }
        else { context->state.block_reason=5U; return; }
    }
    if (!Available(&pumps[lead])) { context->state.automatic=false; context->state.block_reason=9U; return; }
    if (pumps[lead].command) { wanted[lead]=true; }
    else if (StartAllowed(context,&pumps[lead],Occupied(pumps))) { wanted[lead]=true; RecordStart(context); }
    if (!wanted[lead]) { context->state.block_reason=7U; return; }
    if (!context->state.aux_demand && AddDemand(context,&pumps[lead]))
    { context->state.aux_demand=true; ClearTransitions(context); context->state.stage_changed_ms=context->now_ms; }
    if (context->state.aux_demand)
    {
        unsigned selected=context->state.selected_aux;
        if (selected>0U && RemoveDemand(context,&pumps[selected-1U]))
        { context->state.aux_demand=false; context->state.selected_aux=0U; ClearTransitions(context); context->state.stage_changed_ms=context->now_ms; }
        else { DispatchAux(context,pumps,wanted); }
    }
}
static void Regulate(LogicContext *context, const Pump pumps[3])
{
    context->state.pi_running=false; context->state.set_hz=0.0f;
    if (!pumps[0].command || context->state.degraded || !context->state.automatic)
    { PID_RESET(POINT_CONFIG_PID_LEVEL_LOOP); context->state.ao_current=0.0f; return; }
    LogicPidInput input={0}; LogicPidStatus result={0};
    input.enabled=true; input.measurement=context->state.level_m; input.setpoint=context->param.target_level_m;
    input.measurement_quality=POINT_CONFIG_QUALITY_GOOD;
    input.use_runtime_gains = true;
    input.runtime_kp=context->param.pid_kp;
    input.runtime_ki=context->param.pid_ki;
    input.tracking_mode=pumps[0].status!=2U;
    input.tracking_output=12.0f;
    if (!PID_STEP(context,POINT_CONFIG_PID_LEVEL_LOOP,&input,&result)) { context->state.automatic=false; return; }
    uint32_t dt=context->now_ms-context->state.last_scan_ms;
    if (dt>100U) { dt=100U; }
    float previous=context->state.ao_current<12.0f?12.0f:context->state.ao_current;
    float step=0.0064f*(float)dt; /* 20 Hz/s; limits software command slew. */
    context->state.ao_current=CLAMP(result.output,previous-step,previous+step);
    context->state.ao_current=CLAMP(context->state.ao_current,12.0f,20.0f);
    context->state.set_hz=(context->state.ao_current-4.0f)*50.0f/16.0f;
    context->state.pi_running=result.running;
}
static void Publish(LogicContext *context, Pump pumps[3])
{
    context->state.occupied=Occupied(pumps);
    context->state.alarm=pumps[0].total_fault || pumps[1].total_fault || pumps[2].total_fault ||
        !context->state.level_valid || !context->state.frequency_valid || context->state.degraded ||
        !pumps[0].good || !pumps[1].good || !pumps[2].good || context->state.occupied>2U ||
        IO_IN(context,high_high).quality!=POINT_CONFIG_QUALITY_GOOD || IO_IN(context,high_high).value;
    context->state.system_status=!context->state.automatic?(context->state.block_reason?9U:0U):
        (context->state.degraded?8U:(!context->state.cycling?1U:
        (pumps[0].status==1U?2U:(context->state.remove_timing?7U:
        (context->state.selected_aux>0U?6U:(context->state.aux_demand?5U:(context->state.high_timing?4U:3U)))))));
    IO_OUT(context,pump1_output)=pumps[0].command;
    IO_OUT(context,pump2_output)=pumps[1].command;
    IO_OUT(context,pump3_output)=pumps[2].command;
    IO_OUT(context,speed_output)=pumps[0].command?context->state.ao_current:0.0f;
    IO_OUT(context,alarm_output)=context->state.alarm;
    for (unsigned i=0U;i<3U;i++) { WritePump(context,i,&pumps[i]); }
}
bool Logic_Init(LogicContext *context)
{
    if (context==NULL) { return false; }
    context->state.automatic=false; context->state.degraded=false; context->state.cycling=false;
    context->state.aux_demand=false; context->state.selected_aux=0U; context->state.sampled=false;
    context->state.blocked_previous=false; context->state.start_recorded=false; context->state.ao_current=0.0f;
    ClearTransitions(context); (void)ParametersChanged(context);
    Pump pumps[3]={{0},{0},{0}};
    for (unsigned i=0U;i<3U;i++) { pumps[i].off_since_ms=context->now_ms-15000U; }
    Publish(context,pumps); return true;
}
bool Logic_Scan(LogicContext *context)
{
    if (context==NULL) { return false; }
    Pump pumps[3]; bool wanted[3]={false,false,false};
    for (unsigned i=0U;i<3U;i++) { pumps[i]=ReadPump(context,i); CheckPump(context,&pumps[i]); }
    context->state.remain_ms=0U; context->state.block_reason=0U;
    bool good=Measurements(context), changed=ParametersChanged(context);
    bool normal_ready=context->state.config_ready && context->state.frequency_valid && Available(&pumps[0]);
    bool stopped=context->command.system_stop || context->command.system_trip;
    if (!good || stopped || changed || (!context->state.degraded && context->state.automatic && !normal_ready))
    {
        context->state.automatic=false; context->state.degraded=false;
        context->state.block_reason=!good?1U:(changed?8U:(!stopped?9U:0U));
    }
    else if (!context->state.automatic && context->state.sampled && !context->state.blocked_previous &&
             !(pumps[0].reset || pumps[1].reset || pumps[2].reset))
    {
        if (context->command.system_start && normal_ready && Occupied(pumps)==0U)
        { context->state.automatic=true; context->state.degraded=false; }
        else if (context->command.degraded_start && LevelsValid(context) && Occupied(pumps)==0U &&
                 !normal_ready && Available(&pumps[2]))
        { context->state.automatic=true; context->state.degraded=true; }
        else if (context->command.system_start || context->command.degraded_start) { context->state.block_reason=9U; }
    }
    if (context->state.automatic) { Process(context,pumps,wanted); }
    if (!context->state.automatic)
    { context->state.cycling=false; context->state.aux_demand=false; context->state.selected_aux=0U; ClearTransitions(context); }
    for (unsigned i=0U;i<3U;i++) { DrivePump(context,&pumps[i],wanted[i] && context->state.automatic); }
    Regulate(context,pumps);
    if (!context->state.automatic)
    { for (unsigned i=0U;i<3U;i++) { DrivePump(context,&pumps[i],false); } }
    Publish(context,pumps);
    context->state.sampled=true; context->state.blocked_previous=!good;
    context->state.last_scan_ms=context->now_ms;
    return true;
}
void Logic_Stop(LogicContext *context)
{
    if (context==NULL) { return; }
    Pump pumps[3];
    context->state.automatic=false; context->state.degraded=false; context->state.cycling=false;
    context->state.aux_demand=false; context->state.selected_aux=0U; context->state.ao_current=0.0f;
    context->state.set_hz=0.0f; context->state.pi_running=false; ClearTransitions(context);
    for (unsigned i=0U;i<3U;i++) { pumps[i]=ReadPump(context,i); DrivePump(context,&pumps[i],false); }
    Publish(context,pumps);
}
