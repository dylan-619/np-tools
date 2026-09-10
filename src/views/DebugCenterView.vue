<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  Activity,
  ArrowRight,
  Cpu,
  EthernetPort,
  Radio,
  ShieldAlert,
  TerminalSquare,
  Wrench,
} from 'lucide-vue-next'
import { useSerialStore } from '../stores/serialStore'

const router = useRouter()
const serial = useSerialStore()

const serialSummary = computed(() => {
  if (!serial.connectedPort) return '未连接：请先在左下角选择目标串口'
  return `${serial.connectedPort} · ${serial.config.baudRate} ${serial.config.dataBits === 'eight' ? '8' : serial.config.dataBits}N${serial.config.stopBits === 'one' ? '1' : serial.config.stopBits}`
})

function open(path: string) {
  router.push(path)
}
</script>

<template>
  <main class="debug-center">
    <header class="station-header">
      <div class="station-title">
        <div class="station-mark"><TerminalSquare :size="23" /></div>
        <div>
          <div class="eyebrow">NP-TOOLS · COMMISSIONING INDEX</div>
          <h1>设备调试导航</h1>
          <p>按固件产品线进入；每个入口明确协议边界、配置层级与可验证证据。</p>
        </div>
      </div>
      <div class="serial-readout" :class="{ online: Boolean(serial.connectedPort) }">
        <span class="signal-dot" />
        <div><strong>{{ serial.connectedPort ? '公共串口已连接' : '公共串口未连接' }}</strong><code>{{ serialSummary }}</code></div>
      </div>
    </header>

    <section class="readiness-strip" aria-label="调试前置条件">
      <div><span class="strip-index">01</span><strong>先确认目标产品</strong><small>SJZDV3 与 KZ3 使用不同 UART 协议，不共用维护指令。</small></div>
      <div><span class="strip-index">02</span><strong>再匹配串口参数</strong><small>SJZDV3 以目标页说明为准；KZ3 UART1 固定为 115200 8N1。</small></div>
      <div><span class="strip-index">03</span><strong>最后验证现场行为</strong><small>工具回包仅证明通信/配置记录，链路、网关与实机动作需另验。</small></div>
    </section>

    <section class="product-grid">
      <article class="product-lane sjzd-lane">
        <div class="lane-heading">
          <div class="lane-icon"><Radio :size="20" /></div>
          <div><span class="eyebrow">F412 · UART1 CONSOLE</span><h2>SJZDV3 采集终端</h2></div>
          <span class="product-tag">采集 / 无线</span>
        </div>
        <p class="lane-summary">覆盖设备信息与 SN、SLE、4G Cat.1/MQTT、RS485/Modbus 点位、实时观测及维护命令。</p>
        <div class="capability-list">
          <div><Cpu :size="15" /><span><strong>生产与设备</strong><small>DEVINFO、SN 写入、固件烧录</small></span></div>
          <div><Radio :size="15" /><span><strong>无线与上行</strong><small>SLE / 4G 配置、重连与状态回读</small></span></div>
          <div><Activity :size="15" /><span><strong>现场数据</strong><small>Modbus 点位、仪表盘、诊断与维护</small></span></div>
        </div>
        <div class="lane-actions">
          <button class="primary-action" @click="open('/devices/sjzdv3')">从设备信息开始 <ArrowRight :size="15" /></button>
          <button class="quiet-action" @click="open('/devices/sjzdv3/modbus')">进入 Modbus 点位</button>
          <button class="quiet-action" @click="open('/devices/sjzdv3/maintenance')">维护与 EEPROM</button>
        </div>
      </article>

      <article class="product-lane kz3-lane">
        <div class="lane-heading">
          <div class="lane-icon"><Cpu :size="20" /></div>
          <div><span class="eyebrow">F427 · UART1 / HTTP</span><h2>KZ3 控制器</h2></div>
          <span class="product-tag">控制 / 调试</span>
        </div>
        <p class="lane-summary">串口维护与 HTTP 在线调试分层：UART1 负责受控配置及回读，HTTP 负责工程运行态诊断与受控点位写入。</p>
        <div class="capability-list">
          <div><Wrench :size="15" /><span><strong>UART1 维护</strong><small>SN、Ethernet、SLE、Cat.1、Edge TCP、DEBUG</small></span></div>
          <div><EthernetPort :size="15" /><span><strong>网络与 Edge TCP</strong><small>RUN/SAVED 对照、重启需求、客户端状态</small></span></div>
          <div><Activity :size="15" /><span><strong>HTTP 在线调试</strong><small>诊断、点位监视、受控写入与 I/O 拓扑</small></span></div>
        </div>
        <div class="lane-actions">
          <button class="primary-action" @click="open('/devices/controller/maintenance')">进入 UART1 维护 <ArrowRight :size="15" /></button>
          <button class="quiet-action" @click="open('/devices/controller/debug')">HTTP 在线调试</button>
          <button class="quiet-action" @click="open('/devices/controller')">I/O 工程配置</button>
        </div>
      </article>
    </section>

    <section class="boundary-panel">
      <ShieldAlert :size="18" />
      <div><strong>证据边界</strong><p>页面显示的 OK/ERR、RUN/SAVED、ONLINE 或 HTTP 响应均是工具可见证据，不自动等同于无线入网、网关路由、PLC/RS485 执行、现场联锁或生产验收。</p></div>
      <button class="boundary-link" @click="open('/modbus')">打开 Modbus 工作台</button>
      <button class="boundary-link" @click="open('/serial')">打开通用串口观察</button>
    </section>
  </main>
</template>

<style scoped>
.debug-center { height: 100%; overflow: auto; padding: 16px; color: #17212b; background: #edf1f4; }
.station-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px; border: 1px solid #b9c5cf; border-radius: 7px; background: #fff; box-shadow: 0 2px 7px rgba(27,45,58,.07); }
.station-title, .lane-heading, .capability-list > div, .serial-readout, .boundary-panel { display: flex; align-items: center; }
.station-title { gap: 11px; }
.station-mark { width: 43px; height: 43px; display: grid; place-items: center; color: #fff; border-radius: 5px; background: #174d6b; box-shadow: inset 0 -2px rgba(0,0,0,.18); }
.eyebrow { color: #5b7280; font: 700 11px/1.2 var(--font-mono); letter-spacing: .1em; }
h1, h2, p { margin: 0; }
h1 { margin-top: 2px; font-size: 21px; }
h2 { margin-top: 2px; font-size: 17px; }
.station-title p, .lane-summary { margin-top: 4px; color: #58707e; font-size: 13px; line-height: 1.5; }
.serial-readout { min-width: 260px; gap: 9px; padding: 8px 10px; border: 1px solid #c7d2d9; border-radius: 4px; background: #f7f9fa; }
.serial-readout.online { border-color: #96c6aa; background: #edf8f2; }
.serial-readout div { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.serial-readout strong { color: #3e5664; font-size: 12px; }
.serial-readout code { max-width: 260px; overflow: hidden; color: #6b7e89; font: 11px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.signal-dot { width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: #82939d; box-shadow: 0 0 0 4px rgba(130,147,157,.12); }
.online .signal-dot { background: #198257; box-shadow: 0 0 0 4px rgba(25,130,87,.13); }
.readiness-strip { display: grid; grid-template-columns: repeat(3,1fr); gap: 1px; margin: 12px 0; overflow: hidden; border: 1px solid #c6d0d8; border-radius: 5px; background: #c6d0d8; }
.readiness-strip > div { min-height: 66px; padding: 10px 12px; background: #fafcfd; }
.strip-index { display: block; margin-bottom: 3px; color: #1e739e; font: 800 11px var(--font-mono); letter-spacing: .08em; }
.readiness-strip strong { display: block; color: #2a4657; font-size: 13px; }
.readiness-strip small { display: block; margin-top: 3px; color: #667b87; font-size: 11px; line-height: 1.5; }
.product-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.product-lane { position: relative; display: flex; min-height: 350px; flex-direction: column; padding: 16px; overflow: hidden; border: 1px solid #b9c5cf; border-radius: 7px; background: #fff; box-shadow: 0 1px 3px rgba(27,45,58,.06); }
.product-lane::before { content: ''; position: absolute; top: 0; right: 0; left: 0; height: 4px; background: #2879a8; }
.kz3-lane::before { background: #427f68; }
.lane-heading { gap: 9px; }
.lane-icon { width: 35px; height: 35px; display: grid; place-items: center; color: #174d6b; border: 1px solid #b7d0df; border-radius: 4px; background: #edf6fb; }
.kz3-lane .lane-icon { color: #216348; border-color: #b7d2c3; background: #edf7f1; }
.product-tag { margin-left: auto; padding: 3px 7px; color: #39708c; border: 1px solid #b8cfdd; border-radius: 10px; background: #f1f8fc; font-size: 11px; font-weight: 700; }
.kz3-lane .product-tag { color: #32664e; border-color: #b8d2c3; background: #f0f8f3; }
.lane-summary { min-height: 34px; margin: 14px 0 10px; }
.capability-list { display: grid; gap: 6px; }
.capability-list > div { min-height: 46px; gap: 8px; padding: 7px 8px; color: #3c6579; border: 1px solid #d4e0e6; border-radius: 4px; background: #f8fafb; }
.capability-list span { display: flex; flex-direction: column; gap: 2px; }
.capability-list strong { color: #294b5e; font-size: 13px; }
.capability-list small { color: #697e89; font-size: 11px; line-height: 1.4; }
.lane-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: auto; padding-top: 14px; }
.primary-action, .quiet-action, .boundary-link { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 750; }
.primary-action { color: #fff; border: 1px solid #1769aa; background: #1769aa; }
.kz3-lane .primary-action { border-color: #247451; background: #247451; }
.quiet-action { color: #365666; border: 1px solid #b9c8d1; background: #f8fafb; }
.primary-action:hover, .quiet-action:hover, .boundary-link:hover { filter: brightness(.96); }
.boundary-panel { gap: 9px; margin-top: 12px; padding: 11px 13px; color: #714714; border: 1px solid #dfc38f; border-left: 4px solid #c48322; border-radius: 5px; background: #fff8ea; }
.boundary-panel > div { flex: 1; }
.boundary-panel strong { font-size: 13px; }
.boundary-panel p { margin-top: 3px; font-size: 12px; line-height: 1.5; }
.boundary-link { flex: 0 0 auto; color: #714714; border: 1px solid #d6ad69; background: #fffdf8; }
@media (max-width: 960px) { .station-header { align-items: flex-start; flex-direction: column; } .serial-readout { width: 100%; } .product-grid, .readiness-strip { grid-template-columns: 1fr; } .product-lane { min-height: 0; } }
</style>
