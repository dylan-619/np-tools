#include "logic_manager.h"
#include "eeprom_transport_fake.h"
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#ifndef PLC_BEGIN
#define PLC_BEGIN(id) ((void)(id))
#define PLC_END() ((void)0)
#define PLC_CHECK(x) do { if (!(x)) { fprintf(stderr,"assertion %d: %s\n",__LINE__,#x); exit(1); } } while (0)
#endif
/* Given the fixed LAB_ONLY fixture, When real DataManager/LogicManager scans run,
 * Then verify actual outputs, feedback, deadlines, fault ownership and PID tuning. */
static DataManager data;
static LogicManager logic;
static const unsigned BASE=2852U;
static const LogicContext *C(void) { return DataManager_GetSnapshot(&data); }
static void Scan(uint32_t now, float level, float hz, unsigned bits, unsigned bad)
{
    for (unsigned i=0U;i<12U;i++)
    {
        char bind[24]; snprintf(bind,sizeof(bind),"board.di%02u",i+1U);
        PLC_CHECK(DataManager_PublishBoolInput(&data,bind,(bits&(1U<<i))!=0U,(bad&(1U<<i))!=0U?POINT_CONFIG_QUALITY_OFFLINE:POINT_CONFIG_QUALITY_GOOD,now)==DATA_MANAGER_OK);
    }
    PLC_CHECK(DataManager_PublishF32Input(&data,"board.ai01",4.0f+level*16.0f/3.0f,(bad&4096U)!=0U?POINT_CONFIG_QUALITY_OFFLINE:POINT_CONFIG_QUALITY_GOOD,now)==DATA_MANAGER_OK);
    PLC_CHECK(DataManager_PublishF32Input(&data,"board.ai02",4.0f+hz*16.0f/50.0f,(bad&8192U)!=0U?POINT_CONFIG_QUALITY_OFFLINE:POINT_CONFIG_QUALITY_GOOD,now)==DATA_MANAGER_OK);
    PLC_CHECK(LogicManager_Step(&logic,now)); LogicManager_ServicePersistence(&logic,now);
    PLC_CHECK((unsigned)IO_OUT(C(),pump1_output)+(unsigned)IO_OUT(C(),pump2_output)+(unsigned)IO_OUT(C(),pump3_output)<=2U);
    PLC_CHECK(IO_OUT(C(),speed_output)>=0.0f && IO_OUT(C(),speed_output)<=20.0f);
    PLC_CHECK(IO_OUT(C(),pump1_output) || IO_OUT(C(),speed_output)==0.0f);
}
static void Cmd(const char *name)
{ PLC_CHECK(DataManager_SubmitBoolCommand(&data,name,true)==DATA_MANAGER_OK); }
static void Float(const char *name, float value)
{ uint32_t next; PLC_CHECK(DataManager_WriteParameterF32(&data,name,value,DataManager_GetParameterRevision(&data),&next)==DATA_MANAGER_OK); }
static void Fresh(void)
{
    EepromTransportFake_Reset(); DataManager_Init(&data); PLC_CHECK(LogicManager_Init(&logic,&data));
    Scan(0U,1.1f,0.0f,BASE,0U); Scan(10U,1.1f,0.0f,BASE,0U);
    const char *names[]={"parameter.stop_level_m","parameter.target_level_m","parameter.vfd_start_level_m","parameter.assist_start_level_m","parameter.pid_kp","parameter.pid_ki"};
    const float values[]={0.4f,0.8f,1.0f,1.8f,24.0f,0.6f};
    for (unsigned i=0U;i<6U;i++) { Float(names[i],values[i]); }
    const char *times[]={"parameter.start_confirm_ms","parameter.stage_confirm_ms","parameter.pump_start_timeout_ms","parameter.pump_stop_timeout_ms"};
    const uint32_t presets[]={2000U,5000U,5000U,5000U}; uint32_t next;
    for (unsigned i=0U;i<4U;i++) { PLC_CHECK(DataManager_WriteParameterU32(&data,times[i],presets[i],DataManager_GetParameterRevision(&data),&next)==DATA_MANAGER_OK); }
    Scan(11U,1.1f,0.0f,BASE,0U);
}
static void Start(void)
{
    Fresh(); Cmd("command.system_start"); Scan(20U,1.1f,0.0f,BASE,0U);
    Scan(2020U,1.1f,0.0f,BASE,0U); PLC_CHECK(IO_OUT(C(),pump1_output));
    Scan(2620U,1.1f,25.0f,BASE|1U,0U); PLC_CHECK(C()->state.pump1_status==2U);
}
static void Dual(void)
{
    Start(); Scan(3000U,1.9f,50.0f,BASE|1U,0U);
    Scan(13000U,1.95f,50.0f,BASE|1U,0U);
    Scan(18000U,2.0f,50.0f,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump2_output));
    Scan(18600U,2.0f,50.0f,BASE|9U,0U); PLC_CHECK(C()->state.pump2_status==2U);
}
static void Off(void)
{ PLC_CHECK(!IO_OUT(C(),pump1_output) && !IO_OUT(C(),pump2_output) && !IO_OUT(C(),pump3_output)); PLC_CHECK(IO_OUT(C(),speed_output)==0.0f); }
int main(void)
{
    /* PLC_TEST: NORMAL_PATH */
    PLC_BEGIN("NORMAL_PATH"); Start(); PLC_CHECK(C()->state.automatic && C()->state.pi_running); PLC_CHECK(!IO_OUT(C(),pump2_output));
    Scan(3000U,0.8f,33.0f,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump1_output)); PLC_END();
    /* PLC_TEST: BAD_QUALITY */
    PLC_BEGIN("BAD_QUALITY"); Start(); Scan(2700U,1.1f,40.0f,BASE|1U,4096U); Off(); PLC_CHECK(!C()->state.level_valid);
    Start(); Scan(2700U,1.1f,40.0f,BASE|1U,8192U); Off(); PLC_CHECK(!C()->state.frequency_valid);
    Start(); Scan(2700U,1.1f,40.0f,BASE|1U,2048U); Off(); PLC_END();
    /* PLC_TEST: COMMAND_CONFLICT */
    PLC_BEGIN("COMMAND_CONFLICT"); Fresh(); Cmd("command.system_start"); Cmd("command.system_stop"); Scan(20U,2.0f,0.0f,BASE,0U); Off(); PLC_CHECK(!C()->state.automatic); PLC_END();
    /* PLC_TEST: STOP_SAFE */
    PLC_BEGIN("STOP_SAFE"); Dual(); Cmd("command.system_trip"); Scan(18700U,2.0f,50.0f,BASE|9U,0U); Off();
    Scan(18800U,2.0f,0.0f,BASE,0U); Off(); PLC_END();
    /* PLC_TEST: RESET_FAULTS */
    PLC_BEGIN("RESET_FAULTS"); Start(); Scan(2700U,1.1f,40.0f,BASE|3U,0U); Off(); PLC_CHECK(C()->state.pump1_total_fault);
    Cmd("command.pump1_reset_faults"); Scan(2800U,1.1f,0.0f,BASE|2U,0U); PLC_CHECK(C()->state.pump1_total_fault);
    Cmd("command.pump1_reset_faults"); Scan(2900U,1.1f,0.0f,BASE,0U); PLC_CHECK(!C()->state.pump1_total_fault); Off(); PLC_END();
    /* PLC_TEST: POINT_MAPPING */
    PLC_BEGIN("POINT_MAPPING"); Start(); PLC_CHECK(fabsf(C()->state.level_m-1.1f)<0.001f); PLC_CHECK(fabsf(C()->state.frequency_hz-25.0f)<0.001f);
    PLC_CHECK(IO_OUT(C(),pump1_output) && !IO_OUT(C(),pump2_output) && !IO_OUT(C(),pump3_output)); PLC_END();
    /* PLC_TEST: RECOVERY_NO_START */
    PLC_BEGIN("RECOVERY_NO_START"); Start(); Scan(2700U,1.1f,40.0f,(BASE|1U)&~2048U,0U); Off();
    Cmd("command.system_start"); Scan(2800U,1.1f,0.0f,BASE,0U); Off(); Scan(2900U,1.1f,0.0f,BASE,0U); PLC_CHECK(!C()->state.automatic); PLC_END();
    /* PLC_TEST: DEMAND_PRIORITY */
    PLC_BEGIN("DEMAND_PRIORITY"); Dual(); Scan(18700U,0.3f,50.0f,BASE|9U,0U); Off(); PLC_CHECK(C()->state.automatic); PLC_END();
    /* PLC_TEST: FEEDBACK_FAILURE */
    PLC_BEGIN("FEEDBACK_FAILURE"); Start(); Scan(2700U,1.1f,40.0f,BASE,0U); PLC_CHECK(IO_OUT(C(),pump1_output));
    Scan(7699U,1.1f,40.0f,BASE,0U); PLC_CHECK(!C()->state.pump1_loss_fault);
    Scan(7700U,1.1f,40.0f,BASE,0U); PLC_CHECK(C()->state.pump1_loss_fault); Off(); PLC_END();
    /* PLC_TEST: TIME_BOUNDARY */
    PLC_BEGIN("TIME_BOUNDARY"); Fresh(); Cmd("command.system_start"); Scan(20U,1.1f,0.0f,BASE,0U);
    Scan(2019U,1.1f,0.0f,BASE,0U); Off(); Scan(2020U,1.1f,0.0f,BASE,0U); PLC_CHECK(IO_OUT(C(),pump1_output));
    Scan(7020U,1.1f,25.0f,BASE|1U,0U); PLC_CHECK(!C()->state.pump1_start_fault);
    Fresh(); Cmd("command.system_start"); Scan(20U,1.1f,0.0f,BASE,0U); Scan(2020U,1.1f,0.0f,BASE,0U);
    Scan(7021U,1.1f,25.0f,BASE|1U,0U); PLC_CHECK(C()->state.pump1_start_fault); Off(); PLC_END();
    /* PLC_TEST: TICK_WRAP */
    PLC_BEGIN("TICK_WRAP"); Fresh(); Cmd("command.system_start"); Scan(UINT32_MAX-1000U,1.1f,0.0f,BASE,0U);
    Scan(998U,1.1f,0.0f,BASE,0U); Off(); Scan(999U,1.1f,0.0f,BASE,0U); PLC_CHECK(IO_OUT(C(),pump1_output)); PLC_END();
    /* PLC_TEST: PARAMETER_UPDATE */
    PLC_BEGIN("PARAMETER_UPDATE"); Start(); Scan(3000U,1.9f,50.0f,BASE|1U,0U); Float("parameter.assist_start_level_m",2.1f);
    Scan(4000U,2.0f,50.0f,BASE|1U,0U); Off(); PLC_CHECK(!C()->state.high_timing && !C()->state.automatic);
    uint32_t rev=DataManager_GetParameterRevision(&data), next;
    PLC_CHECK(DataManager_WriteParameterF32(&data,"parameter.pid_kp",20.0f,rev-1U,&next)!=DATA_MANAGER_OK); PLC_END();
    /* PLC_TEST: COMMUNICATION_LOSS */
    PLC_BEGIN("COMMUNICATION_LOSS"); Start(); Scan(3000U,0.9f,33.0f,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump1_output));
    Scan(3100U,0.9f,33.0f,(BASE|1U)&~2048U,0U); Off(); PLC_END();
    /* PLC_TEST: RUNTIME_PERSISTENCE */
    PLC_BEGIN("RUNTIME_PERSISTENCE"); Start(); Scan(4620U,1.0f,33.0f,BASE|1U,0U);
    uint32_t seconds=0U; PointConfigQuality quality; PLC_CHECK(DataManager_ReadU32(&data,"runtime.pump1.seconds",&seconds,&quality)==DATA_MANAGER_OK); PLC_CHECK(seconds>=2U);
    Cmd("command.system_stop"); Scan(4700U,1.0f,0.0f,BASE,0U); for(unsigned i=0U;i<60U;i++){Scan(4710U+i*10U,1.0f,0.0f,BASE,0U);}
    DataManager_Init(&data); PLC_CHECK(LogicManager_Init(&logic,&data)); Scan(0U,1.0f,0.0f,BASE,0U);
    uint32_t restored=0U; PLC_CHECK(DataManager_ReadU32(&data,"runtime.pump1.seconds",&restored,&quality)==DATA_MANAGER_OK); PLC_CHECK(restored==seconds); Off(); PLC_END();
    /* PLC_TEST: HMI_CONTRACT */
    PLC_BEGIN("HMI_CONTRACT"); Start(); PLC_CHECK(DataManager_SubmitBoolCommand(&data,"point.pump1_output",true)!=DATA_MANAGER_OK);
    PLC_CHECK(DataManager_ReadF32(&data,"state.level_m",&(float){0},&quality)==DATA_MANAGER_OK); PLC_CHECK(g_point_config.north_field_count==74U); PLC_END();
    /* PLC_TEST: MODE_TRANSFER */
    PLC_BEGIN("MODE_TRANSFER"); Start(); Scan(2700U,1.1f,40.0f,(BASE|1U)&~4U,0U); Off(); PLC_CHECK(!C()->state.pump1_total_fault);
    Scan(2800U,1.1f,0.0f,BASE,0U); PLC_CHECK(!C()->state.automatic); PLC_END();
    /* PLC_TEST: STAGE_TRANSITIONS */
    PLC_BEGIN("STAGE_TRANSITIONS"); Dual(); Scan(34000U,0.9f,25.0f,BASE|9U,0U); PLC_CHECK(IO_OUT(C(),pump2_output));
    Scan(38999U,0.7f,25.0f,BASE|9U,0U); PLC_CHECK(IO_OUT(C(),pump2_output));
    Scan(39000U,0.65f,25.0f,BASE|9U,0U); PLC_CHECK(!IO_OUT(C(),pump2_output) && IO_OUT(C(),pump1_output)); PLC_END();
    /* PLC_TEST: CAPACITY_OWNERSHIP */
    PLC_BEGIN("CAPACITY_OWNERSHIP"); Start(); Scan(3000U,1.9f,50.0f,BASE|65U,0U); Scan(13000U,2.0f,50.0f,BASE|65U,0U);
    Scan(18000U,2.1f,50.0f,BASE|65U,0U); PLC_CHECK(!IO_OUT(C(),pump2_output)); PLC_CHECK(C()->state.occupied==2U);
    Start(); Scan(3000U,1.9f,50.0f,BASE|1U,64U); Scan(13000U,2.0f,50.0f,BASE|1U,64U);
    Scan(18000U,2.1f,50.0f,BASE|1U,64U); PLC_CHECK(!IO_OUT(C(),pump2_output) && !IO_OUT(C(),pump3_output));
    Dual(); Scan(19000U,2.0f,50.0f,BASE|9U,8U); PLC_CHECK(!IO_OUT(C(),pump2_output));
    Scan(19100U,2.0f,50.0f,BASE|1U,0U); PLC_CHECK(!IO_OUT(C(),pump3_output));
    Scan(21099U,2.0f,50.0f,BASE|1U,0U); PLC_CHECK(!IO_OUT(C(),pump3_output));
    Scan(21100U,2.0f,50.0f,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump3_output)); PLC_END();
    /* PLC_TEST: HETEROGENEOUS_REPLACEMENT */
    PLC_BEGIN("HETEROGENEOUS_REPLACEMENT"); Dual(); Scan(19000U,2.0f,50.0f,BASE|17U,0U); PLC_CHECK(IO_OUT(C(),pump1_output) && !IO_OUT(C(),pump2_output));
    Scan(20999U,2.0f,50.0f,BASE|1U,0U); PLC_CHECK(!IO_OUT(C(),pump3_output));
    Scan(21000U,2.0f,50.0f,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump3_output));
    Scan(21600U,2.0f,40.0f,BASE|65U,0U); Cmd("command.pump2_reset_faults"); Scan(21700U,2.0f,40.0f,BASE|65U,0U);
    PLC_CHECK(!C()->state.pump2_total_fault && IO_OUT(C(),pump3_output) && !IO_OUT(C(),pump2_output)); PLC_END();
    /* PLC_TEST: PID_OWNER */
    PLC_BEGIN("PID_OWNER"); Start(); PLC_CHECK(C()->state.pi_running); PLC_CHECK(g_point_config.pid_count==1U);
    PLC_CHECK(g_point_config.pids[0].direction==POINT_CONFIG_PID_REVERSE); PLC_CHECK(g_point_config.pids[0].sample_period_ms==100U); PLC_END();
    /* PLC_TEST: PID_TRANSFER */
    PLC_BEGIN("PID_TRANSFER"); Dual(); PLC_CHECK(C()->state.pi_running); Cmd("command.system_stop"); Scan(19000U,1.5f,40.0f,BASE|9U,0U); Off();
    PLC_CHECK(!C()->state.pi_running); PLC_END();
    /* PLC_TEST: PID_TUNING */
    PLC_BEGIN("PID_TUNING"); Start(); Float("parameter.pid_kp",20.0f); Scan(2700U,1.1f,40.0f,BASE|1U,0U); Off(); PLC_CHECK(!C()->state.automatic);
    Float("parameter.pid_ki",0.4f); Scan(2800U,1.1f,0.0f,BASE,0U); Off();
    Cmd("command.system_start"); Scan(2900U,1.1f,0.0f,BASE,0U); PLC_CHECK(C()->state.automatic);
    PLC_CHECK(DataManager_WriteParameterF32(&data,"parameter.pid_kp",NAN,DataManager_GetParameterRevision(&data),&next)!=DATA_MANAGER_OK); PLC_END();
    /* PLC_TEST: DEVICE_RESET_OWNERSHIP */
    PLC_BEGIN("DEVICE_RESET_OWNERSHIP"); Fresh(); Scan(20U,1.1f,0.0f,BASE|18U,0U); Cmd("command.pump1_reset_faults"); Scan(30U,1.1f,0.0f,BASE,0U);
    PLC_CHECK(!C()->state.pump1_total_fault && C()->state.pump2_total_fault); PLC_END();
    /* PLC_TEST: DEVICE_RESET_ISOLATION */
    PLC_BEGIN("DEVICE_RESET_ISOLATION"); Start(); Cmd("command.pump2_reset_faults"); Scan(2700U,1.1f,40.0f,BASE|1U,0U);
    PLC_CHECK(IO_OUT(C(),pump1_output) && C()->state.pump1_status==2U); PLC_END();
    /* PLC_TEST: FAULT_LATCH_LIFECYCLE */
    PLC_BEGIN("FAULT_LATCH_LIFECYCLE"); Fresh(); Scan(20U,1.1f,0.0f,BASE|128U,0U); Scan(30U,1.1f,0.0f,BASE,0U);
    PLC_CHECK(C()->state.pump3_device_fault && C()->state.pump3_total_fault); Cmd("command.pump3_reset_faults"); Scan(40U,1.1f,0.0f,BASE,0U); PLC_CHECK(!C()->state.pump3_total_fault); PLC_END();
    /* PLC_TEST: FAULT_VISIBLE_COHERENCE */
    PLC_BEGIN("FAULT_VISIBLE_COHERENCE"); Fresh(); Scan(20U,1.1f,0.0f,BASE|128U,0U);
    PLC_CHECK(C()->state.pump3_total_fault==(C()->state.pump3_device_fault || C()->state.pump3_start_fault || C()->state.pump3_stop_fault || C()->state.pump3_loss_fault)); PLC_CHECK(C()->state.alarm); PLC_END();
    /* PLC_TEST: FAULT_RESET_COHERENCE */
    PLC_BEGIN("FAULT_RESET_COHERENCE"); Fresh(); Scan(20U,1.1f,0.0f,BASE|128U,0U); Cmd("command.pump3_reset_faults"); Scan(30U,1.1f,0.0f,BASE,128U);
    PLC_CHECK(C()->state.pump3_total_fault); Cmd("command.pump3_reset_faults"); Scan(40U,1.1f,0.0f,BASE,0U); PLC_CHECK(!C()->state.pump3_total_fault); PLC_END();
    /* PLC_TEST: NEGATIVE_SWITCH_WINDOW */
    PLC_BEGIN("NEGATIVE_SWITCH_WINDOW"); Dual(); Scan(19000U,2.0f,50.0f,BASE|25U,0U);
    Scan(24000U,2.0f,50.0f,BASE|9U,0U); PLC_CHECK(C()->state.pump2_stop_fault); PLC_CHECK(!IO_OUT(C(),pump3_output));
    Scan(25000U,2.0f,50.0f,BASE|1U,0U); PLC_CHECK(!IO_OUT(C(),pump3_output));
    Scan(26999U,2.0f,50.0f,BASE|1U,0U); PLC_CHECK(!IO_OUT(C(),pump3_output));
    Scan(27000U,2.0f,50.0f,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump3_output)); PLC_END();
    /* PLC_TEST: LEVEL_HYSTERESIS */
    PLC_BEGIN("LEVEL_HYSTERESIS"); Start(); Scan(3000U,0.9f,33.0f,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump1_output));
    Scan(3100U,0.4f,33.0f,BASE|1U,0U); Off(); Scan(3200U,0.6f,0.0f,BASE,0U); Off(); PLC_CHECK(C()->state.automatic); PLC_END();
    /* PLC_TEST: FREQUENCY_FEEDBACK */
    PLC_BEGIN("FREQUENCY_FEEDBACK"); Start(); Scan(3000U,2.0f,40.0f,BASE|1U,0U);
    Scan(23000U,2.1f,40.0f,BASE|1U,0U); PLC_CHECK(!IO_OUT(C(),pump2_output)); PLC_CHECK(!C()->state.high_timing); PLC_END();
    /* PLC_TEST: TREND_WINDOW */
    PLC_BEGIN("TREND_WINDOW"); Start(); Scan(3000U,2.0f,50.0f,BASE|1U,0U);
    Scan(13000U,1.9f,50.0f,BASE|1U,0U); Scan(18000U,1.85f,50.0f,BASE|1U,0U); PLC_CHECK(!IO_OUT(C(),pump2_output));
    Scan(19000U,1.7f,50.0f,BASE|1U,0U); PLC_CHECK(!C()->state.high_timing && !C()->state.add_timing); PLC_END();
    /* PLC_TEST: DEGRADED_CONTROL */
    PLC_BEGIN("DEGRADED_CONTROL"); Start(); Scan(2700U,1.9f,0.0f,BASE|2U,0U); Off();
    Cmd("command.degraded_start"); Scan(2800U,1.9f,0.0f,BASE,0U); PLC_CHECK(C()->state.degraded);
    Scan(4800U,1.9f,0.0f,BASE,0U); PLC_CHECK(!IO_OUT(C(),pump3_output));
    Scan(5020U,1.9f,0.0f,BASE,0U); PLC_CHECK(IO_OUT(C(),pump3_output) && !IO_OUT(C(),pump1_output));
    Scan(5620U,1.9f,0.0f,BASE|64U,0U); Scan(10620U,2.0f,0.0f,BASE|64U,0U); PLC_CHECK(IO_OUT(C(),pump2_output)); PLC_CHECK(!C()->state.pi_running); PLC_END();
    /* PLC_TEST: PARAMETER_INVALID */
    PLC_BEGIN("PARAMETER_INVALID"); Fresh(); Float("parameter.stop_level_m",0.8f); Float("parameter.target_level_m",0.6f);
    Scan(20U,1.5f,0.0f,BASE,0U); Cmd("command.system_start"); Scan(30U,1.5f,0.0f,BASE,0U); Off(); PLC_CHECK(!C()->state.config_ready);
    PLC_CHECK(DataManager_WriteParameterF32(&data,"parameter.pid_ki",-1.0f,DataManager_GetParameterRevision(&data),&next)!=DATA_MANAGER_OK); PLC_END();
    /* PLC_TEST: RUNTIME_CLEAR */
    PLC_BEGIN("RUNTIME_CLEAR"); Dual(); Scan(20600U,2.0f,45.0f,BASE|9U,0U);
    Cmd("runtime.pump2.clear"); Scan(20700U,2.0f,45.0f,BASE|9U,0U);
    PLC_CHECK(IO_OUT(C(),pump1_output) && IO_OUT(C(),pump2_output)); PLC_CHECK(!C()->state.pump1_total_fault && !C()->state.pump2_total_fault); PLC_END();
    puts("THREE_PUMP_HOST_PASS: 34 executed scenarios"); return 0;
}
