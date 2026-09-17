/**
 * 插件 dsh-sidebar-watch · 顶栏轮播行
 *
 * 顶栏收起态展示的那一条「名称 现价 涨跌幅」，由这里构造。
 *
 * 单独成文件的原因：**它是纯函数**（只依赖几个纯 utils，不碰 pinia、不碰网络），
 * 因此可以被冒烟脚本直跑 —— 文案格式与语气（涨 / 跌 / 平）一旦错了，
 * 顶栏那条轮播就会长期挂着错信息，而它恰恰是用户扫得最多的一行。
 * 引擎（monitor.ts）负责取数与判阈值，展示口径放在这里，各自单一职责。
 */
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { formatPercent } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import { findQuoteBySymbol } from '../../utils/find-quote-by-symbol';
import { WATCH_MARQUEE_SEPARATOR, WATCH_MARQUEE_TONE_BY_TREND } from './constants';
import type { WatchCandidate } from './service';
import type { HeaderMarqueeLine } from '../../types/plugin.types';
import type { FullQuote } from '../../types/stock-quote.types';

/**
 * 造顶栏轮播行（收起态逐条展示的那一行：名称 + 现价 + 涨跌幅）
 *
 * **没有报价的候选不出行** —— 顶栏是给人扫一眼的地方，`--` 挂在那里等于噪音；
 * 宁可让轮播少几条（全部没报价时顶栏按钮回落为条目名）。
 *
 * 除整行 `text` 外还给 `label` / `value`：宿主按两端布局渲染时名称可截断、
 * 价格与涨跌幅常显 —— 顶栏很窄，宁可少看几个字也不能丢掉涨跌幅。
 * @param candidates 候选（已过滤为仍在自选股里的）
 * @param quotes 报价快照（key 为上游原始 `code`，查询走 `findQuoteBySymbol`）
 * @returns 轮播行（保持候选池顺序）
 */
export const buildMarqueeLines = (
  candidates: readonly WatchCandidate[],
  quotes: Readonly<Record<string, FullQuote>>,
): readonly HeaderMarqueeLine[] => {
  const lines: HeaderMarqueeLine[] = [];
  for (const candidate of candidates) {
    const quote = findQuoteBySymbol(quotes, candidate.symbol);
    if (!quote) continue;
    const name = quote.name || candidate.name;
    const price = formatPrice(quote.price ?? null);
    const percent = formatPercent(quote.changePercent ?? null);
    lines.push({
      text: [name, price, percent].join(WATCH_MARQUEE_SEPARATOR),
      label: name,
      value: [price, percent].join(WATCH_MARQUEE_SEPARATOR),
      // 只给语气：具体色值由宿主按涨跌主题映射（插件不碰色值）
      tone: WATCH_MARQUEE_TONE_BY_TREND[getTrendByChangePercent(quote.changePercent ?? 0)],
    });
  }
  return lines;
};
