<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { useSettingsStore } from '../../stores/settings';
import { useTheme } from '../../composables/use-theme';
import { THEME_COLOR_OPTIONS } from '../../constants/theme-color.constants';
import { TREND_THEME_OPTIONS } from '../../constants/trend-theme.constants';
import {
  FIRST_RUN_APPEARANCE_HINT,
  FIRST_RUN_APPEARANCE_LABEL,
  FIRST_RUN_APPEARANCE_OPTIONS,
  FIRST_RUN_BADGE,
  FIRST_RUN_DONE_BUTTON,
  FIRST_RUN_PREVIEW_ALT,
  FIRST_RUN_PREVIEW_SRC,
  FIRST_RUN_SETTINGS_BADGE,
  FIRST_RUN_SETTINGS_DESC,
  FIRST_RUN_SETTINGS_DONE_BUTTON,
  FIRST_RUN_SETTINGS_TITLE,
  FIRST_RUN_THEME_LABEL,
  FIRST_RUN_TITLE,
  FIRST_RUN_TREND_HINT,
  FIRST_RUN_TREND_LABEL,
  FIRST_RUN_WELCOME_DESC,
} from '../../constants/first-run.constants';

/**
 * 初始设置引导弹窗（两处入口共用）
 *
 * **首次启动**：新用户第一次打开软件时由 MainLayout 自动弹出一次；
 * **设置页**：设置页「主题设置」按钮手动唤起（`mode: 'settings'`）。
 *
 * 版式：左右分栏向导 ——
 * 左栏（固定深色）展示界面预览图 + 欢迎语，右栏依次是明暗模式 / 系统主题色 /
 * 涨跌主题色三组选项，底部固定确认按钮；窄屏下左栏隐藏、只留设置栏。
 *
 * 三项偏好全部**即时生效**（明暗写 <html class="dark">、主题色 / 涨跌配色经
 * useDocumentThemeSync 写 <html data-theme / data-trend>），选项与设置页同源
 * （同一份常量 + 同一个 settings store），这里选完设置页即同步。
 *
 * 未复用 BaseModal：本弹窗无标题栏、需整块接管卡片排版（左右分栏），
 * 与 BaseModal「标题栏 + 正文 + 操作栏」的结构冲突，故遮罩 / ESC / 滚动锁在此自行实现。
 *
 * **纯受控组件**：关闭只 emit `update:open`，是否记「引导已完成」由调用方决定 ——
 * 首次启动那次由 MainLayout 记位，设置页那次不碰标记（否则老用户点开又关掉会误写）。
 */
const props = withDefaults(
  defineProps<{
    /** 弹窗语境：首次启动引导 / 设置页主题设置（仅文案不同，交互一致） */
    mode?: 'first-run' | 'settings';
  }>(),
  { mode: 'first-run' },
);

const open = defineModel<boolean>('open', { required: true });

const settingsStore = useSettingsStore();
const { isDark, toggleDark } = useTheme();

/** 是否设置页语境（决定左栏标题与完成按钮用哪一套文案） */
const isSettingsMode = computed(() => props.mode === 'settings');

/** 左栏大标题（同时作为 role=dialog 的 aria-label） */
const modalTitle = computed(() => (isSettingsMode.value ? FIRST_RUN_SETTINGS_TITLE : FIRST_RUN_TITLE));

/** 右栏顶部小标签 */
const badgeText = computed(() => (isSettingsMode.value ? FIRST_RUN_SETTINGS_BADGE : FIRST_RUN_BADGE));

/** 左栏副标题 */
const welcomeText = computed(() =>
  isSettingsMode.value ? FIRST_RUN_SETTINGS_DESC : FIRST_RUN_WELCOME_DESC,
);

/** 完成按钮文案 */
const doneButtonText = computed(() =>
  isSettingsMode.value ? FIRST_RUN_SETTINGS_DONE_BUTTON : FIRST_RUN_DONE_BUTTON,
);

/** 关闭弹窗（完成引导 / 主题设置均走此处；是否记为「已完成」由调用方按 mode 决定） */
const onDone = (): void => {
  open.value = false;
};

/**
 * 全局 ESC 监听：仅在打开时挂载（捕获阶段）
 *
 * 用捕获阶段 + stopImmediatePropagation 截断：本弹窗可能从设置抽屉里唤起，
 * 而 BaseDrawer 也监听 ESC（冒泡阶段），不截断的话一次 ESC 会把弹窗和下层抽屉一起关掉。
 * @param event 键盘事件
 */
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return;
  event.stopImmediatePropagation();
  onDone();
};

// 交互副作用（监听 + body 滚动锁）：immediate 兜底「挂载时就是打开态」
// —— 首次启动走的就是这条路径，否则首帧即打开的弹窗永远挂不上监听
watch(
  open,
  (isOpen) => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeydown, true);
      document.body.style.overflow = 'hidden';
    } else {
      document.removeEventListener('keydown', handleKeydown, true);
      document.body.style.overflow = '';
    }
  },
  { immediate: true },
);

// 「引导已完成」标记不在此处落库：同一弹窗被设置页复用，只有首次启动那次才算完成引导 ——
// 由 MainLayout 在 v-model:open 的 setter 里写 settings.setupCompleted（见组件顶部说明）。

/** 组件卸载兜底清理（避免快速路由切换时残留监听） */
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown, true);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <!-- z-[70]：需压过设置抽屉（z-50）与通知浮层（z-60）——本弹窗从设置页唤起时抽屉仍在打开态 -->
      <div
        v-if="open"
        class="fixed inset-0 z-[70] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        :aria-label="modalTitle"
      >
        <!-- 遮罩（独立点击关闭，避免冒泡到卡片） -->
        <div class="absolute inset-0 bg-black/45" @click="onDone" />

        <!-- 向导卡片 -->
        <div
          class="relative z-10 flex max-h-[85dvh] w-full max-w-4xl overflow-hidden rounded-2xl bg-surface shadow-2xl"
          @click.stop
        >
          <!-- 关闭（右上角，落在右栏区域，颜色跟随主题） -->
          <button
            type="button"
            class="pressable absolute right-3 top-3 z-20 rounded-full p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
            aria-label="关闭"
            @click="onDone"
          >
            <MenuIcon name="close" :size="16" />
          </button>

          <!-- 左栏：界面预览 + 欢迎语（窄屏隐藏，只保留设置栏） -->
          <div
            class="hidden w-1/2 shrink-0 flex-col justify-between overflow-hidden bg-neutral-950 p-6 md:flex"
          >
            <!-- 预览图：等比完整渲染（max-w/max-h + object-contain），容器内居中，不裁剪、不溢出。
                 圆角描边直接落在 img 上 —— 容器高度由右栏撑开时，避免出现「空相框」留白。 -->
            <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <img
                :src="FIRST_RUN_PREVIEW_SRC"
                :alt="FIRST_RUN_PREVIEW_ALT"
                class="block max-h-full max-w-full rounded-xl border border-white/10 object-contain shadow-lg"
              />
            </div>
            <div class="mt-6 shrink-0">
              <h2 class="text-xl font-bold text-white">{{ modalTitle }}</h2>
              <p class="mt-2 text-xs leading-relaxed text-white/55">{{ welcomeText }}</p>
            </div>
          </div>

          <!-- 右栏：外观偏好 + 确认 -->
          <div class="flex min-w-0 flex-1 flex-col">
            <div class="min-h-0 flex-1 overflow-y-auto px-7 pb-5 pt-6">
              <p class="text-xs font-medium text-text-tertiary">{{ badgeText }}</p>

              <!-- 外观模式 -->
              <div class="mt-5">
                <p class="text-sm font-medium text-text">{{ FIRST_RUN_APPEARANCE_LABEL }}</p>
                <div
                  class="mt-2 grid grid-cols-2 gap-3"
                  role="radiogroup"
                  :aria-label="FIRST_RUN_APPEARANCE_LABEL"
                >
                  <button
                    v-for="option in FIRST_RUN_APPEARANCE_OPTIONS"
                    :key="option.label"
                    type="button"
                    role="radio"
                    :aria-checked="isDark === option.value"
                    data-track="APPEARANCE_MODE_CHANGE"
                    :data-track-detail="option.label"
                    class="pressable flex flex-col items-center gap-2 rounded-xl border px-4 py-3.5 active:scale-95"
                    :class="
                      isDark === option.value
                        ? 'border-primary bg-primary-weak text-text'
                        : 'border-flat-weak text-text-secondary hover:text-text'
                    "
                    @click="toggleDark(option.value)"
                  >
                    <MenuIcon :name="option.icon" :size="20" />
                    <span class="text-sm font-medium">{{ option.label }}</span>
                  </button>
                </div>
                <p class="mt-1.5 text-xs text-text-tertiary">{{ FIRST_RUN_APPEARANCE_HINT }}</p>
              </div>

              <!-- 系统主题色 -->
              <div class="mt-5">
                <p class="text-sm font-medium text-text">{{ FIRST_RUN_THEME_LABEL }}</p>
                <div
                  class="mt-2 flex flex-wrap gap-2"
                  role="radiogroup"
                  :aria-label="FIRST_RUN_THEME_LABEL"
                >
                  <button
                    v-for="option in THEME_COLOR_OPTIONS"
                    :key="option.value"
                    type="button"
                    role="radio"
                    :aria-checked="settingsStore.themeColor === option.value"
                    data-track="THEME_COLOR_CHANGE"
                    :data-track-detail="option.label"
                    class="pressable flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-medium active:scale-95"
                    :class="
                      settingsStore.themeColor === option.value
                        ? 'bg-flat-weak text-text ring-1 ring-primary'
                        : 'bg-flat-weak text-text-secondary hover:text-text'
                    "
                    @click="settingsStore.setThemeColor(option.value)"
                  >
                    <span class="h-5 w-5 rounded-full" :style="{ backgroundColor: option.swatch }" />
                    {{ option.label }}
                  </button>
                </div>
              </div>

              <!-- 涨跌主题色 -->
              <div class="mt-5">
                <p class="text-sm font-medium text-text">{{ FIRST_RUN_TREND_LABEL }}</p>
                <div
                  class="mt-2 flex flex-wrap gap-2"
                  role="radiogroup"
                  :aria-label="FIRST_RUN_TREND_LABEL"
                >
                  <button
                    v-for="option in TREND_THEME_OPTIONS"
                    :key="option.value"
                    type="button"
                    role="radio"
                    :aria-checked="settingsStore.trendTheme === option.value"
                    data-track="TREND_THEME_CHANGE"
                    :data-track-detail="option.label"
                    class="pressable flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-medium active:scale-95"
                    :class="
                      settingsStore.trendTheme === option.value
                        ? 'bg-flat-weak text-text ring-1 ring-primary'
                        : 'bg-flat-weak text-text-secondary hover:text-text'
                    "
                    @click="settingsStore.setTrendTheme(option.value)"
                  >
                    <!-- 预览色块固定展示选项自身标识色（左涨右跌），不随当前主题变化 -->
                    <span class="flex items-center gap-0.5 pl-1">
                      <span
                        class="h-5 w-5 rounded-full"
                        :style="{ backgroundColor: option.upSwatch }"
                      />
                      -
                      <span
                        class="h-5 w-5 rounded-full"
                        :style="{ backgroundColor: option.downSwatch }"
                      />
                    </span>
                    {{ option.label }}
                  </button>
                </div>
                <p class="mt-1.5 text-xs text-text-tertiary">{{ FIRST_RUN_TREND_HINT }}</p>
              </div>
            </div>

            <!-- 确认 -->
            <div class="flex shrink-0 items-center justify-end border-t border-flat-weak px-7 py-4">
              <BaseButton variant="primary" @click="onDone">{{ doneButtonText }}</BaseButton>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 整体淡入淡出（与 BaseModal 一致） */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
