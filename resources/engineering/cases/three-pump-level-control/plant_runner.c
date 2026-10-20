#define THREE_PUMP_RUNNER
#include "logic_manager.h"
#include "identity.h"
#include "flat_json.h"
#include <math.h>
#include <stdio.h>

/* Synthetic wet well, not a second controller. Feedback responds to previous DO/AO.
 * Before the first AUTO request the rehearsal fixture holds its initial conditions. */
static DataManager data;
static LogicManager logic;
static bool active, plant_started, level_failed, frequency_failed;
static bool running[3], last_command[3];
static unsigned no_feedback, stuck, inflow_mode=1U;
static uint32_t scans, now, last_now, elapsed[3];
static float level=1.15f, frequency, frequency_limit=50.0f;
static const float inflows[]={0.0f,0.025f,0.070f,0.110f};

static int Environment(const RunnerRequest *r)
{
    const LogicContext *c=DataManager_GetSnapshot(&data);
    switch (r->environment)
    {
        case 1U:
            if (c->state.automatic || running[0] || running[1] || running[2]) { return 8; }
            level=(float)r->setting/1000.0f; break;
        case 2U: inflow_mode=r->setting; break;
        case 3U: no_feedback=r->setting; break;
        case 4U: stuck=r->setting; break;
        case 5U: level_failed=r->setting!=0U; break;
        case 6U: frequency_failed=r->setting!=0U; break;
        case 7U:
            no_feedback=0U; stuck=0U; level_failed=false; frequency_failed=false;
            frequency_limit=50.0f; inflow_mode=1U; break;
        case 8U: frequency_limit=(float)r->setting/1000.0f; break;
        default: break;
    }
    return 0;
}
static unsigned PlantStep(const RunnerRequest *r)
{
    const LogicContext *c=DataManager_GetSnapshot(&data);
    uint32_t dt=scans==0U?0U:r->now-last_now;
    if (dt>250U) { dt=250U; }
    last_now=r->now;
    if ((r->commands&9U)!=0U) { plant_started=true; }
    bool command[]={IO_OUT(c,pump1_output),IO_OUT(c,pump2_output),IO_OUT(c,pump3_output)};
    for (unsigned i=0U;i<3U;i++)
    {
        if (command[i]!=last_command[i]) { elapsed[i]=0U; last_command[i]=command[i]; }
        else { elapsed[i]+=dt; }
        bool fault=(r->inputs&(1U<<(i*3U+1U)))!=0U;
        if ((stuck&(1U<<i))!=0U) { running[i]=true; }
        else if (fault || (no_feedback&(1U<<i))!=0U) { running[i]=false; }
        else if (elapsed[i]>=(command[i]?600U:400U)) { running[i]=command[i]; }
    }
    float requested=running[0]?fmaxf(0.0f,(IO_OUT(c,speed_output)-4.0f)*50.0f/16.0f):0.0f;
    requested=fminf(requested,frequency_limit);
    float step=15.0f*(float)dt/1000.0f;
    frequency+=fmaxf(-step,fminf(step,requested-frequency));
    float drain=running[0]?fmaxf(0.0f,(frequency-16.666667f)*0.0015f):0.0f;
    drain+=(running[1]?0.040f:0.0f)+(running[2]?0.040f:0.0f);
    if (plant_started)
    { level=fmaxf(0.0f,fminf(3.0f,level+(inflows[inflow_mode]-drain)/0.8f*(float)dt/1000.0f)); }
    unsigned bits=r->inputs;
    for (unsigned i=0U;i<3U;i++) { if (running[i]) { bits|=1U<<(i*3U); } }
    if (level>=2.4f) { bits|=1024U; }
    return bits;
}
static void Snapshot(uint32_t id, int result)
{
    printf("{\"id\":%u,\"ok\":true,\"result\":%d,\"scanSequence\":%u,\"nowMs\":%u,\"parameterRevision\":%u,\"active\":%s,\"process\":{\"tankLevelPct\":%.3f,\"levelM\":%.4f,\"frequencyHz\":%.4f,\"inflowMode\":%u,\"inflowM3s\":%.4f,\"plantStarted\":%s,\"levelFailed\":%s,\"frequencyFailed\":%s},\"fields\":{",id,result,scans,now,DataManager_GetParameterRevision(&data),active?"true":"false",(double)(level/3.0f*100.0f),(double)level,(double)frequency,inflow_mode,(double)inflows[inflow_mode],plant_started?"true":"false",level_failed?"true":"false",frequency_failed?"true":"false");
    for (unsigned i=0U;i<g_point_config.north_field_count;i++)
    {
        const PointConfigNorthField *f=&g_point_config.north_fields[i]; PointConfigQuality q=POINT_CONFIG_QUALITY_GOOD;
        if (i>0U) { putchar(','); } printf("\"%s\":[",f->name);
        if (f->type==POINT_CONFIG_VALUE_BOOL)
        { bool value=false; if(DataManager_ReadBool(&data,f->bind,&value,&q)!=DATA_MANAGER_OK){q=POINT_CONFIG_QUALITY_OFFLINE;} printf("%s,%u]",value?"true":"false",(unsigned)q); }
        else if (f->type==POINT_CONFIG_VALUE_F32)
        { float value=0.0f; if(DataManager_ReadF32(&data,f->bind,&value,&q)!=DATA_MANAGER_OK || !isfinite(value)){q=POINT_CONFIG_QUALITY_OFFLINE;value=0.0f;} printf("%.6f,%u]",(double)value,(unsigned)q); }
        else
        { uint32_t value=0U; if(DataManager_ReadU32(&data,f->bind,&value,&q)!=DATA_MANAGER_OK){q=POINT_CONFIG_QUALITY_OFFLINE;} printf("%u,%u]",value,(unsigned)q); }
    }
    puts("}}");
}
static int Parameters(const RunnerRequest *r)
{
    if (r->parameter==0U) { return 0; }
    const LogicContext *c=DataManager_GetSnapshot(&data);
    if (c->state.automatic || running[0] || running[1] || running[2] ||
        IO_OUT(c,pump1_output) || IO_OUT(c,pump2_output) || IO_OUT(c,pump3_output)) { return 8; }
    const char *names[]={"parameter.stop_level_m","parameter.target_level_m","parameter.vfd_start_level_m","parameter.assist_start_level_m","parameter.pid_kp","parameter.pid_ki","parameter.start_confirm_ms","parameter.stage_confirm_ms","parameter.pump_start_timeout_ms","parameter.pump_stop_timeout_ms"};
    uint32_t revision;
    /* Private wire uses integer milli-units for finite float parameters. */
    if (r->parameter<=6U)
    { return DataManager_WriteParameterF32(&data,names[r->parameter-1U],(float)r->value/1000.0f,r->revision,&revision); }
    return DataManager_WriteParameterU32(&data,names[r->parameter-1U],r->value,r->revision,&revision);
}
int main(void)
{
    char line[4096]; uint32_t last=0U; setvbuf(stdout,NULL,_IOLBF,0);
    DataManager_Init(&data); if (!LogicManager_Init(&logic,&data)) { return 2; }
    while (fgets(line,sizeof(line),stdin)!=NULL)
    {
        RunnerRequest r;
        if (strchr(line,'\n')==NULL || !ParseRequest(line,&r) || r.id<=last)
        { puts("{\"ok\":false,\"error\":\"invalid or stale protocol request\"}"); return 3; }
        last=r.id;
        if (strcmp(r.op,"hello")==0) { printf("{\"id\":%u,\"ok\":true,\"protocolVersion\":1,\"identity\":%s}\n",r.id,EXPO_IDENTITY_JSON); }
        else if (strcmp(r.op,"shutdown")==0) { LogicManager_Stop(&logic,now); return 0; }
        else if (strcmp(r.op,"activate")==0) { if(active){return 4;} active=true; Snapshot(r.id,0); }
        else if (strcmp(r.op,"snapshot")==0) { Snapshot(r.id,0); }
        else
        {
            if (!active) { return 5; }
            now=r.now; int result=Environment(&r); unsigned bits=PlantStep(&r);
            for (unsigned i=0U;i<12U;i++)
            {
                char bind[24]; snprintf(bind,sizeof(bind),"board.di%02u",i+1U);
                if (DataManager_PublishBoolInput(&data,bind,(bits&(1U<<i))!=0U,(r.bad&(1U<<i))!=0U?POINT_CONFIG_QUALITY_OFFLINE:POINT_CONFIG_QUALITY_GOOD,now)!=DATA_MANAGER_OK) { return 6; }
            }
            if (DataManager_PublishF32Input(&data,"board.ai01",4.0f+level*16.0f/3.0f,level_failed || (r.bad&4096U)!=0U?POINT_CONFIG_QUALITY_OFFLINE:POINT_CONFIG_QUALITY_GOOD,now)!=DATA_MANAGER_OK) { return 6; }
            if (DataManager_PublishF32Input(&data,"board.ai02",4.0f+frequency*16.0f/50.0f,frequency_failed || (r.bad&8192U)!=0U?POINT_CONFIG_QUALITY_OFFLINE:POINT_CONFIG_QUALITY_GOOD,now)!=DATA_MANAGER_OK) { return 6; }
            const char *commands[]={"command.system_start","command.system_stop","command.system_trip","command.degraded_start","command.pump1_reset_faults","command.pump2_reset_faults","command.pump3_reset_faults","runtime.pump1.clear","runtime.pump2.clear","runtime.pump3.clear"};
            for (unsigned i=0U;i<10U;i++)
            { if ((r.commands&(1U<<i))!=0U && DataManager_SubmitBoolCommand(&data,commands[i],true)!=DATA_MANAGER_OK) { result=8; } }
            if (result==0) { result=Parameters(&r); }
            if (!LogicManager_Step(&logic,now)) { return 7; }
            LogicManager_ServicePersistence(&logic,now); scans++; Snapshot(r.id,result);
        }
    }
    LogicManager_Stop(&logic,now); return 0;
}
