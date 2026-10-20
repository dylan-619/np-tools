#ifndef KZ3_WIRELESS_EEPROM_LAYOUT_H
#define KZ3_WIRELESS_EEPROM_LAYOUT_H

#include "eeprom_transport.h"

/*
 * KZ3 新批次 AT24C16 唯一 owner 总表。
 *
 * 本布局不兼容已出货旧机，固件不得自动探测或迁移旧记录。新增 owner
 * 必须先修改本文件并通过相邻边界静态断言，禁止在业务模块散落裸地址。
 */
#define WIRELESS_EEPROM_IDENTITY_BEGIN             0U
#define WIRELESS_EEPROM_IDENTITY_END              15U
#define WIRELESS_EEPROM_DEVICE_COMMON_BEGIN       16U
#define WIRELESS_EEPROM_DEVICE_COMMON_END         31U
#define WIRELESS_EEPROM_DEBUG_BEGIN               32U
#define WIRELESS_EEPROM_DEBUG_END                 47U
#define WIRELESS_EEPROM_ETHERNET_BEGIN            48U
#define WIRELESS_EEPROM_ETHERNET_END              61U
#define WIRELESS_EEPROM_NETWORK_RESERVED_BEGIN    62U
#define WIRELESS_EEPROM_NETWORK_RESERVED_END      63U
#define WIRELESS_EEPROM_SLE_BEGIN                 64U
#define WIRELESS_EEPROM_SLE_END                   95U
#define WIRELESS_EEPROM_COMMON_BEGIN              96U
#define WIRELESS_EEPROM_COMMON_END               127U
#define WIRELESS_EEPROM_CAT1_BEGIN               128U
#define WIRELESS_EEPROM_CAT1_END                 383U
#define WIRELESS_EEPROM_EDGE_TCP_BEGIN           384U
#define WIRELESS_EEPROM_EDGE_TCP_END             399U
#define WIRELESS_EEPROM_COMM_RESERVED_BEGIN      400U
#define WIRELESS_EEPROM_COMM_RESERVED_END        511U
#define WIRELESS_EEPROM_SYSTEM_LIFETIME_BEGIN    512U
#define WIRELESS_EEPROM_SYSTEM_LIFETIME_END      527U
#define WIRELESS_EEPROM_LOGIC_RUNTIME_BEGIN      528U
#define WIRELESS_EEPROM_LOGIC_RUNTIME_END        783U
#define WIRELESS_EEPROM_LOGIC_PARAMETER_BEGIN    784U
#define WIRELESS_EEPROM_LOGIC_PARAMETER_END      919U
#define WIRELESS_EEPROM_PARAMETER_GUARD_BEGIN    920U
#define WIRELESS_EEPROM_PARAMETER_GUARD_END      927U
#define WIRELESS_EEPROM_BUSINESS_RESERVED_BEGIN  928U
#define WIRELESS_EEPROM_BUSINESS_RESERVED_END   2047U

#define WIRELESS_EEPROM_RANGE_SIZE(begin_, end_) ((end_) - (begin_) + 1U)

_Static_assert(WIRELESS_EEPROM_IDENTITY_BEGIN == 0U,
               "EEPROM owner 必须从地址 0 开始");
_Static_assert(WIRELESS_EEPROM_IDENTITY_END + 1U ==
                   WIRELESS_EEPROM_DEVICE_COMMON_BEGIN,
               "identity 与公共预留不连续");
_Static_assert(WIRELESS_EEPROM_DEVICE_COMMON_END + 1U ==
                   WIRELESS_EEPROM_DEBUG_BEGIN,
               "公共预留与 debug owner 不连续");
_Static_assert(WIRELESS_EEPROM_DEBUG_END + 1U ==
                   WIRELESS_EEPROM_ETHERNET_BEGIN,
               "debug 与 Ethernet owner 不连续");
_Static_assert(WIRELESS_EEPROM_ETHERNET_END + 1U ==
                   WIRELESS_EEPROM_NETWORK_RESERVED_BEGIN,
               "Ethernet 与 Network 预留不连续");
_Static_assert(WIRELESS_EEPROM_NETWORK_RESERVED_END + 1U ==
                   WIRELESS_EEPROM_SLE_BEGIN,
               "Network 预留与 SLE owner 不连续");
_Static_assert(WIRELESS_EEPROM_SLE_END + 1U == WIRELESS_EEPROM_COMMON_BEGIN,
               "SLE 与无线公共 owner 不连续");
_Static_assert(WIRELESS_EEPROM_COMMON_END + 1U == WIRELESS_EEPROM_CAT1_BEGIN,
               "无线公共与 Cat.1 owner 不连续");
_Static_assert(WIRELESS_EEPROM_CAT1_END + 1U ==
                   WIRELESS_EEPROM_EDGE_TCP_BEGIN,
               "Cat.1 与 Edge TCP owner 不连续");
_Static_assert(WIRELESS_EEPROM_EDGE_TCP_END + 1U ==
                   WIRELESS_EEPROM_COMM_RESERVED_BEGIN,
               "Edge TCP owner 与通信预留不连续");
_Static_assert(WIRELESS_EEPROM_COMM_RESERVED_END + 1U ==
                   WIRELESS_EEPROM_SYSTEM_LIFETIME_BEGIN,
               "通信预留与 SystemLifetime 不连续");
_Static_assert(WIRELESS_EEPROM_SYSTEM_LIFETIME_END + 1U ==
                   WIRELESS_EEPROM_LOGIC_RUNTIME_BEGIN,
               "SystemLifetime 与 runtime owner 不连续");
_Static_assert(WIRELESS_EEPROM_LOGIC_RUNTIME_END + 1U ==
                   WIRELESS_EEPROM_LOGIC_PARAMETER_BEGIN,
               "runtime 与 parameter owner 不连续");
_Static_assert(WIRELESS_EEPROM_LOGIC_PARAMETER_END + 1U ==
                   WIRELESS_EEPROM_PARAMETER_GUARD_BEGIN,
               "parameter 与保护空洞不连续");
_Static_assert(WIRELESS_EEPROM_PARAMETER_GUARD_END + 1U ==
                   WIRELESS_EEPROM_BUSINESS_RESERVED_BEGIN,
               "保护空洞与业务预留不连续");
_Static_assert(WIRELESS_EEPROM_BUSINESS_RESERVED_END + 1U ==
                   EEPROM_TRANSPORT_TOTAL_SIZE,
               "EEPROM owner 总表必须覆盖完整 AT24C16");

_Static_assert(WIRELESS_EEPROM_RANGE_SIZE(WIRELESS_EEPROM_IDENTITY_BEGIN,
                                          WIRELESS_EEPROM_IDENTITY_END) == 16U,
               "identity owner 必须为 16B");
_Static_assert(WIRELESS_EEPROM_RANGE_SIZE(WIRELESS_EEPROM_DEBUG_BEGIN,
                                          WIRELESS_EEPROM_DEBUG_END) == 16U,
               "debug owner 必须为 16B");
_Static_assert(WIRELESS_EEPROM_RANGE_SIZE(WIRELESS_EEPROM_ETHERNET_BEGIN,
                                          WIRELESS_EEPROM_ETHERNET_END) == 14U,
               "Ethernet owner 必须为 14B");
_Static_assert(WIRELESS_EEPROM_RANGE_SIZE(WIRELESS_EEPROM_SLE_BEGIN,
                                          WIRELESS_EEPROM_SLE_END) == 32U,
               "SLE owner 必须为 32B");
_Static_assert(WIRELESS_EEPROM_RANGE_SIZE(WIRELESS_EEPROM_COMMON_BEGIN,
                                          WIRELESS_EEPROM_COMMON_END) == 32U,
               "无线公共 owner 必须为 32B");
_Static_assert(WIRELESS_EEPROM_RANGE_SIZE(WIRELESS_EEPROM_CAT1_BEGIN,
                                          WIRELESS_EEPROM_CAT1_END) == 256U,
               "Cat.1 owner 必须为 256B");
_Static_assert(WIRELESS_EEPROM_RANGE_SIZE(WIRELESS_EEPROM_EDGE_TCP_BEGIN,
                                          WIRELESS_EEPROM_EDGE_TCP_END) ==
                   EEPROM_TRANSPORT_PAGE_SIZE,
               "Edge TCP owner 必须严格占用一个 EEPROM 页");
_Static_assert(WIRELESS_EEPROM_RANGE_SIZE(WIRELESS_EEPROM_SYSTEM_LIFETIME_BEGIN,
                                          WIRELESS_EEPROM_SYSTEM_LIFETIME_END) == 16U,
               "SystemLifetime owner 必须为 16B");
_Static_assert(WIRELESS_EEPROM_RANGE_SIZE(WIRELESS_EEPROM_LOGIC_RUNTIME_BEGIN,
                                          WIRELESS_EEPROM_LOGIC_RUNTIME_END) == 256U,
               "runtime owner 必须为 256B");
_Static_assert(WIRELESS_EEPROM_RANGE_SIZE(WIRELESS_EEPROM_LOGIC_PARAMETER_BEGIN,
                                          WIRELESS_EEPROM_LOGIC_PARAMETER_END) == 136U,
               "parameter 有效记录必须为 136B");
_Static_assert(WIRELESS_EEPROM_RANGE_SIZE(WIRELESS_EEPROM_PARAMETER_GUARD_BEGIN,
                                          WIRELESS_EEPROM_PARAMETER_GUARD_END) == 8U,
               "parameter 保护空洞必须为 8B");

#endif
