#ifndef KZ3_WIRELESS_BOOTSTRAP_H
#define KZ3_WIRELESS_BOOTSTRAP_H

typedef enum
{
    WIRELESS_BOOTSTRAP_UNCHANGED = 0U,
    WIRELESS_BOOTSTRAP_SLE_INITIALIZED,
    WIRELESS_BOOTSTRAP_FAILED
} WirelessBootstrapResult;

/**
 * 公共模式无效、生产 SN 有效且没有合法 Cat.1 配置时建立默认 SLE 配置。
 * 已有合法模式或 Cat.1 配置不会被覆盖；旧格式和损坏的 SLE 记录会被重建。
 */
WirelessBootstrapResult WirelessBootstrap_InitializeDefaultSle(void);

#endif
