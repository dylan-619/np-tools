#ifndef KZ3_EDGE_TCP_STATUS_H
#define KZ3_EDGE_TCP_STATUS_H

#include <stdint.h>

typedef enum
{
    EDGE_TCP_STATE_DISABLED = 0U,
    EDGE_TCP_STATE_WAIT_LINK,
    EDGE_TCP_STATE_CONNECTING,
    EDGE_TCP_STATE_ONLINE,
    EDGE_TCP_STATE_CLOSING,
    EDGE_TCP_STATE_BACKOFF
} EdgeTcpState;

typedef enum
{
    EDGE_TCP_ERROR_NONE = 0U,
    EDGE_TCP_ERROR_CONFIG,
    EDGE_TCP_ERROR_IDENTITY,
    EDGE_TCP_ERROR_ALLOC,
    EDGE_TCP_ERROR_CONNECT,
    EDGE_TCP_ERROR_RECEIVE,
    EDGE_TCP_ERROR_SEND,
    EDGE_TCP_ERROR_FRAME_TOO_LARGE,
    EDGE_TCP_ERROR_PROTOCOL,
    EDGE_TCP_ERROR_SN_MISMATCH,
    EDGE_TCP_ERROR_WRITE_REJECTED
} EdgeTcpError;

typedef struct
{
    EdgeTcpState state;
    EdgeTcpError last_error;
    uint8_t config_valid;
    uint8_t enabled;
    uint8_t online;
    uint8_t reserved[3];
    uint32_t reconnect_count;
    uint32_t connect_success_count;
    uint32_t rx_frame_count;
    uint32_t tx_frame_count;
    uint32_t rejected_frame_count;
    uint32_t dropped_report_count;
    uint32_t last_rx_tick_ms;
    uint32_t last_tx_tick_ms;
    uint32_t step_us;
    uint32_t step_max_us;
} EdgeTcpStatus;

#endif
