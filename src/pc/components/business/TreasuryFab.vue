<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { useDockPanelStore } from '../../../common/stores/dock-panel';
import { appStorage } from '../../../common/utils/app-local-storage';
import {
  STORAGE_NS_TREASURY_BUBBLE_MODE,
  TREASURY_BUBBLE_MODES,
  TREASURY_BUBBLE_MODE_DEFAULT,
  TREASURY_BUBBLE_SETTING_LABEL,
  TREASURY_CAROUSEL_INTERVAL_MS,
  TREASURY_DISCLAIMER,
  TREASURY_QUOTES,
  TREASURY_QUOTES_GROUP_NOTE,
  TREASURY_QUOTES_GROUP_TITLE,
  TREASURY_RULES,
  TREASURY_RULES_GROUP_TITLE,
  TREASURY_SLIDES,
  TREASURY_SLIDE_KIND_LABELS,
  TREASURY_TITLE,
  TREASURY_TIPS,
  TREASURY_TIPS_GROUP_TITLE,
  type TreasuryBubbleMode,
} from '../../../common/constants/treasury.constants.ts';

/**
 * 「大A宝典」全局固钉（2026-10-26 王总指定）
 *
 * 右下角常驻胶囊入口（火焰图标 + 「大A宝典」，高光玻璃质感）：
 * - 气泡逐句轮播大A宝典内容（正文左对齐、来源在下方右对齐；自动按
 *   TREASURY_CAROUSEL_INTERVAL_MS 轮换），显隐由「轮播设置」模式驱动：
 *   自动 = 常驻轮播（无需悬停）/ hover = 悬停出现（默认）/ 关闭 = 永不出现；
 * - 点击固钉 → 打开弹窗查看完整分组列表（祖训双列编号 / 口诀圆点 / 金句人物 chip，
 *   分组间横线分隔），弹窗顶部「轮播设置」切换气泡模式，底栏「关闭」退出，
 *   免责提示常驻。
 * 挂在 MainLayout（全路由常驻）；右侧停靠面板打开时暂时让位（固钉会压在面板内容上）
 */

const dockPanel = useDockPanelStore();

/** 宝典弹窗显隐 */
const open = ref(false);

/** 悬停固钉（hover 模式下气泡出现） */
const bubbleVisible = ref(false);

/**
 * 从本地存储读气泡轮播模式（非法值回落默认 hover）
 * @returns 持久化的气泡轮播模式
 */
const loadBubbleMode = (): TreasuryBubbleMode => {
  const stored = appStorage.getItem(STORAGE_NS_TREASURY_BUBBLE_MODE);
  const match = TREASURY_BUBBLE_MODES.find((mode) => mode.value === stored);
  return match ? match.value : TREASURY_BUBBLE_MODE_DEFAULT;
};

/** 气泡轮播模式（自动 / hover / 关闭），选择持久化到本地存储 */
const bubbleMode = ref<TreasuryBubbleMode>(loadBubbleMode());

watch(bubbleMode, (mode) => {
  appStorage.setItem(STORAGE_NS_TREASURY_BUBBLE_MODE, mode);
});

/** BaseTabs 的 string 模型桥接（写入侧白名单校验，防非法值落库） */
const bubbleModeModel = computed<string>({
  get: () => bubbleMode.value,
  set: (value) => {
    const match = TREASURY_BUBBLE_MODES.find((mode) => mode.value === value);
    if (match) {
      bubbleMode.value = match.value;
    }
  },
});

/** 气泡是否显示：关闭 = 永不；自动 = 常驻；hover = 悬停（弹窗打开时一律隐藏） */
const bubbleShown = computed(
  () =>
    bubbleMode.value !== 'off' &&
    !open.value &&
    (bubbleMode.value === 'auto' || bubbleVisible.value),
);

/** 气泡当前轮播页下标 */
const index = ref(0);

/** 当前轮播页（下标越界兜底回首页，正常轮换恒在界内） */
const current = computed(
  () => TREASURY_SLIDES[index.value] ?? TREASURY_SLIDES[0],
);

/**
 * 来源行文案（正文下方右对齐）：分组名；金句附人物落款
 */
const sourceLabel = computed(() => {
  const slide = current.value;
  const label = TREASURY_SLIDE_KIND_LABELS[slide.kind];
  return slide.kind === 'quote' && slide.author ? `${label} · ${slide.author}` : label;
});

/** 气泡自动轮播计时器（null = 未在播放） */
let timer: number | null = null;

/** 停止气泡轮播 */
const stopAutoplay = (): void => {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
};

/** 启动气泡轮播（先清旧计时器，防重入叠计时） */
const startAutoplay = (): void => {
  stopAutoplay();
  timer = window.setInterval(() => {
    index.value = (index.value + 1) % TREASURY_SLIDES.length;
  }, TREASURY_CAROUSEL_INTERVAL_MS);
};

/** 按当前状态对齐计时器：气泡可见时播放，隐藏即停 */
const syncAutoplay = (): void => {
  stopAutoplay();
  if (bubbleShown.value) {
    startAutoplay();
  }
};

// 显隐（含模式 / 悬停 / 弹窗开关推导）变化 → 重排计时器；immediate 兜底
// 「自动模式首帧即常驻」的启动场景
watch(bubbleShown, syncAutoplay, { immediate: true });

// 组件卸载兜底清理（防残留计时器）
onBeforeUnmount(stopAutoplay);
</script>

<template>
  <!-- 固钉容器：气泡（悬停显隐）+ 常驻胶囊按钮；整体悬停期间气泡保持 -->
  <div
    v-show="!dockPanel.open"
    class="fixed bottom-5 right-5 z-40"
    @mouseenter="bubbleVisible = true"
    @mouseleave="bubbleVisible = false"
  >
    <!-- 悬停气泡：icon 上方逐句轮播（高光玻璃底 + 主题色描边，正文左对齐、来源右对齐；
         尖角放在玻璃层外，避免 .pc-nav-bubble 的 overflow:hidden 把它裁掉；
         显隐由「轮播设置」模式驱动：自动常驻 / hover 悬停 / 关闭永不） -->
    <Transition name="treasury-bubble">
      <div v-if="bubbleShown" class="absolute bottom-full right-0 mb-2 w-72">
        <!-- 玻璃气泡主体（对齐全站玻璃按钮：pc-nav-bubble + primary 描边变体） -->
        <div class="pc-nav-bubble pc-nav-bubble--primary rounded-lg">
          <div class="flex min-h-[72px] items-center justify-center px-3 py-2.5">
            <div aria-live="polite" class="w-full">
              <Transition name="treasury-slide" mode="out-in">
                <div :key="index" class="flex flex-col gap-1.5">
                  <template v-if="current.kind === 'rule'">
                    <p class="text-left text-sm font-semibold leading-5 text-primary">
                      {{ current.title }}
                    </p>
                    <p class="text-left text-xs leading-4 text-primary/75">
                      {{ current.desc }}
                    </p>
                  </template>
                  <p v-else class="text-left text-sm leading-5 text-primary">
                    <template v-if="current.kind === 'quote'">「{{ current.text }}」</template>
                    <template v-else>{{ current.text }}</template>
                  </p>
                  <p class="text-right text-xs text-primary/60">—— {{ sourceLabel }}</p>
                </div>
              </Transition>
            </div>
          </div>
        </div>
        <!-- 气泡尖角：指向下方胶囊按钮（半透明底 + 同色描边近似玻璃延续） -->
        <span
          class="absolute -bottom-[5px] right-10 h-2.5 w-2.5 rotate-45 border-b border-r border-[rgba(16,185,129,0.45)] bg-white/75 dark:border-[rgba(16,185,129,0.5)] dark:bg-[rgba(34,42,54,0.85)]"
          aria-hidden="true"
        ></span>
      </div>
    </Transition>

    <!-- 固钉本体：icon + 文字常驻胶囊（高光玻璃底 + 主题色描边，点击打开完整列表弹窗） -->
    <button
      type="button"
      class="pressable pc-nav-bubble pc-nav-bubble--primary flex h-10 items-center gap-1.5 rounded-full pl-3 pr-3.5 text-primary"
      aria-label="大A宝典"
      @click="open = true"
    >
      <MenuIcon name="flame" :size="16" class="shrink-0" />
      <span class="whitespace-nowrap text-sm font-semibold">大A宝典</span>
    </button>
  </div>

  <!-- 宝典弹窗：顶部「轮播设置」+ 完整分组列表（分组间横线分隔），免责提示与关闭常驻底栏 -->
  <BaseModal
    v-model:open="open"
    :title="TREASURY_TITLE"
    max-width-class="max-w-2xl"
    height-class="h-[80dvh]"
  >
    <!-- 顶部固定栏：气泡轮播设置（自动 / hover / 关闭，选择持久化） -->
    <template #filters>
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs font-medium text-text-tertiary">
          {{ TREASURY_BUBBLE_SETTING_LABEL }}
        </span>
        <BaseTabs v-model="bubbleModeModel" :options="TREASURY_BUBBLE_MODES" aria-label="轮播设置" />
      </div>
    </template>

    <div>
      <section>
        <h4 class="mb-3 flex items-center gap-2">
          <span class="h-3.5 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
          <span class="text-sm font-semibold text-text">{{ TREASURY_RULES_GROUP_TITLE }}</span>
          <span class="text-xs text-text-tertiary">{{ TREASURY_RULES.length }} 条</span>
        </h4>
        <ol class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <li
            v-for="(rule, ruleIndex) in TREASURY_RULES"
            :key="rule.title"
            class="flex items-start gap-2"
          >
            <span
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary-weak text-[11px] font-semibold tabular-nums text-primary"
            >
              {{ ruleIndex + 1 }}
            </span>
            <div class="min-w-0">
              <p class="text-sm font-medium leading-5 text-text">{{ rule.title }}</p>
              <p v-if="rule.desc" class="mt-0.5 text-xs leading-4 text-text-tertiary">
                {{ rule.desc }}
              </p>
            </div>
          </li>
        </ol>
      </section>

      <hr class="my-5 border-flat-weak" />

      <section>
        <h4 class="mb-2.5 flex items-center gap-2">
          <span class="h-3.5 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
          <span class="text-sm font-semibold text-text">{{ TREASURY_TIPS_GROUP_TITLE }}</span>
        </h4>
        <ul class="space-y-1.5">
          <li
            v-for="tip in TREASURY_TIPS"
            :key="tip"
            class="flex items-start gap-2 text-sm leading-6 text-text"
          >
            <span class="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-flat" aria-hidden="true"></span>
            {{ tip }}
          </li>
        </ul>
      </section>

      <hr class="my-5 border-flat-weak" />

      <section>
        <h4 class="mb-2.5 flex items-center gap-2">
          <span class="h-3.5 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
          <span class="text-sm font-semibold text-text">{{ TREASURY_QUOTES_GROUP_TITLE }}</span>
          <span class="text-xs text-text-tertiary">{{ TREASURY_QUOTES_GROUP_NOTE }}</span>
        </h4>
        <ul class="space-y-2">
          <li
            v-for="quote in TREASURY_QUOTES"
            :key="quote.name"
            class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-flat-weak/60 px-3 py-2.5"
          >
            <span class="rounded bg-primary-weak px-1.5 py-0.5 text-xs font-semibold text-primary">
              {{ quote.name }}
            </span>
            <span class="text-sm font-medium text-text">{{ quote.text }}</span>
          </li>
        </ul>
      </section>
    </div>

    <!-- 底栏：免责提示（左）+ 关闭（右） -->
    <template #footer>
      <div class="flex w-full items-center gap-3">
        <p class="min-w-0 flex-1 text-left text-xs leading-5 text-text-tertiary">
          ⚠️ {{ TREASURY_DISCLAIMER }}
        </p>
        <BaseButton variant="ghost" class="shrink-0" @click="open = false">关闭</BaseButton>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
/* 气泡切页：淡入淡出 + 轻微横向位移（out-in 顺序播放） */
.treasury-slide-enter-active,
.treasury-slide-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.treasury-slide-enter-from {
  opacity: 0;
  transform: translateX(16px);
}
.treasury-slide-leave-to {
  opacity: 0;
  transform: translateX(-16px);
}
/* 气泡显隐：淡入 + 轻微上浮 */
.treasury-bubble-enter-active,
.treasury-bubble-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.treasury-bubble-enter-from,
.treasury-bubble-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
