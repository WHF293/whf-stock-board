<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import MenuIcon from '../components/ui/MenuIcon.vue';
import { useDocumentThemeSync } from '../../common/composables/use-document-theme';
import { useTheme } from '../../common/composables/use-theme';
import { useSettingsStore } from '../../common/stores/settings';
import { appStorage } from '../../common/utils/app-local-storage';
import { openTreasuryWindow } from '../../common/utils/treasury-window';
import {
  STORAGE_NS_TREASURY_BAR_POSITION,
  TREASURY_BAR_MOVE_SETTLE_MS,
  TREASURY_CAROUSEL_INTERVAL_MS,
  TREASURY_EVENTS,
  TREASURY_MARQUEE_GAP_PX,
  TREASURY_MARQUEE_PAUSE_MS,
  TREASURY_MARQUEE_SPEED_PX_S,
  buildTreasurySlides,
} from '../../common/constants/treasury.constants.ts';
import { loadTreasuryCustomRules } from '../../common/utils/treasury-custom-rules';
import type { WatchWidgetThemePayload } from '../../common/types/watch-widget.types.ts';

/**
 * 大A宝典桌面横条（独立置顶小窗口视图，treasury.html?view=bar）
 *
 * 形态参考任务栏盯盘条（2026-11-03 王总指定）：常驻屏幕的玻璃横条，主应用之外
 * 独立存在（主窗口最小化 / 被遮挡仍可见）：
 * - 条内 = 祖训内容**单句**逐句轮播（5s 一句；2026-11-03 澄清「一行两个」指弹窗
 *   清单，横条保持单句），文本恒速无缝横向滚动（2026-11-03 后指定：即使放得下
 *   也滚动；长句滚完一轮 + 句尾停顿才切句）；
 * - 点击（非拖动）→ 打开 / 唤醒 / 聚焦宝典弹窗窗口（treasury-bubble）；
 * - 整条可拖动：位移超阈值即交还系统级窗口拖拽（startDragging），拖完落点
 *   记忆物理坐标（跨窗口共享 localStorage，下次启动按原位恢复）；
 * - 主题：初始走 useDocumentThemeSync 读整包；运行期跟随走主窗口推送的
 *   `treasury://theme` 事件（WebView2 跨窗口 storage 事件实测不可靠，盯盘条同款）。
 */

// 主题落 <html>（独立窗口的 App 层职责，见 WatchWidgetApp 同款注释）
useDocumentThemeSync();

const { isDark } = useTheme();
const settingsStore = useSettingsStore();

/* ------------------------------ 祖训轮播（单句） ------------------------------ */

/** 自定义祖训（我的祖训）：每轮换句前重读 appStorage（弹窗里增删 ≤5s 自动跟上） */
const customRules = ref(loadTreasuryCustomRules());

/** 轮播序列 = 内置（祖训 → 口诀 → 金句）+ 自定义祖训（追加末尾） */
const slides = computed(() => buildTreasurySlides(customRules.value));

/** 轮播当前句下标 */
const index = ref(0);

/** 当前句（下标越界兜底回首页，轮换恒在界内） */
const current = computed(() => slides.value[index.value] ?? slides.value[0]);

/** 单行展示文案：祖训取主句；口诀 / 金句取正文（金句带书名号） */
const barText = computed(() => {
  const slide = current.value;
  if (slide.kind === 'rule') return slide.title ?? '';
  return slide.kind === 'quote' ? `「${slide.text ?? ''}」` : (slide.text ?? '');
});

/* ------------------------------ 跑马灯（恒速滚动） ------------------------------ */

/** 文本可视区（flex-1 溢出隐藏容器）与滚动轨道 */
const textViewRef = ref<HTMLElement | null>(null);
const trackRef = ref<HTMLElement | null>(null);

/** 当前句是否处于跑马灯滚动（仅测量未就绪时为 false 静置） */
const scrolling = ref(false);

/** 跑马灯单程位移（像素）= 单份文本宽 + 副本间距 */
const marqueeDistance = ref(0);

/** 跑马灯单程时长（毫秒）= 位移 / 速度 */
const marqueeDurationMs = ref(0);

/** 静止态样式常量：computed 空分支用字面量会踩 vue-tsc 重载推断坑，抽成常量 */
const EMPTY_MARQUEE_STYLE: Record<string, string> = {};

/** 轨道动画样式（scrolling 时应用；keyframes 位移走 CSS 变量） */
const marqueeStyle = computed<Record<string, string>>(() =>
  scrolling.value
    ? {
        '--marquee-distance': `${marqueeDistance.value}px`,
        animationDuration: `${marqueeDurationMs.value}ms`,
      }
    : EMPTY_MARQUEE_STYLE,
);

/**
 * 测量当前句并恒启无缝滚动（2026-11-03 王总指定：无论放不放得下都横向滚动）
 *
 * 轨道 = [文本][间距][副本]；单程位移 = 文本宽 + 间距（滚完正好副本顶到起点，无缝衔接）。
 * 短句时副本从右侧跟进形成连续字幕流；测量失败（元素未就绪）才静置。
 */
const measureMarquee = (): void => {
  const view = textViewRef.value;
  const track = trackRef.value;
  const textEl = track?.firstElementChild as HTMLElement | null;
  if (!view || !track || !textEl) {
    scrolling.value = false;
    return;
  }
  const textWidth = textEl.offsetWidth;
  marqueeDistance.value = textWidth + TREASURY_MARQUEE_GAP_PX;
  marqueeDurationMs.value =
    ((textWidth + TREASURY_MARQUEE_GAP_PX) / TREASURY_MARQUEE_SPEED_PX_S) * 1000;
  scrolling.value = true;
};

/** 可视区尺寸观察句柄（每句入场后重绑新元素） */
let viewResizeObserver: ResizeObserver | undefined;

/**
 * 新句入场完成（out-in 过渡后新元素才插入 DOM）：重绑尺寸观察并测量启动滚动
 *
 * 注意不能在 index 变化的 nextTick 里测——out-in 模式下此刻新句还没插入，
 * ref 仍指向正在离场的旧元素，测出来的是旧句宽度。
 */
const onSentenceEntered = (): void => {
  const view = textViewRef.value;
  if (view) {
    viewResizeObserver?.disconnect();
    viewResizeObserver = new ResizeObserver(() => measureMarquee());
    viewResizeObserver.observe(view);
  }
  measureMarquee();
};

let timer: number | null = null;

const stopAutoplay = (): void => {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
};

/**
 * 下一次换句的等待时长：短句按轮播间隔；长句滚完一轮 + 句尾停顿后（取更久者）
 * @returns 等待毫秒数
 */
const nextDelay = (): number =>
  scrolling.value
    ? Math.max(TREASURY_CAROUSEL_INTERVAL_MS, marqueeDurationMs.value + TREASURY_MARQUEE_PAUSE_MS)
    : TREASURY_CAROUSEL_INTERVAL_MS;

const scheduleNext = (): void => {
  stopAutoplay();
  timer = window.setTimeout(tickAutoplay, nextDelay());
};

/** 换句步进：重读自定义祖训 → 复位滚动态 → 下标前进 → 按新句状态排下一轮 */
const tickAutoplay = (): void => {
  // 弹窗里新增 / 删除的条目最迟一轮进入轮播（越界自愈）
  customRules.value = loadTreasuryCustomRules();
  // 先复位：新句是否滚动由入场完成后的测量决定，不携带上一句的动画状态
  scrolling.value = false;
  index.value = (index.value + 1) % slides.value.length;
  scheduleNext();
};

scheduleNext();

/* ------------------------------ 拖动与点击 ------------------------------ */

/** 按下基准（null = 未按下；moved = 已进入窗口拖拽） */
let press: { x: number; y: number; moved: boolean } | null = null;

/** 拖动阈值（像素）：超过才交系统拖拽，未超过的 pointerup 视为点击 */
const DRAG_THRESHOLD_PX = 4;

/**
 * 横条按下：记录基准（此时还不接管——startDragging 一调，后续 pointer 事件
 * 就被系统拖拽循环吃掉，click 不再派发，天然区分「拖完不误开弹窗」）
 * @param event 指针按下事件
 */
const onPointerDown = (event: PointerEvent): void => {
  if (event.button !== 0) return;
  press = { x: event.clientX, y: event.clientY, moved: false };
};

/**
 * 横条拖动：位移超阈值即交还系统级窗口拖拽（此后 pointerup 不到达，不会误触发点击）
 * @param event 指针移动事件
 */
const onPointerMove = (event: PointerEvent): void => {
  if (press === null || press.moved) return;
  if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= DRAG_THRESHOLD_PX) return;
  press.moved = true;
  void getCurrentWindow().startDragging();
};

/**
 * 横条松开：未进入拖拽视为点击 → 打开 / 唤醒 / 聚焦宝典弹窗窗口
 */
const onPointerUp = (): void => {
  const wasClick = press !== null && !press.moved;
  press = null;
  if (wasClick) void openTreasuryWindow();
};

/* ------------------------------ 落点记忆 ------------------------------ */

/** 落点写盘的防抖句柄（拖动停止 TREASURY_BAR_MOVE_SETTLE_MS 后才写存储） */
let settleTimer: number | null = null;

/** onMoved 的解除函数（卸载兜底） */
let unlistenMoved: (() => void) | undefined;

/** 主题事件解除函数（onMounted 内赋值） */
let unlistenTheme: (() => void) | undefined;

onMounted(() => {
  if (!isTauri()) return;
  void (async () => {
    unlistenMoved = await getCurrentWindow().onMoved(({ payload }) => {
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        appStorage.setItem(
          STORAGE_NS_TREASURY_BAR_POSITION,
          JSON.stringify({ x: payload.x, y: payload.y }),
        );
      }, TREASURY_BAR_MOVE_SETTLE_MS);
    });
    // 运行期主题跟随：消费主窗口推送的主题三要素（初始值已由 useDocumentThemeSync 落好）
    unlistenTheme = await listen<WatchWidgetThemePayload>(TREASURY_EVENTS.THEME, (event) => {
      const { dark, theme, trend } = event.payload;
      if (dark !== isDark.value) isDark.value = dark;
      if (theme !== settingsStore.themeColor) settingsStore.themeColor = theme;
      if (trend !== settingsStore.trendTheme) settingsStore.trendTheme = trend;
    });
  })();
});

onBeforeUnmount(() => {
  stopAutoplay();
  viewResizeObserver?.disconnect();
  if (settleTimer !== null) window.clearTimeout(settleTimer);
  unlistenMoved?.();
  unlistenTheme?.();
});
</script>

<template>
  <!-- 横条根：撑满透明窗口；整条可拖（拖 = 系统级窗口拖拽，点 = 开弹窗） -->
  <div
    class="flex h-screen items-center p-[2px] select-none"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- 横条本体：高光玻璃胶囊（主窗口旧固钉同款质感） -->
    <div
      class="pc-nav-bubble pc-nav-bubble--primary flex h-full w-full cursor-grab items-center gap-2 rounded-full px-2.5 active:cursor-grabbing"
      title="大A宝典 · 点击打开，拖动换位"
    >
      <!-- 火焰图标：宝典识别符 -->
      <span class="flex shrink-0 items-center text-primary">
        <MenuIcon name="flame" :size="16" />
      </span>

      <!-- 轮播句：单句（恒速无缝跑马灯）；淡入淡出换句 -->
      <span class="min-w-0 flex-1 overflow-hidden">
        <!-- appear：首句同样走一遍 enter，保证 after-enter 测量对首句也生效 -->
        <Transition name="treasury-bar-slide" mode="out-in" appear @after-enter="onSentenceEntered">
          <span :key="index" class="flex items-center text-xs leading-none">
            <span ref="textViewRef" class="min-w-0 flex-1 overflow-hidden">
              <span
                ref="trackRef"
                class="treasury-bar-track"
                :class="{ 'treasury-bar-track--scrolling': scrolling }"
                :style="marqueeStyle"
              >
                <span class="whitespace-nowrap text-text">{{ barText }}</span>
                <!-- 滚动时才渲染副本：与首份拼接后 translateX 一个周期正好回到起点（无缝） -->
                <span v-if="scrolling" class="whitespace-nowrap text-text" aria-hidden="true">
                  {{ barText }}
                </span>
              </span>
            </span>
          </span>
        </Transition>
      </span>

      <!-- 页码指示（与轮播同语义） -->
      <span class="shrink-0 text-[9px] tabular-nums text-text-tertiary">
        {{ index + 1 }}/{{ slides.length }}
      </span>
    </div>
  </div>
</template>

<style>
/* 透明窗口：页面必须整页透明（黑块 / 方形底 = 未覆盖区域被 theme.css 的
 * body 底色填充）。`body#treasury-page` 提高特异性压过 theme.css 的
 * `body { background-color }`（普通 body 选择器实测压不住，watch-widget-page
 * 同款手法）；只在本视图挂载时生效，不影响弹窗视图）
 */
html,
#treasury {
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
}

body#treasury-page {
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
}

/* 换句过渡：淡入 + 轻微上移（与弹窗轮播的 treasury-slide 同语言） */
.treasury-bar-slide-enter-active,
.treasury-bar-slide-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.treasury-bar-slide-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.treasury-bar-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 跑马灯轨道：flex 排布 [文本][间距][副本]，间距由 gap 提供；
 * 滚动位移走 CSS 变量（--marquee-distance 由脚本按实测文本宽写入），
 * 时长同样由脚本按 30px/s 折算写入 animationDuration */
.treasury-bar-track {
  display: inline-flex;
  gap: 24px;
}

.treasury-bar-track--scrolling {
  animation-name: treasury-bar-marquee;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

@keyframes treasury-bar-marquee {
  from {
    transform: translateX(0);
  }

  to {
    transform: translateX(calc(-1 * var(--marquee-distance)));
  }
}
</style>
