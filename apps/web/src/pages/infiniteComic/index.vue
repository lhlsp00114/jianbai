<template>
  <main class="comicWorkspace">
    <header class="workspaceHeader">
      <workspaceMenu class="comicProjectMenu" @openSettings="settingsVisible = true" />
      <div class="comicProjectIdentity">
        <strong class="comicProjectName" :title="workspace.project?.name">{{ workspace.project?.name }}</strong>
        <el-divider direction="vertical" />
        <comicFilePicker :directory="directory" :comicPath="comicPath" :disabled="busy || cancelling" @select="openComicFile" />
      </div>
      <workspacePanelSwitcher class="panelSwitcher" activePanel="comic" showComic @change="switchWorkspacePanel" />
    </header>
    <div class="comicWorkflowBar">
      <nav class="stepNavigation" aria-label="漫画创作步骤">
        <button v-for="(label, index) in steps" :key="label" type="button" :class="{ active: project.activeStep === index + 1 }" :disabled="!loaded" :aria-current="project.activeStep === index + 1 ? 'step' : undefined" @click="project.activeStep = index + 1"><span>{{ index + 1 }}</span>{{ label }}</button>
      </nav>
      <el-button class="generationToggle" text :aria-pressed="generationSettingsVisible" @click="generationSettingsVisible = !generationSettingsVisible">生成设置</el-button>
    </div>
    <div v-if="loadError" class="loadError" role="alert">{{ loadError }}<el-button @click="loadProject">重新读取</el-button></div>
    <el-alert v-if="session.message.value.includes('备份')" :title="session.message.value" type="warning" :closable="false" />
    <div v-if="loaded" class="workspaceBody" :class="{ settingsHidden: !sidebarVisible, creationStep: project.activeStep === 1, scriptStep: project.activeStep === 2, previewStep: project.activeStep === 5 }">
      <aside v-if="project.activeStep >= 3" class="pageRail">
        <div class="railHeading"><strong>页面 · {{ project.pages.length }}</strong><el-button text :disabled="busy" @click="addPage">＋</el-button></div>
        <div class="pageList">
          <button v-for="(page, index) in project.pages" :key="page.id" type="button" :class="{ active: page.id === project.selectedPageId }" @click="project.selectedPageId = page.id">
            <span class="pageNumber">{{ page.number ?? index + 1 }}</span><span><strong>{{ page.title }}</strong><small>{{ session.active.has(page.id) ? '生成／查询中' : session.queued.has(page.id) ? '排队中' : page.task?.cancelled ? '已停止，可查询' : page.task ? '待恢复任务' : page.error ? '生成失败' : page.versions.length ? '已生成' : '待生成' }}</small></span>
          </button>
        </div>
        <el-button v-if="project.activeStep === 5" type="primary" :disabled="busy || cancelling || batchRunning || session.active.size > 0 || !imageModel || !pendingPages.length" @click="generateAll">生成待完成页面 · {{ pendingPages.length }}</el-button>
        <el-button v-if="batchRunning" :disabled="batchStopped" @click="batchStopped = true">{{ batchStopped ? '已停止排队，等待已提交任务' : '停止后续页面' }}</el-button>
        <div v-if="batchTotal" class="batchSummary" role="status"><el-progress :percentage="Math.round((batchCompleted + batchFailed) / batchTotal * 100)" :strokeWidth="6" /><span>完成 {{ batchCompleted }} · 未完成 {{ batchFailed }} · 共 {{ batchTotal }} 页</span></div>
        <el-button v-if="selectedPage" text type="danger" :disabled="busy || !!selectedPage.task || session.queued.has(selectedPage.id)" @click="removePage()">删除当前页</el-button>
      </aside>
      <section :key="[1, 5].includes(project.activeStep) ? project.activeStep : 0" class="stepContent" :aria-label="steps[project.activeStep - 1]">
        <template v-if="project.activeStep === 1">
          <div class="creationContent">
          <el-alert v-if="project.creation.error" :title="project.creation.error" type="error" @close="clearScriptError" />
          <div class="creationLayout">
          <div class="creationForm">
            <h2>AI 漫画创作</h2>
            <div class="storyFields">
              <label>故事主题<el-input v-model="project.creation.topic" type="textarea" :rows="3" :disabled="busy" /></label>
              <label>创作要求<el-input v-model="project.creation.requirements" type="textarea" :rows="3" :disabled="busy" /></label>
            </div>
            <div class="creationParameters">
              <label class="narrativeField">叙事风格<el-input v-model="project.creation.narrativeStyle" :disabled="busy" /></label>
              <label>目标页数<el-input-number :modelValue="project.creation.pageCount" :min="1" :max="50" :precision="0" :disabled="busy" @update:modelValue="(value: number | undefined) => project.creation.pageCount = Math.min(50, Math.max(1, Math.round(value || 1)))" /></label>
              <label>每页分格<el-select v-model="project.creation.panelMode" :disabled="busy"><el-option label="自动分格" value="auto" /><el-option label="自定义" value="custom" /></el-select></label>
              <label v-if="project.creation.panelMode === 'custom'" class="customPanelField">分格数量或范围<el-input v-model="project.creation.panelsPerPage" :disabled="busy" /></label>
            </div>
            <div class="creationActions">
              <label>文本模型<comicTextModelSelect v-model="project.creation.model" :models="textModels" :disabled="busy" :loading="textModelsLoading" @refresh="refreshTextModels" /></label>
              <el-button type="primary" :disabled="busy || !textModel || !project.creation.topic.trim()" @click="generateScript">生成漫画脚本</el-button>
              <span v-if="actionStatus" role="status">{{ actionStatus }}</span>
            </div>
          </div>
          <section class="creationCharacters">
            <div class="sectionHeading"><h3>故事角色参考</h3><el-button :disabled="busy" @click="addCharacter">新增角色</el-button></div>
            <div class="characterGrid"><article v-for="character in project.characters" :key="character.id" class="characterCard">
              <div v-if="character.reference" class="characterPreview"><comicImage :directory="directory" :reference="character.reference" /></div>
              <label>角色名称<el-input v-model="character.name" :disabled="busy" /></label>
              <label>角色设定<el-input v-model="character.description" type="textarea" :rows="3" :disabled="busy" /></label>
              <div class="formRow"><el-button :disabled="busy" @click="chooseUpload({ kind: 'character', characterId: character.id })">上传参考图</el-button><el-button text :disabled="busy" @click="removeCharacter(character.id)">删除角色</el-button></div>
            </article></div>
          </section>
          </div>
          <div v-if="project.creation.draftPages.length" class="draftPages">
            <div class="sectionHeading"><h3>脚本草稿 · {{ project.creation.draftPages.length }} 页</h3><span v-if="project.creation.generatedAt">{{ new Date(project.creation.generatedAt).toLocaleString() }}</span><el-button :disabled="busy" @click="applyDraft(false)">追加到脚本</el-button><el-button :disabled="busy" @click="applyDraft(true)">替换脚本</el-button></div>
            <article v-for="page in project.creation.draftPages" :key="page.id">
              <strong>{{ page.title }}</strong>
              <div class="storyFields">
                <label>草稿脚本<el-input v-model="page.script" type="textarea" :rows="5" :disabled="busy" /></label>
                <label>草稿画面描述<el-input :modelValue="page.description" type="textarea" :rows="5" :disabled="busy" @update:modelValue="(value: string) => updateDescription(page, value)" /></label>
              </div>
            </article>
          </div>
          <details v-if="project.creation.rawOutput"><summary>模型原始输出</summary><pre>{{ project.creation.rawOutput }}</pre></details>
          </div>
        </template>
        <template v-else-if="project.activeStep === 2">
          <div class="sectionHeading"><h2>脚本编辑</h2><el-button :disabled="busy" @click="tableDialog = true">粘贴表格</el-button><el-button :disabled="busy" @click="addPage">新增页面</el-button></div>
          <div class="scriptTable">
            <div class="scriptTableHeading"><strong>页码／名称</strong><strong>脚本／对白</strong><strong>画面描述</strong><span>操作</span></div>
            <article v-for="(page, index) in project.pages" :key="page.id" class="scriptRow">
              <div class="pageIdentity"><el-input-number :modelValue="page.number ?? index + 1" :min="1" :max="9999" :precision="0" :controls="false" :disabled="busy || !!page.task" :aria-label="`${page.title}页码`" @update:modelValue="(value: number | undefined) => page.number = Math.max(1, Math.round(value || 1))" /><el-input v-model="page.title" :disabled="busy || !!page.task" aria-label="页面名称" /></div>
              <el-input v-model="page.script" type="textarea" :rows="6" :disabled="busy || !!page.task" :aria-label="`${page.title}脚本对白`" />
              <el-input :modelValue="page.description" type="textarea" :rows="6" :disabled="busy || !!page.task" :aria-label="`${page.title}画面描述`" @update:modelValue="(value: string) => updateDescription(page, value)" />
              <div class="rowActions"><span>{{ page.panels.length }} 格</span><el-button text @click="project.selectedPageId = page.id; project.activeStep = 3">编辑分格</el-button><el-button text type="danger" :disabled="busy || !!page.task || session.queued.has(page.id)" @click="removePage(page)">删除此页</el-button></div>
            </article>
          </div>
        </template>
        <template v-else-if="project.activeStep === 3">
          <h2>分格编辑与检查</h2>
          <div v-if="selectedPage" class="pageEditor">
            <label>页面名称<el-input v-model="selectedPage.title" :disabled="busy || !!selectedPage.task" /></label>
            <label>脚本／对白<el-input v-model="selectedPage.script" type="textarea" :rows="5" :disabled="busy || !!selectedPage.task" /></label>
            <label>整页画面描述<el-input :modelValue="selectedPage.description" type="textarea" :rows="5" :disabled="busy || !!selectedPage.task" @update:modelValue="(value: string) => selectedPage && updateDescription(selectedPage, value)" /></label>
          </div>
          <div v-if="selectedPage" class="panelEditor">
            <div class="sectionHeading"><strong>{{ selectedPage.title }} · {{ selectedPage.panels.length }} 格</strong><el-button :disabled="busy || !!selectedPage.task" @click="rebuildPanels">重新识别分格</el-button><el-button :disabled="busy || !!selectedPage.task" @click="addPanel">新增分格</el-button></div>
            <article v-for="panel in selectedPage.panels" :key="panel.id" class="panelRow">
              <el-input v-model="panel.label" :disabled="busy || !!selectedPage.task" aria-label="分格编号" />
              <el-input v-model="panel.description" type="textarea" :rows="3" :disabled="busy || !!selectedPage.task" :aria-label="`${panel.label}画面描述`" />
              <el-button text type="danger" :disabled="busy || !!selectedPage.task" @click="selectedPage.panels = selectedPage.panels.filter(item => item.id !== panel.id)">移除分格</el-button>
            </article>
          </div>
        </template>
        <template v-else-if="project.activeStep === 4">
          <div class="sectionHeading"><h2>角色绑定</h2></div>
          <label>默认角色描述模型<comicTextModelSelect v-model="characterModelKey" :models="textModels" :disabled="busy" :loading="textModelsLoading" @refresh="refreshTextModels" /></label>
          <comicCharacterEditor :characters="project.characters" :models="textModels" :defaultModel="characterModelKey" :directory="directory" :disabled="busy" @add="addCharacter" @remove="removeCharacter" @upload="(id: string) => chooseUpload({ kind: 'character', characterId: id })" @describe="describeCharacter" @refresh="refreshTextModels" />
        </template>
        <template v-else-if="project.activeStep === 5 && selectedPage">
          <div class="previewToolbar">
            <h2>{{ selectedPage.title }}</h2>
            <el-segmented v-model="generationView" class="generationTabs" :options="[{ label: '页面预览', value: 'preview' }, { label: '单格局部重绘', value: 'redraw' }]" aria-label="页面预览与单格局部重绘切换" />
            <div class="previewActions">
              <el-button v-if="selectedPage.task" :disabled="busy || cancelling || session.active.has(selectedPage.id)" @click="recoverPage(selectedPage)">查询／恢复结果</el-button>
              <el-button v-if="selectedPage.task" :disabled="cancelling || (busy && activePageId !== selectedPage.id)" @click="cancelTask(selectedPage)">{{ selectedPage.task.cancelled ? '确认结束任务' : '停止任务' }}</el-button>
              <el-button type="primary" :disabled="busy || cancelling || batchRunning || !!selectedPage.task || !imageModel || !inspectPage(project, selectedPage).canGenerate" @click="generatePage(selectedPage)">生成本页</el-button>
            </div>
          </div>
          <div v-if="session.message.value || actionStatus || selectedPage.task || selectedPage.error" class="previewStatus">
            <p v-if="session.message.value || actionStatus" role="status">{{ session.message.value || actionStatus }}</p><p v-if="selectedPage.task" role="status">本页剩余 {{ selectedPage.task.remaining ?? 1 }} 次（含当前任务）</p><p v-if="selectedPage.error" class="errorText" role="alert">{{ selectedPage.error }}</p>
          </div>
          <section v-show="generationView === 'preview'">
          <div v-if="selectedVersion" class="resultLayout">
          <div v-if="selectedImage" class="resultImage"><comicImage :directory="directory" :reference="selectedImage" /></div>
          <section class="versionSection" aria-label="生成版本">
          <div v-if="selectedImage" class="imageActions">
            <el-button @click="downloadReference(selectedImage)">下载</el-button>
            <el-button @click="copyImageToCanvas(selectedImage)">复制到画布</el-button>
            <el-button text :disabled="busy" @click="generationView = 'redraw'">用此图重绘</el-button>
            <el-button text type="danger" :disabled="busy || !!selectedPage.task" @click="removeVersionImage(selectedImage)">移除此图</el-button>
          </div>
          <label v-if="selectedVersion.images.length > 1">版本内图片
            <el-select :modelValue="selectedImage?.id" @update:modelValue="selectedImageId = $event">
              <el-option v-for="(reference, index) in selectedVersion.images" :key="reference.id" :value="reference.id" :label="`图片 ${index + 1}`" />
            </el-select>
          </label>
          <h3>生成版本</h3>
          <div class="versionList">
            <button v-for="(version, index) in selectedPage.versions" :key="version.id" type="button" :class="{ active: selectedVersion.id === version.id }" :aria-pressed="selectedVersion.id === version.id" @click="selectedVersionId = version.id">
              <span v-if="version.images[0]" class="versionThumbnail"><comicImage :directory="directory" :reference="version.images[0]" /></span>
              <span>V{{ selectedPage.versions.length - index }}{{ index === 0 ? ' · 当前' : '' }} · {{ version.images.length }} 张</span>
            </button>
          </div>
          <div class="versionActions">
            <el-button text :disabled="busy || selectedVersion.id === selectedPage.versions[0]?.id" @click="restoreVersion">设为当前版本</el-button>
            <el-button text type="danger" :disabled="busy" @click="removeVersion">移除版本记录</el-button>
          </div>
          <p v-if="selectedVersion" class="versionMeta">{{ selectedVersion.model ?? '' }} · {{ selectedVersion.ratio ?? '' }} · {{ selectedVersion.size ?? '' }} · {{ new Date(selectedVersion.createdAt).toLocaleString() }}</p>
          </section>
          </div>
          <details v-if="selectedVersion" class="versionRequest"><summary>此版本的生成记录</summary><p>{{ selectedVersion.request?.mode === 'redraw' ? `单格重绘 · ${selectedVersion.request.panelLabel}` : '整页生成' }}</p><pre>{{ selectedVersion.prompt }}</pre><template v-if="selectedVersion.request"><p v-if="selectedVersion.request.instruction">修改要求：{{ selectedVersion.request.instruction }}</p><pre>{{ JSON.stringify(selectedVersion.request.other, null, 2) }}</pre><div class="referenceGrid"><article v-for="(reference, index) in selectedVersion.request.references" :key="`${index}-${reference.id}`"><comicImage :directory="directory" :reference="reference" /><span>{{ index + 1 }} · {{ reference.label }}</span></article></div></template></details>
          <details class="previewPrompt" :open="!selectedVersion"><summary>最终提示词</summary><el-input aria-label="最终提示词" :modelValue="pagePrompt(project, selectedPage)" type="textarea" :rows="8" :disabled="busy || !!selectedPage.task" @update:modelValue="(value: string) => selectedPage && (selectedPage.prompt = stripPromptAffixes(project, value))" /><el-button text :disabled="busy || !!selectedPage.task" @click="selectedPage.prompt = ''">恢复自动提示词</el-button></details>
          </section>
          <div v-if="generationView === 'redraw'" class="redrawPanel">
            <div v-if="selectedImage" class="redrawPreview"><comicImage :directory="directory" :reference="selectedImage" /></div>
            <div class="panelChoices"><button v-for="(panel, index) in selectedPage.panels" :key="panel.id" type="button" :disabled="busy" :class="{ active: redrawPanelId === panel.id }" :aria-pressed="redrawPanelId === panel.id" @click="redrawPanelId = panel.id"><strong>第 {{ index + 1 }} 格 · {{ panel.label }}</strong><span>{{ panel.description }}</span></button></div>
            <el-input v-model="redrawInstruction" type="textarea" :rows="3" :disabled="busy" aria-label="单格修改要求" />
            <el-button :disabled="busy || !!selectedPage.task || !imageModel || !selectedImage || !redrawPanelId || !redrawInstruction.trim()" @click="generatePage(selectedPage, true)">重绘选中分格</el-button>
            <details v-if="redrawPanel"><summary>本次重绘提示词</summary><pre>{{ pagePrompt(project, selectedPage, redrawPanel, redrawInstruction) }}</pre></details>
          </div>
          <div class="pageReferences"><div class="sectionHeading"><h3>本页画面参考</h3><el-select v-model="referenceKind" :disabled="busy" aria-label="参考图用途"><el-option v-for="item in referenceKinds" :key="item.value" :value="item.value" :label="item.label" /></el-select><el-button :disabled="busy || !!selectedPage.task" @click="chooseUpload({ kind: referenceKind, pageId: selectedPage.id })">上传参考图</el-button></div><div class="referenceGrid"><article v-for="reference in selectedPage.references" :key="reference.id"><comicImage :directory="directory" :reference="reference" /><el-select v-model="reference.kind" :disabled="busy || !!selectedPage.task" aria-label="参考图用途"><el-option v-for="item in referenceKinds" :key="item.value" :value="item.value" :label="item.label" /></el-select><el-button text :disabled="busy || !!selectedPage.task" @click="selectedPage.references = selectedPage.references.filter(item => item.id !== reference.id)">移除</el-button></article></div></div>
          <details><summary>{{ generationView === 'redraw' ? '重绘参考图顺序' : '本页生成参考图顺序' }}</summary><div class="referenceGrid"><article v-for="(reference, index) in requestReferences" :key="`${index}-${reference.id}`"><comicImage :directory="directory" :reference="reference" /><span>{{ index + 1 }} · {{ reference.label }}</span></article></div></details>
        </template>
      </section>
      <aside v-if="project.activeStep === 2" class="projectOverviewSidebar">
        <h3>项目概览</h3>
        <div class="overviewGrid">
          <div><span>总页数</span><strong>{{ project.pages.length }}</strong></div>
          <div><span>可生成</span><strong>{{ readyPageCount }}</strong></div>
          <div><span>总分格</span><strong>{{ project.pages.reduce((total, page) => total + page.panels.length, 0) }}</strong></div>
          <div><span>已生成</span><strong>{{ project.pages.filter(page => page.versions.length).length }}</strong></div>
        </div>
      </aside>
      <aside v-show="sidebarVisible" class="generationSidebar">
        <template v-if="project.activeStep === 3 && selectedPage">
          <h3>生成检查 <span class="readyBadge">✓ 可生成</span></h3>
          <div class="checkStats">
            <div><span>分格</span><strong>{{ selectedPage.panels.length }}</strong></div>
            <div><span>角色</span><strong>{{ pageCharacters(project, selectedPage).length }}</strong></div>
            <div><span>参考图</span><strong>{{ pageReferences(project, selectedPage).length }}</strong></div>
          </div>
          <p v-if="!pageReferences(project, selectedPage).length" class="sidebarWarning">本页没有参考图，将使用文生图</p>
          <p v-for="message in inspectPage(project, selectedPage).errors" :key="message" class="errorText">{{ message }}</p>
          <p v-for="message in inspectPage(project, selectedPage).warnings" :key="message" class="warningText">{{ message }}</p>
        </template>
        <template v-else>
          <h3>{{ generationSettingsVisible ? '生成设置' : '当前页角色' }}</h3>
          <comicGenerationSettings v-show="generationSettingsVisible" v-model="project.settings" :models="imageModels" :disabled="busy" @refresh="refreshImageModels" />
          <comicPageBinding v-if="selectedPage && project.activeStep >= 3" :project="project" :page="selectedPage" :disabled="busy || !!selectedPage.task" />
        </template>
        <div v-show="generationSettingsVisible && project.activeStep !== 3" class="generationOptions">
        <section class="settingsSection"><el-switch v-model="project.settings.includeText" activeText="生成对白" :disabled="busy" aria-label="生成对白" /><p>将本页脚本中的对白绘制到对应分格。</p></section>
        <section class="settingsSection"><el-switch v-model="project.settings.usePreviousPageReference" activeText="参考上一页" :disabled="busy" aria-label="参考上一页" /><p>{{ previousPageReference ? `已使用：${previousPageReference.title}` : '上一页有生成结果时自动加入参考。' }}</p><div v-if="previousPageReference?.versions[0]?.images[0]" class="settingsPreview"><comicImage :directory="directory" :reference="previousPageReference.versions[0].images[0]" /></div></section>
        <details class="settingsSection"><summary>提示词前后缀</summary><div class="affixFields"><label>提示词前缀<el-input :modelValue="project.settings.promptPrefix" type="textarea" :rows="4" :disabled="busy" @update:modelValue="(value: string) => updateAffix('promptPrefix', value)" /></label><label>提示词后缀<el-input :modelValue="project.settings.promptSuffix" type="textarea" :rows="3" :disabled="busy" @update:modelValue="(value: string) => updateAffix('promptSuffix', value)" /></label></div></details>
        <section v-for="kind in projectReferenceKinds" :key="kind.value" class="settingsSection">
          <div class="sectionHeading"><strong>{{ kind.label }}</strong><el-button text :disabled="busy" @click="chooseUpload({ kind: kind.value })">{{ project.settings.references.some(item => item.kind === kind.value) ? '替换' : '上传' }}</el-button></div><p>{{ kind.description }}</p>
          <div v-for="reference in project.settings.references.filter(item => item.kind === kind.value)" :key="reference.id"><div class="settingsPreview"><comicImage :directory="directory" :reference="reference" /></div><el-button text :disabled="busy" @click="project.settings.references = project.settings.references.filter(item => item.id !== reference.id)">移除参考图</el-button></div>
        </section>
        </div>
      </aside>
    </div>
    <footer v-if="loaded" class="workspaceFooter">
      <span v-if="project.activeStep === 1">脚本草稿 · {{ project.creation.draftPages.length }} 页</span>
      <span v-else><template v-if="project.activeStep >= 3 && selectedPage">{{ selectedPage.title }} · </template>共 {{ project.pages.length }} 页</span>
      <el-button :disabled="project.activeStep <= 1" @click="project.activeStep--">上一步</el-button>
      <el-button :disabled="project.activeStep >= 5" @click="project.activeStep++">下一步</el-button>
    </footer>
    <input ref="uploadInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden @change="uploadReference" />
    <el-dialog v-model="tableDialog" title="粘贴漫画脚本表格" width="min(800px, 90vw)"><el-input v-model="tableText" type="textarea" :rows="14" aria-label="页码、脚本、画面描述表格" /><template #footer><el-button @click="tableDialog = false">取消</el-button><el-button type="primary" @click="importTable">追加页面</el-button></template></el-dialog>
    <workspaceSideToolbar class="comicSideToolbar" :libraryVisible="libraryVisible" :assetsVisible="assetsVisible" @openTool="openWorkspaceTool" />
    <creationLibrary v-model="libraryVisible" />
    <assetLibrary v-if="assetsVisible" v-model="assetsVisible" class="comicAssetLibrary" :directory="directory" />
    <input ref="canvasUploadInput" type="file" multiple hidden @change="uploadToCanvas" />
    <settings v-model="settingsVisible" />
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { findNodeModel, getNodeModelKey, getNodeModelIdentity, useNodeAi, useNodeModelSelection, type NodeAiModel, type NodeMediaModel, type NodeImageRequest } from "@toonflow/nodes-scaffold/nodeAi";
import { useWorkspaceStore } from "@/stores/workspace";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { getComicSession } from "./comicSession";
import { isComicFile } from "./comicPersistence";
import saveFile from "@/lib/saveFile";
import { writeClipboardImage } from "@/lib/clipboard";
import settings from "@/components/settings/index.vue";
import { settings as appSettings } from "@/stores/settings";
import workspaceMenu from "@/pages/workspace/components/workspaceMenu.vue";
import workspacePanelSwitcher from "@/pages/workspace/components/workspacePanelSwitcher.vue";
import workspaceSideToolbar from "@/pages/workspace/components/workspaceSideToolbar.vue";
import assetLibrary from "@/pages/workspace/panels/canvas/components/assetLibrary.vue";
import creationLibrary from "@/pages/workspace/panels/canvas/components/creationLibrary.vue";
import comicImage from "./comicImage.vue";
import comicFilePicker from "./comicFilePicker.vue";
import comicGenerationSettings from "./comicGenerationSettings.vue";
import comicTextModelSelect from "./comicTextModelSelect.vue";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import { readLastNodeModel, rememberNodeModel } from "@toonflow/node-shared/modelPreference";
import comicCharacterEditor from "./comicCharacterEditor.vue";
import comicPageBinding from "./comicPageBinding.vue";
import { comicFileName, createComicProject, createComicPage, splitPanels, pageCharacters, pageReferences, pagePrompt, stripPromptAffixes, inspectPage, readComicScriptInstruction, parseScript, parseTable, type ComicPage, type ComicCharacter, type ComicReference, type ComicRequestRecord } from "./comicProject";

const workspace = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const directory = workspace.project?.directory ?? "";
const files = useWorkspaceFiles(directory);
const comicPath = isComicFile(route.query.comicFile) ? route.query.comicFile : comicFileName;
const project = ref(createComicProject(workspace.project?.name ?? "漫画项目"));
const loaded = ref(false);
const loadError = ref("");
const session = getComicSession(directory, comicPath);
const saveError = session.saveError;
const saveStatus = session.saveStatus;
const actionStatus = ref("");
const busy = ref(false);
const cancelling = ref(false);
const activePageId = computed(() => [...session.active][0] ?? "");
const batchRunning = computed(() => session.batch.running);
const batchStopped = computed({ get: () => session.batch.stopped, set: value => { session.batch.stopped = value; } });
const batchTotal = computed(() => session.batch.total);
const batchCompleted = computed(() => session.batch.completed);
const batchFailed = computed(() => session.batch.failed);
const settingsVisible = ref(false);
const libraryVisible = ref(false);
const assetsVisible = ref(false);
const canvasUploadInput = ref<HTMLInputElement>();
const settingsExpanded = ref<boolean>();
const generationSettingsVisible = computed({ get: () => settingsExpanded.value ?? project.value.activeStep === 5, set: value => { settingsExpanded.value = value; } });
watch(() => project.value.activeStep, () => { settingsExpanded.value = undefined; });
const generationView = ref("preview");
const textModels = shallowRef<NodeAiModel[]>([]);
const imageModels = shallowRef<NodeMediaModel[]>([]);
const ai = useNodeAi({ onModelsChanged: refreshModels });
const imageModel = useNodeModelSelection(imageModels, computed({ get: () => project.value.settings.model, set: value => { project.value.settings.model = value; } }));
const textModel = useNodeModelSelection(textModels, computed({ get: () => project.value.creation.model, set: value => { project.value.creation.model = value; } }));
const characterModelKey = computed({ get: () => project.value.settings.characterModel || project.value.creation.model, set: value => { project.value.settings.characterModel = value; } });
const selectedPage = computed(() => project.value.pages.find(item => item.id === project.value.selectedPageId));
const sidebarVisible = computed(() => generationSettingsVisible.value || !!selectedPage.value && [3, 4].includes(project.value.activeStep));
const selectedVersionId = ref("");
const selectedVersion = computed(() => selectedPage.value?.versions.find(item => item.id === selectedVersionId.value) ?? selectedPage.value?.versions[0]);
const selectedImageId = ref("");
const selectedImage = computed(() => selectedVersion.value?.images.find(item => item.id === selectedImageId.value) ?? selectedVersion.value?.images[0]);
const redrawPanelId = ref("");
const redrawInstruction = ref("");
const redrawPanel = computed(() => selectedPage.value?.panels.find(panel => panel.id === redrawPanelId.value));
const readyPageCount = computed(() => project.value.pages.filter(page => !inspectPage(project.value, page).errors.length).length);
const pendingPages = computed(() => project.value.pages.filter(page => !page.versions.length && !page.task && inspectPage(project.value, page).canGenerate));
const requestReferences = computed(() => selectedPage.value ? [
  ...pageReferences(project.value, selectedPage.value),
  ...(generationView.value === "redraw" && selectedImage.value ? [{ ...selectedImage.value, label: "当前重绘底图" }] : []),
] : []);
const previousPageReference = computed(() => {
  if (!project.value.settings.usePreviousPageReference || !selectedPage.value) return;
  const previous = project.value.pages[project.value.pages.indexOf(selectedPage.value) - 1];
  return previous?.versions[0]?.images[0] ? previous : undefined;
});
const projectReferenceKinds = [
  { value: "style", label: "风格参考图", description: "统一色彩、线条、笔触与材质，不复制人物身份。" },
  { value: "composition", label: "外框样式参考图", description: "参考页面外框、分格形状、间距和排列，不复制人物与文字。" },
];
const tableDialog = ref(false);
const tableText = ref("");
const uploadInput = ref<HTMLInputElement>();
const referenceKinds = [{ value: "pose", label: "姿势参考" }, { value: "framing", label: "构图参考" }, { value: "scene", label: "场景参考" }, { value: "other", label: "其他参考" }];
const referenceKind = ref("pose");
type UploadTarget = { kind: string; characterId?: string; pageId?: string };
let uploadTarget: UploadTarget | undefined;
const steps = ["AI 漫画创作", "脚本编辑", "分格与检查", "角色绑定", "预览生成"];

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;

function showError(error: unknown) { showNodeError(error, "漫画操作失败"); }
function textGenerationError(error: unknown, model: NodeAiModel) {
  const message = error instanceof Error ? error.message : "文本生成失败";
  if (/\b401\b|authentication[_ ](?:error|fails)|api.?key.*invalid/i.test(message)) {
    return new Error(`文本供应商「${model.providerLabel}」的模型「${model.label}」认证失败。漫画与文本节点共用此供应商配置，请在设置中检查 API 地址、密钥和请求头；未自动更换供应商或重试。`);
  }
  return error;
}
watch(saveError, error => { if (error) showError(error); });
function clearScriptError() {
  project.value.creation.error = "";
  if (actionStatus.value === "脚本生成失败") actionStatus.value = "";
}
watch(() => project.value.creation.model, () => {
  if (loaded.value && !busy.value) clearScriptError();
});
async function save() {
  clearTimeout(saveTimer);
  if (!loaded.value) throw new Error("项目尚未读取完成");
  await session.save();
}
watch(project, () => {
  if (!loaded.value || disposed) return;
  saveStatus.value = "待保存";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void save().catch(() => {}); }, 600);
}, { deep: true, flush: "sync" });
watch(() => project.value.selectedPageId, () => { selectedVersionId.value = ""; redrawPanelId.value = selectedPage.value?.panels[0]?.id ?? ""; redrawInstruction.value = ""; generationView.value = "preview"; });
watch(() => selectedPage.value?.panels.map(panel => panel.id), ids => {
  if (!ids?.includes(redrawPanelId.value)) redrawPanelId.value = ids?.[0] ?? "";
}, { immediate: true });
watch(() => selectedVersion.value?.id, () => { selectedImageId.value = ""; });
watch(() => {
  const current = project.value;
  const common = JSON.stringify([current.characters.map(({ id, name, aliases, description, reference }) => ({ id, name, aliases, description, reference })), current.settings.references, current.settings.includeText, current.settings.usePreviousPageReference]);
  return new Map(current.pages.map((page, index) => [page.id, JSON.stringify([common, page.script, page.description, page.panels, page.characterIds, page.automaticCharacters, page.references,
    current.settings.usePreviousPageReference ? current.pages[index - 1]?.versions[0]?.images[0]?.path : undefined])]));
}, (current, previous) => {
  if (!loaded.value) return;
  for (const page of project.value.pages) if (previous?.has(page.id) && previous.get(page.id) !== current.get(page.id)) page.prompt = "";
}, { flush: "sync" });

async function openComicFile(path: string) {
  await router.push({ path: "/comic", query: { comicFile: path === comicFileName ? undefined : path } });
}

async function loadProject() {
  loadError.value = "";
  try {
    if (!directory) throw new Error("请先从首页打开漫画项目");
    const state = await session.refresh();
    const data = state.project.value;
    if (disposed) return;
    project.value = data;
    loaded.value = true;
    if (!selectedPage.value) project.value.selectedPageId = project.value.pages[0]?.id ?? "";
    await refreshModels();
  } catch (error) { if (!loaded.value) loadError.value = error instanceof Error ? error.message : "读取漫画项目失败"; else showError(error); }
  finally { workspace.projectLoading = false; }
}

const textModelsLoading = ref(false);
const imageModelsLoading = ref(false);
async function refreshTextModels() {
  if (textModelsLoading.value) return;
  textModelsLoading.value = true;
  try {
    const models = await ai.getModels();
    if (disposed) return;
    textModels.value = models;
    if (!project.value.creation.model) {
      const first = groupNodeModels(models)[0]?.models[0];
      if (first) project.value.creation.model = getNodeModelKey(first);
    }
  } catch (error) { if (!disposed) showError(error); }
  finally { textModelsLoading.value = false; }
}
async function refreshImageModels() {
  if (imageModelsLoading.value) return;
  imageModelsLoading.value = true;
  try {
    const models = await ai.getMediaModels();
    if (disposed) return;
    imageModels.value = models.filter(model => model.type === "image");
    if (!project.value.settings.model) {
      const first = readLastNodeModel("image", imageModels.value) ?? groupNodeModels(imageModels.value)[0]?.models[0];
      if (first) project.value.settings.model = getNodeModelKey(first);
    }
  } catch (error) { if (!disposed) showError(error); }
  finally { imageModelsLoading.value = false; }
}
async function refreshModels() {
  await Promise.allSettled([refreshTextModels(), refreshImageModels()]);
}

function addPage() {
  const page = createComicPage(Math.max(0, ...project.value.pages.map((item, index) => item.number ?? index + 1)) + 1);
  project.value.pages.push(page); project.value.selectedPageId = page.id; project.value.activeStep = 2;
}
async function removePage(page = selectedPage.value) {
  if (!page || page.task || busy.value || session.queued.has(page.id)) return;
  if (!await ElMessageBox.confirm("从漫画中移除此页？已保存的图片文件会保留。", "删除当前页", { type: "warning" }).then(() => true, () => false)) return;
  if (page.task || session.queued.has(page.id) || busy.value) return;
  project.value.pages = project.value.pages.filter(item => item.id !== page.id);
  if (project.value.selectedPageId === page.id) project.value.selectedPageId = project.value.pages[0]?.id ?? "";
}
function updateDescription(page: ComicPage, value: string) {
  if (busy.value || page.task) return;
  page.description = value;
  const pages = project.value.pages.includes(page) ? project.value.pages : project.value.creation.draftPages;
  page.panels = splitPanels(value, page.number ?? pages.indexOf(page) + 1);
  page.prompt = "";
}
async function rebuildPanels() {
  const page = selectedPage.value;
  if (!page || busy.value || page.task) return;
  if (page.panels.length && !await ElMessageBox.confirm("按画面描述重新识别，将替换当前手动编辑的分格。", "重新识别分格").then(() => true, () => false)) return;
  page.panels = splitPanels(page.description, page.number ?? project.value.pages.indexOf(page) + 1);
}
function addPanel() {
  const page = selectedPage.value;
  if (!page || busy.value || page.task) return;
  page.panels.push({ id: crypto.randomUUID(), label: `${page.number ?? project.value.pages.indexOf(page) + 1}-${page.panels.length + 1}`, description: "" });
}
function updateAffix(key: "promptPrefix" | "promptSuffix", value: string) {
  if (busy.value) return;
  for (const page of project.value.pages) page.prompt = stripPromptAffixes(project.value, page.prompt);
  project.value.settings[key] = value;
}
function addCharacter() { project.value.characters.push({ id: crypto.randomUUID(), name: `角色 ${project.value.characters.length + 1}`, aliases: "", description: "", reference: null }); }
async function removeCharacter(id: string) {
  if (!await ElMessageBox.confirm("移除此角色及页面绑定？参考图文件会保留。", "删除角色").then(() => true, () => false)) return;
  project.value.characters = project.value.characters.filter(item => item.id !== id);
  for (const page of project.value.pages) page.characterIds = page.characterIds.filter(item => item !== id);
}
function chooseUpload(target: UploadTarget) { uploadTarget = target; uploadInput.value?.click(); }
async function uploadReference(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; const target = uploadTarget; input.value = "";
  if (!file || !target || busy.value) return;
  busy.value = true;
  try {
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error("请使用不超过 15 MB 的 PNG、JPEG、WebP 或 GIF 图片");
    const listing = await files.list();
    if (!listing.entries.some(item => item.name === "assets" && item.type === "directory")) await files.mkdir("assets");
    const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[file.type];
    const path = `assets/${crypto.randomUUID()}.${extension}`;
    await files.write(path, file, true);
    const reference: ComicReference = { id: crypto.randomUUID(), label: file.name, path, mimeType: file.type, kind: target.kind };
    if (target.kind === "character") { const character = project.value.characters.find(item => item.id === target.characterId); if (character) character.reference = reference; }
    else if (target.pageId) project.value.pages.find(item => item.id === target.pageId)?.references.push(reference);
    else { reference.label = target.kind === "style" ? "风格参考图" : "外框参考图"; project.value.settings.references = [...project.value.settings.references.filter(item => item.kind !== target.kind), reference]; }
    await save();
  } catch (error) { showError(error); }
  finally { busy.value = false; }
}
async function generateScript() {
  const model = textModel.value; if (!model || busy.value) return;
  busy.value = true; actionStatus.value = "正在生成脚本"; project.value.creation.error = "";
  try {
    if (project.value.creation.panelMode === "custom") {
      const range = project.value.creation.panelsPerPage.trim().replace(/[~～到]/g, "-");
      if (!/^(?:[1-9]|1[0-2])(?:\s*-\s*(?:[1-9]|1[0-2]))?$/.test(range)) throw new Error("分格请输入 1–12 或范围，例如 1-4");
      const counts = range.split("-").map(Number).sort((left, right) => left - right);
      project.value.creation.panelsPerPage = [...new Set(counts)].join("-");
    }
    const creation = { ...project.value.creation };
    await save();
    const illustratedCharacters = project.value.characters.filter(item => item.reference);
    const references = illustratedCharacters.map(item => ({ dataType: "IMAGE" as const, value: { url: item.reference!.path, mimeType: item.reference!.mimeType } }));
    const characterDescriptions = project.value.characters.map(item => {
      const referenceIndex = illustratedCharacters.indexOf(item);
      return `${item.name}（${item.aliases}）：${item.description}${referenceIndex >= 0 ? `；对应参考图 ${referenceIndex + 1}` : '；没有参考图'}`;
    }).join("\n");
    const result = await ai.generate({ ...getNodeModelIdentity(model), directory, systemPrompt: readComicScriptInstruction(appSettings.value.stores), references,
      prompt: `故事主题：${creation.topic}\n创作要求：${creation.requirements}\n目标页数：${creation.pageCount}\n分格：${creation.panelMode === "custom" ? creation.panelsPerPage : "自动，每页1到12格"}\n叙事风格：${creation.narrativeStyle}\n角色：${characterDescriptions}`,
      onEvent: event => { if (event.type === "text") actionStatus.value = "正在接收脚本…"; },
    });
    project.value.creation.rawOutput = result.text;
    project.value.creation.draftPages = parseScript(result.text, creation.pageCount);
    project.value.creation.generatedAt = new Date().toISOString();
    actionStatus.value = "脚本草稿已生成";
    await save();
  } catch (error) { const failure = textGenerationError(error, model); actionStatus.value = "脚本生成失败"; project.value.creation.error = failure instanceof Error ? failure.message : "脚本生成失败"; await save().catch(showError); showError(failure); }
  finally { await save().catch(showError); busy.value = false; }
}
async function applyDraft(replace: boolean) {
  if (busy.value) return;
  if (replace && (session.batch.running || project.value.pages.some(page => page.task))) return ElMessage.warning("请先处理生成队列与页面任务，再替换脚本");
  if (replace && project.value.pages.length && !await ElMessageBox.confirm("将用新草稿替换当前页面，是否继续？", "替换脚本", { type: "warning" }).then(() => true, () => false)) return;
  if (busy.value || replace && (session.batch.running || project.value.pages.some(page => page.task))) return;
  const offset = replace ? 0 : Math.max(0, ...project.value.pages.map((page, index) => page.number ?? index + 1));
  const pages = project.value.creation.draftPages.map((item, index) => {
    const page = createComicPage(offset + index + 1, item.script, item.description);
    page.panels = item.panels.map((panel, panelIndex) => ({ ...panel, id: crypto.randomUUID(), label: `${page.number}-${panel.label.split('-').at(-1) || panelIndex + 1}` }));
    return page;
  });
  project.value.pages = replace ? pages : [...project.value.pages, ...pages];
  project.value.selectedPageId = pages[0]?.id ?? ""; project.value.activeStep = 2;
}
function importTable() {
  if (busy.value) return;
  try {
    const pages = parseTable(tableText.value, Math.max(0, ...project.value.pages.map((page, index) => page.number ?? index + 1)));
    if (!pages.length) return ElMessage.warning("没有识别到页面，请粘贴页码、脚本、画面描述三列表格");
    project.value.pages.push(...pages); project.value.selectedPageId = pages[0]!.id; tableDialog.value = false; tableText.value = "";
  } catch (error) { showError(error); }
}
async function describeCharacter(character: ComicCharacter) {
  const model = findNodeModel(textModels.value, character.descriptionModel || characterModelKey.value); if (!model || !character.reference || busy.value) return;
  busy.value = true; character.descriptionError = "";
  try {
    await save();
    const result = await ai.generate({ ...getNodeModelIdentity(model), directory, prompt: `请描述角色“${character.name}”的稳定外观特征。`,
      systemPrompt: "你是角色设定整理助手。根据参考图用不超过80个汉字描述脸部肤色、发型发色、体型、服装主色与配饰。不要猜测不可见细节，不写性格、剧情、动作或镜头。只输出描述。",
      references: [{ dataType: "IMAGE", value: { url: character.reference.path, mimeType: character.reference.mimeType } }],
    });
    character.description = result.text.trim(); character.descriptionModel = getNodeModelKey(model);
    await save();
  } catch (error) { const failure = textGenerationError(error, model); character.descriptionError = failure instanceof Error ? failure.message : "角色描述生成失败"; await save().catch(showError); showError(failure); } finally { busy.value = false; }
}
function preparePage(page: ComicPage, redraw = false) {
  const model = imageModel.value;
  if (!model) throw new Error("请选择图片模型");
  rememberNodeModel(model);
  if (!inspectPage(project.value, page).canGenerate) throw new Error("请先填写页面内容");
  const panel = redraw ? page.panels.find(item => item.id === redrawPanelId.value) : undefined;
  const baseImage = redraw ? selectedImage.value : undefined;
  if (redraw && (!panel || !baseImage || !redrawInstruction.value.trim())) throw new Error("请选择底图、分格并填写修改要求");
  const references = pageReferences(project.value, page);
  if (baseImage) references.push(baseImage);
  const prompt = pagePrompt(project.value, page, panel, redrawInstruction.value);
  const input: NodeImageRequest = { directory, ...getNodeModelIdentity(model), prompt, outputDirectory: "assets",
    size: project.value.settings.size, ratio: project.value.settings.ratio,
    other: JSON.parse(JSON.stringify(project.value.settings.other)), images: references.map(item => ({ path: item.path, mimeType: item.mimeType })) };
  const request: ComicRequestRecord = { ...getNodeModelIdentity(model), other: input.other ?? {},
    references: JSON.parse(JSON.stringify(references)), mode: redraw ? "redraw" : "page",
    ...(panel ? { panelLabel: panel.label, instruction: redrawInstruction.value } : {}) };
  return { input, request, count: project.value.settings.generationCount ?? 1 };
}
async function generatePage(page: ComicPage, redraw = false) {
  if (busy.value || cancelling.value || session.batch.running || page.task) return;
  try {
    const prepared = preparePage(page, redraw);
    if (prepared.count > 1 && !await ElMessageBox.confirm(`将执行 ${prepared.count} 次独立计费请求，每次结果分别保存。是否继续？`, "多次生成").then(() => true, () => false)) return;
    if (disposed || busy.value || session.batch.running || !project.value.pages.includes(page)) return;
    actionStatus.value = `正在生成 ${page.title}`;
    await session.start(page, prepared.input, prepared.request, prepared.count);
    if (!disposed) { actionStatus.value = "生成流程结束，结果与任务状态已保留"; generationView.value = "preview"; selectedVersionId.value = ""; }
  } catch (error) { if (!disposed) showError(error); }
}
async function generateAll() {
  if (busy.value || cancelling.value || session.batch.running || session.active.size) return;
  const pages = [...pendingPages.value];
  if (!pages.length) return;
  try {
    const sequential = project.value.settings.usePreviousPageReference;
    const snapshotProject = JSON.parse(JSON.stringify(project.value)) as typeof project.value;
    const prepared = pages.map(page => ({ page, ...preparePage(page) }));
    const requests = prepared.reduce((total, item) => total + item.count, 0);
    if (!await ElMessageBox.confirm(`共 ${pages.length} 页、${requests} 次独立计费请求。${sequential ? "参考上一页，按页顺序生成。" : "每隔10秒提交，最多同时生成3页。"}`, "批量生成").then(() => true, () => false)) return;
    if (disposed || busy.value || session.batch.running || session.active.size) return;
    await session.runBatch(prepared.map(item => ({ page: item.page, run: async () => {
      if (!project.value.pages.includes(item.page)) return;
      if (sequential) {
        const previous = project.value.pages[project.value.pages.indexOf(item.page) - 1];
        const image = previous?.versions[0]?.images[0];
        const references = item.request.references.filter(reference => reference.kind !== "previousPage");
        if (image) references.push({ ...image, kind: "previousPage", label: "上一页结果" });
        item.input.images = references.map(reference => ({ path: reference.path, mimeType: reference.mimeType }));
        item.request.references = references;
        const snapshotPage = snapshotProject.pages.find(page => page.id === item.page.id)!;
        const snapshotPrevious = snapshotProject.pages[snapshotProject.pages.indexOf(snapshotPage) - 1];
        if (snapshotPrevious && previous) snapshotPrevious.versions = JSON.parse(JSON.stringify(previous.versions));
        item.input.prompt = pagePrompt(snapshotProject, snapshotPage);
      }
      await session.start(item.page, item.input, item.request, item.count);
    } })), sequential);
    if (!disposed) actionStatus.value = session.message.value;
  } catch (error) { if (!disposed) showError(error); }
}
async function recoverPage(page: ComicPage) {
  if (busy.value || session.active.has(page.id)) return;
  if ((page.task?.remaining ?? 1) > 1 && !await ElMessageBox.confirm(`恢复当前任务后，还将继续剩余 ${page.task!.remaining! - 1} 次独立计费请求。是否继续？`, "恢复多次生成").then(() => true, () => false)) return;
  try { await session.recover(page); if (!disposed) actionStatus.value = "任务查询结束"; }
  catch (error) { if (!disposed) showError(error); }
}
async function cancelTask(page: ComicPage) {
  if (!page.task || cancelling.value) return;
  cancelling.value = true;
  try {
    if (page.task.cancelled && !session.active.has(page.id)) {
      if (!await ElMessageBox.confirm("解除此页任务关联后不能再从本页恢复，是否继续？", "结束任务").then(() => true, () => false)) return;
      await session.finish(page);
    } else await session.cancel(page);
  } catch (error) { showError(error); }
  finally { cancelling.value = false; }
}
function restoreVersion() {
  if (!selectedPage.value || !selectedVersion.value || busy.value || selectedPage.value.task) return;
  const version = selectedVersion.value;
  const image = selectedImage.value;
  if (image) version.images = [image, ...version.images.filter(item => item.id !== image.id)];
  selectedPage.value.versions = [version, ...selectedPage.value.versions.filter(item => item.id !== version.id)];
}
async function copyImageToCanvas(reference: ComicReference) {
  try {
    await writeClipboardImage(new Blob([await files.read(reference.path)], { type: reference.mimeType }));
    if (await openCanvas()) ElMessage.success("已复制，在画布粘贴即可添加图片节点");
  } catch (error) { showError(error); }
}
async function openCanvas(tool?: "nodes" | "upload" | "search" | "history") {
  return !await router.push({ path: "/workspace", query: { tool, comicFile: comicPath === comicFileName ? undefined : comicPath } });
}
function switchWorkspacePanel(value: string | number | boolean) {
  if (value === "canvas") return openCanvas();
  if (value === "document") return router.push({ path: "/workspace", query: { panel: "document", comicFile: comicPath === comicFileName ? undefined : comicPath } });
}
function openWorkspaceTool(tool: "nodes" | "upload" | "search" | "library" | "assets" | "history") {
  if (tool === "library") libraryVisible.value = !libraryVisible.value;
  else if (tool === "assets") assetsVisible.value = !assetsVisible.value;
  else if (tool === "upload") canvasUploadInput.value?.click();
  else void openCanvas(tool);
}
async function uploadToCanvas(event: Event) {
  const input = event.target as HTMLInputElement;
  const selectedFiles = Array.from(input.files ?? []);
  input.value = "";
  if (!selectedFiles.length) return;
  workspace.pendingCanvasUpload = { directory, files: selectedFiles };
  try { await openCanvas("upload"); }
  finally {
    if (router.currentRoute.value.path !== "/workspace") workspace.pendingCanvasUpload = null;
  }
}
async function removeVersion() {
  if (!selectedPage.value || !selectedVersion.value || busy.value || selectedPage.value.task) return;
  const page = selectedPage.value; const id = selectedVersion.value.id;
  if (!await ElMessageBox.confirm("移除此版本记录？图片文件仍保留在项目目录。", "移除版本记录").then(() => true, () => false)) return;
  if (busy.value || page.task) return;
  page.versions = page.versions.filter(item => item.id !== id); selectedVersionId.value = "";
}
async function removeVersionImage(reference: ComicReference) {
  const page = selectedPage.value; const version = selectedVersion.value;
  if (!page || !version || busy.value || page.task) return;
  if (!await ElMessageBox.confirm("仅移除此图片的版本记录，项目中的图片文件会保留。", "移除单张图片").then(() => true, () => false)) return;
  if (busy.value || page.task) return;
  version.images = version.images.filter(item => item.id !== reference.id);
  if (!version.images.length) page.versions = page.versions.filter(item => item.id !== version.id);
  selectedImageId.value = "";
}
async function downloadReference(reference: ComicReference) {
  try { await saveFile(async () => new Blob([await files.read(reference.path)], { type: reference.mimeType }), reference.path.split("/").at(-1)!); }
  catch (error) { showError(error); }
}
function preventUnload(event: BeforeUnloadEvent) {
  if (busy.value || cancelling.value || session.active.size > 0 || session.batch.running || saveStatus.value !== "已保存") { event.preventDefault(); event.returnValue = ""; }
}
async function saveBeforeNavigation() {
  if (busy.value || cancelling.value) { ElMessage.warning("当前操作尚未结束，请先停止任务或等待完成"); return false; }
  if (!loaded.value) return true;
  try { await save(); return true; } catch (error) { showError(error); return false; }
}
onBeforeRouteLeave(saveBeforeNavigation);
onBeforeRouteUpdate(saveBeforeNavigation);
onMounted(() => { window.addEventListener("beforeunload", preventUnload); void loadProject(); });
onBeforeUnmount(() => { disposed = true; clearTimeout(saveTimer); window.removeEventListener("beforeunload", preventUnload); });
</script>

<style scoped lang="scss">
.comicWorkspace {
  position: relative; display: flex; flex-direction: column; height: 100dvh; min-height: 0; color: var(--el-text-color-primary); background: var(--el-bg-color);
  .comicSideToolbar { position: fixed; max-height: calc(100dvh - 24px); background: var(--el-bg-color-overlay); }
  .comicAssetLibrary { position: fixed; top: 50%; left: 76px; z-index: 9; transform: translateY(-50%); width: min(360px, calc(100% - 88px)); }
  .workspaceBody, .loadError { margin-left: 76px; }
  .workspaceHeader {
    position: relative;
    flex: 0 0 58px;

    .comicProjectMenu { position: absolute; top: 15px; left: 15px; }
    .comicProjectIdentity {
      position: absolute; top: 15px; left: 90px; display: flex; align-items: center; box-sizing: border-box; max-width: calc(50% - 240px); padding: 0 4px 0 10px; border: 1px solid var(--el-border-color-light); border-radius: var(--ui-radius-large); background: var(--el-bg-color-overlay);
      .comicProjectName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
    }
    .panelSwitcher { position: absolute; top: 15px; left: 50%; transform: translateX(-50%); }
  }
  .comicWorkflowBar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 0 16px 8px;
    border-bottom: 1px solid var(--el-border-color);

    .generationToggle { flex-shrink: 0; color: var(--el-text-color-secondary); &[aria-pressed="true"] { color: var(--el-text-color-primary); background: var(--el-fill-color-light); } }
    .stepNavigation { display: flex; gap: 4px; flex-wrap: wrap; padding: 3px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-light);
      button { display: flex; align-items: center; gap: 6px; height: 32px; border: 1px solid transparent; padding: 0 10px; border-radius: 6px; background: transparent; color: var(--el-text-color-secondary); font-size: 12px; font-weight: 700; cursor: pointer;
        span { display: grid; place-items: center; width: 18px; height: 18px; border: 1px solid var(--el-border-color); border-radius: 50%; background: var(--el-bg-color); font-size: 10px; }
        &.active { color: var(--el-text-color-primary); background: color-mix(in srgb, var(--el-text-color-primary) 12%, var(--el-bg-color)); border-color: var(--el-border-color); box-shadow: none; span { color: var(--el-text-color-primary); background: var(--el-bg-color); border-color: var(--el-border-color); } }
        &:focus-visible { outline: 2px solid var(--el-color-primary); }
      }
    }
  }
  @media (max-width: 760px) {
    .workspaceHeader {
      flex-basis: 96px;
      .comicProjectIdentity { max-width: calc(100% - 105px); }
      .panelSwitcher { top: 56px; }
    }
  }
  @media (max-width: 380px) { .workspaceHeader { .panelSwitcher { left: auto; right: 15px; transform: none; } } }
  .loadError { padding: 32px; color: var(--el-color-danger); }
  .workspaceFooter { display: flex; flex-shrink: 0; align-items: center; gap: 8px; padding: 8px 20px; border-top: 1px solid var(--el-border-color-light);
    span { margin-right: auto; font-size: 12px; color: var(--el-text-color-secondary); }
    .el-button { margin: 0; }
  }
  .workspaceBody {
    display: grid; grid-template-columns: 218px minmax(0, 1fr) 270px; flex: 1; min-height: 0; background: var(--el-fill-color-light);
    &.settingsHidden { grid-template-columns: 218px minmax(0, 1fr); }
    &.creationStep { grid-template-columns: minmax(0, 1fr) 270px; &.settingsHidden { grid-template-columns: minmax(0, 1fr); } }
    &.previewStep:not(.settingsHidden) { grid-template-columns: 218px minmax(0, 1fr) 286px; }
    &.scriptStep { grid-template-columns: minmax(0, 1fr) 300px; }
    .pageRail { display: flex; flex-direction: column; gap: 0; border-right: 1px solid var(--el-border-color); background: var(--el-bg-color); min-height: 0;
      .railHeading { display: flex; align-items: center; justify-content: space-between; min-height: 48px; padding: 0 12px; border-bottom: 1px solid var(--el-border-color-lighter); font-size: 13px; }
      .batchSummary { display: grid; gap: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
      .pageList { flex: 1; overflow-y: auto;
        button { display: flex; gap: 8px; align-items: center; width: 100%; min-height: 54px; padding: 7px; margin-bottom: 5px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: inherit; text-align: left; cursor: pointer;
          .pageNumber { display: grid; place-items: center; flex: 0 0 30px; width: 30px; height: 36px; border: 1px solid var(--el-border-color); border-radius: 5px; background: var(--el-bg-color); font-size: 12px; font-weight: 800; }
          &.active { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); box-shadow: inset 3px 0 0 var(--el-color-primary); .pageNumber { color: var(--el-color-primary); border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-8); } }
          &:focus-visible { outline: 2px solid var(--el-color-primary); }
          > span:last-child { min-width: 0; }
          strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          small { display: block; margin-top: 6px; color: var(--el-text-color-secondary); }
        }
      }
      > .el-button { margin-left: 0; }
    }
    .stepContent { overflow-y: auto; padding: 14px; min-width: 0; scrollbar-gutter: stable; container: comicContent / inline-size;
      h2 { margin: 2px 0 14px; font-size: 18px; }
      .creationForm, .pageEditor { display: grid; gap: 16px; min-width: 0; }
      .creationContent { display: grid; gap: 24px; max-width: 1260px; margin: 4px auto 12px; }
      .creationLayout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); gap: 24px; align-items: start; }
      .storyFields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .creationForm {
        gap: 12px;
        h2 { margin: 2px 0 2px; font-size: 17px; }
        .creationParameters { display: grid; grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr)); gap: 12px;
          label { min-width: 0; } .el-select, .el-input-number { width: 100%; }
          .customPanelField { grid-column: -3 / -1; }
        }
        .creationActions { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 8px 12px;
          label { min-width: 0; }
          > span { grid-column: 1 / -1; color: var(--el-text-color-secondary); font-size: 12px; }
        }
      }
      .creationCharacters { min-width: 0; padding-inline-start: 20px; border-inline-start: 1px solid var(--el-border-color-light);
        .sectionHeading { margin-bottom: 12px; h3 { font-size: 15px; } }
        .characterGrid { grid-template-columns: minmax(0, 1fr); gap: 12px;
          .characterCard { gap: 12px; padding: 12px; background: var(--el-bg-color); }
        }
      }
      @container comicContent (max-width: 740px) {
        .creationLayout { grid-template-columns: minmax(0, 1fr); }
        .creationCharacters { padding: 12px 0 0; border-inline-start: 0; border-top: 1px solid var(--el-border-color-light); }
      }
      @container comicContent (max-width: 440px) {
        .storyFields { grid-template-columns: minmax(0, 1fr); }
        .creationForm .creationActions { grid-template-columns: minmax(0, 1fr); > .el-button { justify-self: end; } }
      }
      @container comicContent (max-width: 980px) {
        .creationForm .creationParameters { grid-template-columns: repeat(2, minmax(0, 1fr)); .narrativeField { grid-column: 1 / -1; } }
      }
      .scriptTable { display: grid; gap: 0; padding: 8px; border: 1px solid var(--el-border-color); border-radius: 7px; background: var(--el-bg-color);
        .scriptTableHeading, .scriptRow { display: grid; grid-template-columns: 132px minmax(180px, 1fr) minmax(220px, 1.2fr) 84px; gap: 16px; align-items: start; }
        .scriptRow { padding: 8px 0; border-bottom: 1px solid var(--el-border-color); }
        .scriptTableHeading { font-size: 13px; color: var(--el-text-color-secondary); }
        .pageIdentity { display: grid; gap: 10px; .el-input-number { width: 100%; } }
        .rowActions { display: grid; justify-items: start; gap: 6px; font-size: 12px; .el-button { margin: 0; padding: 4px; } }
      }
      .panelEditor, .pageEditor, .readinessCard { padding: 14px; border: 1px solid var(--el-border-color); border-radius: 7px; background: var(--el-bg-color); box-shadow: 0 3px 10px rgb(15 23 42 / 4%);
        .panelRow { display: grid; grid-template-columns: 90px minmax(0, 1fr) 90px; gap: 12px; margin-top: 12px; align-items: start; }
      }
      .pageEditor + .panelEditor { margin-top: 14px; }
      .versionMeta { font-size: 12px; color: var(--el-text-color-secondary); }
      .draftPages {
        padding-top: 16px; border-top: 1px solid var(--el-border-color-light);
        .sectionHeading { margin-bottom: 12px; span { color: var(--el-text-color-secondary); font-size: 12px; } .el-button { margin: 0; } }
        article { display: grid; gap: 10px; padding: 14px; border: 1px solid var(--el-border-color-light); border-radius: var(--ui-radius); background: var(--el-bg-color); }
        article + article { margin-top: 12px; }
      }
      .readinessCard { padding: 18px; margin: 16px 0; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius); p { white-space: pre-wrap; } }
      .characterGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px;
        .characterCard { display: grid; gap: 14px; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius); padding: 18px; .characterPreview { height: 200px; } }
      }
      .bindingPanel, .redrawPanel, .pageReferences { margin-top: 24px; }
      .previewToolbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: -14px -14px 14px; padding: 12px 14px; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color-light);
        h2 { margin: 0; overflow-wrap: anywhere; }
        .generationTabs { max-width: 100%; }
        .previewActions { display: flex; flex-wrap: wrap; gap: 6px; margin-inline-start: auto; .el-button { margin: 0; } }
      }
      .previewStatus { margin: 0 0 14px; color: var(--el-text-color-secondary); font-size: 13px; p { margin: 6px 0; } }
      .pageReferences { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--el-border-color-light);
        .sectionHeading { margin-bottom: 8px; .el-button { margin: 0; } }
        h3 { font-size: 15px; }
        .el-select { width: min(150px, 100%); }
      }
      .previewPrompt { padding-top: 14px; border-top: 1px solid var(--el-border-color-light);
        summary { cursor: pointer; }
        .el-textarea { margin-top: 10px; }
      }
      .redrawPanel { display: grid; gap: 16px;
        .redrawPreview { height: 300px; }
        .panelChoices { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;
          button { display: grid; gap: 10px; padding: 14px; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius); text-align: left; color: var(--el-text-color-primary); background: var(--el-bg-color); cursor: pointer;
            span { font-size: 12px; color: var(--el-text-color-secondary); white-space: pre-wrap; }
            &.active { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
            &:focus-visible { outline: 2px solid var(--el-color-primary); }
          }
        }
      }
      .resultLayout { display: grid; grid-template-columns: minmax(0, 1fr) 232px; align-items: start; gap: 14px;
        .resultImage { display: grid; place-items: center; min-width: 0; height: clamp(270px, 62dvh, 720px); padding: 10px; border: 1px solid var(--el-border-color-light); border-radius: var(--ui-radius-large); background: var(--el-bg-color); }
        .versionSection { grid-column: -2; display: grid; min-width: 0; gap: 12px; padding: 12px; border: 1px solid var(--el-border-color-light); border-radius: var(--ui-radius-large); background: var(--el-bg-color);
          h3 { margin: 0; font-size: 13px; }
          .versionMeta { margin: 0; overflow-wrap: anywhere; }
          .imageActions, .versionActions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; .el-button { margin: 0; padding-inline: 3px; font-size: 12px; } }
          .imageActions { padding-bottom: 10px; border-bottom: 1px solid var(--el-border-color-lighter); }
        }
      }
      @container comicContent (max-width: 560px) {
        .resultLayout { grid-template-columns: minmax(0, 1fr); }
      }
      .versionList { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; max-height: 214px; overflow-y: auto; margin: -2px; padding: 2px;
        button { display: grid; gap: 4px; min-width: 0; padding: 5px; border: 1px solid var(--el-border-color-light); border-radius: var(--ui-radius); background: var(--el-fill-color-light); color: var(--el-text-color-primary); font-size: 11px; cursor: pointer;
          .versionThumbnail { height: 66px; pointer-events: none; }
          &.active { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
          &:focus-visible { outline: 2px solid var(--el-color-primary); }
        }
      }
      details { margin-top: 20px; pre { white-space: pre-wrap; overflow-wrap: anywhere; } }
      .errorText { color: var(--el-color-danger); }
      .warningText { color: var(--el-color-warning); }
    }
    .generationSidebar { display: flex; flex-direction: column; gap: 14px; min-width: 0; overflow-y: auto; padding: 14px; border-left: 1px solid var(--el-border-color); background: var(--el-bg-color); h3 { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 14px; } :deep(.providerModelSelect) { width: 100%; }
      .generationOptions { display: grid; gap: 18px; }
      .settingsSection { border-top: 1px solid var(--el-border-color); padding-top: 16px;
        summary { cursor: pointer; font-size: 13px; font-weight: 600; }
        p { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.6; }
        .sectionHeading { margin-bottom: 8px; justify-content: space-between; font-size: 13px; }
        .affixFields { display: grid; gap: 16px; margin-top: 16px; }
      }
      .settingsPreview { height: 150px; border-radius: var(--ui-radius); overflow: hidden; background: var(--el-fill-color-light); }
    }
    .projectOverviewSidebar { padding: 16px; border-left: 1px solid var(--el-border-color); background: var(--el-bg-color); h3 { margin: 0 0 14px; font-size: 14px; }
      .overviewGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;
        div { display: grid; gap: 8px; min-height: 72px; padding: 12px; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius); background: var(--el-fill-color-light); }
        span { color: var(--el-text-color-secondary); font-size: 12px; } strong { font-size: 20px; }
      }
    }
    .readyBadge { color: var(--el-color-success); font-size: 11px; font-weight: 600; }
    .checkStats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px;
      div { display: grid; justify-items: center; gap: 5px; padding: 10px 4px; border-radius: 5px; background: var(--el-fill-color-light); }
      span { color: var(--el-text-color-secondary); font-size: 10px; } strong { font-size: 16px; }
    }
    .sidebarWarning { margin: 0; padding: 8px; border-radius: 4px; color: var(--el-color-warning-dark-2); background: var(--el-color-warning-light-9); font-size: 11px; line-height: 1.5; }
    label:not([class^="el-"]) { display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--el-text-color-regular); }
    .formRow, .sectionHeading { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
    .sectionHeading { margin-bottom: 16px; h2, h3 { margin: 0 auto 0 0; } }
    .referenceGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 12px;
      article { height: 160px; display: flex; flex-direction: column; min-height: 0; span { font-size: 12px; } }
    }
  }
  @media (max-width: 1150px) { .workspaceBody { grid-template-columns: 156px minmax(0, 1fr); &.settingsHidden { grid-template-columns: 156px minmax(0, 1fr); } &.creationStep { grid-template-columns: minmax(0, 1fr); } &.scriptStep { grid-template-columns: minmax(0, 1fr) 260px; } .generationSidebar { grid-column: 1 / -1; max-height: 300px; border-top: 1px solid var(--el-border-color); } &.creationStep, &.previewStep { .generationSidebar { max-height: min(300px, 32dvh); } } .stepContent .scriptTable { overflow-x: auto; .scriptRow, .scriptTableHeading { min-width: 650px; } } } }
  @media (max-width: 1150px) {
    .workspaceBody:not(.settingsHidden):not(.scriptStep) { grid-template-rows: minmax(0, 1fr) auto; }
    .workspaceBody.previewStep:not(.settingsHidden) { grid-template-columns: 156px minmax(0, 1fr); }
  }
  @media (max-width: 650px) {
    .comicWorkflowBar { .stepNavigation { min-width: 0; flex-wrap: nowrap; overflow-x: auto; button { flex-shrink: 0; } } }
    .workspaceFooter { padding: 10px 12px; gap: 8px; font-size: 12px; span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
    .workspaceBody { display: flex; flex-direction: column; overflow-y: auto;
      .pageRail { max-height: 230px; flex-shrink: 0; overflow-y: auto; border-right: 0; border-bottom: 1px solid var(--el-border-color);
        .pageList { flex: none; display: flex; gap: 8px; overflow-x: auto; button { width: 150px; flex-shrink: 0; } }
      }
      .stepContent { overflow: visible; padding: 20px 12px;
        .previewToolbar { position: static; margin: -20px -12px 14px; padding-inline: 12px; }
        .scriptTable { overflow: visible; .scriptTableHeading { display: none; } .scriptRow { min-width: 0; grid-template-columns: minmax(0, 1fr); padding-bottom: 16px; } }
        .panelEditor .panelRow { grid-template-columns: minmax(0, 1fr); }
      }
      .generationSidebar { overflow: visible; max-height: none; }
      &.creationStep, &.previewStep { .generationSidebar { max-height: none; } }
      .projectOverviewSidebar { border-left: 0; border-top: 1px solid var(--el-border-color); }
    }
  }
}
</style>
