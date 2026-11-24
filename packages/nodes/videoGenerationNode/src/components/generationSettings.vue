<template>
  <el-select
    v-if="modes.length"
    v-model="mode"
    class="modeSelect nodrag nopan nowheel"
    size="small"
    :disabled="disabled"
    placement="top-start"
    :fallbackPlacements="['bottom-start']"
    aria-label="视频生成模式"
    @pointerdown.stop
    @mousedown.stop
    @keydown.stop>
    <el-option v-for="item in modes" :key="item.value" :value="item.value" :label="item.label" />
  </el-select>
  <el-popover ref="settingsPopover" v-model:visible="settingsVisible" trigger="click" placement="top-start" :appendTo="settingsTarget" width="min(420px, calc(100vw - 24px))" :disabled="disabled" :showArrow="false" :popperStyle="{ padding: '20px', borderRadius: '14px' }">
    <template #reference>
      <el-button ref="settingsTrigger" class="settingsButton" text size="small" :disabled="disabled" :aria-expanded="settingsVisible" aria-label="视频生成设置">
        <span v-if="ratios.length" class="ratioShape" :style="ratioStyle(ratio)" aria-hidden="true" />
        <span>{{ [ratios.length ? (ratio === 'adaptive' ? '自适应' : ratio) : '', resolution, duration ? `${duration}秒` : ''].filter(Boolean).join(' · ') || '视频设置' }}</span>
        <component :is="settingsVisible ? IconChevronDown : IconChevronUp" :size="14" aria-hidden="true" />
      </el-button>
    </template>
    <div ref="settingsSurface" :id="settingsSurfaceId" class="settingsSurface nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @wheel.stop>
    <div v-if="settingsSurface" class="generationSettings">
      <div v-if="durations.length || resolutions.length" class="outputOptions">
        <div v-if="durations.length" class="outputField">
          <div class="sectionLabel">时长</div>
          <el-select v-model="duration" :disabled="disabled" :appendTo="`#${settingsSurfaceId}`" placement="top-start" :fallbackPlacements="['top-start', 'top-end']" aria-label="视频时长">
            <el-option v-for="item in durations" :key="item" :value="item" :label="`${item}秒`" />
          </el-select>
        </div>
        <div v-if="resolutions.length" class="outputField">
          <div class="sectionLabel">分辨率</div>
          <el-select v-model="resolution" :disabled="disabled" :appendTo="`#${settingsSurfaceId}`" placement="top-start" :fallbackPlacements="['top-start', 'top-end']" aria-label="视频分辨率">
            <el-option v-for="item in resolutions" :key="item" :value="item" :label="item" />
          </el-select>
        </div>
      </div>
      <div v-if="ratios.length" class="sectionLabel">比例</div>
      <div v-if="ratios.length" class="ratioOptions" role="group" aria-label="视频比例">
        <el-button v-for="item in ratios" :key="item" class="ratioButton" :disabled="disabled" :aria-label="`比例 ${item}`" :aria-pressed="ratio === item" @click="ratio = item">
          <span class="ratioContent">
            <span class="ratioShape" :style="ratioStyle(item)" aria-hidden="true" />
            <span>{{ item === "adaptive" ? "自适应" : item }}</span>
          </span>
        </el-button>
      </div>
      <div v-if="model?.audio === 'optional'" class="audioOption">
        <span class="sectionLabel">生成音频</span>
        <el-switch v-model="generateAudio" :disabled="disabled" aria-label="生成音频" />
      </div>
      <modelForm class="modelOptions" v-model="other" :rules="settingsRules" :disabled="disabled" />
    </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, inject, ref, useId, watch, type Ref } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElPopover, ElSelect, ElOption, ElSwitch } from "element-plus";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";
import type { NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import modelForm from "@toonflow/node-shared/modelForm";

const props = defineProps<{ model?: NodeMediaModel; disabled?: boolean; ratios: string[] }>();
const settingsSurfaceId = `videoSettings${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
// 面板插入 DOM 后再创建控件，确保内嵌下拉菜单的 Teleport 目标已存在。
const settingsSurface = ref<HTMLElement>();
const modelRules = computed(() => props.model?.rules);
const settingsRules = computed(() => (modelRules.value ?? []).map(rule =>
  ["select", "el-select"].includes(String(rule.type))
    ? { ...rule, props: { ...rule.props, teleported: true, appendTo: `#${settingsSurfaceId}`, placement: "top-start", fallbackPlacements: ["top-start", "top-end"] } }
    : rule));
const settingsVisible = ref(false);
watch(() => props.disabled, disabled => { if (disabled) settingsVisible.value = false; });
const expandedPrompt = inject<Ref<boolean> | undefined>("expandedGenerationPrompt", undefined);
watch(() => expandedPrompt?.value, () => { settingsVisible.value = false; });
const settingsPopover = ref<InstanceType<typeof ElPopover>>();
const settingsTrigger = ref<InstanceType<typeof ElButton>>();
const { node } = useNode();
const { viewport } = useVueFlow();
const settingsTarget = computed(() => {
  if (expandedPrompt?.value) return undefined;
  const element = settingsTrigger.value?.$el as HTMLElement | undefined;
  return element?.closest<HTMLElement>(".vue-flow__node") ?? element?.closest<HTMLElement>(".nodeSkeleton") ?? undefined;
});
watch(() => settingsVisible.value ? [viewport.value.x, viewport.value.y, viewport.value.zoom,
  node.computedPosition.x, node.computedPosition.y, node.dimensions.width, node.dimensions.height] : [], () => {
  void settingsPopover.value?.popperRef?.popperInstanceRef?.update();
}, { flush: "post" });
const duration = defineModel<number | undefined>("duration", { required: true });
const resolution = defineModel<string>("resolution", { required: true });
const ratio = defineModel<string>("ratio", { required: true });
const mode = defineModel<string>("mode", { required: true });
const generateAudio = defineModel<boolean>("generateAudio", { required: true });
const other = defineModel<Record<string, unknown>>("other", { required: true });
const modeLabels: Record<string, string> = {
  text: "文生视频", singleImage: "单图参考", startEndRequired: "首尾帧", endFrameOptional: "尾帧可选", startFrameOptional: "首帧可选",
};
const modes = computed(() => (props.model?.mode ?? []).map(item => ({
  value: JSON.stringify(item),
  label: Array.isArray(item) ? "全能参考" : modeLabels[item] ?? item,
})));
const mappings = computed(() => props.model?.durationResolutionMap ?? []);
const durations = computed(() => [...new Set(mappings.value.flatMap(item => item.duration))].sort((a, b) => a - b));
const resolutions = computed(() => resolutionsFor(duration.value));

function resolutionsFor(value: number | undefined) {
  return [...new Set(mappings.value.filter(item => value !== undefined && item.duration.includes(value)).flatMap(item => item.resolution))];
}

function ratioStyle(value: string) {
  if (value === "adaptive") return { width: "16px", height: "16px", borderStyle: "dashed" };
  const [width = 1, height = 1] = value.split(":").map(Number);
  return { width: `${16 * Math.min(width / height, 1)}px`, height: `${16 * Math.min(height / width, 1)}px` };
}
</script>

<style scoped lang="scss">
@use "@toonflow/node-shared/generationSettings.scss";

.modeSelect {
  width: 96px;
  flex: 0 0 96px;
}
.generationSettings {
  .outputOptions {
    display: flex;
    gap: 12px;
    margin-bottom: 18px;
    .outputField { flex: 1; min-width: 0; }
  }
  .audioOption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 18px;
    .sectionLabel { margin: 0; }
  }
  :deep(.el-select__wrapper) {
    min-height: 34px;
    border-radius: 8px;
    background: var(--el-fill-color-light);
    box-shadow: none;
    &.is-hovering, &.is-focused { box-shadow: 0 0 0 1px var(--el-border-color) inset; }
  }
}
</style>
