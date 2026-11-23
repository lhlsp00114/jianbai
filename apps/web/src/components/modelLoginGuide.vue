<template>
  <div class="modelLoginGuide">
    <span>配置见白 AI 的 API 密钥后即可使用官方模型。</span>
    <el-button type="primary" size="small" @click.stop="openLogin">前往配置</el-button>
  </div>
</template>

<script setup lang="ts">
import { inject } from "vue";

const emit = defineEmits<{ login: [] }>();
const openSettingsPanel = inject<(id: string) => void>("openSettingsPanel");

function openLogin() {
  emit("login");
  openSettingsPanel?.("account");
}
</script>

<style lang="scss" scoped>
.modelLoginGuide {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
  white-space: normal;
}
</style>
