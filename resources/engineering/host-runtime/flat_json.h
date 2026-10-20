#ifndef EXPO_FLAT_JSON_H
#define EXPO_FLAT_JSON_H
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <ctype.h>
/* The private runner protocol intentionally accepts a bounded flat object only.
 * No substrings, arrays, floats, escapes, duplicate/unknown keys or trailing bytes. */
typedef struct { char op[16]; uint32_t id, now, inputs, bad, commands, parameter, value, revision, environment, setting; } RunnerRequest;
static bool ParseRequest(const char *p, RunnerRequest *r)
{
    unsigned seen=0U;
    memset(r,0,sizeof(*r));
    while (isspace((unsigned char)*p)) { p++; }
    if (*p++!='{') { return false; }
    for (;;)
    {
        char key[20]; unsigned n=0U,bit=0U; uint32_t *target=NULL;
        while (isspace((unsigned char)*p)) { p++; }
        if (*p++!='"') { return false; }
        while (*p!='"')
        {
            if (!(isalnum((unsigned char)*p)||*p=='_') || n>=sizeof(key)-1U) { return false; }
            key[n++]=*p++;
        }
        key[n]='\0'; p++;
        while (isspace((unsigned char)*p)) { p++; }
        if (*p++!=':') { return false; }
        while (isspace((unsigned char)*p)) { p++; }
        if (strcmp(key,"op")==0) { bit=1U; }
        else if (strcmp(key,"id")==0) { bit=2U;target=&r->id; }
        else if (strcmp(key,"now")==0) { bit=4U;target=&r->now; }
        else if (strcmp(key,"inputs")==0) { bit=8U;target=&r->inputs; }
        else if (strcmp(key,"bad")==0) { bit=16U;target=&r->bad; }
        else if (strcmp(key,"commands")==0) { bit=32U;target=&r->commands; }
        else if (strcmp(key,"parameter")==0) { bit=64U;target=&r->parameter; }
        else if (strcmp(key,"value")==0) { bit=128U;target=&r->value; }
        else if (strcmp(key,"revision")==0) { bit=256U;target=&r->revision; }
        #if defined(WATER_STATION_RUNNER) || defined(THREE_PUMP_RUNNER)
        else if (strcmp(key,"environment")==0) { bit=512U;target=&r->environment; }
        else if (strcmp(key,"setting")==0) { bit=1024U;target=&r->setting; }
#endif
        else { return false; }
        if ((seen&bit)!=0U) { return false; } seen|=bit;
        if (target==NULL)
        {
            n=0U;if (*p++!='"') { return false; }
            while (*p!='"')
            {
                if (!isalpha((unsigned char)*p)||n>=sizeof(r->op)-1U) { return false; }
                r->op[n++]=*p++;
            }
            r->op[n]='\0';p++;
        }
        else
        {
            uint64_t v=0U;
            if (!isdigit((unsigned char)*p)) { return false; }
            if (*p=='0' && isdigit((unsigned char)p[1])) { return false; }
            while (isdigit((unsigned char)*p))
            { v=v*10U+(unsigned)(*p++-'0');if(v>UINT32_MAX){return false;} }
            *target=(uint32_t)v;
        }
        while (isspace((unsigned char)*p)) { p++; }
        if (*p=='}') { p++;break; }
        if (*p++!=',') { return false; }
    }
    while (isspace((unsigned char)*p)) { p++; }
    if (*p!='\0' || (seen&3U)!=3U || r->id==0U) { return false; }
    if (strcmp(r->op,"tick")==0) {
#ifdef THREE_PUMP_RUNNER
        if (seen!=2047U || (r->inputs & ~2998U)!=0U || r->bad>16383U || r->commands>1023U || r->parameter>10U || r->environment>8U) { return false; }
        if (r->environment==1U) { return r->setting<=3000U; }
        if (r->environment==2U) { return r->setting<=3U; }
        if (r->environment==3U || r->environment==4U) { return r->setting<=7U; }
        if (r->environment==8U) { return r->setting<=50000U; }
        return r->setting<=1U;
#elif defined(WATER_STATION_RUNNER)
        return seen==2047U && (r->inputs & ~1196U)==0U && r->bad<=2047U && r->commands<=255U && r->parameter<=4U && r->environment<=6U && r->setting<=10000U && (r->environment==1U || r->setting<=1U);
#else
        return seen==511U && r->inputs<=7U && r->bad<=7U && r->commands<=7U && r->parameter<=2U;
#endif
    }
    return seen==3U && (strcmp(r->op,"hello")==0||strcmp(r->op,"activate")==0||strcmp(r->op,"snapshot")==0||strcmp(r->op,"shutdown")==0);
}
#endif
