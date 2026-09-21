/**
 * 插件 dsh-watch-widget · 展示载荷构造（纯函数）
 *
 * 与 dsh-sidebar-watch 的 marquee.ts 同一思路：文案与口径一旦错了，
 * 小组件就是用户扫得最多的那行字，因此构造逻辑独立成纯函数、可被冒烟直跑。
 * 数据全部来自主窗口既有盯盘引擎的快照 —— 小组件窗口自身不发任何上游请求。
 */
import { HEADER_MARQUEE_TONE } from '../../constants/plugin.constants';
import { isAlertConfigured } from '../sidebar-watch/alerts';
import { buildMarqueeLines } from '../sidebar-watch/marquee';
import { findQuoteBySymbol } from '../../utils/find-quote-by-symbol';
import { normalizeAShareCode } from '../../utils/normalize-a-share-code';
import type { WatchCandidate } from '../sidebar-watch/service';
import type { ContextStock } from '../../stores/stock-context';
import type { WatchWidgetRow } from '../../types/watch-widget.types';
import type { FullQuote } from '../../types/stock-quote.types';

/**
 * 构造小组件轮播行（顶栏轮播同一份口径：名称 + 现价 + 涨跌幅 + 语气）
 *
 * 行与候选按下标一一对应（buildMarqueeLines 不做过滤、保持候选顺序），
 * symbol / 阈值触发态从候选侧补齐 —— 顶栏轮播行本身不带这两个交互字段。
 * @param candidates 候选（已过滤为仍在自选股里的）
 * @param quotes 报价快照（key 为上游原始 `code`）
 * @returns 小组件载荷行（保持候选池顺序）
 */
export const buildWatchWidgetRows = (
  candidates: readonly WatchCandidate[],
  quotes: Readonly<Record<string, FullQuote>>,
): WatchWidgetRow[] => {
  const lines = buildMarqueeLines(candidates, quotes);
  return lines.map((line, index) => {
    const candidate = candidates[index];
    return {
      symbol: candidate?.symbol ?? '',
      name: line.label ?? line.text,
      price: line.price ?? '--',
      percent: line.percent ?? '--',
      // 顶栏轮播行的语气是可选字段（类型层面），构造端恒有值，兜底按平盘中性色
      tone: line.tone ?? HEADER_MARQUEE_TONE.FLAT,
      fired: Boolean(candidate && isAlertConfigured(candidate.alert) && !candidate.alert.armed),
    };
  });
};

/**
 * 构造详情页左侧上下文列表（= 盯盘候选，与顶栏下拉「跳详情整页」同一口径）
 *
 * symbol 归一化为完整符号，保证与详情页路由符号同形态、当前股高亮可匹配。
 * @param candidates 候选（已过滤为仍在自选股里的）
 * @param quotes 报价快照
 * @returns 上下文股票列表
 */
export const buildWatchContextList = (
  candidates: readonly WatchCandidate[],
  quotes: Readonly<Record<string, FullQuote>>,
): ContextStock[] =>
  candidates.map((candidate) => {
    const quote = findQuoteBySymbol(quotes, candidate.symbol);
    return {
      symbol: normalizeAShareCode(candidate.symbol),
      name: quote?.name || candidate.name,
      price: quote?.price ?? null,
      changePercent: quote?.changePercent ?? null,
    };
  });
