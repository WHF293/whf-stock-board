<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseTooltip from '../components/ui/BaseTooltip.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import CreateAccountModal from '../components/account/CreateAccountModal.vue';
import ImportTradeModal from '../components/account/ImportTradeModal.vue';
import { DEFAULT_ACCOUNT_ID } from '../constants/account.constants';
import { useStockAccountStore } from '../stores/stock-account';
import type { TradeImportPayload } from '../types/account.types';

/**
 * 股票账户（含交割单导入入口，合并原独立交割单页）
 *
 * 顶部账户 tab 条对照设计稿：active 主题色文字 + 下划线（primary token，
 * 跟随系统主题设置，不硬编码颜色）；
 * 右侧控制区：账户下拉 / 列表视图占位 / 交割单导入 / + 添加。
 * 内容区为占位骨架：持仓/盈亏待交割单解析入库（字段待定）后实现。
 */
const accountStore = useStockAccountStore();

/** 当前激活账户 id */
const activeAccountId = ref<string>(DEFAULT_ACCOUNT_ID);

/** 激活账户（容错回退到首个账户） */
const activeAccount = computed(
  () =>
    accountStore.accounts.find((account) => account.id === activeAccountId.value) ??
    accountStore.accounts[0],
);

// 账户被删除后回退到默认账户
watch(
  () => accountStore.accounts.length,
  () => {
    if (
      !accountStore.accounts.some(
        (account) => account.id === activeAccountId.value,
      )
    ) {
      activeAccountId.value = DEFAULT_ACCOUNT_ID;
    }
  },
);

/** 账户下拉开关（▼ 快速切换，tab 溢出时的兜底入口） */
const dropdownOpen = ref(false);

/** 下拉根元素（点击外部关闭） */
const dropdownRef = ref<HTMLElement | null>(null);

/** 全局点击关闭下拉
 * @param event 鼠标事件
 */
const onGlobalClick = (event: MouseEvent): void => {
  if (
    dropdownOpen.value &&
    dropdownRef.value &&
    !dropdownRef.value.contains(event.target as Node)
  ) {
    dropdownOpen.value = false;
  }
};

onMounted(() => document.addEventListener('click', onGlobalClick));
onBeforeUnmount(() => document.removeEventListener('click', onGlobalClick));

/** 创建账户弹窗开关 */
const createModalOpen = ref(false);

/** 创建成功后激活新账户 tab
 * @param accountId 新账户 id
 */
const onAccountCreated = (accountId: string): void => {
  activeAccountId.value = accountId;
};

/** 交割单导入弹窗开关 */
const importModalOpen = ref(false);

/** 导入提示横幅文案（空 = 不展示，数秒后自动消失） */
const importHint = ref('');

/** 导入提示定时器句柄 */
let importHintTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 交割单导入确认回调（解析入库字段待定，本版仅提示）
 * TODO: 解析文件 → 生成成交记录 → 入库 SQLite（tauri-plugin-sql）
 *       表结构对齐《交割单与股票账户模块规划》待定稿
 * @param payload 导入载荷（账户 + 文件信息）
 */
const onTradeImportConfirm = (payload: TradeImportPayload): void => {
  importHint.value = `已接收「${payload.fileName}」，解析入库字段待定，导入功能即将实现`;
  if (importHintTimer) {
    clearTimeout(importHintTimer);
  }
  importHintTimer = setTimeout(() => {
    importHint.value = '';
  }, 4000);
};
</script>

<template>
  <div class="space-y-4">
    <!-- 账户 tab 条（对照截图：tab + 右侧控制区） -->
    <div class="flex items-end border-b border-flat-weak">
      <!-- 左侧：账户 tab（active 主题色字 + 下划线，溢出横向滚动） -->
      <div
        class="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]"
      >
        <div class="flex" role="tablist" aria-label="账户管理">
          <button
            v-for="account in accountStore.accounts"
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
      <div
        ref="dropdownRef"
        class="relative flex shrink-0 items-center gap-1.5 px-2 pb-1.5"
      >
        <!-- ▼ 账户全量下拉（tab 溢出时快速切换） -->
        <button
          type="button"
          class="pressable rounded-md p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
          aria-label="全部账户"
          @click="dropdownOpen = !dropdownOpen"
        >
          <MenuIcon name="chevronDown" :size="16" />
        </button>
        <div
          v-if="dropdownOpen"
          class="absolute right-2 top-full z-20 mt-1 min-w-36 rounded-lg border border-flat-weak bg-surface py-1 shadow-lg"
        >
          <button
            v-for="account in accountStore.accounts"
            :key="account.id"
            type="button"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-flat-weak"
            :class="
              account.id === activeAccountId
                ? 'text-primary'
                : 'text-text-secondary'
            "
            @click="
              activeAccountId = account.id;
              dropdownOpen = false;
            "
          >
            <span class="truncate">{{ account.name }}</span>
          </button>
        </div>

        <!-- ☰ 列表视图（占位：账户管理入口，待实现） -->
        <span class="relative group">
          <BaseTooltip text="账户列表管理（开发中）" />
          <button
            type="button"
            disabled
            class="rounded-md p-1.5 text-text-tertiary opacity-50"
            aria-label="账户列表管理（开发中）"
          >
            <MenuIcon name="menu" :size="16" />
          </button>
        </span>

        <!-- 交割单导入（合并原独立页面入口） -->
        <BaseButton variant="ghost" @click="importModalOpen = true">
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

    <!-- 内容区（占位骨架：持仓/盈亏待交割单数据就绪后实现） -->
    <BaseCard :title="`账户-${activeAccount?.name ?? ''}`">
      <template #extra>
        <button
          v-if="activeAccount?.id !== DEFAULT_ACCOUNT_ID"
          type="button"
          class="pressable shrink-0 rounded-md p-1.5 text-text-tertiary hover:bg-up-weak hover:text-up active:scale-90"
          :aria-label="`删除账户 ${activeAccount?.name}`"
          @click="accountStore.removeAccount(activeAccount!.id)"
        >
          <MenuIcon name="trash" :size="14" />
        </button>
      </template>
      <BaseEmpty
        text="暂无账户数据：点击「交割单导入」上传券商交割单，或等待手工记账上线"
      />
      <div
        class="grid grid-cols-2 gap-3 px-1 pb-1 sm:grid-cols-4"
        aria-hidden="true"
      >
        <div
          v-for="metric in ['总资产', '持仓市值', '浮动盈亏', '当日盈亏']"
          :key="metric"
        >
          <div class="rounded-xl border border-flat-weak px-4 py-3">
            <p class="text-xs text-text-tertiary">{{ metric }}</p>
            <p class="mt-1 text-lg font-medium text-text-tertiary">--</p>
          </div>
        </div>
      </div>
    </BaseCard>

    <!-- 创建手工账户弹窗 -->
    <CreateAccountModal
      v-model:open="createModalOpen"
      @created="onAccountCreated"
    />

    <!-- 交割单导入弹窗 -->
    <ImportTradeModal
      v-model:open="importModalOpen"
      :default-account-id="activeAccountId"
      @confirm="onTradeImportConfirm"
    />
  </div>
</template>
