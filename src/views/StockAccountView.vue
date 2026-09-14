<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseTooltip from '../components/ui/BaseTooltip.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import NoticeBar from '../components/ui/NoticeBar.vue';
import CreateAccountModal from '../components/account/CreateAccountModal.vue';
import ImportTradeModal from '../components/account/ImportTradeModal.vue';
import ManageAccountModal from '../components/account/ManageAccountModal.vue';
import AccountRecordsPanel from '../components/account/AccountRecordsPanel.vue';
import BaseConfirmModal from '../components/ui/BaseConfirmModal.vue';
import {
  deleteTradeRecordsByAccount,
  insertTradeRecords,
} from '../api/account-records-db.api';
import { parseThfTradeFile } from '../utils/thf-import';
import { useStockAccountStore } from '../stores/stock-account';
import type { TradeImportPayload } from '../types/account.types';

/**
 * 股票账户（交割单 / 对账单导入入口）
 *
 * 顶部账户 tab 条：active 主题色文字 + 下划线；不预置默认账户——
 * 用户不创建账户就没有账户（内容区展示引导空态）。
 * 右侧控制区：☰ 账户管理（显隐 + 排序）/ 对账单导入 / 交割单导入 / + 添加。
 * 页面顶部 NoticeBar 提示：仅支持同花顺导出的对账单与交割单。
 */
const accountStore = useStockAccountStore();

/** 当前激活账户 id（空 = 无账户或未选择） */
const activeAccountId = ref<string>('');

/** tab 条展示的账户（显隐 + 排序后） */
const visibleAccounts = computed(() => accountStore.visibleAccounts);

/** 激活账户（容错回退到首个可见账户） */
const activeAccount = computed(
  () =>
    accountStore.accounts.find((account) => account.id === activeAccountId.value) ??
    visibleAccounts.value[0] ??
    accountStore.accounts[0],
);

// 激活账户被删除 / 尚未选择时回退到首个可见账户
watch(
  [() => accountStore.accounts.length, visibleAccounts],
  () => {
    if (
      activeAccountId.value &&
      accountStore.accounts.some((account) => account.id === activeAccountId.value)
    ) {
      return;
    }
    activeAccountId.value = visibleAccounts.value[0]?.id ?? '';
  },
  { immediate: true },
);

/** 创建账户弹窗开关 */
const createModalOpen = ref(false);

/** 创建成功后激活新账户 tab
 * @param accountId 新账户 id
 */
const onAccountCreated = (accountId: string): void => {
  activeAccountId.value = accountId;
};

/** 导入弹窗开关 */
const importModalOpen = ref(false);

/** 导入类型：trade 交割单 / statement 对账单 */
const importKind = ref<'trade' | 'statement'>('trade');

/** 账户管理弹窗开关（☰） */
const manageModalOpen = ref(false);

/** 删除账户二次确认弹窗 */
const deleteConfirmOpen = ref(false);

/** 确认删除：清账户档案 + 级联清两类流水 */
const onDeleteAccount = (): void => {
  if (!activeAccount.value) return;
  const accountId = activeAccount.value.id;
  accountStore.removeAccount(accountId);
  void deleteTradeRecordsByAccount(accountId);
  deleteConfirmOpen.value = false;
};

/** 导入提示横幅文案（空 = 不展示，数秒后自动消失） */
const importHint = ref('');

/** 导入提示定时器句柄 */
let importHintTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 导入确认回调：对账单写入 account_statement 表（期间/原文解析待实现，暂存空）；
 * 交割单解析入库字段待定（TODO: 解析文件 → 生成成交记录 → 入库 SQLite）
 * @param payload 导入载荷（账户 + 文件信息）
 */
const onTradeImportConfirm = async (payload: TradeImportPayload): Promise<void> => {
  try {
    // 解析同花顺 GBK TSV → 批量入库（dedupe_key 去重，重复导入不产生重复行）
    const records = await parseThfTradeFile(payload.file, payload.accountId);
    const inserted = await insertTradeRecords(records, payload.kind);
    const skipped = records.length - inserted;
    importHint.value =
      skipped > 0
        ? `${payload.kind === 'statement' ? '对账单' : '交割单'}「${payload.fileName}」解析 ${records.length} 条：新增 ${inserted} 条，跳过重复 ${skipped} 条`
        : `${payload.kind === 'statement' ? '对账单' : '交割单'}「${payload.fileName}」已导入 ${inserted} 条记录`;
  } catch (error) {
    importHint.value =
      error instanceof Error ? `导入失败：${error.message}` : '导入失败：文件解析异常';
  }
  if (importHintTimer) {
    clearTimeout(importHintTimer);
  }
  importHintTimer = setTimeout(() => {
    importHint.value = '';
  }, 6000);
};
</script>

<template>
  <div class="space-y-4">
    <NoticeBar text="当前仅支持导入同花顺导出的「对账单」与「交割单」文件（CSV / XLSX / XLS）" />

    <!-- 账户 tab 条（tab + 右侧控制区） -->
    <div class="flex items-end border-b border-flat-weak">
      <!-- 左侧：账户 tab（active 主题色字 + 下划线，溢出横向滚动） -->
      <div
        class="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]"
      >
        <div class="flex" role="tablist" aria-label="账户管理">
          <button
            v-for="account in visibleAccounts"
            :key="account.id"
            type="button"
            role="tab"
            :aria-selected="activeAccountId === account.id"
            class="-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors"
            :class="
              activeAccountId === account.id
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-text-secondary hover:text-text'
            "
            @click="activeAccountId = account.id"
          >
            {{ account.name }}
          </button>
        </div>
      </div>

      <!-- 右侧控制区 -->
      <div class="flex shrink-0 items-center gap-1.5 px-2 pb-1.5">
        <!-- ☰ 账户管理：勾选 tab 显隐 + 拖拽排序 -->
        <span class="relative group">
          <BaseTooltip text="账户管理（显示与排序）" />
          <button
            type="button"
            class="pressable rounded-md p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
            aria-label="账户管理"
            @click="manageModalOpen = true"
          >
            <MenuIcon name="menu" :size="16" />
          </button>
        </span>

        <!-- 对账单导入 -->
        <BaseButton
          variant="ghost"
          @click="
            importKind = 'statement';
            importModalOpen = true;
          "
        >
          <MenuIcon name="book" :size="14" />
          对账单导入
        </BaseButton>

        <!-- 交割单导入 -->
        <BaseButton
          variant="ghost"
          @click="
            importKind = 'trade';
            importModalOpen = true;
          "
        >
          <MenuIcon name="tradeImport" :size="14" />
          交割单导入
        </BaseButton>

        <!-- + 添加（创建手工账户，主色跟随系统主题） -->
        <BaseButton variant="primary" @click="createModalOpen = true">
          <MenuIcon name="plus" :size="14" />
          添加
        </BaseButton>
      </div>
    </div>

    <!-- 导入提示横幅（解析入库待实现期间的占位反馈） -->
    <p
      v-if="importHint"
      class="rounded-lg bg-primary-weak px-3 py-2 text-sm text-primary"
      role="status"
    >
      {{ importHint }}
    </p>

    <!-- 内容区：无账户时展示引导空态（不预置默认账户） -->
    <BaseCard v-if="!activeAccount">
      <BaseEmpty
        text="还没有账户：点击右上角「+ 添加」创建账户，或导入同花顺对账单 / 交割单开始使用"
      />
    </BaseCard>

    <!-- 内容区：成交流水（对账单/交割单切换 + 分组展示 + 导出） -->
    <BaseCard v-else :title="`账户-${activeAccount.name}`">
      <template #extra>
        <button
          type="button"
          class="pressable shrink-0 rounded-md p-1.5 text-text-tertiary hover:bg-up-weak hover:text-up active:scale-90"
          :aria-label="`删除账户 ${activeAccount.name}`"
          @click="deleteConfirmOpen = true"
        >
          <MenuIcon name="trash" :size="14" />
        </button>
      </template>
      <AccountRecordsPanel :account-id="activeAccount.id" />
    </BaseCard>

    <!-- 删除账户二次确认 -->
    <BaseConfirmModal
      :open="deleteConfirmOpen"
      title="删除账户"
      ok-text="确认删除"
      cancel-text="取消"
      ok-variant="danger"
      @ok="onDeleteAccount"
      @cancel="deleteConfirmOpen = false"
    >
      <p class="text-sm text-text">
        确认删除账户「{{ activeAccount?.name }}」？该账户下已导入的对账单 / 交割单流水将一并删除，且不可恢复。
      </p>
    </BaseConfirmModal>

    <!-- 创建手工账户弹窗 -->
    <CreateAccountModal
      v-model:open="createModalOpen"
      @created="onAccountCreated"
    />

    <!-- 交割单 / 对账单导入弹窗 -->
    <ImportTradeModal
      v-model:open="importModalOpen"
      :kind="importKind"
      :default-account-id="activeAccountId"
      @confirm="onTradeImportConfirm"
    />

    <!-- 账户管理弹窗（显隐 + 排序） -->
    <ManageAccountModal v-model:open="manageModalOpen" />
  </div>
</template>
