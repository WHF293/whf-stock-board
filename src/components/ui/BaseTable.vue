<script setup lang="ts" generic="T">
import { computed, ref } from 'vue';
import type { TableColumn } from '../../types/table.types';

/**
 * 配置驱动的通用表格
 *
 * - 列由 columns 数组驱动：新增列 / 调整顺序只改配置
 * - 每列可用与列 key 同名的作用域插槽自定义渲染（参数 { row }），
 *   未提供插槽时展示 row[key] 原值
 * - 列 sortable: true 时点击表头排序（循环 降序 -> 升序，空值沉底）；
 *   排序作用于传入的 rows（懒加载场景即当前已展示行）
 * - 外层滚动容器（table-scroll / table-scroll-sm）由 scrollClass 决定，
 *   吸顶表头 / 首列吸左样式由 theme.css 的容器类提供
 */
const props = defineProps<{
  /** 列配置（数组顺序即列顺序） */
  columns: TableColumn<T>[];
  /** 行数据（懒加载场景传已放行的切片） */
  rows: readonly T[];
  /** 行 key 提取 */
  rowKey: (row: T) => string;
  /** 滚动容器类，默认 table-scroll */
  scrollClass?: string;
  /** 表格最小宽度（窄屏横向滚动用，如 '640px'） */
  minWidth?: string;
  /** 行是否可点击（控制指针与 hover 底色） */
  rowClickable?: boolean;
  /** 底部提示文案（如懒加载进度），显示为横跨全列的提示行 */
  footerText?: string;
}>();

const emit = defineEmits<{
  /** 行点击 */
  rowClick: [row: T];
  /** 容器滚动（透传给外部懒加载逻辑） */
  scroll: [event: Event];
}>();

/** 排序列 key；null 表示未排序 */
const sortKey = ref<string | null>(null);
/** 排序方向 */
const sortOrder = ref<'desc' | 'asc'>('desc');

/**
 * 点击表头：可排序列循环切换 降序 -> 升序
 * @param col 列配置
 */
const toggleSort = (col: TableColumn<T>): void => {
  if (!col.sortable || !col.sortValue) {
    return;
  }
  if (sortKey.value === col.key) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc';
  } else {
    sortKey.value = col.key;
    sortOrder.value = 'desc';
  }
};

/** 排序后的展示行（未排序时保持原顺序） */
const sortedRows = computed(() => {
  if (!sortKey.value) {
    return props.rows;
  }
  const col = props.columns.find((column) => column.key === sortKey.value);
  if (!col?.sortValue) {
    return props.rows;
  }
  const dir = sortOrder.value === 'desc' ? -1 : 1;
  return [...props.rows].sort((a, b) => {
    const va = col.sortValue!(a);
    const vb = col.sortValue!(b);
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return va > vb ? dir : -dir;
  });
});

/**
 * 表头排序标记
 * @param col 列配置
 * @returns 排序标记字符（未排序 ↕ / 降序 ↓ / 升序 ↑；不可排序列为空）
 */
const sortMark = (col: TableColumn<T>): string => {
  if (!col.sortable) return '';
  if (sortKey.value !== col.key) return '↕';
  return sortOrder.value === 'desc' ? '↓' : '↑';
};

/**
 * 默认单元格取值（未提供插槽时）
 * @param row 行数据
 * @param key 列键
 * @returns 单元格原值
 */
const cellValue = (row: T, key: string): unknown => (row as Record<string, unknown>)[key];

/**
 * 对齐方式 -> 类名
 * @param col 列配置
 * @param isHead 是否为表头单元格
 * @returns 对齐类名
 */
const alignClass = (col: TableColumn<T>, isHead: boolean): string => {
  if (col.align === 'right') return isHead ? 'text-right' : 'text-right';
  if (col.align === 'center') return 'text-center';
  return '';
};
</script>

<template>
  <div :class="scrollClass ?? 'table-scroll'" @scroll="emit('scroll', $event)">
    <table class="w-full text-sm tabular-nums" :style="minWidth ? { minWidth } : undefined">
      <thead>
        <tr class="border-b border-flat-weak text-left text-xs text-text-tertiary">
          <th
            v-for="col in columns"
            :key="col.key"
            class="py-2 pr-2 font-medium last:pr-0"
            :class="[alignClass(col, true), col.sortable ? 'cursor-pointer select-none hover:text-text' : '']"
            @click="toggleSort(col)"
          >
            {{ col.label }}
            <span v-if="sortMark(col)" class="ml-0.5 inline-block text-[10px]">{{ sortMark(col) }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in sortedRows"
          :key="rowKey(row)"
          :data-row-key="rowKey(row)"
          class="border-b border-flat-weak last:border-0"
          :class="rowClickable ? 'cursor-pointer hover:bg-flat-weak/50' : ''"
          @click="emit('rowClick', row)"
        >
          <td
            v-for="col in columns"
            :key="col.key"
            class="py-2 pr-2 last:pr-0"
            :class="alignClass(col, false)"
          >
            <slot :name="col.key" :row="row">{{ cellValue(row, col.key) }}</slot>
          </td>
        </tr>
        <tr v-if="footerText">
          <td :colspan="columns.length" class="py-2 text-center text-xs text-text-tertiary">
            {{ footerText }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
