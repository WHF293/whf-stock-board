<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { getEtfProfile } from '../../../common/api/etf-profile.api.ts';
import type { EtfProfileRecord } from '../../../common/types/etf.types.ts';
import { formatDateTime } from '../../../common/utils/format-datetime';

/**
 * ETF 基金概况卡（详情页基金概况 Tab 内容）：
 *
 * 数据为天天基金 f10「基金概况」页披露口径（规模/费率/管理人/投资目标），
 * 本地缓存 + 手动刷新（概况变动频率极低，TTL 约一个季度）
 */
const props = defineProps<{
  /** ETF 符号（sh510300 / 510300） */
  symbol: string;
}>();

/** 概况记录（null = 尚未加载） */
const record = ref<EtfProfileRecord | null>(null);
/** 加载中 */
const isLoading = ref(false);
/** 加载失败文案（null = 无错误） */
const errorMessage = ref<string | null>(null);

/** 概况展示字段的键（排除 code/fetchedAt 两个非展示字段） */
type EtfProfileFieldKey = Exclude<keyof EtfProfileRecord, 'code' | 'fetchedAt'>;

/** 概况字段组（label + 记录键），魔法值集中便于增删调整 */
const PROFILE_SECTIONS: readonly {
  title: string;
  fields: readonly { label: string; key: EtfProfileFieldKey }[];
}[] = [
  {
    title: '基本信息',
    fields: [
      { label: '基金全称', key: 'fullName' },
      { label: '基金类型', key: 'fundType' },
      { label: '跟踪标的', key: 'trackingTarget' },
      { label: '业绩比较基准', key: 'benchmark' },
      { label: '成立日期/规模', key: 'setupInfo' },
      { label: '发行日期', key: 'issueDate' },
    ],
  },
  {
    title: '规模与分红',
    fields: [
      { label: '净资产规模', key: 'netAssetScale' },
      { label: '份额规模', key: 'shareScale' },
      { label: '成立来分红', key: 'dividend' },
    ],
  },
  {
    title: '管理人',
    fields: [
      { label: '基金管理人', key: 'manager' },
      { label: '基金托管人', key: 'custodian' },
      { label: '基金经理人', key: 'fundManager' },
    ],
  },
  {
    title: '费率',
    fields: [
      { label: '管理费率', key: 'mgmtFeeRate' },
      { label: '托管费率', key: 'custodyFeeRate' },
      { label: '销售服务费率', key: 'salesServiceFeeRate' },
      { label: '最高认购费率', key: 'maxSubscribeFeeRate' },
      { label: '最高申购费率', key: 'maxPurchaseFeeRate' },
      { label: '最高赎回费率', key: 'maxRedeemFeeRate' },
    ],
  },
] as const;

/**
 * 拉取概况（缓存优先，force 时强制回源）
 * @param force 是否跳过缓存强制刷新
 */
const load = async (force = false): Promise<void> => {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    record.value = await getEtfProfile(props.symbol, force);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    isLoading.value = false;
  }
};

// 切换 ETF 时全量重拉（缓存优先，秒出）
watch(
  () => props.symbol,
  () => {
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <BaseSkeleton v-if="isLoading && !record" />
    <div v-else-if="errorMessage" class="flex flex-col items-center gap-2 py-10">
      <BaseEmpty :text="`概况数据加载失败：${errorMessage}`" />
      <BaseButton variant="ghost" @click="load(true)">
        <MenuIcon name="refresh" :size="14" />
        重试
      </BaseButton>
    </div>
    <BaseEmpty v-else-if="!record" text="未取到该基金的概况披露数据" />
    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <!-- 工具条：数据时点（左）/ 手动刷新（右，概况低频变动，缓存优先） -->
      <div class="flex shrink-0 items-center justify-between gap-2 px-2 pb-1">
        <span v-if="record" class="truncate text-xs text-text-tertiary">
          数据更新于 {{ formatDateTime(record.fetchedAt) }}
        </span>
        <BaseButton variant="ghost" :disabled="isLoading" @click="load(true)">
          <MenuIcon name="refresh" :size="14" />
          {{ isLoading ? '刷新中…' : '刷新' }}
        </BaseButton>
      </div>

      <div class="flex flex-col gap-3 px-2 pb-3">
        <section
          v-for="section in PROFILE_SECTIONS"
          :key="section.title"
          class="rounded-lg border border-flat-weak bg-surface p-3"
        >
          <h3 class="pb-2 text-xs font-medium text-text-tertiary">{{ section.title }}</h3>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div
              v-for="field in section.fields"
              :key="field.key"
              class="flex min-w-0 items-baseline gap-2 text-sm"
              :class="field.key === 'fullName' ? 'col-span-2' : ''"
            >
              <dt class="w-24 shrink-0 text-xs text-text-tertiary">{{ field.label }}</dt>
              <dd class="min-w-0 flex-1 truncate font-medium text-text" :title="record[field.key] ?? ''">
                {{ record[field.key] ?? '--' }}
              </dd>
            </div>
          </dl>
        </section>

        <section v-if="record.objective" class="rounded-lg border border-flat-weak bg-surface p-3">
          <h3 class="pb-2 text-xs font-medium text-text-tertiary">投资目标</h3>
          <p class="text-sm leading-relaxed text-text-secondary">{{ record.objective }}</p>
        </section>
      </div>
    </div>
  </div>
</template>
