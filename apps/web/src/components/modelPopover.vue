<template>
  <div class="modelPopover">
    <el-popover
      v-model:visible="visible"
      trigger="click"
      placement="top-start"
      :width="340"
      :offset="10"
      :showArrow="false"
      popperClass="agentModelPopover"
      :popperStyle="{ padding: '20px', maxWidth: 'calc(100vw - 24px)' }">
      <template #reference>
        <el-button class="modelButton" :class="{ iconOnly }" text :disabled="disabled" aria-label="模型与思考强度设置" :aria-expanded="visible" :title="iconOnly ? modelButtonTitle : undefined">
          <icon-sparkles v-if="iconOnly" :size="17" aria-hidden="true" />
          <template v-else>
            <modelIcon v-if="selectedModelChoice" :model="selectedModelChoice.modelId" :size="14" />
            <modelLabel class="modelName" :label="selectedModelChoice?.label ?? '选择模型'" :providerId="selectedModelChoice?.providerId" />
            <template v-if="reasoningLevels.length">
              ·
              <span class="reasoningLabel">{{ reasoningLabel }}</span>
            </template>
            <component :is="visible ? IconChevronUp : IconChevronDown" :size="14" aria-hidden="true" />
          </template>
        </el-button>
      </template>
      <el-form class="modelOptions" labelPosition="top">
        <el-form-item label="模型">
          <el-select :modelValue="selectedModelChoice ? selectedModel : ''" filterable :disabled="disabled" :teleported="false" placeholder="选择模型" aria-label="选择模型" noDataText="请先在设置中添加模型" @update:modelValue="selectedModel = $event" @change="reasoningEffort = ''">
            <template #prefix><modelIcon v-if="selectedModelChoice" :model="selectedModelChoice.modelId" :size="18" /></template>
            <template #label="{ label }"><modelLabel :label="label" :providerId="selectedModelChoice?.providerId" /></template>
            <template v-if="!modelChoices.length && !multiTenantEnabled && !toonflowAccountToken && openSettingsPanel" #empty>
              <modelLoginGuide @login="visible = false" />
            </template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="model in provider.models" :key="model.value" :label="model.label" :value="model.value">
                <div class="modelOption">
                  <modelIcon :model="model.modelId" :size="16" />
                  <modelLabel class="modelOptionLabel" :label="model.label" :providerId="provider.id" />
                </div>
              </el-option>
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item v-if="reasoningLevels.length" label="思考强度">
          <div class="reasoningSettings">
            <el-slider v-model="reasoningIndex" :min="0" :max="reasoningOptions.length - 1" :step="1" :showStops="reasoningOptions.length > 2" :showTooltip="false" :disabled="disabled" aria-label="思考强度" :aria-describedby="`${reasoningId}Hint`" />
            <div class="reasoningLabels" :style="{ gridTemplateColumns: `repeat(${reasoningOptions.length}, minmax(0, 1fr))` }" aria-hidden="true">
              <span v-for="option in reasoningOptions" :key="option.value" class="reasoningTickLabel">{{ option.label }}</span>
            </div>
            <div :id="`${reasoningId}Hint`" class="reasoningHint">默认由模型决定</div>
          </div>
        </el-form-item>
      </el-form>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, useId, watch } from "vue";
import { IconChevronDown, IconChevronUp, IconSparkles } from "@tabler/icons-vue";
import { ElSlider } from "element-plus";
import { modelIcon } from "@toonflow/model-icons";
import { useNodeModelSelection } from "@toonflow/nodes-scaffold/nodeAi";
import modelLabel from "@toonflow/node-shared/modelLabel";
import type { ThinkingLevel } from "@toonflow/server/modelReasoning";
import { modelChoices, multiTenantEnabled, refreshModelChoices, toonflowAccountToken } from "@/stores/settings";
import modelLoginGuide from "./modelLoginGuide.vue";

const selectedModel = defineModel<string>({ default: "" });
const reasoningEffort = defineModel<string>("reasoningEffort", { default: "" });
const props = withDefaults(defineProps<{ active?: boolean; disabled?: boolean; iconOnly?: boolean }>(), { active: true, disabled: false });
const visible = ref(false);
const openSettingsPanel = inject<(id: string) => void>("openSettingsPanel");
const reasoningId = useId();
const reasoningLabels: Record<ThinkingLevel, string> = { off: "关闭", minimal: "最小", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" };
const selectedModelChoice = useNodeModelSelection(modelChoices, selectedModel);
const modelGroups = computed(() => {
  const groups = new Map<string, { id: string; label: string; models: Array<(typeof modelChoices.value)[number]> }>();
  for (const model of modelChoices.value) {
    const group = groups.get(model.providerId);
    if (group) group.models.push(model);
    else groups.set(model.providerId, { id: model.providerId, label: model.providerLabel, models: [model] });
  }
  return [...groups.values()];
});
const reasoningLevels = computed(() => selectedModelChoice.value?.reasoningLevels ?? []);
const reasoningOptions = computed(() => [{ label: "默认", value: "" }, ...reasoningLevels.value.map(value => ({ label: reasoningLabels[value], value }))]);
const reasoningIndex = computed({
  get: () => Math.max(0, reasoningOptions.value.findIndex(item => item.value === reasoningEffort.value)),
  set: index => { reasoningEffort.value = reasoningOptions.value[index]?.value ?? ""; },
});
const reasoningLabel = computed(() => reasoningOptions.value.find(item => item.value === reasoningEffort.value)?.label ?? "默认");
const modelButtonTitle = computed(() => {
  const model = selectedModelChoice.value;
  if (!model) return "选择模型";
  return reasoningLevels.value.length ? `${model.label} · ${reasoningLabel.value}` : model.label;
});
watch(modelChoices, items => {
  if (!selectedModel.value) selectedModel.value = items[0]?.value ?? "";
}, { immediate: true });
watch([() => selectedModelChoice.value?.reasoningLevels, reasoningEffort], ([levels, effort]) => {
  if (levels && effort && !levels.includes(effort as ThinkingLevel)) reasoningEffort.value = "";
}, { immediate: true, flush: "post" });
watch(() => !props.active || props.disabled, close => { if (close) visible.value = false; });
watch(visible, value => { if (value) void refreshModelChoices().catch(() => {}); });
</script>

<style lang="scss">
.modelPopover {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;

  .modelButton {
    max-width: 100%;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    color: var(--el-text-color-regular);

    &.iconOnly {
      width: 32px;
      padding: 0;
      border-radius: 8px;
    }

    > span {
      display: flex;
      gap: 6px;
      min-width: 0;
    }
    svg {
      flex-shrink: 0;
    }

    .reasoningLabel {
      flex-shrink: 0;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }

    .modelName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
    }
  }
}

.agentModelPopover {
  .modelOptions {
    .el-form-item {
      margin-bottom: 20px;

      &:last-child {
        margin-bottom: 0;
      }
      .el-form-item__label {
        margin-bottom: 8px;
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
      .el-select {
        width: 100%;

        .modelOption {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;

          .modelOptionLabel {
            flex: 1;
          }
        }
      }
      .reasoningSettings {
        width: 100%;

        .el-slider {
          height: 26px;
          margin: 0 8px;
          --el-slider-height: 4px;
          --el-slider-button-size: 14px;
        }

        .reasoningLabels {
          display: grid;
          margin: 0 8px;
          color: var(--el-text-color-secondary);
          font-size: 12px;
          line-height: 18px;
          .reasoningTickLabel { min-width: 0; text-align: center; white-space: nowrap; }
        }
        .reasoningHint {
          margin-top: 8px;
          color: var(--el-text-color-secondary);
          font-size: 12px;
          line-height: 18px;
        }
      }
    }
  }
}
</style>
