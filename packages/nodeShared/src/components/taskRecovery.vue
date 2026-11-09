<template>
  <el-button v-if="visible" class="taskRecovery" size="small" :loading="checking" :disabled="disabled" :title="'查询并取回原任务，不重新生成'" @click="recover">
    {{ label }}
  </el-button>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ElButton } from "element-plus";
import { showNodeError } from "../showNodeError";

const props = defineProps<{ visible: boolean; label: string; disabled?: boolean; action: () => Promise<void> }>();
const checking = ref(false);
async function recover() {
  if (props.disabled || checking.value) return;
  checking.value = true;
  try { await props.action(); }
  catch (error) { showNodeError(error, "取回结果失败"); }
  finally { checking.value = false; }
}
</script>

<style scoped>
.taskRecovery { flex-shrink: 0; margin-left: 0; }
</style>
