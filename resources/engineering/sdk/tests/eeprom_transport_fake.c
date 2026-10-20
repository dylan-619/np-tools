#include "eeprom_transport_fake.h"

#include "eeprom_transport.h"

#include <stdbool.h>
#include <stddef.h>
#include <string.h>

static uint8_t s_eeprom[EEPROM_TRANSPORT_TOTAL_SIZE];
static bool s_initialized;
static uint32_t s_write_count;
static uint32_t s_fail_write_call;
static EepromTransportFakeWriteHook s_next_write_hook;
static void *s_next_write_hook_context;

static void EnsureInitialized(void);

void EepromTransportFake_Reset(void)
{
    (void)memset(s_eeprom, 0xFF, sizeof(s_eeprom));
    s_initialized = true;
    s_write_count = 0U;
    s_fail_write_call = 0U;
    s_next_write_hook = NULL;
    s_next_write_hook_context = NULL;
}

void EepromTransportFake_FailNextWrite(void)
{
    EnsureInitialized();
    s_fail_write_call = s_write_count + 1U;
}

uint32_t EepromTransportFake_GetWriteCount(void)
{
    EnsureInitialized();
    return s_write_count;
}

void EepromTransportFake_SetNextWriteHook(EepromTransportFakeWriteHook hook,
                                          void *context)
{
    EnsureInitialized();
    s_next_write_hook = hook;
    s_next_write_hook_context = context;
}

static void EnsureInitialized(void)
{
    if (!s_initialized)
    {
        EepromTransportFake_Reset();
    }
}

uint8_t EepromTransport_Read(uint8_t *buffer, uint16_t address,
                             uint16_t length)
{
    EnsureInitialized();
    if (buffer == NULL || length == 0U ||
        (uint32_t)address + length > sizeof(s_eeprom))
    {
        return 1U;
    }
    (void)memcpy(buffer, &s_eeprom[address], length);
    return 0U;
}

uint8_t EepromTransport_WriteAndVerify(const uint8_t *buffer,
                                       uint16_t address, uint16_t length)
{
    EnsureInitialized();
    s_write_count++;
    if (s_next_write_hook != NULL)
    {
        EepromTransportFakeWriteHook hook = s_next_write_hook;
        void *hook_context = s_next_write_hook_context;

        s_next_write_hook = NULL;
        s_next_write_hook_context = NULL;
        hook(hook_context);
    }
    if (buffer == NULL || length == 0U ||
        (uint32_t)address + length > sizeof(s_eeprom) ||
        (s_fail_write_call != 0U && s_write_count == s_fail_write_call))
    {
        return 1U;
    }
    (void)memcpy(&s_eeprom[address], buffer, length);
    return 0U;
}
