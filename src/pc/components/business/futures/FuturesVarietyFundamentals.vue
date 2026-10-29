<script setup lang="ts">
import { onMounted, ref } from 'vue';
import BaseButton from '../../ui/BaseButton.vue';
import BaseCard from '../../ui/BaseCard.vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import { fetchFuturesVarietyContracts } from '../../../../common/api/futures-overview.api.ts';
import { FUTURES_CHAIN_CATEGORIES } from '../../../../common/constants/futures.constants.ts';

/** 单个品种 chip 的渲染数据 */
interface VarietyChip {
  /** 品种代码（大写，如 AU） */
  variety: string;
  /** 品种名（映射接口提供，缺省退回品种代码） */
  name: string;
  /** 主力合约代码（空 = 上游未返回该品种，chip 不可点） */
  contractCode: string;
  /** 是否热点（红点角标：主力合约出现在同花顺推荐合约清单中） */
  hot: boolean;
}

/** 单个分类分组的渲染数据 */
interface VarietyGroup {
  /** 分类键 */
  key: string;
  /** 分类名 */
  name: string;
  /** 分类强调色 */
  color: string;
  /** 品种 chip 清单 */
  items: VarietyChip[];
}

/**
 * 品种基本面功能区（期货总览页）
 *
 * 与同花顺期货通 goodsfu 首页「品种基本面」面板同款：四大分类 × 品种 chips，
 * 品种 → 主力合约映射与红点角标来自 futgwapi 接口（本地拉取渲染，非 iframe 列表）。
 * 点击品种 emit select(contractCode, varietyName)，由父级展开右侧产业链面板。
 */
const emit = defineEmits<{
  /** 选中某品种（仅主力合约存在时触发） */
  select: [contractCode: string, varietyName: string];
}>();

const loading = ref(false);
const failed = ref(false);

/** 分组数据（初始以品种代码兜底渲染，映射就绪后填充中文名与可点态） */
const groups = ref<VarietyGroup[]>(
  FUTURES_CHAIN_CATEGORIES.map((category) => ({
    key: category.key,
    name: category.name,
    color: category.color,
    items: category.varieties.map((variety) => ({
      variety,
      name: variety,
      contractCode: '',
      hot: false,
    })),
  })),
);

/**
 * 拉取主力合约映射并回填分组数据
 * @param forceRefresh 跳过缓存强制回源
 */
const load = async (forceRefresh = false): Promise<void> => {
  loading.value = true;
  failed.value = false;
  try {
    const index = await fetchFuturesVarietyContracts(forceRefresh);
    groups.value = FUTURES_CHAIN_CATEGORIES.map((category) => ({
      key: category.key,
      name: category.name,
      color: category.color,
      items: category.varieties.map((variety) => {
        const hit = index.byVariety.get(variety);
        return {
          variety,
          name: hit?.varietyName ?? variety,
          contractCode: hit?.contractCode ?? '',
          hot: hit ? index.recommendedCodes.has(hit.contractCode) : false,
        };
      }),
    }));
  } catch (err) {
    console.warn('[futures-chain] 主力合约映射拉取失败:', err);
    failed.value = true;
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  void load();
});

/**
 * 点击品种 chip（主力合约缺失时按钮已禁用，不会触发）
 * @param item 品种 chip 数据
 */
const onSelect = (item: VarietyChip): void => {
  if (!item.contractCode) return;
  emit('select', item.contractCode, item.name);
};
</script>

<template>
  <BaseCard title="品种基本面" fill>
    <template #extra>
      <div class="flex items-center gap-3">
        <span class="text-xs text-text-tertiary">点击品种查看产业链 · 来源：同花顺期货通</span>
        <button
          type="button"
          class="pressable text-xs text-primary hover:underline"
          :disabled="loading"
          @click="void load(true)"
        >
          刷新
        </button>
      </div>
    </template>

    <BaseSkeleton v-if="loading" class="h-40" />
    <BaseEmpty v-else-if="failed" text="品种主力合约映射拉取失败，请检查网络后重试">
      <template #extra>
        <BaseButton variant="ghost" @click="void load(true)">重试</BaseButton>
      </template>
    </BaseEmpty>

    <div v-else class="flex flex-col gap-2.5 px-1 py-1">
      <div v-for="group in groups" :key="group.key" class="flex items-start gap-3">
        <span
          class="mt-0.5 w-16 shrink-0 text-sm font-semibold leading-7"
          :style="{ color: group.color }"
        >
          {{ group.name }}
        </span>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="item in group.items"
            :key="item.variety"
            type="button"
            class="pressable relative rounded-md bg-flat-weak px-2.5 py-1 text-xs text-text-secondary transition-transform duration-200 hover:scale-105 hover:bg-flat hover:text-text active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="!item.contractCode"
            :title="item.contractCode ? `${item.name}（主力 ${item.contractCode}）` : `${item.name}：暂无主力合约映射`"
            @click="onSelect(item)"
          >
            {{ item.name }}
            <span
              v-if="item.hot"
              class="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-up"
              aria-label="热点品种"
            />
          </button>
        </div>
      </div>
    </div>
  </BaseCard>
</template>
