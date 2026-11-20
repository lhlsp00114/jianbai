<template>
  <div class="scriptEditor">
    <header class="editorHeader">
      <div class="headingLine">
        <div class="scriptIdentity"><div class="scriptMark"><icon-movie :size="19" /></div><el-input v-model="document.title" class="scriptTitle" placeholder="脚本标题" aria-label="脚本标题" :maxlength="200" :disabled="busy" /></div>
        <div class="headerActions"><span class="scriptStats">{{ document.shots.length }} 个镜头 · {{ totalDuration }} 秒</span><el-button :icon="IconX" text title="关闭脚本编辑器" aria-label="关闭脚本编辑器" @click="emit('close')" /></div>
      </div>
      <nav class="stepNav" aria-label="脚本制作步骤">
        <button v-for="(label, index) in steps" :key="label" type="button" :class="{ current: document.step === index }" :aria-current="document.step === index ? 'step' : undefined" :disabled="busy" @click="goToStep(index)">
          <span class="stepState">{{ index < document.step ? '✓' : index + 1 }}</span><span class="stepText"><strong>{{ label }}</strong><small>{{ stepDescriptions[index] }}</small></span>
        </button>
      </nav>
    </header>
    <el-alert v-if="error" class="editorAlert" :title="error" type="error" showIcon :closable="false" />
    <div class="editorBody">
      <section v-if="document.step === 0" class="shotSection">
        <el-collapse v-model="sourceOpen" class="sourcePanel">
          <el-collapse-item name="source">
            <template #title><div class="sourcePanelTitle"><span>剧本与生成设置</span><small>{{ sourceSummary }}</small></div></template>
            <el-radio-group v-model="document.mode" :disabled="busy" aria-label="脚本创作方式">
              <el-radio-button value="script">剧本生成分镜</el-radio-button>
              <el-radio-button value="character">角色生成分镜</el-radio-button>
              <el-radio-button value="manual">手工编写分镜</el-radio-button>
            </el-radio-group>
            <el-input v-if="document.mode !== 'manual'" v-model="document.input" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" :maxlength="60000" placeholder="输入剧本、故事大纲或围绕参考角色的创作要求；也可连接文本、图片节点作为参考" aria-label="剧本或创作要求" :disabled="busy" />
            <div class="sourceControls">
              <label>目标镜头数<el-input-number v-model="document.shotCount" :valueOnClear="8" :min="1" :max="60" :precision="0" :disabled="busy" aria-label="目标镜头数" /></label>
              <label>画幅<el-select v-model="document.ratio" :disabled="busy" aria-label="分镜画幅"><el-option v-for="ratio in ratios" :key="ratio" :value="ratio" :label="ratio" /></el-select></label>
              <slot name="model" />
              <el-button v-if="document.mode !== 'manual'" type="primary" :loading="busy" @click="emit('generate')">{{ document.shots.length ? '重新拆解' : '生成分镜脚本' }}</el-button>
            </div>
            <el-input v-model="document.style" :maxlength="4000" placeholder="统一视觉风格，可留空" aria-label="统一视觉风格" :disabled="busy" />
          </el-collapse-item>
        </el-collapse>
        <el-table :data="document.shots" rowKey="id" class="shotTable" height="100%" border :rowStyle="shotRowStyle" :emptyText="document.mode === 'manual' ? '点击下方添加镜头开始编写' : '可从生成设置拆解剧本，也可在下方手工添加镜头'">
          <el-table-column type="index" label="镜号" width="56" fixed align="center" headerAlign="center" className="centeredColumn" />
          <el-table-column label="时长／秒" width="80" align="center" headerAlign="center" className="centeredColumn"><template #default="{ row }"><el-input-number v-model="row.duration" :valueOnClear="1" :min="1" :max="120" :precision="1" :controls="false" :disabled="busy" aria-label="镜头时长" /></template></el-table-column>
          <el-table-column label="画面描述" minWidth="280"><template #default="{ row }"><el-popover popperClass="shotMentionPopover" :visible="editingTextCell === textCellKey(row as ScriptShot, 'description')" trigger="click" placement="bottom-start" :width="480" :showArrow="false" @update:visible="(visible: boolean) => setEditingTextCell(row as ScriptShot, 'description', visible)"><template #reference><button type="button" class="shotDescriptionCell" :disabled="busy" aria-label="编辑画面描述"><span v-for="(part, index) in textParts(row.description, row as ScriptShot)" :key="index" :class="part.asset ? 'assetMention' : undefined">{{ part.text }}</span><component :is="IconEdit" :size="14" /></button></template><div class="mentionEditor"><div :key="textCellKey(row as ScriptShot, 'description')" class="mentionEditorText" contenteditable="plaintext-only" role="textbox" aria-label="画面描述" aria-multiline="true" data-placeholder="编辑画面描述；关联资产前会显示@" v-if="editingTextCell === textCellKey(row as ScriptShot, 'description')" v-html="editingText?.html" @input="updateTextDraft($event, row as ScriptShot, 'description')" @keydown.esc.stop="setEditingTextCell(row as ScriptShot, 'description', false)"></div></div></el-popover></template></el-table-column>
          <el-table-column label="景别" minWidth="95" align="center" headerAlign="center" className="centeredColumn">
            <template #default="{ row }">
              <el-dropdown class="shotSizeDropdown" trigger="click" placement="bottom-start" :disabled="busy" @command="value => setShotSize(row as ScriptShot, value)">
                <button type="button" class="shotSizeButton" :disabled="busy" :aria-label="'切换景别，当前：' + (row.shotSize || '未选择')">{{ row.shotSize || '选择景别' }}</button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-for="size in shotSizes" :key="size" :command="size" :disabled="busy">
                      <span class="shotSizeOption"><span>{{ size }}</span><icon-check v-if="row.shotSize === size" :size="14" aria-label="已选中" /></span>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </el-table-column>
          <el-table-column v-for="field in fields" :key="field.key" :label="field.label" :minWidth="field.width">
            <template #default="{ row }"><el-popover v-if="field.key === 'dialogue'" popperClass="shotMentionPopover" :visible="editingTextCell === textCellKey(row as ScriptShot, 'dialogue')" trigger="click" placement="bottom-start" :width="420" :showArrow="false" @update:visible="(visible: boolean) => setEditingTextCell(row as ScriptShot, 'dialogue', visible)"><template #reference><button type="button" class="dialoguePreview" :disabled="busy" :aria-label="'编辑' + field.label"><span v-for="(part, index) in textParts(row.dialogue, row as ScriptShot)" :key="index" :class="part.asset ? 'dialogueMention' : undefined">{{ part.text }}</span></button></template><div class="mentionEditor"><div :key="textCellKey(row as ScriptShot, 'dialogue')" class="mentionEditorText" contenteditable="plaintext-only" role="textbox" :aria-label="field.label" aria-multiline="true" data-placeholder="编辑对白／旁白；关联资产前会显示@" v-if="editingTextCell === textCellKey(row as ScriptShot, 'dialogue')" v-html="editingText?.html" @input="updateTextDraft($event, row as ScriptShot, 'dialogue')" @keydown.esc.stop="setEditingTextCell(row as ScriptShot, 'dialogue', false)"></div></div></el-popover><el-input v-else v-model="row[field.key]" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }" :maxlength="field.limit" :aria-label="field.label" :disabled="busy" placeholder="—" /></template>
          </el-table-column>
          <el-table-column label="最终提示词" width="130" align="center" headerAlign="center" className="centeredColumn"><template #default="{ row }"><div class="finalPromptCell" :title="row.promptSource === shotSource(row as ScriptShot, document.assets, document.style) && row.imagePrompt ? row.imagePrompt : '待生成提示词'">{{ row.promptSource === shotSource(row as ScriptShot, document.assets, document.style) && row.imagePrompt ? row.imagePrompt : '待生成提示词' }}</div></template></el-table-column>
          <el-table-column label="操作" width="56" fixed="right" align="center" headerAlign="center" className="centeredColumn">
            <template #default="{ row }">
              <el-popover popperClass="shotActionsPopover" trigger="click" placement="bottom-end" :width="176" :showArrow="false" :disabled="busy">
                <template #reference><el-button class="shotActionsButton" text :icon="IconDots" :disabled="busy" title="镜头操作" aria-label="镜头操作" @click.stop /></template>
                <div class="shotActionsMenu">
                  <div class="rowColorPicker" role="group" aria-label="行颜色">
                    <span class="rowColorLabel">请选择颜色</span>
                    <div class="rowColorOptions">
                      <button type="button" class="rowColorSwatch clearRowColor" :disabled="busy" title="清除颜色" aria-label="清除行颜色" :aria-pressed="!row.color" @click.stop="setShotColor(row as ScriptShot)"></button>
                      <button v-for="color in rowColors" :key="color" type="button" class="rowColorSwatch" :disabled="busy" :style="{ backgroundColor: color }" :title="'设置行颜色 ' + color" :aria-label="'设置行颜色 ' + color" :aria-pressed="row.color === color" @click.stop="setShotColor(row as ScriptShot, color)"></button>
                    </div>
                  </div>
                  <button type="button" class="deleteShotButton" :disabled="busy" @click.stop="removeShot(row as ScriptShot)"><icon-trash :size="15" />删除该行</button>
                </div>
              </el-popover>
            </template>
          </el-table-column>
        </el-table>
      </section>
      <section v-else-if="document.step === 1" class="assetSection">
        <div class="globalStyle"><el-tag size="small" effect="dark">全局风格</el-tag><el-input v-model="document.style" :maxlength="4000" placeholder="统一角色、场景与道具的画面风格" aria-label="资产全局视觉风格" :disabled="busy" /></div>
        <section v-for="kind in assetKinds" :key="kind.value" class="assetGroup">
          <header class="assetGroupHeader"><div><h2>{{ kind.label }}</h2><span>{{ assetsForKind(kind.value).filter(assetReady).length }}/{{ assetsForKind(kind.value).length }} 已生成</span></div></header>
          <div class="assetGrid">
            <article v-for="asset in assetsForKind(kind.value)" :key="asset.id" class="assetCard" @click="openAssetEditor(asset)">
              <scriptAssetPreview :asset="asset" />
              <el-dropdown class="assetMenu" trigger="click" placement="bottom-end" :disabled="busy" @command="command => assetCommand(command, asset)">
                <el-button :icon="IconDots" text title="资产操作" :aria-label="(asset.name || '资产') + '操作'" @click.stop />
                <template #dropdown><el-dropdown-menu><el-dropdown-item command="edit">编辑资产</el-dropdown-item><el-dropdown-item command="select">选择图片</el-dropdown-item><el-dropdown-item command="generate">AI生{{ kind.label }}图</el-dropdown-item><el-dropdown-item v-if="asset.imageNodeId || asset.source" command="focus">跳转至节点</el-dropdown-item><el-dropdown-item v-if="asset.imageNodeId || asset.source" command="clear">清除图片</el-dropdown-item><el-dropdown-item command="save" :disabled="!asset.imageNodeId && !asset.source">保存到个人资产</el-dropdown-item><el-dropdown-item divided command="delete">删除资产</el-dropdown-item></el-dropdown-menu></template>
              </el-dropdown>
              <div class="assetSummary"><strong>{{ asset.name || '未命名资产' }}</strong><p>{{ asset.description || '暂无描述' }}</p></div>
            </article>
            <button class="addAssetTile" type="button" :disabled="busy || document.assets.length >= 60" @click="addAsset(kind.value)"><icon-plus :size="22" /><span>新增{{ kind.label }}</span></button>
          </div>
        </section>
      </section>
      <section v-else class="promptSection">
        <div class="sectionTools">
          <el-button type="primary" :disabled="busy || !document.shots.length" @click="emit('compose', chosenShotIds)">合成提示词</el-button>
          <span class="muted">未勾选时处理全部镜头；编辑分镜或资产后需重新合成</span>
        </div>
        <el-table :data="document.shots" rowKey="id" :emptyText="'请先添加或生成分镜'" @selection-change="rows => selectedShotIds = rows.map((row: ScriptShot) => row.id)">
          <el-table-column type="selection" width="42" :selectable="() => !busy" />
          <el-table-column type="index" label="镜号" width="56" />
          <el-table-column label="画面" minWidth="160"><template #default="{ row }"><div class="shotDescription">{{ row.description }}</div><span class="muted">{{ row.duration }} 秒</span></template></el-table-column>
          <el-table-column label="图片提示词" minWidth="270"><template #default="{ row }"><el-input v-model="row.imagePrompt" type="textarea" :autosize="{ minRows: 6, maxRows: 12 }" :maxlength="14000" :disabled="busy" aria-label="图片提示词" /></template></el-table-column>
          <el-table-column label="视频提示词" minWidth="270"><template #default="{ row }"><el-input v-model="row.videoPrompt" type="textarea" :autosize="{ minRows: 6, maxRows: 12 }" :maxlength="16000" :disabled="busy" aria-label="视频提示词" /></template></el-table-column>
          <el-table-column label="关联节点" width="130">
            <template #default="{ row }">
              <el-tag v-if="row.promptSource !== shotSource(row as ScriptShot, document.assets, document.style)" type="warning" size="small">待合成</el-tag>
              <el-button v-if="row.imageNodeId" text @click="emit('focus', row.imageNodeId)">图片节点</el-button>
              <el-button v-if="row.videoNodeId" text @click="emit('focus', row.videoNodeId)">视频节点</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="generationSettings">
          <div class="mediaControls">
            <span>图片</span><providerModelSelect v-model="document.imageModel" :models="imageModels" :disabled="busy" noDataText="请先配置图片模型" @open="emit('loadModels')" />
            <el-button :disabled="busy || !document.shots.length" @click="emit('media', 'image', chosenShotIds, false, startMedia)">{{ startMedia ? '批量生成分镜图' : '创建分镜图节点' }}</el-button>
          </div>
          <div class="mediaControls">
            <span>视频</span><providerModelSelect v-model="document.videoModel" :models="videoModels" :disabled="busy" noDataText="请先配置视频模型" @open="emit('loadModels')" />
            <el-button :disabled="busy || !document.shots.length" @click="emit('media', 'video', chosenShotIds, false, startMedia)">{{ startMedia ? '批量生成视频片段' : '创建视频节点' }}</el-button>
          </div>
          <el-checkbox v-model="startMedia" :disabled="busy">同时启动生成（供应商计费）</el-checkbox>
          <p class="muted">视频优先引用已完成的分镜图；无分镜图时沿用关联资产参考。模型不支持的时长或比例会提示修改，不静默替换。</p>
        </div>
      </section>
      <section v-if="reports.length" class="operationReports" aria-label="生成节点操作结果">
        <div v-for="report in reports" :key="report.id" :class="{ failed: report.failed }"><span>{{ report.label }}：{{ report.message }}</span><el-button v-if="report.nodeId" text @click="emit('focus', report.nodeId)">定位节点</el-button></div>
      </section>
      <el-collapse v-if="document.rawResponse && error"><el-collapse-item title="查看未应用的模型返回"><pre class="rawResponse">{{ document.rawResponse }}</pre></el-collapse-item></el-collapse>
    </div>
    <footer class="editorFooter">
      <div class="footerStatus"><el-button v-if="document.step === 0" text :icon="IconPlus" :disabled="busy || document.shots.length >= 120" @click="addShot">添加镜头</el-button><el-button v-if="busy" @click="emit('cancel')">停止后续处理</el-button><span v-if="busy" class="muted">{{ progress }}</span></div>
      <div class="stepActions">
        <el-button v-if="document.step > 0" :disabled="busy" @click="document.step--">上一步</el-button>
        <el-button v-if="document.step === 1 && document.assets.length" type="primary" :disabled="busy" @click="openBatchGeneration">一键生成所有资产</el-button>
        <el-button v-if="document.step < 2" type="primary" :disabled="busy || !document.shots.length" @click="nextStep">下一步：{{ steps[document.step + 1] }}<icon-arrow-right :size="16" /></el-button>
      </div>
    </footer>
    <el-dialog v-model="generationDialogVisible" title="AI生成资产图片" width="min(760px, calc(100vw - 32px))" appendToBody :closeOnClickModal="false" destroyOnClose>
      <div class="assetGenerationDialog">
        <el-input v-model="generation.prompt" type="textarea" :autosize="{ minRows: 5, maxRows: 10 }" :maxlength="14000" aria-label="资产图片提示词" />
        <providerModelSelect v-model="generation.model" :models="imageModels" :disabled="busy" noDataText="请先配置图片模型" @open="emit('loadModels')" />
        <imageGenerationSettings v-model:size="generation.size" v-model:ratio="generation.ratio" v-model:other="generation.other" :model="generationModel" :sizes="generationSizes" :ratios="generationRatios" :disabled="busy || !generationModel" />
      </div>
      <template #footer><el-button @click="generationDialogVisible = false">取消</el-button><el-button type="primary" :disabled="busy || !generationModel || !generation.prompt.trim()" @click="confirmAssetGeneration">确认生成</el-button></template>
    </el-dialog>
    <el-drawer v-model="assetEditDialogVisible" :title="'编辑' + (editingAsset ? assetKindLabel(editingAsset.kind) : '资产')" direction="rtl" size="min(560px, 90vw)" appendToBody destroyOnClose class="assetEditDrawer">
      <div v-if="editingAsset" class="assetEditPanel">
        <div class="assetEditField assetImageField"><span>{{ assetKindLabel(editingAsset.kind) }}形象</span><div class="drawerAssetImage"><scriptAssetPreview :asset="editingAsset" class="drawerAssetPreview" /><el-dropdown class="drawerAssetMenu" trigger="click" placement="bottom-end" :disabled="busy" @command="runEditingAssetCommand"><el-button :icon="IconDots" text title="资产操作" aria-label="资产操作" @click.stop /><template #dropdown><el-dropdown-menu><el-dropdown-item command="edit">编辑资产</el-dropdown-item><el-dropdown-item command="select">选择图片</el-dropdown-item><el-dropdown-item command="generate">AI生{{ assetKindLabel(editingAsset.kind) }}图</el-dropdown-item><el-dropdown-item v-if="editingAsset.imageNodeId || editingAsset.source" command="focus">跳转至节点</el-dropdown-item><el-dropdown-item v-if="editingAsset.imageNodeId || editingAsset.source" command="clear">清除图片</el-dropdown-item><el-dropdown-item command="save" :disabled="!editingAsset.imageNodeId && !editingAsset.source">保存到个人资产</el-dropdown-item><el-dropdown-item divided command="delete">删除资产</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div></div>
        <label class="assetEditField assetNameField"><span>{{ assetKindLabel(editingAsset.kind) }}名称</span><el-input v-model="editingAsset.name" :maxlength="100" placeholder="素材名称" aria-label="资产名称" :disabled="busy" /></label>
        <label class="assetEditField assetPromptField"><span>资产提示词</span><el-input v-model="editingAsset.description" type="textarea" :autosize="{ minRows: 8, maxRows: 18 }" :maxlength="4000" placeholder="外观、服装、空间、材质等视觉特征" aria-label="资产提示词" :disabled="busy" /></label>
      </div>
    </el-drawer>
    <el-dialog v-model="batchGenerationDialogVisible" title="一键生成所有资产" width="min(820px, calc(100vw - 32px))" appendToBody :closeOnClickModal="false" destroyOnClose>
      <div class="batchGenerationDialog">
        <div v-for="kind in assetKinds" :key="kind.value" class="batchAssetGroup">
          <strong>{{ kind.label }}</strong>
          <el-checkbox-group v-model="batchAssetIds" :disabled="busy">
            <label v-for="asset in assetsForKind(kind.value)" :key="asset.id" class="batchAssetOption">
              <el-checkbox :value="asset.id" :disabled="!asset.name.trim() || !asset.description.trim() || assetReady(asset)" />
              <span class="batchAssetText"><span>{{ asset.name || '未命名资产' }}<small>{{ assetReady(asset) ? '已生成' : !asset.description.trim() ? '请补充视觉描述' : '' }}</small></span><small>{{ asset.description }}</small></span>
            </label>
          </el-checkbox-group>
        </div>
        <div class="batchGenerationSettings">
          <providerModelSelect v-model="generation.model" :models="imageModels" :disabled="busy" noDataText="请先配置图片模型" @open="emit('loadModels')" />
          <imageGenerationSettings v-model:size="generation.size" v-model:ratio="generation.ratio" v-model:other="generation.other" :model="generationModel" :sizes="generationSizes" :ratios="generationRatios" :disabled="busy || !generationModel" />
        </div>
      </div>
      <template #footer><span class="batchSelectionCount">已选 {{ batchAssetIds.length }} 项</span><el-button @click="batchGenerationDialogVisible = false">取消</el-button><el-button type="primary" :disabled="busy || !batchAssetIds.length || !generationModel" @click="confirmBatchGeneration">生成（{{ batchAssetIds.length }}）</el-button></template>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElInput, ElInputNumber, ElButton, ElDialog, ElDrawer, ElRadioGroup, ElRadioButton, ElCollapse, ElCollapseItem, ElSelect, ElOption, ElTable, ElTableColumn, ElCheckbox, ElCheckboxGroup, ElTag, ElAlert, ElMessage, ElMessageBox, ElDropdown, ElDropdownMenu, ElDropdownItem, ElPopover } from "element-plus";
import { IconPlus, IconMovie, IconX, IconArrowRight, IconDots, IconEdit, IconTrash, IconCheck } from "@tabler/icons-vue";
import { findNodeModel, getNodeModelKey, type NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import providerModelSelect from "@toonflow/node-shared/providerModelSelect";
import imageGenerationSettings from "@toonflow/node-shared/imageGenerationSettings";
import scriptAssetPreview from "./scriptAssetPreview.vue";
import { assetImage, assetKinds, createShot, shotSource, type AssetReference, type MediaKind, type ScriptDocument, type ScriptAsset, type ScriptShot } from "./scriptData";
import type { MediaReport } from "./scriptMedia";
type ImageGenerationConfig = { model: string; size: string; ratio: string; other: Record<string, unknown>; prompt: string };
const props = defineProps<{ busy: boolean; error: string; progress: string; imageModels: NodeMediaModel[]; videoModels: NodeMediaModel[]; reports: MediaReport[]; selectAssetImage: () => Promise<AssetReference | undefined> }>();
const document = defineModel<ScriptDocument>({ required: true });
const emit = defineEmits<{ close: []; generate: []; compose: [ids: string[]]; cancel: []; focus: [id?: string]; loadModels: []; saveAsset: [id: string]; media: [kind: MediaKind, ids: string[], assetsOnly: boolean, start: boolean, config?: ImageGenerationConfig] }>();
const steps = ["确认镜头", "准备资产", "合成提示词"];
const { findNode } = useVueFlow();
const stepDescriptions = computed(() => [document.value.shots.length + " 个镜头已就绪", assetsReady.value + "/" + document.value.assets.length + " 已生成， 还差 " + Math.max(0, document.value.assets.length - assetsReady.value) + " 个", document.value.shots.filter(shot => shot.promptSource === shotSource(shot, document.value.assets, document.value.style)).length + "/" + document.value.shots.length + " 已合成"]);
const ratios = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const startMedia = ref(false);
const generationDialogVisible = ref(false);
const batchGenerationDialogVisible = ref(false);
const assetEditDialogVisible = ref(false);
const editingAssetId = ref("");
const batchAssetIds = ref<string[]>([]);
const generationAssetId = ref("");
const generation = ref<ImageGenerationConfig>({ model: "", size: "", ratio: "16:9", other: {}, prompt: "" });
const generationModel = computed(() => findNodeModel(props.imageModels, generation.value.model));
const editingAsset = computed(() => document.value.assets.find(asset => asset.id === editingAssetId.value));
const generationSizes = computed(() => generationModel.value?.imageSizes?.length ? generationModel.value.imageSizes : ["2K"]);
const generationRatios = computed(() => generationModel.value?.imageRatios?.length ? generationModel.value.imageRatios : ["16:9"]);
watch([generationModel, () => generation.value.size, () => generation.value.ratio], ([model]) => {
  if (!model) return;
  if (!generationSizes.value.includes(generation.value.size)) generation.value.size = generationSizes.value[0]!;
  if (!generationRatios.value.includes(generation.value.ratio)) generation.value.ratio = generationRatios.value.includes(document.value.ratio) ? document.value.ratio : generationRatios.value[0]!;
});
watch([() => props.imageModels, generationDialogVisible, batchGenerationDialogVisible], ([models, singleVisible, batchVisible]) => {
  if ((!singleVisible && !batchVisible) || !models.length || generation.value.model) return;
  const model = findNodeModel(props.imageModels, document.value.imageModel) ?? props.imageModels[0];
  if (model) generation.value.model = getNodeModelKey(model);
});
const sourceOpen = ref<string[]>([]);
const selectedShotIds = ref<string[]>([]);
const chosenShotIds = computed(() => {
  const selected = selectedShotIds.value.filter(id => document.value.shots.some(shot => shot.id === id));
  return selected.length ? selected : document.value.shots.map(shot => shot.id);
});
const totalDuration = computed(() => Math.round(document.value.shots.reduce((sum, shot) => sum + (shot.duration || 0), 0) * 10) / 10);
const assetsReady = computed(() => document.value.assets.filter(assetReady).length);
function assetReady(asset: ScriptAsset) {
  return !!assetImage(asset, (id, handle) => findNode(id)?.data.outputs?.[handle]);
}
const sourceSummary = computed(() => [document.value.mode === "manual" ? "手工编写" : document.value.mode === "character" ? "角色创作" : "剧本拆解", document.value.shots.length + " 个镜头", document.value.ratio].join(" · "));
const shotSizes = ["大远景", "远景", "全景", "中远景", "中景", "中近景", "近景", "特写", "大特写", "头肩景", "半身景", "全身景"];
function setShotSize(shot: ScriptShot, value: string) {
  if (!props.busy && shotSizes.includes(value)) shot.shotSize = value;
}
const fields = [
  { key: "lighting", label: "光影氛围", width: 150, limit: 1000 }, { key: "dialogue", label: "对白／旁白", width: 185, limit: 3000 },
  { key: "sound", label: "音效", width: 135, limit: 1000 }, { key: "movement", label: "运镜与动作", width: 150, limit: 1000 },
] as const;
const rowColors = ["#f56565", "#fbbf24", "#10b981", "#06b6d4", "#bfbfbf"];
const editingText = shallowRef<{ shot: ScriptShot; field: "description" | "dialogue"; html: string }>();
const editingTextCell = computed(() => editingText.value ? textCellKey(editingText.value.shot, editingText.value.field) : "");
watch([() => document.value.step, () => props.busy], () => { editingText.value = undefined; });
function addShot() { if (document.value.shots.length < 120) document.value.shots.push(createShot()); }
function shotRowStyle({ row }: { row: ScriptShot }) { return row.color ? { "--el-table-tr-bg-color": row.color + "28" } : {}; }
function setShotColor(shot: ScriptShot, color?: string) { if (color) shot.color = color; else delete shot.color; }
async function removeShot(shot: ScriptShot) {
  const confirmed = await ElMessageBox.confirm("移除此镜头的脚本记录？已创建的图片、视频节点会保留。", "移除镜头", { confirmButtonText: "移除", cancelButtonText: "取消" }).then(() => true, () => false);
  if (confirmed) document.value.shots = document.value.shots.filter(item => item.id !== shot.id);
}
function assetsForKind(kind: ScriptAsset["kind"]) { return document.value.assets.filter(asset => asset.kind === kind); }
function assetKindLabel(kind: ScriptAsset["kind"]) { return assetKinds.find(item => item.value === kind)?.label ?? "资产"; }
function assetsForShot(shot: ScriptShot) { return document.value.assets.filter(asset => shot.assetIds.includes(asset.id)); }
function assetMentionNames(shot: ScriptShot) {
  return assetsForShot(shot).flatMap(asset => {
    const name = asset.name.trim();
    const mainName = name.split(/[（(]/, 1)[0].trim();
    return [...new Set([name, mainName])].filter(name => name.length >= 2);
  }).sort((left, right) => right.length - left.length);
}
function textParts(text: string, shot: ScriptShot) {
  const assetNames = assetMentionNames(shot);
  const parts: { text: string; asset: boolean }[] = [];
  let remaining = text;
  while (remaining) {
    const match = assetNames.map(name => {
      const index = remaining.indexOf(name);
      const hasMarker = index > 0 && remaining[index - 1] === "@";
      return { name, index: hasMarker ? index - 1 : index, length: name.length + Number(hasMarker) };
    }).filter(item => item.index >= 0).sort((left, right) => left.index - right.index || right.length - left.length)[0];
    if (!match) { parts.push({ text: remaining, asset: false }); break; }
    if (match.index) parts.push({ text: remaining.slice(0, match.index), asset: false });
    parts.push({ text: match.name, asset: true });
    remaining = remaining.slice(match.index + match.length);
  }
  return parts;
}
function escapeHtml(text: string) { return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('\"', "&quot;").replaceAll("'", "&#39;"); }
function mentionEditorHtml(text: string, shot: ScriptShot) {
  return textParts(text, shot).map(part => part.asset ? `<span class="editorMention">@${escapeHtml(part.text)}</span>` : escapeHtml(part.text)).join("").replaceAll("\n", "<br>");
}
function textCellKey(shot: ScriptShot, field: "description" | "dialogue") { return shot.id + ":" + field; }
function setEditingTextCell(shot: ScriptShot, field: "description" | "dialogue", visible: boolean) {
  if (visible) {
    if (props.busy || editingTextCell.value === textCellKey(shot, field)) return;
    editingText.value = { shot, field, html: mentionEditorHtml(shot[field], shot) };
  } else if (editingTextCell.value === textCellKey(shot, field)) editingText.value = undefined;
}
function updateTextDraft(event: Event, shot: ScriptShot, field: "description" | "dialogue") {
  if (props.busy || editingTextCell.value !== textCellKey(shot, field)) return;
  const element = event.currentTarget as HTMLElement;
  const names = assetMentionNames(shot).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const mentionPattern = names.length ? new RegExp("@(?=" + names.join("|") + ")", "g") : undefined;
  const text = mentionPattern ? element.innerText.replace(mentionPattern, "") : element.innerText;
  const limit = field === "description" ? 6000 : 3000;
  if (text.length > limit) {
    ElMessage.warning("内容最多允许 " + limit + " 字，超出部分未保存");
    element.innerHTML = mentionEditorHtml(shot[field], shot);
    return;
  }
  // 编辑内容直接进入画布数据；弹层 HTML 固定为打开时的快照，避免输入时重绘导致光标跳动。
  shot[field] = text;
}
function addAsset(kind: ScriptAsset["kind"]) {
  if (props.busy || document.value.assets.length >= 60) return;
  const asset = { id: crypto.randomUUID(), kind, name: "", description: "" };
  document.value.assets.push(asset);
  openAssetEditor(asset);
}
async function removeAsset(asset: ScriptAsset) {
  const confirmed = await ElMessageBox.confirm("移除此资产记录及分镜中的关联？已有素材和生成节点会保留。", "移除资产", { confirmButtonText: "移除", cancelButtonText: "取消" }).then(() => true, () => false);
  if (!confirmed) return;
  document.value.assets = document.value.assets.filter(item => item.id !== asset.id);
  document.value.shots.forEach(shot => { shot.assetIds = shot.assetIds.filter(id => id !== asset.id); });
}
function openAssetEditor(asset: ScriptAsset) {
  editingAssetId.value = asset.id;
  assetEditDialogVisible.value = true;
}
function runEditingAssetCommand(command: string) {
  const asset = editingAsset.value;
  if (asset) return assetCommand(command, asset);
}
async function assetCommand(command: string, asset: ScriptAsset) {
  if (props.busy) return;
  if (command === "edit") {
    openAssetEditor(asset);
  } else if (command === "select") {
    try {
      const reference = await props.selectAssetImage();
      if (!reference || props.busy || !document.value.assets.includes(asset)) return;
      asset.source = reference.source; asset.sourceHandle = reference.sourceHandle; delete asset.imageNodeId;
    } catch (cause) { ElMessage.warning(cause instanceof Error ? cause.message : "选择资产图片失败"); }
  } else if (command === "generate") {
    if (!asset.name.trim() || !asset.description.trim()) return void ElMessage.warning("请先填写资产名称和视觉描述");
    const defaultModel = findNodeModel(props.imageModels, document.value.imageModel) ?? props.imageModels[0];
    generationAssetId.value = asset.id;
    generation.value = {
      model: defaultModel ? getNodeModelKey(defaultModel) : "", size: "", ratio: document.value.ratio, other: {},
      prompt: [document.value.style, asset.name + "：" + asset.description, "单独展示该资产，保持外观特征清晰一致"].filter(Boolean).join("\n"),
    };
    generationDialogVisible.value = true;
    emit("loadModels");
  } else if (command === "focus") emit("focus", asset.imageNodeId ?? asset.source);
  else if (command === "clear") { delete asset.imageNodeId; delete asset.source; delete asset.sourceHandle; }
  else if (command === "save") emit("saveAsset", asset.id);
  else if (command === "delete") await removeAsset(asset);
}
function confirmAssetGeneration() {
  const asset = document.value.assets.find(item => item.id === generationAssetId.value);
  if (!asset) return void (generationDialogVisible.value = false);
  generationDialogVisible.value = false;
  emit("media", "image", [asset.id], true, true, { ...generation.value });
}
function openBatchGeneration() {
  batchAssetIds.value = document.value.assets.filter(asset => !assetReady(asset) && asset.name.trim() && asset.description.trim()).map(asset => asset.id);
  const defaultModel = findNodeModel(props.imageModels, document.value.imageModel) ?? props.imageModels[0];
  generation.value = { model: defaultModel ? getNodeModelKey(defaultModel) : "", size: "", ratio: document.value.ratio, other: {}, prompt: "" };
  batchGenerationDialogVisible.value = true;
  emit("loadModels");
}
function confirmBatchGeneration() {
  const ids = batchAssetIds.value.filter(id => document.value.assets.some(asset => asset.id === id && !assetReady(asset)));
  if (!ids.length) return void ElMessage.warning("请至少选择一项待生成资产");
  batchGenerationDialogVisible.value = false;
  emit("media", "image", ids, true, true, { ...generation.value });
}
function nextStep() {
  goToStep(document.value.step + 1);
}
function goToStep(step: number) {
  if (props.busy || step < 0 || step > 2) return;
  if (step > document.value.step) {
    if (!document.value.shots.length || document.value.shots.some(shot => !shot.description.trim() || !Number.isFinite(shot.duration) || shot.duration < 1 || shot.duration > 120)) return void ElMessage.warning("请补全每个镜头的画面描述和时长");
    if (step === 2 && document.value.assets.some(asset => !asset.name.trim() || !asset.description.trim())) return void ElMessage.warning("请补全资产名称和视觉描述");
  }
  document.value.step = step;
}
</script>
<style scoped lang="scss">
.assetGenerationDialog { display: grid; gap: 18px; .providerModelSelect { width: 100%; } }
.batchGenerationDialog { display: grid; gap: 18px; max-height: min(62vh, 620px); overflow: auto; }
.batchAssetGroup { display: grid; gap: 8px; > strong { font-size: 13px; } .el-checkbox-group { display: grid; gap: 8px; } }
.batchAssetOption { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-bg-color); }
.batchAssetText { display: grid; min-width: 0; gap: 4px; > span { display: flex; align-items: center; gap: 8px; font-size: 13px; } small { overflow: hidden; color: var(--el-text-color-secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; } }
.batchGenerationSettings { display: grid; gap: 14px; padding-top: 14px; border-top: 1px solid var(--el-border-color-lighter); .providerModelSelect { width: 100%; } }
.batchSelectionCount { margin-right: auto; color: var(--el-text-color-secondary); font-size: 12px; }
:global(.shotMentionPopover.el-popover) { padding: 12px; border: 1px solid var(--el-border-color); border-radius: 8px; background: var(--el-bg-color-overlay); box-shadow: var(--el-box-shadow-light); }
.mentionEditor {
  .mentionEditorText {
    min-height: 76px; max-height: 260px; padding: 8px; overflow: auto; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; color: var(--el-text-color-primary); background: var(--el-fill-color-darker); font-size: 13px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; outline: none;
    &:focus { border-color: var(--el-color-primary); }
    &:empty::before { color: var(--el-text-color-placeholder); content: attr(data-placeholder); }
    :deep(.editorMention) { color: #35d6c5; font-weight: 600; }
  }
}
:global(.shotActionsPopover.el-popover) { padding: 0; border-radius: 8px; overflow: hidden; border: 1px solid var(--el-border-color); background: var(--el-bg-color-overlay); box-shadow: 0 8px 24px #00000033; }
.shotActionsMenu {
  .rowColorPicker { padding: 12px; }
  .rowColorLabel { display: block; margin-bottom: 10px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 16px; }
  .rowColorOptions { display: flex; align-items: center; gap: 6px; }
  .rowColorSwatch {
    position: relative; flex-shrink: 0; width: 20px; height: 20px; padding: 0; border: 1px solid #ffffff22; border-radius: 50%; cursor: pointer; transition: box-shadow .15s, transform .15s;
    &:hover { transform: scale(1.12); }
    &[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--el-bg-color-overlay), 0 0 0 3px var(--el-text-color-secondary); }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
    &.clearRowColor { background: var(--el-fill-color-dark); &::after { content: ""; position: absolute; top: 8px; left: 2px; width: 14px; height: 1px; background: #f56565; transform: rotate(-45deg); } }
  }
  .deleteShotButton {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; border: 0; border-top: 1px solid var(--el-border-color-lighter); color: #f56565; background: transparent; font: inherit; font-size: 12px; line-height: 16px; cursor: pointer;
    &:hover { background: #f5656514; }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -3px; }
  }
}
:global(.scriptGeneratorDialog.el-dialog) { padding: 0; height: 100dvh; overflow: hidden; --el-dialog-padding-primary: 0px; }
:global(.scriptGeneratorDialog > .el-dialog__header) { display: none; }
:global(.scriptGeneratorDialog > .el-dialog__body) { height: 100%; padding: 0; overflow: hidden; }
:global(.assetEditDrawer .el-drawer__body) { padding: 18px 20px; overflow: auto; }
:global(.assetEditDrawer .drawerAssetPreview) { height: 260px; min-height: 260px; border-radius: 6px; }
:global(.assetEditDrawer .drawerAssetPreview img) { height: 260px; object-fit: cover; object-position: center; }
:global(.assetEditDrawer .drawerAssetImage) { position: relative; }
:global(.assetEditDrawer .drawerAssetMenu) { position: absolute; z-index: 3; top: 8px; right: 8px; }
:global(.assetEditDrawer .assetEditPanel) { display: flex; flex-direction: column; gap: 0; }
:global(.assetEditDrawer .assetEditField) { display: grid; gap: 10px; min-width: 0; color: var(--el-text-color-primary); }
:global(.assetEditDrawer .assetEditField > span) { font-size: 13px; font-weight: 600; line-height: 1.5; }
:global(.assetEditDrawer .assetImageField) { padding-bottom: 20px; border-bottom: 1px solid var(--el-border-color-lighter); }
:global(.assetEditDrawer .assetNameField) { padding: 18px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
:global(.assetEditDrawer .assetPromptField) { padding-top: 18px; }
.scriptEditor {
  display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--el-text-color-primary); background: var(--el-bg-color);
  .editorHeader {
    position: relative; flex-shrink: 0; min-height: 70px; padding: 8px 20px;
    .headingLine { display: flex; align-items: center; justify-content: space-between; min-height: 48px; gap: 12px; }
    .scriptIdentity, .headerActions { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .scriptMark { display: grid; place-items: center; width: 28px; height: 28px; color: var(--el-text-color-secondary); }
    .scriptTitle { width: 180px; :deep(.el-input__wrapper) { box-shadow: none; padding: 0; background: transparent; } :deep(input) { font-size: 13px; font-weight: 500; } }
    .scriptStats { color: var(--el-text-color-secondary); white-space: nowrap; font-size: 11px; }
    .headerActions { margin-left: auto; .el-button { width: 28px; height: 28px; margin: 0; padding: 0; } }
    .stepNav {
      position: absolute; top: 8px; left: 50%; transform: translateX(-50%); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); width: min(690px, 56vw); gap: 40px;
      button { position: relative; display: flex; align-items: center; min-width: 0; gap: 10px; padding: 7px 10px; border: 0; border-radius: 7px; background: transparent; color: var(--el-text-color-secondary); text-align: left; cursor: pointer; font: inherit;
        &::after { content: ""; position: absolute; left: calc(100% + 8px); top: 50%; width: 24px; height: 1px; background: var(--el-border-color); }
        &:last-child::after { display: none; }
        .stepState { display: grid; place-items: center; flex-shrink: 0; width: 30px; height: 30px; border: 2px solid var(--el-border-color); border-radius: 50%; font-size: 14px; }
        .stepText { display: flex; flex-direction: column; min-width: 0; gap: 3px; strong { font-size: 12px; font-weight: 500; } small { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; color: var(--el-text-color-secondary); } }
        &.current { background: var(--el-fill-color-light); color: var(--el-text-color-primary); .stepState { border-color: var(--el-text-color-secondary); } }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
      }
    }
  }
  .editorAlert { width: calc(100% - 40px); flex-shrink: 0; margin: 0 20px 10px; }
  .editorBody {
    display: flex; flex-direction: column; flex: 1; min-height: 0; margin: 0 20px; padding: 0; overflow: auto; border: 1px solid var(--el-border-color); border-bottom: 0; border-radius: 8px 8px 0 0; background: var(--el-bg-color-overlay);
    .shotSection { display: flex; flex-direction: column; flex: 1; min-height: 200px; }
    .sourcePanel { flex-shrink: 0; padding: 0 16px; border: 0; :deep(.el-collapse-item__header) { height: 40px; background: transparent; border-bottom: 0; font-size: 12px; } :deep(.el-collapse-item__wrap) { max-height: 340px; overflow: auto; background: transparent; border-bottom: 0; } :deep(.el-collapse-item__content) { padding-bottom: 14px; }
      .sourcePanelTitle { display: flex; align-items: center; gap: 16px; small { font-size: 11px; color: var(--el-text-color-secondary); } }
      .el-textarea { margin: 12px 0; } .sourceControls { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin: 10px 0; label { display: flex; align-items: center; gap: 8px; font-size: 12px; } .el-select { width: 100px; } }
    }
    .shotTable { flex: 1; min-height: 170px; width: 100%; --el-table-border-color: var(--el-border-color); --el-table-header-bg-color: var(--el-fill-color-light); --el-table-bg-color: var(--el-bg-color-overlay); --el-table-tr-bg-color: var(--el-bg-color-overlay);
      :deep(.el-table__header th) { height: 44px; color: var(--el-text-color-secondary); font-size: 12px; font-weight: 400; }
      :deep(.el-table__body td) { padding: 6px 0; vertical-align: top; } :deep(.el-table__empty-block) { min-height: 100%; }
      :deep(.el-table__body td.centeredColumn) { vertical-align: middle; }
      :deep(.centeredColumn .cell) { padding-right: 8px; padding-left: 8px; text-overflow: clip; }
      .shotActionsButton { width: 32px; height: 32px; padding: 0; }
      .shotSizeDropdown { width: 100%; .shotSizeButton { width: 100%; min-height: 32px; padding: 5px 4px; border: 0; border-radius: 5px; background: transparent; color: var(--el-text-color-primary); font: inherit; font-size: 12px; text-align: center; cursor: pointer; &:hover { background: var(--el-fill-color-light); } &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; } &:disabled { cursor: default; opacity: .6; } } }
      :deep(.el-textarea__inner) { padding: 5px 4px; box-shadow: none; border: 1px solid transparent; background: transparent; font-size: 12px; resize: none; }
      :deep(.el-textarea__inner:focus) { border-color: var(--el-color-primary); background: var(--el-bg-color); }
      :deep(.el-input-number) { width: 56px; max-width: 100%; } :deep(.el-input__wrapper) { padding-right: 4px; padding-left: 4px; box-shadow: none; background: transparent; }
      .shotAssets { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 4px 4px; .el-tag { color: var(--el-color-primary-light-3); border-color: var(--el-color-primary-dark-2); background: var(--el-color-primary-dark-9); } }
      .shotDescriptionCell, .dialoguePreview { display: block; width: 100%; min-height: 44px; padding: 4px 8px; border: 0; color: var(--el-text-color-primary); background: transparent; font: inherit; font-size: 12px; line-height: 1.55; text-align: left; white-space: pre-wrap; overflow-wrap: anywhere; cursor: text; &:hover { background: var(--el-fill-color-light); } &:disabled { cursor: default; } .assetMention, .dialogueMention { color: #35d6c5; font-weight: 600; } }
      .shotDescriptionCell { position: relative; padding-right: 26px; .tabler-icon { position: absolute; top: 5px; right: 5px; color: var(--el-text-color-secondary); } }
      .finalPromptCell { max-height: 64px; overflow: hidden; color: var(--el-text-color-secondary); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
    }
    .sectionTools { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin: 12px 0; }
    .assetSection { width: 100%; padding: 16px 18px 24px; }
    .globalStyle { display: flex; align-items: flex-start; gap: 12px; max-width: 1100px; margin: 0 0 22px; .el-tag { flex-shrink: 0; margin-top: 5px; color: var(--el-color-primary-light-3); border: 0; background: var(--el-color-primary-dark-9); } .el-input :deep(.el-input__wrapper) { box-shadow: none; background: transparent; } }
    .assetGroup { margin-bottom: 22px; .assetGroupHeader { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; > div { display: flex; align-items: center; gap: 12px; } h2 { margin: 0; font-size: 14px; font-weight: 600; } span { color: var(--el-text-color-secondary); font-size: 11px; } .el-button + .el-button { margin-left: 6px; } } }
    .assetGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr)); align-items: stretch; gap: 12px; }
    .assetCard { position: relative; min-width: 0; overflow: hidden; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-bg-color); cursor: pointer; &:hover { border-color: var(--el-color-primary); } .assetMenu { position: absolute; z-index: 2; top: 6px; right: 6px; } .assetSummary { display: grid; gap: 5px; min-width: 0; padding: 9px 10px 11px; background: var(--el-bg-color); strong { overflow: hidden; font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; } p { margin: 0; overflow: hidden; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; } } }
    .addAssetTile { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 154px; gap: 8px; border: 1px dashed var(--el-border-color); border-radius: 6px; color: var(--el-text-color-secondary); background: transparent; cursor: pointer; &:hover { color: var(--el-color-primary); border-color: var(--el-color-primary); } &:disabled { cursor: not-allowed; opacity: .5; } }
    .promptSection { padding: 0 16px 20px; }
    .mediaControls { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin-top: 16px; }
    .generationSettings { margin-top: 16px; border-top: 1px solid var(--el-border-color-lighter); .el-checkbox { margin-top: 12px; } }
    .shotDescription { max-height: 160px; overflow: auto; white-space: pre-wrap; line-height: 1.6; }
    .operationReports { padding: 16px; margin: 16px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; div { display: flex; align-items: center; gap: 12px; } .failed { color: var(--el-color-danger); } }
    .rawResponse { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow: auto; }
  }
  .editorFooter { display: flex; align-items: center; flex-shrink: 0; gap: 12px; min-height: 56px; margin: 0 20px 14px; padding: 8px 16px; border: 1px solid var(--el-border-color); border-radius: 0 0 8px 8px; background: var(--el-bg-color-overlay);
    .footerStatus { display: flex; align-items: center; gap: 12px; min-width: 0; .el-button { margin: 0; padding: 8px 4px; } }
    .stepActions { display: flex; gap: 10px; margin-left: auto; .el-button .tabler-icon { margin-left: 8px; } .el-button--primary { color: var(--el-bg-color); background: var(--el-text-color-primary); border-color: var(--el-text-color-primary); } }
  }
  .muted { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; }
  @media (max-width: 1100px) { .editorHeader { .scriptIdentity, .scriptStats { display: none; } .stepNav { left: 16px; width: calc(100% - 70px); transform: none; } } }
  @media (max-width: 700px) { .editorHeader { padding: 8px 12px; .stepNav { gap: 8px; button { gap: 6px; padding: 8px 4px; &::after { display: none; } .stepText small { display: none; } } } } .editorBody { margin: 0 10px; .assetSection { padding-right: 10px; padding-left: 10px; } .assetGroup .assetGroupHeader { align-items: flex-start; > div { flex-wrap: wrap; } } } .editorFooter { margin: 0 10px 10px; padding-right: 10px; padding-left: 10px; } .editorAlert { margin: 0 10px 8px; width: calc(100% - 20px); } }
}
.shotSizeOption { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-width: 88px; min-height: 26px; .tabler-icon { color: var(--el-text-color-secondary); } }
</style>
