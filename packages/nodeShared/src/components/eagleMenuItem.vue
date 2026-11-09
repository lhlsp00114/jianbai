<template>
  <el-dropdown-item v-if="file" command="sendToEagle" :icon="IconExternalLink" :disabled="sending" @click="send">
    {{ sending ? "正在发送到 Eagle…" : "发送到 Eagle" }}
  </el-dropdown-item>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useNode } from "@vue-flow/core";
import { ElDropdownItem, ElMessage } from "element-plus";
import { IconExternalLink } from "@tabler/icons-vue";
import { useNodePersistence } from "@toonflow/nodes-scaffold/nodeDocument";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";

const props = defineProps<{ file?: NodeMediaValue }>();
const { node } = useNode();
const getPersistence = useNodePersistence();
const sending = ref(false);

async function send() {
  if (sending.value || !props.file) return;
  sending.value = true;
  try {
    const context = getPersistence?.();
    if (!context) throw new Error("请先打开工作区");
    const data = node.data as { label?: string; prompt?: string };
    const mediaType = props.file.mimeType.split("/")[0];
    const filename = props.file.url.split(/[\\/]/).at(-1) ?? "";
    const taskMatch = ["image", "video", "audio"].includes(mediaType)
      ? filename.match(new RegExp(`^${mediaType}([a-f\\d]{32})\\d+\\.[a-z\\d]+$`, "i"))
      : null;
    const compactTaskId = taskMatch?.[1];
    const taskId = compactTaskId
      ? `${compactTaskId.slice(0, 8)}-${compactTaskId.slice(8, 12)}-${compactTaskId.slice(12, 16)}-${compactTaskId.slice(16, 20)}-${compactTaskId.slice(20)}`
      : undefined;
    const response = await fetch("/api/eagle/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify({
        directory: context.directory, path: props.file.url, name: data.label || "Toonflow",
        taskId,
        prompt: taskId ? undefined : data.prompt ?? "",
      }),
    });
    const result = await response.json();
    if (!response.ok || result.code !== 200) throw new Error(result.message || "发送到 Eagle 失败");
    ElMessage.success("已发送到 Eagle");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "发送到 Eagle 失败");
  } finally { sending.value = false; }
}
</script>
