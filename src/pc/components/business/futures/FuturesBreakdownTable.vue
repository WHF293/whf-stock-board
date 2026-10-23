<script setup lang="ts">
import { computed } from 'vue';
import BaseTag from '../../ui/BaseTag.vue';
import { FUTURES_PAGE_TEXT } from '../../../../common/constants/futures.constants.ts';
import type { CcpmMemberRow } from '../../../../common/types/futures.types.ts';

/**
 * 机构行为页 · 席位分解明细表（总表展开行内容）
 *
 * 单合约 / 同品种口径：该席位当日全部上榜合约（跨合约分解，底部合并汇总 +
 * 完整性标记）；全股指口径：该席位在四品种各上榜合约的明细。核心价值是
 * 揭示「单合约小幅净多，其他合约大幅净空」的合并真相。
 */
const props = defineProps<{
  /** 席位名 */
  memberName: string;
  /** 该席位当日全部上榜原始行（可跨品种） */
  rows: readonly CcpmMemberRow[];
  /** 口径合约总数（完整性与判定用；跨品种 = 各品种合约数之和） */
  totalCount: number;
}>();

/** 合并汇总（缺失侧按 0 计入，完整性由 coveredCount 表达） */
const summary = computed(() => {
  let buy = 0;
  let sell = 0;
  let buyChg = 0;
  let sellChg = 0;
  for (const row of props.rows) {
    buy += row.buyPos ?? 0;
    sell += row.sellPos ?? 0;
    buyChg += row.buyChg ?? 0;
    sellChg += row.sellChg ?? 0;
  }
  return {
    buy,
    sell,
    net: buy - sell,
    buyChg,
    sellChg,
    netChg: buyChg - sellChg,
    covered: props.rows.length,
  };
});

/**
 * 单行净持仓（多空任一侧有值即可算）
 * @param row 原始行
 * @returns 净持仓
 */
const netOf = (row: CcpmMemberRow): number | null =>
  row.buyPos !== null || row.sellPos !== null ? (row.buyPos ?? 0) - (row.sellPos ?? 0) : null;

/**
 * 单行净增减
 * @param row 原始行
 * @returns 净增减
 */
const netChgOf = (row: CcpmMemberRow): number | null =>
  row.buyChg !== null || row.sellChg !== null ? (row.buyChg ?? 0) - (row.sellChg ?? 0) : null;

/**
 * 带符号整数文案
 * @param value 数值
 * @returns 文案
 */
const signed = (value: number | null): string =>
  value === null ? '--' : `${value > 0 ? '+' : ''}${value.toLocaleString('en-US')}`;

/**
 * 增减语义色类
 * @param value 数值
 * @returns 类名
 */
const chgClass = (value: number | null): string => {
  if (value === null || value === 0) return 'text-flat';
  return value > 0 ? 'text-up' : 'text-down';
};
</script>

<template>
  <div class="space-y-2">
    <table class="w-full text-sm tabular-nums">
      <thead>
        <tr class="border-b border-flat-weak text-left text-xs text-text-tertiary">
          <th class="py-1.5 pr-2 font-medium">合约</th>
          <th class="py-1.5 pr-2 text-right font-medium">多单</th>
          <th class="py-1.5 pr-2 text-right font-medium">多增减</th>
          <th class="py-1.5 pr-2 text-right font-medium">空单</th>
          <th class="py-1.5 pr-2 text-right font-medium">空增减</th>
          <th class="py-1.5 pr-2 text-right font-medium">单合约净持仓</th>
          <th class="py-1.5 text-right font-medium">净增减</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.instrumentId"
          class="border-b border-flat-weak last:border-0"
        >
          <td class="py-1.5 pr-2 font-medium text-text">{{ row.instrumentId }}</td>
          <td class="py-1.5 pr-2 text-right">{{ row.buyPos === null ? '--' : row.buyPos.toLocaleString('en-US') }}</td>
          <td class="py-1.5 pr-2 text-right" :class="chgClass(row.buyChg)">{{ signed(row.buyChg) }}</td>
          <td class="py-1.5 pr-2 text-right">{{ row.sellPos === null ? '--' : row.sellPos.toLocaleString('en-US') }}</td>
          <td class="py-1.5 pr-2 text-right" :class="chgClass(row.sellChg)">{{ signed(row.sellChg) }}</td>
          <td class="py-1.5 pr-2 text-right" :class="chgClass(netOf(row))">{{ signed(netOf(row)) }}</td>
          <td class="py-1.5 text-right" :class="chgClass(netChgOf(row))">{{ signed(netChgOf(row)) }}</td>
        </tr>
        <tr class="bg-flat-weak/40 font-semibold">
          <td class="py-1.5 pr-2">上榜合约合并</td>
          <td class="py-1.5 pr-2 text-right">{{ summary.buy.toLocaleString('en-US') }}</td>
          <td class="py-1.5 pr-2 text-right" :class="chgClass(summary.buyChg)">{{ signed(summary.buyChg) }}</td>
          <td class="py-1.5 pr-2 text-right">{{ summary.sell.toLocaleString('en-US') }}</td>
          <td class="py-1.5 pr-2 text-right" :class="chgClass(summary.sellChg)">{{ signed(summary.sellChg) }}</td>
          <td class="py-1.5 pr-2 text-right" :class="chgClass(summary.net)">{{ signed(summary.net) }}</td>
          <td class="py-1.5 text-right" :class="chgClass(summary.netChg)">{{ signed(summary.netChg) }}</td>
        </tr>
      </tbody>
    </table>
    <div class="flex flex-wrap items-center gap-2">
      <BaseTag :tone="summary.covered < totalCount ? 'up' : 'flat'">
        上榜合约 {{ summary.covered }} / {{ totalCount }}
      </BaseTag>
      <span class="text-xs text-text-tertiary">{{ FUTURES_PAGE_TEXT.partialWarn }}</span>
    </div>
  </div>
</template>
