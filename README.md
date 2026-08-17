# NP-Tools 硬件产品调试与配置平台 (v2.0)

> 基于 **Tauri v2 + Rust + Vue 3 (Vite + TypeScript) + Pinia + ECharts** 构建的现代化工业硬件配置与调试工具平台。

---

## 🌟 核心支持硬件与能力

- **SJZDV3 现场数据采集终端**：
  - 设备硬件/固件信息查询与 12 位 SN 序列号出厂固化（严格定长 15 字节，无 `\r\n`）
  - 星闪 (NearLink / SLE) 无线网络配置、EEPROM 与模组芯片双向参数比对、功率档位换算与一键批量同步
  - Modbus RTU 16 点位 Data Grid 表格化维护、32 位长度智能纠错、点位克隆、行业模版与 Excel 兼容 CSV/JSON 导入导出
  - 2 路 4~20mA 模拟量输入 1Hz 动态平滑趋势图、回路状态诊断、采样数据导出与硬件双色 LED 状态灯测试
  - 系统参数上报周期/日志级别配置、计数清零、系统软复位与 EEPROM 抹除双重防误触保护
- **ST-Link 固件烧录服务**：
  - 集成 `STM32_Programmer_CLI` 探测、探针枚举、SWD 硬件复位烧录、实时进度追踪与产线一键流水线（烧录 $\to$ 写 SN）
- **通用串口终端监视器**：
  - 基于虚拟滚动的极速串口终端、ANSI 分级彩色高亮、快捷标签过滤与零拷贝磁盘数据流录制
- **智能控制器产品线**：预留扩展架构

---

## 📁 项目目录结构

```
np-tools/
├── src/                  # Vue 3 前端源码 (Composition API, Pinia, Router)
│   ├── api/              # Tauri IPC 接口封装
│   ├── assets/           # 应用静态资源与 Logo 图标
│   ├── components/       # 通用与布局组件
│   ├── router/           # 路由系统
│   ├── stores/           # Pinia 全局状态管理 (串口、设备、烧录)
│   ├── types/            # TypeScript 类型定义
│   └── views/            # 产品线页面与调试视图
├── src-tauri/            # Tauri 桌面端主程序 (Rust)
│   ├── icons/            # 全平台透明背景应用图标
│   ├── src/lib.rs        # Tauri 命令注册与事件通道
│   └── tauri.conf.json   # 桌面端窗口与打包配置
├── crates/               # Rust 核心模块与业务 Crates
│   ├── serial-core/      # 高吞吐串口通信引擎 (Tokio Async, Actor 模型)
│   ├── device-protocol/  # SJZDV3 设备协议编解码与正则解析
│   ├── flash-service/    # STM32_Programmer_CLI 固件烧录子进程服务
│   └── app-types/        # 跨进程 Rust 共享类型定义
├── docs/                 # 需求规格说明书与软件架构设计文档
├── public/               # 公共静态文件
├── index.html            # 单页面入口
├── vite.config.ts        # Vite 构建配置
├── package.json          # 前端依赖与脚本配置
└── Cargo.toml            # Rust 工作区配置
```

---

## 🚀 常用开发与构建命令

在项目根目录下直接运行：

```bash
# 1. 安装前端依赖
pnpm install

# 2. 启动前端页面开发调试 (浏览器预览模式: http://localhost:1420)
pnpm dev

# 3. 启动桌面端全功能联调 (Tauri + Webview 原生窗口)
pnpm tauri dev

# 4. 构建前端生产环境静态包 (类型检查 + Vite 构建)
pnpm build

# 5. 编译构建桌面端全平台发布安装包 (.dmg / .app / .exe)
pnpm tauri build

# 6. 执行 Rust 工作区单元测试
cargo test --workspace
```
