<template>
  <el-dialog v-model="visible" title="创建风格" width="min(880px, calc(100vw - 32px))" alignCenter appendToBody class="compositionGallery">
    <div class="styleEditor">
      <ol class="styleSteps" aria-label="创建步骤">
        <li :aria-current="step === 1 ? 'step' : undefined">制作风格</li>
        <li :aria-current="step === 2 ? 'step' : undefined">确认创建</li>
      </ol>
      <div v-if="step === 1" class="styleFields">
        <div class="styleTextFields">
          <label for="styleName">风格名称 <span aria-hidden="true">*</span></label>
          <el-input id="styleName" v-model="label" maxlength="40" placeholder="输入便于识别的名称" aria-required="true" />
          <label for="styleDescription">风格描述词 <span aria-hidden="true">*</span></label>
          <el-input id="styleDescription" v-model="prompt" type="textarea" :rows="6" maxlength="500" showWordLimit :disabled="extracting" placeholder="描述光线、色调、材质等风格特征" aria-required="true" />
        </div>
        <div class="styleReference">
          <div class="referenceLabel">风格参考图 <small>选填</small></div>
          <div class="imageUpload">
            <img v-if="image" :src="image" alt="风格参考图" />
            <template v-else>
              <el-button :loading="reading" @click="fileInput?.click()">上传图片</el-button>
              <small>PNG、JPG、JPEG、WebP，最大 10 MB</small>
            </template>
            <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="readImage" />
          </div>
          <div v-if="image" class="referenceActions">
            <el-button :disabled="extracting || reading" @click="fileInput?.click()">更换图片</el-button>
            <el-button :disabled="extracting || reading" @click="image = ''">移除图片</el-button>
          </div>
          <div v-if="image" class="extractActions">
            <el-select v-model="modelKey" filterable :loading="loadingModels" :disabled="extracting" aria-label="图片理解模型" placeholder="选择图片理解模型" noDataText="暂无可用模型" @visible-change="open => open && !models.length && loadModels()">
              <el-option v-for="model in models" :key="getNodeModelKey(model)" :value="getNodeModelKey(model)" :label="`${model.label} · ${model.providerLabel}`" />
            </el-select>
            <el-button :loading="extracting" :disabled="!modelKey || reading" @click="extractStyle">提取风格描述词</el-button>
          </div>
        </div>
      </div>
      <div v-else class="styleReview">
        <img v-if="image" :src="image" alt="风格预览" />
        <div>
          <h3>{{ label.trim() }}</h3>
          <p>{{ prompt.trim() }}</p>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="editorFooter compositionFooter">
        <el-button @click="step === 2 ? step = 1 : visible = false">{{ step === 2 ? '上一步' : '返回' }}</el-button>
        <el-button v-if="step === 1" type="primary" :disabled="!label.trim() || !prompt.trim() || reading || extracting" @click="step = 2">下一步</el-button>
        <el-button v-else type="primary" @click="createStyle">创建风格</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onScopeDispose, ref } from "vue";
import { ElButton, ElDialog, ElInput, ElMessage, ElOption, ElSelect } from "element-plus";
import { findNodeModel, getNodeModelIdentity, getNodeModelKey, useNodeAi, type NodeAiModel } from "@toonflow/nodes-scaffold/runtime";
import { saveCustomStyle } from "../customStyles";

const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ created: [name: string] }>();
const ai = useNodeAi();
const step = ref(1);
const label = ref("");
const prompt = ref("");
const fileInput = ref<HTMLInputElement>();
const image = ref("");
const reading = ref(false);
const extracting = ref(false);
const loadingModels = ref(false);
const models = ref<NodeAiModel[]>([]);
const modelKey = ref("");
const lifetime = new AbortController();
onScopeDispose(() => lifetime.abort());

async function loadModels() {
  if (loadingModels.value) return;
  loadingModels.value = true;
  try { models.value = await ai.getModels(lifetime.signal); }
  catch (error) {
    if (!lifetime.signal.aborted) ElMessage.error(error instanceof Error ? error.message : "读取模型失败");
  } finally { loadingModels.value = false; }
}

async function readImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || reading.value || extracting.value) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    ElMessage.error("请选择不超过 10 MB 的 PNG、JPG、JPEG 或 WebP 图片");
    return;
  }
  reading.value = true;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      if (lifetime.signal.aborted) return;
      const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("浏览器无法处理参考图");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      image.value = canvas.toDataURL("image/jpeg", 0.8);
    } finally { bitmap.close(); }
    if (!models.value.length) void loadModels();
  } catch {
    if (!lifetime.signal.aborted) ElMessage.error("无法读取参考图，请更换图片后重试");
  } finally { reading.value = false; }
}

async function extractStyle() {
  const model = findNodeModel(models.value, modelKey.value);
  if (!model || !image.value || extracting.value) return;
  extracting.value = true;
  try {
    const result = await ai.generate({
      ...getNodeModelIdentity(model),
      systemPrompt: "从参考图中提炼可用于不同主体和场景的视觉风格。描述媒介或渲染方式、光线、色调、材质和画面质感，忽略具体人物、物件、场景和构图。仅输出一段不超过 500 字的中文风格描述词。",
      prompt: "请提取这张参考图的视觉风格。",
      images: [{ type: "image", mimeType: "image/jpeg", data: image.value.slice("data:image/jpeg;base64,".length) }],
      signal: lifetime.signal,
    });
    lifetime.signal.throwIfAborted();
    const extracted = result.text.trim();
    if (!extracted) throw new Error("模型未返回风格描述词");
    prompt.value = extracted.slice(0, 500);
  } catch (error) {
    if (!lifetime.signal.aborted) ElMessage.error(error instanceof Error ? error.message : "提取风格描述词失败");
  } finally { extracting.value = false; }
}

function createStyle() {
  try {
    const name = saveCustomStyle(label.value, prompt.value, image.value || undefined);
    emit("created", name);
    visible.value = false;
  } catch (error) {
    ElMessage.error(error instanceof DOMException && error.name === "QuotaExceededError" ? "浏览器存储空间不足，风格保存失败" : error instanceof Error ? error.message : "风格保存失败");
  }
}
</script>

<style scoped lang="scss">
.styleEditor {
  .styleSteps {
    display: flex;
    justify-content: center;
    gap: 28px;
    margin: 0 0 22px;
    padding: 0 0 14px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    list-style: none;
    color: var(--el-text-color-secondary);
    [aria-current="step"] { color: var(--el-text-color-primary); font-weight: 600; }
  }
  .styleFields {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 24px;
    .styleTextFields {
      display: grid;
      align-content: start;
      gap: 9px;
      label { color: var(--el-text-color-primary); font-weight: 600; }
      label:not(:first-child) { margin-top: 8px; }
      label span { color: var(--el-color-danger); }
    }
    .styleReference {
      min-width: 0;
      .referenceLabel { margin-bottom: 9px; color: var(--el-text-color-primary); font-weight: 600; }
      small { color: var(--el-text-color-secondary); font-weight: 400; }
      .imageUpload {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 9px;
        aspect-ratio: 16 / 9;
        border: 1px dashed var(--el-border-color);
        border-radius: 12px;
        background: var(--el-fill-color-light);
        overflow: hidden;
        img { width: 100%; height: 100%; object-fit: contain; }
      }
      .referenceActions, .extractActions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 9px;
        .el-select { flex: 1 1 145px; min-width: 0; }
        .el-button { margin: 0; }
      }
    }
    @media (max-width: 680px) { grid-template-columns: 1fr; }
  }
  .styleReview {
    display: grid;
    gap: 16px;
    img { width: min(100%, 360px); max-height: 220px; object-fit: contain; object-position: left center; border-radius: 10px; }
    h3 { margin: 0 0 8px; color: var(--el-text-color-primary); overflow-wrap: anywhere; }
    p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; }
  }
}
.editorFooter {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--el-border-color-lighter);
}
</style>
