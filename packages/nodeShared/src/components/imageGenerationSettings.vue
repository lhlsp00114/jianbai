<template>
  <el-popover ref="settingsPopover" v-model:visible="settingsVisible" trigger="click" placement="top-start" :appendTo="settingsTarget" width="min(420px, calc(100vw - 24px))" :disabled="disabled" :showArrow="false" :popperStyle="{ padding: '20px', borderRadius: '14px' }">
    <template #reference>
      <el-button ref="settingsTrigger" class="settingsButton" text size="small" :disabled="disabled" :aria-expanded="settingsVisible" aria-label="图片生成设置">
        <span class="ratioShape" :style="ratioStyle(ratio)" aria-hidden="true" />
        <span v-if="fixedOutputSize">{{ other?.outputFormat === 'gif' ? 'GIF 动图' : 'SVG' }} · 1张</span>
        <span v-else>{{ ratio === "auto" ? "自适应" : ratio }} · {{ size }} · 1张</span>
        <component :is="settingsVisible ? IconChevronDown : IconChevronUp" :size="14" aria-hidden="true" />
      </el-button>
    </template>
    <div ref="settingsSurface" :id="settingsSurfaceId" class="settingsSurface nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @wheel.stop>
    <div class="generationSettings">
      <div class="sectionLabel">分辨率</div>
      <el-radio-group v-model="size" class="sizeOptions" :disabled="disabled || fixedOutputSize" aria-label="图片分辨率">
        <el-radio-button v-for="item in sizes" :key="item" :value="item">{{ item }}</el-radio-button>
      </el-radio-group>
      <div class="sectionLabel">比例</div>
      <div class="ratioOptions" role="group" aria-label="图片比例">
        <el-button
          v-for="item in ratios"
          :key="item"
          class="ratioButton"
          :disabled="disabled || fixedOutputSize"
          :aria-label="`比例 ${item === 'auto' ? '自适应' : item}`"
          :aria-pressed="ratio === item"
          @click="ratio = item">
          <span class="ratioContent">
            <span class="ratioShape" :style="ratioStyle(item)" aria-hidden="true" />
            <span>{{ item === "auto" ? "自适应" : item }}</span>
          </span>
        </el-button>
      </div>
      <modelForm v-if="other && settingsSurface" class="modelOptions" :class="{ gifOptions: other.outputFormat === 'gif' }" v-model="other" :rules="settingsRules" :disabled="disabled" />
    </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, inject, ref, useId, watch, type Ref } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElPopover, ElRadioGroup, ElRadioButton } from "element-plus";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";
import type { NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import modelForm from "./modelForm.vue";

const props = defineProps<{ sizes: string[]; ratios: string[]; model?: NodeMediaModel; disabled?: boolean }>();
const settingsSurfaceId = `imageSettings${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
// 下拉菜单传送到面板内部，必须等目标元素挂载后再创建表单。
const settingsSurface = ref<HTMLElement>();
const imageOptionTitles: Record<string, string> = {
  outputFormat: "输出格式", background: "背景", quality: "图片质量",
  frameCount: "动图帧数", frameDurationMs: "每帧时长（毫秒）",
};
const imageOptionLabels: Record<string, Record<string, string>> = {
  outputFormat: { png: "PNG", jpeg: "JPEG", webp: "WebP", gif: "GIF 动图", svg: "SVG 矢量图" },
  background: { opaque: "实色底", transparent: "透明底", auto: "自适应" },
  quality: { auto: "自适应", low: "低", medium: "中", high: "高", xhigh: "超高", max: "极致" },
};
const imageOptionOrder = ["outputFormat", "background", "quality", "frameCount", "frameDurationMs"];
const settingsRules = computed(() => {
  const rules = props.model?.rules ?? [];
  return rules.map(rule => ({ ...rule,
    ...(rule.field === "outputFormat" && Array.isArray(rule.options) && rule.options.some(option => option.value === "svg") ? {
      control: [...(Array.isArray(rule.control) ? rule.control : []), {
        handle: (value: unknown) => value === "png" || value === "jpeg",
        rule: ["quality"],
      }],
    } : {}),
    title: imageOptionTitles[rule.field ?? ""] ?? rule.title,
    ...(imageOptionLabels[rule.field ?? ""] && Array.isArray(rule.options) ? {
      options: rule.options.map(option => ({ ...option,
        label: imageOptionLabels[rule.field ?? ""]?.[String(option.value)] ?? option.label,
      })).sort((left, right) => {
        const order = Object.keys(imageOptionLabels[rule.field ?? ""] ?? {});
        const leftIndex = order.indexOf(String(left.value));
        const rightIndex = order.indexOf(String(right.value));
        return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex);
      }),
    } : {}),
    ...(["select", "el-select"].includes(String(rule.type))
      ? { props: { ...rule.props, teleported: true, appendTo: `#${settingsSurfaceId}`,
        placement: "top-start", fallbackPlacements: ["top-start", "top-end"] } } : {}),
    ...(["frameCount", "frameDurationMs"].includes(rule.field ?? "")
      ? { props: { ...rule.props, controlsPosition: "", stepStrictly: true } } : {}),
  })).sort((left, right) =>
    (imageOptionOrder.includes(left.field ?? "") ? imageOptionOrder.indexOf(left.field ?? "") : imageOptionOrder.length)
    - (imageOptionOrder.includes(right.field ?? "") ? imageOptionOrder.indexOf(right.field ?? "") : imageOptionOrder.length));
});
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
const size = defineModel<string>("size", { required: true });
const ratio = defineModel<string>("ratio", { required: true });
const other = defineModel<Record<string, unknown>>("other");
const fixedOutputSize = computed(() => {
  const format = props.model?.rules?.find(rule => rule.field === "outputFormat");
  return ["gif", "svg"].includes(String(other.value?.outputFormat))
    && Array.isArray(format?.options) && format.options.some(option => option.value === other.value?.outputFormat);
});
watch(() => [other.value?.background, other.value?.outputFormat], ([background, outputFormat], previous) => {
  if (other.value?.background !== "transparent" || other.value.outputFormat === "png") return;
  const backgroundRule = props.model?.rules?.find(rule => rule.field === "background");
  if (!Array.isArray(backgroundRule?.options) || !backgroundRule.options.some(option => option.value === "transparent")) return;
  const format = props.model?.rules?.find(rule => rule.field === "outputFormat");
  if (Array.isArray(format?.options) && format.options.some(option => option.value === "png")) {
    const changedFormat = previous?.[0] === background && previous?.[1] !== outputFormat;
    other.value = changedFormat && outputFormat === "jpeg" && backgroundRule.options.some(option => option.value === "opaque")
      ? { ...other.value, background: "opaque" }
      : { ...other.value, outputFormat: "png" };
  }
}, { flush: "sync" });

function ratioStyle(value: string) {
  if (value === "auto") return { width: "16px", height: "16px", borderStyle: "dashed" };
  const [width = 1, height = 1] = value.split(":").map(Number);
  return { width: `${16 * Math.min(width / height, 1)}px`, height: `${16 * Math.min(height / width, 1)}px` };
}
</script>

<style scoped lang="scss" src="../generationSettings.scss"></style>
