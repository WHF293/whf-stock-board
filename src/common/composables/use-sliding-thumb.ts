import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type CSSProperties,
  type Ref,
} from 'vue';
import {
  SLIDING_THUMB_EASE_RESTORE,
  SLIDING_THUMB_EASE_TRAVEL,
  SLIDING_THUMB_RESTORE_DELAY_MS,
  SLIDING_THUMB_RESTORE_MS,
  SLIDING_THUMB_REDUCED_MOTION_QUERY,
  SLIDING_THUMB_TRAVEL_MS,
  SLIDING_THUMB_TRAVEL_OPACITY,
  SLIDING_THUMB_TRAVEL_SCALE,
} from '../constants/sliding-thumb.constants';

/** 滑动气泡默认匹配的项元素选择器（容器的直接子 button） */
const DEFAULT_ITEM_SELECTOR = ':scope > button';

/** 气泡几何（内容坐标，相对定位容器；等宽槽位与不等宽项统一用 offset 系列量取） */
interface ThumbGeometry {
  /** 相对容器的横向偏移（px） */
  x: number;
  /** 相对容器的纵向偏移（px，换行 chips 场景非 0） */
  y: number;
  /** 气泡宽（px）＝当前项宽 */
  width: number;
  /** 气泡高（px）＝当前项高 */
  height: number;
}

/** 动画阶段：落位（无过渡，首帧 / 重测 / 减少动态效果）/ 行程（缩小变透明）/ 回弹恢复 */
type ThumbPhase = 'settle' | 'travel' | 'restore';

/** 气泡内联样式（挂到组件模板里的绝对定位 thumb 元素上）；
 * 字段固定为 transform / width / height / transition / opacity，对齐 Vue StyleValue 约束 */
export type SlidingThumbStyle = CSSProperties;

export interface UseSlidingThumbOptions {
  /** 定位容器元素（需 position:relative，作为气泡的 offsetParent；可为 v-if 延迟出现的节点） */
  container: Ref<HTMLElement | null>;
  /** 激活项序号（负数或越界 = 气泡隐藏） */
  activeIndex: Ref<number>;
  /** 容器内项元素选择器（默认 ':scope > button'） */
  itemSelector?: string;
}

export interface UseSlidingThumbResult {
  /** 气泡内联样式（null = 暂无有效激活项，thumb 应不渲染） */
  thumbStyle: Ref<SlidingThumbStyle | null>;
  /** 手动重量取气泡几何（项集变化 / 字体加载后调用；内部已覆盖容器尺寸变化） */
  measure: () => void;
}

/**
 * 查询系统「减少动态效果」偏好
 * @returns 命中返回 true（气泡直接跳位，不播过渡）
 */
const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia(SLIDING_THUMB_REDUCED_MOTION_QUERY).matches;

/**
 * PC 按钮组滑动气泡：在分段按钮组内维护一块共享的玻璃气泡（thumb），
 * 切换激活项时按移动端 TabBar 同款动画滑过去（行程 340ms 缩小变透明 →
 * 160ms 后 220ms 回弹落定），选中态视觉从按钮自身类名搬到 thumb 层。
 *
 * 测量用 offsetLeft/offsetTop/offsetWidth/offsetHeight（内容坐标），
 * 天然兼容 overflow-x-auto 滚动容器（气泡跟随内容滚动）与 flex-1 等宽、文字不等宽两种布局；
 * 容器尺寸变化由 ResizeObserver 兜底重测。动画编排：
 * 气泡已落定时切换 → travel（位移+缩放+透明，340ms）→ 160ms 后 restore（回弹落定，220ms）；
 * 气泡此前不存在（首次出现 / v-if 重挂）→ 直接落位不播行程。
 * @param options container/activeIndex/itemSelector，见 {@link UseSlidingThumbOptions}
 * @returns thumbStyle + measure，见 {@link UseSlidingThumbResult}
 */
export function useSlidingThumb(options: UseSlidingThumbOptions): UseSlidingThumbResult {
  const { container, activeIndex, itemSelector = DEFAULT_ITEM_SELECTOR } = options;

  /** 当前气泡几何（null = 暂无有效激活项） */
  const geometry = ref<ThumbGeometry | null>(null);
  /** 当前动画阶段 */
  const phase = ref<ThumbPhase>('settle');
  /** 回弹段定时器（快速连点时重置） */
  let restoreTimer: number | undefined;
  /** 容器尺寸监听（窗口缩放 / 侧栏折叠 / 字体加载撑开容器） */
  let resizeObserver: ResizeObserver | null = null;

  /**
   * 量取激活项几何写入 geometry（内容坐标，相对定位容器；无有效项时置 null）
   */
  const measure = (): void => {
    const root = container.value;
    if (!root) {
      geometry.value = null;
      return;
    }
    const items = root.querySelectorAll<HTMLElement>(itemSelector);
    const index = activeIndex.value;
    const el = index >= 0 && index < items.length ? items[index] : null;
    geometry.value = el
      ? {
          x: el.offsetLeft,
          y: el.offsetTop,
          width: el.offsetWidth,
          height: el.offsetHeight,
        }
      : null;
  };

  /** 气泡内联样式：几何 + 阶段决定缩放/透明度/过渡曲线；
   * position/left/top 必须内联——.pc-nav-bubble 自带 position:relative（非 layer 样式
   * 优先级高于 Tailwind 的 absolute 类），不内联覆盖的话气泡会掉回文档流占位（多出一块） */
  const thumbStyle = computed<SlidingThumbStyle | null>(() => {
    const g = geometry.value;
    if (!g) return null;
    const placement = { position: 'absolute' as const, left: '0px', top: '0px' };
    const size = { width: `${g.width}px`, height: `${g.height}px` };
    if (phase.value === 'settle') {
      return {
        ...placement,
        transform: `translate(${g.x}px, ${g.y}px) scale(1)`,
        ...size,
        transition: 'none',
        opacity: '1',
      };
    }
    const isTravel = phase.value === 'travel';
    const ease = isTravel ? SLIDING_THUMB_EASE_TRAVEL : SLIDING_THUMB_EASE_RESTORE;
    const ms = isTravel ? SLIDING_THUMB_TRAVEL_MS : SLIDING_THUMB_RESTORE_MS;
    return {
      ...placement,
      transform: `translate(${g.x}px, ${g.y}px) scale(${isTravel ? SLIDING_THUMB_TRAVEL_SCALE : 1})`,
      ...size,
      transition: `transform ${ms}ms ${ease}, width ${ms}ms ${ease}, opacity ${ms}ms ease`,
      opacity: isTravel ? SLIDING_THUMB_TRAVEL_OPACITY : '1',
    };
  });

  watch(
    activeIndex,
    () => {
      // 切换前气泡是否已落定：不存在（首次出现 / 重挂）时只落位，不从 0,0 播行程
      const hadGeometry = geometry.value !== null;
      measure();
      window.clearTimeout(restoreTimer);
      if (!geometry.value || !hadGeometry || prefersReducedMotion()) {
        phase.value = 'settle';
        return;
      }
      phase.value = 'travel';
      restoreTimer = window.setTimeout(() => {
        phase.value = 'restore';
      }, SLIDING_THUMB_RESTORE_DELAY_MS);
    },
    { flush: 'post' },
  );

  // 容器挂载 / 替换（v-if 延迟出现）：重挂 RO 并重测；flush post 确保 DOM 就绪
  watch(
    container,
    (root) => {
      resizeObserver?.disconnect();
      if (!root) {
        geometry.value = null;
        return;
      }
      resizeObserver = new ResizeObserver(() => measure());
      resizeObserver.observe(root);
      void nextTick(measure);
    },
    { immediate: true, flush: 'post' },
  );

  // 字体后加载只改变项内文字宽度、不改变容器盒子时 RO 不触发，这里兜底一次
  onMounted(() => {
    void document.fonts?.ready.then(() => measure());
  });

  onUnmounted(() => {
    window.clearTimeout(restoreTimer);
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  return { thumbStyle, measure };
}
