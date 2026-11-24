import { createRouter, createWebHashHistory } from "vue-router";
import { useHelloStore } from "@/stores/hello";
import { useWorkspaceStore } from "@/stores/workspace";
import { publicWeb } from "@/stores/multiTenant";
import { adminRoute } from "@/pages/multiTenant/router";
import { jianbaiMediaKey } from "@/lib/jianbaiAccount";
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      redirect: () => publicWeb.value ? "/home" : "/hello",
    },
    {
      path: "/hello",
      component: () => import("@/pages/hello/index.vue"),
    },
    {
      path: "/home",
      component: () => import("@/pages/home/index.vue"),
    },
    {
      path: "/canvas",
      redirect: "/workspace",
    },
    {
      path: "/workspace",
      beforeEnter: () => publicWeb.value && !useWorkspaceStore().project ? { path: "/home", replace: true } : true,
      component: () => import("@/pages/workspace/index.vue"),
    },
    {
      path: "/comic",
      beforeEnter: () => !useWorkspaceStore().project ? { path: "/home", replace: true }
        : useWorkspaceStore().project?.projectKind !== "infiniteComic" ? { path: "/workspace", replace: true } : true,
      component: () => import("@/pages/infiniteComic/index.vue"),
    },
    adminRoute,
  ],
});

router.beforeEach(async to => {
  if (publicWeb.value) return to.path === "/hello" ? { path: "/home", replace: true } : true;
  if (to.path === "/hello") {
    return await useHelloStore().load() ? { path: "/home", replace: true } : true;
  }
  if (!jianbaiMediaKey.value && !await useHelloStore().load()) return { path: "/hello", replace: true };
  return true;
});

export default router;
