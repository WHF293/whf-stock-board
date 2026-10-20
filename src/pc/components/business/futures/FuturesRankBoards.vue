<script setup lang="ts">
import type { FuturesRankBoards, FuturesRankQuoteType, FuturesRankRow } from '../../../../common/types/futures.types.ts';

/**
 * 期货总览 · 主力合约四榜（涨幅 / 跌幅 / 成交额 / 日增仓）
 *
 * 布局参照同花顺期货通首页同名区块：四栏并排，每栏榜单标题 + N 行
 * （合约名 / 最新价 / 第三列）。第三列语义随榜单变化：涨跌幅（红涨绿跌）、
 * 成交额（中性）、日增仓（增仓红 / 减仓绿，符合全站涨跌语义色）。
 */

defineProps<{
  /** 四张榜单（键为榜单类型；缺数据的榜单不渲染该栏） */
  boards: Partial<FuturesRankBoards>;
}>();

/** 榜单栏配置（标题 + 第三列语义） */
const BOARD_VIEW: Record<FuturesRankQuoteType, { title: string; col3: 'changePercent' | 'turnover' | 'oiChange' }> = {
  rise_percent: { title: '涨幅榜', col3: 'changePercent' },
  fall_percent: { title: '跌幅榜', col3: 'changePercent' },
  turnover: { title: '成交额榜', col3: 'turnover' },
  increase_position: { title: '日增仓榜', col3: 'oiChange' },
};

/** 栏渲染顺序（涨幅 → 跌幅 → 成交额 → 日增仓，与同花顺一致） */
const BOARD_ORDER: readonly FuturesRankQuoteType[] = [
  'rise_percent',
  'fall_percent',
  'turnover',
  'increase_position',
];

/** 第三列语义 → 表头文案 */
const COL3_LABEL: Record<'changePercent' | 'turnover' | 'oiChange', string> = {
  changePercent: '涨跌幅',
  turnover: '成交额',
  oiChange: '日增仓',
};

/** 涨跌语义着色（正 = 红、负 = 绿、0/缺失 = 中性）
 * @param value 数值
 * @returns 颜色 class
 */
const trendClass = (value: number | null): string => {
  if (value === null || value === 0) return 'text-text';
  return value > 0 ? 'text-up' : 'text-down';
};

/**
 * 最新价格式化（≥1000 保留 1 位小数，其余 2 位，避免长尾小数）
 * @param value 最新价
 * @returns 展示文案
 */
const formatPrice = (value: number | null): string => {
  if (value === null) return '--';
  return value >= 1000 ? value.toFixed(1) : value.toFixed(2);
};

/**
 * 第三列文案（语义随榜单：涨跌幅 % / 成交额 亿 / 日增仓 万手）
 * @param row 榜单行
 * @param kind 第三列语义
 * @returns 展示文案
 */
const formatCol3 = (row: FuturesRankRow, kind: 'changePercent' | 'turnover' | 'oiChange'): string => {
  if (kind === 'changePercent') {
    return row.changePercent === null ? '--' : `${row.changePercent > 0 ? '+' : ''}${row.changePercent.toFixed(2)}%`;
  }
  if (kind === 'turnover') {
    return row.turnover === null ? '--' : `${(row.turnover / 1e8).toFixed(1)}亿`;
  }
  return row.oiChange === null ? '--' : `${row.oiChange > 0 ? '+' : ''}${(row.oiChange / 1e4).toFixed(2)}万`;
};

/** 第三列着色（成交额中性，涨跌幅与日增仓走涨跌语义色）
 * @param row 榜单行
 * @param kind 第三列语义
 * @returns 颜色 class
 */
const col3Class = (row: FuturesRankRow, kind: 'changePercent' | 'turnover' | 'oiChange'): string => {
  if (kind === 'turnover') return 'text-text';
  if (kind === 'changePercent') return trendClass(row.changePercent);
  return trendClass(row.oiChange);
};
</script>

<template>
  <div class="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
    <template v-for="type in BOARD_ORDER" :key="type">
      <div v-if="boards[type]?.length" class="min-w-0">
        <div class="mb-2 flex items-center border-l-2 border-primary pl-2">
          <span class="text-sm font-semibold text-text">{{ BOARD_VIEW[type].title }}</span>
        </div>
        <div class="flex flex-col gap-2 text-xs">
          <div class="flex items-center justify-between gap-2 text-text-tertiary">
            <span>合约名称</span>
            <span class="w-16 shrink-0 text-right">最新价</span>
            <span class="w-20 shrink-0 text-right">{{ COL3_LABEL[BOARD_VIEW[type].col3] }}</span>
          </div>
          <div
            v-for="row in boards[type]"
            :key="row.contract.contractCode"
            class="flex items-center justify-between gap-2"
          >
            <span class="min-w-0 truncate text-text" :title="row.contract.contractName">
              {{ row.contract.contractName }}
            </span>
            <span class="w-16 shrink-0 text-right tabular-nums text-text">
              {{ formatPrice(row.lastPrice) }}
            </span>
            <span
              class="w-20 shrink-0 text-right tabular-nums"
              :class="col3Class(row, BOARD_VIEW[type].col3)"
            >
              {{ formatCol3(row, BOARD_VIEW[type].col3) }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
