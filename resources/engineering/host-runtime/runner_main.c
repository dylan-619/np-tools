#include "logic_manager.h"
#include "identity.h"
#include "flat_json.h"
#include <stdio.h>
#include <stdint.h>

static DataManager data;
static LogicManager logic;
static bool active;
static uint32_t scans;
static uint32_t now;
static void Snapshot(uint32_t id, int result)
{
    LogicContext c;
    if (DataManager_CopySnapshot(&data,&c)!=DATA_MANAGER_OK) { memset(&c,0,sizeof(c)); }
    printf("{\"id\":%u,\"ok\":true,\"result\":%d,\"scanSequence\":%u,\"nowMs\":%u,\"parameterRevision\":%u,\"active\":%s,\"fields\":{",id,result,scans,now,DataManager_GetParameterRevision(&data),active?"true":"false");
    for (unsigned i=0U;i<g_point_config.north_field_count;i++)
    {
        const PointConfigNorthField *f=&g_point_config.north_fields[i];
        PointConfigQuality q=POINT_CONFIG_QUALITY_GOOD;
        if (i>0U) { printf(","); }
        printf("\"%s\":[",f->name);
        if (f->type==POINT_CONFIG_VALUE_BOOL)
        {
            bool v=false;
            if (DataManager_ReadBool(&data,f->bind,&v,&q)!=DATA_MANAGER_OK) { q=POINT_CONFIG_QUALITY_OFFLINE; }
            printf("%s,%u]",v?"true":"false",(unsigned)q);
        }
        else
        {
            uint32_t v=0U;
            if (DataManager_ReadU32(&data,f->bind,&v,&q)!=DATA_MANAGER_OK) { q=POINT_CONFIG_QUALITY_OFFLINE; }
            printf("%u,%u]",v,(unsigned)q);
        }
    }
    puts("}}");
}
int main(void)
{
    char line[4096]; uint32_t last=0U;
    setvbuf(stdout,NULL,_IOLBF,0);
    DataManager_Init(&data);
    if (!LogicManager_Init(&logic,&data)) { return 2; }
    while (fgets(line,sizeof(line),stdin)!=NULL)
    {
        RunnerRequest r;
        if (strchr(line,'\n')==NULL||!ParseRequest(line,&r)||r.id<=last)
        { puts("{\"ok\":false,\"error\":\"invalid or stale protocol request\"}");return 3; }
        last=r.id;
        if (strcmp(r.op,"hello")==0)
        {
            printf("{\"id\":%u,\"ok\":true,\"protocolVersion\":1,\"identity\":%s}\n",r.id,EXPO_IDENTITY_JSON);
        }
        else if(strcmp(r.op,"shutdown")==0) { LogicManager_Stop(&logic,now);return 0; }
        else if(strcmp(r.op,"activate")==0)
        { if(active){return 4;} active=true;Snapshot(r.id,0); }
        else if(strcmp(r.op,"snapshot")==0) { Snapshot(r.id,0); }
        else
        {
            if(!active) { return 5; }
            const char *binds[]={"board.di01","board.di02","board.di03"};
            const char *commands[]={"command.line_start","command.line_stop","command.line_protect_stop"};
            int result=0;
            now=r.now;
            for(unsigned i=0U;i<3U;i++)
            {
                if(DataManager_PublishBoolInput(&data,binds[i],(r.inputs&(1U<<i))!=0U,
                    (r.bad&(1U<<i))!=0U?POINT_CONFIG_QUALITY_OFFLINE:POINT_CONFIG_QUALITY_GOOD,now)!=DATA_MANAGER_OK){return 6;}
                if((r.commands&(1U<<i))!=0U && DataManager_SubmitBoolCommand(&data,commands[i],true)!=DATA_MANAGER_OK){result=8;}
            }
            if(r.parameter!=0U)
            {
                uint32_t revision;
                const LogicContext *c=DataManager_GetSnapshot(&data);
                if(c->state.phase!=0U) { result=8; }
                else { result=(int)DataManager_WriteParameterU32(&data,r.parameter==1U?"parameter.start_delay_ms":"parameter.clear_delay_ms",r.value,r.revision,&revision); }
            }
            if(!LogicManager_Step(&logic,now)) { return 7; }
            scans++; Snapshot(r.id,result);
        }
    }
    LogicManager_Stop(&logic,now);
    return 0;
}
