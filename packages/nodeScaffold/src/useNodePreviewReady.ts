import { inject, ref, watch, type Ref } from "vue";
import { useNode, useNodeId } from "@vue-flow/core";
import type { NodeDocumentContext } from "./nodeDocument";

const previewObserverKey = Symbol.for("toonflow.nodePreviewObserver");
type PreviewObserver = { observer: IntersectionObserver; targets: Map<Element, Set<Ref<boolean>>> };

export function useNodePreviewReady() {
  const nodeId = useNodeId();
  const documentContext = inject<NodeDocumentContext | undefined>("nodeDocument", undefined);
  const ready = ref(!nodeId || typeof IntersectionObserver === "undefined");
  if (ready.value) return ready;
  watch(() => documentContext?.targets.has(nodeId), visible => {
    if (visible) ready.value = true;
  }, { immediate: true, flush: "sync" });
  const { nodeEl } = useNode();
  const host = globalThis as typeof globalThis & { [previewObserverKey]?: PreviewObserver };
  if (!host[previewObserverKey]) {
    const targets: PreviewObserver["targets"] = new Map();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        targets.get(entry.target)?.forEach(value => { value.value = true; });
        targets.delete(entry.target);
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "240px" });
    host[previewObserverKey] = { observer, targets };
  }
  const { observer, targets } = host[previewObserverKey];
  // ACT: 首次靠近视口才挂载预览，之后保留尺寸、播放器及插件 UI 状态；不卸载节点运行时。
  watch(nodeEl, (element, _previous, onCleanup) => {
    if (!element || ready.value) return;
    // 可见节点在首次尺寸测量前挂载正文，避免先显示最小空壳再突然撑大。
    // 画布外仍沿用 IntersectionObserver，避免一次加载所有媒体。
    const bounds = element.getBoundingClientRect();
    const canvasBounds = element.closest(".vue-flow")?.getBoundingClientRect();
    if (canvasBounds && canvasBounds.width > 0 && canvasBounds.height > 0
      && bounds.width > 0 && bounds.height > 0
      && bounds.right >= Math.max(0, canvasBounds.left) - 240
      && bounds.left <= Math.min(window.innerWidth, canvasBounds.right) + 240
      && bounds.bottom >= Math.max(0, canvasBounds.top) - 240
      && bounds.top <= Math.min(window.innerHeight, canvasBounds.bottom) + 240) {
      ready.value = true;
      return;
    }
    const subscribers = targets.get(element) ?? new Set<Ref<boolean>>();
    subscribers.add(ready);
    targets.set(element, subscribers);
    observer.observe(element);
    onCleanup(() => {
      subscribers.delete(ready);
      if (targets.get(element) === subscribers && !subscribers.size) {
        targets.delete(element);
        observer.unobserve(element);
      }
    });
  }, { immediate: true, flush: "post" });
  return ready;
}
