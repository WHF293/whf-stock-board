<script setup lang="ts">
import { computed } from 'vue';
import BaseTable from '../../ui/BaseTable.vue';
import BaseTag from '../../ui/BaseTag.vue';
import BaseTooltip from '../../ui/BaseTooltip.vue';
import type { TableColumn } from '../../../../common/types/table.types.ts';
import { FUTURES_PAGE_TEXT } from '../../../../common/constants/futures.constants.ts';
import type {
  CcpmAggregateRow,
  CcpmMemberStats,
} from '../../../../common/types/futures.types.ts';

/**
 * 机构行为页 · 上榜会员总表（核心数据表格）
 *
 * 一张总表看全所有指标（对标中金所原始页，不做分散小表）：
 * - contract 模式：单合约口径，一行一个会员，含行为标签与多空占比
 * - aggregate 模式：跨合约 / 跨品种聚合口径，一行一个会员（合并多空 / 净持仓 /
 *   净增减 / 完整性标记）
 *
 * 行可展开（expandable 透传 BaseTable）：展开内容由父级的 #expanded 插槽提供
 * （单合约 / 同品种口径 = 席位跨合约分解；全股指口径 = 分品种明细）。
 */
const props = defineProps<{
  /** 表格口径 */
  mode: 'contract' | 'aggregate';
  /** 单合约口径行数据（mode=contract 必传） */
  stats?: readonly CcpmMemberStats[];
  /** 聚合口径行数据（mode=aggregate 必传） */
  aggregates?: readonly CcpmAggregateRow[];
  /** 聚合口径是否展示成交量列（跨品种口径成交量量纲不可比，隐藏） */
  showVolume?: boolean;
  /** 当前选中席位（画像卡联动） */
  selectedMember?: string | null;
  /** 已展开（分解）的席位列表（受控） */
  expandedMembers?: readonly string[];
}>();

const emit = defineEmits<{
  /** 选中席位（画像卡联动） */
  select: [memberName: string];
  /** 展开 / 收起席位分解行（父级维护 expandedMembers） */
  toggleExpand: [memberName: string];
}>();

/** 契约层的行联合类型（BaseTable 泛型入口） */
type MemberTableRow = CcpmMemberStats | CcpmAggregateRow;

/** 行数据（按口径取用） */
const rows = computed<readonly MemberTableRow[]>(() =>
  props.mode === 'contract' ? (props.stats ?? []) : (props.aggregates ?? []),
);

/** 是否为单合约口径 */
const isContract = computed(() => props.mode === 'contract');

/** 表头公共列（两口径共有的合并多空列） */
/** BaseTable 列类型（key 是插槽名，字符串键无法直接收窄为行字段，断言收口在此） */
type MemberTableColumn = TableColumn<MemberTableRow>;

/**
 * 按口径构建列配置（BaseTable columns 数据源）
 * @returns 列配置数组
 */
const columns = computed<MemberTableColumn[]>(() => {
  if (isContract.value) {
    return [
      { key: 'memberName', label: '会员' },
      { key: 'netChg', label: '净增减', align: 'right', sortable: true, sortValue: (row) => (row as CcpmMemberStats).netChg },
      { key: 'tag', label: '行为标签' },
      { key: 'volume', label: '成交量', align: 'right', sortable: true, sortValue: (row) => (row as CcpmMemberStats).volume },
      { key: 'volumeChg', label: '量增减', align: 'right', sortable: true, sortValue: (row) => (row as CcpmMemberStats).volumeChg },
      { key: 'buyPos', label: '多单', align: 'right', sortable: true, sortValue: (row) => (row as CcpmMemberStats).buyPos },
      { key: 'buyChg', label: '多增减', align: 'right', sortable: true, sortValue: (row) => (row as CcpmMemberStats).buyChg },
      { key: 'sellPos', label: '空单', align: 'right', sortable: true, sortValue: (row) => (row as CcpmMemberStats).sellPos },
      { key: 'sellChg', label: '空增减', align: 'right', sortable: true, sortValue: (row) => (row as CcpmMemberStats).sellChg },
      { key: 'netPos', label: '净持仓', align: 'right', sortable: true, sortValue: (row) => (row as CcpmMemberStats).netPos },
      { key: 'buyRatio', label: '多占比', align: 'right', sortable: true, sortValue: (row) => (row as CcpmMemberStats).buyRatio },
      { key: 'sellRatio', label: '空占比', align: 'right', sortable: true, sortValue: (row) => (row as CcpmMemberStats).sellRatio },
    ];
  }
  const cols: MemberTableColumn[] = [
    { key: 'memberName', label: '会员' },
    { key: 'totalNetChg', label: '净增减', align: 'right', sortable: true, sortValue: (row) => (row as CcpmAggregateRow).totalNetChg },
    { key: 'tag', label: '行为标签' },
    { key: 'totalBuy', label: '合并多单', align: 'right', sortable: true, sortValue: (row) => (row as CcpmAggregateRow).totalBuy },
    { key: 'totalBuyChg', label: '多增减', align: 'right', sortable: true, sortValue: (row) => (row as CcpmAggregateRow).totalBuyChg },
    { key: 'totalSell', label: '合并空单', align: 'right', sortable: true, sortValue: (row) => (row as CcpmAggregateRow).totalSell },
    { key: 'totalSellChg', label: '空增减', align: 'right', sortable: true, sortValue: (row) => (row as CcpmAggregateRow).totalSellChg },
    { key: 'totalNet', label: '合并净持仓', align: 'right', sortable: true, sortValue: (row) => (row as CcpmAggregateRow).totalNet },
  ];
  if (props.showVolume) {
    cols.push({ key: 'totalVolume', label: '成交量', align: 'right', sortable: true, sortValue: (row) => (row as CcpmAggregateRow).totalVolume });
  }
  cols.push({ key: 'coverage', label: '完整性', align: 'center' });
  return cols;
});

/**
 * 带符号整数文案（正数补 +，null 显示未上榜）
 * @param value 数值
 * @returns 文案
 */
const signed = (value: number | null): string =>
  value === null ? '--' : `${value > 0 ? '+' : ''}${value.toLocaleString('en-US')}`;

/**
 * 无符号整数文案
 * @param value 数值
 * @returns 文案
 */
const plain = (value: number | null): string =>
  value === null ? '--' : value.toLocaleString('en-US');

/**
 * 增减语义色类（红增绿减，跟随全站 data-trend 主题）
 * @param value 数值
 * @returns 类名
 */
const chgClass = (value: number | null): string => {
  if (value === null || value === 0) return 'text-flat';
  return value > 0 ? 'text-up' : 'text-down';
};

/**
 * 净持仓语义色类（净多=红、净空=绿、0=平）
 * @param value 数值
 * @returns 类名
 */
const netClass = (value: number | null): string => {
  if (value === null || value === 0) return 'text-flat';
  return value > 0 ? 'text-up' : 'text-down';
};

/**
 * 行为标签样式映射（标签语义：对冲=主色中性、单边多=up、单边空=down）
 */
const TAG_VARIANTS: Record<string, 'primary' | 'up' | 'down'> = {
  hedge: 'primary',
  long: 'up',
  short: 'down',
};
</script>

<template>
  <BaseTable
    :columns="columns"
    :rows="rows"
    :row-key="(row: MemberTableRow) => row.memberName"
    row-clickable
    expandable
    :expanded-keys="[...(expandedMembers ?? [])]"
    min-width="920px"
    @row-click="(row: MemberTableRow) => emit('select', row.memberName)"
    @toggle-expand="(row: MemberTableRow) => emit('toggleExpand', row.memberName)"
  >
    <template #memberName="{ row }">
      <span
        class="font-semibold"
        :class="row.memberName === selectedMember ? 'text-primary' : 'text-text'"
      >{{ row.memberName }}</span>
    </template>
    <template #tag="{ row }">
      <BaseTag
        v-if="row.tag"
        :tone="TAG_VARIANTS[row.tag] ?? 'flat'"
        class="cursor-help"
      >
        {{ FUTURES_PAGE_TEXT.tagLabels[row.tag] }}
        <BaseTooltip :text="row.tagReason ?? ''" placement="bottom" />
      </BaseTag>
      <span v-else class="cursor-help text-xs text-text-tertiary" :title="row.tagReason ?? ''">--</span>
    </template>
    <template #volume="{ row }">
      {{ plain(isContract ? (row as CcpmMemberStats).volume : (row as CcpmAggregateRow).totalVolume) }}
    </template>
    <template #volumeChg="{ row }">
      <span :class="chgClass((row as CcpmMemberStats).volumeChg)">{{ signed((row as CcpmMemberStats).volumeChg) }}</span>
    </template>
    <template #buyPos="{ row }">
      {{ plain((row as CcpmMemberStats).buyPos) }}
    </template>
    <template #buyChg="{ row }">
      <span :class="chgClass((row as CcpmMemberStats).buyChg)">{{ signed((row as CcpmMemberStats).buyChg) }}</span>
    </template>
    <template #sellPos="{ row }">
      {{ plain((row as CcpmMemberStats).sellPos) }}
    </template>
    <template #sellChg="{ row }">
      <span :class="chgClass((row as CcpmMemberStats).sellChg)">{{ signed((row as CcpmMemberStats).sellChg) }}</span>
    </template>
    <template #netPos="{ row }">
      <span :class="netClass((row as CcpmMemberStats).netPos)">{{ signed((row as CcpmMemberStats).netPos) }}</span>
    </template>
    <template #netChg="{ row }">
      <span :class="chgClass((row as CcpmMemberStats).netChg)">{{ signed((row as CcpmMemberStats).netChg) }}</span>
    </template>
    <template #buyRatio="{ row }">
      {{ (row as CcpmMemberStats).buyRatio === null ? '--' : `${(row as CcpmMemberStats).buyRatio?.toFixed(1)}%` }}
    </template>
    <template #sellRatio="{ row }">
      {{ (row as CcpmMemberStats).sellRatio === null ? '--' : `${(row as CcpmMemberStats).sellRatio?.toFixed(1)}%` }}
    </template>
    <template #totalBuy="{ row }">
      {{ plain((row as CcpmAggregateRow).totalBuy) }}
    </template>
    <template #totalBuyChg="{ row }">
      <span :class="chgClass((row as CcpmAggregateRow).totalBuyChg)">{{ signed((row as CcpmAggregateRow).totalBuyChg) }}</span>
    </template>
    <template #totalSell="{ row }">
      {{ plain((row as CcpmAggregateRow).totalSell) }}
    </template>
    <template #totalSellChg="{ row }">
      <span :class="chgClass((row as CcpmAggregateRow).totalSellChg)">{{ signed((row as CcpmAggregateRow).totalSellChg) }}</span>
    </template>
    <template #totalNet="{ row }">
      <span :class="netClass((row as CcpmAggregateRow).totalNet)">{{ signed((row as CcpmAggregateRow).totalNet) }}</span>
    </template>
    <template #totalNetChg="{ row }">
      <span :class="chgClass((row as CcpmAggregateRow).totalNetChg)">{{ signed((row as CcpmAggregateRow).totalNetChg) }}</span>
    </template>
    <template #coverage="{ row }">
      <BaseTag :tone="(row as CcpmAggregateRow).isPartial ? 'up' : 'flat'">
        上榜 {{ (row as CcpmAggregateRow).coveredCount }} / {{ (row as CcpmAggregateRow).totalCount }}
      </BaseTag>
    </template>
    <!-- 分解行内容透传给父级（席位跨合约分解 / 分品种明细） -->
    <template #expanded="slotProps">
      <slot name="expanded" v-bind="slotProps" />
    </template>
  </BaseTable>
</template>
