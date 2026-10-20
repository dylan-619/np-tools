#ifndef KZ3_USER_HMI_H_
#define KZ3_USER_HMI_H_

#include <stdint.h>

#include "data_manager.h"

/** HMI 唯一只读输入；页面不得直接访问 Network、SLE 或 DataManager owner。 */
typedef struct
{
    DataManagerProcessSnapshot process;
    uint8_t serial_number[14];
    uint8_t firmware_version[32];
    uint8_t ethernet_ip[4];
    uint16_t ethernet_port;
    uint16_t device_type;
    uint16_t run_mode;
    uint16_t sle_address;
    uint8_t sle_network_name[17];
    uint8_t sle_module_ready;
    uint8_t wireless_mode;
    uint8_t wireless_config_valid;
    uint8_t wireless_port_ready;
    uint8_t wireless_link_stage;
    uint8_t cat1_online;
    uint8_t ethernet_link_up;
    uint8_t ethernet_client_count;
    uint32_t session_runtime_seconds;
    uint8_t logic_api_fault_valid;
    uint8_t logic_api_fault_code;
    uint8_t logic_api_fault_id;
    uint8_t logic_api_fault_phase;
    uint16_t logic_api_fault_instance_id;
    uint32_t logic_api_fault_violation_count;
} UserHmiSnapshot;

typedef LogicResult (*UserHmiSnapshotProvider)(void *context,
                                               UserHmiSnapshot *snapshot);

#define USER_HMI_RUN_AUTO 1U

#define USER_HMI_WIRELESS_MODE_SLE  1U
#define USER_HMI_WIRELESS_MODE_CAT1 2U
#define USER_HMI_WIRELESS_STAGE_CONFIG_REQUIRED 0U
#define USER_HMI_WIRELESS_STAGE_OFF             1U
#define USER_HMI_WIRELESS_STAGE_INITIALIZING    2U
#define USER_HMI_WIRELESS_STAGE_NETWORK         3U
#define USER_HMI_WIRELESS_STAGE_MQTT            4U
#define USER_HMI_WIRELESS_STAGE_ONLINE          5U

LogicResult UserHmi_BindSnapshotProvider(UserHmiSnapshotProvider provider,
                                         void *context);


//LED
#define LED_FLASH_FREQ_LOW			3000
#define LED_FLASH_FREQ_MID			1000
#define LED_FLASH_FREQ_HIGH			100

#define LED_ON 							0
#define LED_OFF 						1



/* LED状态类型定义 */
typedef enum
{
	OFF = 0U, 			//灭
	GRN_ON,				//绿灯亮
	RED_ON,				//红灯亮
	GRN_FLASH_FREQ_LOW,	//绿灯慢闪
	GRN_FLASH_FREQ_MID,	//绿灯中闪
	GRN_FLASH_FREQ_HIGH,//绿灯快闪
	RED_FLASH_FREQ_LOW,	//红灯慢闪
	RED_FLASH_FREQ_MID,	//红灯中闪
	RED_FLASH_FREQ_HIGH,//红灯快闪
	ALT_FLASH_FREQ_LOW,	//红绿灯交替慢闪
	ALT_FLASH_FREQ_MID,	//红绿灯交替中闪
	ALT_FLASH_FREQ_HIGH,//红绿灯交替高闪
} LedStaTypeDef;

//Key
#define KEY_SHORT_PRES_TIM_MS			50
#define KEY_LONG_PRES_TIM_MS			2000

#endif
