<script setup lang="ts">
import { Gamepad2, Sparkles, Clock, CheckCircle2 } from 'lucide-vue-next'
</script>

<template>
  <div class="view-container">
    <div class="placeholder-hero">
      <div class="hero-icon-box">
        <Gamepad2 :size="48" class="hero-icon" />
      </div>

      <h2>智能控制器调试与配置模块</h2>
      <p class="hero-desc">
        控制器专属调试指令集、多路 IO 状态监视、CANopen/Modbus 伺服参数整定与控制逻辑在线调试正在规划研发中。
      </p>

      <div class="features-preview-card">
        <div class="preview-title">
          <Sparkles :size="16" class="sparkle-icon" />
          <span>规划中的核心功能：</span>
        </div>

        <ul class="features-list">
          <li>
            <CheckCircle2 :size="15" class="check-icon" />
            <span>数字量输入/输出 (DI/DO) 矩阵实时状态与手动强制置位</span>
          </li>
          <li>
            <CheckCircle2 :size="15" class="check-icon" />
            <span>多轴运动控制参数与位置/速度曲线实时波形捕获</span>
          </li>
          <li>
            <CheckCircle2 :size="15" class="check-icon" />
            <span>控制器自定义 PLC 脚本下载与断点诊断</span>
          </li>
        </ul>
      </div>

      <div class="timeline-badge">
        <Clock :size="14" />
        <span>预计于后续版本接入并提供完整产品化配置能力</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-container {
  padding: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
}

.placeholder-hero {
  max-width: 600px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
}

.hero-icon-box {
  width: 80px;
  height: 80px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(168, 85, 247, 0.2) 100%);
  border: 1px solid rgba(168, 85, 247, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c084fc;
  box-shadow: 0 8px 24px rgba(168, 85, 247, 0.15);
}

.placeholder-hero h2 {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text-main, #e2e8f0);
}

.hero-desc {
  margin: 0;
  font-size: 0.88rem;
  color: var(--text-muted, #94a3b8);
  line-height: 1.6;
}

.features-preview-card {
  width: 100%;
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 10px;
  padding: 18px 20px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.preview-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #c084fc;
}

.features-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.features-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  color: var(--text-main, #cbd5e1);
}

.check-icon {
  color: #34d399;
  flex-shrink: 0;
}

.timeline-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--text-muted, #94a3b8);
  background: rgba(255, 255, 255, 0.04);
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid var(--border, #2a2f42);
}
</style>
