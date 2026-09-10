<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { useRoute, useRouter } from 'vue-router'
import {
  TerminalSquare,
  Cpu,
  Radio,
  Wifi,
  TableProperties,
  FolderInput,
  Activity,
  Wrench,
  Flame,
  MessageSquareText,
  Settings,
  LayoutDashboard,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-vue-next'
import GlobalSerialBar from './GlobalSerialBar.vue'

const route = useRoute()
const router = useRouter()
const collapsed = ref(false)
type ProductGroup = 'controller' | 'xtq' | 'sjzdv3' | 'common' | 'delivery'

function productGroupForPath(path: string): ProductGroup | null {
  if (path.startsWith('/devices/controller')) return 'controller'
  if (path.startsWith('/devices/xtq-coordinator')) return 'xtq'
  if (path.startsWith('/devices/sjzdv3')) return 'sjzdv3'
  if (['/serial', '/modbus', '/mqtt', '/ssh-sftp'].includes(path)) return 'common'
  if (['/flashing', '/settings'].includes(path)) return 'delivery'
  return null
}

const openGroup = ref<ProductGroup | null>(productGroupForPath(route.path))
const { width } = useWindowSize()
const isDebugRoute = computed(() => route.name === 'ControllerDebug')
const isMonitorRoute = computed(() => route.name === 'ControllerMonitor')
const isMaintenanceRoute = computed(() => route.name === 'ControllerMaintenance')
const isXtqCoordinatorRoute = computed(() => route.name === 'XtqCoordinator' || route.path.includes('/devices/xtq-coordinator'))
const isNarrowWindow = computed(() => width.value <= 960)
const isCompact = computed(() => collapsed.value)

watch(
  isNarrowWindow,
  (narrow, wasNarrow) => {
    if (narrow && !wasNarrow) collapsed.value = true
  },
  { immediate: true }
)

watch(
  () => route.path,
  (path) => {
    openGroup.value = productGroupForPath(path)
  }
)

function navigateTo(path: string) {
  router.push(path)
}

function toggleSidebar() {
  collapsed.value = !collapsed.value
}

function toggleGroup(group: ProductGroup) {
  if (isCompact.value) {
    collapsed.value = false
    openGroup.value = group
    return
  }
  openGroup.value = openGroup.value === group ? null : group
}

function groupIsCollapsed(group: ProductGroup) {
  return isCompact.value || openGroup.value !== group
}
</script>

<template>
  <aside class="app-sidebar" :class="{ collapsed: isCompact }">
    <div class="sidebar-header">
      <span v-if="!isCompact" class="workspace-label">工作区</span>
      <button
        type="button"
        class="sidebar-collapse-btn"
        :title="isCompact ? '展开导航栏' : '折叠导航栏'"
        :aria-label="isCompact ? '展开导航栏' : '折叠导航栏'"
        @click.stop="toggleSidebar"
      >
        <PanelLeftOpen v-if="isCompact" :size="16" />
        <PanelLeftClose v-else :size="16" />
      </button>
    </div>

    <!-- Navigation Scroll Area -->
    <div class="nav-scroll-area">
      <button
        class="nav-item navigation-home"
        :class="{ active: route.name === 'DebugCenter' }"
        aria-label="设备调试导航"
        title="设备调试导航：按固件产品线选择正确入口"
        @click="navigateTo('/debug-center')"
      >
        <LayoutDashboard :size="16" class="nav-icon" />
        <span v-if="!isCompact" class="nav-text">调试工作台首页</span>
        <span v-if="!isCompact" class="home-badge">总览</span>
      </button>

      <!-- Section 1: KZ3 controller -->
      <div class="nav-group" :class="{ folded: groupIsCollapsed('controller') }">
        <button
          type="button"
          class="group-label"
          :aria-expanded="!groupIsCollapsed('controller')"
          title="KZ3 F427 控制器"
          @click="toggleGroup('controller')"
        >
          <span class="group-title"><Cpu :size="16" /><span v-if="!isCompact">KZ3 F427 控制器</span></span>
          <ChevronDown v-if="!isCompact" :size="14" class="group-chevron" />
        </button>
        <nav v-show="!groupIsCollapsed('controller')" class="nav-list">
          <span class="nav-section-label">工程与调试</span>
          <button
            class="nav-item"
            :class="{ active: route.name === 'ControllerProduct' }"
            aria-label="I/O 可视化配置工作台"
            title="I/O 可视化配置工作台 (工程组态/点表/变量/北向)"
            @click="navigateTo('/devices/controller')"
          >
            <Cpu :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">I/O 可视化配置工作台</span>
          </button>
          <button
            class="nav-item commissioning-item"
            :class="{ active: isDebugRoute }"
            aria-label="KZ3 在线调试工作台"
            title="KZ3 在线调试工作台 (HTTP点位监视与受控写入)"
            @click="navigateTo('/devices/controller/debug')"
          >
            <Activity :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">在线调试工作台</span>
          </button>
          <button
            class="nav-item"
            :class="{ active: isMaintenanceRoute }"
            aria-label="KZ3 UART1 设备维护"
            title="KZ3 UART1 设备维护 (生产 SN / Ethernet / SLE / Cat.1 / Edge TCP / DEBUG)"
            @click="navigateTo('/devices/controller/maintenance')"
          >
            <Wrench :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">UART1 设备维护</span>
          </button>
          <button
            class="nav-item"
            :class="{ active: isMonitorRoute }"
            aria-label="KZ3 I/O 拓扑监测"
            title="KZ3 I/O 拓扑监测 (硬件机架与通道状态)"
            @click="navigateTo('/devices/controller/monitor')"
          >
            <LayoutDashboard :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">I/O 拓扑监测</span>
          </button>
        </nav>
      </div>

      <!-- Section 2: Dual NearLink Coordinator -->
      <div class="nav-group" :class="{ folded: groupIsCollapsed('xtq') }">
        <button
          type="button"
          class="group-label"
          :aria-expanded="!groupIsCollapsed('xtq')"
          title="双星闪协调器"
          @click="toggleGroup('xtq')"
        >
          <span class="group-title"><Radio :size="16" /><span v-if="!isCompact">双星闪协调器</span></span>
          <ChevronDown v-if="!isCompact" :size="14" class="group-chevron" />
        </button>
        <nav v-show="!groupIsCollapsed('xtq')" class="nav-list">
          <button
            class="nav-item"
            :class="{ active: isXtqCoordinatorRoute }"
            aria-label="双星闪协调器调试工作台"
            title="双星闪协调器调试工作台"
            @click="navigateTo('/devices/xtq-coordinator')"
          >
            <Radio :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">协调器调试工作台</span>
          </button>
        </nav>
      </div>

      <!-- Section 3: SJZDV3 terminal -->
      <div class="nav-group" :class="{ folded: groupIsCollapsed('sjzdv3') }">
        <button
          type="button"
          class="group-label"
          :aria-expanded="!groupIsCollapsed('sjzdv3')"
          title="SJZDV3 采集终端"
          @click="toggleGroup('sjzdv3')"
        >
          <span class="group-title"><Activity :size="16" /><span v-if="!isCompact">SJZDV3 采集终端</span></span>
          <ChevronDown v-if="!isCompact" :size="14" class="group-chevron" />
        </button>

        <nav v-show="!groupIsCollapsed('sjzdv3')" class="nav-list">
          <span class="nav-section-label">设备与通信配置</span>
          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3' }"
            aria-label="设备信息与 SN 烧录"
            title="设备信息与 SN 烧录"
            @click="navigateTo('/devices/sjzdv3')"
          >
            <Cpu :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">设备信息 & SN 烧录</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/sle' }"
            aria-label="星闪 SLE 无线配置"
            title="星闪 SLE 无线配置"
            @click="navigateTo('/devices/sjzdv3/sle')"
          >
            <Radio :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">星闪 (SLE) 无线配置</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/4g' }"
            aria-label="4G Cat.1 / MQTT 配置"
            title="4G Cat.1 / MQTT 配置"
            @click="navigateTo('/devices/sjzdv3/4g')"
          >
            <Wifi :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">4G Cat.1 / MQTT 配置</span>
          </button>

          <span class="nav-section-label">点位与运行监测</span>
          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/modbus' }"
            aria-label="Modbus 点位管理"
            title="Modbus 点位管理"
            @click="navigateTo('/devices/sjzdv3/modbus')"
          >
            <TableProperties :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">Modbus 点位管理</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/dashboard' }"
            aria-label="实时数据与硬件监测"
            title="实时数据与硬件监测"
            @click="navigateTo('/devices/sjzdv3/dashboard')"
          >
            <Activity :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">实时数据与硬件监测</span>
          </button>

          <span class="nav-section-label">设备维护</span>
          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/maintenance' }"
            aria-label="系统维护与 EEPROM"
            title="系统维护与 EEPROM"
            @click="navigateTo('/devices/sjzdv3/maintenance')"
          >
            <Wrench :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">系统维护 & EEPROM</span>
          </button>
        </nav>
      </div>

      <!-- Section 4: Universal tools -->
      <div class="nav-group" :class="{ folded: groupIsCollapsed('common') }">
        <button
          type="button"
          class="group-label"
          :aria-expanded="!groupIsCollapsed('common')"
          title="通用调试工具"
          @click="toggleGroup('common')"
        >
          <span class="group-title"><TerminalSquare :size="16" /><span v-if="!isCompact">通用调试工具</span></span>
          <ChevronDown v-if="!isCompact" :size="14" class="group-chevron" />
        </button>
        <nav v-show="!groupIsCollapsed('common')" class="nav-list">
          <button
            class="nav-item"
            :class="{ active: route.path === '/serial' }"
            aria-label="通用串口监视器"
            title="通用串口监视器"
            @click="navigateTo('/serial')"
          >
            <TerminalSquare :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">通用串口监视器</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/modbus' }"
            aria-label="通用 Modbus RTU / TCP 调试"
            title="通用 Modbus RTU / TCP 调试（多点只读轮询）"
            @click="navigateTo('/modbus')"
          >
            <TableProperties :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">Modbus RTU / TCP 调试</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/mqtt' }"
            aria-label="通用 MQTT 调试"
            title="通用 MQTT 调试 (Broker 订阅与消息发布)"
            @click="navigateTo('/mqtt')"
          >
            <MessageSquareText :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">通用 MQTT 调试</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/ssh-sftp' }"
            aria-label="SSH / SFTP 文件传输"
            title="SSH / SFTP 文件传输（远端目录浏览、文件/目录上传、单文件下载）"
            @click="navigateTo('/ssh-sftp')"
          >
            <FolderInput :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">SSH / SFTP 文件传输</span>
          </button>
        </nav>
      </div>

      <!-- Section 5: Delivery and settings -->
      <div class="nav-group" :class="{ folded: groupIsCollapsed('delivery') }">
        <button
          type="button"
          class="group-label"
          :aria-expanded="!groupIsCollapsed('delivery')"
          title="交付与设置"
          @click="toggleGroup('delivery')"
        >
          <span class="group-title"><Settings :size="16" /><span v-if="!isCompact">交付与设置</span></span>
          <ChevronDown v-if="!isCompact" :size="14" class="group-chevron" />
        </button>
        <nav v-show="!groupIsCollapsed('delivery')" class="nav-list">
          <button
            class="nav-item"
            :class="{ active: route.path === '/flashing' }"
            aria-label="ST-Link 固件烧录"
            title="ST-Link 固件烧录"
            @click="navigateTo('/flashing')"
          >
            <Flame :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">ST-Link 固件烧录</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/settings' }"
            aria-label="应用设置"
            title="应用设置"
            @click="navigateTo('/settings')"
          >
            <Settings :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">应用设置</span>
          </button>
        </nav>
      </div>
    </div>

    <!-- Bottom Global Serial Connection Box -->
    <div class="sidebar-footer">
      <GlobalSerialBar :compact="isCompact" />
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  width: 244px;
  background-color: var(--bg-panel, #ffffff);
  border-right: 1px solid var(--border, #b9c5cf);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  height: 100%;
  transition: width 0.18s ease;
}

.app-sidebar.collapsed {
  width: 56px;
}

.sidebar-header {
  min-height: 44px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border, #b9c5cf);
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.workspace-label {
  color: var(--color-text-tertiary, #5f6f7d);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sidebar-collapse-btn {
  width: 30px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-xs, 3px);
  color: var(--text-muted, #40515f);
  background: transparent;
  cursor: pointer;
}

.sidebar-collapse-btn:hover {
  background: var(--bg-hover, #eef3f7);
  border-color: var(--border, #b9c5cf);
  color: var(--text-main, #17212b);
}

.nav-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 10px 9px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.group-label {
  width: 100%;
  min-height: 38px;
  font-size: 0.78rem;
  font-weight: 750;
  letter-spacing: 0.01em;
  color: var(--text-muted, #40515f);
  padding: 7px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}

.group-title {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.group-title svg {
  flex: 0 0 auto;
  color: #5c7380;
}

.group-label:hover {
  color: var(--color-text-primary, #17212b);
  background: var(--color-surface-3, #eef3f7);
  border-color: var(--color-border-subtle, #d5dde4);
}

.nav-group:not(.folded) > .group-label {
  color: #174d6b;
  border-color: #c1d2dc;
  background: #edf4f7;
}

.nav-group:not(.folded) > .group-label .group-title svg {
  color: #1769aa;
}

.group-chevron {
  flex-shrink: 0;
  transition: transform 0.16s ease;
}

.nav-group.folded .group-chevron {
  transform: rotate(-90deg);
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 1px 0 2px 15px;
  padding-left: 8px;
  border-left: 2px solid #d6e1e7;
}

.navigation-home {
  border-color: #b7ccd9;
  background: #f3f8fb;
  color: #174d6b;
}

.navigation-home .nav-icon { color: #1769aa; }

.home-badge {
  margin-left: auto;
  padding: 2px 5px;
  color: #2f6988;
  border: 1px solid #bdd2de;
  border-radius: 8px;
  background: #fff;
  font-size: .7rem;
  font-weight: 700;
}

.nav-section-label {
  margin: 8px 7px 2px;
  color: #657b87;
  font-size: .7rem;
  font-weight: 800;
  letter-spacing: .04em;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 37px;
  padding: 8px 7px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-main, #17212b);
  border-radius: 6px;
  font-size: 0.84rem;
  font-weight: 550;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
  width: 100%;
}

.nav-item:hover {
  background: #eef3f7;
  color: #102330;
}

.nav-item.active {
  background: #e7f1fa;
  border-color: #9fc1dc;
  color: #0f5f9e;
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--accent, #1769aa);
}

.nav-icon {
  color: var(--text-muted, #526472);
  flex-shrink: 0;
  transition: color 0.15s;
}
.nav-item.active .nav-icon {
  color: #1769aa;
}

.nav-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.coming-soon-pill {
  font-size: 0.62rem;
  background: #e8edf2;
  color: var(--text-muted, #40515f);
  padding: 1px 5px;
  border-radius: 10px;
}

.sidebar-footer {
  padding: 9px;
  border-top: 1px solid var(--border, #b9c5cf);
  background: var(--color-canvas, #edf1f4);
}

.app-sidebar.collapsed .sidebar-header,
.app-sidebar.collapsed .nav-item,
.app-sidebar.collapsed .group-label {
  justify-content: center;
}

.app-sidebar.collapsed .nav-item,
.app-sidebar.collapsed .group-label {
  padding-inline: 0;
}

.app-sidebar.collapsed .nav-scroll-area {
  padding-inline: 6px;
  gap: 10px;
}

.app-sidebar.collapsed .nav-group {
  gap: 2px;
}

.app-sidebar.collapsed .group-label {
  min-height: 38px;
}

</style>
