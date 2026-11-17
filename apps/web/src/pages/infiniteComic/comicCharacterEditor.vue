<template>
  <section class="characterEditor">
    <nav class="characterList" aria-label="角色档案">
      <el-button :disabled="disabled" @click="$emit('add')">新增角色</el-button>
      <button v-for="item in characters" :key="item.id" type="button" :class="{ active: character?.id === item.id }" :aria-pressed="character?.id === item.id" @click="selectedId = item.id">
        <strong>{{ item.name }}</strong><small>{{ item.reference ? '有参考图' : '缺少参考图' }}</small>
      </button>
    </nav>
    <article v-if="character" class="characterDetail">
      <div class="detailHeading"><h3>{{ character.name }}</h3><el-button text type="danger" :disabled="disabled" @click="$emit('remove', character.id)">删除角色</el-button></div>
      <div v-if="character.reference" class="characterPreview"><comicImage :directory="directory" :reference="character.reference" /></div>
      <div class="referenceActions"><el-button :disabled="disabled" @click="$emit('upload', character.id)">上传参考图</el-button><el-button v-if="character.reference" text :disabled="disabled" @click="character.reference = null">移除参考图</el-button></div>
      <label>角色名称<el-input v-model="character.name" :disabled="disabled" /></label>
      <label>别名<el-input v-model="character.aliases" :disabled="disabled" /></label>
      <label>此角色的描述模型<comicTextModelSelect :modelValue="character.descriptionModel || defaultModel" :models="models" :disabled="disabled" @update:modelValue="(value: string) => character && (character.descriptionModel = value)" @refresh="$emit('refresh')" /></label>
      <label>外观与一致性设定<el-input v-model="character.description" type="textarea" :rows="6" :disabled="disabled" /></label>
      <el-alert v-if="character.descriptionError" :title="character.descriptionError" type="error" @close="character.descriptionError = ''" />
      <el-button :disabled="disabled || !character.reference || !findNodeModel(models, character.descriptionModel || defaultModel)" @click="$emit('describe', character)">根据参考图生成描述</el-button>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { findNodeModel, type NodeAiModel } from "@toonflow/nodes-scaffold/nodeAi";
import comicImage from "./comicImage.vue";
import comicTextModelSelect from "./comicTextModelSelect.vue";
import type { ComicCharacter } from "./comicProject";
const props = defineProps<{ characters: ComicCharacter[]; models: NodeAiModel[]; defaultModel: string; directory: string; disabled: boolean }>();
defineEmits<{ add: []; remove: [id: string]; upload: [id: string]; describe: [character: ComicCharacter]; refresh: [] }>();
const selectedId = ref("");
const character = computed(() => props.characters.find(item => item.id === selectedId.value) ?? props.characters[0]);
watch(() => props.characters.map(item => item.id), (ids, previous) => {
  const added = previous && ids.find(id => !previous.includes(id));
  if (added) selectedId.value = added;
  else if (!ids.includes(selectedId.value)) selectedId.value = ids[0] ?? "";
}, { immediate: true });
</script>

<style scoped lang="scss">
.characterEditor {
  display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 24px; margin-top: 20px;
  .characterList { display: flex; flex-direction: column; gap: 10px;
    > button:not(.el-button) { display: grid; gap: 8px; text-align: left; padding: 14px; background: var(--el-bg-color); color: var(--el-text-color-primary); border: 1px solid var(--el-border-color); border-radius: var(--ui-radius); cursor: pointer;
      small { color: var(--el-text-color-secondary); }
      &.active { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
      &:focus-visible { outline: 2px solid var(--el-color-primary); }
    }
  }
  .characterDetail { display: grid; gap: 16px; padding: 20px; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius);
    .detailHeading { display: flex; justify-content: space-between; align-items: center; h3 { margin: 0; } }
    .characterPreview { height: 240px; }
    label { display: grid; gap: 8px; font-size: 13px; }
  }
  @media (max-width: 800px) { grid-template-columns: 1fr; .characterList { flex-direction: row; overflow-x: auto; > button { flex-shrink: 0; } } }
}
</style>
