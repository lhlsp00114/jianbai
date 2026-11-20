<template>
  <div ref="anchor" class="nodrag nopan" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop>
    <el-dropdown ref="dropdown" trigger="click" placement="bottom-start" :appendTo="menuTarget" :showArrow="false" :disabled="unavailable" @visible-change="visible = $event" @command="selectPreset">
      <el-button :icon="IconMessageCircle" :loading="sending" :disabled="unavailable" text>AI 助手<icon-chevron-down :size="14" /></el-button>
      <template #dropdown>
        <el-dropdown-menu @pointerdown.stop @mousedown.stop @click.stop>
          <el-dropdown-item v-for="preset in presets" :key="preset.label" :command="preset.prompt" :icon="preset.icon">{{ preset.label }}</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessage } from "element-plus";
import { IconBulb, IconChevronDown, IconMessageCircle, IconMovie, IconPhotoSearch } from "@tabler/icons-vue";

const props = defineProps<{ disabled?: boolean }>();
const { id, node } = useNode();
const { viewport } = useVueFlow();
const sendNodeToAgent = inject<(nodeId: string, outputIds: string[], prompt?: string) => Promise<void>>("sendNodeToAgent");
const anchor = ref<HTMLElement>();
const dropdown = ref<InstanceType<typeof ElDropdown>>();
const visible = ref(false);
const sending = ref(false);
const unavailable = computed(() => props.disabled || sending.value || !sendNodeToAgent);
const menuTarget = computed(() => anchor.value?.closest<HTMLElement>(".vue-flow__node")
  ?? anchor.value?.closest<HTMLElement>(".nodeSkeleton") ?? undefined);
const presets = [
  { label: "电影级镜头设计", icon: IconMovie, prompt: "请以这张图为视觉参考，设计一组能连贯剪辑的电影镜头。逐镜说明景别、机位、构图、运镜、建议时长和画面动作，保持主体与场景连续。" },
  { label: "提示词反推", icon: IconPhotoSearch, prompt: "请根据这张图反推一段可直接用于图像生成的提示词，描述主体、环境、构图、光线、色彩和视觉风格。只依据图中可见内容。" },
  { label: "来点灵感", icon: IconBulb, prompt: "请从这张图出发给我三个有明显差异的创作方向。每个方向说明可以保留的画面元素、建议改变的地方，以及一个可立即尝试的具体构思。" },
];

watch(() => visible.value ? [viewport.value.x, viewport.value.y, viewport.value.zoom,
  node.computedPosition.x, node.computedPosition.y, node.dimensions.width, node.dimensions.height] : [], () => {
  dropdown.value?.popperRef?.updatePopper();
}, { flush: "post" });

async function selectPreset(prompt: string) {
  if (unavailable.value || !sendNodeToAgent) return;
  sending.value = true;
  try {
    await sendNodeToAgent(id, ["image"], prompt);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "发送图片到 Agent 失败");
  } finally {
    sending.value = false;
  }
}
</script>
