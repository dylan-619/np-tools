#define WATER_STATION_RUNNER
#include "logic_manager.h"
#include "identity.h"
#include "flat_json.h"
#include <stdio.h>
#include <stdint.h>

/* Plant dynamics produce independent DI feedback. Only logic.c controls DOs.
 * Level is a visual model variable; the controller consumes two discrete switches. */
static DataManager data;
static LogicManager logic;
static bool active, paused, valve_blocked, no_feedback[2], running[2];
static uint32_t scans, now, last_now, pump_elapsed[2];
static bool last_command[2];
static double level=15.0, opening;
static bool inflow, outflow;
static unsigned PlantStep(const RunnerRequest *r)
{
    const LogicContext *c=DataManager_GetSnapshot(&data);
    uint32_t dt=scans==0U?0U:r->now-last_now;
    if(dt>250U) { dt=250U; }
    last_now=r->now;
    switch(r->environment)
    {
        case 1U:level=(double)r->setting/100.0;break;
        case 2U:valve_blocked=r->setting!=0U;break;
        case 3U:no_feedback[0]=r->setting!=0U;break;
        case 4U:no_feedback[1]=r->setting!=0U;break;
        case 5U:paused=r->setting!=0U;break;
        case 6U:valve_blocked=false;no_feedback[0]=false;no_feedback[1]=false;paused=false;break;
        default:break;
    }
    bool commands[]={IO_OUT(c,pump1_output),IO_OUT(c,pump2_output)};
    if(!paused)
    {
        for(unsigned i=0U;i<2U;i++)
        {
            bool fault=(r->inputs&(1U<<(i==0U?5U:7U)))!=0U;
            if(commands[i]!=last_command[i]) { pump_elapsed[i]=0U;last_command[i]=commands[i]; }
            else { pump_elapsed[i]+=dt; }
            if(fault || no_feedback[i]) { running[i]=false; }
            else if(pump_elapsed[i]>=(commands[i]?600U:400U)) { running[i]=commands[i]; }
        }
        if(!valve_blocked)
        {
            if(IO_OUT(c,valve_open_output)) { opening+=(double)dt/20.0; }
            if(IO_OUT(c,valve_close_output)) { opening-=(double)dt/20.0; }
            if(opening>100.0) { opening=100.0; } if(opening<0.0) { opening=0.0; }
        }
        inflow=(r->inputs&4U)!=0U && opening>0.0;
        outflow=running[0]||running[1];
        level+=(inflow?9.0*opening/100.0:0.0)*(double)dt/1000.0;
        level-=(outflow?3.0:0.0)*(double)dt/1000.0;
        if(level>100.0) { level=100.0; } if(level<0.0) { level=0.0; }
    }
    unsigned inputs=r->inputs;
    if(level>=20.0) { inputs|=1U; } if(level>=80.0) { inputs|=2U; }
    if(running[0]) { inputs|=16U; } if(running[1]) { inputs|=64U; }
    if(opening>=100.0) { inputs|=256U; } if(opening<=0.0) { inputs|=512U; }
    return inputs;
}
static void Snapshot(uint32_t id, int result)
{
    printf("{\"id\":%u,\"ok\":true,\"result\":%d,\"scanSequence\":%u,\"nowMs\":%u,\"parameterRevision\":%u,\"active\":%s,\"process\":{\"tankLevelPct\":%.2f,\"valveOpeningPct\":%.1f,\"inflowActive\":%s,\"outflowActive\":%s,\"paused\":%s,\"valveBlocked\":%s,\"pump1NoFeedback\":%s,\"pump2NoFeedback\":%s},\"fields\":{",id,result,scans,now,DataManager_GetParameterRevision(&data),active?"true":"false",level,opening,inflow?"true":"false",outflow?"true":"false",paused?"true":"false",valve_blocked?"true":"false",no_feedback[0]?"true":"false",no_feedback[1]?"true":"false");
    for(unsigned i=0;i<g_point_config.north_field_count;i++)
    {
        const PointConfigNorthField *f=&g_point_config.north_fields[i];PointConfigQuality q=POINT_CONFIG_QUALITY_GOOD;
        if(i>0U) { printf(","); } printf("\"%s\":[",f->name);
        if(f->type==POINT_CONFIG_VALUE_BOOL)
        { bool v=false; if(DataManager_ReadBool(&data,f->bind,&v,&q)!=DATA_MANAGER_OK){q=POINT_CONFIG_QUALITY_OFFLINE;}printf("%s,%u]",v?"true":"false",(unsigned)q); }
        else
        { uint32_t v=0U; if(DataManager_ReadU32(&data,f->bind,&v,&q)!=DATA_MANAGER_OK){q=POINT_CONFIG_QUALITY_OFFLINE;}printf("%u,%u]",v,(unsigned)q); }
    }
    puts("}}");
}
int main(void)
{
    char line[4096];uint32_t last=0U;setvbuf(stdout,NULL,_IOLBF,0);
    DataManager_Init(&data);if(!LogicManager_Init(&logic,&data)){return 2;}
    while(fgets(line,sizeof(line),stdin)!=NULL)
    {
        RunnerRequest r;
        if(strchr(line,'\n')==NULL||!ParseRequest(line,&r)||r.id<=last)
        { puts("{\"ok\":false,\"error\":\"invalid or stale protocol request\"}");return 3; }
        last=r.id;
        if(strcmp(r.op,"hello")==0){printf("{\"id\":%u,\"ok\":true,\"protocolVersion\":1,\"identity\":%s}\n",r.id,EXPO_IDENTITY_JSON);}
        else if(strcmp(r.op,"shutdown")==0){LogicManager_Stop(&logic,now);return 0;}
        else if(strcmp(r.op,"activate")==0){if(active){return 4;}active=true;Snapshot(r.id,0);}
        else if(strcmp(r.op,"snapshot")==0){Snapshot(r.id,0);}
        else
        {
            if(!active){return 5;}now=r.now;unsigned inputs=PlantStep(&r);int result=0;
            for(unsigned i=0U;i<11U;i++)
            {
                char bind[24];snprintf(bind,sizeof(bind),"board.di%02u",i+1U);
                if(DataManager_PublishBoolInput(&data,bind,(inputs&(1U<<i))!=0U,(r.bad&(1U<<i))!=0U?POINT_CONFIG_QUALITY_OFFLINE:POINT_CONFIG_QUALITY_GOOD,now)!=DATA_MANAGER_OK){return 6;}
            }
            const char *commands[]={"command.system_start","command.system_stop","command.system_trip","command.pump1_reset_faults","command.pump2_reset_faults","command.valve_reset_faults","runtime.pump1.clear","runtime.pump2.clear"};
            for(unsigned i=0U;i<8U;i++){if((r.commands&(1U<<i))!=0U&&DataManager_SubmitBoolCommand(&data,commands[i],true)!=DATA_MANAGER_OK){result=8;}}
            if(r.parameter!=0U)
            {
                const char *params[]={"parameter.pump_start_timeout_ms","parameter.pump_stop_timeout_ms","parameter.valve_travel_timeout_ms","parameter.switch_delay_ms"};uint32_t revision;
                const LogicContext *current=DataManager_GetSnapshot(&data);
                if(current->state.automatic || current->state.valve_direction!=0U || IO_IN(current,pump1_run_fb).value || IO_IN(current,pump2_run_fb).value){result=8;}
                else{result=DataManager_WriteParameterU32(&data,params[r.parameter-1U],r.value,r.revision,&revision);}
            }
            if(!LogicManager_Step(&logic,now)){return 7;}LogicManager_ServicePersistence(&logic,now);scans++;Snapshot(r.id,result);
        }
    }
    LogicManager_Stop(&logic,now);return 0;
}
