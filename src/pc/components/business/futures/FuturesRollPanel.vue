<script setup lang="ts">
import { computed, ref } from 'vue';
import MenuIcon from '../../ui/MenuIcon.vue';
import BaseTag from '../../ui/BaseTag.vue';
import { CCPM_ROLL_CHG_THRESHOLD } from '../../../../common/constants/futures.constants.ts';
import type { CcpmMemberRow } from '../../../../common/types/futures.types.ts';

/**
 * 机构行为页 · 移仓换月专项面板（折叠）
 *
 * 取该品种披露的前两个合约（当月 / 次月），横向对比头部席位在两合约上的
 * 多空增减：近月某方向减仓（chg < -阈值）且次月同方向增仓（chg > 阈值）→
 * 标记疑似移仓。移仓 ≠ 看多 / 看空，只是更换到期合约。
 */
const props = defineProps<{
  /** 品种当日全部原始行（两合约的数据源） */
  rows: readonly CcpmMemberRow[];
  /** 合约列表（按披露顺序，前两个参与判定） */
  instruments: readonly string[];
}>();

/** 是否展开（默认收起） */
const expanded = ref(false);

/** 近月 / 次月合约（不足两个时不渲染判定） */
const pair = computed(() => [props.instruments[0] ?? '', props.instruments[1] ?? '']);

/** 每席位在两合约上的增减（member → 近月 / 次月的 buyChg、sellChg） */
interface RollEntry {
  memberName: string;
  near: { buyChg: number | null; sellChg: number | null };
  far: { buyChg: number | null; sellChg: number | null };
}

/**
 * 构建席位 × 合约增减映射
 * @returns RollEntry 列表（按近月合计 |chg| 降序，头部席位在前）
 */
const entries = computed<readonly RollEntry[]>(() => {
  const [nearId, farId] = pair.value;
  if (!nearId || !farId) {
    return [];
  }
  const map = new Map<string, RollEntry>();
  for (const row of props.rows) {
    if (row.instrumentId !== nearId && row.instrumentId !== farId) {
      continue;
    }
    let entry = map.get(row.memberName);
    if (!entry) {
      entry = {
        memberName: row.memberName,
        near: { buyChg: null, sellChg: null },
        far: { buyChg: null, sellChg: null },
      };
      map.set(row.memberName, entry);
    }
    const slot = row.instrumentId === nearId ? entry.near : entry.far;
    slot.buyChg = row.buyChg;
    slot.sellChg = row.sellChg;
  }
  return [...map.values()].sort((a, b) => {
    const magA = Math.abs(a.near.buyChg ?? 0) + Math.abs(a.near.sellChg ?? 0);
    const magB = Math.abs(b.near.buyChg ?? 0) + Math.abs(b.near.sellChg ?? 0);
    return magB - magA;
  });
});

/**
 * 移仓判定：近月某方向减仓且次月同方向增仓（阈值见常量）
 * @param entry 席位两合约增减
 * @returns 是否疑似移仓（任一方向命中）
 */
const isRolling = (entry: RollEntry): boolean => {
  const near = entry.near;
  const far = entry.far;
  for (const side of ['buyChg', 'sellChg'] as const) {
    const nearChg = near[side];
    const farChg = far[side];
    if (
      nearChg !== null &&
      farChg !== null &&
      nearChg <= -CCPM_ROLL_CHG_THRESHOLD &&
      farChg >= CCPM_ROLL_CHG_THRESHOLD
    ) {
      return true;
    }
  }
  return false;
};

/**
 * 参与判定的席位（多空增减齐全，数据缺失会导致误判）
 * @param entry 席位条目
 * @returns 是否可判定
 */
const judgeable = (entry: RollEntry): boolean =>
  entry.near.buyChg !== null &&
  entry.near.sellChg !== null &&
  entry.far.buyChg !== null &&
  entry.far.sellChg !== null;

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
  <section class="rounded-card bg-surface shadow-card">
    <button
      type="button"
      class="pressable flex w-full items-center gap-2 rounded-card px-4 py-3 text-left"
      @click="expanded = !expanded"
    >
      <span class="text-sm font-semibold text-text">移仓换月专项</span>
      <span class="text-xs text-text-tertiary">
        {{ pair[0] && pair[1] ? `${pair[0]} → ${pair[1]} 增减仓对比，阈值 ±${CCPM_ROLL_CHG_THRESHOLD} 手` : '披露合约不足两个，无法判定' }}
      </span>
      <MenuIcon :name="expanded ? 'chevronDown' : 'chevronRight'" :size="14" class="ml-auto text-text-tertiary" />
    </button>
    <div v-if="expanded" class="px-4 pb-4">
      <table v-if="entries.length > 0" class="w-full text-sm tabular-nums">
        <thead>
          <tr class="border-b border-flat-weak text-left text-xs text-text-tertiary">
            <th class="py-1.5 pr-2 font-medium">席位</th>
            <th class="py-1.5 pr-2 text-right font-medium">{{ pair[0] }} 多增减</th>
            <th class="py-1.5 pr-2 text-right font-medium">{{ pair[0] }} 空增减</th>
            <th class="py-1.5 pr-2 text-right font-medium">{{ pair[1] }} 多增减</th>
            <th class="py-1.5 pr-2 text-right font-medium">{{ pair[1] }} 空增减</th>
            <th class="py-1.5 text-right font-medium">判定</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in entries"
            :key="entry.memberName"
            class="border-b border-flat-weak last:border-0"
          >
            <td class="py-1.5 pr-2 font-medium text-text">{{ entry.memberName }}</td>
            <td class="py-1.5 pr-2 text-right" :class="chgClass(entry.near.buyChg)">{{ signed(entry.near.buyChg) }}</td>
            <td class="py-1.5 pr-2 text-right" :class="chgClass(entry.near.sellChg)">{{ signed(entry.near.sellChg) }}</td>
            <td class="py-1.5 pr-2 text-right" :class="chgClass(entry.far.buyChg)">{{ signed(entry.far.buyChg) }}</td>
            <td class="py-1.5 pr-2 text-right" :class="chgClass(entry.far.sellChg)">{{ signed(entry.far.sellChg) }}</td>
            <td class="py-1.5 text-right">
              <BaseTag v-if="judgeable(entry) && isRolling(entry)" tone="primary">📦 疑似移仓</BaseTag>
              <span v-else-if="judgeable(entry)" class="text-xs text-text-tertiary">非移仓</span>
              <span v-else class="text-xs text-text-tertiary">数据不足</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="mt-2 text-xs text-text-tertiary">
        判定规则：近月某方向减仓（≤ −{{ CCPM_ROLL_CHG_THRESHOLD }} 手），且次月同方向增仓（≥ {{ CCPM_ROLL_CHG_THRESHOLD }} 手）。
        移仓 ≠ 看多 / 看空，只是更换到期合约。
      </p>
    </div>
  </section>
</template>
