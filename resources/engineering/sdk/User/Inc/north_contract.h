#ifndef KZ3_NORTH_CONTRACT_H
#define KZ3_NORTH_CONTRACT_H

#include "logic_contract.h"

#define LOGIC_MANIFEST_NORTH_KEY_MAX_LENGTH 63U

typedef uint16_t LogicServiceOwner;
#define LOGIC_SERVICE_OWNER_NONE       0U
#define LOGIC_SERVICE_OWNER_BOARD      1U
#define LOGIC_SERVICE_OWNER_MODBUS_RTU 2U
#define LOGIC_SERVICE_OWNER_LOGIC      3U
#define LOGIC_SERVICE_OWNER_PARAMETER  4U
#define LOGIC_SERVICE_OWNER_PID        5U
#define LOGIC_SERVICE_OWNER_SYSTEM     6U

typedef uint16_t LogicNorthArea;
#define LOGIC_NORTH_AREA_COILS             1U
#define LOGIC_NORTH_AREA_DISCRETE_INPUTS   2U
#define LOGIC_NORTH_AREA_HOLDING_REGISTERS 3U
#define LOGIC_NORTH_AREA_INPUT_REGISTERS   4U

typedef struct
{
    uint16_t north_key_id;
    uint16_t key_length;
    LogicPointId point_id;
    LogicAccessPolicy access_policy;
    const char *key;
} NorthKeyDescriptor;

typedef struct
{
    LogicPointId point_id;
    uint16_t north_key_id;
    LogicValueType value_type;
    LogicAccessPolicy access_policy;
    LogicServiceOwner service_owner;
    uint16_t transaction_group_id;
    LogicNorthArea area;
    uint16_t address;
    uint16_t register_count;
} NorthRoute;

typedef LogicResult (*NorthKeyGeneratedResolveFn)(void *context,
                                                  const char *key,
                                                  uint16_t key_length,
                                                  NorthRoute *route);
typedef LogicResult (*NorthKeyGeneratedDescriptorFn)(
    void *context, uint16_t north_key_id,
    const NorthKeyDescriptor **descriptor);

/** @brief 生成器提供的唯一 North key/reference 查询表。 */
typedef struct
{
    NorthKeyGeneratedResolveFn resolve;
    NorthKeyGeneratedDescriptorFn descriptor;
    void *context;
} NorthKeyGeneratedTable;

#endif
