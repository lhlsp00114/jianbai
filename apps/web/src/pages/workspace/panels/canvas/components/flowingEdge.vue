<template>
  <g class="flowingEdge">
    <base-edge
      :id="id"
      class="edgeBasePath"
      :path="path[0]"
      :labelX="path[1]"
      :labelY="path[2]"
      :label="label"
      :labelStyle="labelStyle"
      :labelShowBg="labelShowBg"
      :labelBgStyle="labelBgStyle"
      :labelBgPadding="labelBgPadding"
      :labelBgBorderRadius="labelBgBorderRadius"
      :markerStart="markerStart"
      :markerEnd="markerEnd"
      :interactionWidth="interactionWidth"
      :style="style" />
    <g v-if="flowing" class="edgeFlow" aria-hidden="true">
      <path class="edgeFlowGlow" :d="path[0]" pathLength="100" />
      <path v-for="(opacity, index) in trailOpacities" :key="index" class="edgeFlowTrail" :d="path[0]" pathLength="100" :style="{ opacity, '--edgeFlowStart': `${18 - index * 2}px` }" />
      <path class="edgeFlowHead" :d="path[0]" pathLength="100" />
    </g>
  </g>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { BaseEdge, getBezierPath, type EdgeProps, type GraphNode } from "@vue-flow/core";

defineOptions({ inheritAttrs: false });
const props = defineProps<EdgeProps & { motionEnabled: boolean }>();
const trailOpacities = [0.025, 0.05, 0.09, 0.15, 0.24, 0.36, 0.5, 0.65];
function getNodeBoundary(node: GraphNode, x: number, y: number) {
  return {
    x: Math.max(node.computedPosition.x, Math.min(x, node.computedPosition.x + node.dimensions.width)),
    y: Math.max(node.computedPosition.y, Math.min(y, node.computedPosition.y + node.dimensions.height)),
  };
}

const path = computed(() => {
  const source = getNodeBoundary(props.sourceNode, props.sourceX, props.sourceY);
  const target = getNodeBoundary(props.targetNode, props.targetX, props.targetY);
  // 按接口朝向向外弯出，目标位于后方时也保留两端可见的弧线。
  return getBezierPath({
    ...props,
    sourceX: source.x,
    sourceY: source.y,
    targetX: target.x,
    targetY: target.y,
  });
});
const flowing = computed(() => props.motionEnabled && (props.sourceNode.selected || props.sourceNode.dragging || props.targetNode.selected || props.targetNode.dragging));
</script>

<style scoped lang="scss">
.flowingEdge {
  :deep(.edgeBasePath) {
    stroke-dasharray: none;
    animation: none;
  }

  .edgeFlow {
    color: #b1b1b7;
    pointer-events: none;

    path {
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-dasharray: 4 96;
      animation: edgeFlowPulse 2.8s linear infinite;
    }

    .edgeFlowGlow { --edgeFlowStart: 20px; stroke-dasharray: 20 80; stroke-width: 6px; opacity: 0.22; filter: blur(3px); }
    .edgeFlowTrail { stroke-width: 2.4px; filter: blur(0.65px); }
    .edgeFlowHead {
      stroke: color-mix(in srgb, currentColor 35%, var(--el-text-color-primary));
      stroke-width: 1.8px;
      stroke-dasharray: 3 97;
      filter: blur(0.55px);
    }
  }
}

@keyframes edgeFlowPulse {
  from { stroke-dashoffset: var(--edgeFlowStart, 3px); }
  to { stroke-dashoffset: calc(var(--edgeFlowStart, 3px) - 100px); }
}

@media (prefers-reduced-motion: reduce) {
  .flowingEdge .edgeFlow { display: none; }
}
</style>
