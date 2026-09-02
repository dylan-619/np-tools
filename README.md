# NP-Tools 工业硬件产品调试与配置平台 (v2.0)

> 基于 **Tauri v2 + Rust + Vue 3 (Vite + TypeScript) + Pinia + ECharts** 构建的高性能、跨平台（Windows / macOS）现代化工业硬件调试与产线生产配置工具。

---

## 🌟 核心功能与硬件支持

- **SJZDV3 智能现场数据采集终端**：
  - **设备概览与出厂 SN 固化**：实时查询设备运行时间、开机次数、采样频率等，支持产线 12 位 SN 序列号手动敲入、复制粘贴、自动校验与批量流水号自动递增（`SN:4301xxxxxxxx` 严格定长 15 字节，重启即生效）。
  - **星闪 (NearLink / SLE) 无线网络配置**：EEPROM 与星闪芯片底层回读双向比对（网络名、通信地址、发射功率）、功率档位换算、一键批量同步全套参数，内置原厂 AT 命令行终端与透传控制模式。
  - **Modbus RTU 16 点位 Data Grid 维护**：数据类型（Int16/32/Float/Double）、字节序（ABCD/CDAB/BADC/DCBA）、寄存器长度智能纠错、点位拖拽排序、行业模版一键加载与 CSV/JSON 双向导入导出。
  - **2 路 4~20mA 模拟量输入诊断**：1Hz 动态平滑趋势图、断线/超量程/正常状态诊断、历史采样导出与硬件双色 LED 状态灯测试。
  - **系统维护与安全保护**：日志级别/上报周期修改、故障计数清零、系统软复位及 EEPROM 格式化双重二次防误触确认。
- **ST-Link 固件烧录流水线**：
  - 自动探测 `STM32_Programmer_CLI` 本地环境、支持多探针枚举、SWD 硬件复位烧录、实时分步进度追踪与产线一键流水线（烧录 $\to$ 写 SN）。
- **通用极速串口终端**：
  - 基于 Tokio Async Actor 模型的高吞吐串口引擎，支持 33ms 数据包聚合、ANSI 颜色代码解析、标签分级过滤与零拷贝数据流录制。
- **KZ3 工艺控制器**：
  - 提供工程组态与独立的 HTTP 在线调试工作模式；在线模式支持固定诊断、最多 12 点 PLC 风格监视表、质量/时效判断、受控北向写入、诊断侧栏和会话报告导出。
  - 提供独立的 UART1 设备初始化与维护工作台：固定 `115200 8N1`，结构化配置生产 SN、Ethernet、星闪 SLE、Controller/RTU_SLAVE 系统角色和调试日志；支持写前校验、写后查询、RUN/SAVED 与 ACTIVE/SAVED 对照、SLE 多层生效状态及会话记录导出。
  - 北向写入默认锁定，仅开放 BOOL/FLOAT parameter 和 BOOL command 的工程测试流程；开放入口不代表 HIL 或现场验证通过。使用前阅读 [KZ3 在线调试工具交付与现场使用说明](docs/KZ3在线调试工具交付与现场使用说明.md)。
- **STM32F407/F427 双星闪级联协调器**：
  - 提供 USART1 `115200 8N1` 设备识别与 `@STATUS` 周期监视，分别展示两颗 Radio 的角色、状态机、STA/READY、观测地址和错误计数，以及路由、点缓存、同步和 Ethernet 摘要。
  - 支持读取五类 EEPROM owner，并基于设备当前完整 JSON 进行 schema 校验、风险确认和受控写入；配置重启后要求重新识别与读回。同步完整规则读取和 Radio 深度观测仍依赖固件协议扩展，详见 [双星闪协调器桌面工具需求与当前集成说明](docs/STM32F407-F427双星闪协调器桌面工具需求与当前集成说明.md)。

---

## 💻 Windows 平台环境搭建与打包指南

在 Windows 10 / Windows 11 (x64 / ARM64) 系统上从零编译和打包本工具，需配置以下编译依赖。

### 1. 基础依赖环境清单

| 依赖项 | 最低版本要求 | 作用说明 | 推荐安装方式 |
| :--- | :--- | :--- | :--- |
| **C++ 构建工具 (MSVC)** | VS 2022 Build Tools (v143+) | Rust 底层 C/C++ 链接库与 Windows API 支持 | Visual Studio Installer |
| **Rust 工具链** | 1.78.0+ (stable-msvc) | Tauri 核心桌面后端编译 | `rustup` |
| **Node.js** | 18.18.0+ / 20.x+ (LTS) | 前端 Vue 3 + Vite 构建环境 | `winget` 或官网下载 |
| **pnpm** | 8.0.0+ | 前端包管理器（高效扁平依赖） | `npm install -g pnpm` |
| **WebView2 Runtime** | Evergreen (Win10已内置) | 桌面端 Chromium UI 渲染内核 | Win10 1803+ / Win11 自带 |
| **STM32CubeProgrammer** *(可选)* | 2.14.0+ | 产线固件烧录功能依赖 CLI 工具 | ST 官方安装包 |

---

### 2. 详细安装步骤 (Windows)

#### 步骤 1：安装 Visual Studio C++ 构建工具 (必须)
Rust 在 Windows 下编译需要 MSVC 编译器与 Windows SDK：
1. 下载并运行 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)。
2. 在安装工作负载界面中，勾选 **“使用 C++ 的桌面开发” (Desktop development with C++)**。
3. 确保右侧已选中：
   - MSVC v143 - VS 2022 C++ x64/x86 生成工具
   - Windows 10 SDK 或 Windows 11 SDK
4. 点击“安装”并等待完成。

> 💡 **通过 Windows 终端 (PowerShell 管理员) 一键安装**：
> ```powershell
> winget install Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools;includeRecommended"
> ```

#### 步骤 2：安装 Rust 工具链
1. 访问 [https://rustup.rs](https://rustup.rs) 下载 `rustup-init.exe` 并运行。
2. 提示选择安装模式时，直接回车选择 `1) Proceed with installation (default)`。
3. 安装完成后，重启 PowerShell 终端，执行以下命令验证：
   ```powershell
   rustc --version
   cargo --version
   ```

#### 步骤 3：安装 Node.js 与 pnpm
1. 访问 [Node.js 官网](https://nodejs.org/) 下载并安装 LTS 版本。
2. 打开终端，全局安装 `pnpm`：
   ```powershell
   npm install -g pnpm
   ```
3. 验证安装：
   ```powershell
   node -v
   pnpm -v
   ```

---

### 3. 项目获取与 Windows 端打包

```powershell
# 1. 克隆代码仓库
git clone https://codeup.aliyun.com/69e73307ed93e361ad3c3005/Iot/np-tools.git
cd np-tools

# 2. 安装前端项目依赖
pnpm install

# 3. 本地开发与联调 (启动带有热重载的桌面窗口)
pnpm tauri dev

# 4. 编译打包 Windows 安装包 (.exe / NSIS)
pnpm tauri build
```

#### 打包输出产物路径：
编译完成后，可在以下路径获取独立的 Windows 安装程序：
- **NSIS 一键安装包**：`src-tauri\target\release\bundle\nsis\NP-Tools_2.0.0_x64-setup.exe`
- **单文件便携可执行程序**：`src-tauri\target\release\np-tools.exe`

---

### 4. Windows 硬件运行环境与驱动说明

在 Windows 电脑上连接 SJZDV3 或 ST-Link 硬件时，请确保安装了对应的 USB 驱动：

1. **USB 转串口驱动（二选一）**：
   - **CH340 / CH341**：若调试板使用沁恒芯片，需安装 [CH341SER.EXE](http://www.wch.cn/downloads/CH341SER_EXE.html)。
   - **CP2102 / FTDI / CDC-ACM**：Win10/11 通常已自带驱动；插上后在“设备管理器 $\to$ 端口 (COM 和 LPT)”中显示为 `COM3`、`COM4` 等。
2. **ST-Link 烧录器驱动**：
   - 安装 STM32CubeProgrammer 时会自动附带安装 `ST-Link USB Driver`。
   - 默认 CLI 执行文件路径为：`C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe`。
   - 建议将上述路径添加至 Windows 系统环境变量 `PATH` 中。

---

## 🛠️ Windows 常见编译问题排查 (FAQ)

### Q1: 运行 `pnpm` 或脚本时提示 `禁止运行脚本 (PSSecurityException)`？
**解决办法**：在管理员 PowerShell 中执行以下命令开放执行策略：
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Q2: 编译时报错 `error: linker 'link.exe' not found`？
**解决办法**：说明电脑未正确安装 Visual Studio C++ 构建工具或未配置环境变量。请参考上述步骤 1 重新安装并确保勾选了 Windows SDK。

### Q3: 为什么 Windows 上无法打开某些 COM 串口？
**解决办法**：
- 检查该串口是否被其他串口助手（如 SSCOM、XCOM）占用；
- 确认是否已正确安装 CH340 或 CP210x 驱动；
- 在 NP-Tools 软件中点击右上角“刷新串口列表”并重新选择对应 COM 口。

---

## 📁 整体项目架构

```
np-tools/
├── src/                  # Vue 3 前端源码 (Composition API, Pinia, Router)
│   ├── api/              # Tauri IPC 接口封装与后端桥接
│   ├── assets/           # 应用静态资源、Logo 与图标
│   ├── components/       # 业务组件 (CustomSelect, Modal, GlobalSerialBar)
│   ├── router/           # 路由配置
│   ├── stores/           # Pinia 全局状态 (serialStore, sjzdStore, flashStore)
│   ├── types/            # 核心 TypeScript 类型定义 (Modbus, SLE, DevInfo)
│   └── views/            # 产品线页面与调试视图
│       ├── devices/sjzdv3/  # SJZDV3 采集终端视图 (概览/星闪/Modbus/维护)
│       ├── FlashView.vue    # ST-Link 固件烧录视图
│       ├── SerialView.vue   # 通用极速串口终端视图
│       └── SettingsView.vue # 系统全局偏好设置
├── src-tauri/            # Tauri 桌面端主程序 (Rust)
│   ├── capabilities/     # Tauri 2 窗口与系统权限沙箱配置 (default.json)
│   ├── icons/            # 全平台透明背景应用图标 (.ico, .icns, .png)
│   ├── src/lib.rs        # Tauri 命令注册与事件分发中枢
│   └── tauri.conf.json   # 桌面端窗口尺寸、标题栏样式与打包配置
├── crates/               # Rust 核心模块与子系统 Crates
│   ├── serial-core/      # 高吞吐串口通信引擎 (Tokio Async, Actor 模型)
│   ├── device-protocol/  # SJZDV3 现场协议编解码与 SLE/Modbus 正则比对
│   ├── flash-service/    # STM32_Programmer_CLI 子进程调度与进度解析
│   └── app-types/        # 跨模块共享 Rust 数据结构定义
├── docs/                 # 需求规格说明书与架构设计文档
├── package.json          # 前端依赖与构建命令
├── Cargo.toml            # Rust 工作区配置
└── vite.config.ts        # Vite 打包配置
```
