<template>
  <el-form class="keyForm" @submit.prevent="connect">
    <el-form-item label="线路"><el-select v-model="selectedRoute" :disabled="saving"><el-option v-for="route in jianbaiRoutes" :key="route.id" :label="route.label" :value="route.id" /></el-select></el-form-item>
    <el-form-item label="API 密钥">
      <el-input v-model="apiKey" type="password" showPassword autocomplete="off" :placeholder="connected ? '已连接，输入新密钥可替换' : '输入见白 AI API 密钥'" />
    </el-form-item>
    <p class="keyHint">请填写在见白网站中设置了对应渠道策略的密钥，通用于文本、图片和视频。</p>
    <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" />
    <el-button nativeType="submit" type="primary" :disabled="!apiKey.trim() || multiTenantEnabled" :loading="saving">
      {{ connected ? "更新密钥" : "验证并连接" }}
    </el-button>
  </el-form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { multiTenantEnabled } from "@/stores/settings";
import { jianbaiRoutes, jianbaiRouteConfig, saveJianbaiRoute, type JianbaiRouteId } from "@/lib/jianbaiAccount";
const props = defineProps<{ routeId?: JianbaiRouteId }>();
const selectedRoute = ref<JianbaiRouteId>(props.routeId ?? jianbaiRouteConfig.value.activeRoute);
const connected = computed(() => !!jianbaiRouteConfig.value.routeKeys[selectedRoute.value]);
const apiKey = ref("");
const errorMessage = ref("");
const saving = ref(false);
watch(selectedRoute, () => { apiKey.value = ""; errorMessage.value = ""; });

async function connect() {
  const key = apiKey.value.trim().replace(/^Bearer\s+/i, "");
  if (!key || saving.value || multiTenantEnabled.value) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const saved = await saveJianbaiRoute(selectedRoute.value, key);
    if (!saved) return;
    apiKey.value = "";
    ElMessage.success("线路密钥已保存");
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "连接失败，请重试";
  } finally {
    saving.value = false;
  }
}
</script>

<style lang="scss" scoped>
.keyForm {
  .keyHint { color: var(--el-text-color-secondary); font-size: 12px; margin: 0 0 16px; }
  .el-alert { margin-bottom: 12px; }
}
</style>
