<template>
  <el-button v-if="visible || compact" class="taskRecovery" :class="{ compactRecovery: compact }" size="small" :icon="compact ? IconClipboardList : undefined" :text="compact" :loading="checking" :disabled="disabled || !visible" :title="visible ? `${label}：查询并取回原任务，不重新生成` : '暂无待处理任务'" :aria-label="compact ? '任务详情' : label" @click="recover">
    <template v-if="!compact">{{ label }}</template>
  </el-button>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ElButton } from "element-plus";
import { IconClipboardList } from "@tabler/icons-vue";
import { showNodeError } from "../showNodeError";

const props = defineProps<{ visible: boolean; label: string; disabled?: boolean; compact?: boolean; action: () => Promise<void> }>();
const checking = ref(false);
async function recover() {
  if (!props.visible || props.disabled || checking.value) return;
  checking.value = true;
  try { await props.action(); }
  catch (error) { showNodeError(error, "取回结果失败"); }
  finally { checking.value = false; }
}
</script>

<style scoped lang="scss">
.taskRecovery {
  flex-shrink: 0;
  margin-left: 0;

  &.compactRecovery {
    width: 30px;
    height: 30px;
    padding: 6px;
    border-radius: 7px;
    color: var(--el-text-color-secondary);

    &:hover:not(:disabled) { color: var(--el-text-color-primary); background: var(--el-fill-color); }
    &.is-disabled { color: var(--el-text-color-disabled); }
    :deep(.el-icon) { font-size: 16px; }
  }
}
</style>
