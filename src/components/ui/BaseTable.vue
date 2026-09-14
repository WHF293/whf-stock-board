<script setup lang="ts" generic="T">
import { computed, ref } from 'vue';
import MenuIcon from './MenuIcon.vue';
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
  /**
   * 行扩展：开启后每行行首自动追加一列展开 icon（chevron），
   * **仅点击该 icon** 切换扩展行（内容由 #expanded 作用域插槽提供）；
   * 行其他位置的点击走 rowClick，不承担展开职责。默认关闭
   */
  expandable?: boolean;
  /** 当前已展开的行 key 列表（受控模式，父级维护） */
  expandedKeys?: string[];
  /**
   * 双击导航模式：开启后 rowClick 延迟派发（单击/双击合并），
   * 双击取消未派发的 click 并直接 emit rowDblclick；默认关闭不拖累单击手感
   */
  enableDblclickNav?: boolean;
}>();

const emit = defineEmits<{
  /** 行点击 */
  rowClick: [row: T];
  /** 行双击（仅 enableDblclickNav 开启时派发） */
  rowDblclick: [row: T];
  /** 容器滚动（透传给外部懒加载逻辑） */
  scroll: [event: Event];
  /** 展开图标点击（切换扩展行；父级维护 expandedKeys） */
  toggleExpand: [row: T];
}>();

/** 单击延迟派发定时器（双击合并窗口；null = 无待派发单击） */
const pendingClick = ref<{ timer: number; row: T } | null>(null);

/** 单击/双击合并窗口（毫秒） */
const DBLCLICK_MERGE_MS = 250;

/**
 * 行单击：开启双击导航时延迟派发，窗口内收到双击则取消
 * @param row 行数据
 */
const onRowClick = (row: T): void => {
  if (!props.enableDblclickNav) {
    emit('rowClick', row);
    return;
  }
  if (pendingClick.value) {
    window.clearTimeout(pendingClick.value.timer);
  }
  const timer = window.setTimeout(() => {
    pendingClick.value = null;
    emit('rowClick', row);
  }, DBLCLICK_MERGE_MS);
  pendingClick.value = { timer, row };
};

/**
 * 行双击：取消未派发的单击，直接派发双击
 * @param row 行数据
 */
const onRowDblclick = (row: T): void => {
  if (!props.enableDblclickNav) return;
  if (pendingClick.value) {
    window.clearTimeout(pendingClick.value.timer);
    pendingClick.value = null;
  }
  emit('rowDblclick', row);
};

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
 * 行是否处于展开态
 * @param row 行数据
 * @returns 是否展开
 */
const isExpanded = (row: T): boolean =>
  !!props.expandable && (props.expandedKeys ?? []).includes(props.rowKey(row));

/** 扩展行的横跨列数（业务列 + 展开列） */
const spanCols = computed(() => props.columns.length + (props.expandable ? 1 : 0));

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
          <th v-if="expandable" class="w-8" />
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
        <template v-for="(row, index) in sortedRows" :key="rowKey(row)">
          <tr
            :data-row-key="rowKey(row)"
            class="border-b border-flat-weak last:border-0"
            :class="[
              index % 2 === 1 ? 'bg-flat-weak/35' : '',
              rowClickable ? 'cursor-pointer hover:bg-flat-weak/50' : '',
            ]"
            @click="onRowClick(row)"
            @dblclick="onRowDblclick(row)"
          >
            <td v-if="expandable" class="w-8 py-2 pl-1">
              <button
                type="button"
                class="pressable rounded p-0.5 text-text-tertiary hover:bg-flat-weak hover:text-text"
                :aria-label="isExpanded(row) ? '收起扩展行' : '展开扩展行'"
                @click.stop="emit('toggleExpand', row)"
              >
                <MenuIcon :name="isExpanded(row) ? 'chevronDown' : 'chevronRight'" :size="14" />
              </button>
            </td>
            <td
              v-for="col in columns"
              :key="col.key"
              class="py-2 pr-2 last:pr-0"
              :class="alignClass(col, false)"
            >
              <slot :name="col.key" :row="row">{{ cellValue(row, col.key) }}</slot>
            </td>
          </tr>
          <!-- 扩展行：内容由 #expanded 作用域插槽提供 -->
          <tr v-if="isExpanded(row)">
            <td :colspan="spanCols" class="bg-flat-weak/20 px-10 py-5">
              <slot name="expanded" :row="row" />
            </td>
          </tr>
        </template>
        <tr v-if="footerText">
          <td :colspan="spanCols" class="py-2 text-center text-xs text-text-tertiary">
            {{ footerText }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
