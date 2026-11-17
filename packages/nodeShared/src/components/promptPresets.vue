<template>
  <el-popover ref="popover" v-model:visible="visible" trigger="click" placement="top-start" :appendTo="panelTarget" width="min(520px, calc(100vw - 24px))" :showArrow="false" :disabled="disabled" :popperStyle="{ padding: '10px', borderRadius: '14px' }">
    <template #reference>
      <el-button ref="trigger" class="promptPresetsButton" text title="提示词预设" aria-label="提示词预设" aria-haspopup="dialog" :aria-expanded="visible" :disabled="disabled" @mousedown.prevent><icon-cards :size="17" aria-hidden="true" /></el-button>
    </template>
    <div class="presetPanel nodrag nopan nowheel" role="dialog" aria-label="提示词预设面板" tabindex="-1" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
      <div v-for="(column, index) in presetColumns" :key="index" class="presetColumn">
        <section v-for="group in column" :key="group.label" class="presetGroup" :aria-label="group.label || undefined">
          <h3 v-if="group.label" class="groupTitle">{{ group.label }}</h3>
          <button v-for="preset in group.presets" :key="preset.id" type="button" class="presetItem" :class="{ selected: selected.includes(preset.value) }" :title="preset.description" :aria-pressed="selected.includes(preset.value)" :disabled="disabled" @mousedown.prevent @click="selectPreset(preset.id)">
            <span class="presetIcon"><component :is="preset.icon ?? IconSparkles" :size="18" aria-hidden="true" /></span>
            <span class="presetText"><strong>{{ preset.label }}</strong><span v-if="selected.includes(preset.value) && preset.description">{{ preset.description }}</span></span>
          </button>
        </section>
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch, type Component, type Ref } from "vue";
import { ElButton, ElPopover } from "element-plus";
import { IconCards, IconSparkles } from "@tabler/icons-vue";
import { useNode, useVueFlow } from "@vue-flow/core";

type PromptPreset = { id: string; label: string; value: string; description?: string; group?: string; icon?: Component };
const props = withDefaults(defineProps<{ presets?: readonly PromptPreset[]; columns?: readonly (readonly string[])[]; selected?: string; disabled?: boolean }>(), { presets: () => [], columns: () => [], selected: "" });
const presetColumns = computed(() => props.columns.length
  ? props.columns.map(column => column.map(label => ({ label, presets: props.presets.filter(preset => preset.group === label) })).filter(group => group.presets.length))
  : [[{ label: "", presets: props.presets }]]);
const emit = defineEmits<{ select: [id: string] }>();
const visible = ref(false);
const trigger = ref<InstanceType<typeof ElButton>>();
const popover = ref<InstanceType<typeof ElPopover>>();
const expanded = inject<Ref<boolean> | undefined>("expandedGenerationPrompt", undefined);
const { node } = useNode();
const { viewport } = useVueFlow();
const panelTarget = computed(() => expanded?.value ? undefined : (trigger.value?.$el as HTMLElement | undefined)?.closest<HTMLElement>(".vue-flow__node") ?? undefined);
watch(() => expanded?.value, () => { visible.value = false; });
watch(() => props.disabled, disabled => { if (disabled) visible.value = false; });
watch(visible, (open, _previous, onCleanup) => {
  if (!open) return;
  // 选择预设时保留编辑器焦点，Esc 需要先关闭菜单，避免同时关闭展开面板。
  const closeMenu = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    visible.value = false;
  };
  document.addEventListener("keydown", closeMenu, true);
  onCleanup(() => document.removeEventListener("keydown", closeMenu, true));
}, { flush: "sync" });
watch(() => visible.value ? [viewport.value.x, viewport.value.y, viewport.value.zoom, node.computedPosition.x, node.computedPosition.y, node.dimensions.width, node.dimensions.height] : [], () => {
  void popover.value?.popperRef?.popperInstanceRef?.update();
}, { flush: "post" });

function selectPreset(id: string) {
  if (props.disabled) return;
  visible.value = false;
  emit("select", id);
}
</script>

<style scoped lang="scss">
.presetPanel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 12px;
  min-height: 200px;
  max-height: min(560px, 70vh);
  overflow-y: auto;

  .presetColumn {
    min-width: 0;

    .presetGroup {
      & + .presetGroup { margin-top: 14px; }

      .groupTitle { margin: 4px 8px 8px; color: var(--el-text-color-secondary); font-size: 12px; font-weight: 400; line-height: 20px; }

      .presetItem {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-width: 0;
        min-height: 46px;
        margin-top: 2px;
        padding: 7px 8px;
        border: 1px solid transparent;
        border-radius: 10px;
        background: transparent;
        color: var(--el-text-color-regular);
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition: background-color .15s, border-color .15s, color .15s;

        &:hover, &.selected { background: var(--el-fill-color); color: var(--el-text-color-primary); }
        &.selected { border-color: var(--el-border-color); }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }

        .presetIcon { display: grid; place-items: center; flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px; background: var(--el-fill-color-light); color: var(--el-text-color-regular); }
        .presetText {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
          strong { font-size: 13px; font-weight: 500; line-height: 20px; }
          > span { color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.5; }
        }
      }
    }
  }
}
</style>
