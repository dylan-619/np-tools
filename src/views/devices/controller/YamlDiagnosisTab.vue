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
} from 'lucide-vue-next'
import hljs from 'highlight.js/lib/core'
import yamlLang from 'highlight.js/lib/languages/yaml'
import { useControllerStore } from '../../../stores/controllerStore'

// Register YAML language in highlight.js
hljs.registerLanguage('yaml', yamlLang)

const controller = useControllerStore()
const rawYamlText = ref(controller.getYamlString())
const isEditing = ref(false)
const copied = ref(false)

// Sync from store when not actively in raw text editing
watch(
  () => controller.doc,
  () => {
    if (!isEditing.value) {
      rawYamlText.value = controller.getYamlString()
    }
  },
  { deep: true }
)

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
            ✅ 全部规则校验通过 (符合 kz3-project-io/v2 规范)
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
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #2a2f42);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.015);
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
  color: var(--text-main, #e2e8f0);
}

.text-danger { color: #f87171; }
.text-success { color: #34d399; }
.text-blue { color: #60a5fa; }
.text-green { color: #4ade80; }
.text-mono { font-family: monospace; }
.font-bold { font-weight: 600; }
.text-muted { color: var(--text-muted, #94a3b8); }

.view-mode-pill {
  display: flex;
  background: var(--bg-app, #12141c);
  border: 1px solid var(--border, #2a2f42);
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
  color: var(--text-muted, #94a3b8);
  cursor: pointer;
  transition: all 0.15s;
}

.mode-btn.active {
  background: #3b82f6;
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
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.3);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.badge-warn {
  font-size: 0.72rem;
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.3);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.badge-ok {
  font-size: 0.72rem;
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
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
  color: var(--text-main, #cbd5e1);
  font-size: 0.82rem;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  text-align: left;
}

.data-table th {
  background: rgba(0, 0, 0, 0.2);
  color: var(--text-muted, #94a3b8);
  font-weight: 600;
  font-size: 0.74rem;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border, #2a2f42);
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
.severity-pill.error { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
.severity-pill.warning { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
.severity-pill.info { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }

.btn-link {
  background: transparent;
  border: none;
  color: #60a5fa;
  font-size: 0.75rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.btn-link:hover { text-decoration: underline; color: #93c5fd; }

/* Code Viewer & Syntax Highlighting */
.code-panel-container {
  background: #0d1117;
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
  background: #090d13;
  border-right: 1px solid #21262d;
  user-select: none;
}

.gutter-line-no {
  font-size: 0.74rem;
  color: #484f58;
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
  color: #c9d1d9;
}

/* VS Code Dark+ / GitHub Dark YAML Syntax Highlighting Tokens */
:deep(.hljs-attr) {
  color: #79c0ff; /* YAML Keys */
  font-weight: 600;
}
:deep(.hljs-string) {
  color: #a5d6ff; /* Strings */
}
:deep(.hljs-number) {
  color: #d2a8ff; /* Numbers */
}
:deep(.hljs-literal),
:deep(.hljs-keyword) {
  color: #ff7b72; /* Booleans / keywords */
  font-weight: 700;
}
:deep(.hljs-comment) {
  color: #8b949e; /* Comments */
  font-style: italic;
}
:deep(.hljs-bullet),
:deep(.hljs-punctuation) {
  color: #7ee787; /* Bullets */
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
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.2);
  padding: 6px 10px;
  border-radius: 4px;
}

.yaml-raw-textarea {
  flex: 1;
  background: #090d13;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 14px;
  color: #c9d1d9;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
  font-size: 0.82rem;
  line-height: 1.5;
  resize: none;
  outline: none;
  white-space: pre;
}
.yaml-raw-textarea:focus {
  border-color: #58a6ff;
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
.btn-primary { background: #2563eb; color: #fff; }
.btn-primary:hover { background: #1d4ed8; }

.btn-outline {
  background: transparent;
  border-color: var(--border, #2a2f42);
  color: var(--text-main, #cbd5e1);
}
.btn-outline:hover { background: rgba(255, 255, 255, 0.05); color: #60a5fa; }
</style>
