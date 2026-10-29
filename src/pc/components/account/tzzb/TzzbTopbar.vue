<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import BaseButton from '../../ui/BaseButton.vue';
import MenuIcon from '../../ui/MenuIcon.vue';
import type { TzzbAccount, TzzbAccountKind, TzzbSyncMeta } from '../../../../common/types/tzzb.types.ts';

/**
 * 投资账本顶栏：账户选择器（分组下拉）+ 同步状态 + 同步按钮
 *
 * 账户分组：汇总（全部账户）/ 券商（stock）/ 两融（rzrq）/ 手工记账（manual）/ 基金（fund）；
 * mock 阶段切换账户仅更新选中态（采样数据只覆盖 whf-东北），正式接入后切换重拉各模块
 */
const props = defineProps<{
  /** 账户列表（股票类在前） */
  accounts: TzzbAccount[];
  /** 当前选中账户 id；'' = 全部账户 */
  selectedId: string;
  /** 同步状态 */
  syncMeta: TzzbSyncMeta | null;
  /** 同步中 */
  syncing?: boolean;
}>();

const emit = defineEmits<{
  /** 选中账户变化（'' = 全部账户） */
  select: [accountId: string];
  /** 点击同步 */
  sync: [];
}>();

/** 下拉开关 */
const menuOpen = ref(false);

/** 同步设置菜单开关（☰） */
const settingsOpen = ref(false);

/** 同步设置菜单项（mock 阶段占位，正式接入后开放配置） */
const SETTINGS_ITEMS = [
  { key: 'auto', label: '自动增量同步', desc: '每日收盘后按水位增量拉取' },
  { key: 'reauth', label: '重新授权', desc: '授权到期后重新走 OAuth 流程' },
  { key: 'exclude', label: '排除账户', desc: '选择不参与同步的账户' },
] as const;

/** 账户类型 → 分组标题 */
const GROUP_LABEL: Record<TzzbAccountKind, string> = {
  stock: '券商账户',
  rzrq: '两融账户',
  manual: '手工记账',
  fund: '基金账户',
};

/** 分组顺序（rzrq 无账户时隐藏该组） */
const GROUP_ORDER: readonly TzzbAccountKind[] = ['stock', 'rzrq', 'manual', 'fund'];

/** 分组后的账户（保序） */
const groups = computed(() =>
  GROUP_ORDER.map((kind) => ({
    kind,
    label: GROUP_LABEL[kind],
    list: props.accounts.filter((a) => a.kind === kind),
  })).filter((g) => g.list.length > 0),
);

/** 选中账户（'' = 全部） */
const selected = computed(
  () => props.accounts.find((a) => a.id === props.selectedId) ?? null,
);

/**
 * 选中账户
 * @param account 账户（null = 全部账户）
 */
const pick = (account: TzzbAccount | null): void => {
  menuOpen.value = false;
  emit('select', account?.id ?? '');
};

/**
 * 点击外部关闭两个下拉
 * @param e 文档点击事件
 */
const onOutside = (e: MouseEvent): void => {
  const target = e.target as HTMLElement;
  if (!target.closest('[data-tzzb-picker]')) menuOpen.value = false;
  if (!target.closest('[data-tzzb-settings]')) settingsOpen.value = false;
};
onMounted(() => document.addEventListener('click', onOutside));
onBeforeUnmount(() => document.removeEventListener('click', onOutside));
</script>

<template>
  <div class="flex shrink-0 items-center gap-3">
    <!-- 账户选择器 -->
    <div data-tzzb-picker class="relative">
      <button
        type="button"
        class="pressable flex items-center gap-2 rounded-lg bg-flat-weak px-3 py-1.5 text-sm active:scale-[0.98]"
        aria-haspopup="listbox"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <span class="h-2 w-2 rounded-full bg-primary" />
        <span class="font-medium text-text">{{ selected?.name ?? '全部账户' }}</span>
        <span class="text-xs text-text-tertiary">
          {{ selected ? GROUP_LABEL[selected.kind] : '股票 + 基金' }}
        </span>
        <MenuIcon
          name="chevronDown"
          :size="14"
          class="text-text-tertiary transition-transform"
          :class="menuOpen ? 'rotate-180' : ''"
        />
      </button>

      <!-- 分组下拉 -->
      <div
        v-if="menuOpen"
        class="absolute left-0 top-[calc(100%+6px)] z-30 max-h-96 w-72 overflow-y-auto rounded-xl bg-surface p-1.5 shadow-island"
        role="listbox"
      >
        <button
          type="button"
          role="option"
          :aria-selected="selectedId === ''"
          class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm hover:bg-flat-weak"
          :class="selectedId === '' ? 'bg-primary-weak font-medium text-primary' : 'text-text'"
          @click="pick(null)"
        >
          <span>全部账户（股票 + 基金）</span>
          <span class="font-mono text-xs text-text-tertiary">{{ accounts.length }} 个</span>
        </button>
        <template v-for="group in groups" :key="group.kind">
          <p class="px-2.5 pb-0.5 pt-2 text-xs text-text-tertiary">{{ group.label }}</p>
          <button
            v-for="account in group.list"
            :key="account.id"
            type="button"
            role="option"
            :aria-selected="selectedId === account.id"
            class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm hover:bg-flat-weak"
            :class="
              selectedId === account.id
                ? 'bg-primary-weak font-medium text-primary'
                : 'text-text'
            "
            @click="pick(account)"
          >
            <span class="truncate">{{ account.name }}</span>
            <span class="font-mono text-xs text-text-tertiary">{{ account.id }}</span>
          </button>
        </template>
      </div>
    </div>

    <div class="flex-1" />

    <!-- 同步状态 -->
    <div class="text-right leading-5">
      <p class="text-xs text-text-secondary">
        上次同步 <b class="font-semibold text-text">{{ syncMeta?.lastSyncLabel ?? '—' }}</b>
      </p>
      <p class="text-xs text-text-tertiary">{{ syncMeta?.authExpireLabel ?? '' }}</p>
    </div>

    <BaseButton :disabled="syncing" @click="emit('sync')">
      <MenuIcon name="plug" :size="14" />
      {{ syncing ? '同步中…' : '同步投资账本' }}
    </BaseButton>
    <!-- 同步设置菜单（☰） -->
    <div data-tzzb-settings class="relative">
      <button
        type="button"
        class="pressable rounded-md p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
        :class="settingsOpen ? 'bg-flat-weak text-text' : ''"
        aria-label="同步设置"
        title="同步设置（自动增量 / 重新授权 / 排除账户）"
        @click="settingsOpen = !settingsOpen"
      >
        <MenuIcon name="settings" :size="16" />
      </button>
      <div
        v-if="settingsOpen"
        class="absolute right-0 top-[calc(100%+6px)] z-30 w-64 rounded-xl bg-surface p-1.5 shadow-island"
      >
        <button
          v-for="item in SETTINGS_ITEMS"
          :key="item.key"
          type="button"
          class="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-flat-weak"
          @click="settingsOpen = false"
        >
          <p class="text-sm text-text">{{ item.label }}</p>
          <p class="text-xs text-text-tertiary">{{ item.desc }}</p>
        </button>
        <p class="border-t border-dashed border-flat-weak px-2.5 pb-0.5 pt-2 text-xs text-text-tertiary">
          mock 阶段占位 · 正式接入后开放配置
        </p>
      </div>
    </div>
  </div>
</template>
