import { h } from "vue";
import { ElNotification } from "element-plus";
import nodeError from "./components/nodeError.vue";

const dismissedErrorsKey = "toonflow.dismissedRecoveryErrors";
function readDismissedErrors(): [string, string][] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(dismissedErrorsKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is [string, string] =>
      Array.isArray(item) && item.length === 2 && item.every(part => typeof part === "string")).slice(-100) : [];
  } catch { return []; }
}

export function showNodeError(error: unknown, title: string, dismissalKey?: string) {
  if (error instanceof Error && error.name === "AbortError") return;
  const detail = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  const message = typeof detail === "string" && detail.trim() ? detail
    : error instanceof Error ? error.message : typeof error === "string" ? error : title;
  const stage = (error as { mediaRecoveryStage?: string } | null)?.mediaRecoveryStage;
  if (stage) title = stage === "download" ? "结果下载中断" : stage === "result" ? "结果显示中断" : stage === "query" ? "结果查询中断" : "任务状态待确认";
  if (dismissalKey && readDismissedErrors().some(([key, value]) => key === dismissalKey && value === message)) return;
  const controller = new AbortController();
  ElNotification({
    title,
    type: "error",
    duration: 0,
    customClass: "nodeErrorNotification",
    message: h(nodeError, { message: message || title, context: title, signal: controller.signal }),
    onClose: () => {
      controller.abort();
      // ACT: 只记住自动恢复通知的关闭操作，最多保留 100 条；主动生成和复查始终提示错误。
      if (!dismissalKey) return;
      try {
        const entries = readDismissedErrors().filter(([key]) => key !== dismissalKey);
        localStorage.setItem(dismissedErrorsKey, JSON.stringify([...entries, [dismissalKey, message]].slice(-100)));
      } catch { /* 存储不可用时仍可关闭当前提示。 */ }
    },
  });
}
