const compositionPrompts: Record<string, string> = {
  thirds: "采用三分法构图，将主要主体安排在画面三分线或交点附近，结合主体朝向保留适当留白，合理安排地平线。",
  symmetry: "采用中心对称构图，主要主体沿画面中轴线组织，左右视觉元素保持对称与平衡，突出中心主体。",
  diagonal: "采用对角线构图，让主要视觉元素或引导线沿画面对角线展开，形成明确的方向感与纵深。",
  cross: "采用十字形构图，以相交的横向和纵向视觉轴组织画面，将视觉重点安排在交汇区域。",
  corner: "采用L形构图，以一侧的竖向元素与底部横向元素形成L形结构，利用其余区域的留白突出主体。",
  curve: "采用S形构图，以自然连贯的S形曲线引导视线从前景进入中远景，将主体融入曲线的视觉节奏。",
  circle: "采用圆形构图，以环绕式的视觉元素构成完整或近似闭合的圆形结构，使视线向主要主体聚拢。",
  triangle: "采用金字塔构图，将主要视觉元素组织为上窄下宽的稳定三角结构，突出顶点与主体层次。",
  radial: "采用放射线构图，使多条主要引导线向同一视觉焦点汇聚，强化主体与画面纵深。",
  spiral: "采用黄金螺旋式构图，以由外向内逐渐收拢的视觉走势组织元素，将主要主体安排在螺旋收拢的视觉焦点附近。",
  frame: "采用框架式构图，利用与场景相符的前景元素形成框景，将主要主体置于框景内部，增强空间层次。",
  horizontal: "采用水平线构图，以平稳的横向线条和层次组织画面，保持地平线水平，营造安定舒展的视觉效果。",
};

export function getCompositionPrompt(preset: unknown): string {
  const prompt = typeof preset === "string" && Object.hasOwn(compositionPrompts, preset) ? compositionPrompts[preset] : undefined;
  return prompt ? `构图指导：${prompt}保留用户指定的主体与场景，不绘制辅助线、网格或构图标记。` : "";
}
