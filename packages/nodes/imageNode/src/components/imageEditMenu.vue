<template>
  <div ref="menuAnchor" class="imageEditMenu nodrag nopan" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop>
    <el-dropdown ref="dropdown" trigger="click" placement="bottom-start" :appendTo="menuTarget" :disabled="disabled || loading" :showArrow="false" @visible-change="visible = $event" @command="selectAction">
      <el-button :icon="IconPencil" :loading="loading" :disabled="disabled || loading" text title="编辑" aria-label="编辑">
        编辑<icon-chevron-down :size="14" />
      </el-button>
      <template #dropdown>
        <el-dropdown-menu class="editMenu" @pointerdown.stop @mousedown.stop @click.stop>
          <el-dropdown-item command="rotate" :icon="IconRotateClockwise" :disabled="disabled || loading">旋转与镜像</el-dropdown-item>
          <el-dropdown-item command="crop" :icon="IconCrop" :disabled="disabled || loading">裁剪</el-dropdown-item>
          <el-dropdown-item command="color" :icon="IconPalette" :disabled="disabled || loading">调色</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus";
import { IconChevronDown, IconPencil, IconRotateClockwise, IconCrop, IconPalette } from "@tabler/icons-vue";

const props = defineProps<{ disabled?: boolean; loading?: boolean }>();
const emit = defineEmits<{ rotate: []; crop: []; color: [] }>();
const { node } = useNode();
const { viewport } = useVueFlow();
const menuAnchor = ref<HTMLElement>();
const dropdown = ref<InstanceType<typeof ElDropdown>>();
const visible = ref(false);
const menuTarget = computed(() => menuAnchor.value?.closest<HTMLElement>(".vue-flow__node")
  ?? menuAnchor.value?.closest<HTMLElement>(".nodeSkeleton") ?? undefined);

watch(() => visible.value ? [viewport.value.x, viewport.value.y, viewport.value.zoom,
  node.computedPosition.x, node.computedPosition.y, node.dimensions.width, node.dimensions.height] : [], () => {
  dropdown.value?.popperRef?.updatePopper();
}, { flush: "post" });

function selectAction(command: string) {
  if (command === "rotate" && !props.disabled && !props.loading) emit("rotate");
  if (command === "crop" && !props.disabled && !props.loading) emit("crop");
  if (command === "color" && !props.disabled && !props.loading) emit("color");
}
</script>

<style scoped lang="scss">
.imageEditMenu {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}
.editMenu {
  min-width: 156px;

  :deep(.el-dropdown-menu__item) { min-height: 36px; }
}
</style>
