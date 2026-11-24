<template>
  <div class="jianbaiAccount">
    <section class="profileCard" aria-label="见白 AI 账户">
      <div class="profileIcon"><img :src="logoUrl" alt="" /></div>
      <div class="profileInfo">
        <h3>见白 AI</h3>
        <p :class="{ connected }">{{ connected ? "API 密钥已连接" : "连接见白 AI，开始创作" }}</p>
      </div>
      <div class="profileActions">
        <el-button tag="a" :href="jianbaiDashboard" target="_blank" rel="noopener noreferrer" text type="primary" :icon="IconExternalLink">更多账号信息</el-button>
        <el-button text :icon="IconRefresh" :loading="loading || balanceLoading" :disabled="!jianbaiMediaKey || multiTenantEnabled" @click="refresh">刷新</el-button>
        <el-button v-if="!multiTenantEnabled" text :icon="IconKey" @click="accountTab = 'credentials'">管理密钥</el-button>
      </div>
    </section>
    <template v-if="!multiTenantEnabled">
      <el-segmented v-model="accountTab" class="tabSwitch" :options="accountOptions" ariaLabel="见白 AI 账号页面" />
      <div class="tabContent">
        <template v-if="accountTab === 'overview' || accountTab === 'wallet'">
          <el-alert v-if="balanceError" :title="balanceError" type="error" :closable="false" showIcon />
          <div class="summaryGrid">
            <section class="summaryCard" aria-label="当前余额">
              <div class="summaryLabel"><span>当前余额 · 积分</span><icon-wallet :size="20" /></div>
              <strong :title="balance ? String(balance.balance) : ''">{{ balance ? formatSummary.format(balance.balance) : "—" }}</strong>
              <el-button class="rechargeButton" tag="a" :href="jianbaiDashboard" target="_blank" rel="noopener noreferrer" type="primary" :icon="IconCreditCard">前往网站充值</el-button>
            </section>
            <section class="summaryCard" aria-label="已加载扣款">
              <div class="summaryLabel"><span>已加载扣款 · 积分</span><icon-chart-bar :size="20" /></div>
              <strong>{{ usageLoaded ? formatSummary.format(spent) : "—" }}</strong>
              <span v-if="usageLoaded" class="cardHint">已加载的 {{ entries.length }} 条流水中扣除的积分</span>
            </section>
            <section class="summaryCard" aria-label="已加载入账">
              <div class="summaryLabel"><span>已加载入账 · 积分</span><icon-arrow-down-left :size="20" /></div>
              <strong>{{ usageLoaded ? formatSummary.format(creditsIn) : "—" }}</strong>
              <span v-if="usageLoaded" class="cardHint">已加载的 {{ entries.length }} 条流水中增加的积分</span>
            </section>
          </div>
          <section v-if="accountTab === 'overview'" class="detailCard">
            <div class="sectionHeading"><h3>消费概览</h3><el-button text size="small" @click="accountTab = 'records'">查看全部记录</el-button></div>
            <p class="sectionHint">基于已载入的 {{ entries.length }} 条流水{{ nextCursor ? "，可在消费记录中继续加载" : "" }}</p>
            <el-alert v-if="usageError" :title="usageError" type="error" :closable="false" showIcon />
            <div v-for="item in modelUsage" :key="item.name" class="usageItem">
              <div class="usageLabel"><span>{{ item.name }}</span><strong>{{ formatNumber.format(item.amount) }} 积分</strong></div>
              <el-progress :percentage="spent ? item.amount / spent * 100 : 0" :showText="false" :strokeWidth="5" />
            </div>
            <p v-if="usageLoaded && !modelUsage.length" class="sectionHint">已载入流水中暂无消费</p>
            <el-button v-if="!jianbaiMediaKey" type="primary" @click="accountTab = 'credentials'">连接 API 密钥以查询余额与消费</el-button>
          </section>
          <section v-else class="detailCard">
            <h3>钱包与账单</h3>
            <p class="sectionHint">余额单位为见白 AI 积分。充值、订单和完整账户账单可在见白 AI 账户中心查看。</p>
            <el-button tag="a" :href="jianbaiDashboard" target="_blank" rel="noopener noreferrer" :icon="IconExternalLink">打开账户中心</el-button>
          </section>
        </template>
        <section v-else-if="accountTab === 'records'" class="detailCard">
          <div class="sectionHeading"><h3>消费记录</h3><span class="sectionHint">已载入 {{ entries.length }} 条</span></div>
          <el-alert v-if="usageError" :title="usageError" type="error" :closable="false" showIcon />
          <el-table v-loading="loading && !entries.length" :data="entries" emptyText="暂无消费记录">
            <el-table-column label="时间" minWidth="165"><template #default="{ row }">{{ formatDate(row.date) }}</template></el-table-column>
            <el-table-column label="类型" minWidth="80"><template #default="{ row }">{{ typeLabels[row.type] || row.type }}</template></el-table-column>
            <el-table-column prop="item" label="模型或功能" minWidth="170" />
            <el-table-column label="积分变动" minWidth="110" align="right"><template #default="{ row }"><span :class="{ incoming: row.credits > 0 }">{{ row.credits > 0 ? "+" : "" }}{{ formatNumber.format(row.credits) }}</span></template></el-table-column>
          </el-table>
          <el-button v-if="nextCursor" class="moreButton" :loading="loading" @click="loadUsage(nextCursor)">加载更多</el-button>
          <el-button v-if="!jianbaiMediaKey" @click="accountTab = 'credentials'">配置 API 密钥</el-button>
        </section>
        <section v-else-if="accountTab === 'credentials'" class="credentialsPanel">
          <div class="panelToolbar">
            <span class="routeHint">每条线路填写对应策略的密钥，启用后通用于文本、图片和视频。</span>
            <el-button tag="a" :href="jianbaiDashboard" target="_blank" rel="noopener noreferrer" :icon="IconExternalLink">网站管理凭证</el-button>
          </div>
          <div class="routeGrid">
            <article v-for="route in jianbaiRoutes" :key="route.id" class="routeCard" :class="{ active: jianbaiRouteConfig.activeRoute === route.id && jianbaiRouteConfig.routeKeys[route.id] }">
              <header>
                <div class="routeTitle"><component :is="routeIcons[route.id]" :size="22" /><h3>{{ route.label }}</h3></div>
                <el-tag v-if="jianbaiRouteConfig.activeRoute === route.id && jianbaiRouteConfig.routeKeys[route.id]" size="small" type="success">使用中</el-tag>
                <el-tag v-else size="small" type="info" effect="plain">{{ jianbaiRouteConfig.routeKeys[route.id] ? "已配置" : "未配置" }}</el-tag>
              </header>
              <p>{{ route.description }}</p>
              <div class="routeCredential">
                <code>{{ jianbaiRouteConfig.routeKeys[route.id] ? (visibleRoute === route.id ? jianbaiRouteConfig.routeKeys[route.id] : "••••••••••••") : "尚未填写 API 密钥" }}</code>
                <template v-if="jianbaiRouteConfig.routeKeys[route.id]">
                  <el-button link :icon="visibleRoute === route.id ? IconEyeOff : IconEye" :aria-label="'显示或隐藏' + route.label + '密钥'" @click="visibleRoute = visibleRoute === route.id ? undefined : route.id" />
                  <el-button link :icon="IconCopy" :aria-label="'复制' + route.label + '密钥'" @click="copyKey(route.id)" />
                </template>
              </div>
              <footer>
                <el-button :disabled="!!activatingRoute" @click="editingRoute = route.id; keyDialogVisible = true">{{ jianbaiRouteConfig.routeKeys[route.id] ? "更新密钥" : "填写密钥" }}</el-button>
                <el-button :class="{ enabledRoute: jianbaiRouteConfig.activeRoute === route.id && jianbaiRouteConfig.routeKeys[route.id] }" type="primary" :loading="activatingRoute === route.id" :disabled="!!activatingRoute || !jianbaiRouteConfig.routeKeys[route.id] || jianbaiRouteConfig.activeRoute === route.id" @click="activateRoute(route.id)">{{ jianbaiRouteConfig.activeRoute === route.id && jianbaiRouteConfig.routeKeys[route.id] ? "已启用" : "启用线路" }}</el-button>
              </footer>
            </article>
          </div>
        </section>
        <section v-else class="modelsPanel" aria-label="模型列表">
          <div class="panelToolbar">
            <el-segmented v-model="modelType" class="typeSwitch" :options="modelTypeOptions" ariaLabel="模型分类" />
            <el-input v-model="modelSearch" class="panelSearch" :prefixIcon="IconSearch" placeholder="搜索模型名称" aria-label="搜索模型名称" clearable />
          </div>
          <el-alert v-if="modelsError" :title="modelsError" type="error" :closable="false" showIcon />
          <div v-loading="modelsLoading" class="catalogGrid">
            <article v-for="model in filteredModels" :key="model.type + model.id" class="modelCard">
              <header class="modelHeader">
                <div class="modelIconBox"><modelIcon :model="model.label" :size="26" /></div>
                <div class="modelHeading"><h3>{{ model.label }}</h3><span>{{ typeLabels[model.type] }}</span></div>
              </header>
              <div class="modelTags">
                <el-tag v-for="tag in model.abilities" :key="tag" size="small" effect="light">{{ tag }}</el-tag>
                <el-tag v-for="tag in model.qualities" :key="tag" size="small" type="info" effect="plain">{{ tag }}</el-tag>
              </div>
              <footer class="modelFooter">
                <span>见白 AI</span>
                <el-button link type="primary" :aria-label="'查看 ' + model.label + ' 的详情'" @click="selectedModel = model; detailsVisible = true">查看详情<icon-chevron-right :size="14" /></el-button>
              </footer>
            </article>
          </div>
          <p v-if="!modelsLoading && !modelsError && !filteredModels.length" class="emptyResult">暂无匹配的模型</p>
        </section>
      </div>
    </template>
    <el-dialog v-model="keyDialogVisible" title="配置见白 AI 线路" width="min(520px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose>
      <jianbaiKeyForm :routeId="editingRoute" />
    </el-dialog>
    <el-dialog v-model="detailsVisible" :title="selectedModel?.label" width="min(620px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose>
      <div v-if="selectedModel" class="modelDetails">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="模型 ID">{{ selectedModel.id }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ typeLabels[selectedModel.type] }}</el-descriptions-item>
          <el-descriptions-item v-if="selectedModel.abilities.length" label="生成能力">{{ selectedModel.abilities.join("、") }}</el-descriptions-item>
          <el-descriptions-item v-if="selectedModel.qualities.length" label="尺寸 / 分辨率">{{ selectedModel.qualities.join("、") }}</el-descriptions-item>
          <el-descriptions-item v-if="selectedModel.imageRatios?.length" label="画面比例">{{ selectedModel.imageRatios.join("、") }}</el-descriptions-item>
          <el-descriptions-item v-for="(option, index) in selectedModel.durationResolutionMap" :key="index" :label="option.resolution.join(' / ')">{{ option.duration.join("、") }} 秒</el-descriptions-item>
        </el-descriptions>
        <el-button tag="a" :href="jianbaiDashboard" target="_blank" rel="noopener noreferrer" :icon="IconExternalLink">前往见白查看计费</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import http from "@/lib/http";
import { ElMessage } from "element-plus";
import { modelIcon } from "@toonflow/model-icons";
import { writeClipboardText } from "@/lib/clipboard";
import { multiTenantEnabled } from "@/stores/settings";
import { jianbaiRoutes, jianbaiRouteConfig, saveJianbaiRoute, type JianbaiRouteId, jianbaiDashboard, jianbaiMediaKey, jianbaiTextConnected, jianbaiTextProvider, type JianbaiBalance, type JianbaiUsage } from "@/lib/jianbaiAccount";
import jianbaiKeyForm from "../../jianbaiKeyForm.vue";
import logoUrl from "@toonflow/assets/jianbaiLogo.svg";
import { IconExternalLink, IconRefresh, IconWallet, IconChartBar, IconArrowDownLeft, IconKey, IconCreditCard, IconSearch, IconCopy, IconEye, IconEyeOff, IconChevronRight, IconSparkles, IconCurrencyDollar, IconShieldCheck, IconBolt, IconDiamond } from "@tabler/icons-vue";

const props = defineProps<{ visible?: boolean }>();
const accountTab = ref("overview");
const accountOptions = [
  { label: "总览", value: "overview" }, { label: "钱包", value: "wallet" },
  { label: "消费记录", value: "records" }, { label: "凭证", value: "credentials" }, { label: "模型列表", value: "models" },
];
type CatalogModel = { id: string; label: string; type: string; mode?: (string | string[])[]; imageSizes?: string[]; imageRatios?: string[]; audio?: boolean; durationResolutionMap?: { duration: number[]; resolution: string[] }[] };
const mediaModels = ref<CatalogModel[]>([]);
const modelsLoading = ref(false);
const modelType = ref("all");
const modelSearch = ref("");
const modelTypeOptions = [{ label: "全部", value: "all" }, { label: "文本", value: "text" }, { label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "音频", value: "audio" }];
const keyDialogVisible = ref(false);
const editingRoute = ref<JianbaiRouteId>("smart");
const visibleRoute = ref<JianbaiRouteId>();
const activatingRoute = ref<JianbaiRouteId>();
const routeIcons = { smart: IconSparkles, price: IconCurrencyDollar, stable: IconShieldCheck, speed: IconBolt, quality: IconDiamond };
watch([accountTab, () => props.visible, jianbaiMediaKey], () => { visibleRoute.value = undefined; });
async function copyKey(routeId: JianbaiRouteId) {
  try { await writeClipboardText(jianbaiRouteConfig.value.routeKeys[routeId]); ElMessage.success("凭证已复制"); }
  catch { ElMessage.error("复制失败，请重试"); }
}
async function activateRoute(routeId: JianbaiRouteId) {
  if (activatingRoute.value) return;
  activatingRoute.value = routeId;
  try {
    if (await saveJianbaiRoute(routeId, jianbaiRouteConfig.value.routeKeys[routeId], true)) ElMessage.success("线路已启用");
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "启用失败，请重试"); }
  finally { activatingRoute.value = undefined; }
}
const detailsVisible = ref(false);
const selectedModel = ref<(CatalogModel & { abilities: string[]; qualities: string[] })>();

const modelsError = ref("");
const usageLoaded = ref(false);
const balanceLoading = ref(false);
const connected = computed(() => !!jianbaiMediaKey.value || jianbaiTextConnected.value);
const spent = computed(() => entries.value.reduce((sum, item) => sum + Math.max(0, -item.credits), 0));
const creditsIn = computed(() => entries.value.reduce((sum, item) => sum + Math.max(0, item.credits), 0));
const modelUsage = computed(() => {
  const totals = new Map<string, number>();
  for (const entry of entries.value) {
    if (entry.credits >= 0) continue;
    const name = entry.item || entry.type;
    totals.set(name, (totals.get(name) ?? 0) - entry.credits);
  }
  return [...totals].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
});
const typeLabels: Record<string, string> = { usage: "消费", refund: "退款", recharge: "充值", bonus: "赠送", text: "文本", image: "图片", video: "视频", audio: "音频" };
const allModels = computed(() => ([
  ...(jianbaiTextProvider.value?.models ?? []).map(model => ({ ...model, type: "text" })),
  ...mediaModels.value,
] as CatalogModel[]).map(model => {
  const modes = model.mode ?? [];
  const labels: Record<string, string> = model.type === "video"
    ? { text: "文生视频", singleImage: "图生视频", startEndRequired: "首尾帧" }
    : { text: "文生图", singleImage: "图生图", multiReference: "多图参考" };
  const abilities = modes.flatMap(mode => typeof mode === "string" && labels[mode] ? [labels[mode]] : []);
  if (modes.some(Array.isArray)) abilities.push("多模态参考");
  if (model.audio) abilities.push("音频");
  return { ...model, abilities, qualities: [...new Set([...(model.imageSizes ?? []), ...(model.durationResolutionMap ?? []).flatMap(option => option.resolution)])] };
}));
const filteredModels = computed(() => allModels.value.filter(model =>
  (modelType.value === "all" || model.type === modelType.value)
  && (model.label + " " + model.id).toLowerCase().includes(modelSearch.value.trim().toLowerCase())));

const entries = ref<JianbaiUsage["entries"]>([]);
const balance = ref<JianbaiBalance>();
const balanceError = ref("");
const usageError = ref("");
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const formatNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
const formatSummary = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });
let controller: AbortController | undefined;

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : value;
}

async function loadUsage(cursor: string | null = null) {
  const signal = controller?.signal;
  if (!signal || signal.aborted || loading.value) return;
  loading.value = true;
  usageError.value = "";
  try {
    const result = await http<JianbaiUsage>({ method: "GET", url: "/api/ai/jianbaiUsage", params: cursor ? { cursor } : undefined, signal });
    if (signal.aborted) return;
    usageLoaded.value = true;
    entries.value = cursor ? [...entries.value, ...result.entries] : result.entries;
    nextCursor.value = result.nextCursor === cursor ? null : result.nextCursor;
  } catch (error) {
    if (!signal.aborted) usageError.value = error instanceof Error ? error.message : "读取消费记录失败";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

async function refresh() {
  controller?.abort();
  entries.value = [];
  usageLoaded.value = false;
  nextCursor.value = null;
  balance.value = undefined;
  balanceError.value = "";
  usageError.value = "";
  loading.value = false;
  balanceLoading.value = false;
  if (props.visible === false || multiTenantEnabled.value || !jianbaiMediaKey.value) return;
  controller = new AbortController();
  const { signal } = controller;
  balanceLoading.value = true;
  const usage = loadUsage();
  try {
    const result = await http<JianbaiBalance>({ method: "POST", url: "/api/ai/jianbaiAccount", data: {}, signal });
    if (!signal.aborted) balance.value = result;
  } catch (error) {
    if (!signal.aborted) balanceError.value = error instanceof Error ? error.message : "读取余额失败";
  }
  if (!signal.aborted) balanceLoading.value = false;
  await usage;
}

watch([() => props.visible, multiTenantEnabled, jianbaiMediaKey], refresh, { immediate: true });
let modelsController: AbortController | undefined;
watch([accountTab, () => props.visible, multiTenantEnabled], async () => {
  modelsController?.abort();
  modelsLoading.value = false;
  if (accountTab.value !== "models" || props.visible === false || multiTenantEnabled.value) return;
  modelsController = new AbortController();
  const { signal } = modelsController;
  modelsError.value = "";
  modelsLoading.value = true;
  try {
    const providers = await http<{ id: string; models: typeof mediaModels.value }[]>({ method: "GET", url: "/api/providers/media/list", signal });
    if (!signal.aborted) mediaModels.value = providers.find(provider => provider.id === "tokenGo")?.models ?? [];
  } catch (error) {
    if (!signal.aborted) modelsError.value = error instanceof Error ? error.message : "读取模型失败";
  } finally { if (!signal.aborted) modelsLoading.value = false; }
});
onBeforeUnmount(() => { controller?.abort(); modelsController?.abort(); });
</script>

<style lang="scss" scoped>
.jianbaiAccount {
  display: grid;
  gap: 16px;
  padding: 0 4px 24px;
  color: var(--el-text-color-primary);

  .profileCard {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
    padding: 18px;
    border: 1px solid var(--el-border-color-light);
    border-radius: var(--ui-radius-large);
    background: var(--el-fill-color-extra-light);

    .profileIcon {
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border-radius: var(--ui-radius);
      background: var(--el-fill-color-light);
      img { width: 32px; height: 32px; object-fit: contain; }
      .dark & img { filter: invert(1); }
    }
    .profileInfo {
      flex: 1;
      min-width: 140px;
      h3 { margin: 0; font-size: 15px; }
      p { margin: 6px 0 0; font-size: 12px; color: var(--el-text-color-secondary); &.connected { color: var(--el-color-success); } }
    }
    .profileActions { display: flex; flex-wrap: wrap; margin-left: auto; }
  }
  .tabSwitch, .typeSwitch {
    --el-segmented-item-selected-color: var(--ui-primary-foreground);
    justify-self: start;
    max-width: 100%;
  }
  .panelToolbar {
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;
    .panelSearch { width: 240px; max-width: 100%; }
    .toolbarActions { display: flex; gap: 8px; .el-button + .el-button { margin-left: 0; } }
  }
  .credentialsPanel {
    .routeHint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; flex: 1; min-width: 200px; }
    .routeGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;
      .routeCard { border: 1px solid var(--el-border-color-light); border-radius: var(--ui-radius-large); padding: 18px; background: var(--el-fill-color-extra-light); min-width: 0;
        &.active { border-color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 5%, var(--el-bg-color)); }
        header { display: flex; justify-content: space-between; gap: 10px; align-items: center;
          .routeTitle { display: flex; align-items: center; gap: 10px; h3 { margin: 0; font-size: 14px; } }
        }
        p { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; margin: 12px 0 18px; }
        .routeCredential { display: flex; align-items: center; gap: 8px; min-height: 32px; code { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--el-text-color-secondary); font-size: 12px; } .el-button + .el-button { margin-left: 0; } }
        footer { display: flex; justify-content: space-between; gap: 12px; padding-top: 16px; margin-top: 12px; border-top: 1px solid var(--el-border-color-lighter);
          .enabledRoute.is-disabled { color: var(--el-color-white); background: var(--el-color-success); border-color: var(--el-color-success); opacity: 1; }
        }
      }
    }
  }
  .modelsPanel {
    .catalogGrid {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; min-height: 100px;
      .modelCard {
        display: flex; flex-direction: column; gap: 18px; padding: 18px; min-width: 0;
        border: 1px solid var(--el-border-color-light); border-radius: var(--ui-radius-large); background: var(--el-fill-color-extra-light);
        &:hover { border-color: var(--el-border-color-dark); }
        .modelHeader { display: flex; gap: 12px; align-items: center;
          .modelIconBox { display: grid; place-items: center; width: 40px; height: 40px; flex-shrink: 0; border-radius: var(--ui-radius); background: var(--el-fill-color-light); }
          .modelHeading { min-width: 0; h3 { margin: 0 0 6px; font-size: 14px; overflow-wrap: anywhere; } span { color: var(--el-text-color-secondary); font-size: 12px; } }
        }
        .modelTags { display: flex; flex-wrap: wrap; gap: 6px; min-height: 24px; }
        .modelFooter { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: auto; padding-top: 14px; border-top: 1px solid var(--el-border-color-lighter); > span { font-size: 12px; color: var(--el-text-color-secondary); } }
      }
    }
    .emptyResult { color: var(--el-text-color-secondary); text-align: center; }
  }
  .tabContent {
    display: grid;
    gap: 16px;
    min-height: 390px;
    align-content: start;
    min-width: 0;

    .summaryGrid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      .summaryCard {
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 18px;
        border: 1px solid var(--el-border-color-light);
        border-radius: var(--ui-radius-large);
        background: var(--el-fill-color-extra-light);
        .summaryLabel { display: flex; justify-content: space-between; gap: 8px; color: var(--el-text-color-secondary); font-size: 13px; }
        > strong { font-size: clamp(24px, 2.5vw, 30px); font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
        .rechargeButton { width: 100%; margin-top: auto; }
        .cardHint { font-size: 12px; color: var(--el-text-color-secondary); margin-top: auto; line-height: 1.6; }
      }
    }
    .detailCard {
      padding: 18px;
      border: 1px solid var(--el-border-color-light);
      border-radius: var(--ui-radius-large);
      min-width: 0;
      h3 { font-size: 14px; margin: 0; }
      .sectionHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .sectionHint { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.7; }
      .usageItem {
        margin-top: 20px;
        .usageLabel { display: flex; justify-content: space-between; gap: 16px; font-size: 13px; margin-bottom: 9px; overflow-wrap: anywhere; }
      }
      .el-table { margin-top: 14px; font-variant-numeric: tabular-nums; }
      .incoming { color: var(--el-color-success); }
      .moreButton { display: flex; margin: 16px auto 0; }
    }
  }
  @media (max-width: 700px) {
    .credentialsPanel .routeGrid { grid-template-columns: 1fr; }
    .modelsPanel .catalogGrid { grid-template-columns: 1fr; }
    .tabContent .summaryGrid { grid-template-columns: 1fr; }
    .profileCard .profileActions { margin-left: 0; }
    .tabSwitch { overflow-x: auto; }
  }
}
.modelDetails { display: grid; gap: 20px; overflow-wrap: anywhere; > .el-button { justify-self: end; } }
</style>
