import { ref, type Ref } from 'vue';
import { MOBILE_BREAKPOINT_LG_PX, MOBILE_BREAKPOINT_MD_PX } from '../constants';

/** 断点状态：md = ≥600px（Medium），lg = ≥840px（Expanded）；均要求横屏——
 *  2026-10-30 王总指定：pad 竖屏整体回退 mobile 形态（TabBar / 页面布局同手机），
 *  仅横屏才启用 Rail / 双栏等 pad 结构 */
export interface MobileBreakpoint {
  /** Medium 档及以上（≥600px 且横屏）：底部 TabBar 换左侧 Rail、列表 2 列 */
  md: Ref<boolean>;
  /** Expanded 档及以上（≥840px 且横屏）：列表 3 列、个股详情双栏 */
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
  // 宽度断点叠加 orientation: landscape：pad 竖屏（宽再大）一律按 mobile 形态
  const mdQuery = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT_MD_PX}px) and (orientation: landscape)`);
  const lgQuery = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT_LG_PX}px) and (orientation: landscape)`);
  const sync = (): void => {
    md.value = mdQuery.matches;
    lg.value = lgQuery.matches;
  };
  sync();
  mdQuery.addEventListener('change', sync);
  lgQuery.addEventListener('change', sync);
  // 兜底（2026-10-31）：部分 WebView 的 MQL change 事件不可靠（dev 实测：窄视口启动
  // 后变宽，matchMedia 命中已翻转但 ref 滞后 false，表现为主从页行点击仍走整页跳转）。
  // resize / orientationchange 时强制重查（sync 幂等，代价为两次布尔赋值）
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
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
