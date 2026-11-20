<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="stroke" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 8V5a2 2 0 0 1 2-2h3m8 0h3a2 2 0 0 1 2 2v3m0 8v3a2 2 0 0 1-2 2h-3m-8 0H5a2 2 0 0 1-2-2v-3" />
    <path d="m12 6 5.5 3v6L12 18l-5.5-3V9L12 6Zm-5.5 3L12 12l5.5-3M12 12v6" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number | string; stroke?: number | string }>(), { size: 24, stroke: 1.6 });
</script>
