<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Cpu,
  Layers,
  Network,
  Plus,
  Trash2,
  ShieldCheck,
  Link,
} from 'lucide-vue-next'
import { useControllerStore } from '../../../stores/controllerStore'
import { KZ3_BOARD_DEF, PROFILE_CATALOG } from '../../../utils/controllerIoCatalog'
import CustomSelect from '../../../components/common/CustomSelect.vue'

const controller = useControllerStore()

// 当前选中的硬件节点：'board' 代表板载主控，或者扩展设备 id
const selectedNodeId = ref<string>('board')

// 添加模块用的 Profile 选择
const selectedProfileToAdd = ref('sp4055_702')

const profileOptions = Object.values(PROFILE_CATALOG).map((p) => ({
  label: `${p.name} (${p.description})`,
  value: p.id,
}))

const portOptions = [
  { label: 'RS485 总线 1 (rs485_1)', value: 'rs485_1' },
  { label: 'RS485 总线 2 (rs485_2)', value: 'rs485_2' },
]

const baudOptions = [
  { label: '9600 bps', value: 9600 },
  { label: '19200 bps', value: 19200 },
  { label: '38400 bps', value: 38400 },
  { label: '57600 bps', value: 57600 },
  { label: '115200 bps', value: 115200 },
]

const parityOptions = [
  { label: '无校验 (None, 1 Stop)', value: 'none' },
  { label: '偶校验 (Even, 1 Stop)', value: 'even' },
  { label: '奇校验 (Odd, 1 Stop)', value: 'odd' },
]

// 选中的设备对象（如果是扩展设备）
const currentDevice = computed(() => {
  if (selectedNodeId.value === 'board') return null
  return controller.doc.project.devices.find((d) => d.id === selectedNodeId.value) || null
})

const currentProfile = computed(() => {
  if (!currentDevice.value) return null
  return PROFILE_CATALOG[currentDevice.value.profile] || null
})

// 计算每个物理通道是否已在点表中绑定了业务点
const channelBindingMap = computed(() => {
  const map = new Map<string, { pointName: string; dir: 'in' | 'out' }>()
  for (const pt of controller.doc.project.points.inputs) {
    if (pt.source) map.set(pt.source, { pointName: pt.name, dir: 'in' })
  }
  for (const pt of controller.doc.project.points.outputs) {
    if (pt.source) map.set(pt.source, { pointName: pt.name, dir: 'out' })
  }
  return map
})

function handleAddDevice() {
  controller.addDevice(selectedProfileToAdd.value)
  // 自动选中新添加的设备
  const lastDev = controller.doc.project.devices[controller.doc.project.devices.length - 1]
  if (lastDev) {
    selectedNodeId.value = lastDev.id
  }
}

function handleRemoveDevice(devId: string) {
  const idx = controller.doc.project.devices.findIndex((d) => d.id === devId)
  if (idx >= 0) {
    controller.removeDevice(idx)
    selectedNodeId.value = 'board'
  }
}

function toggleInputChannel(dev: any, code: string) {
  if (!dev.use.inputs) dev.use.inputs = []
  const idx = dev.use.inputs.indexOf(code)
  if (idx >= 0) {
    dev.use.inputs.splice(idx, 1)
  } else {
    dev.use.inputs.push(code)
  }
}

function toggleOutputChannel(dev: any, code: string, isBool: boolean) {
  if (!dev.use.outputs) dev.use.outputs = {}
  if (dev.use.outputs[code]) {
    delete dev.use.outputs[code]
  } else {
    dev.use.outputs[code] = {
      safe_value: isBool ? false : 0,
    }
  }
}

// 快速为该物理通道创建点位
function quickCreatePoint(sourceStr: string, defaultName: string, isOutput: boolean) {
  if (isOutput) {
    controller.addOutputPoint({
      name: defaultName,
      source: sourceStr,
      description: `物理端子 ${sourceStr} 对应业务输出`,
    })
  } else {
    controller.addInputPoint({
      name: defaultName,
      source: sourceStr,
      description: `物理端子 ${sourceStr} 对应业务输入`,
    })
  }
  controller.showMessage(`已为 ${sourceStr} 创建业务点: ${defaultName}`)
}
</script>

<template>
  <div class="hardware-workbench">
    <!-- Left Column: Hardware Topology Rack & Tree -->
    <aside class="topology-sidebar">
      <div class="sidebar-header">
        <div class="title-row">
          <Layers :size="16" class="text-blue" />
          <span class="sidebar-title">硬件机架与拓扑结构</span>
        </div>
        <span class="count-badge">{{ 1 + controller.doc.project.devices.length }} 节点</span>
      </div>

      <!-- Node 0: Master Board -->
      <div class="rack-section">
        <div class="section-label">主控机架 (Slot #0)</div>
        <div
          class="rack-node-card"
          :class="{ active: selectedNodeId === 'board' }"
          @click="selectedNodeId = 'board'"
        >
          <div class="node-icon-box bg-blue">
            <Cpu :size="18" />
          </div>
          <div class="node-meta">
            <div class="node-main-name">KZ3 标准主控板</div>
            <div class="node-sub-info">
              <span class="mono-code">kz3_f427_standard</span>
            </div>
            <div class="node-badges-row">
              <span class="pill pill-in">12 DI</span>
              <span class="pill pill-out">8 DO</span>
              <span class="pill pill-ai">4 AI</span>
              <span class="pill pill-ao">2 AO</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Node 1..N: RS485 Bus & Expansion Modules -->
      <div class="rack-section">
        <div class="section-label-row">
          <span class="section-label">RS485 扩展总线与从站模块</span>
          <span class="bus-baud-hint">9600 8-N-1</span>
        </div>

        <div class="devices-tree-list">
          <div
            v-for="(dev) in controller.doc.project.devices"
            :key="dev.id"
            class="rack-node-card"
            :class="{ active: selectedNodeId === dev.id }"
            @click="selectedNodeId = dev.id"
          >
            <div class="node-icon-box bg-purple">
              <Network :size="18" />
            </div>
            <div class="node-meta">
              <div class="node-main-name-row">
                <span class="slave-addr-badge">#{{ dev.slave_address }}</span>
                <span class="node-name-text">{{ dev.name }}</span>
              </div>
              <div class="node-sub-info">
                <span class="profile-name">{{ dev.profile }}</span>
                <span class="port-name">{{ dev.port }}</span>
              </div>
              <!-- Channel Active Summary -->
              <div class="channels-summary-bar">
                <span v-if="dev.use.inputs?.length" class="use-count in">
                  {{ dev.use.inputs.length }} 选用输入
                </span>
                <span v-if="Object.keys(dev.use.outputs || {}).length" class="use-count out">
                  {{ Object.keys(dev.use.outputs).length }} 选用输出
                </span>
              </div>
            </div>
          </div>

          <div v-if="controller.doc.project.devices.length === 0" class="no-dev-hint">
            暂无南向从站模块，请在下方选择模块添加。
          </div>
        </div>
      </div>

      <!-- Bottom: Add Module Bar -->
      <div class="sidebar-footer-add">
        <div class="add-select-wrapper">
          <CustomSelect
            v-model="selectedProfileToAdd"
            :options="profileOptions"
          />
        </div>
        <button class="btn btn-primary add-btn" @click="handleAddDevice">
          <Plus :size="14" />
          <span>插入扩展模块</span>
        </button>
      </div>
    </aside>

    <!-- Right Column: Detail Configuration & Terminal Board -->
    <main class="workbench-main">
      <!-- VIEW A: Board Master Detail -->
      <div v-if="selectedNodeId === 'board'" class="view-panel">
        <!-- Top Board Header -->
        <div class="module-header-card">
          <div class="module-info-left">
            <div class="board-icon-box">
              <Cpu :size="24" />
            </div>
            <div>
              <div class="module-title-row">
                <h2 class="module-title">{{ KZ3_BOARD_DEF.name }}</h2>
                <span class="tag-board-fixed">板载固有硬件基准</span>
              </div>
              <p class="module-desc">
                主控板固化物理端子资源。板载 DI 采用低电平有效输入；DO 高电平有效驱动；AI/AO 采用 0..20mA 标准工业模拟信号。
              </p>
            </div>
          </div>

          <!-- RS485 Ports Settings Quick Drawer -->
          <div class="board-ports-quick">
            <div class="ports-title">
              <Network :size="14" class="text-blue" />
              <span>RS485_1 端口物理总线参数</span>
            </div>
            <div
              v-if="controller.doc.project.rs485_ports.rs485_1"
              class="port-params-row"
            >
              <div class="param-cell">
                <label>波特率</label>
                <CustomSelect
                  v-model="controller.doc.project.rs485_ports.rs485_1.baud"
                  :options="baudOptions"
                />
              </div>
              <div class="param-cell">
                <label>校验位</label>
                <CustomSelect
                  v-model="controller.doc.project.rs485_ports.rs485_1.parity"
                  :options="parityOptions"
                />
              </div>
              <div class="param-cell">
                <label>超时 (ms)</label>
                <input
                  v-model.number="controller.doc.project.rs485_ports.rs485_1.response_timeout_ms"
                  type="number"
                  class="compact-input"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Terminal Board View: DI, DO, AI, AO Groups -->
        <div class="terminals-container">
          <!-- DI Group (12 DI) -->
          <div class="terminal-group-card">
            <div class="group-header bg-blue-subtle">
              <div class="group-title-row">
                <span class="group-badge bg-blue">DI 矩阵</span>
                <span class="group-name">板载数字量输入端子 (12 路 DI01 ~ DI12)</span>
              </div>
              <span class="group-spec-pill">NPN / 低电平有效</span>
            </div>

            <div class="terminals-grid">
              <div
                v-for="ch in KZ3_BOARD_DEF.channels.filter((c) => c.code.startsWith('di'))"
                :key="ch.code"
                class="terminal-pin-card"
                :class="{ bound: channelBindingMap.has(`board.${ch.code}`) }"
              >
                <div class="pin-top-row">
                  <span class="pin-terminal-no">{{ ch.code.toUpperCase() }}</span>
                  <span class="pin-driver">CH{{ ch.driverChannel }}</span>
                </div>

                <div class="pin-signal-name">{{ ch.name }}</div>

                <div class="pin-binding-status">
                  <div
                    v-if="channelBindingMap.has(`board.${ch.code}`)"
                    class="bound-info"
                  >
                    <Link :size="12" class="text-green" />
                    <span class="point-tag">point.{{ channelBindingMap.get(`board.${ch.code}`)?.pointName }}</span>
                  </div>
                  <button
                    v-else
                    class="btn-quick-bind"
                    @click="quickCreatePoint(`board.${ch.code}`, `board_${ch.code}`, false)"
                  >
                    <Plus :size="11" />
                    <span>映射为业务点</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- DO Group (8 DO) -->
          <div class="terminal-group-card">
            <div class="group-header bg-green-subtle">
              <div class="group-title-row">
                <span class="group-badge bg-green">DO 矩阵</span>
                <span class="group-name">板载数字量输出端子 (8 路 DO01 ~ DO08)</span>
              </div>
              <span class="group-spec-pill">高电平有效 / 默认安全值: False</span>
            </div>

            <div class="terminals-grid">
              <div
                v-for="ch in KZ3_BOARD_DEF.channels.filter((c) => c.code.startsWith('do'))"
                :key="ch.code"
                class="terminal-pin-card"
                :class="{ bound: channelBindingMap.has(`board.${ch.code}`) }"
              >
                <div class="pin-top-row">
                  <span class="pin-terminal-no text-green">{{ ch.code.toUpperCase() }}</span>
                  <span class="pin-driver">CH{{ ch.driverChannel }}</span>
                </div>

                <div class="pin-signal-name">{{ ch.name }}</div>

                <div class="pin-binding-status">
                  <div
                    v-if="channelBindingMap.has(`board.${ch.code}`)"
                    class="bound-info"
                  >
                    <Link :size="12" class="text-green" />
                    <span class="point-tag">point.{{ channelBindingMap.get(`board.${ch.code}`)?.pointName }}</span>
                  </div>
                  <button
                    v-else
                    class="btn-quick-bind"
                    @click="quickCreatePoint(`board.${ch.code}`, `board_${ch.code}`, true)"
                  >
                    <Plus :size="11" />
                    <span>映射为业务点</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- AI & AO Group -->
          <div class="analog-groups-grid">
            <!-- AI Group (4 AI) -->
            <div class="terminal-group-card flex-1">
              <div class="group-header bg-amber-subtle">
                <div class="group-title-row">
                  <span class="group-badge bg-amber">AI 模拟量输入</span>
                  <span class="group-name">4 路 (AI01 ~ AI04)</span>
                </div>
                <span class="group-spec-pill">0 .. 20 mA</span>
              </div>

              <div class="terminals-grid-col2">
                <div
                  v-for="ch in KZ3_BOARD_DEF.channels.filter((c) => c.code.startsWith('ai'))"
                  :key="ch.code"
                  class="terminal-pin-card"
                  :class="{ bound: channelBindingMap.has(`board.${ch.code}`) }"
                >
                  <div class="pin-top-row">
                    <span class="pin-terminal-no text-amber">{{ ch.code.toUpperCase() }}</span>
                    <span class="pin-driver">CH{{ ch.driverChannel }}</span>
                  </div>
                  <div class="pin-signal-name">{{ ch.name }}</div>
                  <div class="pin-binding-status">
                    <div
                      v-if="channelBindingMap.has(`board.${ch.code}`)"
                      class="bound-info"
                    >
                      <Link :size="12" class="text-green" />
                      <span class="point-tag">point.{{ channelBindingMap.get(`board.${ch.code}`)?.pointName }}</span>
                    </div>
                    <button
                      v-else
                      class="btn-quick-bind"
                      @click="quickCreatePoint(`board.${ch.code}`, `board_${ch.code}`, false)"
                    >
                      <Plus :size="11" />
                      <span>映射为业务点</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- AO Group (2 AO) -->
            <div class="terminal-group-card flex-1">
              <div class="group-header bg-purple-subtle">
                <div class="group-title-row">
                  <span class="group-badge bg-purple">AO 模拟量输出</span>
                  <span class="group-name">2 路 (AO01 ~ AO02)</span>
                </div>
                <span class="group-spec-pill">0 .. 20 mA / Safe: 0.0</span>
              </div>

              <div class="terminals-grid-col2">
                <div
                  v-for="ch in KZ3_BOARD_DEF.channels.filter((c) => c.code.startsWith('ao'))"
                  :key="ch.code"
                  class="terminal-pin-card"
                  :class="{ bound: channelBindingMap.has(`board.${ch.code}`) }"
                >
                  <div class="pin-top-row">
                    <span class="pin-terminal-no text-purple">{{ ch.code.toUpperCase() }}</span>
                    <span class="pin-driver">CH{{ ch.driverChannel }}</span>
                  </div>
                  <div class="pin-signal-name">{{ ch.name }}</div>
                  <div class="pin-binding-status">
                    <div
                      v-if="channelBindingMap.has(`board.${ch.code}`)"
                      class="bound-info"
                    >
                      <Link :size="12" class="text-green" />
                      <span class="point-tag">point.{{ channelBindingMap.get(`board.${ch.code}`)?.pointName }}</span>
                    </div>
                    <button
                      v-else
                      class="btn-quick-bind"
                      @click="quickCreatePoint(`board.${ch.code}`, `board_${ch.code}`, true)"
                    >
                      <Plus :size="11" />
                      <span>映射为业务点</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- VIEW B: Remote Device Instance Detail -->
      <div v-else-if="currentDevice && currentProfile" class="view-panel">
        <!-- Top Device Header & Property Form -->
        <div class="module-header-card">
          <div class="dev-header-top">
            <div class="dev-title-left">
              <div class="dev-profile-icon">
                <Network :size="24" />
              </div>
              <div>
                <div class="dev-title-row">
                  <input
                    v-model="currentDevice.name"
                    type="text"
                    class="dev-name-title-input"
                    placeholder="实例唯一名称 (如 expansion)"
                  />
                  <span class="profile-code-badge">{{ currentDevice.profile }}</span>
                  <span class="profile-desc-badge">{{ currentProfile.name }}</span>
                </div>
                <p class="dev-desc-text">{{ currentProfile.description }}</p>
              </div>
            </div>

            <button
              class="btn btn-danger-outline"
              title="从工程中移除该扩展模块"
              @click="handleRemoveDevice(currentDevice.id)"
            >
              <Trash2 :size="14" />
              <span>删除模块</span>
            </button>
          </div>

          <!-- Device Bus Properties Form -->
          <div class="dev-properties-grid">
            <div class="prop-item">
              <label>通信总线端口 (Port)</label>
              <CustomSelect v-model="currentDevice.port" :options="portOptions" />
            </div>

            <div class="prop-item">
              <label>从站地址 (Slave Address 1~247)</label>
              <input
                v-model.number="currentDevice.slave_address"
                type="number"
                min="1"
                max="247"
                class="form-input text-mono font-bold"
              />
            </div>

            <div class="prop-item">
              <label>周期轮询 (Poll Period ms)</label>
              <div class="input-unit">
                <input
                  v-model.number="currentDevice.poll_period_ms"
                  type="number"
                  class="form-input"
                />
                <span>ms</span>
              </div>
            </div>

            <div class="prop-item">
              <label>数据超时失效阈值 (Stale After ms)</label>
              <div class="input-unit">
                <input
                  v-model.number="currentDevice.stale_after_ms"
                  type="number"
                  class="form-input"
                />
                <span>ms</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Terminal Board View for Remote Device -->
        <div class="terminals-container">
          <!-- Inputs Group -->
          <div
            v-if="currentProfile.inputs.length"
            class="terminal-group-card"
          >
            <div class="group-header bg-blue-subtle">
              <div class="group-title-row">
                <span class="group-badge bg-blue">输入通道 ({{ currentProfile.inputs.length }})</span>
                <span class="group-name">选用输入通道 (Use Inputs) - 勾选后进入过程映像与点表</span>
              </div>
              <span class="group-spec-pill">已选用 {{ currentDevice.use.inputs?.length || 0 }} / {{ currentProfile.inputs.length }}</span>
            </div>

            <div class="terminals-grid">
              <div
                v-for="sig in currentProfile.inputs"
                :key="sig.code"
                class="terminal-pin-card"
                :class="{
                  active: currentDevice.use.inputs?.includes(sig.code),
                  bound: channelBindingMap.has(`rtu.${currentDevice.name}.${sig.code}`),
                }"
              >
                <div class="pin-top-row">
                  <label class="pin-check-label">
                    <input
                      type="checkbox"
                      :checked="currentDevice.use.inputs?.includes(sig.code)"
                      @change="toggleInputChannel(currentDevice, sig.code)"
                    />
                    <span class="pin-terminal-no">{{ sig.code.toUpperCase() }}</span>
                  </label>
                  <span class="pin-type-tag">{{ sig.type }}</span>
                </div>

                <div class="pin-signal-name">{{ sig.name }}</div>

                <div class="pin-binding-status">
                  <div
                    v-if="channelBindingMap.has(`rtu.${currentDevice.name}.${sig.code}`)"
                    class="bound-info"
                  >
                    <Link :size="12" class="text-green" />
                    <span class="point-tag">point.{{ channelBindingMap.get(`rtu.${currentDevice.name}.${sig.code}`)?.pointName }}</span>
                  </div>
                  <button
                    v-else-if="currentDevice.use.inputs?.includes(sig.code)"
                    class="btn-quick-bind"
                    @click="quickCreatePoint(`rtu.${currentDevice.name}.${sig.code}`, `${currentDevice.name}_${sig.code}`, false)"
                  >
                    <Plus :size="11" />
                    <span>映射为业务点</span>
                  </button>
                  <span v-else class="text-muted-xs">未启用通道</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Outputs Group & Safe Values -->
          <div
            v-if="currentProfile.outputs.length"
            class="terminal-group-card"
          >
            <div class="group-header bg-green-subtle">
              <div class="group-title-row">
                <span class="group-badge bg-green">输出通道与安全值 ({{ currentProfile.outputs.length }})</span>
                <span class="group-name">选用输出通道 (Use Outputs & Safe Values)</span>
              </div>
              <span class="group-spec-pill">已选用 {{ Object.keys(currentDevice.use.outputs || {}).length }} / {{ currentProfile.outputs.length }}</span>
            </div>

            <div class="terminals-grid">
              <div
                v-for="sig in currentProfile.outputs"
                :key="sig.code"
                class="terminal-pin-card"
                :class="{
                  active: Boolean(currentDevice.use.outputs?.[sig.code]),
                  bound: channelBindingMap.has(`rtu.${currentDevice.name}.${sig.code}`),
                }"
              >
                <div class="pin-top-row">
                  <label class="pin-check-label">
                    <input
                      type="checkbox"
                      :checked="Boolean(currentDevice.use.outputs?.[sig.code])"
                      @change="toggleOutputChannel(currentDevice, sig.code, sig.type === 'bool')"
                    />
                    <span class="pin-terminal-no text-green">{{ sig.code.toUpperCase() }}</span>
                  </label>
                  <span class="pin-type-tag">{{ sig.type }}</span>
                </div>

                <div class="pin-signal-name">{{ sig.name }}</div>

                <!-- Safe Value row if enabled -->
                <div
                  v-if="currentDevice.use.outputs?.[sig.code]"
                  class="pin-safe-box"
                >
                  <div class="safe-title">
                    <ShieldCheck :size="12" class="text-green" />
                    <span>安全默认值:</span>
                  </div>
                  <select
                    v-if="sig.type === 'bool'"
                    v-model="currentDevice.use.outputs[sig.code].safe_value"
                    class="safe-mini-select"
                  >
                    <option :value="false">False (分闸/关闭)</option>
                    <option :value="true">True (合闸/打开)</option>
                  </select>
                  <input
                    v-else
                    v-model.number="currentDevice.use.outputs[sig.code].safe_value"
                    type="number"
                    min="0"
                    max="4095"
                    class="safe-mini-input"
                    placeholder="0..4095"
                  />
                </div>

                <div class="pin-binding-status">
                  <div
                    v-if="channelBindingMap.has(`rtu.${currentDevice.name}.${sig.code}`)"
                    class="bound-info"
                  >
                    <Link :size="12" class="text-green" />
                    <span class="point-tag">point.{{ channelBindingMap.get(`rtu.${currentDevice.name}.${sig.code}`)?.pointName }}</span>
                  </div>
                  <button
                    v-else-if="currentDevice.use.outputs?.[sig.code]"
                    class="btn-quick-bind"
                    @click="quickCreatePoint(`rtu.${currentDevice.name}.${sig.code}`, `${currentDevice.name}_${sig.code}`, true)"
                  >
                    <Plus :size="11" />
                    <span>映射为业务点</span>
                  </button>
                  <span v-else class="text-muted-xs">未启用输出</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.hardware-workbench {
  display: grid;
  grid-template-columns: 310px 1fr;
  gap: 16px;
  height: calc(100vh - 190px);
  min-height: 560px;
}

@media (max-width: 1024px) {
  .hardware-workbench {
    grid-template-columns: 1fr;
    height: auto;
  }
}

/* Sidebar Rack */
.topology-sidebar {
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border, #b9c5cf);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f7f9fb;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sidebar-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-main, #17212b);
}

.count-badge {
  font-size: 0.7rem;
  background: rgba(59, 130, 246, 0.15);
  color: #0f5f9e;
  padding: 2px 6px;
  border-radius: 4px;
}

.rack-section {
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.section-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}

.section-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-muted, #40515f);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.bus-baud-hint {
  font-size: 0.68rem;
  color: #0f5f9e;
  font-family: monospace;
}

.devices-tree-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
}

.rack-node-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-app, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  cursor: pointer;
  transition: all 0.15s ease;
}

.rack-node-card:hover {
  border-color: rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.04);
}

.rack-node-card.active {
  border-color: #1769aa;
  background: rgba(59, 130, 246, 0.12);
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.2);
}

.node-icon-box {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bg-blue { background: rgba(59, 130, 246, 0.15); color: #0f5f9e; }
.bg-purple { background: rgba(168, 85, 247, 0.15); color: #6f3a96; }
.bg-green { background: rgba(16, 185, 129, 0.15); color: #176b45; }
.bg-amber { background: rgba(245, 158, 11, 0.15); color: #7a4b00; }

.node-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.node-main-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-main, #17212b);
}

.node-main-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.slave-addr-badge {
  font-size: 0.68rem;
  font-family: monospace;
  font-weight: 700;
  background: rgba(168, 85, 247, 0.2);
  color: #6f3a96;
  padding: 1px 4px;
  border-radius: 3px;
}

.node-name-text {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-main, #17212b);
}

.node-sub-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7rem;
  color: var(--text-muted, #40515f);
}

.mono-code { font-family: monospace; }
.profile-name { color: #40515f; font-size: 0.68rem; }
.port-name { color: #0f5f9e; font-size: 0.66rem; }

.node-badges-row {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.pill {
  font-size: 0.64rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
}
.pill-in { background: rgba(59, 130, 246, 0.15); color: #1769aa; }
.pill-out { background: rgba(16, 185, 129, 0.15); color: #176b45; }
.pill-ai { background: rgba(245, 158, 11, 0.15); color: #7a4b00; }
.pill-ao { background: rgba(168, 85, 247, 0.15); color: #6f3a96; }

.channels-summary-bar {
  display: flex;
  gap: 6px;
  margin-top: 3px;
}

.use-count {
  font-size: 0.64rem;
  padding: 1px 4px;
  border-radius: 3px;
}
.use-count.in { background: rgba(59, 130, 246, 0.1); color: #1769aa; }
.use-count.out { background: rgba(16, 185, 129, 0.1); color: #176b45; }

.no-dev-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
  padding: 14px;
  text-align: center;
}

.sidebar-footer-add {
  margin-top: auto;
  padding: 12px 10px;
  background: #eef3f7;
  border-top: 1px solid var(--border, #b9c5cf);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.add-select-wrapper {
  width: 100%;
}

.add-btn {
  width: 100%;
}

/* Right Column Workbench */
.workbench-main {
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 10px;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
}

.view-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.module-header-card {
  background: var(--bg-app, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.module-info-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.board-icon-box, .dev-profile-icon {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.15);
  color: #0f5f9e;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.module-title-row, .dev-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.module-title {
  font-size: 1rem;
  font-weight: 700;
  color: #17212b;
  margin: 0;
}

.tag-board-fixed {
  font-size: 0.7rem;
  background: rgba(16, 185, 129, 0.15);
  color: #176b45;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.module-desc, .dev-desc-text {
  font-size: 0.76rem;
  color: var(--text-muted, #40515f);
  margin: 4px 0 0 0;
  line-height: 1.4;
}

.board-ports-quick {
  background: #e8edf2;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ports-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--text-main, #314654);
}

.port-params-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}

.param-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.param-cell label {
  font-size: 0.7rem;
  color: var(--text-muted, #40515f);
}

.compact-input {
  background: var(--bg-app, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 0.78rem;
  color: #17212b;
  outline: none;
}

/* Device Detail Top */
.dev-header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.dev-title-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.dev-name-title-input {
  background: var(--bg-panel, #ffffff);
  border: 1px solid #1769aa;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 0.95rem;
  font-weight: 700;
  color: #17212b;
  outline: none;
}

.profile-code-badge {
  font-size: 0.72rem;
  font-family: monospace;
  background: rgba(168, 85, 247, 0.15);
  color: #6f3a96;
  padding: 2px 6px;
  border-radius: 4px;
}

.profile-desc-badge {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
}

.dev-properties-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  background: #f7f9fb;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.prop-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prop-item label {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
}

.form-input {
  background: var(--bg-app, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 0.8rem;
  color: #17212b;
  outline: none;
}

.input-unit {
  position: relative;
  display: flex;
  align-items: center;
}
.input-unit input { padding-right: 28px; width: 100%; }
.input-unit span { position: absolute; right: 8px; font-size: 0.72rem; color: var(--text-muted, #40515f); }

/* Terminals Board UI */
.terminals-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.terminal-group-card {
  background: var(--bg-app, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.group-header {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.group-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-badge {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}

.group-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-main, #17212b);
}

.group-spec-pill {
  font-size: 0.68rem;
  color: var(--text-muted, #40515f);
}

.bg-blue-subtle { background: rgba(59, 130, 246, 0.08); }
.bg-green-subtle { background: rgba(16, 185, 129, 0.08); }
.bg-amber-subtle { background: rgba(245, 158, 11, 0.08); }
.bg-purple-subtle { background: rgba(168, 85, 247, 0.08); }

.terminals-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px;
  padding: 10px;
}

.terminals-grid-col2 {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  padding: 10px;
}

.analog-groups-grid {
  display: flex;
  gap: 12px;
}
@media (max-width: 800px) {
  .analog-groups-grid {
    flex-direction: column;
  }
}

.terminal-pin-card {
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 6px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.15s ease;
}

.terminal-pin-card:hover {
  border-color: rgba(59, 130, 246, 0.35);
}

.terminal-pin-card.active {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(59, 130, 246, 0.05);
}

.terminal-pin-card.bound {
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(16, 185, 129, 0.03);
}

.pin-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pin-check-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.pin-terminal-no {
  font-size: 0.78rem;
  font-family: monospace;
  font-weight: 700;
  color: #0f5f9e;
}

.pin-driver, .pin-type-tag {
  font-size: 0.65rem;
  background: #eef3f7;
  color: var(--text-muted, #40515f);
  padding: 1px 4px;
  border-radius: 3px;
}

.pin-signal-name {
  font-size: 0.72rem;
  color: var(--text-main, #314654);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pin-safe-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #e8edf2;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.safe-title {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  color: var(--text-muted, #40515f);
}

.safe-mini-select, .safe-mini-input {
  background: var(--bg-app, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 3px;
  color: #17212b;
  font-size: 0.68rem;
  padding: 1px 4px;
}
.safe-mini-input { width: 60px; text-align: center; }

.pin-binding-status {
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px dashed rgba(255, 255, 255, 0.06);
  min-height: 22px;
  display: flex;
  align-items: center;
}

.bound-info {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.point-tag {
  font-size: 0.68rem;
  font-family: monospace;
  color: #176b45;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-quick-bind {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.66rem;
  background: transparent;
  border: 1px dashed var(--border, #b9c5cf);
  border-radius: 3px;
  color: #0f5f9e;
  padding: 2px 6px;
  cursor: pointer;
}
.btn-quick-bind:hover {
  background: rgba(59, 130, 246, 0.1);
  border-color: #1769aa;
}

.text-muted-xs {
  font-size: 0.66rem;
  color: rgba(148, 163, 184, 0.5);
}

.text-blue { color: #0f5f9e; }
.text-green { color: #176b45; }
.text-amber { color: #7a4b00; }
.text-purple { color: #6f3a96; }
.font-bold { font-weight: 700; }
.text-mono { font-family: monospace; }
.flex-1 { flex: 1; }

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn-primary { background: #1769aa; color: #fff; }
.btn-primary:hover { background: #0e568e; }

.btn-danger-outline {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #a12d34;
}
.btn-danger-outline:hover {
  background: rgba(239, 68, 68, 0.12);
}
/* Compact engineering workspace pass */
.hardware-workbench { grid-template-columns: 260px 1fr; gap: 10px; height: calc(100vh - 154px); min-height: 500px; }
.topology-sidebar, .workbench-main { border-radius: var(--radius-sm); }
.sidebar-header { min-height: 38px; padding: 8px 10px; }
.rack-section { padding: 8px; gap: 6px; }
.rack-node-card { gap: 8px; padding: 7px 8px; border-radius: var(--radius-xs); }
.workbench-main { padding: 10px; }
.view-panel { gap: 10px; }
.module-header-card { padding: 10px; border-radius: var(--radius-xs); gap: 8px; }
.terminal-group-card, .terminal-pin-card { border-radius: var(--radius-xs); }
@media (max-width: 1024px) { .hardware-workbench { height: auto; min-height: 0; } }
</style>
