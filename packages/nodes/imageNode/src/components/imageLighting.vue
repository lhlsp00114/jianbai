<template>
  <teleport :to="target ?? 'body'" :disabled="!target">
    <section v-show="!!target" class="lightingPanel nodrag nopan nowheel" aria-label="图片打光" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop @keydown.stop>
      <header class="panelHeader">
        <div><icon-sun :size="18" /><strong>打光</strong><span>调整光线，保留画面</span></div>
        <el-button :icon="IconX" text :disabled="generating" aria-label="关闭打光" @click="emit('close')" />
      </header>
      <div class="lightingWorkspace">
        <div class="stageColumn">
          <imageLightingStage
            v-if="target"
            v-model:azimuth="settings.azimuth"
            v-model:elevation="settings.elevation"
            v-model:rimAzimuth="settings.rimAzimuth"
            v-model:rimElevation="settings.rimElevation"
            :src="src"
            :brightness="settings.brightness"
            :lightColor="settings.lightColor"
            :rimLight="settings.rimLight"
            :rimBrightness="settings.rimBrightness"
            :rimColor="settings.rimColor"
            :activeLight="activeLight"
            :disabled="busy"
            @selectLight="selectLight"
            @aspectRatio="sourceRatio = $event" />
          <div class="directionButtons" role="group" :aria-label="`${activeLightLabel}方向`">
            <button v-for="direction in directions" :key="direction.label" type="button" :disabled="busy" :aria-pressed="activeAzimuth === direction.azimuth && activeElevation === direction.elevation" @click="setDirection(direction)">{{ direction.label }}</button>
          </div>
        </div>
        <div class="parameterColumn">
          <div class="lightSelector" role="group" aria-label="编辑光源">
            <button type="button" :aria-pressed="activeLight === 'key'" :disabled="busy" @click="selectLight('key')">主光源</button>
            <button type="button" :aria-pressed="activeLight === 'rim'" :disabled="busy" @click="selectLight('rim')">轮廓光源</button>
          </div>
          <label class="rangeControl"><span>水平角 <b>{{ Math.round(activeAzimuth) }}°</b></span><input v-model.number="activeAzimuth" type="range" :style="{ '--rangeProgress': `${(activeAzimuth + 180) / 360 * 100}%` }" min="-180" max="180" :disabled="busy" :aria-label="`${activeLightLabel}水平角`" /></label>
          <label class="rangeControl"><span>俯仰角 <b>{{ Math.round(activeElevation) }}°</b></span><input v-model.number="activeElevation" type="range" :style="{ '--rangeProgress': `${(activeElevation + 90) / 180 * 100}%` }" min="-90" max="90" :disabled="busy" :aria-label="`${activeLightLabel}俯仰角`" /></label>
          <label class="rangeControl"><span>光照强度 <b>{{ activeBrightness }}%</b></span><input v-model.number="activeBrightness" type="range" :style="{ '--rangeProgress': `${activeBrightness}%` }" min="0" max="100" :disabled="busy" :aria-label="`${activeLightLabel}亮度`" /></label>
          <div class="colorControl">
            <span>光线色彩</span>
            <div><input type="color" :value="activeColor" :disabled="busy" :aria-label="`${activeLightLabel}颜色`" @input="activeColor = ($event.target as HTMLInputElement).value" /><el-button text size="small" :disabled="busy || activeColor.toLowerCase() === '#ffffff'" @click="activeColor = '#ffffff'">{{ activeColor.toLowerCase() === '#ffffff' ? '白光' : '还原' }}</el-button></div>
          </div>
          <div class="switchControl"><span>启用轮廓光</span><el-switch v-model="settings.rimLight" :disabled="busy" aria-label="轮廓光" /></div>
        </div>
      </div>
      <div class="presetSection">
        <span class="sectionLabel">光影预设</span>
        <div class="presetGrid" role="group" aria-label="光影预设">
          <button v-for="preset in lightingPresets" :key="preset.id" type="button" :disabled="busy" :aria-pressed="settings.preset === preset.id" @click="selectPreset(preset)">{{ preset.label }}</button>
        </div>
      </div>
      <div class="smartSection">
        <div class="switchControl"><span>智能模式</span><el-switch v-model="settings.smartMode" :disabled="busy" aria-label="智能模式" /></div>
        <el-input v-if="settings.smartMode" v-model="settings.smartDesc" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" :disabled="busy" placeholder="描述你想要的光影、氛围或局部细节…" aria-label="智能打光描述" />
      </div>
      <imageVariationGenerator v-model:generating="generating" :settings="settings" :source="source" :aspectRatio="sourceRatio" :prompt="buildLightingPrompt(settings)" compactPrompt="lighting" :disabled="disabled" label="打光" @generated="emit('close')" />
    </section>
  </teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useNode } from "@vue-flow/core";
import { ElButton, ElInput, ElSwitch } from "element-plus";
import { IconSun, IconX } from "@tabler/icons-vue";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/runtime";
import { buildLightingPrompt, lightingPresets, readLightingSettings, type LightingSettings } from "../imageLighting";
import imageLightingStage from "./imageLightingStage.vue";
import imageVariationGenerator from "./imageVariationGenerator.vue";

const props = defineProps<{ src: string; source?: NodeMediaValue; target?: HTMLElement; disabled?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const { node } = useNode();
node.data.lighting = readLightingSettings(node.data.lighting);
const settings = computed(() => node.data.lighting as LightingSettings);
const activeLight = ref<"key" | "rim">("key");
const activeLightLabel = computed(() => activeLight.value === "key" ? "主光" : "轮廓光");
const activeAzimuth = computed({ get: () => activeLight.value === "key" ? settings.value.azimuth : settings.value.rimAzimuth, set: value => { settings.value[activeLight.value === "key" ? "azimuth" : "rimAzimuth"] = value; } });
const activeElevation = computed({ get: () => activeLight.value === "key" ? settings.value.elevation : settings.value.rimElevation, set: value => { settings.value[activeLight.value === "key" ? "elevation" : "rimElevation"] = value; } });
const activeBrightness = computed({ get: () => activeLight.value === "key" ? settings.value.brightness : settings.value.rimBrightness, set: value => { settings.value[activeLight.value === "key" ? "brightness" : "rimBrightness"] = value; } });
const activeColor = computed({ get: () => activeLight.value === "key" ? settings.value.lightColor : settings.value.rimColor, set: value => { settings.value[activeLight.value === "key" ? "lightColor" : "rimColor"] = value; } });
const generating = ref(false);
const busy = computed(() => props.disabled || generating.value);
const sourceRatio = ref(0);
const directions = [
  { label: "前光", azimuth: 0, elevation: 0 }, { label: "左光", azimuth: -90, elevation: 0 },
  { label: "右光", azimuth: 90, elevation: 0 }, { label: "背光", azimuth: -180, elevation: 0 },
  { label: "顶光", azimuth: 0, elevation: 90 }, { label: "底光", azimuth: 0, elevation: -90 },
];

watch(() => settings.value.rimLight, enabled => { if (!enabled) activeLight.value = "key"; });
watch(() => {
  const preset = lightingPresets.find(item => item.id === settings.value.preset);
  return !preset || Object.entries(preset.settings).every(([key, value]) => settings.value[key as keyof LightingSettings] === value);
}, matches => { if (!matches) settings.value.preset = ""; }, { immediate: true });
defineExpose({ generating });

function setDirection(direction: typeof directions[number]) {
  activeAzimuth.value = direction.azimuth;
  activeElevation.value = direction.elevation;
}

function selectLight(value: "key" | "rim") {
  if (busy.value) return;
  if (value === "rim") settings.value.rimLight = true;
  activeLight.value = value;
}

function selectPreset(preset: typeof lightingPresets[number]) {
  if (settings.value.preset === preset.id) { settings.value.preset = ""; return; }
  Object.assign(settings.value, preset.settings, { preset: preset.id });
}
</script>

<style scoped lang="scss">
@use "@toonflow/node-shared/imageToolStyles.scss" as tools;

.lightingPanel {
  @include tools.surface;
  padding: 14px;
  font-size: 12px;

  .panelHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    > div { display: flex; align-items: center; gap: 8px; }
    strong { font-size: 14px; }
    span { margin-left: 4px; color: var(--el-text-color-secondary); }
    .el-button { width: 26px; height: 26px; padding: 0; }
  }
  .lightingWorkspace {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 18px;
    .stageColumn {
      min-width: 0;
      .directionButtons {
        display: flex;
        gap: 4px;
        margin-top: 8px;
        button { @include tools.choice; flex: 1; padding: 5px 0; font-size: 11px; }
      }
    }
    .parameterColumn {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 2px;
      .lightSelector {
        display: flex; gap: 4px;
        button { @include tools.choice; flex: 1; padding: 6px 3px; }
      }
      .rangeControl {
        display: grid;
        gap: 10px;
        span { display: flex; justify-content: space-between; }
        b { color: var(--el-text-color-secondary); font-weight: 500; font-variant-numeric: tabular-nums; }
        input { @include tools.range; width: 100%; }
      }
      .colorControl {
        display: flex; align-items: center; justify-content: space-between;
        > div { display: flex; align-items: center; gap: 4px; }
        input { @include tools.colorSwatch; }
      }
    }
  }
  .switchControl { display: flex; align-items: center; justify-content: space-between; }
  .presetSection {
    margin-top: 16px;
    .sectionLabel { color: var(--el-text-color-secondary); }
    .presetGrid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 8px;
      button { @include tools.choice; padding: 7px 4px; }
    }
  }
  .smartSection {
    margin-top: 10px;
    .el-textarea { margin-top: 6px; }
  }
}
</style>
