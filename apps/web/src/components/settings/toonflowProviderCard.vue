<template>
  <el-card class="officialProvider" shadow="never">
    <div class="providerContent">
      <div class="providerMark" aria-hidden="true"><img :src="logoUrl" alt="" /></div>
      <div class="providerInfo">
        <div class="providerHeading"><strong>见白 AI</strong><el-tag size="small" type="success" effect="plain">官方</el-tag></div>
        <div class="providerMeta">
          <span>{{ connected ? "已连接" : "待连接" }}</span>
          <span>{{ models.length }} 个模型</span>
          <el-link :href="jianbaiDashboard" target="_blank" rel="noopener noreferrer">账户中心</el-link>
        </div>
      </div>
      <el-button plain @click="visible = true">{{ connected ? "查看与配置" : "配置密钥" }}</el-button>
    </div>
  </el-card>
  <el-dialog v-model="visible" title="见白 AI" width="min(600px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose>
    <div class="providerDialog">
      <jianbaiKeyForm />
      <el-alert v-if="provider?.loadError" :title="provider.loadError" type="error" :closable="false" />
      <el-table :data="models" maxHeight="300" emptyText="暂无模型">
        <el-table-column label="模型" prop="label" />
        <el-table-column label="模型 ID" prop="id" />
      </el-table>
      <slot />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import logoUrl from "@toonflow/assets/jianbaiLogo.svg";
import { jianbaiDashboard, jianbaiMediaKey, jianbaiTextConnected, jianbaiTextModel } from "@/lib/jianbaiAccount";
import jianbaiKeyForm from "./jianbaiKeyForm.vue";

const props = defineProps<{ scope: "text" | "media"; provider?: { models: { id: string; label: string }[]; loadError?: string } }>();
const visible = ref(false);
const connected = computed(() => jianbaiTextConnected.value || !!jianbaiMediaKey.value);
const models = computed(() => props.provider?.models ?? (props.scope === "text" ? [jianbaiTextModel] : []));
</script>

<style lang="scss" scoped>
.officialProvider {
  --el-card-padding: 20px;
  border-color: color-mix(in srgb, var(--el-color-primary) 45%, var(--el-border-color-light));
  background: color-mix(in srgb, var(--el-color-primary) 10%, var(--el-bg-color-overlay));

  .providerContent {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;

    .providerMark {
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border-radius: var(--ui-radius);
      background: var(--el-bg-color-overlay);

      img { width: 32px; height: 32px; object-fit: contain; }
      .dark & img { filter: invert(1); }
    }

    .providerInfo {
      flex: 1;
      min-width: 120px;

      .providerHeading, .providerMeta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .providerHeading { font-size: 18px; }
      .providerMeta { margin-top: 6px; color: var(--el-text-color-secondary); font-size: 12px; }
    }
  }
}

.providerDialog { display: grid; gap: 16px; }
</style>
