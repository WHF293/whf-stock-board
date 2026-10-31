import { computed, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useBreakpoint } from './use-breakpoint';

/**
 * 全局个股详情右栏窗格状态（lg 档主从布局统一底座，稿：Pad横屏主从布局改造 S10）
 *
 * 对齐 PC dock-panel 的「全站 openStock」语义在移动端 lg 档的等价物：
 * lg（≥840px 且横屏）下任何「查看类」股票行点击写入本状态，页面右栏就地渲染
 * StockDetailPane；md / 竖屏保持整页跳转 /stock/:code 不变。
 *
 * 主从态为页内状态（同热点新闻 paneArticle），不进路由：刷新回占位态、
 * 页面离开即销毁。模块级单例与 use-breakpoint 同策略——同一时刻全站只有
 * 一个个股窗格目标，跨页切换时由目标页自行覆盖。
 *
 * 用法：
 * - 页面：`const { paneSymbol, paneOpen, openStock, closePane } = useStockPane();`
 *   行点击 lg 分流：`if (lg.value) openStock(code); else router.push(...)`；
 *   模板右栏：`<StockDetailPane v-if="paneOpen" :symbol="paneSymbol" @close="closePane" />`；
 * - 竖屏旋转（lg 失效）自动关闭窗格（不自动跳整页，避免旋转即跳页的惊吓）。
 */

/** 窗格当前阅读目标（空串 = 占位态「点击左侧列表查看详情」） */
const paneSymbol = ref('');

/** 模块级单例：与 use-breakpoint 同策略，matchMedia 监听只挂一次 */
const { lg } = useBreakpoint();

/* lg 失效（旋转回竖屏 / 窗口收窄）时关闭窗格：重新点行走整页跳转 */
watch(lg, (isLg) => {
  if (!isLg && paneSymbol.value !== '') paneSymbol.value = '';
});

/**
 * 打开 / 切换个股详情窗格（lg 档行点击统一入口）
 * @returns paneSymbol（当前目标）/ paneOpen（显隐桥接）/ openStock / closePane
 */
export function useStockPane(): {
  paneSymbol: Ref<string>;
  paneOpen: ComputedRef<boolean>;
  openStock: (next: string) => void;
  closePane: () => void;
} {
  /** 窗格显隐（有无阅读目标的语义桥接，供 v-if 消费） */
  const paneOpen = computed(() => paneSymbol.value !== '');

  /**
   * 写入窗格目标（同目标重复点击不触发重载，由 StockDetailPane 内部 watch 守卫）
   * @param next 完整符号（sh600519 形态；空串 = 关闭）
   */
  const openStock = (next: string): void => {
    paneSymbol.value = next;
  };

  /** 关闭窗格（回占位态） */
  const closePane = (): void => {
    paneSymbol.value = '';
  };

  return { paneSymbol, paneOpen, openStock, closePane };
}
