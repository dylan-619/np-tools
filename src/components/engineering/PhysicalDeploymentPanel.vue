<script setup lang="ts">
import { computed } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  Cpu,
  Download,
  FileCode2,
  Plug,
  ShieldCheck
} from 'lucide-vue-next'
import { useEngineeringStore } from '../../stores/engineeringStore'

defineEmits<{ back: []; flash: [] }>()
const store = useEngineeringStore()
const config = computed(() => store.delivery?.manifest.config)
const hostPassed = computed(() => store.delivery?.manifest.hostReport.status === 'HOST_PASS')
</script>

<template>
  <section class="deployment-panel">
    <header class="deployment-heading">
      <div>
        <span class="eyebrow">工程交付 · KZ3 F427</span>
        <h2>KZ3 控制器部署准备</h2>
        <p>当前进入烧录准备环节。准备匹配的应用固件后，可在工具内连接控制器并执行写入校验。</p>
      </div>
      <div class="heading-actions">
        <span class="pending-tag">准备阶段 · 尚未写入设备</span>
        <button class="primary" @click="$emit('flash')">
          <Cpu :size="16" />打开设备烧录<ArrowRight :size="16" />
        </button>
      </div>
    </header>

    <div class="deployment-overview">
      <div class="controller-portrait">
        <svg viewBox="0 0 300 185" role="img" aria-label="KZ3 F427 控制器示意图">
          <rect x="20" y="20" width="260" height="145" rx="12" fill="#edf3f7" stroke="#b7cbd9" />
          <rect x="35" y="34" width="230" height="23" rx="4" fill="#7496a9" />
          <rect x="35" y="128" width="230" height="23" rx="4" fill="#7496a9" />
          <g v-for="n in 12" :key="n" fill="#eef5f8">
            <circle :cx="45 + (n - 1) * 19" cy="45" r="3" />
            <circle :cx="45 + (n - 1) * 19" cy="139" r="3" />
          </g>
          <rect x="111" y="71" width="78" height="43" rx="6" fill="#146c94" />
          <text x="150" y="90" text-anchor="middle" fill="white" font-size="12">KZ3</text>
          <text x="150" y="105" text-anchor="middle" fill="#cbe6f1" font-size="10">STM32 F427</text>
          <circle cx="52" cy="83" r="4" fill="#b5c6d1" />
          <circle cx="52" cy="101" r="4" fill="#b5c6d1" />
          <path d="M204 80h35v26h-35z" fill="white" stroke="#9bb4c5" />
        </svg>
        <strong>KZ3 F427 控制器</strong>
        <span>通过 ST-Link 写入应用固件</span>
      </div>
      <div class="project-summary">
        <span class="eyebrow">当前控制工程</span>
        <h3>{{ store.activeRecipe.name }}</h3>
        <dl>
          <div>
            <dt>工程</dt>
            <dd>{{ config?.projectId }}</dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>{{ config?.projectVersion }}</dd>
          </div>
          <div>
            <dt>北向点位</dt>
            <dd>{{ store.delivery?.manifest.fields.length }} 个</dd>
          </div>
          <div>
            <dt>主机检查</dt>
            <dd :class="{ verified: hostPassed }">{{ hostPassed ? '已通过' : '查看构建记录' }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <div class="preparation-steps">
      <article>
        <FileCode2 :size="20" />
        <h3>01 准备固件</h3>
        <p>将本工程的点位配置、控制逻辑与运行框架构建为 KZ3 应用 HEX。</p>
        <span>待导入匹配固件</span>
      </article>
      <article>
        <Plug :size="20" />
        <h3>02 连接控制器</h3>
        <p>连接 ST-Link 与目标设备，在烧录页核对探针和 MCU 身份。</p>
        <span>待核验设备</span>
      </article>
      <article>
        <ShieldCheck :size="20" />
        <h3>03 写入与校验</h3>
        <p>通过固件地址与目标预检后执行写入，依据实际记录确认结果。</p>
        <span>待执行</span>
      </article>
    </div>

    <div class="handoff-note">
      <FileCode2 :size="17" />
      <p>
        当前工程已生成主机运行程序。实板烧录需要另行构建匹配的 ARM
        应用固件；软件联调结果与实板运行记录分别保留。
      </p>
    </div>
    <footer>
      <button class="secondary" @click="$emit('back')"><ArrowLeft :size="16" />返回 HMI 联调</button>
      <div class="footer-actions">
        <button class="secondary" :disabled="store.busy" @click="store.exportPackage()">
          <Download :size="16" />导出控制工程
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.deployment-panel {
  background: #fff;
  border: 1px solid #dce5ed;
  border-radius: 12px;
  overflow: hidden;
}
.deployment-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 25px 28px 22px;
  gap: 20px;
  border-bottom: 1px solid #e4ebf0;
}
.eyebrow {
  color: #587b92;
  font-size: 12px;
}
h2 {
  font-size: 23px;
  margin: 9px 0;
  color: #142c43;
}
p {
  font-size: 13px;
  line-height: 1.7;
  color: #657d90;
  margin: 0;
}
.pending-tag {
  font-size: 12px;
  color: #866119;
  background: #fcf4e4;
  border-radius: 20px;
  padding: 7px 12px;
  white-space: nowrap;
}
.heading-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}
.deployment-overview {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 34px;
  padding: 24px 28px;
}
.controller-portrait {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 14px;
  background: #f4f8fa;
  border-radius: 9px;
}
.controller-portrait svg {
  width: 245px;
  max-width: 100%;
}
.controller-portrait strong {
  font-size: 14px;
  margin-bottom: 5px;
}
.controller-portrait span {
  font-size: 12px;
  color: #698194;
}
.project-summary {
  align-self: center;
  min-width: 0;
}
h3 {
  font-size: 16px;
  margin: 9px 0 16px;
}
dl {
  margin: 0;
  display: grid;
  gap: 10px;
}
dl > div {
  display: flex;
  gap: 20px;
  font-size: 13px;
}
dt {
  color: #778b9c;
  min-width: 65px;
}
dd {
  margin: 0;
  color: #294c64;
  overflow-wrap: anywhere;
}
dd.verified {
  color: #18794e;
}
.preparation-steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 0 28px 20px;
  border: 1px solid #dce5ed;
  border-radius: 9px;
}
article {
  padding: 18px;
  color: #146c94;
}
article + article {
  border-left: 1px solid #e4ebf0;
}
article h3 {
  font-size: 14px;
  margin: 12px 0 8px;
  color: #294c64;
}
article p {
  font-size: 12px;
}
article > span {
  display: block;
  color: #899aa7;
  font-size: 11px;
  margin-top: 12px;
}
.handoff-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 0 28px 21px;
  padding: 11px 14px;
  background: #f2f6f9;
  color: #587b92;
  border-radius: 6px;
}
.handoff-note svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.handoff-note p {
  font-size: 12px;
}
footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid #e4ebf0;
  padding: 17px 28px;
}
.footer-actions {
  display: flex;
  gap: 10px;
}
button {
  display: inline-flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
  padding: 10px 14px;
  font: inherit;
  font-size: 13px;
  border: 1px solid #c6d5e0;
  border-radius: 6px;
  background: white;
  color: #365c76;
  cursor: pointer;
}
button.primary {
  background: #146c94;
  border-color: #146c94;
  color: white;
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
button:focus-visible {
  outline: 2px solid #146c94;
  outline-offset: 3px;
}
@media (max-width: 1250px) {
  .deployment-heading {
    padding: 19px 22px;
  }
  .deployment-overview {
    padding: 17px 22px;
    gap: 24px;
  }
  .controller-portrait svg {
    width: 170px;
  }
  .preparation-steps {
    margin: 0 22px 16px;
  }
  article {
    padding: 14px;
  }
  .handoff-note {
    margin: 0 22px 17px;
  }
  footer {
    padding: 15px 22px;
  }
}
</style>
