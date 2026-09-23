<script setup lang="ts">
import { computed } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseTag from '../ui/BaseTag.vue';
import { BUILTIN_PLUGINS } from '../../plugins';
import { useUserPluginsStore } from '../../stores/user-plugins';
import {
  USER_PLUGIN_AUTHOR_LABEL,
  USER_PLUGIN_INTAKE_CONFLICT_HINT,
  USER_PLUGIN_INTAKE_INSTALL_LABEL,
  USER_PLUGIN_INTAKE_META_AUTHOR,
  USER_PLUGIN_INTAKE_META_ID,
  USER_PLUGIN_INTAKE_META_VERSION,
  USER_PLUGIN_INTAKE_PKG_ENTRY,
  USER_PLUGIN_INTAKE_PKG_FILES,
  USER_PLUGIN_INTAKE_PKG_HAS_MANIFEST,
  USER_PLUGIN_INTAKE_PKG_NO_MANIFEST,
  USER_PLUGIN_INTAKE_REMOVE_LABEL,
  USER_PLUGIN_INTAKE_STATUS,
  USER_PLUGIN_INTAKE_STATUS_LABEL,
  USER_PLUGIN_INTAKE_STATUS_TONE,
  USER_PLUGIN_INTAKE_STEP_GLYPH,
  USER_PLUGIN_INTAKE_STEP_MARK,
  USER_PLUGIN_INTAKE_STEP_SEPARATOR,
  USER_PLUGIN_INTAKE_STEP_STATE,
  USER_PLUGIN_INTAKE_TAKEOVER_HINT,
  USER_PLUGIN_INTAKE_UPGRADE_HINT,
  USER_PLUGIN_INTAKE_WARN_TITLE,
  USER_PLUGIN_README_PREVIEW_MAX,
} from '../../constants/plugin.constants';
import type { PluginPackageIntakeTask } from '../../composables/use-plugin-package-intake';
import type { UserPluginIntakeStepState } from '../../constants/plugin.constants';

/**
 * 插件包入队卡片（批量安装弹窗里「一个包 = 一张卡」）
 *
 * 一张卡就是一个包的六步流水线：文件名 + 状态 + 进度条（`①解包 ✓ → ②静态预检 …`），
 * 解析中显示转圈，失败时**整张卡被红框包裹**并原样输出错误文案（多行保留换行），
 * 包间冲突走 primary 提示框并给出「先上传者优先」的仲裁说明。
 *
 * 卡片只做展示与发射意图（`remove` / `install`），队列操作由持有 `usePluginPackageIntake`
 * 的弹窗执行 —— 它自己不碰队列，也不需要知道冲突是怎么算出来的。
 */
const props = withDefaults(
  defineProps<{
    /** 入队任务（解析进度、结果与冲突说明全在里头） */
    task: PluginPackageIntakeTask;
    /**
     * 整批是否正在推进（批量安装进行中）
     *
     * 批量安装是串行的，还没轮到它的任务仍然是 `ready` —— 此时「安装 / 移除」必须禁用，
     * 否则用户的一次点击会与正在串行的 `await install()` 并发（内核 unuse/use 与 store
     * 写入互相踩踏），移除更会让正在执行的任务凭空消失。
     */
    busy?: boolean;
  }>(),
  { busy: false },
);

const emit = defineEmits<{
  /** 请求把该任务移出队列（冲突卡靠它让位给后来者） */
  remove: [uid: string];
  /** 请求单独安装该包 */
  install: [uid: string];
}>();

const userPluginsStore = useUserPluginsStore();

/** 卡片标题（产物名优先，其次清单名，都没有时给个中性占位） */
const title = computed<string>(() =>
  props.task.definition?.name
  || props.task.pkg?.manifest.name
  || '待解析的插件包');

/** 版本标签内容（清单或产物任一给出即可，都没有时不渲染标签） */
const versionTag = computed<string>(() =>
  props.task.definition?.version ?? props.task.pkg?.manifest.version ?? '');

/** 状态文案 */
const statusLabel = computed<string>(() => USER_PLUGIN_INTAKE_STATUS_LABEL[props.task.status]);

/** 状态标签色调 */
const statusTone = computed<'primary' | 'up' | 'down' | 'flat'>(
  () => USER_PLUGIN_INTAKE_STATUS_TONE[props.task.status],
);

/** 是否解析失败（整张卡走红框） */
const isFailed = computed<boolean>(
  () => props.task.status === USER_PLUGIN_INTAKE_STATUS.FAILED,
);

/** 是否被包间冲突拦下（整张卡走主色框） */
const isConflict = computed<boolean>(
  () => props.task.status === USER_PLUGIN_INTAKE_STATUS.CONFLICT,
);

/** 是否正在解析（显示转圈） */
const isParsing = computed<boolean>(
  () => props.task.status === USER_PLUGIN_INTAKE_STATUS.PARSING,
);

/** 是否正在安装（期间禁用操作，避免重复提交） */
const isInstalling = computed<boolean>(
  () => props.task.status === USER_PLUGIN_INTAKE_STATUS.INSTALLING,
);

/** 是否已装（只有装上的卡才隐藏操作区） */
const isInstalled = computed<boolean>(
  () => props.task.status === USER_PLUGIN_INTAKE_STATUS.INSTALLED,
);

/** 是否可单独安装（解析完成且无冲突） */
const canInstall = computed<boolean>(
  () => props.task.status === USER_PLUGIN_INTAKE_STATUS.READY,
);

/** 卡片外框：失败 = 红框包裹整张卡；冲突 = 主色框；其余 = 常规卡 */
const cardClass = computed<string>(() => {
  if (isFailed.value) return 'border-up/40 bg-up/10';
  if (isConflict.value) return 'border-primary/40 bg-primary-weak/40';
  return 'border-flat-weak bg-surface';
});

/**
 * 进度条里单个步骤的配色（当前步主色 + 呼吸，失败步红色，未执行灰）
 * @param state 步骤状态
 * @returns 类名
 */
const stepClass = (state: UserPluginIntakeStepState): string => {
  if (state === USER_PLUGIN_INTAKE_STEP_STATE.RUNNING) return 'animate-pulse text-primary';
  if (state === USER_PLUGIN_INTAKE_STEP_STATE.DONE) return 'text-text-secondary';
  if (state === USER_PLUGIN_INTAKE_STEP_STATE.FAILED) return 'text-up';
  return 'text-text-tertiary';
};

/**
 * 步骤序号的圈字符
 * @param index 步骤下标
 * @returns 圈字符（下标越界时退化为空串）
 */
const glyphOf = (index: number): string => USER_PLUGIN_INTAKE_STEP_GLYPH[index] ?? '';

/**
 * 步骤状态标记符号
 * @param state 步骤状态
 * @returns 标记符号
 */
const markOf = (state: UserPluginIntakeStepState): string =>
  USER_PLUGIN_INTAKE_STEP_MARK[state];

/** 同 id 的已安装记录（存在 = 本次是升级 / 覆盖重装） */
const existingRecord = computed(() => {
  const id = props.task.definition?.id;
  if (!id) return null;
  return userPluginsStore.records.find((record) => record.id === id) ?? null;
});

/** 同 id 的内置插件（存在 = 本次是接管内置版） */
const builtinPlugin = computed(() => {
  const id = props.task.definition?.id;
  if (!id) return null;
  return BUILTIN_PLUGINS.find((plugin) => plugin.id === id) ?? null;
});

/** 升级 / 重装提示（首次安装时为空串） */
const upgradeHint = computed<string>(() => {
  const previous = existingRecord.value;
  const definition = props.task.definition;
  if (!previous || !definition) return '';
  return USER_PLUGIN_INTAKE_UPGRADE_HINT(previous.version, definition.version);
});

/** 接管内置版提示（已装过用户版或没有同名内置时为空串） */
const takeoverHint = computed<string>(() => {
  if (!builtinPlugin.value || existingRecord.value || !props.task.definition) return '';
  return USER_PLUGIN_INTAKE_TAKEOVER_HINT(builtinPlugin.value.version);
});

/** 产物元信息行（id / 版本 / 作者） */
const metaLines = computed<string[]>(() => {
  const definition = props.task.definition;
  if (!definition) return [];
  const author = definition.author || props.task.pkg?.manifest.author || USER_PLUGIN_AUTHOR_LABEL;
  return [
    USER_PLUGIN_INTAKE_META_ID(definition.id),
    USER_PLUGIN_INTAKE_META_VERSION(definition.version),
    USER_PLUGIN_INTAKE_META_AUTHOR(author),
  ];
});

/** 包信息行（入口 / 文件数 / 清单有无） */
const packageLines = computed<string[]>(() => {
  const pkg = props.task.pkg;
  if (!pkg) return [];
  return [
    USER_PLUGIN_INTAKE_PKG_ENTRY(pkg.entryPath),
    USER_PLUGIN_INTAKE_PKG_FILES(pkg.files.length),
    pkg.hasManifest ? USER_PLUGIN_INTAKE_PKG_HAS_MANIFEST : USER_PLUGIN_INTAKE_PKG_NO_MANIFEST,
  ];
});

/** README 预览文本（超长截断） */
const readmePreview = computed<string>(() => {
  const text = props.task.pkg?.readme ?? '';
  if (text.length <= USER_PLUGIN_README_PREVIEW_MAX) return text;
  return `${text.slice(0, USER_PLUGIN_README_PREVIEW_MAX)}…`;
});
</script>

<template>
  <div class="rounded-card border px-3 py-2.5" :class="cardClass">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span
            v-if="isParsing || isInstalling"
            class="h-3 w-3 shrink-0 animate-spin rounded-full border border-flat-weak border-t-primary"
            aria-hidden="true"
          />
          <span class="truncate text-sm font-medium text-text">{{ title }}</span>
          <BaseTag :tone="statusTone">{{ statusLabel }}</BaseTag>
          <BaseTag v-if="versionTag" tone="flat">v{{ versionTag }}</BaseTag>
        </div>
        <p class="mt-0.5 truncate text-xs text-text-tertiary">{{ task.fileName }}</p>
      </div>
      <div v-if="!isInstalled" class="flex shrink-0 items-center gap-1.5">
        <BaseButton
          v-if="canInstall"
          variant="primary"
          :disabled="busy"
          @click="emit('install', task.uid)"
        >
          {{ USER_PLUGIN_INTAKE_INSTALL_LABEL }}
        </BaseButton>
        <BaseButton
          variant="ghost"
          :disabled="busy || isInstalling"
          @click="emit('remove', task.uid)"
        >
          {{ USER_PLUGIN_INTAKE_REMOVE_LABEL }}
        </BaseButton>
      </div>
    </div>

    <div class="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
      <template v-for="(step, index) in task.steps" :key="step.key">
        <span v-if="index > 0" class="text-text-tertiary">{{ USER_PLUGIN_INTAKE_STEP_SEPARATOR }}</span>
        <span :class="stepClass(step.state)">
          {{ glyphOf(index) }}{{ step.label }} {{ markOf(step.state) }}
        </span>
      </template>
    </div>

    <p v-if="task.error" class="mt-1.5 whitespace-pre-line text-xs text-up">
      {{ task.error }}
    </p>

    <div
      v-if="task.conflict"
      class="mt-1.5 rounded-card border border-primary/30 bg-primary-weak/60 px-2.5 py-1.5"
    >
      <p class="text-xs text-primary">{{ task.conflict }}</p>
      <p class="mt-0.5 text-xs text-text-secondary">{{ USER_PLUGIN_INTAKE_CONFLICT_HINT }}</p>
    </div>

    <div
      v-if="task.warnings.length > 0"
      class="mt-1.5 rounded-card border border-primary/30 bg-primary-weak/60 px-2.5 py-1.5"
    >
      <p class="text-xs font-medium text-primary">{{ USER_PLUGIN_INTAKE_WARN_TITLE }}</p>
      <!-- key 用下标不用文案：两条提醒文本完全一样时文案 key 会撞车 -->
      <p
        v-for="(line, warnIndex) in task.warnings"
        :key="warnIndex"
        class="mt-0.5 whitespace-pre-line text-xs text-text-secondary"
      >
        {{ line }}
      </p>
    </div>

    <template v-if="task.definition">
      <p class="mt-1.5 text-xs text-text-secondary">{{ task.definition.description }}</p>
      <p class="mt-0.5 text-xs text-text-tertiary">{{ metaLines.join(' · ') }}</p>
      <p class="text-xs text-text-tertiary">{{ packageLines.join(' · ') }}</p>
      <p v-if="upgradeHint" class="mt-0.5 text-xs text-primary">{{ upgradeHint }}</p>
      <p v-if="takeoverHint" class="mt-0.5 text-xs text-primary">{{ takeoverHint }}</p>
    </template>

    <details v-if="readmePreview" class="mt-1.5 text-xs text-text-tertiary">
      <summary class="cursor-pointer select-none hover:text-text-secondary">README</summary>
      <pre
        class="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-card bg-flat-weak px-2.5 py-2 font-mono text-xs leading-relaxed text-text-secondary"
      >{{ readmePreview }}</pre>
    </details>
  </div>
</template>
