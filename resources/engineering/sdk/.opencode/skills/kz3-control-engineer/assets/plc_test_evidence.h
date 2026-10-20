#ifndef PLC_TEST_EVIDENCE_H
#define PLC_TEST_EVIDENCE_H

/* 主机测试专用；不进入目标固件。由验证器强制包含。 */
#include <stdio.h>
#include <stdlib.h>
#include "logic_manager.h"

static const char *plc_evidence_scenario;
static unsigned long plc_evidence_assertions;
static unsigned long plc_evidence_scans;
static bool plc_evidence_exit_registered;

static inline void PlcEvidence_AtExit(void)
{
    if (plc_evidence_scenario != NULL)
    {
        fprintf(stderr, "PLC scenario unfinished: %s\n", plc_evidence_scenario);
        _Exit(101);
    }
}

static inline void PlcEvidence_Begin(const char *id)
{
    if (plc_evidence_scenario != NULL) { abort(); }
    if (!plc_evidence_exit_registered)
    {
        if (atexit(PlcEvidence_AtExit) != 0) { abort(); }
        plc_evidence_exit_registered = true;
    }
    plc_evidence_scenario = id;
    plc_evidence_assertions = 0;
    plc_evidence_scans = 0;
}

static inline bool PlcEvidence_Step(LogicManager *manager, uint32_t now_ms)
{
    bool result = LogicManager_Step(manager, now_ms);
    if (plc_evidence_scenario != NULL && result) { ++plc_evidence_scans; }
    return result;
}

static inline void PlcEvidence_Check(bool condition, const char *expression, int line)
{
    if (plc_evidence_scenario == NULL || !condition)
    {
        fprintf(stderr, "PLC assertion failed at %d: %s\n", line, expression);
        exit(100);
    }
    ++plc_evidence_assertions;
}

static inline void PlcEvidence_End(void)
{
    const char *path = getenv("KZ3_PLC_EVIDENCE_FILE");
    if (path == NULL || plc_evidence_scenario == NULL ||
        plc_evidence_assertions == 0 || plc_evidence_scans == 0) { abort(); }
    FILE *file = fopen(path, "a");
    if (file == NULL) { abort(); }
    fprintf(file, "%s %lu %lu\n", plc_evidence_scenario,
            plc_evidence_assertions, plc_evidence_scans);
    if (fclose(file) != 0) { abort(); }
    plc_evidence_scenario = NULL;
}

#define PLC_BEGIN(id) PlcEvidence_Begin(id)
#define PLC_CHECK(condition) PlcEvidence_Check((condition), #condition, __LINE__)
#define PLC_END() PlcEvidence_End()
#define LogicManager_Step(manager, now_ms) PlcEvidence_Step((manager), (now_ms))
#endif
