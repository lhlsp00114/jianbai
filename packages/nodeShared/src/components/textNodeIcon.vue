<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="stroke" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number | string; stroke?: number | string }>(), { size: 24, stroke: 2 });
</script>
