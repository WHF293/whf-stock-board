<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import MenuIcon from '../ui/MenuIcon.vue';
import { pluginKernel } from '../../../common/plugin/index';
import { useStockSearch } from '../../../common/composables/use-stock-search';
import { appStorage } from '../../../common/utils/app-local-storage';
import { matchPaletteItems } from '../../../common/utils/match-command-palette';
import { MENU_ITEMS } from '../../../common/constants/router-meta.constants.ts';
import {
  PALETTE_FILTERED_GROUP_MAX,
  PALETTE_GROUP_LABELS,
  PALETTE_GROUP_ORDER,
  PALETTE_RECENT_MAX,
  PALETTE_STOCK_RESULTS_MAX,
} from '../../../common/constants/command-palette.constants.ts';
import { STORAGE_NS_COMMAND_PALETTE_RECENT } from '../../../common/constants/storage-key.constants.ts';
import { trackAction } from '../../../pc/weblog/weblogActions';
import { useDockPanelStore } from '../../../common/stores/dock-panel';
import {
  PALETTE_ITEM_KIND,
  type PaletteItem,
  type PaletteItemKind,
  type RecentPaletteEntry,
} from '../../../common/types/command-palette.types.ts';

/**
 * 全局命令面板（Ctrl+K）：一处搜个股、搜页面、搜命令
 *
 * - 个股：`useStockSearch`（腾讯源，防抖 300ms，>= 2 字符触发），选中走
 *   `useDockPanelStore().openStock()`（全站唯一详情入口）；
 * - 页面：宿主 `MENU_ITEMS` + 插件菜单贡献（`pluginKernel.contributions.menus`）；
 * - 命令：插件命令贡献（`pluginKernel.contributions.commands`），**无快捷键的命令
 *   也会列出**（这是相对纯快捷键触发的增量价值）；
 * - 空输入态展示「最近使用」（localStorage 快照，命令类按注册表 key 回查，查不到丢弃）；
 * - 键盘：↑/↓ 循环选择、Enter 执行、Esc 关闭；中文输入法 composing 期间
 *   按键一律忽略（防拼音上屏瞬间误触执行）。
 *
 * 与 `StockSearchModal` 的分工：本组件是**全局导航入口**（顶栏搜索按钮 + Ctrl+K）；
 * 旧组件保留服务「在某功能里选一只票」的上下文场景（自选添加 / 插件选股），
 * 两者共用同一搜索历史。
 */
const props = defineProps<{
  /** 面板显隐 */
  open: boolean;
}>();

const emit = defineEmits<{
  /** 关闭面板（遮罩 / × / Esc / 执行任一项后） */
  close: [];
}>();

const router = useRouter();
const dockPanelStore = useDockPanelStore();
const { keyword, results, searching } = useStockSearch();

/** 输入框引用（打开时自动聚焦） */
const inputRef = ref<HTMLInputElement | null>(null);

/** 当前键盘选中下标（作用于扁平序列 flatItems） */
const activeIndex = ref(0);

// ---------- 前端候选源：页面 + 命令（随插件注册表变化重估） ----------

/** 页面候选（宿主菜单 + 插件菜单贡献；icon 为 MenuIcon key） */
const pageCandidates = computed<PaletteItem[]>(() => {
  void pluginKernel.revision.value;
  const hostItems: PaletteItem[] = MENU_ITEMS.map((item) => ({
    kind: PALETTE_ITEM_KIND.PAGE,
    label: item.title,
    detail: item.path,
    icon: item.icon,
    score: 0,
    ref: item.path,
  }));
  const pluginItems: PaletteItem[] = pluginKernel.contributions.menu.items.map((item) => ({
    kind: PALETTE_ITEM_KIND.PAGE,
    label: item.title,
    detail: item.path,
    icon: item.icon,
    score: 0,
    ref: item.path,
  }));
  return [...hostItems, ...pluginItems];
});

/** 命令候选（插件命令贡献；无快捷键的命令也列出） */
const commandCandidates = computed<PaletteItem[]>(() => {
  void pluginKernel.revision.value;
  return pluginKernel.contributions.commands.commands.map((command) => ({
    kind: PALETTE_ITEM_KIND.COMMAND,
    label: command.title,
    detail: command.keys ?? '',
    icon: 'grip',
    score: 0,
    ref: command.key,
  }));
});

// ---------- 结果组装：空输入看最近使用，有输入三源合并 ----------

/** 远程个股结果（截断到上限） */
const stockItems = computed<PaletteItem[]>(() =>
  results.value.slice(0, PALETTE_STOCK_RESULTS_MAX).map((result) => ({
    kind: PALETTE_ITEM_KIND.STOCK,
    label: result.name,
    detail: result.code,
    icon: 'search',
    score: 0,
    ref: result.code,
  })),
);

/** 页面 / 命令两组的前端过滤结果 */
const filteredLocalItems = computed<PaletteItem[]>(() => {
  const pages = matchPaletteItems(
    keyword.value,
    pageCandidates.value,
    PALETTE_FILTERED_GROUP_MAX,
  );
  const commands = matchPaletteItems(
    keyword.value,
    commandCandidates.value,
    PALETTE_FILTERED_GROUP_MAX,
  );
  return [...pages, ...commands];
});

/**
 * 读取「最近使用」快照（损坏数据按空数组处理）
 * @returns 快照条目数组（未写入过时为空数组）
 */
const readRecentRaw = (): RecentPaletteEntry[] => {
  try {
    return JSON.parse(
      appStorage.getItem(STORAGE_NS_COMMAND_PALETTE_RECENT) ?? '[]',
    ) as RecentPaletteEntry[];
  } catch {
    return [];
  }
};

/** 最近使用（localStorage 快照 → 可执行项；命令类回查注册表，查不到丢弃） */
const recentItems = computed<PaletteItem[]>(() => {
  const raw = readRecentRaw();
  const commandMap = new Map(
    pluginKernel.contributions.commands.commands.map((command) => [command.key, command]),
  );
  const restored: PaletteItem[] = [];
  for (const entry of raw) {
    if (entry.kind === PALETTE_ITEM_KIND.COMMAND) {
      const command = commandMap.get(entry.ref);
      if (!command) continue;
    }
    restored.push({ ...entry, score: 0 });
  }
  return restored;
});

/** 是否空输入态 */
const isIdle = computed(() => keyword.value.trim().length === 0);

/** 分组结果（按 PALETTE_GROUP_ORDER 渲染；空组不渲染） */
const visibleGroups = computed<{ kind: PaletteItemKind; label: string; items: PaletteItem[] }[]>(
  () => {
    if (isIdle.value) {
      return recentItems.value.length > 0
        ? [{ kind: PALETTE_ITEM_KIND.COMMAND, label: '最近使用', items: recentItems.value }]
        : [];
    }
    return PALETTE_GROUP_ORDER.map((kind) => ({
      kind,
      label: PALETTE_GROUP_LABELS[kind],
      items:
        kind === PALETTE_ITEM_KIND.STOCK
          ? stockItems.value
          : filteredLocalItems.value.filter((item) => item.kind === kind),
    })).filter((group) => group.items.length > 0);
  },
);

/** 扁平序列（键盘导航作用域 = 跨组连续下标） */
const flatItems = computed<PaletteItem[]>(() =>
  visibleGroups.value.flatMap((group) => group.items),
);

// ---------- 打开 / 关闭 / 键盘 ----------

// 打开时聚焦重置；关闭时清空搜索状态（与旧搜索弹窗一致）
watch(
  () => props.open,
  (open) => {
    if (open) {
      activeIndex.value = 0;
      nextTick(() => inputRef.value?.focus());
    } else {
      keyword.value = '';
      results.value = [];
    }
  },
);

// 展示序列变化时选中项回到首位
watch(flatItems, () => {
  activeIndex.value = 0;
});

/**
 * 移动键盘选中项（循环）
 * @param delta 步进（+1 下移 / -1 上移）
 */
const moveActive = (delta: number): void => {
  const total = flatItems.value.length;
  if (total === 0) return;
  activeIndex.value = (activeIndex.value + delta + total) % total;
};

/**
 * 把一次执行写入「最近使用」（去重前置顶，裁到上限）
 * @param item 被执行的项
 */
const rememberRecent = (item: PaletteItem): void => {
  const raw = readRecentRaw();
  const entry: RecentPaletteEntry = {
    kind: item.kind,
    label: item.label,
    detail: item.detail,
    icon: item.icon,
    ref: item.ref,
  };
  const deduped = raw.filter((existing) => existing.ref !== entry.ref);
  appStorage.setItem(
    STORAGE_NS_COMMAND_PALETTE_RECENT,
    JSON.stringify([entry, ...deduped].slice(0, PALETTE_RECENT_MAX)),
  );
};

/**
 * 执行一项并关闭面板
 *
 * 个股不写 `stock-search-history`（那是 StockSearchModal 的记录点，需要完整
 * SearchResult；面板的「最近使用」是独立的跨类机制，二者不混写）
 * @param item 被执行的项
 */
const execute = (item: PaletteItem): void => {
  rememberRecent(item);
  if (item.kind === PALETTE_ITEM_KIND.STOCK) {
    dockPanelStore.openStock(item.ref);
    trackAction('PALETTE_EXECUTE', { detail: `stock ${item.ref}` });
  } else if (item.kind === PALETTE_ITEM_KIND.PAGE) {
    void router.push(item.ref);
    trackAction('PALETTE_EXECUTE', { detail: `page ${item.ref}` });
  } else {
    const command = pluginKernel.contributions.commands.commands.find(
      (candidate) => candidate.key === item.ref,
    );
    if (command) {
      trackAction('PALETTE_EXECUTE', { detail: `command ${item.ref}` });
      try {
        command.run();
      } catch (error) {
        console.error(`[palette] 命令 ${item.ref} 执行失败`, error);
      }
    }
  }
  emit('close');
};

/**
 * 输入框键盘处理：↑/↓ 切换、Enter 执行、Esc 关闭。
 * composing 期间（拼音未上屏）全部忽略，防止选字瞬间误执行；
 * Esc 阻止冒泡，避免同时触发 DockPanel 的 Esc 关面板逻辑
 * @param event 键盘事件
 */
const onInputKeydown = (event: KeyboardEvent): void => {
  if (event.isComposing) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveActive(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveActive(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const item = flatItems.value[activeIndex.value];
    if (item) execute(item);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('close');
  }
};
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩：点击关闭 -->
    <div
      v-if="open"
      class="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
      @click="emit('close')"
    >
      <!-- 弹窗卡片（阻止冒泡） -->
      <div
        class="mx-auto mt-[10vh] w-[min(92vw,560px)] overflow-hidden rounded-2xl bg-surface shadow-2xl"
        @click.stop
      >
        <!-- 输入区 -->
        <div class="flex items-center gap-3 border-b border-flat-weak px-4 py-3">
          <MenuIcon
            name="search"
            :size="18"
            class="shrink-0 text-text-tertiary"
          />
          <input
            ref="inputRef"
            v-model="keyword"
            type="text"
            placeholder="搜索个股 / 页面 / 命令"
            class="h-8 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-tertiary"
            @keydown="onInputKeydown"
          />
          <button
            type="button"
            class="pressable rounded-md p-1 text-text-tertiary hover:bg-flat-weak hover:text-text"
            aria-label="关闭命令面板"
            @click="emit('close')"
          >
            <MenuIcon name="close" :size="16" />
          </button>
        </div>

        <!-- 分组结果区 -->
        <div class="max-h-[50vh] overflow-auto p-2">
          <p
            v-if="!isIdle && searching && stockItems.length === 0"
            class="px-3 py-2 text-xs text-text-tertiary"
          >
            搜索中...
          </p>
          <p
            v-else-if="flatItems.length === 0"
            class="px-3 py-6 text-center text-xs text-text-tertiary"
          >
            {{ isIdle ? '搜索个股、跳转页面或执行命令' : '未找到匹配结果' }}
          </p>
          <template v-else>
            <section v-for="group in visibleGroups" :key="group.kind" class="mb-1 last:mb-0">
              <p class="px-3 pb-0.5 pt-1.5 text-xs text-text-tertiary">{{ group.label }}</p>
              <ul class="space-y-1">
                <li v-for="item in group.items" :key="`${item.kind}:${item.ref}`">
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
                    :class="
                      flatItems[activeIndex]?.kind === item.kind &&
                        flatItems[activeIndex]?.ref === item.ref
                        ? 'bg-primary-weak ring-1 ring-primary'
                        : 'hover:bg-flat-weak'
                    "
                    @mouseenter="activeIndex = flatItems.indexOf(item)"
                    @click="execute(item)"
                  >
                    <MenuIcon
                      :name="item.icon"
                      :size="16"
                      class="shrink-0 text-text-tertiary"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-text">{{ item.label }}</span>
                      <span
                        v-if="item.detail"
                        class="mt-0.5 block truncate text-xs text-text-tertiary"
                      >{{ item.detail }}</span>
                    </span>
                    <MenuIcon
                      v-if="flatItems[activeIndex]?.kind === item.kind && flatItems[activeIndex]?.ref === item.ref"
                      name="arrowLeft"
                      :size="14"
                      class="shrink-0 rotate-180 text-primary"
                    />
                  </button>
                </li>
              </ul>
            </section>
          </template>
        </div>

        <!-- 底部快捷键提示 -->
        <div class="flex items-center gap-4 border-t border-flat-weak px-4 py-2 text-xs text-text-tertiary">
          <span>↑ ↓ 切换</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
