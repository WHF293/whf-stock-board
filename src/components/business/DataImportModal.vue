<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseConfirmModal from '../ui/BaseConfirmModal.vue';
import {
  importDataPort,
  isDataPortAvailable,
  pickAndParseImportFile,
  summarizeImportFile,
} from '../../api/data-port.api';
import { DATA_PORT_MANIFEST } from '../../constants/data-port.constants';
import { formatBytes } from '../../utils/format-bytes';
import type { DataPortFile } from '../../types/data-port.types';

/**
 * 数据导入弹窗（设置页「数据迁移」卡片的「导入」按钮触发）
 *
 * 三步：选导出文件 → 勾选要恢复的类别（仅文件中实际包含的）→ 二级确认后覆盖写入。
 * 导入前自动备份涉及的 SQLite 库（appDataDir/backups），完成后整页 reload 重新水合。
 */

const open = defineModel<boolean>('open', { required: true });

/** 桌面端才有 SQLite 数据源，浏览器端禁用导入 */
const available = isDataPortAvailable();

/** 解析后的导出文件（null = 尚未选择） */
const file = ref<DataPortFile | null>(null);

/** 文件里实际包含的类别计数（类别 id → 计数表） */
const fileCounts = ref<Record<string, Record<string, number>>>({});

/** 选中文件后解析 / 预览中 */
const parsing = ref(false);

/** 导入执行中 */
const importing = ref(false);

/** 二级确认弹窗 */
const confirmOpen = ref(false);

/** 失败提示 */
const errorText = ref('');

/** 文件里存在但当前版本不识别、将被跳过的类别数 */
const skippedCount = ref(0);

/** 可勾选类别（manifest 顺序 ∩ 文件包含） */
const rows = computed(() =>
  DATA_PORT_MANIFEST.filter((c) => fileCounts.value[c.id] !== undefined).map((category) => {
    const counts = fileCounts.value[category.id] ?? {};
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return { category, total, empty: total === 0 };
  }),
);

/** 勾选草稿（类别 id 列表） */
const checkedIds = ref<string[]>([]);

/** 是否可执行导入 */
const canImport = computed(() => file.value !== null && checkedIds.value.length > 0);

// 打开时重置全部状态；关闭时同样清空，避免下次打开闪旧数据
watch(open, (isOpen) => {
  if (!isOpen) return;
  file.value = null;
  fileCounts.value = {};
  checkedIds.value = [];
  errorText.value = '';
  skippedCount.value = 0;
  confirmOpen.value = false;
});

/** 选择并解析导出文件 */
const onSelectFile = async (): Promise<void> => {
  errorText.value = '';
  file.value = null;
  fileCounts.value = {};
  parsing.value = true;
  try {
    const parsed = await pickAndParseImportFile();
    if (parsed === null) return;
    file.value = parsed;
    fileCounts.value = summarizeImportFile(parsed);
    checkedIds.value = DATA_PORT_MANIFEST.filter(
      (c) => c.defaultEnabled && fileCounts.value[c.id] !== undefined,
    ).map((c) => c.id);
    skippedCount.value = parsed.categories.filter(
      (c) => !DATA_PORT_MANIFEST.some((m) => m.id === c.id),
    ).length;
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error);
  } finally {
    parsing.value = false;
  }
};

/** 全选（仅本弹窗草稿） */
const onSelectAll = (): void => {
  checkedIds.value = rows.value.map((r) => r.category.id);
};

/** 全不选 */
const onSelectNone = (): void => {
  checkedIds.value = [];
};

/** 点「导入」→ 先开二级确认（真正写入在确认回调） */
const onRequestImport = (): void => {
  errorText.value = '';
  confirmOpen.value = true;
};

/**
 * 提取异常文案
 * @param error 未知异常
 * @returns 可展示文案
 */
const toErrorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 二级确认通过：执行覆盖写入，完成后整页 reload 重新水合 */
const onConfirmImport = async (): Promise<void> => {
  if (file.value === null) return;
  importing.value = true;
  try {
    await importDataPort(file.value, checkedIds.value);
    errorText.value = '';
    // 不做内存热同步（方案 §8）：整页重载让所有 store / 插件从新数据重新水合
    window.setTimeout(() => window.location.reload(), 600);
  } catch (error) {
    errorText.value = `导入失败：${toErrorText(error)}`;
    importing.value = false;
  }
};

/** 展示的导出时间（本地时区短格式） */
const exportedAtText = computed(() => {
  if (file.value === null) return '';
  const date = new Date(file.value.exportedAt);
  return Number.isNaN(date.getTime()) ? file.value.exportedAt : date.toLocaleString();
});

/** 文件体积估算（JSON 字符串按 UTF-16 计，仅展示量级） */
const fileSizeText = computed(() => {
  if (file.value === null) return '';
  return formatBytes(JSON.stringify(file.value).length);
});
</script>

<template>
  <BaseModal
    v-model:open="open"
    title="导入数据"
    max-width-class="max-w-lg"
  >
    <!-- 第一步：选择文件 -->
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0">
        <p class="text-sm text-text">选择导出文件</p>
        <p class="mt-0.5 text-xs text-text-tertiary">
          由本应用「数据导出」生成的 JSON 文件
        </p>
      </div>
      <BaseButton
        variant="ghost"
        data-track="DATA_IMPORT_OPEN"
        :disabled="!available || parsing || importing"
        @click="onSelectFile"
      >
        {{ parsing ? '解析中…' : file ? '重新选择' : '选择文件' }}
      </BaseButton>
    </div>

    <!-- 第二步：文件预览 + 勾选恢复类别 -->
    <template v-if="file">
      <div class="mt-4 rounded-lg bg-flat-weak px-3 py-2 text-xs text-text-tertiary">
        <p>
          来自 v{{ file.appVersion }} · 导出于 {{ exportedAtText }} · 约 {{ fileSizeText }}
        </p>
        <p
          v-if="skippedCount > 0"
          class="mt-1 text-up"
        >
          文件含 {{ skippedCount }} 类当前版本无法识别的数据，导入时将跳过
        </p>
      </div>
      <p class="mt-4 mb-2 text-xs text-text-tertiary">
        勾选要恢复的数据（仅列出文件中实际包含的类别）
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
            :aria-label="`导入${row.category.label}`"
          />
          <span class="min-w-0">
            <span class="flex items-baseline gap-2">
              <span class="text-sm text-text">{{ row.category.label }}</span>
              <span class="shrink-0 text-xs text-text-tertiary tabular-nums">
                <template v-if="row.category.storage === 'sqlite'">{{ row.total }} 条</template>
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
    </template>

    <p
      v-if="errorText"
      class="mt-3 text-xs text-up"
    >
      {{ errorText }}
    </p>

    <template #footer>
      <div class="flex flex-1 items-center gap-2">
        <BaseButton
          variant="ghost"
          :disabled="!file || parsing || importing"
          @click="onSelectAll"
        >
          全选
        </BaseButton>
        <BaseButton
          variant="ghost"
          :disabled="!file || parsing || importing"
          @click="onSelectNone"
        >
          全不选
        </BaseButton>
      </div>
      <BaseButton
        variant="primary"
        data-track="DATA_IMPORT_CONFIRM"
        :disabled="!canImport || parsing || importing"
        @click="onRequestImport"
      >
        {{ importing ? '导入中…' : '导入' }}
      </BaseButton>
    </template>
  </BaseModal>

  <!-- 二级确认：覆盖提示（危险操作，红色确认按钮） -->
  <BaseConfirmModal
    v-model:open="confirmOpen"
    title="确认导入"
    ok-text="确认覆盖"
    cancel-text="取消"
    ok-variant="danger"
    @ok="onConfirmImport"
  >
    <p class="text-sm text-text">
      将用导出文件中的数据<strong>覆盖</strong>当前电脑勾选的类别（未勾选的不受影响）。
    </p>
    <p class="mt-2 text-xs text-text-tertiary">
      导入前会自动备份涉及的本地数据库（保留最近 3 份）；导入完成后应用会自动刷新。
    </p>
  </BaseConfirmModal>
</template>
