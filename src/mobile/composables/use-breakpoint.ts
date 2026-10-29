import { ref, type Ref } from 'vue';
import { MOBILE_BREAKPOINT_LG_PX, MOBILE_BREAKPOINT_MD_PX } from '../constants';

/** 断点状态：md = ≥600px（Medium），lg = ≥840px（Expanded） */
export interface MobileBreakpoint {
  /** Medium 档及以上（≥600px）：底部 TabBar 换左侧 Rail、列表 2 列 */
  md: Ref<boolean>;
  /** Expanded 档及以上（≥840px）：列表 3 列、个股详情双栏 */
  lg: Ref<boolean>;
}

/* 模块级单例：matchMedia 监听只在首次调用时挂一次，跟随应用生命周期存活；
 * 各组件共享同一份 ref（断点是全局视口状态，不是组件状态，无需逐组件订阅） */
const md = ref(false);
const lg = ref(false);
let initialized = false;

/** 首次调用时挂 matchMedia 监听（浏览器 API，移动端构建无 SSR 场景） */
function ensureWatchers(): void {
  if (initialized) return;
  initialized = true;
  const mdQuery = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT_MD_PX}px)`);
  const lgQuery = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT_LG_PX}px)`);
  const sync = (): void => {
    md.value = mdQuery.matches;
    lg.value = lgQuery.matches;
  };
  sync();
  mdQuery.addEventListener('change', sync);
  lgQuery.addEventListener('change', sync);
}

/**
 * 小米自由窗口 / 大屏断点（2026-10-28 适配新增）
 *
 * 供结构性切换消费（Rail 显隐、个股详情双栏）；纯样式差异（列数、限宽）
 * 一律走 mobile.css 的 @media，不走本 composable。
 * 阈值与 mobile.css 末尾「断点适配」分档保持一致（注释互指）。
 *
 * @returns md / lg 两个响应式布尔（模块级共享，组件间同值）
 * @example
 * const { md } = useBreakpoint();
 * const railVisible = computed(() => md.value && isTabRoute.value);
 */
export function useBreakpoint(): MobileBreakpoint {
  ensureWatchers();
  return { md, lg };
}
