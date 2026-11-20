<template>
  <el-card
    class="canvasToolbar nodrag nopan nowheel"
    shadow="never"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @dblclick.stop
    @contextmenu.stop
    @keydown.stop>
    <div class="toolbarActions">
      <slot />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ElCard } from "element-plus";
</script>

<style scoped lang="scss">
.canvasToolbar {
  position: absolute;
  width: max-content;
}
</style>
