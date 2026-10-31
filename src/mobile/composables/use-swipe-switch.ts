import { onUnmounted, ref, watch } from 'vue';
import type { CSSProperties, Ref } from 'vue';
import {
  SWIPE_ANIM_MS,
  SWIPE_AXIS_LOCK_PX,
  SWIPE_AXIS_RATIO,
  SWIPE_EASE,
  SWIPE_FLICK_MIN_PX,
  SWIPE_FLICK_VELOCITY,
  SWIPE_INNER_STEP_PX,
  SWIPE_OVERDRAG_DAMP,
} from '../constants';

/**
 * 列表页左右滑动切换源/平台（swiper 式，组合式函数版）
 *
 * 对齐 youtube-desktop 的 useSwipeSwitch：手指按下列后横向位移占优即进入跟手拖拽
 * （两侧相邻骨架屏面板一起位移），松手按位移阈值或轻扫速度判定——过阈值动画滑入
 * 相邻骨架屏、动画结束时 onChange 发真实请求，否则回弹；首尾边界拖拽带橡皮筋阻尼、
 * 不循环（首项右滑 / 末项左滑均回弹）。
 *
 * 内层步进优先（2026-10-30 王总指定）：传 canStepInner / onStepInner 后，源内还有
 * 可切 tab 时横滑被内层消费——拖拽轻阻尼跟手、不渲染切源骨架屏，松手过
 * SWIPE_INNER_STEP_PX（或轻扫）回弹并切 tab；源内已到首/末 tab 才回落为切源手势。
 *
 * 用法约定（与 youtube-desktop 相同）：
 * - swipeRef 绑到内容区包装元素（不含顶部 tabs 条，避免与其横向滚动冲突）；
 * - 容器需 `touch-action: pan-y` + `overflow-x: clip`（见 mobile.css 的 .m-swipe），
 *   纵向滚动交给原生；拖拽阶段 move 事件 stopPropagation（捕获阶段监听），
 *   让位下拉刷新 / 子元素横滚；
 * - phase 非 null 且非内层手势时在容器内渲染两侧骨架屏面板
 *   （`.m-swipe__side--prev/--next`，配合 innerGesture 判断）。
 */

/** 手势阶段：null 静止 / drag 跟手拖拽 / next+prev 过渡到相邻页 / back 回弹 */
export type SwipePhase = 'drag' | 'next' | 'prev' | 'back' | null;

/** 步进方向：1 = 左滑进下一项 / -1 = 右滑进上一项 */
export type SwipeDir = 1 | -1;

/** 手势选项 */
interface SwipeSwitchOptions {
  /** 选项总数 getter（每次手势实时读取，响应源显隐变化） */
  count: () => number;
  /** 当前选中下标 getter（0 基） */
  index: () => number;
  /** 命中该选择器的触摸起点整轮忽略（内容区里仍需原生横向滚动的元素，如 chips 条） */
  ignoreSelector?: string;
  /** 该方向上内层（源内 tab）是否还能步进；true = 本轮手势被内层消费不切源 */
  canStepInner?: (dir: SwipeDir) => boolean;
  /** 内层步进落地（松手过 SWIPE_INNER_STEP_PX 或轻扫时调用，随后回弹） */
  onStepInner?: (dir: SwipeDir) => void;
  /** 动画滑入相邻骨架屏结束时收到相邻下标（边界不回调） */
  onChange: (next: number) => void;
}

/**
 * 列表页左右滑动切换源/平台
 * @param options 手势选项
 * @returns onSwipeEl（绑内容区的函数 ref）/ phase（手势阶段）/ containerStyle（位移 + 过渡）
 */
export function useSwipeSwitch(options: SwipeSwitchOptions): {
  onSwipeEl: (el: unknown) => void;
  phase: Ref<SwipePhase>;
  /** 本轮手势是否被内层（源内 tab）消费：为 true 时不渲染切源骨架屏、松手回弹切 tab */
  innerGesture: Ref<boolean>;
  containerStyle: Ref<CSSProperties>;
} {
  /** 手势宿主元素（内容区包装元素） */
  const swipeRef = ref<HTMLElement | null>(null);

  /**
   * 模板函数 ref（`:ref="onSwipeEl"`）：登记 / 注销手势宿主元素，
   * 元素重挂（换源 :key 重挂 / 页面卸载）后自动重新接线
   * @param el 模板节点（Vue 函数 ref 回调形态）
   */
  const onSwipeEl = (el: unknown): void => {
    swipeRef.value = el instanceof Element ? (el as HTMLElement) : null;
  };

  /** 容器横向位移（px）：拖拽跟随手指，过渡动画滑到 ±容器宽 */
  const dx = ref(0);
  const phase = ref<SwipePhase>(null);
  /** 本轮手势被内层 tab 消费（跟手轻阻尼、不渲染切源骨架屏、松手切 tab 回弹） */
  const innerGesture = ref(false);

  /* 手势状态机（闭包变量，随元素重挂整体复位）：0 静止 / 1 待定（轴向未锁）/ 2 跟手拖拽 / 3 过渡动画中 */
  let mode = 0;
  /** 本轮触摸已判给纵向滚动，忽略到抬起为止 */
  let dead = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastT = 0;
  let vel = 0;
  let lastDx = 0;
  /** 内层手势的未阻尼原始位移（内层步进阈值判定用，不参与容器 transform） */
  let lastRawDx = 0;
  let width = 0;
  let timer: number | undefined;

  /**
   * 解绑手势监听
   * @param el 目标元素（须传**旧**元素引用；capture 标志必须与 add 时一致才能摘除）
   */
  const detach = (el: HTMLElement | null): void => {
    if (!el) return;
    el.removeEventListener('touchstart', onStart, { capture: true });
    el.removeEventListener('touchmove', onMove, { capture: true });
    el.removeEventListener('touchend', onEnd, { capture: true });
    el.removeEventListener('touchcancel', onEnd, { capture: true });
  };

  const attach = (el: HTMLElement | null): void => {
    if (!el) return;
    // 捕获阶段监听：拖拽期间 stopPropagation 拦在下拉刷新 / tabs 之前
    el.addEventListener('touchstart', onStart, { capture: true, passive: true });
    el.addEventListener('touchmove', onMove, { capture: true, passive: false });
    el.addEventListener('touchend', onEnd, { capture: true, passive: true });
    el.addEventListener('touchcancel', onEnd, { capture: true, passive: true });
  };

  const settle = (nextPhase: Exclude<SwipePhase, null>, after: () => void): void => {
    mode = 3;
    phase.value = nextPhase;
    // 动画时长兜底定时器：transitionend 可能因打断丢失，超时强制收尾
    timer = window.setTimeout(() => {
      after();
      dx.value = 0;
      phase.value = null;
      mode = 0;
    }, SWIPE_ANIM_MS + 40);
  };

  function onStart(e: TouchEvent): void {
    if (mode !== 0) return; // 过渡中不接新手势
    const t = e.touches[0];
    if (!t) return;
    // 触摸起点落在忽略选择器内：整轮不接（让位其原生横向滚动）
    if (
      options.ignoreSelector &&
      t.target instanceof Element &&
      t.target.closest(options.ignoreSelector)
    ) {
      return;
    }
    mode = 1;
    dead = false;
    innerGesture.value = false;
    startX = lastX = t.clientX;
    startY = t.clientY;
    lastT = performance.now();
    vel = 0;
    lastDx = 0;
    lastRawDx = 0;
    width = swipeRef.value?.clientWidth || window.innerWidth;
  }

  function onMove(e: TouchEvent): void {
    if (mode === 0 || mode === 3 || dead) return;
    const t = e.touches[0];
    if (!t) return;
    const rawDx = t.clientX - startX;
    const rawDy = t.clientY - startY;
    if (mode === 1) {
      // 轴向锁定：横向占优进入跟手，纵向占优整轮放弃（让位原生滚动）
      if (Math.abs(rawDx) >= SWIPE_AXIS_LOCK_PX && Math.abs(rawDx) > Math.abs(rawDy) * SWIPE_AXIS_RATIO) {
        mode = 2;
        // 内层步进判定：锁定轴向即问一次该方向内层是否可步进（方向以起手为准）
        innerGesture.value =
          (rawDx < 0 ? options.canStepInner?.(1) : options.canStepInner?.(-1)) ?? false;
      } else if (Math.abs(rawDy) >= SWIPE_AXIS_LOCK_PX) {
        dead = true;
        return;
      } else {
        return;
      }
    }
    // 跟手拖拽：拦下纵向滚动与子元素手势（下拉刷新 / tabs 横滚），边界侧橡皮筋阻尼
    e.preventDefault();
    e.stopPropagation();
    const count = options.count();
    let d = rawDx;
    if (innerGesture.value) {
      // 内层手势：轻阻尼跟手（有边界感但位移受限），不渲染切源骨架屏
      d *= SWIPE_OVERDRAG_DAMP;
    } else if ((options.index() === 0 && d > 0) || (options.index() === count - 1 && d < 0)) {
      d *= SWIPE_OVERDRAG_DAMP;
    }
    d = Math.max(-width, Math.min(width, d));
    const now = performance.now();
    vel = (t.clientX - lastX) / Math.max(1, now - lastT);
    lastX = t.clientX;
    lastT = now;
    lastDx = d;
    lastRawDx = rawDx;
    dx.value = d;
    if (phase.value !== 'drag') phase.value = 'drag';
  }

  function onEnd(e: TouchEvent): void {
    if (mode === 2) {
      e.stopPropagation();
      const count = options.count();
      // 内层手势：按未阻尼原始位移判步进，过阈值/轻扫切 tab，一律回弹（不切源）
      if (innerGesture.value) {
        const flick =
          Math.abs(lastRawDx) >= SWIPE_FLICK_MIN_PX && Math.abs(vel) >= SWIPE_FLICK_VELOCITY;
        const stepNext = lastRawDx <= -SWIPE_INNER_STEP_PX || (lastRawDx < 0 && flick);
        const stepPrev = lastRawDx >= SWIPE_INNER_STEP_PX || (lastRawDx > 0 && flick);
        if (stepNext) options.onStepInner?.(1);
        else if (stepPrev) options.onStepInner?.(-1);
        settle('back', () => {
          innerGesture.value = false;
        });
        dx.value = 0;
        return;
      }
      const threshold = Math.max(60, width * 0.2);
      const flick = Math.abs(lastDx) >= SWIPE_FLICK_MIN_PX && Math.abs(vel) >= SWIPE_FLICK_VELOCITY;
      const toNext = lastDx <= -threshold || (lastDx < 0 && flick);
      const toPrev = lastDx >= threshold || (lastDx > 0 && flick);
      const target = toNext ? options.index() + 1 : toPrev ? options.index() - 1 : -1;
      if (target >= 0 && target < count) {
        // 过阈值：动画滑入相邻骨架屏，动画结束才切数据源发真实请求
        const dir: Exclude<SwipePhase, null> = toNext ? 'next' : 'prev';
        settle(dir, () => options.onChange(target));
        dx.value = toNext ? -width : width;
        return;
      }
      // 未过阈值 / 边界越拖：回弹
      settle('back', () => {});
      dx.value = 0;
      return;
    }
    mode = 0;
  }

  // 元素重挂（换源 :key 重挂 / 页面卸载）后重新接线：先摘旧元素监听再挂新元素；
  // 卸载时顺手清兜底定时器
  watch(swipeRef, (el, prev) => {
    detach((prev as HTMLElement | null) ?? null);
    attach(el);
  });  onUnmounted(() => {
    window.clearTimeout(timer);
    detach(swipeRef.value);
  });

  const containerStyle = ref<CSSProperties>({
    transform: 'translateX(0px)',
    transition: undefined,
  });
  watch([dx, phase], () => {
    containerStyle.value = {
      transform: `translateX(${dx.value}px)`,
      transition:
        phase.value === 'next' || phase.value === 'prev' || phase.value === 'back'
          ? `transform ${SWIPE_ANIM_MS}ms ${SWIPE_EASE}`
          : undefined,
    };
  });

  return { onSwipeEl, phase, innerGesture, containerStyle };
}
