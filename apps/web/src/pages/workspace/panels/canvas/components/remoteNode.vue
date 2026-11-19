<template>
  <nodeSkeleton v-if="loading" loading :label="node.data.label || node.type" :handles="node.data.handles" :outputs="node.data.outputs" />
  <component v-else-if="activeComponent && !runtimeError" :is="activeComponent" :key="revision" v-bind="$attrs" />
  <el-card v-else class="remoteNodeState failed" shadow="never" role="alert">
    <div class="stateHeader">
      <strong>{{ node.data.label || node.type }}</strong>
      <span class="stateLabel">error</span>
      <div class="stateActions nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop>
        <el-button :icon="IconRefresh" text :loading="reloading" title="重新加载节点" aria-label="重新加载节点" @click.stop="retry" />
        <el-button :icon="IconTrash" text title="移除节点" aria-label="移除节点" @click.stop="removeNodes(node.id)" />
      </div>
    </div>
    <p>{{ error || runtimeError || "远程节点未加载，请确认插件已安装并启用" }}</p>
  </el-card>
</template>

<script setup lang="ts">
import { computed, inject, onErrorCaptured, provide, ref, shallowRef, watch, type Component } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElCard } from "element-plus";
import { IconRefresh, IconTrash } from "@tabler/icons-vue";
import { nodeSkeleton, type NodeData } from "@toonflow/nodes-scaffold/runtime";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ component?: Component | string; error?: string; loading?: boolean }>();
const { node } = useNode<NodeData>();
const { removeNodes } = useVueFlow();
const reload = inject<(nodeId: string) => Promise<Component>>("reloadRemoteNodeComponent");
const reloadedComponent = shallowRef<Component>();
const activeComponent = computed(() => reloadedComponent.value ?? (props.error ? undefined : props.component));
const revision = ref(0);
const runtimeError = ref("");
const reloading = ref(false);
if (reload) provide("reloadRemoteNode", reloadNode);

onErrorCaptured(error => {
  runtimeError.value = error instanceof Error ? error.message : String(error);
  console.error(`远程节点 ${node.type} (${node.id}) 运行失败`, error);
  return false;
});
watch(() => props.component, () => {
  reloadedComponent.value = undefined;
  runtimeError.value = "";
  revision.value++;
}, { flush: "sync" });

async function reloadNode() {
  if (!reload || reloading.value) return;
  const previousRevision = revision.value;
  reloading.value = true;
  try {
    const component = await reload(node.id);
    if (revision.value !== previousRevision) return;
    reloadedComponent.value = component;
    runtimeError.value = "";
    revision.value++;
  } finally {
    reloading.value = false;
  }
}

async function retry() {
  try { await reloadNode(); }
  catch (error) { runtimeError.value = error instanceof Error ? error.message : String(error); }
}
</script>

<style scoped lang="scss">
.remoteNodeState {
  width: 320px;
  &.failed { border-color: var(--el-color-danger); }
  .stateHeader {
    display: flex;
    align-items: center;
    gap: 8px;
    strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .stateLabel { font-size: 12px; color: var(--el-text-color-secondary); }
    .stateActions {
      display: flex;
      .el-button { width: 28px; height: 28px; margin: 0; padding: 0; }
    }
  }
  &.failed .stateLabel { color: var(--el-color-danger); }
  p { margin: 10px 0 0; font-size: 12px; color: var(--el-text-color-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
}
</style>
