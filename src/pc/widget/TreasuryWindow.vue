<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDocumentThemeSync } from '../../common/composables/use-document-theme';
import { collapseTreasuryWindow } from '../../common/utils/treasury-window';
import {
  TREASURY_CUSTOM_RULES_MAX,
  TREASURY_DISCLAIMER,
  TREASURY_FLAT_LIST_TITLE,
  TREASURY_QUOTES,
  TREASURY_RULES,
  TREASURY_TIPS,
  type TreasuryRule,
} from '../../common/constants/treasury.constants.ts';
import { loadTreasuryCustomRules, saveTreasuryCustomRules } from '../../common/utils/treasury-custom-rules';

/**
 * 大A宝典独立窗口视图（treasury.html 轻量入口，2026-11-03 王总指定）
 *
 * - 逐句轮播职责在桌面横条（src/widget/TreasuryBar.vue）；本窗口 = 平铺清单 +
 *   免责底栏 + 自定义添加；
 * - **无分组**（2026-11-03 王总指定）：祖训 / 口诀 / 金句 / 我的祖训不再分节，
 *   合成一个连续编号的平铺清单，一行两条；我的祖训追加末尾（虚线编号 + 悬浮删除），
 *   appStorage 持久化（横条轮播每轮换句前重读，≤5s 自动跟上）；
 * - 标题栏为自绘（decorations:false 去系统三键），「收起」= hide 保活隐藏，
 *   横条 / 固钉点击秒回。
 *
 * 主题由 useDocumentThemeSync 落 <html>（独立 app 实例不经 MainLayout）。
 */

// 主题落 <html>（独立窗口的 App 层职责，见 WatchWidgetApp 同款注释）
useDocumentThemeSync();

/** 收起窗口：Tauri = hide 保活（横条点击秒回），浏览器 = 关小窗 */
const onCollapse = (): void => {
  void collapseTreasuryWindow();
};

/* ------------------------------ 我的祖训（增删 + 持久化） ------------------------------ */

/** 自定义祖训（挂载即读持久化；变更即写回） */
const customRules = ref<TreasuryRule[]>(loadTreasuryCustomRules());

/** 输入态：主句（必填）/ 补充说明（选填） */
const draftTitle = ref('');
const draftDesc = ref('');

/** 是否可添加：主句非空且未到上限 */
const canAdd = computed(
  () => draftTitle.value.trim() !== '' && customRules.value.length < TREASURY_CUSTOM_RULES_MAX,
);

/** 添加一条自定义祖训（写回持久化并清空输入） */
const onAdd = (): void => {
  const title = draftTitle.value.trim();
  if (title === '' || customRules.value.length >= TREASURY_CUSTOM_RULES_MAX) return;
  const desc = draftDesc.value.trim();
  customRules.value = [...customRules.value, desc === '' ? { title } : { title, desc }];
  saveTreasuryCustomRules(customRules.value);
  draftTitle.value = '';
  draftDesc.value = '';
};

/**
 * 删除一条自定义祖训（写回持久化）
 * @param index 待删条目下标
 */
const onRemove = (index: number): void => {
  customRules.value = customRules.value.filter((_, i) => i !== index);
  saveTreasuryCustomRules(customRules.value);
};

/* ------------------------------ 平铺清单（无分组，一行两条） ------------------------------ */

/** 平铺清单条目 */
interface FlatEntry {
  /** v-for key */
  key: string;
  /** 主句 */
  main: string;
  /** 次行说明（祖训补充 / 金句人物）；无则不渲染 */
  sub?: string;
  /** 是否我的祖训（虚线编号 + 悬浮删除） */
  custom?: boolean;
  /** 我的祖训条目在 customRules 中的下标（删除用） */
  customIndex?: number;
}

/**
 * 平铺清单：内置祖训 → 口诀 → 金句 → 我的祖训（追加末尾），连续编号
 * @returns 清单条目数组
 */
const flatEntries = computed<FlatEntry[]>(() => {
  const entries: FlatEntry[] = [];
  TREASURY_RULES.forEach((rule) => {
    entries.push({ key: `rule-${rule.title}`, main: rule.title, sub: rule.desc || undefined });
  });
  TREASURY_TIPS.forEach((tip) => {
    entries.push({ key: `tip-${tip}`, main: tip });
  });
  TREASURY_QUOTES.forEach((quote) => {
    entries.push({ key: `quote-${quote.name}`, main: `「${quote.text}」`, sub: `—— ${quote.name}` });
  });
  customRules.value.forEach((rule, i) => {
    entries.push({
      key: `custom-${i}-${rule.title}`,
      main: rule.title,
      sub: rule.desc || undefined,
      custom: true,
      customIndex: i,
    });
  });
  return entries;
});
</script>

<template>
  <!-- 窗口根：非透明窗口，整高 flex 列布局（标题栏、清单滚动、免责常驻） -->
  <div class="flex h-screen flex-col bg-surface">
    <!-- 自定义标题栏（decorations:false 去系统三键后的替代，AgentWindowTitlebar 同款交互）：
         data-tauri-drag-region 拖拽（按钮不带该属性不误触发）；右侧唯一「收起」键 =
         hide 保活隐藏（内容与草稿不丢），横条 / 固钉点击秒回 -->
    <header
      data-tauri-drag-region
      class="flex h-9 shrink-0 select-none items-center justify-between border-b border-flat-weak pl-4"
    >
      <div class="flex min-w-0 items-center gap-2" data-tauri-drag-region>
        <img
          src="/favicon.svg"
          alt="大A宝典"
          draggable="false"
          class="h-4 w-4 shrink-0 rounded"
        />
        <span class="truncate text-sm font-semibold text-text">大A宝典</span>
      </div>
      <button
        type="button"
        aria-label="收起"
        title="收起（横条 / 固钉点击可随时找回）"
        class="pressable flex h-full w-11 items-center justify-center text-text-secondary hover:bg-flat-weak hover:text-text"
        @click="onCollapse"
      >
        <!-- 收起：向下箭头（与主窗口抽屉收起同语义） -->
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 4.5L6 8l3.5-3.5"
            stroke="currentColor"
            stroke-width="1.2"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </header>

    <!-- 清单（随窗口滚动；无分组，连续编号，一行两条） -->
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <section>
        <h4 class="mb-3 flex items-center gap-2">
          <span class="h-3.5 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
          <span class="text-sm font-semibold text-text">{{ TREASURY_FLAT_LIST_TITLE }}</span>
          <span class="text-xs text-text-tertiary">
            {{ flatEntries.length }} 条 · 含我的祖训 {{ customRules.length }} 条 · 横条轮播全部条目
          </span>
        </h4>

        <!-- 添加行：主句必填 + 补充说明选填（Enter 快捷添加） -->
        <div class="mb-3 flex flex-col gap-1.5 rounded-lg bg-flat-weak/60 p-2.5">
          <div class="flex gap-1.5">
            <input
              v-model="draftTitle"
              type="text"
              maxlength="60"
              placeholder="输入你的祖训主句（必填）"
              class="min-w-0 flex-1 rounded-md border border-flat-weak bg-surface px-2.5 py-1.5 text-sm text-text outline-none placeholder:text-text-tertiary focus:border-primary"
              @keydown.enter="onAdd"
            />
            <button
              type="button"
              class="pressable pc-nav-bubble pc-nav-bubble--primary shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!canAdd"
              @click="onAdd"
            >
              添加
            </button>
          </div>
          <input
            v-model="draftDesc"
            type="text"
            maxlength="120"
            placeholder="补充说明（选填，回车或点「添加」提交）"
            class="min-w-0 rounded-md border border-flat-weak bg-surface px-2.5 py-1.5 text-xs text-text outline-none placeholder:text-text-tertiary focus:border-primary"
            @keydown.enter="onAdd"
          />
        </div>

        <!-- 平铺清单：连续编号一行两条；我的祖训虚线编号 + 悬浮删除 -->
        <p
          v-if="flatEntries.length === 0"
          class="rounded-lg border border-dashed border-flat-weak px-3 py-4 text-center text-xs text-text-tertiary"
        >
          还没有祖训条目
        </p>
        <ol v-else class="grid grid-cols-2 gap-x-4 gap-y-3">
          <li
            v-for="(entry, i) in flatEntries"
            :key="entry.key"
            class="group flex items-start gap-2"
            :class="entry.custom ? 'rounded-lg px-1.5 py-1 transition-colors hover:bg-flat-weak/60' : ''"
          >
            <span
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold tabular-nums"
              :class="
                entry.custom
                  ? 'border border-dashed border-primary/50 text-primary'
                  : 'bg-primary-weak text-primary'
              "
            >
              {{ i + 1 }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium leading-5 text-text">{{ entry.main }}</p>
              <p v-if="entry.sub" class="mt-0.5 text-xs leading-4 text-text-tertiary">
                {{ entry.sub }}
              </p>
            </div>
            <button
              v-if="entry.custom"
              type="button"
              class="pressable mt-0.5 shrink-0 rounded p-1 text-xs text-text-tertiary opacity-0 transition-opacity hover:bg-flat hover:text-up group-hover:opacity-100"
              :aria-label="`删除：${entry.main}`"
              title="删除"
              @click="onRemove(entry.customIndex ?? 0)"
            >
              ✕
            </button>
          </li>
        </ol>
      </section>
    </div>

    <!-- 底栏：免责提示常驻 -->
    <div class="shrink-0 border-t border-flat-weak px-4 py-2.5">
      <p class="text-xs leading-5 text-text-tertiary">⚠️ {{ TREASURY_DISCLAIMER }}</p>
    </div>
  </div>
</template>
