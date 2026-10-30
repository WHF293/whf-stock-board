<script setup lang="ts">
import { computed, onDeactivated, onMounted, ref } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseConfirmModal from '../ui/BaseConfirmModal.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseInput from '../ui/BaseInput.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseTag from '../ui/BaseTag.vue';
import { usePluginMarket } from '../../../common/composables/use-plugin-market';
import { PLUGIN_MOBILE_READY_BADGE } from '../../../common/constants/plugin.constants.ts';
import { normalizeRepoInput } from '../../../common/utils/normalize-repo-input';
import { formatBytes } from '../../../common/utils/format-bytes';
import { compareVersion, isNewerVersion } from '../../../common/utils/plugin-version';
import {
  PLUGIN_MARKET_CONFIRM_CANCEL,
  PLUGIN_MARKET_CONFIRM_DOWNGRADE,
  PLUGIN_MARKET_CONFIRM_NO_CHECKSUM,
  PLUGIN_MARKET_CONFIRM_OK,
  PLUGIN_MARKET_CONFIRM_SOURCE,
  PLUGIN_MARKET_CONFIRM_TITLE,
  PLUGIN_MARKET_CURRENT_VERSION_LABEL,
  PLUGIN_MARKET_EMPTY_NOT_INSTALLED_TEXT,
  PLUGIN_MARKET_EMPTY_TEXT,
  PLUGIN_MARKET_FAIL_PREFIX,
  PLUGIN_MARKET_FILTER_ALL_LABEL,
  PLUGIN_MARKET_HISTORY_COLLAPSE_LABEL,
  PLUGIN_MARKET_HISTORY_TITLE,
  PLUGIN_MARKET_HISTORY_TOGGLE_LABEL,
  PLUGIN_MARKET_INSTALLING_LABEL,
  PLUGIN_MARKET_INSTALL_LABEL,
  PLUGIN_MARKET_INSTALLED_LABEL,
  PLUGIN_MARKET_NO_MATCH_TEXT,
  PLUGIN_MARKET_NO_PRODUCTS_TEXT,
  PLUGIN_MARKET_REFRESH_LABEL,
  PLUGIN_MARKET_RETRY_LABEL,
  PLUGIN_MARKET_RISK_NOTICE,
  PLUGIN_MARKET_SEARCH_PLACEHOLDER,
  PLUGIN_MARKET_SOURCE_ADD_CONFIRM,
  PLUGIN_MARKET_SOURCE_ADD_LABEL,
  PLUGIN_MARKET_SOURCE_BADGE,
  PLUGIN_MARKET_SOURCE_BUILTIN_BADGE,
  PLUGIN_MARKET_SOURCE_INPUT_PLACEHOLDER,
  PLUGIN_MARKET_SOURCE_PANEL_HINT,
  PLUGIN_MARKET_SOURCE_PANEL_TITLE,
  PLUGIN_MARKET_SOURCE_REMOVE_CONFIRM_LABEL,
  PLUGIN_MARKET_SOURCE_REMOVE_LABEL,
  PLUGIN_MARKET_UPDATE_LABEL,
} from '../../../common/constants/plugin-market.constants.ts';
import type {
  PluginMarketEntry,
  PluginMarketVersion,
} from '../../../common/types/plugin-market.types.ts';

/**
 * 插件市场面板（可内嵌的平铺视图，原「插件市场」弹窗的主体内容）
 *
 * 数据来自 `usePluginMarket`（模块级单例）：卸载不丢已加载目录与进行中的安装。
 * 挂载即拉默认源集合（内置源 + 有缓存的自定义源，目录缓存一小时）。
 * 三层交互：
 * - **源筛选**：全部 / 官方 / 各自定义源 chip；未加载的自定义源选中即懒加载；
 * - **源管理**：弹窗列出全部源（官方源不可删），添加源走「归一化 → 风险确认」，
 *   删除走两段确认（与卸载插件同范式）；
 * - **安装**：卡片默认装最新版，「历史版本」展开后可选任意旧版（覆盖降级），
 *   每次安装先弹确认（来源 / 版本 / 体积 / 降级与无校验提醒），全局串行执行。
 */
const props = withDefaults(
  defineProps<{
    /** 只看未安装的插件（本地没有任何已装版本的市场条目才可见） */
    notInstalledOnly?: boolean;
  }>(),
  { notInstalledOnly: false },
);

const {
  sources,
  entries,
  installing,
  stateOf,
  errorOf,
  installedVersionOf,
  loadDefaultSources,
  ensureSourceLoaded,
  addSource,
  removeSource,
  install,
} = usePluginMarket();

/** 源筛选的「全部」值（非仓库全名的哨兵） */
const FILTER_ALL = 'all';

/** 搜索关键字 */
const search = ref('');

/** 当前筛选的源（'all' 或仓库全名） */
const activeRepo = ref<string>(FILTER_ALL);

/** 源管理弹窗显隐（插件源列表 + 添加源，弹窗承载不挤占页内空间） */
const sourceModalOpen = ref(false);

/** 历史版本展开中的插件 id 集合 */
const expandedIds = ref(new Set<string>());

/** 待确认的安装（确认弹窗数据源；null = 无） */
const pendingInstall = ref<{ entry: PluginMarketEntry; version: PluginMarketVersion } | null>(null);

/** 添加源输入框内容 */
const addInput = ref('');

/** 添加源的地址解析错误（内联展示，不打断输入） */
const addError = ref('');

/** 待风险确认的新源（确认弹窗数据源；空串 = 无） */
const pendingAddRepo = ref('');

/** 处于「待确认删除」两段式的源（空串 = 无） */
const confirmingRemoveRepo = ref('');

/** 挂载即拉默认源集合（已就绪的目录走一小时缓存，不重复打 API） */
onMounted(() => {
  void loadDefaultSources();
});

/** KeepAlive 切走页面时收起源管理弹窗：Teleport 到 body 的浮层不随页面失活自动撤离 */
onDeactivated(() => {
  sourceModalOpen.value = false;
});

/** 源筛选 chip 的选项（全部 + 各源） */
const filterOptions = computed(() => [
  { repo: FILTER_ALL, label: PLUGIN_MARKET_FILTER_ALL_LABEL, builtin: false },
  ...sources.value.map((source) => ({ repo: source.repo, label: source.label, builtin: source.builtin })),
]);

/**
 * 搜索 + 源筛选（+ 可选的「只看未安装」）后的可见条目
 *
 * 筛到具体源时条目直接取该源目录（**不做 id 去重**）——去重是「全部」视图防止
 * 同 id 双卡的展示策略，单独看某个源时应看到它的全部产物。
 */
const visibleEntries = computed<readonly PluginMarketEntry[]>(() => {
  const keyword = search.value.trim().toLowerCase();
  const sourceEntries =
    activeRepo.value === FILTER_ALL
      ? entries.value
      : (entries.value.filter((entry) => entry.sourceRepo === activeRepo.value));
  const scopedEntries = props.notInstalledOnly
    ? sourceEntries.filter((entry) => installedVersionOf(entry.id).length === 0)
    : sourceEntries;
  if (keyword.length === 0) return scopedEntries;
  return scopedEntries.filter((entry) =>
    [entry.name, entry.id, entry.description].some((text) => text.toLowerCase().includes(keyword)),
  );
});

/** 「全部」视图下加载失败的源（列表下方集中提示） */
const failedSources = computed(() =>
  sources.value.filter((source) => stateOf(source.repo) === 'fail'),
);

/** 当前视图是否在加载（错峰启动的源还在 idle 也算加载中，避免首帧闪空态） */
const isLoading = computed<boolean>(() => {
  if (activeRepo.value === FILTER_ALL) {
    return (
      sources.value.length > 0 &&
      (sources.value.every((source) => stateOf(source.repo) === 'idle') ||
        sources.value.some((source) => stateOf(source.repo) === 'loading'))
    );
  }
  const state = stateOf(activeRepo.value);
  return state === 'idle' || state === 'loading';
});

/** 空态文案（区分「没装产物」「搜索无匹配」「还没加载出任何源」「都已安装」） */
const emptyText = computed<string>(() => {
  if (search.value.trim().length > 0) return PLUGIN_MARKET_NO_MATCH_TEXT;
  if (props.notInstalledOnly) return PLUGIN_MARKET_EMPTY_NOT_INSTALLED_TEXT;
  if (activeRepo.value !== FILTER_ALL && stateOf(activeRepo.value) === 'ready') {
    return visibleEntries.value.length === 0 ? PLUGIN_MARKET_NO_PRODUCTS_TEXT : '';
  }
  return PLUGIN_MARKET_EMPTY_TEXT;
});

/**
 * 某个源的展示徽标
 * @param repo 仓库全名
 * @returns 徽标文案
 */
const sourceBadgeOf = (repo: string): string => {
  const source = sources.value.find((item) => item.repo === repo);
  return source ? PLUGIN_MARKET_SOURCE_BADGE(source.label, source.builtin) : repo;
};

/**
 * 切换源筛选（未加载 / 加载失败的自定义源选中即（重）拉；已就绪的源 no-op）
 * @param repo 目标源（或 'all'）
 */
const onPickFilter = (repo: string): void => {
  activeRepo.value = repo;
  if (repo !== FILTER_ALL) void ensureSourceLoaded(repo);
};

/**
 * 重试拉取一个失败的源（不切换筛选，就地重试）
 * @param repo 仓库全名
 */
const onRetrySource = (repo: string): void => {
  void ensureSourceLoaded(repo);
};

/** 点「刷新」：当前视图强刷（全部 = 默认源集合；单源 = 该源） */
const onRefresh = (): void => {
  if (activeRepo.value === FILTER_ALL) void loadDefaultSources({ force: true });
  else void ensureSourceLoaded(activeRepo.value, { force: true });
};

/**
 * 展开 / 收起一个插件的历史版本区
 * @param id 插件 id
 */
const toggleHistory = (id: string): void => {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIds.value = next;
};

/** 卡片主按钮的三态视图模型 */
interface EntryAction {
  /** 按钮文案 */
  label: string;
  /** 是否禁用 */
  disabled: boolean;
  /** 是否该插件正在安装（按钮转圈提示用） */
  busy: boolean;
}

/**
 * 最新版按钮的三态（安装 / 更新 / 已安装；安装全局串行期间一律禁用）
 * @param entry 插件条目
 * @returns 视图模型
 */
const latestActionOf = (entry: PluginMarketEntry): EntryAction => {
  const installed = installedVersionOf(entry.id);
  const serialBusy = installing.value !== null;
  if (installing.value?.id === entry.id && installing.value?.version === entry.latest.version) {
    return { label: PLUGIN_MARKET_INSTALLING_LABEL, disabled: true, busy: true };
  }
  if (installed.length > 0 && !isNewerVersion(entry.latest.version, installed)) {
    return { label: PLUGIN_MARKET_INSTALLED_LABEL, disabled: true, busy: false };
  }
  if (installed.length > 0) {
    return {
      label: PLUGIN_MARKET_UPDATE_LABEL(entry.latest.version),
      disabled: serialBusy,
      busy: false,
    };
  }
  return { label: PLUGIN_MARKET_INSTALL_LABEL, disabled: serialBusy, busy: false };
};

/**
 * 历史版本行按钮的视图模型（本地已装该版本时禁用为「当前版本」）
 * @param entry 插件条目
 * @param version 目标历史版本
 * @returns 视图模型
 */
const historyActionOf = (entry: PluginMarketEntry, version: PluginMarketVersion): EntryAction => {
  if (installing.value?.id === entry.id && installing.value?.version === version.version) {
    return { label: PLUGIN_MARKET_INSTALLING_LABEL, disabled: true, busy: true };
  }
  if (installedVersionOf(entry.id) === version.version) {
    return { label: PLUGIN_MARKET_CURRENT_VERSION_LABEL, disabled: true, busy: false };
  }
  return { label: PLUGIN_MARKET_INSTALL_LABEL, disabled: installing.value !== null, busy: false };
};

/**
 * 请求安装（弹确认；真正下载在确认后）
 * @param entry 插件条目
 * @param version 目标版本
 */
const requestInstall = (entry: PluginMarketEntry, version: PluginMarketVersion): void => {
  pendingInstall.value = { entry, version };
};

/** 确认安装：关闭确认弹窗并执行（全局串行在 composable 内排队） */
const onConfirmInstall = (): void => {
  const pending = pendingInstall.value;
  pendingInstall.value = null;
  if (!pending) return;
  void install(pending.entry, pending.version);
};

/** 取消安装确认 */
const onCancelInstall = (): void => {
  pendingInstall.value = null;
};

/**
 * 安装确认弹窗的 v-model 桥（待确认项即显隐事实源；
 * 弹窗内部关闭 / ESC / 遮罩都会经 setter 清掉待确认项）
 */
const installConfirmOpen = computed({
  get: (): boolean => pendingInstall.value !== null,
  set: (value: boolean): void => {
    if (!value) pendingInstall.value = null;
  },
});

/**
 * 添加源确认弹窗的 v-model 桥（同上）
 */
const addSourceConfirmOpen = computed({
  get: (): boolean => pendingAddRepo.value.length > 0,
  set: (value: boolean): void => {
    if (!value) pendingAddRepo.value = '';
  },
});

/** 确认弹窗是否为降级安装（装历史旧版覆盖更新版） */
const isDowngrade = computed<boolean>(() => {
  const pending = pendingInstall.value;
  if (!pending) return false;
  const installed = installedVersionOf(pending.entry.id);
  return installed.length > 0 && compareVersion(pending.version.version, installed) < 0;
});

/** 确认弹窗是否提示「无官方校验」（第三方源且增强清单未给 sha256） */
const isUnverified = computed<boolean>(() => {
  const pending = pendingInstall.value;
  if (!pending) return false;
  return pending.version.sha256.length === 0 && !pending.entry.builtinSource;
});

/**
 * 点「添加源」：先本地归一化（错误内联展示），通过后弹风险确认
 */
const onRequestAddSource = (): void => {
  addError.value = '';
  let repo: string;
  try {
    repo = normalizeRepoInput(addInput.value);
  } catch (error) {
    addError.value = error instanceof Error ? error.message : '地址不合法';
    return;
  }
  pendingAddRepo.value = repo;
};

/** 确认添加：持久化 + 立即拉取该源；失败浮窗由 composable 负责 */
const onConfirmAddSource = (): void => {
  const repo = pendingAddRepo.value;
  pendingAddRepo.value = '';
  if (repo.length === 0) return;
  void addSource(repo).then((ok) => {
    if (ok) addInput.value = '';
  });
};

/** 取消添加确认 */
const onCancelAddSource = (): void => {
  pendingAddRepo.value = '';
};

/**
 * 点源条目的删除按钮：两段确认（第一段进入待确认态，第二段执行）
 * @param repo 仓库全名
 */
const onRemoveSource = (repo: string): void => {
  if (confirmingRemoveRepo.value !== repo) {
    confirmingRemoveRepo.value = repo;
    return;
  }
  confirmingRemoveRepo.value = '';
  removeSource(repo);
};

/**
 * 发布日期的短文案（ISO 串取日期段）
 * @param version 目标版本
 * @returns `YYYY-MM-DD`；上游缺失时空串
 */
const publishedDateOf = (version: PluginMarketVersion): string =>
  version.publishedAt.length >= 10 ? version.publishedAt.slice(0, 10) : '';
</script>

<template>
  <div class="space-y-2">
    <!-- 工具行：搜索 / 刷新 / 源管理 -->
    <div class="flex items-center gap-2">
      <BaseInput v-model="search" :placeholder="PLUGIN_MARKET_SEARCH_PLACEHOLDER" class="min-w-0 flex-1" />
      <BaseButton variant="ghost" data-track="PLUGIN_MARKET_REFRESH" @click="onRefresh">
        {{ PLUGIN_MARKET_REFRESH_LABEL }}
      </BaseButton>
      <BaseButton variant="ghost" @click="sourceModalOpen = true">
        {{ PLUGIN_MARKET_SOURCE_PANEL_TITLE }}
      </BaseButton>
    </div>
    <div class="flex flex-wrap items-center gap-1.5">
      <button
        v-for="option in filterOptions"
        :key="option.repo"
        type="button"
        class="pressable rounded-full px-2.5 py-1 text-xs transition-colors"
        :class="
          activeRepo === option.repo
            ? 'bg-primary-weak font-medium text-primary'
            : 'bg-flat-weak text-text-secondary hover:text-text'
        "
        @click="onPickFilter(option.repo)"
      >
        {{ option.label }}
      </button>
    </div>
    <p class="rounded-card bg-up-weak/60 px-3 py-2 text-xs text-text-secondary">
      ⚠️ {{ PLUGIN_MARKET_RISK_NOTICE }}
    </p>

    <!-- 源管理弹窗：插件源列表（官方源不可删）+ 添加源（归一化 → 风险确认） -->
    <BaseModal
      v-model:open="sourceModalOpen"
      :title="PLUGIN_MARKET_SOURCE_PANEL_TITLE"
      max-width-class="max-w-xl"
    >
      <div class="space-y-2">
        <p class="text-xs text-text-tertiary">{{ PLUGIN_MARKET_SOURCE_PANEL_HINT }}</p>
        <ul class="space-y-1.5">
          <li
            v-for="source in sources"
            :key="source.repo"
            class="flex items-center justify-between gap-2 rounded bg-flat-weak/60 px-2.5 py-1.5"
          >
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="truncate text-xs font-medium text-text">{{ source.label }}</span>
              <BaseTag v-if="source.builtin" tone="primary">{{ PLUGIN_MARKET_SOURCE_BUILTIN_BADGE }}</BaseTag>
              <span class="truncate font-mono text-[11px] text-text-tertiary">{{ source.repo }}</span>
            </div>
            <BaseButton
              v-if="!source.builtin"
              variant="ghost"
              class="shrink-0"
              :class="confirmingRemoveRepo === source.repo ? 'text-up' : ''"
              @click="onRemoveSource(source.repo)"
            >
              {{
                confirmingRemoveRepo === source.repo
                  ? PLUGIN_MARKET_SOURCE_REMOVE_CONFIRM_LABEL
                  : PLUGIN_MARKET_SOURCE_REMOVE_LABEL
              }}
            </BaseButton>
          </li>
        </ul>
        <div class="flex items-start gap-2 border-t border-flat-weak pt-2">
          <div class="min-w-0 flex-1">
            <BaseInput v-model="addInput" :placeholder="PLUGIN_MARKET_SOURCE_INPUT_PLACEHOLDER" />
            <p v-if="addError" class="mt-1 text-xs text-up">{{ addError }}</p>
          </div>
          <BaseButton variant="primary" class="shrink-0" @click="onRequestAddSource">
            {{ PLUGIN_MARKET_SOURCE_ADD_LABEL }}
          </BaseButton>
        </div>
      </div>
    </BaseModal>

    <!-- 「全部」视图下加载失败的源（集中提示 + 原因） -->
    <div
      v-for="source in activeRepo === FILTER_ALL ? failedSources : []"
      :key="source.repo"
      class="flex items-center justify-between gap-2 rounded-card border border-up-weak px-3 py-2"
    >
      <p class="min-w-0 break-words text-xs text-up">
        {{ source.label }}：{{ PLUGIN_MARKET_FAIL_PREFIX }}{{ errorOf(source.repo) }}
      </p>
      <BaseButton variant="ghost" class="shrink-0" @click="onRetrySource(source.repo)">
        {{ PLUGIN_MARKET_RETRY_LABEL }}
      </BaseButton>
    </div>

    <!-- 加载态 -->
    <div v-if="isLoading" class="py-8 text-center text-sm text-text-tertiary">
      正在加载插件列表…
    </div>

    <!-- 空态 -->
    <BaseEmpty v-else-if="visibleEntries.length === 0 && emptyText" :text="emptyText" />

    <!-- 插件卡瀑布流（CSS 多列：卡片按列填充无空隙；@container 容器断点驱动，宽度不足自动回退单列） -->
    <div v-else class="gap-x-2 @4xl:columns-2">
      <article
        v-for="entry in visibleEntries"
        :key="`${entry.sourceRepo}/${entry.id}`"
        class="mb-2 break-inside-avoid rounded-card border border-flat-weak px-3 py-2.5"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-text">{{ entry.name }}</span>
              <BaseTag tone="primary">v{{ entry.latest.version }}</BaseTag>
              <BaseTag v-if="entry.devices?.includes('mobile')" tone="flat">
                {{ PLUGIN_MOBILE_READY_BADGE }}
              </BaseTag>
              <span class="text-[11px] text-text-tertiary">{{ sourceBadgeOf(entry.sourceRepo) }}</span>
            </div>
            <p v-if="entry.description" class="mt-1 text-xs text-text-secondary">{{ entry.description }}</p>
            <p class="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-tertiary">
              <span>{{ entry.id }}</span>
              <span v-if="entry.author">· {{ entry.author }}</span>
              <span>· {{ formatBytes(entry.latest.zipSize) }}</span>
            </p>
          </div>
          <div class="flex shrink-0 flex-col items-end gap-1">
            <BaseButton
              variant="primary"
              :disabled="latestActionOf(entry).disabled"
              @click="requestInstall(entry, entry.latest)"
            >
              {{ latestActionOf(entry).busy ? PLUGIN_MARKET_INSTALLING_LABEL : latestActionOf(entry).label }}
            </BaseButton>
            <button
              type="button"
              class="pressable text-xs text-text-tertiary hover:text-text"
              @click="toggleHistory(entry.id)"
            >
              {{ expandedIds.has(entry.id) ? PLUGIN_MARKET_HISTORY_COLLAPSE_LABEL : PLUGIN_MARKET_HISTORY_TOGGLE_LABEL }} ▾
            </button>
          </div>
        </div>

        <!-- 历史版本区（展开时） -->
        <div v-if="expandedIds.has(entry.id)" class="mt-2 border-t border-flat-weak pt-2">
          <p class="mb-1.5 text-xs font-medium text-text-secondary">{{ PLUGIN_MARKET_HISTORY_TITLE }}</p>
          <ul class="space-y-1">
            <li
              v-for="version in entry.history"
              :key="version.zipName"
              class="flex items-center justify-between gap-2 rounded bg-flat-weak/60 px-2.5 py-1.5"
            >
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <span class="font-mono text-xs text-text">v{{ version.version }}</span>
                <span class="text-[11px] text-text-tertiary">{{ publishedDateOf(version) }}</span>
                <span class="font-mono text-[11px] text-text-tertiary">{{ formatBytes(version.zipSize) }}</span>
              </div>
              <BaseButton
                variant="ghost"
                class="shrink-0"
                :disabled="historyActionOf(entry, version).disabled"
                @click="requestInstall(entry, version)"
              >
                {{ historyActionOf(entry, version).label }}
              </BaseButton>
            </li>
          </ul>
        </div>
      </article>
    </div>

    <!-- 安装确认弹窗：下载远程代码前必须过一道（来源 / 版本 / 体积 / 降级与无校验提醒） -->
    <BaseConfirmModal
      v-model:open="installConfirmOpen"
      :title="pendingInstall ? PLUGIN_MARKET_CONFIRM_TITLE(pendingInstall.entry.name) : ''"
      :ok-text="PLUGIN_MARKET_CONFIRM_OK"
      :cancel-text="PLUGIN_MARKET_CONFIRM_CANCEL"
      max-width-class="max-w-lg"
      @ok="onConfirmInstall"
      @cancel="onCancelInstall"
    >
      <div v-if="pendingInstall" class="space-y-2">
        <p class="text-text">
          v{{ pendingInstall.version.version }}
          <span v-if="pendingInstall.version.version !== pendingInstall.entry.latest.version" class="text-xs text-text-tertiary">
            （非最新，最新为 v{{ pendingInstall.entry.latest.version }}）
          </span>
        </p>
        <p class="text-xs text-text-tertiary">
          来源 {{ PLUGIN_MARKET_CONFIRM_SOURCE(sourceBadgeOf(pendingInstall.entry.sourceRepo), pendingInstall.entry.sourceRepo) }}
          · 体积 {{ formatBytes(pendingInstall.version.zipSize) }}
        </p>
        <p v-if="isDowngrade" class="text-xs text-up">
          {{ PLUGIN_MARKET_CONFIRM_DOWNGRADE(installedVersionOf(pendingInstall.entry.id), pendingInstall.version.version) }}
        </p>
        <p v-if="isUnverified" class="text-xs text-up">
          {{ PLUGIN_MARKET_CONFIRM_NO_CHECKSUM(pendingInstall.entry.sourceRepo) }}
        </p>
        <p class="text-xs text-text-tertiary">插件代码会以与应用相同的权限运行，请确认来源可信。</p>
      </div>
    </BaseConfirmModal>

    <!-- 添加源风险确认弹窗 -->
    <BaseConfirmModal
      v-model:open="addSourceConfirmOpen"
      :title="PLUGIN_MARKET_SOURCE_ADD_LABEL"
      :ok-text="PLUGIN_MARKET_CONFIRM_OK"
      :cancel-text="PLUGIN_MARKET_CONFIRM_CANCEL"
      max-width-class="max-w-md"
      @ok="onConfirmAddSource"
      @cancel="onCancelAddSource"
    >
      <p class="text-sm text-text">{{ PLUGIN_MARKET_SOURCE_ADD_CONFIRM(pendingAddRepo) }}</p>
    </BaseConfirmModal>
  </div>
</template>
