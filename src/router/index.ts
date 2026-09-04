import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/devices/sjzdv3'
    },
    {
      path: '/serial',
      name: 'SerialDebugger',
      component: () => import('../views/SerialView.vue'),
      meta: { title: '通用串口调试' }
    },
    {
      path: '/devices/sjzdv3',
      name: 'SjzdOverview',
      component: () => import('../views/devices/sjzdv3/DeviceOverviewView.vue'),
      meta: { title: 'SJZDV3 设备信息与 SN 烧录' }
    },
    {
      path: '/devices/sjzdv3/sle',
      name: 'SjzdSle',
      component: () => import('../views/devices/sjzdv3/SleConfigView.vue'),
      meta: { title: 'SJZDV3 星闪 (SLE) 无线配置' }
    },
    {
      path: '/devices/sjzdv3/4g',
      name: 'SjzdFourG',
      component: () => import('../views/devices/sjzdv3/FourGConfigView.vue'),
      meta: { title: 'SJZDV3 4G Cat.1 / MQTT 配置' }
    },
    {
      path: '/devices/sjzdv3/modbus',
      name: 'SjzdModbus',
      component: () => import('../views/devices/sjzdv3/ModbusView.vue'),
      meta: { title: 'SJZDV3 Modbus 点位管理' }
    },
    {
      path: '/devices/sjzdv3/dashboard',
      name: 'SjzdDashboard',
      component: () => import('../views/devices/sjzdv3/DashboardView.vue'),
      meta: { title: 'SJZDV3 实时数据与硬件监测' }
    },
    {
      path: '/devices/sjzdv3/maintenance',
      name: 'SjzdMaintenance',
      component: () => import('../views/devices/sjzdv3/MaintenanceView.vue'),
      meta: { title: 'SJZDV3 系统维护与 EEPROM' }
    },
    {
      path: '/devices/controller',
      name: 'ControllerProduct',
      component: () => import('../views/devices/controller/ControllerView.vue'),
      meta: { title: 'KZ3 控制器 I/O 可视化配置' }
    },
    {
      path: '/devices/controller/debug',
      name: 'ControllerDebug',
      component: () => import('../views/devices/controller/ControllerView.vue'),
      meta: { title: 'KZ3 在线调试工作台' }
    },
    {
      path: '/devices/controller/maintenance',
      name: 'ControllerMaintenance',
      component: () => import('../views/devices/controller/Kz3MaintenanceView.vue'),
      meta: { title: 'KZ3 UART1 设备维护' }
    },
    {
      path: '/devices/controller/monitor',
      name: 'ControllerMonitor',
      component: () => import('../views/devices/controller/ControllerMonitorView.vue'),
      meta: { title: 'KZ3 I/O 拓扑监测' }
    },
    {
      path: '/devices/xtq-coordinator',
      name: 'XtqCoordinator',
      component: () => import('../views/devices/xtq/XtqCoordinatorView.vue'),
      meta: { title: '双星闪协调器调试工作台' }
    },
    {
      path: '/flashing',
      name: 'FirmwareFlashing',
      component: () => import('../views/FlashView.vue'),
      meta: { title: 'ST-Link 固件烧录' }
    },
    {
      path: '/settings',
      name: 'AppSettings',
      component: () => import('../views/SettingsView.vue'),
      meta: { title: '应用设置' }
    }
  ]
})

export default router
