<script setup lang="ts">
import { computed } from 'vue'
import { Cpu } from 'lucide-vue-next'
import { useSjzdStore } from '../../stores/sjzdStore'
import { useSerialStore } from '../../stores/serialStore'
import type { SjzdHardwareVariant } from '../../types/sjzd'

const sjzd = useSjzdStore()
const serial = useSerialStore()
const description = computed(() => sjzd.hardwareVariant === 'f411'
  ? 'F411 无网口；保留 SLE、4G 和 RS485 功能，不发送 NET 指令。'
  : sjzd.hardwareVariant === 'f412'
    ? `F412 支持网口。${sjzd.hardwareSource === 'protocol' ? '已收到完整 NET 配置，确认网口固件能力。' : '芯片由操作员选择，仍须读取确认固件支持。'}`
    : '固件未回传芯片型号。请选择当前连接的板型，或只读探测网口能力；不从 SN 推断芯片。')
</script>

<template>
  <section class="hardware-selection" aria-label="当前串口设备芯片">
    <Cpu :size="19" aria-hidden="true" />
    <label>
      <span>当前连接芯片</span>
      <select
        :value="sjzd.hardwareVariant" :disabled="!serial.connectedPort || sjzd.isBusy"
        @change="sjzd.selectHardwareVariant(($event.target as HTMLSelectElement).value as SjzdHardwareVariant)"
      >
        <option value="unknown">待确认</option>
        <option value="f411">STM32F411 · 无网口</option>
        <option value="f412">STM32F412 · 有网口</option>
      </select>
    </label>
    <p>{{ serial.connectedPort ? description : '连接 UART1 后确认本次设备的芯片。切换串口后重新确认，不沿用上一台设备的选择。' }}</p>
  </section>
</template>

<style scoped>
.hardware-selection { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px 14px; margin-bottom: 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-panel); color: var(--text-main); }
label { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; }
select { min-height: 36px; max-width: 100%; padding: 6px 28px 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-main); }
p { flex: 1 1 280px; margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-muted); }
</style>
