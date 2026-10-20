#include "logic_manager.h"
#include "eeprom_transport_fake.h"
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#ifndef PLC_BEGIN
#define PLC_BEGIN(id) ((void)(id))
#define PLC_END() ((void)0)
#define PLC_CHECK(x) do { if (!(x)) { fprintf(stderr,"assertion %d: %s\n",__LINE__,#x); exit(1); } } while (0)
#endif
/* Given the actual fixed station C and SDK, When inputs and commands are scanned,
 * Then every scenario checks observable outputs and state; no physical hardware claim. */
static DataManager data;
static LogicManager logic;
static const unsigned BASE=4U|8U|512U|1024U;
static const LogicContext *C(void) { return DataManager_GetSnapshot(&data); }
static void Scan(uint32_t now, unsigned inputs, unsigned bad)
{
    const char *binds[]={"board.di01","board.di02","board.di03","board.di04","board.di05","board.di06","board.di07","board.di08","board.di09","board.di10","board.di11"};
    for (unsigned i=0U;i<11U;i++)
    { PLC_CHECK(DataManager_PublishBoolInput(&data,binds[i],(inputs&(1U<<i))!=0U,(bad&(1U<<i))!=0U?POINT_CONFIG_QUALITY_OFFLINE:POINT_CONFIG_QUALITY_GOOD,now)==DATA_MANAGER_OK); }
    PLC_CHECK(LogicManager_Step(&logic,now));
    LogicManager_ServicePersistence(&logic,now);
    PLC_CHECK(!(IO_OUT(C(),pump1_output)&&IO_OUT(C(),pump2_output)));
    PLC_CHECK(!(IO_OUT(C(),valve_open_output)&&IO_OUT(C(),valve_close_output)));
}
static void Cmd(const char *name) { PLC_CHECK(DataManager_SubmitBoolCommand(&data,name,true)==DATA_MANAGER_OK); }
static void Fresh(void)
{
    EepromTransportFake_Reset(); DataManager_Init(&data); PLC_CHECK(LogicManager_Init(&logic,&data));
    Scan(0U,BASE,0U); Scan(10U,BASE,0U);
    uint32_t rev=DataManager_GetParameterRevision(&data);
    const char *names[]={"parameter.pump_start_timeout_ms","parameter.pump_stop_timeout_ms","parameter.valve_travel_timeout_ms","parameter.switch_delay_ms"};
    const uint32_t values[]={5000U,5000U,8000U,2000U};
    for (unsigned i=0;i<4;i++) { PLC_CHECK(DataManager_WriteParameterU32(&data,names[i],values[i],rev,&rev)==DATA_MANAGER_OK); }
}
static void StartWet(void)
{ Fresh(); Cmd("command.system_start"); Scan(2000U,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump1_output)); Scan(2100U,BASE|1U|16U,0U); PLC_CHECK(C()->state.pump1_status==2U); }
static void AllOff(void)
{ PLC_CHECK(!IO_OUT(C(),pump1_output)&&!IO_OUT(C(),pump2_output)&&!IO_OUT(C(),valve_open_output)&&!IO_OUT(C(),valve_close_output)); }
int main(void)
{
    /* PLC_TEST: NORMAL_PATH */
    PLC_BEGIN("NORMAL_PATH"); Fresh(); Cmd("command.system_start"); Scan(20U,BASE,0U);
    PLC_CHECK(IO_OUT(C(),valve_open_output)); PLC_CHECK(!IO_OUT(C(),pump1_output));
    Scan(2020U,(BASE&~512U)|256U|1U,0U); PLC_CHECK(IO_OUT(C(),pump1_output));
    Scan(2120U,(BASE&~512U)|256U|1U|16U,0U); PLC_CHECK(C()->state.pump1_status==2U);
    Scan(2130U,(BASE&~512U)|256U|3U|16U,0U); PLC_CHECK(!IO_OUT(C(),valve_close_output));
    Scan(4020U,(BASE&~512U)|256U|3U|16U,0U); PLC_CHECK(IO_OUT(C(),valve_close_output)); PLC_END();
    /* PLC_TEST: BAD_QUALITY */
    PLC_BEGIN("BAD_QUALITY"); for(unsigned i=0;i<11;i++) { StartWet(); Scan(2200U,BASE|1U|16U,1U<<i); AllOff(); PLC_CHECK(!C()->state.automatic); } PLC_END();
    /* PLC_TEST: COMMAND_CONFLICT */
    PLC_BEGIN("COMMAND_CONFLICT"); Fresh(); Cmd("command.system_start"); Cmd("command.system_stop"); Scan(2000U,BASE|1U,0U); AllOff(); PLC_CHECK(!C()->state.automatic); PLC_END();
    /* PLC_TEST: STOP_SAFE */
    PLC_BEGIN("STOP_SAFE"); StartWet(); Cmd("command.system_trip"); Scan(2200U,BASE|1U|16U,0U); AllOff();
    Scan(2300U,BASE|1U,0U); AllOff(); Cmd("command.system_start"); Cmd("command.system_trip"); Scan(2400U,BASE|1U,0U); AllOff(); PLC_END();
    /* PLC_TEST: RESET_FAULTS */
    PLC_BEGIN("RESET_FAULTS"); StartWet(); Scan(2200U,BASE|1U|16U|32U,0U); PLC_CHECK(C()->state.pump1_fault_latched);
    Cmd("command.pump1_reset_faults"); Scan(2300U,BASE|1U|16U|32U,0U); PLC_CHECK(C()->state.pump1_fault_latched);
    Cmd("command.pump1_reset_faults"); Scan(2400U,BASE|1U,0U); PLC_CHECK(!C()->state.pump1_fault_latched); PLC_CHECK(!IO_OUT(C(),pump1_output)); PLC_END();
    /* PLC_TEST: TIME_BOUNDARY */
    PLC_BEGIN("TIME_BOUNDARY"); StartWet(); Scan(2200U,BASE|1U|16U|32U,0U); Scan(4199U,BASE|1U,0U); PLC_CHECK(!IO_OUT(C(),pump2_output));
    Scan(4200U,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump2_output)); Scan(9200U,BASE|1U|64U,0U); PLC_CHECK(!C()->state.pump2_fault_latched);
    StartWet(); Scan(2200U,BASE|1U|32U,0U); Scan(4200U,BASE|1U,0U); Scan(9201U,BASE|1U|64U,0U); PLC_CHECK(C()->state.pump2_fault_latched); PLC_END();
    /* PLC_TEST: TICK_WRAP */
    PLC_BEGIN("TICK_WRAP"); Fresh(); Cmd("command.system_start"); Scan(UINT32_MAX-1000U,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump1_output));
    Scan(3998U,BASE|1U,0U); PLC_CHECK(!C()->state.pump1_fault_latched); Scan(3999U,BASE|1U,0U); PLC_CHECK(C()->state.pump1_fault_latched); PLC_END();
    /* PLC_TEST: POINT_MAPPING */
    PLC_BEGIN("POINT_MAPPING"); StartWet(); PLC_CHECK(IO_OUT(C(),pump1_output)); PLC_CHECK(!IO_OUT(C(),pump2_output));
    Scan(2200U,BASE|1U|16U|32U,0U); Scan(4200U,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump2_output)); PLC_CHECK(!IO_OUT(C(),pump1_output)); PLC_END();
    /* PLC_TEST: RECOVERY_NO_START */
    PLC_BEGIN("RECOVERY_NO_START"); StartWet(); Scan(2200U,(BASE|1U)&~1024U,0U); AllOff(); Cmd("command.system_start"); Scan(2300U,BASE|1U,0U); AllOff();
    Scan(2400U,BASE|1U,0U); AllOff(); Cmd("command.system_start"); Scan(4300U,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump1_output)); PLC_END();
    /* PLC_TEST: DEMAND_PRIORITY */
    PLC_BEGIN("DEMAND_PRIORITY"); StartWet(); Scan(2200U,(BASE|1U|16U)&~8U,0U); PLC_CHECK(!IO_OUT(C(),pump1_output));
    Cmd("command.system_start"); Cmd("command.system_stop"); Scan(2300U,BASE|1U,0U); PLC_CHECK(!C()->state.automatic); PLC_END();
    /* PLC_TEST: PARAMETER_UPDATE */
    PLC_BEGIN("PARAMETER_UPDATE"); StartWet(); uint32_t rev=DataManager_GetParameterRevision(&data),next;
    PLC_CHECK(DataManager_WriteParameterU32(&data,"parameter.pump_start_timeout_ms",1000U,rev,&next)==DATA_MANAGER_OK);
    PLC_CHECK(DataManager_WriteParameterU32(&data,"parameter.pump_start_timeout_ms",2000U,rev,&next)==DATA_MANAGER_REVISION_CONFLICT);
    PLC_CHECK(C()->state.cycle_pump_start_timeout_ms==5000U); Cmd("command.system_trip"); Scan(2200U,BASE|1U,0U);
    Cmd("command.system_start"); Scan(4300U,BASE|1U,0U); PLC_CHECK(C()->state.cycle_pump_start_timeout_ms==1000U); PLC_END();
    /* PLC_TEST: COMMUNICATION_LOSS */
    PLC_BEGIN("COMMUNICATION_LOSS"); StartWet(); /* No HMI commands; local demand and permit still govern. */
    Scan(2200U,BASE|1U|16U,0U); PLC_CHECK(IO_OUT(C(),pump1_output)); Scan(2300U,BASE&~1024U,0U); AllOff(); PLC_END();
    /* PLC_TEST: RUNTIME_PERSISTENCE */
    PLC_BEGIN("RUNTIME_PERSISTENCE"); StartWet(); Scan(4100U,BASE|1U|16U,0U);
    uint32_t seconds=0; PointConfigQuality quality; PLC_CHECK(DataManager_ReadU32(&data,"runtime.pump1.seconds",&seconds,&quality)==DATA_MANAGER_OK); PLC_CHECK(seconds>=2U);
    Cmd("command.system_stop"); Scan(4200U,BASE|1U,0U);
    for(unsigned i=0;i<60;i++){ Scan(4210U+i*10U,BASE|1U,0U); }
    DataManager_Init(&data); PLC_CHECK(LogicManager_Init(&logic,&data)); Scan(0U,BASE|1U,0U);
    uint32_t restored=0; PLC_CHECK(DataManager_ReadU32(&data,"runtime.pump1.seconds",&restored,&quality)==DATA_MANAGER_OK); PLC_CHECK(restored==seconds); AllOff(); PLC_END();
    /* PLC_TEST: NEGATIVE_SWITCH_WINDOW */
    PLC_BEGIN("NEGATIVE_SWITCH_WINDOW"); StartWet(); Scan(2200U,BASE|1U|16U|32U,0U);
    Scan(4200U,BASE|1U|16U,0U); PLC_CHECK(!IO_OUT(C(),pump2_output)); Scan(4300U,BASE|1U,0U); PLC_CHECK(IO_OUT(C(),pump2_output)); PLC_END();
    /* PLC_TEST: FEEDBACK_FAILURE */
    PLC_BEGIN("FEEDBACK_FAILURE"); StartWet(); Scan(2200U,BASE|1U,0U); PLC_CHECK(C()->state.pump1_fault_code==3U); PLC_CHECK(!IO_OUT(C(),pump1_output));
    Scan(7200U,BASE|1U|16U,0U); PLC_CHECK(C()->state.pump1_fault_latched); PLC_CHECK(!IO_OUT(C(),pump2_output)); PLC_END();
    /* PLC_TEST: DEVICE_RESET_OWNERSHIP */
    PLC_BEGIN("DEVICE_RESET_OWNERSHIP"); StartWet(); Scan(2200U,BASE|1U|32U|128U,0U);
    Cmd("command.pump1_reset_faults"); Scan(2300U,BASE|1U,0U); PLC_CHECK(!C()->state.pump1_fault_latched); PLC_CHECK(C()->state.pump2_fault_latched); PLC_END();
    /* PLC_TEST: DEVICE_RESET_ISOLATION */
    PLC_BEGIN("DEVICE_RESET_ISOLATION"); StartWet(); Cmd("command.pump2_reset_faults"); Scan(2150U,BASE|1U|16U,0U); PLC_CHECK(IO_OUT(C(),pump1_output)); PLC_CHECK(C()->state.pump1_status==2U); Scan(2200U,BASE|1U|32U,0U); Cmd("command.pump2_reset_faults");
    Scan(2300U,BASE|1U,0U); PLC_CHECK(C()->state.pump1_fault_latched); PLC_CHECK(!C()->state.pump2_fault_latched); PLC_END();
    /* PLC_TEST: FAULT_LATCH_LIFECYCLE */
    PLC_BEGIN("FAULT_LATCH_LIFECYCLE"); StartWet(); Scan(2200U,BASE|1U|32U,0U); Scan(2300U,BASE|1U,0U);
    PLC_CHECK(C()->state.pump1_fault_latched); Cmd("command.pump1_reset_faults"); Scan(2400U,BASE|1U,0U); PLC_CHECK(!C()->state.pump1_fault_latched); PLC_END();
    /* PLC_TEST: FAULT_VISIBLE_COHERENCE */
    PLC_BEGIN("FAULT_VISIBLE_COHERENCE"); StartWet(); Scan(2200U,BASE|1U|32U,0U);
    bool visible=false; PLC_CHECK(DataManager_ReadBool(&data,"state.pump1_fault_latched",&visible,&quality)==DATA_MANAGER_OK); PLC_CHECK(visible&&C()->state.pump1_status==4U); PLC_CHECK(!IO_OUT(C(),pump1_output)); PLC_END();
    /* PLC_TEST: FAULT_RESET_COHERENCE */
    PLC_BEGIN("FAULT_RESET_COHERENCE"); StartWet(); Scan(2200U,BASE|1U|32U,0U); Cmd("command.pump1_reset_faults"); Scan(2300U,BASE|1U,1U<<5);
    PLC_CHECK(C()->state.pump1_fault_latched); Cmd("command.pump1_reset_faults"); Scan(2400U,BASE|1U,0U); PLC_CHECK(!C()->state.pump1_fault_latched); AllOff(); PLC_END();
    /* PLC_TEST: HMI_CONTRACT */
    PLC_BEGIN("HMI_CONTRACT"); StartWet(); PLC_CHECK(DataManager_SubmitBoolCommand(&data,"point.pump1_output",true)!=DATA_MANAGER_OK);
    Cmd("command.system_stop"); Scan(2200U,BASE|1U,0U); PLC_CHECK(!C()->state.automatic); PLC_CHECK(g_point_config.north_field_count>=40U); PLC_END();
    /* PLC_TEST: VALVE_REVERSE */
    PLC_BEGIN("VALVE_REVERSE"); Fresh(); Cmd("command.system_start"); Scan(20U,BASE,0U); PLC_CHECK(IO_OUT(C(),valve_open_output));
    Scan(100U,(BASE&~512U)|3U,0U); AllOff(); Scan(2099U,(BASE&~512U)|3U,0U); PLC_CHECK(!IO_OUT(C(),valve_close_output));
    Scan(2100U,(BASE&~512U)|3U,0U); PLC_CHECK(IO_OUT(C(),valve_close_output)); PLC_END();
    /* PLC_TEST: VALVE_TIMEOUT */
    PLC_BEGIN("VALVE_TIMEOUT"); Fresh(); Cmd("command.system_start"); Scan(20U,BASE,0U); Scan(8020U,BASE&~512U,0U);
    PLC_CHECK(C()->state.valve_fault_latched); PLC_CHECK(!IO_OUT(C(),valve_open_output));
    Cmd("command.valve_reset_faults"); Scan(8030U,BASE|256U,0U); PLC_CHECK(C()->state.valve_fault_latched); /* contradictory limits remain */
    Cmd("command.valve_reset_faults"); Scan(8040U,BASE,0U); PLC_CHECK(!C()->state.valve_fault_latched); PLC_END();
    /* PLC_TEST: LOW_WATER */
    PLC_BEGIN("LOW_WATER"); StartWet(); Scan(2200U,BASE|16U,0U); PLC_CHECK(!IO_OUT(C(),pump1_output)); PLC_CHECK(IO_OUT(C(),valve_open_output));
    Scan(2300U,BASE&~4U,0U); PLC_CHECK(!IO_OUT(C(),valve_open_output)); PLC_CHECK(!IO_OUT(C(),pump1_output)); PLC_END();
    puts("WATER_STATION_HOST_PASS: 24 executed scenarios"); return 0;
}
