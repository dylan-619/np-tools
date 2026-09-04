<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import {
  Activity,
  Play,
  Square,
  Lightbulb,
  Zap,
  Download,
  RotateCcw,
} from 'lucide-vue-next'
import * as echarts from 'echarts'
import { useSjzdStore } from '../../../stores/sjzdStore'
import { useSerialStore } from '../../../stores/serialStore'

const sjzd = useSjzdStore()
const serial = useSerialStore()

const chartRef = ref<HTMLDivElement | null>(null)
let chartInstance: echarts.ECharts | null = null

function getLoopStatus(ma: number): { label: string; class: string } {
  if (ma < 3.8) return { label: '断路/未接入', class: 'broken' }
  if (ma > 20.2) return { label: '超量程 (>20mA)', class: 'overload' }
  return { label: '4~20mA 正常', class: 'normal' }
}

function exportAiCsv() {
  if (sjzd.aiHistory.length === 0) {
    sjzd.showMessage('暂无采样历史数据可导出', false)
    return
  }
  const headers = '采样时间,AI1通道电流(mA),AI2通道电流(mA)\n'
  const rows = sjzd.aiHistory.map((h) => `${h.timeStr},${h.ai1},${h.ai2}`).join('\n')
  const blob = new Blob(['\uFEFF' + headers + rows], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `SJZDV3_AI_Sample_History_${Date.now()}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  sjzd.showMessage(`已导出 ${sjzd.aiHistory.length} 条模拟量采样记录！`)
}

function clearAiHistory() {
  sjzd.aiHistory.length = 0
  updateChartOption()
  sjzd.showMessage('已清空曲线采样历史')
}

function initChart() {
  if (!chartRef.value) return
  chartInstance = echarts.init(chartRef.value)
  updateChartOption()
}

function updateChartOption() {
  if (!chartInstance) return

  const times = sjzd.aiHistory.map((h) => h.timeStr)
  const ai1Data = sjzd.aiHistory.map((h) => h.ai1)
  const ai2Data = sjzd.aiHistory.map((h) => h.ai2)

  const option: echarts.EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#ffffff',
      borderColor: '#b9c5cf',
      textStyle: { color: '#17212b' },
      formatter: (params: any) => {
        let res = `<div style="font-family:monospace;font-size:12px;">时间: ${params[0]?.name}<br/>`
        for (const item of params) {
          res += `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${item.color};"></span>${item.seriesName}: <strong>${item.value} mA</strong><br/>`
        }
        res += '</div>'
        return res
      },
    },
    legend: {
      data: ['AI 1 电流通道', 'AI 2 电流通道'],
      textStyle: { color: '#40515f' },
      top: 0,
      right: 16,
    },
    grid: {
      left: '4%',
      right: '4%',
      bottom: '10%',
      top: '15%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: times,
      axisLine: { lineStyle: { color: '#b9c5cf' } },
      axisLabel: { color: '#40515f', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      name: '电流 (mA)',
      min: 0,
      max: 24,
      nameTextStyle: { color: '#40515f', fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(42, 47, 66, 0.5)', type: 'dashed' } },
      axisLabel: { color: '#40515f', fontSize: 10 },
    },
    series: [
      {
        name: 'AI 1 电流通道',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: ai1Data,
        lineStyle: { color: '#1769aa', width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(59, 130, 246, 0.35)' },
            { offset: 1, color: 'rgba(59, 130, 246, 0.0)' },
          ]),
        },
      },
      {
        name: 'AI 2 电流通道',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: ai2Data,
        lineStyle: { color: '#176b45', width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(16, 185, 129, 0.35)' },
            { offset: 1, color: 'rgba(16, 185, 129, 0.0)' },
          ]),
        },
      },
    ],
  }

  chartInstance.setOption(option)
}

watch(
  () => sjzd.aiHistory.length,
  () => {
    updateChartOption()
  }
)

function handleResize() {
  chartInstance?.resize()
}

onMounted(() => {
  initChart()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
  // Safety rule: automatically stop AI test sampling on unmount
  if (sjzd.isSamplingAi) {
    sjzd.stopAiSampling()
  }
})
</script>

<template>
  <div class="view-container">
    <!-- Header -->
    <header class="view-header">
      <div class="title-col">
        <div class="title-with-badge">
          <h2>实时数据看板与硬件诊断</h2>
          <span
            class="sampling-badge"
            :class="sjzd.isSamplingAi ? 'badge-running' : 'badge-idle'"
          >
            <span class="badge-dot" :class="{ pulse: sjzd.isSamplingAi }" />
            {{ sjzd.isSamplingAi ? '连续采样中 (1Hz)' : '采样就绪' }}
          </span>
        </div>
        <p class="subtitle">
          实时监测 2 路 4~20mA 模拟量电流输入，绘制动态平滑趋势曲线，并支持硬件双色 LED 状态灯检测。
        </p>
      </div>

      <div class="actions-col">
        <button
          class="btn btn-outline"
          :disabled="sjzd.aiHistory.length === 0"
          title="清空当前图表采样历史数据"
          @click="clearAiHistory"
        >
          <RotateCcw :size="14" />
          <span>清空曲线</span>
        </button>

        <button
          class="btn btn-secondary"
          :disabled="sjzd.aiHistory.length === 0"
          title="导出采样数据历史为 CSV 表格"
          @click="exportAiCsv"
        >
          <Download :size="14" />
          <span>导出采样 CSV</span>
        </button>

        <button
          v-if="!sjzd.isSamplingAi"
          class="btn btn-primary"
          :disabled="!serial.connectedPort || sjzd.isBusy"
          title="启动模拟量持续采样 (AITEST 1Hz)"
          @click="sjzd.startAiSampling"
        >
          <Play :size="14" />
          <span>启动持续采样</span>
        </button>

        <button
          v-else
          class="btn btn-danger"
          title="停止采样测试 (TESTSTOP)"
          @click="sjzd.stopAiSampling"
        >
          <Square :size="14" />
          <span>停止采样</span>
        </button>
      </div>
    </header>

    <!-- Digital Gauges Row -->
    <div class="gauges-grid">
      <!-- AI 1 Card -->
      <div class="gauge-card blue">
        <div class="gauge-header">
          <div class="header-badge-group">
            <div class="gauge-badge blue">模拟量 AI 1</div>
            <span class="loop-status-pill" :class="getLoopStatus(sjzd.currentAi.ai1Ma).class">
              {{ getLoopStatus(sjzd.currentAi.ai1Ma).label }}
            </span>
          </div>
          <span class="range-hint">标准: 4.000 ~ 20.000 mA</span>
        </div>
        <div class="gauge-body">
          <span class="gauge-number">{{ sjzd.currentAi.ai1Ma.toFixed(3) }}</span>
          <span class="gauge-unit">mA</span>
        </div>
        <div class="gauge-bar-wrapper">
          <div
            class="gauge-bar-fill blue"
            :style="{ width: `${Math.min(100, Math.max(0, (sjzd.currentAi.ai1Ma / 20) * 100))}%` }"
          />
        </div>
      </div>

      <!-- AI 2 Card -->
      <div class="gauge-card green">
        <div class="gauge-header">
          <div class="header-badge-group">
            <div class="gauge-badge green">模拟量 AI 2</div>
            <span class="loop-status-pill" :class="getLoopStatus(sjzd.currentAi.ai2Ma).class">
              {{ getLoopStatus(sjzd.currentAi.ai2Ma).label }}
            </span>
          </div>
          <span class="range-hint">标准: 4.000 ~ 20.000 mA</span>
        </div>
        <div class="gauge-body">
          <span class="gauge-number">{{ sjzd.currentAi.ai2Ma.toFixed(3) }}</span>
          <span class="gauge-unit">mA</span>
        </div>
        <div class="gauge-bar-wrapper">
          <div
            class="gauge-bar-fill green"
            :style="{ width: `${Math.min(100, Math.max(0, (sjzd.currentAi.ai2Ma / 20) * 100))}%` }"
          />
        </div>
      </div>
    </div>

    <!-- Chart Card -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Activity :size="16" class="icon-blue" />
          <h3>4~20mA 模拟量动态波动曲线 (实时平滑图)</h3>
        </div>
        <span class="sample-status" :class="{ active: sjzd.isSamplingAi }">
          <span class="status-dot" />
          <span>{{ sjzd.isSamplingAi ? '正在连续采样 (1次/秒)' : '采样已暂停' }}</span>
        </span>
      </div>

      <div class="card-body">
        <div ref="chartRef" class="chart-container" />
      </div>
    </div>

    <!-- LED & Hardware Test Card -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Lightbulb :size="16" class="icon-amber" />
          <h3>硬件状态指示灯与出厂诊断</h3>
        </div>
      </div>

      <div class="card-body led-actions-row">
        <div class="led-action-item">
          <button
            class="led-btn btn-green-led"
            :disabled="!serial.connectedPort || sjzd.isBusy"
            @click="sjzd.testLed('ALLGREEN')"
          >
            <Zap :size="16" />
            <span>点亮全绿灯 (ALLGREEN)</span>
          </button>
          <span class="led-desc">强制将面板 LED 切换为常亮绿色</span>
        </div>

        <div class="led-action-item">
          <button
            class="led-btn btn-red-led"
            :disabled="!serial.connectedPort || sjzd.isBusy"
            @click="sjzd.testLed('ALLRED')"
          >
            <Zap :size="16" />
            <span>点亮全红灯 (ALLRED)</span>
          </button>
          <span class="led-desc">强制将面板 LED 切换为常亮红色</span>
        </div>

        <div class="led-action-item">
          <button
            class="led-btn btn-off-led"
            :disabled="!serial.connectedPort || sjzd.isBusy"
            @click="sjzd.testLed('ALLOFF')"
          >
            <Square :size="16" />
            <span>关闭全部指示灯 (ALLOFF)</span>
          </button>
          <span class="led-desc">关闭全部指示灯恢复正常逻辑</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-container {
  padding: var(--page-gutter, 12px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: none;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border: 1px solid var(--color-border-subtle, #d5dde4);
  background: var(--color-surface-1, #ffffff);
  border-radius: var(--radius-sm, 5px);
}

.title-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.title-with-badge h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-main, #17212b);
}

.sampling-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
}
.badge-running {
  background: rgba(16, 185, 129, 0.12);
  color: #15803d;
  border: 1px solid rgba(16, 185, 129, 0.28);
}
.badge-idle {
  background: rgba(100, 116, 139, 0.1);
  color: #64748b;
  border: 1px solid rgba(100, 116, 139, 0.2);
}
.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.badge-dot.pulse {
  background: #16a34a;
  box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7);
  animation: badge-pulse 1.8s infinite;
}
@keyframes badge-pulse {
  0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7); }
  70% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
  100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
}

.actions-col {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.subtitle {
  margin: 0;
  font-size: 0.74rem;
  color: var(--text-muted, #40515f);
}

.gauges-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.gauge-card {
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: var(--radius-sm, 5px);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gauge-card.blue {
  border-left: 4px solid #1769aa;
}
.gauge-card.green {
  border-left: 4px solid #176b45;
}

.gauge-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-badge-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.loop-status-pill {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}
.loop-status-pill.normal {
  background: rgba(16, 185, 129, 0.15);
  color: #176b45;
}
.loop-status-pill.broken {
  background: rgba(239, 68, 68, 0.15);
  color: #a12d34;
}
.loop-status-pill.overload {
  background: rgba(245, 158, 11, 0.15);
  color: #7a4b00;
}

.gauge-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}
.gauge-badge.blue {
  background: rgba(59, 130, 246, 0.15);
  color: #0f5f9e;
}
.gauge-badge.green {
  background: rgba(16, 185, 129, 0.15);
  color: #176b45;
}

.range-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
  font-family: var(--font-mono, monospace);
}

.gauge-body {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.gauge-number {
  font-size: 1.65rem;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  color: var(--text-main, #17212b);
}

.gauge-unit {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-muted, #40515f);
}

.gauge-bar-wrapper {
  height: 6px;
  background: var(--bg-input, #f7f9fb);
  border-radius: 3px;
  overflow: hidden;
}
.gauge-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.gauge-bar-fill.blue {
  background: #1769aa;
}
.gauge-bar-fill.green {
  background: #176b45;
}

.section-card {
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: var(--radius-sm, 5px);
  overflow: hidden;
}

.card-header {
  min-height: 38px;
  padding: 8px 12px;
  background: #eef3f7;
  border-bottom: 1px solid var(--border, #b9c5cf);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.header-left h3 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-main, #17212b);
}

.icon-blue {
  color: #1769aa;
}
.icon-amber {
  color: #8a5700;
}

.sample-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-muted, #40515f);
}
.sample-status.active {
  color: #176b45;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.card-body {
  padding: 10px 12px;
}

.chart-container {
  width: 100%;
  height: 230px;
}

.led-actions-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}

.led-action-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.led-btn {
  min-height: var(--control-height, 32px);
  padding: 6px 10px;
  border-radius: var(--radius-xs, 3px);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid transparent;
  transition: all 0.15s;
}

.btn-green-led {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.3);
  color: #176b45;
}
.btn-green-led:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.25);
  border-color: #176b45;
}

.btn-red-led {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
  color: #a12d34;
}
.btn-red-led:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
  border-color: #a12d34;
}

.btn-off-led {
  background: var(--bg-input, #f7f9fb);
  border-color: var(--border, #b9c5cf);
  color: var(--text-muted, #40515f);
}
.btn-off-led:hover:not(:disabled) {
  background: #e5ebf0;
  color: #17212b;
}

.led-desc {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
  text-align: center;
}

.btn {
  min-height: var(--control-height, 32px);
  padding: 6px 12px;
  border-radius: var(--radius-xs, 3px);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.btn-primary {
  background: var(--accent, #1769aa);
  color: #ffffff;
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover, #0d5289);
}

.btn-secondary {
  background: #f1f5f9;
  color: #334155;
  border-color: #cbd5e1;
}
.btn-secondary:hover:not(:disabled) {
  background: #e2e8f0;
  color: #0f172a;
}

.btn-outline {
  background: transparent;
  border-color: var(--color-border-subtle, #cbd5e1);
  color: var(--text-main, #17212b);
}
.btn-outline:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #94a3b8;
}

.btn-danger {
  background: rgba(239, 68, 68, 0.1);
  color: #b91c1c;
  border-color: rgba(239, 68, 68, 0.25);
}
.btn-danger:hover:not(:disabled) {
  background: #ef4444;
  color: #ffffff;
}

.btn:disabled {
  background: var(--color-surface-1, #ffffff);
  border-color: var(--color-border-subtle, #d5dde4);
  color: var(--color-text-disabled, #667784);
  opacity: 0.65;
  cursor: not-allowed;
}
</style>
