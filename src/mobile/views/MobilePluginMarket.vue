<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { usePluginMarket } from '../../common/composables/use-plugin-market';
import { usePluginPackageIntake } from '../../common/composables/use-plugin-package-intake';
import { formatBytes } from '../../common/utils/format-bytes';
import { normalizeRepoInput } from '../../common/utils/normalize-repo-input';
import { compareVersion, isNewerVersion } from '../../common/utils/plugin-version';
import {
  PLUGIN_DEVICE_DEFAULT,
  PLUGIN_MOBILE_READY_BADGE,
  USER_PLUGIN_INTAKE_INSTALL_ALL_LABEL,
  USER_PLUGIN_INTAKE_STATUS,
  USER_PLUGIN_INTAKE_STATUS_LABEL,
  USER_PLUGIN_INTAKE_STEP_GLYPH,
  USER_PLUGIN_INTAKE_STEP_MARK,
  USER_PLUGIN_INTAKE_STEP_SEPARATOR,
} from '../../common/constants/plugin.constants.ts';
import type { UserPluginIntakeStatus } from '../../common/constants/plugin.constants.ts';
import {
  PLUGIN_MARKET_CONFIRM_CANCEL,
  PLUGIN_MARKET_CONFIRM_DOWNGRADE,
  PLUGIN_MARKET_CONFIRM_NO_CHECKSUM,
  PLUGIN_MARKET_CONFIRM_OK,
  PLUGIN_MARKET_CONFIRM_TITLE,
  PLUGIN_MARKET_CURRENT_VERSION_LABEL,
  PLUGIN_MARKET_EMPTY_TEXT,
  PLUGIN_MARKET_ERR_SOURCE_DUP,
  PLUGIN_MARKET_ERR_SOURCE_MAX,
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
  PLUGIN_MARKET_SOURCE_MAX,
  PLUGIN_MARKET_SOURCE_PANEL_HINT,
  PLUGIN_MARKET_SOURCE_PANEL_TITLE,
  PLUGIN_MARKET_SOURCE_REMOVE_LABEL,
  PLUGIN_MARKET_UPDATE_LABEL,
} from '../../common/constants/plugin-market.constants.ts';
import type {
  PluginMarketEntry,
  PluginMarketVersion,
} from '../../common/types/plugin-market.types.ts';
import type { PluginPackageIntakeTask } from '../../common/composables/use-plugin-package-intake';
import type { PluginDefinition } from '../../common/types/plugin.types.ts';
import {
  MOBILE_PLUGIN_INSTALL_FAIL_TOAST,
  MOBILE_PLUGIN_INSTALL_OK_TOAST,
  MOBILE_PLUGIN_MARKET_LOADING_TEXT,
  MOBILE_PLUGIN_MARKET_LOCAL_HINT,
  MOBILE_PLUGIN_MARKET_SECTION_LOCAL,
  MOBILE_PLUGIN_MARKET_SECTION_ONLINE,
  MOBILE_PLUGIN_MARKET_TITLE,
  MOBILE_PLUGIN_MARKET_SOURCE_ADD_FAIL_TOAST,
  MOBILE_PLUGIN_MARKET_SOURCE_ADD_OK_TOAST,
  MOBILE_PLUGIN_MARKET_SOURCE_ADD_TITLE,
  MOBILE_PLUGIN_MARKET_SOURCE_REMOVE_MESSAGE,
  MOBILE_PLUGIN_MARKET_SOURCE_REMOVE_OK_TOAST,
  MOBILE_PLUGIN_MARKET_SOURCE_REMOVE_TITLE,
  MOBILE_PLUGIN_PC_ONLY_LABEL,
  MOBILE_PLUGIN_TRUST_NOTE,
  MOBILE_PLUGIN_ZIP_ACCEPT,
  MOBILE_PLUGIN_ZIP_PICK_LABEL,
  MOBILE_PLUGIN_ZIP_REMOVE_LABEL,
} from '../constants';

/**
 * 插件市场页（移动端，方案 P5）
 *
 * Vant 皮复用 common 层市场与 intake 编排（数据流对齐 PC `PluginMarketPanel.vue` /
 * `PluginInstallModal.vue`，但不 import PC 组件）：
 * - **在线市场**：源筛选（全部 / 官方 / 自定义，未加载的自定义源选中即懒加载）、
 *   目录列表、历史版本选装（覆盖降级）；安装前 Vant 弹确认，全局串行由
 *   `usePluginMarket` 内部保证；**仅 devices 含 mobile 的插件放开安装**，
 *   PC-only 插件照常展示但按钮禁用并标注「仅 PC 端可用」；
 * - **本地 zip 安装**：`<input type="file" multiple>` 入队 intake 流水线，
 *   六步进度原样展示；解析出 PC-only 定义的任务同样不放开安装。
 */

const router = useRouter();

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

const {
  tasks,
  installableCount,
  busy: intakeBusy,
  enqueue,
  remove: removeIntakeTask,
  installOne,
  installAll,
} = usePluginPackageIntake();

/** 源筛选的「全部」值（非仓库全名的哨兵） */
const FILTER_ALL = 'all';

/** 搜索关键字 */
const search = ref('');

/** 当前筛选的源（'all' 或仓库全名） */
const activeRepo = ref<string>(FILTER_ALL);

/** 历史版本展开中的插件 id 集合 */
const expandedIds = ref(new Set<string>());

/** 本地 zip 选择的隐藏 input */
const zipInput = ref<HTMLInputElement | null>(null);

/** 源管理折叠卡是否展开 */
const sourcePanelOpen = ref(false);

/** 添加源弹窗可见性 */
const addDialogOpen = ref(false);

/** 添加源输入内容（owner/repo 或 GitHub 仓库地址） */
const addInput = ref('');

/** 添加源的行内错误（归一化失败 / 重复 / 超限） */
const addError = ref('');

/** 挂载即拉默认源集合（内置源 + 有缓存的自定义源；目录缓存一小时） */
onMounted(() => {
  void loadDefaultSources();
});

/** 源筛选 chip 的选项（全部 + 各源） */
const filterOptions = computed(() => [
  { repo: FILTER_ALL, label: PLUGIN_MARKET_FILTER_ALL_LABEL },
  ...sources.value.map((source) => ({ repo: source.repo, label: source.label })),
]);

/** 已登记的自定义源数量（弹窗内预检用；上限硬约束仍在 store） */
const customSourceCount = computed<number>(
  () => sources.value.filter((source) => !source.builtin).length,
);

/**
 * 搜索 + 源筛选后的可见条目（筛选到具体源时不做 id 去重，看该源全部产物）
 */
const visibleEntries = computed<readonly PluginMarketEntry[]>(() => {
  const keyword = search.value.trim().toLowerCase();
  const scopedEntries =
    activeRepo.value === FILTER_ALL
      ? entries.value
      : entries.value.filter((entry) => entry.sourceRepo === activeRepo.value);
  if (keyword.length === 0) return scopedEntries;
  return scopedEntries.filter((entry) =>
    [entry.name, entry.id, entry.description].some((text) => text.toLowerCase().includes(keyword)),
  );
});

/** 「全部」视图下加载失败的源（列表下方集中提示） */
const failedSourceRows = computed(() =>
  activeRepo.value === FILTER_ALL
    ? sources.value.filter((source) => stateOf(source.repo) === 'fail')
    : [],
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

/** 空态文案（区分「没装产物」「搜索无匹配」） */
const emptyText = computed<string>(() => {
  if (search.value.trim().length > 0) return PLUGIN_MARKET_NO_MATCH_TEXT;
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
 * 切换源筛选（未加载 / 加载失败的自定义源选中即（重）拉）
 * @param repo 目标源（或 'all'）
 */
const onPickFilter = (repo: string): void => {
  activeRepo.value = repo;
  if (repo !== FILTER_ALL) void ensureSourceLoaded(repo);
};

/** 点「刷新」：当前视图强刷（全部 = 默认源集合；单源 = 该源） */
const onRefresh = (): void => {
  if (activeRepo.value === FILTER_ALL) void loadDefaultSources({ force: true });
  else void ensureSourceLoaded(activeRepo.value, { force: true });
};

/** 打开「添加源」弹窗（清掉上一次的输入与行内错误） */
const openAddDialog = (): void => {
  addInput.value = '';
  addError.value = '';
  addDialogOpen.value = true;
};

/**
 * 添加源弹窗的关闭拦截：确认时先归一化（与 PC 同一纯函数）并预检重复 / 上限，
 * 失败留在弹窗内行内提示；通过后关弹窗并进入第二段风险确认
 * @param action 触发关闭的动作（confirm / cancel）
 * @returns 是否允许关闭
 */
const onAddDialogBeforeClose = (action: string): boolean => {
  if (action !== 'confirm') {
    addError.value = '';
    return true;
  }
  let repo: string;
  try {
    repo = normalizeRepoInput(addInput.value);
  } catch (error) {
    addError.value =
      error instanceof Error ? error.message : MOBILE_PLUGIN_MARKET_SOURCE_ADD_FAIL_TOAST;
    return false;
  }
  if (sources.value.some((source) => source.repo.toLowerCase() === repo.toLowerCase())) {
    addError.value = PLUGIN_MARKET_ERR_SOURCE_DUP;
    return false;
  }
  if (customSourceCount.value >= PLUGIN_MARKET_SOURCE_MAX) {
    addError.value = PLUGIN_MARKET_ERR_SOURCE_MAX(PLUGIN_MARKET_SOURCE_MAX);
    return false;
  }
  requestAddSource(repo);
  return true;
};

/**
 * 添加源的第二段：风险确认（与 PC 同文案）→ addSource 持久化并首拉，结果 Toast 补位
 * @param repo 已归一化的仓库全名
 */
const requestAddSource = (repo: string): void => {
  void showConfirmDialog({
    title: MOBILE_PLUGIN_MARKET_SOURCE_ADD_TITLE,
    message: PLUGIN_MARKET_SOURCE_ADD_CONFIRM(repo),
    confirmButtonText: PLUGIN_MARKET_CONFIRM_OK,
    cancelButtonText: PLUGIN_MARKET_CONFIRM_CANCEL,
  })
    .then(() => {
      void addSource(repo).then((ok) => {
        if (ok) {
          addInput.value = '';
          showToast(MOBILE_PLUGIN_MARKET_SOURCE_ADD_OK_TOAST);
        } else {
          showToast(MOBILE_PLUGIN_MARKET_SOURCE_ADD_FAIL_TOAST);
        }
      });
    })
    .catch(() => undefined);
};

/**
 * 删除一个自定义源（先弹 Vant 确认；正被筛选的源删除后筛选回到「全部」）
 * @param repo 仓库全名
 */
const onRemoveSource = (repo: string): void => {
  void showConfirmDialog({
    title: MOBILE_PLUGIN_MARKET_SOURCE_REMOVE_TITLE,
    message: MOBILE_PLUGIN_MARKET_SOURCE_REMOVE_MESSAGE(repo),
    confirmButtonText: PLUGIN_MARKET_CONFIRM_OK,
    cancelButtonText: PLUGIN_MARKET_CONFIRM_CANCEL,
  })
    .then(() => {
      removeSource(repo);
      if (activeRepo.value === repo) activeRepo.value = FILTER_ALL;
      showToast(MOBILE_PLUGIN_MARKET_SOURCE_REMOVE_OK_TOAST);
    })
    .catch(() => undefined);
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

/**
 * 市场条目是否声明支持移动端（缺省 devices 按仅 PC 口径）
 * @param entry 插件条目
 * @returns 是否移动端可用
 */
const isMobileEntry = (entry: PluginMarketEntry): boolean =>
  (entry.devices ?? PLUGIN_DEVICE_DEFAULT).includes('mobile');

/** 市场卡片按钮的三态视图模型 */
interface EntryAction {
  /** 按钮文案 */
  label: string;
  /** 是否禁用 */
  disabled: boolean;
  /** 是否该插件正在安装（按钮文案转「安装中…」） */
  busy: boolean;
}

/**
 * 最新版按钮的三态（安装 / 更新 / 已安装 / 仅 PC；安装全局串行期间一律禁用）
 * @param entry 插件条目
 * @returns 视图模型
 */
const latestActionOf = (entry: PluginMarketEntry): EntryAction => {
  if (!isMobileEntry(entry)) {
    return { label: MOBILE_PLUGIN_PC_ONLY_LABEL, disabled: true, busy: false };
  }
  const installed = installedVersionOf(entry.id);
  const serialBusy = installing.value !== null;
  if (installing.value?.id === entry.id && installing.value?.version === entry.latest.version) {
    return { label: PLUGIN_MARKET_INSTALLING_LABEL, disabled: true, busy: true };
  }
  if (installed.length > 0 && !isNewerVersion(entry.latest.version, installed)) {
    return { label: PLUGIN_MARKET_INSTALLED_LABEL, disabled: true, busy: false };
  }
  if (installed.length > 0) {
    return { label: PLUGIN_MARKET_UPDATE_LABEL(entry.latest.version), disabled: serialBusy, busy: false };
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
  if (!isMobileEntry(entry)) {
    return { label: MOBILE_PLUGIN_PC_ONLY_LABEL, disabled: true, busy: false };
  }
  if (installing.value?.id === entry.id && installing.value?.version === version.version) {
    return { label: PLUGIN_MARKET_INSTALLING_LABEL, disabled: true, busy: true };
  }
  if (installedVersionOf(entry.id) === version.version) {
    return { label: PLUGIN_MARKET_CURRENT_VERSION_LABEL, disabled: true, busy: false };
  }
  return { label: PLUGIN_MARKET_INSTALL_LABEL, disabled: installing.value !== null, busy: false };
};

/**
 * 安装确认弹窗正文（版本 / 来源 / 体积 / 降级与无校验提醒，多行拼装）
 * @param entry 插件条目
 * @param version 目标版本
 * @returns 正文文案
 */
const installConfirmMessageOf = (entry: PluginMarketEntry, version: PluginMarketVersion): string => {
  const lines: string[] = [];
  lines.push(
    version.version === entry.latest.version
      ? `版本 v${version.version}`
      : `版本 v${version.version}（非最新，最新为 v${entry.latest.version}）`,
  );
  lines.push(
    `来源 ${sourceBadgeOf(entry.sourceRepo)}（${entry.sourceRepo}） · 体积 ${formatBytes(version.zipSize)}`,
  );
  const installed = installedVersionOf(entry.id);
  if (installed.length > 0 && compareVersion(version.version, installed) < 0) {
    lines.push(PLUGIN_MARKET_CONFIRM_DOWNGRADE(installed, version.version));
  }
  if (version.sha256.length === 0 && !entry.builtinSource) {
    lines.push(PLUGIN_MARKET_CONFIRM_NO_CHECKSUM(entry.sourceRepo));
  }
  lines.push(MOBILE_PLUGIN_TRUST_NOTE);
  return lines.join('\n');
};

/**
 * 请求安装（先弹 Vant 确认；确认后走全局串行安装链，结果用 Toast 补位反馈）
 * @param entry 插件条目
 * @param version 目标版本
 */
const requestInstall = (entry: PluginMarketEntry, version: PluginMarketVersion): void => {
  void showConfirmDialog({
    title: PLUGIN_MARKET_CONFIRM_TITLE(entry.name),
    message: installConfirmMessageOf(entry, version),
    confirmButtonText: PLUGIN_MARKET_CONFIRM_OK,
    cancelButtonText: PLUGIN_MARKET_CONFIRM_CANCEL,
  })
    .then(() => {
      void install(entry, version).then((ok) => {
        showToast(ok ? MOBILE_PLUGIN_INSTALL_OK_TOAST : `${MOBILE_PLUGIN_INSTALL_FAIL_TOAST}：${entry.name}`);
      });
    })
    .catch(() => undefined);
};

/**
 * 某个 zip 任务的产物是否仅 PC 可用（解析出定义才可判定）
 * @param task 入队任务
 * @returns 是否仅 PC 端可用
 */
const isPcOnlyTask = (task: PluginPackageIntakeTask): boolean => {
  const definition: PluginDefinition | null = task.definition;
  if (!definition) return false;
  return !(definition.devices ?? PLUGIN_DEVICE_DEFAULT).includes('mobile');
};

/**
 * zip 任务是否允许安装（解析完成、无冲突且声明支持移动端）
 * @param task 入队任务
 * @returns 是否可安装
 */
const canInstallTask = (task: PluginPackageIntakeTask): boolean =>
  task.status === USER_PLUGIN_INTAKE_STATUS.READY && !isPcOnlyTask(task);

/**
 * zip 任务状态对应的展示色类
 * @param status 任务状态
 * @returns 类名（无匹配为空串）
 */
const taskStatusClassOf = (status: UserPluginIntakeStatus): string => {
  if (status === USER_PLUGIN_INTAKE_STATUS.FAILED || status === USER_PLUGIN_INTAKE_STATUS.CONFLICT) {
    return 'm-plugm-task-status--err';
  }
  if (status === USER_PLUGIN_INTAKE_STATUS.INSTALLED) return 'm-plugm-task-status--ok';
  if (status === USER_PLUGIN_INTAKE_STATUS.READY) return 'm-plugm-task-status--on';
  return '';
};

/**
 * zip 任务的六步进度一行文案（①解包 ✓ → ②静态预检 …）
 * @param task 入队任务
 * @returns 进度文案
 */
const taskStepsTextOf = (task: PluginPackageIntakeTask): string =>
  task.steps
    .map(
      (step, index) =>
        `${USER_PLUGIN_INTAKE_STEP_GLYPH[index] ?? ''}${step.label} ${USER_PLUGIN_INTAKE_STEP_MARK[step.state]}`,
    )
    .join(USER_PLUGIN_INTAKE_STEP_SEPARATOR);

/**
 * 用户选择本地 zip 包（多选即批量入队解析；随后清空 input 以便重选同一文件）
 * @param event input change 事件
 */
const onZipFiles = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  if (files.length > 0) enqueue(files);
  input.value = '';
};

/**
 * 从队列移除一个 zip 任务（被释放的同 id 包自动回到待安装）
 * @param uid 任务 uid
 */
const onRemoveTask = (uid: string): void => {
  removeIntakeTask(uid);
};

/**
 * 安装单个 zip 任务（解析完成且移动端可用；结果用 Toast 反馈）
 * @param task 入队任务
 */
const onInstallTask = (task: PluginPackageIntakeTask): void => {
  void installOne(task.uid).then((ok) => {
    showToast(ok ? MOBILE_PLUGIN_INSTALL_OK_TOAST : `${MOBILE_PLUGIN_INSTALL_FAIL_TOAST}：${task.fileName}`);
  });
};

/** 「待安装且全部为移动端可用包」时才提供批量安装（含 PC-only 包的混合批次只允许逐个装，避免绕过端别门控） */
const canInstallAll = computed<boolean>(() => {
  const ready = tasks.value.filter((task) => task.status === USER_PLUGIN_INTAKE_STATUS.READY);
  return ready.length > 0 && ready.every((task) => !isPcOnlyTask(task));
});

/** 批量安装全部可安装的 zip 包（先弹确认；串行由 intake 内部保证） */
const onInstallAll = (): void => {
  if (!canInstallAll.value || intakeBusy.value) return;
  void showConfirmDialog({
    title: USER_PLUGIN_INTAKE_INSTALL_ALL_LABEL(installableCount.value),
    message: `将按上传顺序串行安装 ${installableCount.value} 个插件包（与应用同权限运行）。是否继续？`,
    confirmButtonText: PLUGIN_MARKET_CONFIRM_OK,
    cancelButtonText: PLUGIN_MARKET_CONFIRM_CANCEL,
  })
    .then(() => {
      void installAll().then((summary) => {
        showToast(
          summary.failed === 0
            ? `${MOBILE_PLUGIN_INSTALL_OK_TOAST}（${summary.installed} 个）`
            : `${MOBILE_PLUGIN_INSTALL_FAIL_TOAST}：成功 ${summary.installed} 个，失败 ${summary.failed} 个`,
        );
      });
    })
    .catch(() => undefined);
};

/** 返回上一页 */
const goBack = (): void => {
  router.back();
};
</script>

<template>
  <!-- m-sub-page：≥600px 大屏限宽居中（mobile.css 断点适配分档） -->
  <div class="m-sub-page">
    <van-nav-bar
      :title="MOBILE_PLUGIN_MARKET_TITLE"
      class="m-nav"
      fixed
      placeholder
      safe-area-inset-top
      left-arrow
      @click-left="goBack"
    />

    <p class="m-plugm-risk">⚠️ {{ PLUGIN_MARKET_RISK_NOTICE }}</p>

    <!-- ==== 在线市场 ==== -->
    <div class="m-set-label">{{ MOBILE_PLUGIN_MARKET_SECTION_ONLINE }}</div>

    <div class="m-plugm-toolbar">
      <van-search v-model="search" :placeholder="PLUGIN_MARKET_SEARCH_PLACEHOLDER" class="m-plugm-search" />
      <button class="m-plugm-refresh" @click="onRefresh">{{ PLUGIN_MARKET_REFRESH_LABEL }}</button>
    </div>

    <div class="m-plugm-chips">
      <button
        v-for="option in filterOptions"
        :key="option.repo"
        class="m-plugm-chip"
        :class="{ 'm-plugm-chip--on': activeRepo === option.repo }"
        @click="onPickFilter(option.repo)"
      >
        {{ option.label }}
      </button>
      <button class="m-plugm-chip m-plugm-chip--add" @click="openAddDialog">
        ＋ {{ PLUGIN_MARKET_SOURCE_ADD_LABEL }}
      </button>
    </div>

    <!-- 源管理（折叠：全部源清单 + 自定义源删除） -->
    <div class="m-plugm-src">
      <button class="m-plugm-src-toggle" @click="sourcePanelOpen = !sourcePanelOpen">
        <span>{{ PLUGIN_MARKET_SOURCE_PANEL_TITLE }}（{{ sources.length }}）</span>
        <span class="m-plugm-src-arrow" :class="{ 'm-plugm-src-arrow--open': sourcePanelOpen }">▾</span>
      </button>
      <template v-if="sourcePanelOpen">
        <p class="m-plugm-src-hint">{{ PLUGIN_MARKET_SOURCE_PANEL_HINT }}</p>
        <div v-for="source in sources" :key="source.repo" class="m-plugm-src-row">
          <div class="m-plugm-src-info">
            <span class="m-plugm-src-label">
              {{ source.label }}
              <span v-if="source.builtin" class="m-plugm-src-badge">{{ PLUGIN_MARKET_SOURCE_BUILTIN_BADGE }}</span>
            </span>
            <span class="m-plugm-src-repo">{{ source.repo }}</span>
          </div>
          <button
            v-if="!source.builtin"
            class="m-plugm-src-remove"
            @click="onRemoveSource(source.repo)"
          >
            {{ PLUGIN_MARKET_SOURCE_REMOVE_LABEL }}
          </button>
        </div>
      </template>
    </div>

    <!-- 「全部」视图下加载失败的源（集中提示 + 就地重试） -->
    <div v-for="source in failedSourceRows" :key="source.repo" class="m-plugm-fail">
      <span class="m-plugm-fail-t">
        {{ source.label }}：{{ PLUGIN_MARKET_FAIL_PREFIX }}{{ errorOf(source.repo) }}
      </span>
      <button class="m-plugm-fail-btn" @click="onRefresh">{{ PLUGIN_MARKET_RETRY_LABEL }}</button>
    </div>

    <!-- 加载态 / 空态 -->
    <div v-if="isLoading" class="m-plugm-state">{{ MOBILE_PLUGIN_MARKET_LOADING_TEXT }}</div>
    <div v-else-if="visibleEntries.length === 0 && emptyText" class="m-plugm-state">{{ emptyText }}</div>

    <!-- 插件卡（单列） -->
    <template v-else>
      <article
        v-for="entry in visibleEntries"
        :key="`${entry.sourceRepo}/${entry.id}`"
        class="m-plugm-card"
      >
        <div class="m-plugm-card__head">
          <div class="m-plugm-card__name">
            {{ entry.name }}
            <span class="m-plugm-card__ver">v{{ entry.latest.version }}</span>
          </div>
          <button
            class="m-plugm-btn"
            :class="{ 'm-plugm-btn--busy': latestActionOf(entry).busy }"
            :disabled="latestActionOf(entry).disabled"
            @click="requestInstall(entry, entry.latest)"
          >
            {{ latestActionOf(entry).label }}
          </button>
        </div>
        <p v-if="entry.description" class="m-plugm-card__desc">{{ entry.description }}</p>
        <div class="m-plugm-card__tags">
          <span
            v-if="isMobileEntry(entry)"
            class="m-plugm-card__tag m-plugm-card__tag--on"
          >
            {{ PLUGIN_MOBILE_READY_BADGE }}
          </span>
          <span class="m-plugm-card__tag">{{ sourceBadgeOf(entry.sourceRepo) }}</span>
        </div>
        <div class="m-plugm-card__meta">
          {{ entry.id }}<template v-if="entry.author"> · {{ entry.author }}</template>
          · {{ formatBytes(entry.latest.zipSize) }}
        </div>
        <button
          v-if="entry.history.length > 0 && isMobileEntry(entry)"
          class="m-plugm-history-toggle"
          @click="toggleHistory(entry.id)"
        >
          {{ expandedIds.has(entry.id) ? PLUGIN_MARKET_HISTORY_COLLAPSE_LABEL : PLUGIN_MARKET_HISTORY_TOGGLE_LABEL }} ▾
        </button>
        <div v-if="expandedIds.has(entry.id)" class="m-plugm-history">
          <div class="m-plugm-history__t">{{ PLUGIN_MARKET_HISTORY_TITLE }}</div>
          <div
            v-for="version in entry.history"
            :key="version.zipName"
            class="m-plugm-history__row"
          >
            <div class="m-plugm-history__info">
              <span class="m-plugm-history__ver">v{{ version.version }}</span>
              <span class="m-plugm-history__date">
                {{ version.publishedAt.length >= 10 ? version.publishedAt.slice(0, 10) : '' }}
              </span>
              <span class="m-plugm-history__size">{{ formatBytes(version.zipSize) }}</span>
            </div>
            <button
              class="m-plugm-btn m-plugm-btn--sm"
              :disabled="historyActionOf(entry, version).disabled"
              @click="requestInstall(entry, version)"
            >
              {{ historyActionOf(entry, version).label }}
            </button>
          </div>
        </div>
      </article>
    </template>

    <!-- ==== 本地安装（zip 包） ==== -->
    <div class="m-set-label">{{ MOBILE_PLUGIN_MARKET_SECTION_LOCAL }}</div>
    <div class="m-plugm-card m-plugm-local">
      <p class="m-plugm-local-hint">{{ MOBILE_PLUGIN_MARKET_LOCAL_HINT }}</p>
      <button class="m-plugm-pick" :disabled="intakeBusy" @click="zipInput?.click()">
        {{ MOBILE_PLUGIN_ZIP_PICK_LABEL }}
      </button>
      <input
        ref="zipInput"
        type="file"
        :accept="MOBILE_PLUGIN_ZIP_ACCEPT"
        multiple
        hidden
        @change="onZipFiles"
      />

      <div v-for="task in tasks" :key="task.uid" class="m-plugm-task">
        <div class="m-plugm-task-head">
          <span class="m-plugm-task-name">{{ task.fileName }}</span>
          <span class="m-plugm-task-status" :class="taskStatusClassOf(task.status)">
            {{ USER_PLUGIN_INTAKE_STATUS_LABEL[task.status] }}
          </span>
        </div>
        <div class="m-plugm-task-steps">{{ taskStepsTextOf(task) }}</div>
        <p v-if="task.error" class="m-plugm-task-note m-plugm-task-note--err">{{ task.error }}</p>
        <p v-if="task.conflict" class="m-plugm-task-note m-plugm-task-note--err">{{ task.conflict }}</p>
        <p v-if="task.warnings.length > 0" class="m-plugm-task-note">{{ task.warnings.join('；') }}</p>
        <p v-if="isPcOnlyTask(task)" class="m-plugm-task-note m-plugm-task-note--err">
          {{ MOBILE_PLUGIN_PC_ONLY_LABEL }}
        </p>
        <div class="m-plugm-task-foot">
          <button
            v-if="canInstallTask(task)"
            class="m-plugm-btn m-plugm-btn--sm"
            :disabled="intakeBusy"
            @click="onInstallTask(task)"
          >
            {{ PLUGIN_MARKET_INSTALL_LABEL }}
          </button>
          <button class="m-plugm-task-remove" :disabled="intakeBusy" @click="onRemoveTask(task.uid)">
            {{ MOBILE_PLUGIN_ZIP_REMOVE_LABEL }}
          </button>
        </div>
      </div>

      <button
        v-if="canInstallAll"
        class="m-plugm-pick"
        :disabled="intakeBusy"
        @click="onInstallAll"
      >
        {{ USER_PLUGIN_INTAKE_INSTALL_ALL_LABEL(installableCount) }}
      </button>
    </div>

    <!-- 添加源弹窗（归一化 / 重复 / 超限失败留在弹窗内行内提示） -->
    <van-dialog
      v-model:show="addDialogOpen"
      :title="MOBILE_PLUGIN_MARKET_SOURCE_ADD_TITLE"
      teleport="body"
      show-cancel-button
      :before-close="onAddDialogBeforeClose"
    >
      <div class="m-plugm-add">
        <van-field v-model="addInput" :placeholder="PLUGIN_MARKET_SOURCE_INPUT_PLACEHOLDER" />
        <p v-if="addError" class="m-plugm-add-err">{{ addError }}</p>
      </div>
    </van-dialog>

    <div class="m-foot-note">{{ MOBILE_PLUGIN_TRUST_NOTE }}</div>
  </div>
</template>

<style scoped>
/* 风险提示条 */
.m-plugm-risk {
  margin: 10px 12px 0;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--color-up-weak);
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-2);
}
/* 工具行：搜索 + 刷新 */
.m-plugm-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px;
}
.m-plugm-search {
  flex: 1;
  min-width: 0;
  padding: 0;
  background: transparent;
}
.m-plugm-search :deep(.van-search__content) {
  background: var(--color-surface);
  border-radius: 10px;
}
.m-plugm-refresh {
  flex-shrink: 0;
  padding: 7px 14px;
  border: 0;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: 12.5px;
  font-weight: 700;
}
/* 源筛选 chips */
.m-plugm-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 12px 0;
}
.m-plugm-chip {
  padding: 5px 12px;
  border: 0;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-text-2);
  font-size: 11.5px;
  font-weight: 600;
}
.m-plugm-chip--on {
  background: var(--color-primary-weak);
  color: var(--color-primary);
  font-weight: 700;
}
/* 「添加源」入口 chip（筛选行尾） */
.m-plugm-chip--add {
  background: transparent;
  border: 1px dashed var(--color-primary);
  color: var(--color-primary);
}
/* 源管理折叠卡 */
.m-plugm-src {
  margin: 10px 12px 0;
  padding: 10px 12px;
  background: var(--color-surface);
  border-radius: 12px;
}
.m-plugm-src-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-text-2);
}
.m-plugm-src-arrow {
  color: var(--color-text-3);
  font-size: 11px;
  transition: transform 0.2s ease;
}
.m-plugm-src-arrow--open {
  transform: rotate(180deg);
}
.m-plugm-src-hint {
  margin-top: 7px;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--color-text-3);
}
.m-plugm-src-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--color-primary-weak);
}
.m-plugm-src-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-plugm-src-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-plugm-src-badge {
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 700;
  background: var(--color-primary);
  color: #fff;
}
.m-plugm-src-repo {
  font-size: 10px;
  color: var(--color-text-3);
  font-family: var(--font-num);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-plugm-src-remove {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: var(--color-up);
  font-size: 11.5px;
  font-weight: 700;
}
/* 添加源弹窗内部 */
.m-plugm-add {
  padding: 14px 16px 4px;
}
.m-plugm-add :deep(.van-field) {
  background: var(--color-primary-weak);
  border-radius: 8px;
}
.m-plugm-add-err {
  margin: 8px 2px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-up);
  word-break: break-all;
}
/* 失败源提示条 */
.m-plugm-fail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 8px 12px 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--color-up-weak);
}
.m-plugm-fail-t {
  min-width: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-up);
  word-break: break-all;
}
.m-plugm-fail-btn {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: var(--color-up);
  font-size: 12px;
  font-weight: 700;
}
/* 加载 / 空态 */
.m-plugm-state {
  margin: 32px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-3);
}
/* 插件卡 */
.m-plugm-card {
  margin: 10px 12px 0;
  padding: 13px 14px;
  background: var(--color-surface);
  border-radius: 12px;
}
.m-plugm-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.m-plugm-card__name {
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-plugm-card__ver {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-3);
  font-family: var(--font-num);
}
.m-plugm-card__desc {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-2);
}
.m-plugm-card__tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
}
.m-plugm-card__tag {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  background: var(--color-primary-weak);
  color: var(--color-primary);
}
.m-plugm-card__tag--on {
  background: var(--color-down-weak);
  color: var(--color-down);
}
.m-plugm-card__meta {
  margin-top: 8px;
  font-size: 10.5px;
  color: var(--color-text-3);
  font-family: var(--font-num);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 主操作按钮 */
.m-plugm-btn {
  flex-shrink: 0;
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: var(--color-primary);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.m-plugm-btn:disabled {
  background: var(--color-primary-weak);
  color: var(--color-text-3);
}
.m-plugm-btn--sm {
  padding: 4px 11px;
  font-size: 11px;
}
/* 历史版本区 */
.m-plugm-history-toggle {
  margin-top: 9px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-3);
  font-size: 11.5px;
  font-weight: 600;
}
.m-plugm-history {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}
.m-plugm-history__t {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-2);
}
.m-plugm-history__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--color-primary-weak);
}
.m-plugm-history__info {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--color-text-2);
}
.m-plugm-history__ver {
  font-family: var(--font-num);
  font-weight: 700;
  color: var(--color-text);
}
.m-plugm-history__date,
.m-plugm-history__size {
  font-family: var(--font-num);
  font-size: 10px;
  color: var(--color-text-3);
}
/* 本地安装区 */
.m-plugm-local-hint {
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-3);
}
.m-plugm-pick {
  width: 100%;
  margin-top: 10px;
  padding: 9px 0;
  border: 0;
  border-radius: 999px;
  background: var(--color-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}
.m-plugm-pick:disabled {
  opacity: 0.6;
}
/* zip 任务卡 */
.m-plugm-task {
  margin-top: 10px;
  padding: 10px 11px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
}
.m-plugm-task-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.m-plugm-task-name {
  min-width: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-plugm-task-status {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-3);
}
.m-plugm-task-status--on {
  color: var(--color-primary);
}
.m-plugm-task-status--ok {
  color: var(--color-down);
}
.m-plugm-task-status--err {
  color: var(--color-up);
}
.m-plugm-task-steps {
  margin-top: 6px;
  font-size: 10px;
  line-height: 1.6;
  color: var(--color-text-3);
  font-family: var(--font-num);
  word-break: break-all;
}
.m-plugm-task-note {
  margin-top: 5px;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--color-text-2);
  word-break: break-all;
}
.m-plugm-task-note--err {
  color: var(--color-up);
}
.m-plugm-task-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
.m-plugm-task-remove {
  border: 0;
  background: transparent;
  color: var(--color-text-3);
  font-size: 11.5px;
  font-weight: 600;
}
.m-plugm-task-remove:disabled {
  opacity: 0.5;
}
</style>
