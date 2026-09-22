<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import {
  countAllCategories,
  exportDataPort,
  isDataPortAvailable,
  pickExportPath,
} from '../../api/data-port.api';
import { DATA_PORT_MANIFEST } from '../../constants/data-port.constants';
import { formatBytes } from '../../utils/format-bytes';

/**
 * 数据导出弹窗（设置页「数据迁移」卡片的「导出」按钮触发）
 *
 * 按 DATA_PORT_MANIFEST 逐类别列出 checkbox（含当前行数 / 数据量与勾选提示），
 * 确认后弹系统「另存为」选路径，序列化为单个 JSON 文件（格式见 types/data-port.types.ts）。
 * 勾选草稿只在本次打开内生效，关闭重开恢复默认勾选（defaultEnabled）。
 */

const open = defineModel<boolean>('open', { required: true });

/** 桌面端才有 SQLite 数据源，浏览器端禁用导出 */
const available = isDataPortAvailable();

/** 类别 id → 计数表（sqlite 表行数 / localStorage 命名空间字符长度） */
const counts = ref<Record<string, Record<string, number>>>({});

/** 计数加载中 */
const loading = ref(false);

/** 勾选草稿（类别 id 列表） */
const checkedIds = ref<string[]>([]);

/** 导出执行中 */
const exporting = ref(false);

/** 失败提示 */
const errorText = ref('');

/** 成功提示（含路径与体积） */
const successText = ref('');

/** 有可导出数据（至少勾一项且对应类别计数非全 0） */
const canExport = computed(() => checkedIds.value.length > 0 && !loading.value);

/** 展示用的类别列表（manifest 顺序 + 计数） */
const rows = computed(() =>
  DATA_PORT_MANIFEST.map((category) => {
    const categoryCounts = counts.value[category.id] ?? {};
    const total = Object.values(categoryCounts).reduce((sum, n) => sum + n, 0);
    return { category, total, empty: total === 0 };
  }),
);

// 打开时播种默认勾选并拉计数；关闭时清状态，避免下次打开闪旧数据
watch(open, async (isOpen) => {
  if (!isOpen) {
    successText.value = '';
    errorText.value = '';
    return;
  }
  successText.value = '';
  errorText.value = '';
  checkedIds.value = DATA_PORT_MANIFEST.filter((c) => c.defaultEnabled).map((c) => c.id);
  loading.value = true;
  counts.value = {};
  try {
    counts.value = await countAllCategories();
  } finally {
    loading.value = false;
  }
});

/** 全选（仅本弹窗草稿，不影响任何持久化状态） */
const onSelectAll = (): void => {
  checkedIds.value = DATA_PORT_MANIFEST.map((c) => c.id);
};

/** 全不选 */
const onSelectNone = (): void => {
  checkedIds.value = [];
};

/**
 * 提取异常文案
 * @param error 未知异常
 * @returns 可展示文案
 */
const toErrorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 执行导出：选路径 → 序列化写文件 */
const onExport = async (): Promise<void> => {
  errorText.value = '';
  successText.value = '';
  const path = await pickExportPath();
  if (path === null) return;
  exporting.value = true;
  try {
    const size = await exportDataPort(path, checkedIds.value);
    successText.value = `已导出到 ${path}（${formatBytes(size)}）`;
  } catch (error) {
    errorText.value = `导出失败：${toErrorText(error)}`;
  } finally {
    exporting.value = false;
  }
};
</script>

<template>
  <BaseModal
    v-model:open="open"
    title="导出数据"
    max-width-class="max-w-lg"
  >
    <p class="mb-3 text-xs text-text-tertiary">
      勾选要导出的本地数据，确认后选择保存位置，生成单个 JSON 文件（可在另一台电脑的「数据导入」中恢复）
    </p>
    <div class="space-y-1">
      <label
        v-for="row in rows"
        :key="row.category.id"
        class="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-flat-weak"
      >
        <input
          v-model="checkedIds"
          type="checkbox"
          :value="row.category.id"
          class="accent-primary mt-0.5"
          :aria-label="`导出${row.category.label}`"
        />
        <span class="min-w-0">
          <span class="flex items-baseline gap-2">
            <span class="text-sm text-text">{{ row.category.label }}</span>
            <span class="shrink-0 text-xs text-text-tertiary tabular-nums">
              <template v-if="loading">统计中…</template>
              <template v-else-if="row.category.storage === 'sqlite'">{{ row.total }} 条</template>
              <template v-else>{{ row.empty ? '空' : formatBytes(row.total) }}</template>
            </span>
          </span>
          <span
            v-if="row.category.tip"
            class="mt-0.5 block text-xs leading-4 text-text-tertiary"
          >
            {{ row.category.tip }}
          </span>
        </span>
      </label>
    </div>
    <p
      v-if="errorText"
      class="mt-3 text-xs text-up"
    >
      {{ errorText }}
    </p>
    <p
      v-if="successText"
      class="mt-3 break-all text-xs text-primary"
    >
      {{ successText }}
    </p>
    <template #footer>
      <div class="flex flex-1 items-center gap-2">
        <BaseButton
          variant="ghost"
          :disabled="loading || exporting"
          @click="onSelectAll"
        >
          全选
        </BaseButton>
        <BaseButton
          variant="ghost"
          :disabled="loading || exporting"
          @click="onSelectNone"
        >
          全不选
        </BaseButton>
      </div>
      <BaseButton
        variant="primary"
        data-track="DATA_EXPORT_CONFIRM"
        :disabled="!available || !canExport"
        @click="onExport"
      >
        {{ exporting ? '导出中…' : '导出' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
