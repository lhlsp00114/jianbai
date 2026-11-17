import type { NodeTypesObject } from "@vue-flow/core";
import { shallowReactive, type Component } from "vue";

type NodeComponent = Exclude<NodeTypesObject[string], string>;

const components = shallowReactive(new Map<string, NodeComponent>());
const requests = new Map<string, Promise<NodeComponent>>();

export function getNodeIcon(type?: string): Component | undefined {
  if (!type?.startsWith("remote-")) return;
  return (components.get(type.slice(7)) as { icon?: Component } | undefined)?.icon;
}

export function loadNodeComponent(name: string, url: string, force = false): Promise<NodeComponent> {
  const pending = requests.get(name);
  if (pending) return pending;
  const nodeWindow = window as typeof window & { toonflowNodes?: NodeTypesObject };
  const cached = components.get(name) ?? (Object.hasOwn(nodeWindow.toonflowNodes ?? {}, name) ? nodeWindow.toonflowNodes?.[name] : undefined);
  if (!force && cached && (typeof cached === "object" || typeof cached === "function")) {
    components.set(name, cached);
    return Promise.resolve(cached);
  }
  components.delete(name);
  // ACT: 同名节点只加载一份脚本，所有画布共享进行中的重载，避免互相清除全局导出。
  const request = (async () => {
    const scriptUrl = force ? `${url}${url.includes("?") ? "&" : "?"}reload=${crypto.randomUUID()}` : url;
    const response = await fetch(scriptUrl);
    if (!response.ok) throw new Error(`节点脚本加载失败（HTTP ${response.status}）`);
    const code = await response.text();
    if (code.includes("toonflowTiptapHost")) await import("@/lib/tiptapHost");
    // 节点为单文件 UMD，直接执行已下载的内容，避免再次请求相同脚本。
    const objectUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const script = document.createElement("script");
    try {
      return await new Promise<NodeComponent>((resolve, reject) => {
        delete nodeWindow.toonflowNodes?.[name];
        script.src = objectUrl;
        script.onload = () => {
          const component = nodeWindow.toonflowNodes?.[name];
          if (!Object.hasOwn(nodeWindow.toonflowNodes ?? {}, name) || !component || (typeof component !== "object" && typeof component !== "function")) {
            reject(new Error(`节点脚本未导出 ${name} 组件`));
            return;
          }
          resolve(component);
        };
        script.onerror = () => {
          delete nodeWindow.toonflowNodes?.[name];
          reject(new Error("节点脚本加载失败"));
        };
        document.head.append(script);
      });
    } finally {
      script.remove();
      URL.revokeObjectURL(objectUrl);
    }
  })().then(component => {
    components.set(name, component);
    return component;
  }).finally(() => requests.delete(name));
  requests.set(name, request);
  return request;
}
