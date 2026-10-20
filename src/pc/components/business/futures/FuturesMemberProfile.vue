<script setup lang="ts">
import BaseTag from '../../ui/BaseTag.vue';
import { FUTURES_PAGE_TEXT } from '../../../../common/constants/futures.constants.ts';
import type { CcpmAggregateRow, CcpmMemberStats, CcpmScopeMode } from '../../../../common/types/futures.types.ts';

/**
 * 机构行为页 · 选中席位画像卡
 *
 * 两种数据形态：单合约口径（CcpmMemberStats）与聚合口径（CcpmAggregateRow），
 * 由调用方按当前口径传其一；全股指口径下额外展示「净持仓增减大数字」——
 * 即短视频口径的核验值（净多增加 = Σ多头增减 − Σ空头增减）。
 */
defineProps<{
  /** 页面口径（决定标题与展示项） */
  scope: CcpmScopeMode;
  /** 单合约口径画像数据 */
  stats?: CcpmMemberStats | null;
  /** 聚合口径画像数据 */
  aggregate?: CcpmAggregateRow | null;
}>();

/**
 * 带符号整数文案
 * @param value 数值
 * @returns 文案
 */
const signed = (value: number | null | undefined): string =>
  value === null || value === undefined ? '--' : `${value > 0 ? '+' : ''}${value.toLocaleString('en-US')}`;

/**
 * 数值语义色类（正 up / 负 down / 0 平）
 * @param value 数值
 * @returns 类名
 */
const signClass = (value: number | null | undefined): string => {
  if (!value) return 'text-flat';
  return value > 0 ? 'text-up' : 'text-down';
};
</script>

<template>
  <section class="rounded-card bg-surface p-4 shadow-card">
    <header class="mb-3 flex items-center justify-between gap-2">
      <h2 class="truncate text-sm font-semibold text-text">
        席位画像 · {{ (stats ?? aggregate)?.memberName ?? '--' }}
      </h2>
      <BaseTag v-if="scope !== 'contract'" tone="primary">
        {{ scope === 'all' ? '全股指合并口径' : '同品种合并口径' }}
      </BaseTag>
    </header>

    <!-- 全股指口径：净持仓增减大数字（短视频口径核验） -->
    <div v-if="scope === 'all' && aggregate" class="mb-3">
      <div class="flex items-baseline gap-2">
        <span class="text-3xl font-extrabold tabular-nums" :class="signClass(aggregate.totalNetChg)">
          {{ signed(aggregate.totalNetChg) }}
        </span>
        <span class="text-xs text-text-secondary">手 · 净持仓增减（= 多头增减 − 空头增减）</span>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <template v-if="stats">
        <div class="rounded-lg bg-bg p-2.5">
          <div class="text-xs font-semibold text-text-tertiary">多头持仓</div>
          <div class="mt-0.5 text-base font-bold tabular-nums text-up">{{ stats.buyPos ?? '--' }}</div>
          <div class="text-xs tabular-nums" :class="signClass(stats.buyChg)">{{ signed(stats.buyChg) }}</div>
        </div>
        <div class="rounded-lg bg-bg p-2.5">
          <div class="text-xs font-semibold text-text-tertiary">空头持仓</div>
          <div class="mt-0.5 text-base font-bold tabular-nums text-down">{{ stats.sellPos ?? '--' }}</div>
          <div class="text-xs tabular-nums" :class="signClass(stats.sellChg)">{{ signed(stats.sellChg) }}</div>
        </div>
        <div class="rounded-lg bg-bg p-2.5">
          <div class="text-xs font-semibold text-text-tertiary">净持仓</div>
          <div class="mt-0.5 text-base font-bold tabular-nums" :class="signClass(stats.netPos)">{{ signed(stats.netPos) }}</div>
          <div class="text-xs text-text-tertiary">多 − 空</div>
        </div>
        <div class="rounded-lg bg-bg p-2.5">
          <div class="text-xs font-semibold text-text-tertiary">净持仓增减</div>
          <div class="mt-0.5 text-base font-bold tabular-nums" :class="signClass(stats.netChg)">{{ signed(stats.netChg) }}</div>
          <div class="text-xs text-text-tertiary">多增减 − 空增减</div>
        </div>
        <div class="rounded-lg bg-bg p-2.5">
          <div class="text-xs font-semibold text-text-tertiary">多头占比</div>
          <div class="mt-0.5 text-base font-bold tabular-nums text-text">
            {{ stats.buyRatio === null ? '--' : `${stats.buyRatio.toFixed(1)}%` }}
          </div>
          <div class="text-xs text-text-tertiary">÷ 上榜总多单</div>
        </div>
        <div class="rounded-lg bg-bg p-2.5">
          <div class="text-xs font-semibold text-text-tertiary">空头占比</div>
          <div class="mt-0.5 text-base font-bold tabular-nums text-text">
            {{ stats.sellRatio === null ? '--' : `${stats.sellRatio.toFixed(1)}%` }}
          </div>
          <div class="text-xs text-text-tertiary">÷ 上榜总空单</div>
        </div>
      </template>
      <template v-else-if="aggregate">
        <div class="rounded-lg bg-bg p-2.5">
          <div class="text-xs font-semibold text-text-tertiary">合并多单</div>
          <div class="mt-0.5 text-base font-bold tabular-nums text-up">{{ aggregate.totalBuy.toLocaleString('en-US') }}</div>
          <div class="text-xs tabular-nums" :class="signClass(aggregate.totalBuyChg)">{{ signed(aggregate.totalBuyChg) }}</div>
        </div>
        <div class="rounded-lg bg-bg p-2.5">
          <div class="text-xs font-semibold text-text-tertiary">合并空单</div>
          <div class="mt-0.5 text-base font-bold tabular-nums text-down">{{ aggregate.totalSell.toLocaleString('en-US') }}</div>
          <div class="text-xs tabular-nums" :class="signClass(aggregate.totalSellChg)">{{ signed(aggregate.totalSellChg) }}</div>
        </div>
        <div class="rounded-lg bg-bg p-2.5">
          <div class="text-xs font-semibold text-text-tertiary">合并净持仓</div>
          <div class="mt-0.5 text-base font-bold tabular-nums" :class="signClass(aggregate.totalNet)">{{ signed(aggregate.totalNet) }}</div>
          <div class="text-xs text-text-tertiary">多 − 空</div>
        </div>
        <div class="rounded-lg bg-bg p-2.5">
          <div class="text-xs font-semibold text-text-tertiary">完整性</div>
          <div class="mt-0.5 text-base font-bold tabular-nums text-text">
            {{ aggregate.coveredCount }} / {{ aggregate.totalCount }}
          </div>
          <div class="text-xs" :class="aggregate.isPartial ? 'text-up' : 'text-text-tertiary'">
            {{ aggregate.isPartial ? '部分头寸' : '完全统计' }}
          </div>
        </div>
      </template>
    </div>

    <div v-if="stats?.tag || aggregate?.tag" class="mt-2.5 flex flex-wrap items-center gap-1.5">
      <BaseTag
        v-if="stats?.tag"
        :tone="stats.tag === 'hedge' ? 'primary' : stats.tag === 'long' ? 'up' : 'down'"
      >
        {{ FUTURES_PAGE_TEXT.tagLabels[stats.tag] }}
      </BaseTag>
      <BaseTag
        v-if="aggregate?.tag"
        :tone="aggregate.tag === 'hedge' ? 'primary' : aggregate.tag === 'long' ? 'up' : 'down'"
      >
        {{ FUTURES_PAGE_TEXT.tagLabels[aggregate.tag] }}
      </BaseTag>
      <span class="text-xs text-text-tertiary">{{ (stats ?? aggregate)?.tagReason }}</span>
    </div>
    <p class="mt-2 text-xs leading-relaxed text-text-tertiary">{{ FUTURES_PAGE_TEXT.tagRule }}</p>
    <div v-if="!stats && !aggregate" class="grid place-items-center py-8 text-center text-xs text-text-tertiary">
      点击总表中的席位行查看画像
    </div>
  </section>
</template>
