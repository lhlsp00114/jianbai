import { inject, type ShallowRef } from "vue";

export type CanvasTextHistory = {
  element: HTMLElement;
  change: (direction: "undo" | "redo") => Promise<void>;
};

export function useCanvasTextHistory() {
  const active = inject<ShallowRef<CanvasTextHistory | undefined> | undefined>("canvasTextHistory", undefined);
  return (history: CanvasTextHistory) => {
    const activate = () => { if (active) active.value = history; };
    history.element.addEventListener("focusin", activate);
    history.element.addEventListener("pointerdown", activate);
    return () => {
      history.element.removeEventListener("focusin", activate);
      history.element.removeEventListener("pointerdown", activate);
      if (active?.value === history) active.value = undefined;
    };
  };
}
