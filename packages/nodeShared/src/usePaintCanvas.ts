import { computed, nextTick, ref, toRaw, type Ref } from "vue";

export type PaintPoint = { x: number; y: number };
export type PaintTool = "brush" | "eraser" | "rectangle" | "circle" | "text" | "marker" | "arrow";
export type PaintStroke = { tool: PaintTool | "clear"; color: string; size: number; points: PaintPoint[]; text?: string };

export function drawPaintSegment(stroke: PaintStroke, point: PaintPoint, previous = point, context: CanvasRenderingContext2D) {
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.fillStyle = context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = context.lineJoin = "round";
  context.beginPath();
  if (point === previous) {
    context.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }
}

export function usePaintCanvas(
  paintCanvas: Ref<HTMLCanvasElement | undefined>,
  busy: Ref<boolean>,
  { canDraw, canCommitText = canDraw, defaultColor = "#ff4545", defaultBrushSize = 16 }: {
    canDraw: () => boolean;
    canCommitText?: () => boolean;
    defaultColor?: string;
    defaultBrushSize?: number;
  },
) {
  const tool = ref<PaintTool>("brush");
  const color = ref(defaultColor);
  const brushSize = ref(defaultBrushSize);
  const fontSize = ref(24);
  const minToolSize = computed(() => tool.value === "text" ? 12 : 2);
  const toolSize = computed({
    get: () => tool.value === "text" ? fontSize.value : brushSize.value,
    set: value => { if (tool.value === "text") fontSize.value = value; else brushSize.value = value; },
  });
  const sizeProgress = computed(() => `${(toolSize.value - minToolSize.value) / (60 - minToolSize.value) * 100}%`);
  const strokeCount = ref(0);
  const historyLength = ref(0);
  const hasDrawing = ref(false);
  const textInput = ref<HTMLTextAreaElement>();
  const textDraft = ref<(PaintStroke & { text: string })>();
  const textStyle = computed(() => {
    const canvas = paintCanvas.value;
    const draft = textDraft.value;
    if (!canvas || !draft) return {};
    const scale = canvas.clientWidth / canvas.width;
    const point = draft.points[0]!;
    return { left: `${canvas.offsetLeft + point.x * scale}px`, top: `${canvas.offsetTop + point.y * scale}px`, width: `${Math.max(40, canvas.clientWidth - point.x * scale)}px`, fontSize: `${draft.size * scale}px`, color: draft.color };
  });
  let strokes: PaintStroke[] = [];
  let draftStroke: PaintStroke | undefined;
  let pointerId: number | undefined;

  function getPoint(event: PointerEvent): PaintPoint {
    const canvas = paintCanvas.value!;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) / bounds.width * canvas.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) / bounds.height * canvas.height)),
    };
  }

  async function startStroke(event: PointerEvent) {
    const canvas = paintCanvas.value;
    if (!canDraw() || busy.value || event.button !== 0 || pointerId !== undefined || !canvas) return;
    commitText();
    const stroke: PaintStroke = { tool: tool.value, color: color.value, size: toolSize.value * canvas.width / canvas.clientWidth, points: [getPoint(event)] };
    if (tool.value === "marker") {
      stroke.text = String(strokes.slice(0, strokeCount.value).filter(item => item.tool === "marker").length + 1);
      commitStroke(stroke);
      return;
    }
    if (tool.value === "text") {
      textDraft.value = { ...stroke, text: "" };
      await nextTick();
      textInput.value?.focus();
      return;
    }
    pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    draftStroke = stroke;
    const context = canvas.getContext("2d");
    if (context && (stroke.tool === "brush" || stroke.tool === "eraser")) drawPaintSegment(stroke, stroke.points[0]!, undefined, context);
  }

  function moveStroke(event: PointerEvent) {
    if (event.pointerId !== pointerId || busy.value) return;
    const stroke = draftStroke!;
    const point = getPoint(event);
    if (stroke.tool === "brush" || stroke.tool === "eraser") {
      const context = paintCanvas.value?.getContext("2d");
      if (context) drawPaintSegment(stroke, point, stroke.points.at(-1), context);
      stroke.points.push(point);
    } else {
      stroke.points[1] = point;
      redraw();
      drawStroke(stroke);
    }
  }

  function finishStroke(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    moveStroke(event);
    const stroke = draftStroke!;
    draftStroke = undefined;
    pointerId = undefined;
    if (paintCanvas.value?.hasPointerCapture(event.pointerId)) paintCanvas.value.releasePointerCapture(event.pointerId);
    if ((stroke.tool === "rectangle" || stroke.tool === "circle") && (!stroke.points[1] || stroke.points[0]!.x === stroke.points[1].x || stroke.points[0]!.y === stroke.points[1].y)) return void redraw();
    commitStroke(stroke);
  }

  function cancelStroke() {
    const captured = pointerId;
    pointerId = undefined;
    draftStroke = undefined;
    if (captured !== undefined && paintCanvas.value?.hasPointerCapture(captured)) paintCanvas.value.releasePointerCapture(captured);
    redraw();
  }

  function drawStroke(stroke: PaintStroke) {
    const canvas = paintCanvas.value;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    if (stroke.tool === "clear") return context.clearRect(0, 0, canvas.width, canvas.height);
    if (stroke.tool === "brush" || stroke.tool === "eraser") return stroke.points.forEach((point, index) => drawPaintSegment(stroke, point, stroke.points[index - 1], context));
    const start = stroke.points[0]!;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = context.strokeStyle = stroke.color;
    context.lineWidth = stroke.size;
    context.lineJoin = "miter";
    context.lineCap = "butt";
    if (stroke.tool === "text") {
      context.textAlign = "start";
      context.font = `${stroke.size}px sans-serif`;
      context.textBaseline = "top";
      stroke.text!.split("\n").forEach((line, index) => context.fillText(line, start.x, start.y + index * stroke.size * 1.25));
      return;
    }
    if (stroke.tool === "marker") {
      context.beginPath();
      context.arc(start.x, start.y, stroke.size * 1.15, 0, Math.PI * 2);
      context.fillStyle = stroke.color;
      context.fill();
      context.fillStyle = "#fff";
      context.font = `bold ${stroke.size}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(stroke.text ?? "1", start.x, start.y);
      return;
    }
    const end = stroke.points[1];
    if (!end) return;
    if (stroke.tool === "arrow") {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const head = stroke.size * 2.4;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
      context.moveTo(end.x, end.y);
      context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
      context.stroke();
      return;
    }
    context.beginPath();
    if (stroke.tool === "rectangle") context.rect(start.x, start.y, end.x - start.x, end.y - start.y);
    else {
      const radius = Math.min(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / 2;
      context.arc(start.x + Math.sign(end.x - start.x) * radius, start.y + Math.sign(end.y - start.y) * radius, radius, 0, Math.PI * 2);
    }
    context.stroke();
  }

  function redraw() {
    const canvas = paintCanvas.value;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawing.value = false;
    // ACT: 形状预览和历史切换重放矢量操作；超长标记需要分段快照，普通画笔移动仍只增量绘制。
    for (const stroke of strokes.slice(0, strokeCount.value)) {
      drawStroke(stroke);
      if (stroke.tool === "clear") hasDrawing.value = false;
      else if (stroke.tool !== "eraser") hasDrawing.value = true;
    }
  }

  function commitStroke(stroke: PaintStroke) {
    strokes.splice(strokeCount.value, strokes.length - strokeCount.value, stroke);
    strokeCount.value = historyLength.value = strokes.length;
    redraw();
  }

  function clear() {
    if (!busy.value) commitStroke({ tool: "clear", color: "", size: 0, points: [] });
  }

  function undo() {
    if (busy.value || !strokeCount.value) return;
    strokeCount.value--;
    redraw();
  }

  function redo() {
    if (busy.value || strokeCount.value === historyLength.value) return;
    strokeCount.value++;
    redraw();
  }

  function commitText() {
    const draft = textDraft.value;
    textDraft.value = undefined;
    if (draft?.text.trim() && !busy.value && canCommitText()) commitStroke(toRaw(draft));
  }

  function handleTextKey(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      textDraft.value = undefined;
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitText();
    }
  }

  function getStrokes() {
    return strokes.slice(0, strokeCount.value);
  }

  function reset(initial: PaintStroke[] = []) {
    strokes = initial;
    strokeCount.value = historyLength.value = strokes.length;
    textDraft.value = undefined;
    cancelStroke();
  }

  function resize(previous: { width: number; height: number }) {
    const canvas = paintCanvas.value;
    if (!canvas) return;
    cancelStroke();
    const scale = Math.min(canvas.width / previous.width, canvas.height / previous.height);
    const left = (canvas.width - previous.width * scale) / 2;
    const top = (canvas.height - previous.height * scale) / 2;
    strokes = strokes.map(stroke => ({
      ...stroke,
      size: stroke.size * scale,
      points: stroke.points.map(point => ({ x: point.x * scale + left, y: point.y * scale + top })),
    }));
    redraw();
  }

  return {
    tool, color, minToolSize, toolSize, sizeProgress, strokeCount, historyLength, hasDrawing,
    textInput, textDraft, textStyle, startStroke, moveStroke, finishStroke, cancelStroke,
    clear, undo, redo, commitText, handleTextKey, getStrokes, reset, resize,
  };
}
