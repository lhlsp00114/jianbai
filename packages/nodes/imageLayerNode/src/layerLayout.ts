export type LayerLayout = { name?: string; box?: [number, number, number, number]; zIndex?: number; transparent?: boolean };
type LayerFile = { url: string; mimeType: string; imageLayer?: LayerLayout };

export function validLayerBox(box: unknown): box is [number, number, number, number] {
  return Array.isArray(box) && box.length === 4 && box.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)
    && box[2] > box[0] && box[3] > box[1];
}

export function layerBounds(layer: LayerFile, imageWidth: number, imageHeight: number, width: number, height: number) {
  const box = layer.imageLayer?.box;
  if (validLayerBox(box)) return { x: box[0] * width, y: box[1] * height, width: (box[2] - box[0]) * width, height: (box[3] - box[1]) * height };
  const scale = Math.min(width / imageWidth, height / imageHeight);
  return { x: (width - imageWidth * scale) / 2, y: (height - imageHeight * scale) / 2, width: imageWidth * scale, height: imageHeight * scale };
}

export async function arrangeLayers<T extends LayerFile>(layers: T[], reference: LayerFile, aspect: number, read: (path: string) => Promise<ArrayBuffer>, signal: AbortSignal) {
  // ACT: 最长边 128、最多 32 层的重叠像素比较，O(n² × 128²)。只估计前后关系；无法修复模型重绘或缺失内容。
  if (layers.length < 2 || layers.length > 32) return layers;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(128 * Math.min(1, aspect)));
  canvas.height = Math.max(1, Math.round(128 / Math.max(1, aspect)));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return layers;
  const sample = async (file: LayerFile) => {
    signal.throwIfAborted();
    const bytes = await read(file.url);
    signal.throwIfAborted();
    const bitmap = await createImageBitmap(new Blob([bytes], { type: file.mimeType }));
    try {
      signal.throwIfAborted();
      const bounds = layerBounds(file, bitmap.width, bitmap.height, canvas.width, canvas.height);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, bounds.x, bounds.y, bounds.width, bounds.height);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    } finally { bitmap.close(); }
  };
  try {
    const source = await sample(reference);
    const pixels = [];
    for (const layer of layers) pixels.push(await sample(layer));
    const votes = layers.map(() => layers.map(() => 0));
    for (let a = 0; a < layers.length; a++) {
      for (let b = a + 1; b < layers.length; b++) {
        const first = pixels[a]!;
        const second = pixels[b]!;
        let vote = 0;
        for (let p = 0; p < source.length; p += 4) {
          if (source[p + 3]! < 200 || first[p + 3]! < 200 || second[p + 3]! < 200) continue;
          let firstError = 0;
          let secondError = 0;
          for (let c = 0; c < 3; c++) {
            firstError += Math.abs(first[p + c]! - source[p + c]!);
            secondError += Math.abs(second[p + c]! - source[p + c]!);
          }
          if (Math.abs(secondError - firstError) > 18) vote += Math.sign(secondError - firstError);
        }
        votes[a]![b] = vote;
        votes[b]![a] = -vote;
      }
    }
    const remaining = layers.map((_, index) => index).filter(index => layers[index]!.imageLayer?.transparent !== false);
    const front: number[] = [];
    while (remaining.length) {
      // 相近或无重叠时保留原始叠放顺序，不强行猜测。
      let best = remaining[remaining.length - 1]!;
      let score = remaining.reduce((sum, other) => sum + votes[best]![other]!, 0);
      for (const index of remaining) {
        const candidate = remaining.reduce((sum, other) => sum + votes[index]![other]!, 0);
        if (candidate > score + 8) { best = index; score = candidate; }
      }
      front.push(best);
      remaining.splice(remaining.indexOf(best), 1);
    }
    return [...layers.filter(layer => layer.imageLayer?.transparent === false), ...front.reverse().map(index => layers[index]!)];
  } finally { canvas.width = canvas.height = 0; }
}
