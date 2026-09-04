<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  FileCode,
  Copy,
  Check,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Edit3,
  Eye,
  RefreshCw,
  FileCheck,
  Plus,
  Trash2,
} from 'lucide-vue-next'
import hljs from 'highlight.js/lib/core'
import yamlLang from 'highlight.js/lib/languages/yaml'
import { useControllerStore } from '../../../stores/controllerStore'
import { appSaveFile } from '../../../api/sjzdApi'

// Register YAML language in highlight.js
hljs.registerLanguage('yaml', yamlLang)

const controller = useControllerStore()
const rawYamlText = ref(controller.getYamlString())
const isEditing = ref(false)
const copied = ref(false)
const fingerprintCopied = ref(false)
const yamlFingerprint = ref('')

async function calculateFingerprint(text: string): Promise<string> {
  try {
    if (window.crypto?.subtle) {
      const data = new TextEncoder().encode(text)
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    // fallback
  }
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(16, '0')
}

async function updateFingerprint() {
  yamlFingerprint.value = await calculateFingerprint(rawYamlText.value)
}

// Sync from store when not actively in raw text editing
watch(
  () => controller.doc,
  () => {
    if (!isEditing.value) {
      rawYamlText.value = controller.getYamlString()
      updateFingerprint()
    }
  },
  { deep: true, immediate: true }
)

watch(rawYamlText, () => {
  updateFingerprint()
})

// Highlighted HTML with line numbers
const highlightedLines = computed(() => {
  const code = rawYamlText.value
  const result = hljs.highlight(code, { language: 'yaml' }).value
  return result.split('\n')
})

async function copyYaml() {
  try {
    await navigator.clipboard.writeText(rawYamlText.value)
    copied.value = true
    controller.showMessage('已复制 YAML 配置代码到剪贴板！')
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (err) {
    controller.showMessage(`复制失败: ${err}`, false)
  }
}

async function copyFingerprint() {
  try {
    await navigator.clipboard.writeText(yamlFingerprint.value)
    fingerprintCopied.value = true
    controller.showMessage('已复制 SHA-256 配置指纹')
    setTimeout(() => {
      fingerprintCopied.value = false
    }, 2000)
  } catch (err) {
    controller.showMessage(`复制失败: ${err}`, false)
  }
}

function handleApplyManualEdit() {
  try {
    controller.applyYamlString(rawYamlText.value)
    isEditing.value = false
  } catch {
    // handled in store
  }
}

function handleResetFromModel() {
  rawYamlText.value = controller.getYamlString()
  isEditing.value = false
  controller.showMessage('已从当前工程模型重置 YAML 内容')
}

function jumpToTab(tabName: any) {
  controller.activeTab = tabName
}

function ensureRequirements() {
  if (!controller.doc.project.requirements) {
    controller.doc.project.requirements = {
      description: '',
      acceptance_scenarios: [],
      open_items: [],
    }
  }
  if (!controller.doc.project.requirements.acceptance_scenarios) {
    controller.doc.project.requirements.acceptance_scenarios = []
  }
}

function addScenario() {
  ensureRequirements()
  controller.doc.project.requirements!.acceptance_scenarios!.push({
    title: `验收场景 #${controller.doc.project.requirements!.acceptance_scenarios!.length + 1}`,
    given: '',
    when: '',
    then: '',
    status: 'pending',
  })
}

function removeScenario(idx: number) {
  controller.doc.project.requirements?.acceptance_scenarios?.splice(idx, 1)
}

async function exportAcceptanceMarkdown() {
  const proj = controller.doc.project
  const req = proj.requirements
  const md = `# 工程验收与冻结归档报告: ${proj.name || 'KZ3工程'} (ID: ${proj.id})

- **工程版本**: v${proj.version}
- **规范标准**: kz3-project-io/v3
- **导出时间**: ${new Date().toLocaleString()}
- **SHA-256 配置校验指纹**: \`${yamlFingerprint.value}\`

## 1. 工艺工程需求概述
${req?.description || '暂无工艺需求描述。'}

## 2. 现场验收测试用例 (Given-When-Then)
${
  (req?.acceptance_scenarios && req.acceptance_scenarios.length > 0)
    ? req.acceptance_scenarios.map((s, i) => `### 用例 ${i + 1}: ${s.title} [状态: ${s.status?.toUpperCase() || 'PENDING'}]
- **Given (初始条件)**: ${s.given || '无'}
- **When (触发动作)**: ${s.when || '无'}
- **Then (预期响应)**: ${s.then || '无'}
`).join('\n')
    : '暂无验收场景记录。'
}

## 3. 硬件与北向通信契约摘要
- 内部物理输入点: ${proj.points.inputs.length}
- 内部物理输出点: ${proj.points.outputs.length}
- 应用参数数量: ${proj.application_variables.parameters.length}
- 运行累计器数量: ${proj.runtime_counters?.length || 0}
- 北向映射通信字段: ${proj.northbound.fields.length}
- PID 回路数量: ${proj.pids.length}

---
*由 KZ3 工艺项目 I/O 可视化配置桌面工具自动生成 (FR-07 追溯与冻结)*
`
  try {
    const savedPath = await appSaveFile(
      `${proj.id}_验收与冻结归档报告.md`,
      md,
      'Markdown 报告 (*.md)',
      'md'
    )
    if (savedPath) {
      controller.showMessage(`已导出工程验收与冻结报告：${savedPath}`)
    } else {
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${proj.id}_验收与冻结归档报告.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      controller.showMessage('已导出工程验收与冻结报告')
    }
  } catch (err) {
    controller.showMessage(`导出报告失败: ${err}`, false)
  }
}
</script>

<template>
  <div class="yaml-tab-wrapper">
    <!-- Validation Diagnosis Panel -->
    <div class="panel-card">
      <div class="panel-header">
        <div class="panel-title">
          <AlertTriangle v-if="controller.errorCount > 0" :size="17" class="text-danger" />
          <CheckCircle2 v-else :size="17" class="text-success" />
          <span>工程规则多层校验诊断报告 (Rule Validation Report)</span>
        </div>

        <div class="diagnosis-summary">
          <span v-if="controller.errorCount > 0" class="badge-err">
            {{ controller.errorCount }} 项阻塞错误 (阻止固件生成)
          </span>
          <span v-if="controller.warningCount > 0" class="badge-warn">
            {{ controller.warningCount }} 项优化告警
          </span>
          <span v-if="controller.errorCount === 0 && controller.warningCount === 0" class="badge-ok">
            ✅ 全部规则校验通过 (符合 kz3-project-io/v3 规范)
          </span>
        </div>
      </div>

      <div class="panel-body table-responsive">
        <div v-if="controller.validationIssues.length === 0" class="empty-success">
          <CheckCircle2 :size="28" class="text-success" />
          <span>当前 project_io.yaml 数据结构完全合规，站号、点表命名与 Modbus 地址映射无任何冲突！</span>
        </div>

        <table v-else class="data-table">
          <thead>
            <tr>
              <th style="width: 75px; text-align: center;">级别</th>
              <th style="width: 200px;">规则代码 (Code)</th>
              <th style="width: 200px;">关联实体 (Entity)</th>
              <th>诊断与修复建议 (Message)</th>
              <th style="width: 90px; text-align: center;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(issue, idx) in controller.validationIssues"
              :key="idx"
              :class="`row-${issue.severity}`"
            >
              <td style="text-align: center;">
                <span :class="`severity-pill ${issue.severity}`">
                  {{ issue.severity.toUpperCase() }}
                </span>
              </td>
              <td class="text-mono font-bold">{{ issue.code }}</td>
              <td class="text-muted text-mono">{{ issue.entity }}</td>
              <td>{{ issue.message }}</td>
              <td style="text-align: center;">
                <button
                  class="btn-link"
                  @click="jumpToTab(issue.tab)"
                >
                  <span>定位修改</span>
                  <ExternalLink :size="12" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Requirements, Acceptance Scenarios & Freeze Panel (FR-07) -->
    <div class="panel-card">
      <div class="panel-header">
        <div class="header-left">
          <div class="panel-title">
            <FileCheck :size="17" class="panel-icon text-blue" />
            <span>需求追溯、验收场景与工程冻结归档 (Requirements & Acceptance)</span>
          </div>
        </div>

        <div class="header-actions">
          <button
            class="btn btn-export"
            title="导出包含需求、Given-When-Then 用例与 SHA-256 指纹的验收归档报告"
            @click="exportAcceptanceMarkdown"
          >
            <Download :size="14" />
            <span>导出验收与冻结报告</span>
          </button>

          <button
            class="btn btn-primary"
            @click="addScenario"
          >
            <Plus :size="14" />
            <span>添加验收场景</span>
          </button>
        </div>
      </div>

      <div class="panel-body">
        <!-- Freeze fingerprint strip -->
        <div class="fingerprint-bar">
          <div class="fp-left">
            <span class="fp-badge">SHA-256 配置校验指纹</span>
            <code class="fp-code">{{ yamlFingerprint || '正在计算…' }}</code>
            <button class="btn-copy-fp" :title="fingerprintCopied ? '已复制' : '复制指纹'" @click="copyFingerprint">
              <Check v-if="fingerprintCopied" :size="13" class="text-green" />
              <Copy v-else :size="13" />
              <span>{{ fingerprintCopied ? '已复制' : '复制' }}</span>
            </button>
          </div>
          <div class="fp-right">
            <span class="fp-meta">规范：kz3-project-io/v3</span>
            <span class="fp-meta">版本：v{{ controller.doc.project.version }}</span>
          </div>
        </div>

        <!-- Project Requirements Description -->
        <div class="requirements-section">
          <label class="section-subheading">工艺需求总体概述 (Process Requirements Overview)</label>
          <textarea
            v-if="controller.doc.project.requirements"
            v-model="controller.doc.project.requirements.description"
            class="requirements-textarea"
            rows="2"
            placeholder="简要描述本工程的工艺流程、控制目标、设备联锁关系及安全门禁要求..."
          ></textarea>
        </div>

        <!-- Acceptance Scenarios Grid -->
        <div class="scenarios-section">
          <div class="scenarios-header-row">
            <span class="section-subheading">现场验收测试场景 (Given-When-Then Scenarios)</span>
            <span class="text-muted font-mono" style="font-size: 0.72rem;">
              共 {{ controller.doc.project.requirements?.acceptance_scenarios?.length || 0 }} 个验收场景
            </span>
          </div>

          <div
            v-if="controller.doc.project.requirements?.acceptance_scenarios && controller.doc.project.requirements.acceptance_scenarios.length > 0"
            class="scenarios-stack"
          >
            <div
              v-for="(sc, idx) in controller.doc.project.requirements.acceptance_scenarios"
              :key="idx"
              class="scenario-card"
            >
              <div class="scenario-card-header">
                <div class="sc-title-row">
                  <span class="sc-idx">#{{ idx + 1 }}</span>
                  <input
                    v-model="sc.title"
                    type="text"
                    class="sc-title-input font-bold"
                    placeholder="如 循环泵联动自启动测试"
                  />
                  <select v-model="sc.status" class="sc-status-select" :class="`status-${sc.status || 'pending'}`">
                    <option value="pending">待验证 (PENDING)</option>
                    <option value="passed">已通过 (PASSED)</option>
                    <option value="failed">未通过 (FAILED)</option>
                  </select>
                </div>
                <button
                  class="btn-icon btn-danger"
                  title="删除此验收场景"
                  @click="removeScenario(idx)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>

              <div class="gwt-grid">
                <div class="gwt-col">
                  <span class="gwt-label gwt-given">GIVEN (前提)</span>
                  <input
                    v-model="sc.given"
                    type="text"
                    class="gwt-input"
                    placeholder="如 系统处于待机态且水位高于安全限"
                  />
                </div>
                <div class="gwt-col">
                  <span class="gwt-label gwt-when">WHEN (触发)</span>
                  <input
                    v-model="sc.when"
                    type="text"
                    class="gwt-input"
                    placeholder="如 下发启动命令或温差超过阈值"
                  />
                </div>
                <div class="gwt-col">
                  <span class="gwt-label gwt-then">THEN (预期)</span>
                  <input
                    v-model="sc.then"
                    type="text"
                    class="gwt-input"
                    placeholder="如 水泵 DO 接通且启动运行计时器"
                  />
                </div>
              </div>
            </div>
          </div>

          <div v-else class="empty-scenarios">
            <span>暂未添加现场验收测试场景。点击右上角“添加验收场景”以 Given-When-Then 标准规范沉淀验收测试用例。</span>
          </div>
        </div>
      </div>
    </div>

    <!-- YAML Code Viewer / Editor Card -->
    <div class="panel-card">
      <div class="panel-header">
        <div class="header-left">
          <div class="panel-title">
            <FileCode :size="17" class="panel-icon text-blue" />
            <span>project_io.yaml 标准工程配置代码</span>
          </div>

          <!-- View / Edit mode switcher -->
          <div class="view-mode-pill">
            <button
              class="mode-btn"
              :class="{ active: !isEditing }"
              @click="isEditing = false"
            >
              <Eye :size="13" />
              <span>语法高亮预览</span>
            </button>
            <button
              class="mode-btn"
              :class="{ active: isEditing }"
              @click="isEditing = true"
            >
              <Edit3 :size="13" />
              <span>直接代码编辑</span>
            </button>
          </div>
        </div>

        <div class="header-actions">
          <button
            v-if="isEditing"
            class="btn btn-primary"
            @click="handleApplyManualEdit"
          >
            <span>应用编辑修改</span>
          </button>
          <button
            v-if="isEditing"
            class="btn btn-outline"
            @click="handleResetFromModel"
          >
            <RefreshCw :size="13" />
            <span>撤销重置</span>
          </button>

          <button class="btn btn-outline" @click="copyYaml">
            <Check v-if="copied" :size="14" class="text-green" />
            <Copy v-else :size="14" />
            <span>{{ copied ? '已复制' : '复制代码' }}</span>
          </button>

          <button class="btn btn-outline" @click="controller.importYamlFile()">
            <Upload :size="14" />
            <span>导入文件</span>
          </button>

          <button class="btn btn-primary" @click="controller.exportYamlFile()">
            <Download :size="14" />
            <span>导出另存为</span>
          </button>
        </div>
      </div>

      <div class="panel-body code-panel-container">
        <!-- MODE 1: Syntax Highlighted Code Viewer with Line Numbers -->
        <div v-if="!isEditing" class="code-viewer-wrapper">
          <div class="code-gutter">
            <span
              v-for="(_, idx) in highlightedLines"
              :key="idx"
              class="gutter-line-no"
            >
              {{ idx + 1 }}
            </span>
          </div>

          <div class="code-content-area">
            <div
              v-for="(lineHtml, idx) in highlightedLines"
              :key="idx"
              class="code-line hljs"
              v-html="lineHtml || '&nbsp;'"
            />
          </div>
        </div>

        <!-- MODE 2: Direct Interactive Textarea -->
        <div v-else class="code-editor-wrapper">
          <div class="editor-notice">
            <span>💡 提示：正在进行 YAML 原生文本编辑，完成后点击右上角“应用编辑修改”即可反解析同步至可视化各模块。</span>
          </div>
          <textarea
            v-model="rawYamlText"
            class="yaml-raw-textarea"
            spellcheck="false"
          ></textarea>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.yaml-tab-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-card {
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #b9c5cf);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f7f9fb;
  flex-wrap: wrap;
  gap: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-main, #17212b);
}

.text-danger { color: #a12d34; }
.text-success { color: #176b45; }
.text-blue { color: #0f5f9e; }
.text-green { color: #176b45; }
.text-mono { font-family: monospace; }
.font-bold { font-weight: 600; }
.text-muted { color: var(--text-muted, #40515f); }

.view-mode-pill {
  display: flex;
  background: var(--bg-app, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  padding: 2px;
  border-radius: 6px;
  gap: 2px;
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  padding: 3px 8px;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: var(--text-muted, #40515f);
  cursor: pointer;
  transition: all 0.15s;
}

.mode-btn.active {
  background: #1769aa;
  color: #fff;
  font-weight: 600;
}

.diagnosis-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.badge-err {
  font-size: 0.72rem;
  background: rgba(239, 68, 68, 0.15);
  color: #a12d34;
  border: 1px solid rgba(239, 68, 68, 0.3);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.badge-warn {
  font-size: 0.72rem;
  background: rgba(245, 158, 11, 0.15);
  color: #7a4b00;
  border: 1px solid rgba(245, 158, 11, 0.3);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.badge-ok {
  font-size: 0.72rem;
  background: rgba(16, 185, 129, 0.15);
  color: #176b45;
  border: 1px solid rgba(16, 185, 129, 0.3);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.panel-body {
  padding: 0;
}

.table-responsive {
  overflow-x: auto;
}

.empty-success {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  gap: 10px;
  color: var(--text-main, #314654);
  font-size: 0.82rem;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  text-align: left;
}

.data-table th {
  background: #f7f9fb;
  color: var(--text-muted, #40515f);
  font-weight: 600;
  font-size: 0.74rem;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border, #b9c5cf);
}

.data-table td {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: middle;
}

.severity-pill {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}
.severity-pill.error { background: rgba(239, 68, 68, 0.15); color: #a12d34; border: 1px solid rgba(239, 68, 68, 0.3); }
.severity-pill.warning { background: rgba(245, 158, 11, 0.15); color: #7a4b00; border: 1px solid rgba(245, 158, 11, 0.3); }
.severity-pill.info { background: rgba(59, 130, 246, 0.15); color: #0f5f9e; border: 1px solid rgba(59, 130, 246, 0.3); }

.btn-link {
  background: transparent;
  border: none;
  color: #0f5f9e;
  font-size: 0.75rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.btn-link:hover { text-decoration: underline; color: #1769aa; }

/* Code Viewer & Syntax Highlighting */
.code-panel-container {
  background: #f7f9fb;
}

.code-viewer-wrapper {
  display: flex;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
  font-size: 0.82rem;
  line-height: 1.5;
  height: 520px;
  overflow: auto;
}

.code-gutter {
  display: flex;
  flex-direction: column;
  padding: 12px 0;
  width: 48px;
  flex-shrink: 0;
  text-align: right;
  background: #eef3f7;
  border-right: 1px solid #b9c5cf;
  user-select: none;
}

.gutter-line-no {
  font-size: 0.74rem;
  color: #5f6f7d;
  padding-right: 12px;
  height: 20px;
  line-height: 20px;
}

.code-content-area {
  flex: 1;
  padding: 12px 16px;
  overflow-x: auto;
  white-space: pre;
}

.code-line {
  height: 20px;
  line-height: 20px;
  color: #314654;
}

/* 浅色工程代码预览：语法色保持语义，不以高亮亮度补偿暗色背景。 */
:deep(.hljs-attr) {
  color: #0f5f9e; /* YAML Keys */
  font-weight: 600;
}
:deep(.hljs-string) {
  color: #24577a; /* Strings */
}
:deep(.hljs-number) {
  color: #6f3a96; /* Numbers */
}
:deep(.hljs-literal),
:deep(.hljs-keyword) {
  color: #a12d34; /* Booleans / keywords */
  font-weight: 700;
}
:deep(.hljs-comment) {
  color: #5f6f7d; /* Comments */
  font-style: italic;
}
:deep(.hljs-bullet),
:deep(.hljs-punctuation) {
  color: #176b45; /* Bullets */
}

/* Code Editor */
.code-editor-wrapper {
  display: flex;
  flex-direction: column;
  height: 520px;
  padding: 10px;
  gap: 8px;
}

.editor-notice {
  font-size: 0.74rem;
  color: #1769aa;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.2);
  padding: 6px 10px;
  border-radius: 4px;
}

.yaml-raw-textarea {
  flex: 1;
  background: #ffffff;
  border: 1px solid #b9c5cf;
  border-radius: 6px;
  padding: 14px;
  color: #314654;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
  font-size: 0.82rem;
  line-height: 1.5;
  resize: none;
  outline: none;
  white-space: pre;
}
.yaml-raw-textarea:focus {
  border-color: #2f82c4;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn-primary { background: #1769aa; color: #fff; }
.btn-primary:hover { background: #0e568e; }

.btn-outline {
  background: transparent;
  border-color: var(--border, #b9c5cf);
  color: var(--text-main, #314654);
}
.btn-outline:hover { background: #eef3f7; color: #0f5f9e; }
/* Compact engineering workspace pass */
.yaml-tab-wrapper { gap: 10px; }
.panel-card { border-radius: var(--radius-sm); }
.panel-header { min-height: 38px; padding: 8px 12px; gap: 8px; }
.data-table th { padding: 7px 8px; }
.data-table td { padding: 5px 8px; }
.code-panel-container { min-height: 300px; }
.yaml-raw-textarea { min-height: 260px; }
.empty-cell { padding: 20px; }
.btn { min-height: var(--control-height-dense); padding: 4px 9px; border-radius: var(--radius-xs); }

/* Requirements, Acceptance Scenarios & Freeze */
.btn-export {
  background: #176b45;
  border-color: #176b45;
  color: #fff;
}
.btn-export:hover {
  background: #115c3a;
}

.fingerprint-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 12px;
  margin-bottom: 12px;
}

.fp-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fp-badge {
  font-size: 0.7rem;
  font-weight: 700;
  color: #475569;
  background: #e2e8f0;
  padding: 2px 6px;
  border-radius: 4px;
}

.fp-code {
  font-family: monospace;
  font-size: 0.74rem;
  color: #0f766e;
  font-weight: 700;
}

.btn-copy-fp {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.68rem;
  cursor: pointer;
  color: #475569;
}
.btn-copy-fp:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}

.fp-right {
  display: flex;
  gap: 10px;
  font-size: 0.7rem;
  color: #64748b;
}

.section-subheading {
  display: block;
  font-size: 0.76rem;
  font-weight: 700;
  color: #334155;
  margin-bottom: 6px;
}

.requirements-section {
  margin-bottom: 14px;
}

.requirements-textarea {
  width: 100%;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  padding: 8px 10px;
  font-size: 0.78rem;
  color: #1e293b;
  outline: none;
  resize: vertical;
}
.requirements-textarea:focus {
  border-color: #0284c7;
}

.scenarios-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.scenarios-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scenario-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scenario-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sc-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.sc-idx {
  font-family: monospace;
  font-weight: 700;
  font-size: 0.74rem;
  color: #64748b;
}

.sc-title-input {
  flex: 1;
  max-width: 320px;
  font-size: 0.78rem;
  padding: 4px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #ffffff;
}

.sc-status-select {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  outline: none;
  cursor: pointer;
}
.sc-status-select.status-pending { background: #fef9c3; color: #854d0e; border-color: #fde047; }
.sc-status-select.status-passed { background: #dcfce7; color: #166534; border-color: #86efac; }
.sc-status-select.status-failed { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }

.gwt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}

.gwt-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.gwt-label {
  font-size: 0.65rem;
  font-family: monospace;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  width: fit-content;
}
.gwt-given { background: #e0f2fe; color: #0369a1; }
.gwt-when { background: #fef3c7; color: #92400e; }
.gwt-then { background: #dcfce7; color: #15803d; }

.gwt-input {
  font-size: 0.76rem;
  padding: 4px 7px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #ffffff;
  color: #1e293b;
  outline: none;
}
.gwt-input:focus {
  border-color: #0284c7;
}

.empty-scenarios {
  padding: 16px;
  text-align: center;
  font-size: 0.76rem;
  color: #64748b;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
}
</style>
