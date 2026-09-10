<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronUp,
  Download,
  File,
  Files,
  Folder,
  FolderInput,
  FolderOpen,
  FolderUp,
  Home,
  Key,
  Lock,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-vue-next'
import {
  sshSftpDownload,
  sshSftpListDir,
  sshSftpPickDownloadPath,
  sshSftpPickLocalDirectory,
  sshSftpPickLocalFiles,
  sshSftpPickPrivateKey,
  sshSftpProbe,
  sshSftpUpload,
} from '../api/sshSftpApi'
import type {
  SshAuthMethod,
  SshConnectionProbe,
  SshDirectoryListing,
  SshRemoteEntry,
  SshSftpProfile,
  SshTransferResult,
} from '../types/sshSftp'

const STORAGE_KEY = 'np_tools_ssh_sftp_profile_v1'
const MAX_TRANSFER_RECORDS = 12

type ConnectionState = 'disconnected' | 'connecting' | 'awaitingTrust' | 'ready' | 'error'
type LocalSelectionKind = 'files' | 'directory' | null

interface SavedProfile {
  host: string
  port: number
  username: string
  authMethod: SshAuthMethod
  privateKeyPath: string
  timeoutMs: number
}

interface TransferRecord {
  id: string
  at: string
  operation: 'upload' | 'download'
  files: number
  bytes: number
  target: string
  message: string
}

function defaultProfile(): SavedProfile {
  return {
    host: '',
    port: 22,
    username: '',
    authMethod: 'password',
    privateKeyPath: '',
    timeoutMs: 8_000,
  }
}

function loadProfile(): SavedProfile {
  const fallback = defaultProfile()
  if (typeof localStorage === 'undefined') return fallback
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<SavedProfile>
    return {
      host: typeof stored.host === 'string' ? stored.host : fallback.host,
      port: Number.isInteger(stored.port) ? Number(stored.port) : fallback.port,
      username: typeof stored.username === 'string' ? stored.username : fallback.username,
      authMethod: stored.authMethod === 'privateKey' ? 'privateKey' : 'password',
      privateKeyPath:
        typeof stored.privateKeyPath === 'string' ? stored.privateKeyPath : fallback.privateKeyPath,
      timeoutMs: Number.isInteger(stored.timeoutMs) ? Number(stored.timeoutMs) : fallback.timeoutMs,
    }
  } catch {
    return fallback
  }
}

const savedProfile = loadProfile()
const server = reactive({
  ...savedProfile,
  password: '',
  passphrase: '',
})
const connectionState = ref<ConnectionState>('disconnected')
const remoteHome = ref('')
const currentDirectory = ref('')
const remoteEntries = ref<SshRemoteEntry[]>([])
const selectedRemoteEntry = ref<SshRemoteEntry | null>(null)
const pendingFingerprint = ref('')
const localPaths = ref<string[]>([])
const localSelectionKind = ref<LocalSelectionKind>(null)
const transferRecords = ref<TransferRecord[]>([])
const isBusy = ref(false)
const statusMessage = ref('填写服务器信息后连接；首次连接会要求核对服务端主机密钥指纹。')
const isStatusError = ref(false)

const connectionReady = computed(() => connectionState.value === 'ready')
const selectedIsDirectory = computed(() => selectedRemoteEntry.value?.entryType === 'directory')
const selectedIsFile = computed(() => selectedRemoteEntry.value?.entryType === 'file')
const canUpload = computed(
  () => connectionReady.value && !isBusy.value && localPaths.value.length > 0 && Boolean(currentDirectory.value)
)
const canDownload = computed(() => connectionReady.value && !isBusy.value && selectedIsFile.value)
const stateLabel = computed(() => {
  const labels: Record<ConnectionState, string> = {
    disconnected: '未连接',
    connecting: '正在验证',
    awaitingTrust: '等待确认指纹',
    ready: 'SFTP 已验证',
    error: '连接失败',
  }
  return labels[connectionState.value]
})
const currentTargetLabel = computed(() => currentDirectory.value || '尚未定位远端目录')
const localSelectionLabel = computed(() => {
  if (localPaths.value.length === 0) return '尚未选择本机文件或文件夹'
  if (localSelectionKind.value === 'directory') return `目录：${basename(localPaths.value[0])}`
  return `已选 ${localPaths.value.length} 个文件`
})

function persistProfile() {
  if (typeof localStorage === 'undefined') return
  const profile: SavedProfile = {
    host: server.host.trim(),
    port: Number(server.port),
    username: server.username.trim(),
    authMethod: server.authMethod,
    privateKeyPath: server.privateKeyPath,
    timeoutMs: Number(server.timeoutMs),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
}

watch(server, persistProfile, { deep: true })

watch(
  [
    () => server.host,
    () => server.port,
    () => server.username,
    () => server.authMethod,
    () => server.password,
    () => server.privateKeyPath,
    () => server.passphrase,
    () => server.timeoutMs,
  ],
  () => {
    if (isBusy.value || connectionState.value === 'disconnected') return
    clearRemoteState()
    connectionState.value = 'disconnected'
    statusMessage.value = '连接资料已变更，请重新验证 SSH / SFTP 连接。'
    isStatusError.value = false
  }
)

function profilePayload(): SshSftpProfile {
  return {
    host: server.host.trim(),
    port: Number(server.port),
    username: server.username.trim(),
    authMethod: server.authMethod,
    password: server.authMethod === 'password' ? server.password : undefined,
    privateKeyPath: server.authMethod === 'privateKey' ? server.privateKeyPath : undefined,
    passphrase: server.authMethod === 'privateKey' ? server.passphrase : undefined,
    timeoutMs: Number(server.timeoutMs),
  }
}

function validateProfile() {
  const host = server.host.trim()
  if (!host || /[\s/@?#\\]/.test(host)) {
    throw new Error('SSH 主机只能填写 IP 或主机名，不得包含协议、路径或用户信息')
  }
  const port = Number(server.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('SSH 端口必须在 1 到 65535 之间')
  }
  if (!server.username.trim() || /\s/.test(server.username.trim())) {
    throw new Error('SSH 用户名不能为空，且不得包含空白字符')
  }
  const timeout = Number(server.timeoutMs)
  if (!Number.isInteger(timeout) || timeout < 500 || timeout > 30_000) {
    throw new Error('SSH 超时必须在 500 到 30000 ms 之间')
  }
  if (server.authMethod === 'privateKey' && !server.privateKeyPath) {
    throw new Error('请选择私钥文件后再连接')
  }
}

function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error:\s*/, '') || '未知 SSH/SFTP 错误'
}

function setStatus(message: string, error = false) {
  statusMessage.value = message
  isStatusError.value = error
}

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).filter(Boolean).pop() || path
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`
}

function formatRemoteTime(timestamp?: number): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp * 1000)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function clock(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function clearRemoteState() {
  remoteHome.value = ''
  currentDirectory.value = ''
  remoteEntries.value = []
  selectedRemoteEntry.value = null
  pendingFingerprint.value = ''
}

function applyListing(listing: SshDirectoryListing) {
  currentDirectory.value = listing.path
  remoteEntries.value = listing.entries
  selectedRemoteEntry.value = null
  if (listing.truncated) {
    setStatus(`已载入 ${listing.entries.length} 项；该目录项目过多，列表已截断。`)
  }
}

async function readDirectory(path: string) {
  const listing = await sshSftpListDir(profilePayload(), path)
  applyListing(listing)
  return listing
}

async function connect(trustUnknownHost = false) {
  if (isBusy.value) return
  try {
    validateProfile()
    isBusy.value = true
    connectionState.value = 'connecting'
    setStatus('正在建立 SSH 连接并校验服务端主机密钥…')
    const probe: SshConnectionProbe = await sshSftpProbe(profilePayload(), trustUnknownHost)
    if (probe.state === 'host_key_untrusted') {
      pendingFingerprint.value = probe.fingerprint
      connectionState.value = 'awaitingTrust'
      setStatus(probe.message)
      return
    }
    remoteHome.value = probe.remoteHome || '.'
    currentDirectory.value = remoteHome.value
    connectionState.value = 'ready'
    await readDirectory(remoteHome.value)
    setStatus(`${probe.message} 当前上传目标：${currentDirectory.value}`)
  } catch (error) {
    clearRemoteState()
    connectionState.value = 'error'
    setStatus(`连接未完成：${formatError(error)}`, true)
  } finally {
    isBusy.value = false
  }
}

function disconnect() {
  connectionState.value = 'disconnected'
  clearRemoteState()
  server.password = ''
  server.passphrase = ''
  setStatus('已清空当前页面的密码和私钥口令；服务器资料仍保留，需重新连接后操作。')
}

async function refreshDirectory() {
  if (!connectionReady.value || isBusy.value) return
  try {
    isBusy.value = true
    await readDirectory(currentDirectory.value)
    setStatus(`已刷新远端目录：${currentDirectory.value}`)
  } catch (error) {
    setStatus(`刷新远端目录失败：${formatError(error)}`, true)
  } finally {
    isBusy.value = false
  }
}

async function openDirectory(path: string) {
  if (!connectionReady.value || isBusy.value) return
  try {
    isBusy.value = true
    await readDirectory(path)
    setStatus(`远端上传目标已切换为：${currentDirectory.value}`)
  } catch (error) {
    setStatus(`无法进入远端目录：${formatError(error)}`, true)
  } finally {
    isBusy.value = false
  }
}

function parentDirectory(path: string): string {
  const normalized = path.replace(/\/+$/, '') || '/'
  if (normalized === '/') return '/'
  const parent = normalized.slice(0, normalized.lastIndexOf('/'))
  return parent || '/'
}

function selectRemoteEntry(entry: SshRemoteEntry) {
  selectedRemoteEntry.value = selectedRemoteEntry.value?.path === entry.path ? null : entry
}

function openSelectedDirectory() {
  if (!selectedRemoteEntry.value || selectedRemoteEntry.value.entryType !== 'directory') return
  void openDirectory(selectedRemoteEntry.value.path)
}

async function choosePrivateKey() {
  if (isBusy.value) return
  try {
    isBusy.value = true
    setStatus('请选择 SSH 私钥文件；关闭系统窗口可取消。')
    const selected = await sshSftpPickPrivateKey()
    if (selected) {
      server.privateKeyPath = selected
      setStatus(`已选择私钥：${basename(selected)}；私钥口令仅保留在当前页面。`)
    } else {
      setStatus('已取消选择 SSH 私钥。')
    }
  } catch (error) {
    setStatus(`选择私钥失败：${formatError(error)}`, true)
  } finally {
    isBusy.value = false
  }
}

async function chooseLocalFiles() {
  if (isBusy.value) return
  try {
    isBusy.value = true
    setStatus('请选择要上传的一个或多个文件；关闭系统窗口可取消。')
    const selected = await sshSftpPickLocalFiles()
    if (selected.length > 0) {
      localPaths.value = selected
      localSelectionKind.value = 'files'
      setStatus(`已选择 ${selected.length} 个本机文件，待上传到 ${currentTargetLabel.value}。`)
    } else {
      setStatus('已取消选择上传文件，原有选择保持不变。')
    }
  } catch (error) {
    setStatus(`选择本机文件失败：${formatError(error)}`, true)
  } finally {
    isBusy.value = false
  }
}

async function chooseLocalDirectory() {
  if (isBusy.value) return
  try {
    isBusy.value = true
    setStatus('请选择要整体上传的文件夹；关闭系统窗口可取消。')
    const selected = await sshSftpPickLocalDirectory()
    if (selected) {
      localPaths.value = [selected]
      localSelectionKind.value = 'directory'
      setStatus(`已选择目录「${basename(selected)}」，上传时会保留该目录及其内部层级。`)
    } else {
      setStatus('已取消选择上传目录，原有选择保持不变。')
    }
  } catch (error) {
    setStatus(`选择本机目录失败：${formatError(error)}`, true)
  } finally {
    isBusy.value = false
  }
}

function clearLocalSelection() {
  localPaths.value = []
  localSelectionKind.value = null
  setStatus('已移除待上传的本机选择。')
}

function addTransferRecord(result: SshTransferResult) {
  transferRecords.value.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: clock(),
    operation: result.operation,
    files: result.files,
    bytes: result.bytes,
    target: result.operation === 'download' ? result.localPath || result.remotePath : result.remotePath,
    message: result.message,
  })
  transferRecords.value.splice(MAX_TRANSFER_RECORDS)
}

const overwriteEnabled = ref(false)

async function uploadWithOverwrite() {
  if (!canUpload.value) return
  try {
    isBusy.value = true
    setStatus(`正在上传到 ${currentDirectory.value}…`)
    const result = await sshSftpUpload(
      profilePayload(),
      currentDirectory.value,
      localPaths.value,
      overwriteEnabled.value
    )
    addTransferRecord(result)
    setStatus(result.message)
    await readDirectory(currentDirectory.value)
  } catch (error) {
    setStatus(`上传失败：${formatError(error)}`, true)
  } finally {
    isBusy.value = false
  }
}

async function downloadSelected() {
  const selected = selectedRemoteEntry.value
  if (!selected || !connectionReady.value || isBusy.value) return
  if (selected.entryType !== 'file') {
    setStatus('仅支持下载远端单个普通文件；目录下载暂不开放。', true)
    return
  }
  try {
    isBusy.value = true
    setStatus(`请选择 ${selected.name} 的本机保存位置；关闭系统窗口可取消。`)
    const localPath = await sshSftpPickDownloadPath(selected.name)
    if (!localPath) {
      setStatus('已取消选择本机下载位置。')
      return
    }
    setStatus(`正在下载 ${selected.name}…`)
    const result = await sshSftpDownload(profilePayload(), selected.path, localPath)
    addTransferRecord(result)
    setStatus(result.message)
  } catch (error) {
    setStatus(`下载失败：${formatError(error)}`, true)
  } finally {
    isBusy.value = false
  }
}
</script>

<template>
  <main class="ssh-sftp-workbench">
    <header class="station-header">
      <div class="station-title">
        <div class="station-mark"><FolderInput :size="23" /></div>
        <div>
          <div class="eyebrow">NP-TOOLS · REMOTE FILE WORKBENCH</div>
          <h1>SSH / SFTP 文件传输</h1>
          <p>核验服务器身份后浏览远端目录；上传单文件或整目录，并下载选中的单个远端文件。</p>
        </div>
      </div>
      <div class="connection-state" :class="connectionState">
        <span class="status-dot" />
        <div>
          <strong>{{ stateLabel }}</strong>
          <code>{{ connectionReady ? `目标：${server.username}@${server.host}:${server.port}` : 'SFTP 文件子系统 · 不开放远程 Shell' }}</code>
        </div>
      </div>
    </header>

    <section class="connection-card" aria-label="SSH 服务器连接资料">
      <div class="connection-heading">
        <div>
          <h2><Server :size="17" />服务器身份与认证</h2>
          <p>服务器资料可留在本机；密码和私钥口令只存于当前页面内存，离开或断开后即清空。</p>
        </div>
        <div class="connection-actions">
          <button
            v-if="!connectionReady && connectionState !== 'awaitingTrust'"
            type="button"
            class="primary-action"
            :disabled="isBusy"
            @click="connect()"
          >
            <ShieldCheck :size="15" />连接并验证
          </button>
          <button
            v-else-if="connectionState === 'awaitingTrust'"
            type="button"
            class="trust-action"
            :disabled="isBusy"
            @click="connect(true)"
          >
            <ShieldCheck :size="15" />确认指纹并信任
          </button>
          <button v-else type="button" class="quiet-action" :disabled="isBusy" @click="disconnect">
            <X :size="15" />断开并清空凭据
          </button>
        </div>
      </div>

      <div class="server-fields">
        <label class="field host-field">
          <span>主机 IP / 名称</span>
          <input v-model.trim="server.host" :disabled="isBusy" autocomplete="off" placeholder="192.168.30.66">
        </label>
        <label class="field port-field">
          <span>SSH 端口</span>
          <input v-model.number="server.port" :disabled="isBusy" type="number" min="1" max="65535" inputmode="numeric">
        </label>
        <label class="field user-field">
          <span>用户名</span>
          <input v-model.trim="server.username" :disabled="isBusy" autocomplete="username" placeholder="operator">
        </label>
        <label class="field timeout-field">
          <span>连接超时 (ms)</span>
          <input v-model.number="server.timeoutMs" :disabled="isBusy" type="number" min="500" max="30000" step="500" inputmode="numeric">
        </label>
      </div>

      <div class="auth-panel">
        <div class="auth-switch" role="tablist" aria-label="SSH 认证方法">
          <button
            type="button"
            class="auth-tab"
            :class="{ active: server.authMethod === 'password' }"
            :disabled="isBusy"
            role="tab"
            :aria-selected="server.authMethod === 'password'"
            @click="server.authMethod = 'password'"
          >
            <Lock :size="15" />密码 / 空密码
          </button>
          <button
            type="button"
            class="auth-tab"
            :class="{ active: server.authMethod === 'privateKey' }"
            :disabled="isBusy"
            role="tab"
            :aria-selected="server.authMethod === 'privateKey'"
            @click="server.authMethod = 'privateKey'"
          >
            <Key :size="15" />私钥登录
          </button>
        </div>

        <div v-if="server.authMethod === 'password'" class="auth-fields">
          <label class="field credential-field">
            <span>SSH 密码（可留空）</span>
            <input v-model="server.password" :disabled="isBusy" type="password" autocomplete="current-password" placeholder="留空时尝试空密码认证">
          </label>
          <small><Lock :size="13" />留空时仍可连接；服务器若不接受空密码会返回认证错误。密码不会写入本机配置或传输记录。</small>
        </div>
        <div v-else class="auth-fields key-auth-fields">
          <label class="field key-path-field">
            <span>私钥文件</span>
            <input :value="server.privateKeyPath" :disabled="isBusy" readonly placeholder="选择 PEM / OpenSSH 私钥">
          </label>
          <button type="button" class="quiet-action pick-key" :disabled="isBusy" @click="choosePrivateKey">
            <Key :size="14" />选择私钥
          </button>
          <label class="field passphrase-field">
            <span>私钥口令（如有）</span>
            <input v-model="server.passphrase" :disabled="isBusy" type="password" autocomplete="off" placeholder="仅当前页面使用">
          </label>
        </div>
      </div>
    </section>

    <section v-if="connectionState === 'awaitingTrust'" class="trust-card" aria-label="SSH 主机密钥确认">
      <ShieldAlert :size="20" />
      <div>
        <strong>首次连接：先核对服务端主机密钥</strong>
        <p>请向服务器运维人员核实下面的 SHA-256 指纹。确认无误后点击“确认指纹并信任”；工具会只在自己的 <code>known_hosts</code> 中保存这台服务器的公钥记录。</p>
        <code class="fingerprint">{{ pendingFingerprint }}</code>
      </div>
    </section>

    <section class="scope-strip" aria-label="工具操作范围">
      <ShieldCheck :size="17" />
      <div>
        <strong>受控的文件传输范围</strong>
        <span>仅启用 SFTP 浏览、上传和单文件下载；不提供远程命令执行、终端、端口转发或目录下载。上传默认禁止同名覆盖。</span>
      </div>
    </section>

    <div class="workbench-grid">
      <section class="remote-panel">
        <div class="panel-heading">
          <div>
            <h2><FolderOpen :size="18" />远端目录</h2>
            <p>当前目录即上传目标；双击文件夹进入，选中普通文件后可下载。</p>
          </div>
          <span class="entry-count">{{ remoteEntries.length }} 项</span>
        </div>

        <template v-if="connectionReady">
          <div class="remote-toolbar">
            <button type="button" class="icon-action" :disabled="isBusy || currentDirectory === '/'" title="返回上级目录" @click="openDirectory(parentDirectory(currentDirectory))">
              <ChevronUp :size="16" />
            </button>
            <button type="button" class="icon-action" :disabled="isBusy" title="进入远端家目录" @click="openDirectory(remoteHome)">
              <Home :size="16" />
            </button>
            <label class="remote-path-field">
              <span class="sr-only">远端目录路径</span>
              <input v-model.trim="currentDirectory" :disabled="isBusy" spellcheck="false" @keyup.enter="openDirectory(currentDirectory)">
            </label>
            <button type="button" class="icon-action" :disabled="isBusy" title="按路径打开目录" @click="openDirectory(currentDirectory)">
              <FolderOpen :size="16" />
            </button>
            <button type="button" class="icon-action" :disabled="isBusy" title="刷新当前目录" @click="refreshDirectory">
              <RefreshCw :size="16" />
            </button>
          </div>

          <div class="remote-list" role="listbox" aria-label="远端文件列表">
            <button
              v-for="entry in remoteEntries"
              :key="entry.path"
              type="button"
              class="remote-row"
              :class="{ selected: selectedRemoteEntry?.path === entry.path, unsupported: entry.entryType === 'other' }"
              :aria-selected="selectedRemoteEntry?.path === entry.path"
              @click="selectRemoteEntry(entry)"
              @dblclick="entry.entryType === 'directory' ? openDirectory(entry.path) : selectRemoteEntry(entry)"
            >
              <Folder v-if="entry.entryType === 'directory'" :size="17" class="directory-icon" />
              <File v-else :size="17" :class="entry.entryType === 'file' ? 'file-icon' : 'other-icon'" />
              <span class="remote-name" :title="entry.path">{{ entry.name }}</span>
              <span class="remote-size">{{ entry.entryType === 'directory' ? '目录' : formatBytes(entry.size) }}</span>
              <span class="remote-time">{{ formatRemoteTime(entry.modifiedAt) }}</span>
            </button>
            <div v-if="remoteEntries.length === 0" class="empty-list">
              <FolderOpen :size="20" />当前目录没有可显示的文件或子目录。
            </div>
          </div>

          <div class="remote-selection">
            <template v-if="selectedRemoteEntry">
              <div>
                <strong>{{ selectedRemoteEntry.name }}</strong>
                <span>{{ selectedRemoteEntry.entryType === 'directory' ? '远端目录，可作为上传目标' : selectedRemoteEntry.entryType === 'file' ? '远端普通文件，可下载一次' : '特殊文件，不开放传输' }}</span>
              </div>
              <button v-if="selectedIsDirectory" type="button" class="quiet-action" :disabled="isBusy" @click="openSelectedDirectory">
                <FolderOpen :size="14" />设为上传目标
              </button>
            </template>
            <span v-else>选中一项查看可执行操作。</span>
          </div>
        </template>
        <div v-else class="locked-panel">
          <Server :size="24" />
          <strong>等待 SSH / SFTP 验证</strong>
          <span>连接成功后才会向该服务器读取目录内容。</span>
        </div>
      </section>

      <section class="transfer-panel">
        <div class="panel-heading">
          <div>
            <h2><Upload :size="18" />文件传输</h2>
            <p>先定位目标目录，再选择本机源文件或完整目录。</p>
          </div>
          <span class="target-badge" :class="{ ready: connectionReady }">{{ connectionReady ? '目标已定位' : '待连接' }}</span>
        </div>

        <div class="transfer-block upload-block">
          <div class="block-title">
            <div>
              <span class="step">01</span>
              <strong>上传到当前远端目录</strong>
            </div>
            <code :title="currentTargetLabel">{{ currentTargetLabel }}</code>
          </div>

          <div class="source-actions">
            <button type="button" class="secondary-action" :disabled="isBusy" @click="chooseLocalFiles">
              <Files :size="15" />选择文件
            </button>
            <button type="button" class="secondary-action" :disabled="isBusy" @click="chooseLocalDirectory">
              <FolderUp :size="15" />选择整个文件夹
            </button>
          </div>

          <div class="local-selection" :class="{ populated: localPaths.length > 0 }">
            <FolderUp v-if="localSelectionKind === 'directory'" :size="18" />
            <Files v-else :size="18" />
            <div>
              <strong>{{ localSelectionLabel }}</strong>
              <span v-if="localPaths.length > 0" :title="localPaths.join('\n')">{{ localSelectionKind === 'directory' ? localPaths[0] : localPaths.map(basename).join(' · ') }}</span>
              <span v-else>文件夹上传会保留选择的根文件夹和内部层级。</span>
            </div>
            <button v-if="localPaths.length > 0" type="button" class="remove-selection" :disabled="isBusy" title="移除选择" @click="clearLocalSelection">
              <X :size="15" />
            </button>
          </div>

          <label class="overwrite-toggle">
            <input v-model="overwriteEnabled" :disabled="isBusy" type="checkbox">
            <span>允许覆盖远端同名文件</span>
            <small>默认关闭；目录结构可创建，但已有文件不会被静默替换。</small>
          </label>

          <button type="button" class="primary-action upload-action" :disabled="!canUpload" @click="uploadWithOverwrite">
            <Upload :size="16" />上传{{ localSelectionKind === 'directory' ? '整个文件夹' : '已选文件' }}
          </button>
        </div>

        <div class="transfer-block download-block">
          <div class="block-title">
            <div>
              <span class="step">02</span>
              <strong>下载选中的远端文件</strong>
            </div>
            <code>{{ selectedRemoteEntry?.name || '未选择' }}</code>
          </div>
          <p v-if="selectedIsDirectory" class="download-note warning"><AlertTriangle :size="14" />当前选择是目录；目录下载暂不开放，请选择单个文件。</p>
          <p v-else class="download-note"><Download :size="14" />保存位置由系统文件选择器确认；工具不会覆盖本机已有文件。</p>
          <button type="button" class="secondary-action download-action" :disabled="!canDownload" @click="downloadSelected">
            <Download :size="16" />下载选中文件
          </button>
        </div>
      </section>
    </div>

    <section class="status-footer" :class="{ error: isStatusError }" aria-live="polite">
      <CheckCircle2 v-if="!isStatusError" :size="15" />
      <AlertTriangle v-else :size="15" />
      <span>{{ statusMessage }}</span>
    </section>

    <section class="transfer-log" aria-label="当前页面传输记录">
      <div class="log-heading">
        <div>
          <h2>当前页面传输记录</h2>
          <p>只记录操作结果与路径，不记录密码、私钥口令或文件内容。</p>
        </div>
        <span>{{ transferRecords.length }} / {{ MAX_TRANSFER_RECORDS }}</span>
      </div>
      <div v-if="transferRecords.length" class="log-list">
        <div v-for="record in transferRecords" :key="record.id" class="log-row">
          <span class="log-operation" :class="record.operation">{{ record.operation === 'upload' ? '上传' : '下载' }}</span>
          <strong>{{ record.message }}</strong>
          <code :title="record.target">{{ record.target }}</code>
          <span>{{ record.files }} 文件 · {{ formatBytes(record.bytes) }} · {{ record.at }}</span>
        </div>
      </div>
      <div v-else class="empty-log">本页尚未执行上传或下载。</div>
    </section>
  </main>
</template>

<style scoped>
.ssh-sftp-workbench { min-height: 100%; padding: 16px; color: #17212b; background: #edf1f4; }
.station-header, .station-title, .connection-state, .connection-heading, .connection-actions, .panel-heading, .remote-toolbar, .remote-selection, .block-title, .source-actions, .local-selection, .overwrite-toggle, .status-footer, .log-heading, .log-row { display: flex; align-items: center; }
.station-header { justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.station-title { min-width: 0; gap: 11px; }
.station-mark { display: grid; width: 43px; height: 43px; flex: 0 0 auto; place-items: center; color: #fff; border: 1px solid #1f5774; border-radius: 8px; background: linear-gradient(145deg, #34799a, #1f5673); box-shadow: inset 0 1px 0 rgba(255,255,255,.2); }
.eyebrow { margin-bottom: 2px; color: #487286; font-size: 11px; font-weight: 800; letter-spacing: .08em; }
h1, h2, p { margin: 0; }
h1 { color: #142c3b; font-size: 20px; letter-spacing: -.02em; }
.station-title p { margin-top: 3px; color: #60717a; font-size: 13px; line-height: 1.45; }
.connection-state { min-width: 238px; gap: 9px; padding: 9px 11px; border: 1px solid #cbd8de; border-radius: 7px; background: #f9fbfc; }
.connection-state strong { display: block; color: #264859; font-size: 13px; }
.connection-state code { display: block; max-width: 270px; overflow: hidden; color: #6b7e87; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.status-dot { width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: #82939d; box-shadow: 0 0 0 4px rgba(130,147,157,.12); }
.connecting .status-dot { background: #bf7b1d; box-shadow: 0 0 0 4px rgba(191,123,29,.13); }
.awaitingTrust .status-dot { background: #bd7020; box-shadow: 0 0 0 4px rgba(189,112,32,.13); }
.ready .status-dot { background: #198257; box-shadow: 0 0 0 4px rgba(25,130,87,.13); }
.error .status-dot { background: #a73831; box-shadow: 0 0 0 4px rgba(167,56,49,.13); }
.connection-card, .remote-panel, .transfer-panel, .transfer-log { border: 1px solid #ced9df; border-radius: 8px; background: #fff; box-shadow: 0 1px 2px rgba(37,61,72,.04); }
.connection-card { padding: 14px; }
.connection-heading, .panel-heading, .log-heading { justify-content: space-between; gap: 14px; }
.connection-heading h2, .panel-heading h2, .log-heading h2 { display: flex; align-items: center; gap: 6px; color: #244757; font-size: 15px; }
.connection-heading p, .panel-heading p, .log-heading p { margin-top: 3px; color: #73828a; font-size: 12px; line-height: 1.45; }
.connection-actions { flex: 0 0 auto; gap: 7px; }
.server-fields { display: grid; grid-template-columns: minmax(200px, 1.5fr) 104px minmax(165px, 1fr) 136px; gap: 12px; margin-top: 14px; }
.field { display: grid; min-width: 0; gap: 5px; }
.field > span { color: #526771; font-size: 11px; font-weight: 800; letter-spacing: .02em; }
input { width: 100%; min-width: 0; min-height: 34px; box-sizing: border-box; padding: 7px 8px; color: #1d303a; font: inherit; font-size: 13px; border: 1px solid #c5d2d9; border-radius: 5px; outline: none; background: #fbfcfc; transition: border-color .16s ease, box-shadow .16s ease; }
input:focus { border-color: #34799a; box-shadow: 0 0 0 3px rgba(52,121,154,.12); background: #fff; }
input:disabled { cursor: not-allowed; color: #829099; background: #f1f4f5; }
.auth-panel { display: flex; align-items: stretch; gap: 13px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e8eb; }
.auth-switch { display: flex; flex: 0 0 auto; flex-direction: column; width: 126px; gap: 4px; padding-right: 12px; border-right: 1px solid #e0e8eb; }
.auth-tab { display: flex; align-items: center; justify-content: flex-start; gap: 6px; min-height: 34px; padding: 7px 8px; color: #61737c; font: inherit; font-size: 12px; font-weight: 700; border: 1px solid transparent; border-radius: 5px; background: transparent; cursor: pointer; }
.auth-tab:hover:not(:disabled) { background: #f0f5f7; }
.auth-tab.active { color: #1f5d7a; border-color: #b8d0da; background: #e7f1f4; }
.auth-tab:disabled { cursor: not-allowed; opacity: .58; }
.auth-fields { display: flex; align-items: end; flex-wrap: wrap; min-width: 0; flex: 1; gap: 10px; }
.credential-field { max-width: 290px; flex: 1; }
.auth-fields small { display: flex; align-items: center; gap: 4px; padding-bottom: 9px; color: #6e7e86; font-size: 11px; line-height: 1.35; }
.key-auth-fields { display: grid; grid-template-columns: minmax(220px, 1.5fr) auto minmax(180px, 1fr); align-items: end; }
.pick-key { margin-bottom: 1px; white-space: nowrap; }
.trust-card, .scope-strip { display: flex; align-items: flex-start; gap: 9px; margin-top: 12px; padding: 10px 12px; border-radius: 7px; }
.trust-card { color: #75451c; border: 1px solid #e5bd82; background: #fff6e9; }
.trust-card strong, .scope-strip strong { display: block; font-size: 13px; }
.trust-card p { margin-top: 3px; color: #775b3a; font-size: 12px; line-height: 1.55; }
.trust-card code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.fingerprint { display: inline-block; margin-top: 7px; padding: 6px 8px; color: #713f19; font-size: 11px; word-break: break-all; border: 1px solid #ead1a7; border-radius: 4px; background: rgba(255,255,255,.62); }
.scope-strip { color: #315d4c; border: 1px solid #bfdbcd; background: #f0f8f3; }
.scope-strip span { display: block; margin-top: 2px; color: #537064; font-size: 12px; line-height: 1.5; }
.workbench-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(330px, .9fr); gap: 12px; margin-top: 12px; }
.remote-panel, .transfer-panel { min-width: 0; padding: 13px; }
.entry-count, .target-badge { flex: 0 0 auto; padding: 4px 8px; color: #667982; font-size: 11px; font-weight: 800; border: 1px solid #d8e1e5; border-radius: 99px; background: #f5f8f9; }
.target-badge.ready { color: #287252; border-color: #bfdbc9; background: #eff8f2; }
.remote-toolbar { gap: 5px; margin-top: 12px; padding: 6px; border: 1px solid #d5e0e4; border-radius: 6px; background: #f5f8f9; }
.icon-action, .remove-selection { display: inline-grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; color: #47616d; border: 1px solid #cbd8de; border-radius: 4px; background: #fff; cursor: pointer; }
.icon-action:hover:not(:disabled), .remove-selection:hover:not(:disabled) { color: #1d5b78; border-color: #9cbecb; background: #edf5f7; }
.icon-action:disabled, .remove-selection:disabled { cursor: not-allowed; opacity: .48; }
.remote-path-field { flex: 1; min-width: 0; }
.remote-path-field input { height: 32px; min-height: 32px; padding: 5px 7px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.remote-list { min-height: 278px; max-height: 420px; margin-top: 9px; overflow: auto; border: 1px solid #d6e0e4; border-radius: 6px; background: #fbfcfc; }
.remote-row { display: grid; width: 100%; grid-template-columns: 20px minmax(110px, 1fr) 78px 134px; align-items: center; gap: 5px; box-sizing: border-box; padding: 7px 8px; color: #2b3d46; text-align: left; border: 0; border-bottom: 1px solid #e7edef; background: transparent; cursor: pointer; }
.remote-row:last-child { border-bottom: 0; }
.remote-row:hover { background: #f0f6f8; }
.remote-row.selected { color: #1e5872; background: #e4f0f4; box-shadow: inset 3px 0 0 #34799a; }
.remote-row.unsupported { color: #87939a; }
.directory-icon { color: #b47b24; }.file-icon { color: #467d98; }.other-icon { color: #939ca1; }
.remote-name { min-width: 0; overflow: hidden; font-size: 13px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.remote-size, .remote-time { color: #75858d; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; text-align: right; white-space: nowrap; }
.empty-list, .locked-panel { display: grid; min-height: 180px; place-items: center; align-content: center; gap: 6px; color: #74838b; font-size: 12px; text-align: center; }
.locked-panel strong { color: #506a76; font-size: 13px; }.locked-panel span { color: #839198; }
.remote-selection { min-height: 40px; justify-content: space-between; gap: 12px; margin-top: 9px; padding: 8px 9px; color: #708088; font-size: 12px; border: 1px solid #dce5e8; border-radius: 5px; background: #f7fafb; }
.remote-selection > div { min-width: 0; }.remote-selection strong { display: block; overflow: hidden; color: #2d4c5b; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.remote-selection span { display: block; margin-top: 2px; font-size: 11px; }
.transfer-panel { display: flex; flex-direction: column; }
.transfer-block { padding: 12px 0; }.transfer-block + .transfer-block { border-top: 1px solid #e1e8eb; }
.block-title { justify-content: space-between; gap: 9px; }.block-title > div { display: flex; align-items: center; gap: 6px; min-width: 0; color: #345260; font-size: 13px; }.step { display: inline-grid; width: 20px; height: 20px; flex: 0 0 auto; place-items: center; color: #fff; font-size: 11px; font-weight: 800; border-radius: 50%; background: #407f98; }.block-title code { max-width: 52%; overflow: hidden; color: #68808b; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.source-actions { gap: 8px; margin-top: 11px; }.secondary-action, .primary-action, .quiet-action, .trust-action { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 6px 10px; font: inherit; font-size: 12px; font-weight: 800; border-radius: 5px; cursor: pointer; transition: border-color .16s ease, background .16s ease, color .16s ease; }.primary-action { color: #fff; border: 1px solid #25627f; background: #2f718f; }.primary-action:hover:not(:disabled) { border-color: #1b5571; background: #245f7c; }.secondary-action { color: #2e657d; border: 1px solid #a9c5d0; background: #f1f7f9; }.secondary-action:hover:not(:disabled) { border-color: #7eabbc; background: #e4f0f3; }.quiet-action { color: #526b76; border: 1px solid #ccd8dd; background: #fff; }.quiet-action:hover:not(:disabled) { color: #245f7c; border-color: #9ebac5; background: #edf5f7; }.trust-action { color: #fff; border: 1px solid #a9691f; background: #b9701e; }.trust-action:hover:not(:disabled) { background: #995c19; }.primary-action:disabled, .secondary-action:disabled, .quiet-action:disabled, .trust-action:disabled { cursor: not-allowed; opacity: .48; }
.local-selection { min-height: 46px; gap: 8px; margin-top: 9px; padding: 8px; color: #76858c; border: 1px dashed #cdd9de; border-radius: 5px; background: #fbfcfc; }.local-selection.populated { color: #4b798d; border-style: solid; border-color: #b9d0d9; background: #f1f7f9; }.local-selection > div { min-width: 0; flex: 1; }.local-selection strong, .local-selection span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.local-selection strong { color: #3d5d6b; font-size: 12px; }.local-selection span { margin-top: 2px; color: #6e8089; font-size: 11px; }
.overwrite-toggle { display: grid; grid-template-columns: 15px 1fr; align-items: start; gap: 4px 7px; margin-top: 9px; color: #5a6b73; font-size: 12px; cursor: pointer; }.overwrite-toggle input { width: 14px; min-height: 14px; height: 14px; margin: 0; accent-color: #2f718f; }.overwrite-toggle small { grid-column: 2; color: #819099; font-size: 11px; line-height: 1.4; }
.upload-action { width: 100%; margin-top: 11px; }.download-note { display: flex; align-items: center; gap: 5px; margin: 10px 0; color: #708089; font-size: 12px; line-height: 1.5; }.download-note.warning { color: #9a601e; }.download-action { width: 100%; }
.status-footer { gap: 6px; margin: 10px 2px 0; padding: 5px 1px; color: #396353; font-size: 12px; }.status-footer.error { color: #9b342d; }
.transfer-log { margin-top: 10px; overflow: hidden; }.log-heading { padding: 11px 13px; border-bottom: 1px solid #e0e8eb; }.log-heading > span { color: #70828b; font-size: 11px; }.log-list { max-height: 260px; overflow: auto; }.log-row { display: grid; grid-template-columns: 50px minmax(150px, .9fr) minmax(190px, 1.5fr) auto; gap: 10px; padding: 10px 13px; border-bottom: 1px solid #e9eef0; }.log-row:last-child { border-bottom: 0; }.log-operation { padding: 3px 5px; color: #246580; font-size: 11px; font-weight: 800; text-align: center; border-radius: 3px; background: #e2f0f4; }.log-operation.download { color: #73521d; background: #f7edd9; }.log-row strong { min-width: 0; overflow: hidden; color: #3c535e; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.log-row code { min-width: 0; overflow: hidden; color: #70828c; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.log-row > span:last-child { color: #788890; font-size: 11px; white-space: nowrap; }.empty-log { padding: 18px 13px; color: #7b8991; font-size: 12px; text-align: center; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 1020px) { .workbench-grid { grid-template-columns: 1fr; }.transfer-panel { display: block; }.server-fields { grid-template-columns: minmax(180px, 1.5fr) 100px minmax(140px, 1fr); }.timeout-field { grid-column: span 1; }.remote-list { max-height: 300px; } }
@media (max-width: 700px) { .ssh-sftp-workbench { padding: 10px; }.station-header, .connection-heading, .panel-heading, .log-heading { align-items: flex-start; flex-direction: column; }.connection-state { min-width: 0; width: 100%; box-sizing: border-box; }.connection-actions { width: 100%; }.connection-actions button { flex: 1; }.server-fields, .key-auth-fields { grid-template-columns: 1fr 1fr; }.host-field, .user-field, .key-path-field { grid-column: span 2; }.auth-panel { display: block; }.auth-switch { flex-direction: row; width: auto; padding: 0 0 10px; margin-bottom: 10px; border: 0; border-bottom: 1px solid #e0e8eb; }.auth-tab { flex: 1; justify-content: center; }.auth-fields { flex-wrap: wrap; }.credential-field { max-width: none; width: 100%; }.auth-fields small { padding-bottom: 0; }.pick-key { margin: 0; }.passphrase-field { grid-column: span 2; }.remote-row { grid-template-columns: 20px minmax(90px, 1fr) 62px; }.remote-time { display: none; }.log-row { grid-template-columns: 44px 1fr; gap: 5px 8px; }.log-row code, .log-row > span:last-child { grid-column: 2; }.scope-strip, .trust-card { align-items: flex-start; }.remote-selection { align-items: flex-start; flex-direction: column; }.remote-selection .quiet-action { width: 100%; } }
</style>
