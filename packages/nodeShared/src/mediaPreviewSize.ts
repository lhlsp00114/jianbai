export const emptyMediaCardWidth = 352;

export function getMediaPreviewSize(width: number, height: number) {
  const ratio = width / height;
  // ACT: 竖图按方图的显示面积逐步放大，最高 320，避免超长图占满画布。
  const previewHeight = ratio >= 1 ? 240 : Math.min(320, 240 / Math.sqrt(ratio));
  return { width: previewHeight * ratio, height: previewHeight };
}
