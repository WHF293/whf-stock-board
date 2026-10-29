<script setup lang="ts">
import { computed } from 'vue';

/**
 * 投资账本指标行：总资产 / 区间盈亏 / 当前仓位 / 可用资金 / 对比沪深300
 *
 * 涨跌语义色跟随 data-trend 主题（红涨绿跌默认）；可用资金为负时红色警示
 */
const props = defineProps<{
  /** 总资产 */
  totalAsset: number;
  /** 持仓市值 */
  marketValue: number;
  /** 可用资金（可能为负） */
  availableFunds: number;
  /** 当前仓位 0~1 */
  positionRatio: number;
  /** 区间盈亏 */
  rangeProfit: number;
  /** 区间收益率（小数） */
  rangeRate: number;
  /** 区间盈亏副标题（区间文案） */
  rangeLabel: string;
  /** 沪深300 区间涨跌幅（小数，正 = 涨） */
  hs300Rate: number;
}>();

/**
 * 金额格式：千分位 + 2 位小数（账户金额量级为万元级，不做亿换算）
 * @param v 数值
 * @returns 千分位文案
 */
const yuan = (v: number): string =>
  v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 带符号百分比文案
 * @param v 小数比例
 * @returns 正值补 + 号的百分比文案
 */
const pct = (v: number): string => `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

/** 盈亏文案色 */
const plClass = computed(() =>
  props.rangeProfit > 0 ? 'text-up' : props.rangeProfit < 0 ? 'text-down' : 'text-flat',
);

/** 超额收益（自身收益率 − 沪深300） */
const excess = computed(() => props.rangeRate - props.hs300Rate);

/** 超额文案色 */
const excessClass = computed(() =>
  excess.value > 0 ? 'text-up' : excess.value < 0 ? 'text-down' : 'text-flat',
);
</script>

<template>
  <div class="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
    <div class="rounded-card bg-surface p-4 shadow-card">
      <p class="mb-1 text-xs text-text-tertiary">总资产</p>
      <p class="font-mono text-xl font-semibold tabular-nums text-text">{{ yuan(totalAsset) }}</p>
      <p class="mt-0.5 text-xs text-text-tertiary">持仓市值 {{ yuan(marketValue) }}</p>
    </div>

    <div class="rounded-card bg-surface p-4 shadow-card">
      <p class="mb-1 text-xs text-text-tertiary">区间盈亏（{{ rangeLabel }}）</p>
      <p class="font-mono text-xl font-semibold tabular-nums" :class="plClass">
        {{ rangeProfit > 0 ? '+' : '' }}{{ yuan(rangeProfit) }}
      </p>
      <p class="mt-0.5 text-xs text-text-tertiary">
        收益率 <b :class="plClass">{{ pct(rangeRate) }}</b>
      </p>
    </div>

    <div class="rounded-card bg-surface p-4 shadow-card">
      <p class="mb-1 text-xs text-text-tertiary">当前仓位</p>
      <p class="font-mono text-xl font-semibold tabular-nums text-text">
        {{ (positionRatio * 100).toFixed(1) }}%
      </p>
      <p class="mt-0.5 text-xs text-text-tertiary">区间内随净值曲线右轴波动</p>
    </div>

    <div class="rounded-card bg-surface p-4 shadow-card">
      <p class="mb-1 text-xs text-text-tertiary">可用资金</p>
      <p
        class="font-mono text-xl font-semibold tabular-nums"
        :class="availableFunds < 0 ? 'text-down' : 'text-text'"
      >
        {{ yuan(availableFunds) }}
      </p>
      <p v-if="availableFunds < 0" class="mt-0.5 text-xs text-down">⚠ 负值：含未确认交收</p>
      <p v-else class="mt-0.5 text-xs text-text-tertiary">可转入 / 建仓</p>
    </div>

    <div class="rounded-card bg-surface p-4 shadow-card">
      <p class="mb-1 text-xs text-text-tertiary">对比沪深300（{{ pct(hs300Rate) }}）</p>
      <p class="font-mono text-xl font-semibold tabular-nums" :class="excessClass">
        {{ excess > 0 ? '+' : '' }}{{ (excess * 100).toFixed(2) }} pct
      </p>
      <p class="mt-0.5 text-xs" :class="excessClass">
        {{ excess > 0 ? '跑赢基准' : excess < 0 ? '跑输基准' : '持平基准' }}
      </p>
    </div>
  </div>
</template>
