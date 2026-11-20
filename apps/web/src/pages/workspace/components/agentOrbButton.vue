<template>
  <button type="button" class="agentOrbButton" :class="{ compact }" aria-label="见白 Agent" />
</template>

<script setup lang="ts">
defineProps<{ compact?: boolean }>();
</script>

<style scoped lang="scss">
.agentOrbButton {
  --agentBlue: color-mix(in srgb, var(--el-color-primary) 38%, #4b56d7);
  position: relative;
  width: 68px;
  height: 68px;
  flex-shrink: 0;
  margin: 0;
  cursor: pointer;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  box-shadow: none;
  overflow: visible;
  isolation: isolate;
  transition: transform 220ms ease, filter 220ms ease;

  &.compact {
    width: 42px;
    height: 42px;
  }

  &[aria-pressed="true"] {
    background: var(--el-color-primary-light-9);
  }

  &::before,
  &::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  &::before {
    background:
      radial-gradient(ellipse 44% 43% at 50% 53%, var(--agentBlue) 25%, transparent 100%),
      radial-gradient(ellipse 38% 39% at 62% 57%, #9b72ef 18%, transparent 100%),
      radial-gradient(ellipse 50% 44% at 49% 52%, #6b8dfb38, transparent 100%);
    animation: agentColorDrift 6.8s ease-in-out infinite alternate;
  }

  &::after {
    background:
      radial-gradient(ellipse 19% 21% at 42% 36%, #dcfff1 5%, transparent 100%),
      radial-gradient(ellipse 33% 37% at 39% 44%, #32d4ca 16%, transparent 100%);
    animation: agentLightDrift 5.4s ease-in-out infinite alternate;
  }

  &:hover {
    transform: scale(1.06);
    filter: saturate(1.12);
  }

  &:active {
    transform: scale(0.95);
  }

  &:focus-visible {
    outline: 2px solid var(--el-color-primary);
    outline-offset: 3px;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
    transform: none;

    &::before,
    &::after {
      animation: none;
    }
  }
}

@keyframes agentColorDrift {
  from { transform: translate(-2px, 0) scale(0.98, 1.05); }
  to { transform: translate(3px, -2px) scale(1.06, 0.96); }
}

@keyframes agentLightDrift {
  from { transform: translate(-1px, -3px) scale(1.04); opacity: 0.94; }
  to { transform: translate(6px, 4px) scale(0.95, 1.04); opacity: 0.75; }
}
</style>
