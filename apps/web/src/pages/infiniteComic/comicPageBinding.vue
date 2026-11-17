<template>
  <section class="pageBinding" aria-label="当前页角色绑定">
    <div class="bindingHeading"><strong>{{ page.title }} · 角色绑定</strong><span>{{ bound.length }} 个</span></div>
    <el-segmented :modelValue="page.automaticCharacters ? 'auto' : 'manual'" :options="[{ label: '自动识别', value: 'auto' }, { label: '手动选择', value: 'manual' }]" :disabled="disabled" aria-label="角色绑定方式" @change="changeMode" />
    <el-checkbox-group :modelValue="bound.map(character => character.id)" :disabled="disabled || page.automaticCharacters" @update:modelValue="updateCharacters">
      <el-checkbox v-for="character in project.characters" :key="character.id" :value="character.id"><span>{{ character.name }}</span><small v-if="!character.reference">无参考图</small></el-checkbox>
    </el-checkbox-group>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { pageCharacters, type ComicPage, type ComicProject } from "./comicProject";
const props = defineProps<{ project: ComicProject; page: ComicPage; disabled: boolean }>();
const bound = computed(() => pageCharacters(props.project, props.page));
function changeMode(value: string | number | boolean) {
  if (props.disabled) return;
  if (value === "manual") props.page.characterIds = bound.value.map(character => character.id);
  props.page.automaticCharacters = value === "auto";
}
function updateCharacters(value: (string | number | boolean)[]) {
  if (props.disabled || props.page.automaticCharacters) return;
  props.page.characterIds = value.filter((id): id is string => typeof id === "string" && props.project.characters.some(character => character.id === id));
}
</script>

<style scoped lang="scss">
.pageBinding {
  display: grid; gap: 14px; padding: 16px 0; border-top: 1px solid var(--el-border-color);
  .bindingHeading { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
  .el-checkbox-group { display: grid; gap: 6px;
    .el-checkbox { margin: 0; height: auto; min-height: 32px; white-space: normal; }
    small { margin-left: 8px; color: var(--el-color-warning); }
  }
}
</style>
