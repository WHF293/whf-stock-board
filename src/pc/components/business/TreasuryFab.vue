<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { useDockPanelStore } from '../../../common/stores/dock-panel';
import { appStorage } from '../../../common/utils/app-local-storage';
import {
  STORAGE_NS_TREASURY_BUBBLE_MODE,
  STORAGE_NS_TREASURY_POSITION,
  TREASURY_BUBBLE_FLIP_RATIO,
  TREASURY_BUBBLE_MODES,
  TREASURY_BUBBLE_MODE_DEFAULT,
  TREASURY_BUBBLE_SETTING_LABEL,
  TREASURY_CAROUSEL_INTERVAL_MS,
  TREASURY_DISCLAIMER,
  TREASURY_DRAG_THRESHOLD_PX,
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
 * 常驻胶囊入口（火焰图标 + 「大A宝典」，高光玻璃质感），页面内可拖拽换位
 * （2026-11-03 王总指定：默认右下角，可拖到视口任意位置并记忆，避免遮挡内容）：
 * - 气泡逐句轮播大A宝典内容（正文左对齐、来源在下方右对齐；自动按
 *   TREASURY_CAROUSEL_INTERVAL_MS 轮换），显隐由「轮播设置」模式驱动：
 *   自动 = 常驻轮播（无需悬停）/ hover = 悬停出现（默认）/ 关闭 = 永不出现；
 *   固钉贴近视口上 / 左边缘时气泡自动翻转到另一侧，防止溢出屏幕；
 * - 点击固钉（位移未超过拖拽阈值）→ 打开弹窗查看完整分组列表（祖训双列编号 /
 *   口诀圆点 / 金句人物 chip，分组间横线分隔），弹窗顶部「轮播设置」切换气泡模式，
 *   底栏「关闭」退出，免责提示常驻。
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

/* ------------------------------ 位置拖拽与记忆 ------------------------------ */

/** 固钉位置（容器左上角视口坐标；null = 未拖拽过，走默认 bottom-5 right-5） */
type TreasuryFabPosition = { x: number; y: number };

/** 拖拽中的瞬时状态（null = 未在拖拽） */
interface TreasuryDragState {
  /** 按下的 pointerId（move / up 只响应同指） */
  pointerId: number;
  /** 按下时指针相对容器左上角的偏移（拖拽保持抓取点不跳） */
  grabOffsetX: number;
  grabOffsetY: number;
  /** 按下时的指针位置（判定点击 vs 拖拽的基准） */
  startClientX: number;
  startClientY: number;
  /** 是否已超过拖拽阈值 */
  moved: boolean;
}

/**
 * 从本地存储读持久化位置（非法 JSON / 字段缺失 / 非有限数回落默认右下角）
 * @returns 持久化位置（null = 默认位置）
 */
const loadFabPosition = (): TreasuryFabPosition | null => {
  const raw = appStorage.getItem(STORAGE_NS_TREASURY_POSITION);
  if (raw === null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  } catch {
    // 非法 JSON 回落默认位置
  }
  return null;
};

/** 固钉位置（null = 默认右下角） */
const pos = ref<TreasuryFabPosition | null>(loadFabPosition());

/** 固钉容器（测量尺寸夹紧用） */
const fabRef = ref<HTMLDivElement | null>(null);

/** 视口尺寸（resize 时刷新；气泡翻转判定与位置夹紧的边界基准） */
const viewport = ref<{ w: number; h: number }>({ w: window.innerWidth, h: window.innerHeight });

/**
 * 把位置夹紧到视口内（左上不越界、右下留出容器自身宽高）
 * @param target 待夹紧的位置
 * @returns 夹紧后的位置
 */
const clampPos = (target: TreasuryFabPosition): TreasuryFabPosition => {
  const el = fabRef.value;
  const w = el?.offsetWidth ?? 0;
  const h = el?.offsetHeight ?? 0;
  const maxX = Math.max(viewport.value.w - w, 0);
  const maxY = Math.max(viewport.value.h - h, 0);
  return { x: Math.min(Math.max(target.x, 0), maxX), y: Math.min(Math.max(target.y, 0), maxY) };
};

/** 拖拽中的瞬时状态 */
let dragState: TreasuryDragState | null = null;

/** 上一次拖拽刚结束（吞掉紧随的 click，避免拖完误开弹窗） */
let dragJustEnded = false;

/**
 * 容器按下：记录抓取基准（不立即接管指针——capture 会让 click 重定向到容器，
 * 按钮点击弹窗就永远打不开；超过拖拽阈值时才 setPointerCapture）
 * @param event 指针按下事件
 */
const onPointerDown = (event: PointerEvent): void => {
  if (event.button !== 0) return;
  const el = fabRef.value;
  if (el === null) return;
  const rect = el.getBoundingClientRect();
  dragState = {
    pointerId: event.pointerId,
    grabOffsetX: event.clientX - rect.left,
    grabOffsetY: event.clientY - rect.top,
    startClientX: event.clientX,
    startClientY: event.clientY,
    moved: false,
  };
};

/**
 * 容器拖动：累计位移超过阈值才进入拖拽态（此刻惰性接管指针，指针已按下且仍
 * 在容器附近，capture 后 move / up 即使划出元素也持续收到），位置实时夹紧到视口内
 * @param event 指针移动事件
 */
const onPointerMove = (event: PointerEvent): void => {
  if (dragState === null || event.pointerId !== dragState.pointerId) return;
  const dx = event.clientX - dragState.startClientX;
  const dy = event.clientY - dragState.startClientY;
  if (!dragState.moved) {
    if (Math.hypot(dx, dy) <= TREASURY_DRAG_THRESHOLD_PX) return;
    dragState.moved = true;
    fabRef.value?.setPointerCapture(event.pointerId);
  }
  pos.value = clampPos({
    x: event.clientX - dragState.grabOffsetX,
    y: event.clientY - dragState.grabOffsetY,
  });
};

/**
 * 容器松开 / 取消：结束拖拽；位移超阈值才保存位置，并在微任务后复位点击吞并标记
 * @param event 指针松开事件
 */
const onPointerUp = (event: PointerEvent): void => {
  if (dragState === null || event.pointerId !== dragState.pointerId) return;
  const wasDrag = dragState.moved;
  dragState = null;
  if (wasDrag) {
    dragJustEnded = true;
    // click 事件在 pointerup 之后同步派发，微任务复位即可精准吞掉一次
    window.setTimeout(() => {
      dragJustEnded = false;
    }, 0);
    if (pos.value !== null) {
      appStorage.setItem(STORAGE_NS_TREASURY_POSITION, JSON.stringify(pos.value));
    }
  }
};

/**
 * 固钉点击：拖拽刚结束时吞掉，其余打开宝典弹窗（键盘 Enter 同入口）
 */
const onFabClick = (): void => {
  if (dragJustEnded) return;
  open.value = true;
};

/** 窗口尺寸变化：刷新视口基准并把已拖拽的位置夹回界内（跨分辨率恢复防出界） */
const onWindowResize = (): void => {
  viewport.value = { w: window.innerWidth, h: window.innerHeight };
  if (pos.value !== null) {
    pos.value = clampPos(pos.value);
  }
};

onMounted(() => {
  window.addEventListener('resize', onWindowResize);
  // 持久化位置在挂载前读出（无法测容器尺寸），挂载后按实测尺寸夹紧一次
  if (pos.value !== null) {
    pos.value = clampPos(pos.value);
  }
});

// 组件卸载兜底：清轮播计时器 + 摘除 resize 监听
onBeforeUnmount(() => {
  stopAutoplay();
  window.removeEventListener('resize', onWindowResize);
});

/* ------------------------------ 气泡随位置翻转 ------------------------------ */

/** 固钉是否位于视口上半（气泡改挂下方，防止上溢出屏） */
const bubbleBelow = computed(
  () => pos.value !== null && pos.value.y < viewport.value.h * TREASURY_BUBBLE_FLIP_RATIO,
);

/** 固钉是否位于视口左半（气泡改左对齐，防止左溢出屏） */
const bubbleLeftAlign = computed(
  () => pos.value !== null && pos.value.x < viewport.value.w * TREASURY_BUBBLE_FLIP_RATIO,
);

/** 气泡容器定位类（默认 = 上方右对齐；贴上边缘改下方，贴左边缘改左对齐） */
const bubblePositionClass = computed(
  () =>
    `${bubbleBelow.value ? 'top-full mt-2' : 'bottom-full mb-2'} ${bubbleLeftAlign.value ? 'left-0' : 'right-0'}`,
);

/** 气泡尖角定位类（方向随气泡位置翻转，颜色部分留在模板静态类） */
const bubbleArrowClass = computed(
  () =>
    `absolute h-2.5 w-2.5 rotate-45 ${
      bubbleBelow.value ? '-top-[5px] border-t border-l' : '-bottom-[5px] border-b border-r'
    } ${bubbleLeftAlign.value ? 'left-10' : 'right-10'}`,
);

/** 固钉容器样式：已拖拽 → left/top 定位（清掉默认 bottom/right 类） */
const fabStyle = computed<Record<string, string> | undefined>(() =>
  pos.value === null ? undefined : { left: `${pos.value.x}px`, top: `${pos.value.y}px` },
);
</script>

<template>
  <!-- 固钉容器：气泡（悬停显隐）+ 常驻胶囊按钮；整体悬停期间气泡保持。
       位置可拖拽：未拖拽走默认 bottom-5 right-5，拖拽后 left/top 定位并记忆；
       touch-none + select-none 防拖拽期间触发滚动 / 选中文字 -->
  <div
    ref="fabRef"
    v-show="!dockPanel.open"
    class="fixed z-40 touch-none select-none"
    :class="pos === null ? 'bottom-5 right-5' : 'cursor-grab active:cursor-grabbing'"
    :style="fabStyle"
    @mouseenter="bubbleVisible = true"
    @mouseleave="bubbleVisible = false"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- 悬停气泡：icon 上方逐句轮播（高光玻璃底 + 主题色描边，正文左对齐、来源右对齐；
         尖角放在玻璃层外，避免 .pc-nav-bubble 的 overflow:hidden 把它裁掉；
         显隐由「轮播设置」模式驱动：自动常驻 / hover 悬停 / 关闭永不；
         固钉贴上 / 左边缘时气泡翻转到下方 / 左对齐（bubblePositionClass） -->
    <Transition name="treasury-bubble">
      <div v-if="bubbleShown" class="absolute w-72" :class="bubblePositionClass">
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
        <!-- 气泡尖角：指向胶囊按钮（方向随位置翻转，半透明底 + 同色描边近似玻璃延续） -->
        <span
          :class="bubbleArrowClass"
          class="border-[rgba(16,185,129,0.45)] bg-white/75 dark:border-[rgba(16,185,129,0.5)] dark:bg-[rgba(34,42,54,0.85)]"
          aria-hidden="true"
        ></span>
      </div>
    </Transition>

    <!-- 固钉本体：icon + 文字常驻胶囊（高光玻璃底 + 主题色描边，点击打开完整列表弹窗；
         拖拽结束后的紧随 click 被吞掉，不会误开弹窗） -->
    <button
      type="button"
      class="pressable pc-nav-bubble pc-nav-bubble--primary flex h-10 items-center gap-1.5 rounded-full pl-3 pr-3.5 text-primary"
      aria-label="大A宝典"
      @click="onFabClick"
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
