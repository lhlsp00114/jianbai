<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="stroke" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6" />
    <path d="m9 8 6 4-6 4Z" />
    <path v-if="spark" d="M19 22.5a4.75 4.75 0 0 1 3.5-3.5 4.75 4.75 0 0 1-3.5-3.5 4.75 4.75 0 0 1-3.5 3.5 4.75 4.75 0 0 1 3.5 3.5Z" />
    <path v-else d="M21 12v6a3 3 0 0 1-3 3h-6" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number | string; stroke?: number | string; spark?: boolean }>(), { size: 24, stroke: 2 });
</script>
