<template>
  <div class="imageRotation" :style="{ aspectRatio: `${bounds.width} / ${bounds.height}` }" @dblclick.stop>
    <img ref="sourceImage" :src="mediaSrc" alt="旋转与镜像预览" draggable="false" :style="imageStyle" @load="imageLoaded" @error="handleError" />
    <div v-if="preparing || error" class="previewStatus" role="status">{{ error || '正在读取图片…' }}</div>
  </div>
  <teleport v-if="toolbarTarget" :to="toolbarTarget">
    <div class="rotationToolbar" role="toolbar" aria-label="旋转与镜像" @keydown.esc.stop.prevent="!busy && emit('close')">
      <div class="angleControl">
        <span>角度</span>
        <el-input-number :modelValue="model.angle" :min="-360" :max="360" :step="1" :precision="1" :controls="false" :disabled="busy" aria-label="自定义旋转角度" @update:modelValue="setAngle" />
        <span>°</span>
      </div>
      <el-button :icon="IconRotateClockwise" :disabled="busy" text title="顺时针旋转 90°" aria-label="顺时针旋转 90°" @click="setAngle((model.angle + (model.flipX !== model.flipY ? -90 : 90) + 360) % 360)">90°</el-button>
      <el-button :icon="IconFlipHorizontal" :disabled="busy" :aria-pressed="model.flipX" :type="model.flipX ? 'primary' : 'default'" text title="水平镜像" aria-label="水平镜像" @click="model = { ...model, flipX: !model.flipX }" />
      <el-button :icon="IconFlipVertical" :disabled="busy" :aria-pressed="model.flipY" :type="model.flipY ? 'primary' : 'default'" text title="垂直镜像" aria-label="垂直镜像" @click="model = { ...model, flipY: !model.flipY }" />
      <el-button class="saveRotation" :icon="IconCheck" :loading="busy" :disabled="!ready || preparing || !!error" @click="saveImage">保存</el-button>
      <el-button class="exitRotation" :icon="IconX" :disabled="busy" text title="退出旋转与镜像" aria-label="退出旋转与镜像" @click="emit('close')" />
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { ElButton, ElInputNumber } from "element-plus";
import { IconX, IconRotateClockwise, IconFlipHorizontal, IconFlipVertical, IconCheck } from "@tabler/icons-vue";
import { useMediaPreview } from "@toonflow/node-shared/mediaPreview";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import type { ImageRotation } from "../useImageRotation";

const props = defineProps<{ src: string; toolbarTarget?: HTMLElement; save: (file: File, signal: AbortSignal) => Promise<void> }>();
const emit = defineEmits<{ close: []; resize: [size: { width: number; height: number }] }>();
const model = defineModel<ImageRotation>({ required: true });
const sourceImage = ref<HTMLImageElement>();
const sourceSize = ref({ width: 1, height: 1 });
const ready = ref(false);
const busy = ref(false);
const { src: mediaSrc, preparing, error, handleError, handleLoaded } = useMediaPreview(() => props.src, "image");
let operation: AbortController | undefined;
watch(() => props.src, () => { ready.value = false; operation?.abort(); });
onScopeDispose(() => operation?.abort());

const bounds = computed(() => {
  const radians = model.value.angle * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  // 消除直角旋转的浮点误差，避免 90° 保存时多出一行透明像素。
  const width = Math.ceil(sourceSize.value.width * (cosine < 1e-10 ? 0 : cosine) + sourceSize.value.height * (sine < 1e-10 ? 0 : sine));
  const height = Math.ceil(sourceSize.value.height * (cosine < 1e-10 ? 0 : cosine) + sourceSize.value.width * (sine < 1e-10 ? 0 : sine));
  return { width, height };
});
const imageStyle = computed(() => ({
  width: `${sourceSize.value.width / bounds.value.width * 100}%`,
  height: `${sourceSize.value.height / bounds.value.height * 100}%`,
  transform: `translate(-50%, -50%) scale(${model.value.flipX ? -1 : 1}, ${model.value.flipY ? -1 : 1}) rotate(${model.value.angle}deg)`,
}));
watch(bounds, size => { if (ready.value) emit("resize", size); });

function setAngle(value: number | undefined) {
  if (busy.value || !Number.isFinite(value)) return;
  model.value = { ...model.value, angle: Math.max(-360, Math.min(360, value!)) };
}

function imageLoaded(event: Event) {
  if (!handleLoaded(event)) return;
  const image = event.target as HTMLImageElement;
  sourceSize.value = { width: image.naturalWidth, height: image.naturalHeight };
  ready.value = image.naturalWidth > 0 && image.naturalHeight > 0;
  if (ready.value) emit("resize", bounds.value);
}

async function saveImage() {
  const image = sourceImage.value;
  if (busy.value || !ready.value || !image || preparing.value || error.value) return;
  const { angle, flipX, flipY } = model.value;
  if (!Number.isFinite(angle) || Math.abs(angle) > 360 || typeof flipX !== "boolean" || typeof flipY !== "boolean") return void showNodeError("旋转参数无效", "图片保存失败");
  const { width, height } = bounds.value;
  if (width > 16384 || height > 16384 || width * height > 64 * 1024 * 1024) return void showNodeError("旋转后的图片过大，请缩小原图后再处理", "图片保存失败");
  const controller = operation = new AbortController();
  const canvas = document.createElement("canvas");
  busy.value = true;
  try {
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片画布");
    context.translate(width / 2, height / 2);
    context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    context.rotate(angle * Math.PI / 180);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("图片编码失败")), "image/png"));
    controller.signal.throwIfAborted();
    if (!blob.size || blob.size > 100 * 1024 * 1024) throw new Error("保存的图片不能为空且不能超过 100 MB");
    await props.save(new File([blob], "rotation.png", { type: "image/png" }), controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) showNodeError(error, "旋转图片保存失败");
  } finally {
    canvas.width = canvas.height = 0;
    if (operation === controller) operation = undefined;
    busy.value = false;
  }
}

defineExpose({ busy });
</script>

<style scoped lang="scss">
@use "@toonflow/node-shared/imageToolStyles.scss" as tools;
.imageRotation {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);
  background: conic-gradient(var(--el-fill-color) 25%, var(--el-fill-color-light) 0 50%, var(--el-fill-color) 0 75%, var(--el-fill-color-light) 0) 0 0 / 16px 16px;

  img { position: absolute; left: 50%; top: 50%; max-width: none; max-height: none; transform-origin: center; }
  .previewStatus { position: absolute; inset: 0; display: grid; place-items: center; padding: 12px; background: var(--el-bg-color-overlay); font-size: 12px; }
}
.rotationToolbar {
  @include tools.toolbar;

  .el-button { height: 32px; min-width: 32px; margin: 0; padding: 0 8px; border-radius: 8px; }
  .el-button[aria-pressed="true"] { @include tools.selected; }
  .exitRotation { color: var(--el-text-color-regular); }
  .angleControl {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    border-right: 1px solid var(--el-border-color-lighter);
    color: var(--el-text-color-secondary);
    font-size: 12px;

    .el-input-number { width: 66px; }
    :deep(.el-input__wrapper) { min-height: 32px; background: transparent; }
  }
  .saveRotation { @include tools.action; margin-left: 4px; }
}
</style>
