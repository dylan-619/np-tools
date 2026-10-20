#include "logic_manager.h"
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#ifndef PLC_BEGIN
#define PLC_BEGIN(id) ((void)(id))
#define PLC_END() ((void)0)
#define PLC_CHECK(x) do { if (!(x)) { fprintf(stderr,"assertion %d: %s\n",__LINE__,#x); exit(1); } } while (0)
#endif
/* Given a fixed host case, When actual LogicManager scans receive inputs/commands,
 * Then outputs, priorities and timing are asserted below. No physical feedback is claimed. */
static DataManager data;
static LogicManager logic;
static uint32_t tick;
static void Scan(uint32_t now, unsigned inputs, unsigned bad)
{
    const char *binds[] = {"board.di01", "board.di02", "board.di03"};
    unsigned i;
    tick = now;
    for (i = 0U; i < 3U; i++)
    {
        PLC_CHECK(DataManager_PublishBoolInput(&data, binds[i], (inputs & (1U << i)) != 0U,
            (bad & (1U << i)) != 0U ? POINT_CONFIG_QUALITY_OFFLINE : POINT_CONFIG_QUALITY_GOOD, now) == DATA_MANAGER_OK);
    }
    PLC_CHECK(LogicManager_Step(&logic, now));
    const LogicContext *c = DataManager_GetSnapshot(&data);
    PLC_CHECK(!IO_OUT(c, upstream_output) || IO_OUT(c, downstream_output));
}
static void Fresh(void)
{
    DataManager_Init(&data);
    PLC_CHECK(LogicManager_Init(&logic, &data));
    Scan(0U, 0U, 0U);
    Scan(10U, 4U, 0U);
    uint32_t revision;
    PLC_CHECK(DataManager_WriteParameterU32(&data,"parameter.start_delay_ms",2000U,DataManager_GetParameterRevision(&data),&revision)==DATA_MANAGER_OK);
    PLC_CHECK(DataManager_WriteParameterU32(&data,"parameter.clear_delay_ms",5000U,revision,&revision)==DATA_MANAGER_OK);
}
static uint32_t Phase(void) { return DataManager_GetSnapshot(&data)->state.phase; }
static void Cmd(const char *name) { PLC_CHECK(DataManager_SubmitBoolCommand(&data, name, true) == DATA_MANAGER_OK); }
int main(void)
{
    /* PLC_TEST: TIME_BOUNDARY */
    PLC_BEGIN("TIME_BOUNDARY"); DataManager_Init(&data); PLC_CHECK(LogicManager_Init(&logic,&data));
    Scan(0U,0U,0U); Scan(10U,4U,0U); Cmd("command.line_start"); Scan(20U,4U,0U);
    uint32_t duration=g_point_config_default_parameters.start_delay_ms;
    PLC_CHECK(DataManager_GetSnapshot(&data)->param.start_delay_ms==duration);
    Scan(20U+duration-1U,4U,0U); PLC_CHECK(Phase()==1U); Scan(20U+duration,4U,0U); PLC_CHECK(Phase()==2U); PLC_END();
    /* PLC_TEST: NORMAL_PATH */
    PLC_BEGIN("NORMAL_PATH"); Fresh(); Scan(20U, 5U, 0U); PLC_CHECK(Phase()==1U);
    Scan(2019U, 4U, 0U); PLC_CHECK(Phase()==1U);
    Scan(2020U, 4U, 0U); PLC_CHECK(Phase()==2U);
    Scan(2030U, 6U, 0U); PLC_CHECK(Phase()==3U);
    Scan(7029U, 6U, 0U); PLC_CHECK(Phase()==3U);
    Scan(7030U, 4U, 0U); PLC_CHECK(Phase()==0U); PLC_END();
    /* PLC_TEST: BAD_QUALITY */
    PLC_BEGIN("BAD_QUALITY"); Fresh(); Cmd("command.line_start"); Scan(20U,4U,0U);
    Scan(30U,4U,1U); PLC_CHECK(Phase()==4U);
    Cmd("command.line_start"); Scan(40U,4U,0U); PLC_CHECK(Phase()==0U);
    Scan(50U,4U,0U); PLC_CHECK(Phase()==0U); PLC_END();
    /* PLC_TEST: COMMAND_CONFLICT */
    PLC_BEGIN("COMMAND_CONFLICT"); Fresh(); Cmd("command.line_start"); Cmd("command.line_stop");
    Scan(20U,4U,0U); PLC_CHECK(Phase()==0U); PLC_END();
    /* PLC_TEST: STOP_SAFE */
    PLC_BEGIN("STOP_SAFE"); Fresh(); Scan(20U,5U,0U); Scan(30U,6U,0U); PLC_CHECK(Phase()==0U);
    Scan(5000U,4U,0U); PLC_CHECK(Phase()==0U);
    Cmd("command.line_start"); Scan(5010U,4U,0U); Cmd("command.line_protect_stop");
    Scan(7010U,4U,0U); PLC_CHECK(Phase()==0U); PLC_END();
    /* PLC_TEST: RESET_FAULTS */
    PLC_BEGIN("RESET_FAULTS"); Fresh(); Cmd("command.line_start"); Scan(20U,4U,0U);
    Scan(30U,1U,0U); PLC_CHECK(Phase()==4U);
    Scan(40U,5U,0U); PLC_CHECK(Phase()==0U); Scan(50U,5U,0U); PLC_CHECK(Phase()==0U);
    Scan(60U,4U,0U); Scan(70U,5U,0U); PLC_CHECK(Phase()==1U); PLC_END();
    /* PLC_TEST: PARAMETER_SNAPSHOT */
    PLC_BEGIN("PARAMETER_SNAPSHOT"); Fresh(); Cmd("command.line_start"); Scan(20U,4U,0U);
    uint32_t next; PLC_CHECK(DataManager_WriteParameterU32(&data,"parameter.start_delay_ms",3000U,DataManager_GetParameterRevision(&data),&next)==DATA_MANAGER_OK);
    Scan(2020U,4U,0U); PLC_CHECK(Phase()==2U);
    PLC_CHECK(DataManager_WriteParameterU32(&data,"parameter.start_delay_ms",999U,next,&next)!=DATA_MANAGER_OK);
    Scan(2030U,6U,0U); Cmd("command.line_start"); Scan(2040U,4U,0U);
    Scan(7030U,4U,0U); PLC_CHECK(Phase()==0U); Scan(7040U,4U,0U); PLC_CHECK(Phase()==0U);
    Cmd("command.line_start"); Scan(7050U,4U,0U); Scan(9049U,4U,0U); PLC_CHECK(Phase()==1U);
    Scan(10050U,4U,0U); PLC_CHECK(Phase()==2U); PLC_END();
    /* PLC_TEST: TICK_WRAP */
    PLC_BEGIN("TICK_WRAP"); Fresh(); Cmd("command.line_start"); Scan(UINT32_MAX-999U,4U,0U);
    Scan(999U,4U,0U); PLC_CHECK(Phase()==1U); Scan(1000U,4U,0U); PLC_CHECK(Phase()==2U); PLC_END();
    /* PLC_TEST: STARTUP_HELD */
    PLC_BEGIN("STARTUP_HELD"); DataManager_Init(&data); PLC_CHECK(LogicManager_Init(&logic,&data));
    Scan(0U,5U,0U); Scan(10U,5U,0U); PLC_CHECK(Phase()==0U);
    Scan(20U,4U,0U); Scan(30U,5U,0U); PLC_CHECK(Phase()==1U); PLC_END();
    /* PLC_TEST: POINT_MAPPING */
    PLC_BEGIN("POINT_MAPPING"); Fresh(); Scan(20U,5U,0U);
    PLC_CHECK(IO_OUT(DataManager_GetSnapshot(&data),downstream_output));
    PLC_CHECK(!IO_OUT(DataManager_GetSnapshot(&data),upstream_output));
    Scan(30U,6U,0U); PLC_CHECK(Phase()==0U); Scan(40U,0U,0U); PLC_CHECK(Phase()==4U); PLC_END();
    /* PLC_TEST: RECOVERY_NO_START */
    PLC_BEGIN("RECOVERY_NO_START"); Fresh(); Cmd("command.line_start"); Scan(20U,4U,0U);
    Scan(30U,0U,0U); Cmd("command.line_start"); Scan(40U,4U,0U); PLC_CHECK(Phase()==0U);
    Scan(50U,4U,0U); PLC_CHECK(Phase()==0U); PLC_END();
    /* PLC_TEST: DEMAND_PRIORITY */
    PLC_BEGIN("DEMAND_PRIORITY"); Fresh(); Cmd("command.line_start"); Scan(20U,4U,0U);
    Cmd("command.line_start"); Cmd("command.line_protect_stop"); Scan(2020U,4U,0U); PLC_CHECK(Phase()==0U); PLC_END();
    /* PLC_TEST: PARAMETER_UPDATE */
    PLC_BEGIN("PARAMETER_UPDATE"); Fresh(); uint32_t old=DataManager_GetParameterRevision(&data);
    PLC_CHECK(DataManager_WriteParameterU32(&data,"parameter.clear_delay_ms",4000U,old,&next)==DATA_MANAGER_OK);
    PLC_CHECK(DataManager_WriteParameterU32(&data,"parameter.clear_delay_ms",3000U,old,&next)==DATA_MANAGER_REVISION_CONFLICT);
    Cmd("command.line_start"); Scan(20U,4U,0U); Scan(2020U,4U,0U); Scan(2030U,6U,0U); Scan(6030U,4U,0U); PLC_CHECK(Phase()==0U); PLC_END();
    /* PLC_TEST: COMMUNICATION_LOSS */
    PLC_BEGIN("COMMUNICATION_LOSS"); Fresh(); Cmd("command.line_start"); Scan(20U,4U,0U);
    /* No further HMI commands: local control still responds to virtual stop and never replays start. */
    Scan(2020U,4U,0U); Scan(2030U,6U,0U); Scan(7030U,4U,0U); Scan(7040U,4U,0U); PLC_CHECK(Phase()==0U); PLC_END();
    /* PLC_TEST: NEGATIVE_SWITCH_WINDOW */
    PLC_BEGIN("NEGATIVE_SWITCH_WINDOW"); Fresh(); Cmd("command.line_start"); Scan(20U,4U,0U); Scan(2020U,4U,0U);
    Cmd("command.line_stop"); Scan(2030U,4U,0U); Cmd("command.line_start"); Scan(2040U,4U,0U);
    Scan(7030U,4U,0U); PLC_CHECK(Phase()==0U); Scan(7040U,4U,0U); PLC_CHECK(Phase()==0U); PLC_END();
    printf("EXPO_HOST_PASS: 15 executed scenarios; last tick=%u\n",tick);
    return 0;
}
