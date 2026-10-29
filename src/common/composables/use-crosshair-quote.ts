import { computed, ref, watch, type Ref } from 'vue';
import type { KLineData } from 'klinecharts';
import type { FullQuote } from '../types/stock-quote.types.ts';
import {
  KLINE_TURNOVER_YUAN_PER_WAN,
  KLINE_VOLUME_SHARES_PER_LOT,
} from '../constants/kline.constants.ts';

/**
 * 十字光标悬停 K 线 → 行情头联动（use-crosshair-quote）
 *
 * K 线图（KlineChart.vue）经 subscribeAction('onCrosshairChange') 对外发 crosshairBar
 * 事件；本组合式函数把悬停 bar 的开高低收 / 成交量 / 成交额覆盖到最新报价上，
 * 供「顶栏报价摘要 + 报价头」（个股详情整页）与「报价头」（侧栏详情面板）临时展示
 * 该根 K 线的数据；十字光标离开（事件发 null）即回落实时报价。
 *
 * 量纲对齐（上游均为新浪 K 线源）：
 * - bar.volume 单位为股，行情报价 volume 为手 → ÷ KLINE_VOLUME_SHARES_PER_LOT
 * - bar.turnover 单位为元且仅分钟级周期有值（日 / 周 / 月 K 恒为 0），
 *   行情报价 amount 为万 → 有值时 ÷ KLINE_TURNOVER_YUAN_PER_WAN，无值保留实时额
 *
 * 涨跌口径：
 * - 蜡烛模式：悬停 bar 的昨收取序列内前一根 close（首根回退实时昨收），
 *   涨跌幅即该根自身的周期涨跌（日 K = 当日涨跌、周 K = 当周涨跌）
 * - 分时 / 五日模式：图表内 close 已转成相对实时昨收的涨跌幅（与图内轴同口径），
 *   昨收直接取实时报价的 prevClose
 */

/** 十字光标 bar：分时 / 五日经图表内转换，原始收盘价挂在 price 自定义字段（见 KlineChart displayBars） */
type CrosshairBar = KLineData & { price?: number };

/**
 * 十字光标联动行情头
 * @param options 十字光标联动配置
 * @param options.quote 实时报价（轮询刷新；null 时联动不生效）
 * @param options.bars 当前 K 线序列（与图表装载的 props.bars 同源；序列整体更换时自动清空悬停态）
 * @param options.mode 图表模式（分时 / 五日为 timeline，其余蜡烛）
 * @returns hoveredBar 悬停的 K 线（null = 未悬停）、onCrosshairBar 事件回调（绑 KlineChart 的
 *          crosshair-bar）、displayQuote 行情头展示数据（未悬停时即实时报价）
 */
export const useCrosshairQuote = (options: {
  quote: Ref<FullQuote | null>;
  bars: Ref<KLineData[]>;
  mode: Ref<'timeline' | 'candle'>;
}): {
  hoveredBar: Ref<KLineData | null>;
  onCrosshairBar: (bar: KLineData | null) => void;
  displayQuote: Ref<FullQuote | null>;
} => {
  const { quote, bars, mode } = options;

  /** 十字光标悬停的 K 线（null = 未悬停，行情头展示最新报价） */
  const hoveredBar = ref<KLineData | null>(null);

  /**
   * KlineChart crosshair-bar 事件回调：悬停发该根 bar，离开发 null
   * @param bar 悬停的 K 线（null = 未悬停）
   */
  const onCrosshairBar = (bar: KLineData | null): void => {
    hoveredBar.value = bar;
  };

  // 图表经 :key（符号 + 模式）重建时不会补发「离开」事件，换股 / 换周期 /
  // 换报价对象后残留的悬停 bar 会把旧股数据盖到新股行情头上 —— 序列或报价代码
  // 一旦变更即清空悬停态
  watch(bars, () => {
    hoveredBar.value = null;
  });
  watch(
    () => quote.value?.code,
    () => {
      hoveredBar.value = null;
    },
  );

  /**
   * 悬停 bar 的原始收盘价：蜡烛模式 close 即价格；分时 / 五日图表内 close
   * 已转成涨跌幅小数，原始价在图表转换时挂在 price 字段
   * @param bar 悬停 bar
   * @returns 原始收盘价
   */
  const barPrice = (bar: KLineData): number => {
    const crosshairBar = bar as CrosshairBar;
    return typeof crosshairBar.price === 'number' ? crosshairBar.price : bar.close;
  };

  /**
   * 悬停 bar 的昨收基准：蜡烛取序列内前一根 close（首根回退实时昨收）；
   * 分时 / 五日取实时昨收（与图内涨跌幅轴同口径）
   * @param bar 悬停 bar
   * @returns 昨收价
   */
  const barPrevClose = (bar: KLineData): number => {
    if (mode.value === 'timeline') {
      return quote.value?.prevClose ?? 0;
    }
    const list = bars.value;
    const index = list.findIndex((item) => item.timestamp === bar.timestamp);
    if (index > 0) {
      return list[index - 1].close;
    }
    return quote.value?.prevClose ?? 0;
  };

  /**
   * 行情头展示数据：未悬停时即实时报价；悬停时把该根 K 线的开高低收 /
   * 成交量 / 成交额（量纲换算后）覆盖到实时报价上，涨跌额与涨跌幅按该根
   * close 相对自身昨收重算，其余字段（市值 / 换手 / 市盈等）保留实时报价
   */
  const displayQuote = computed<FullQuote | null>(() => {
    const current = quote.value;
    const bar = hoveredBar.value;
    if (!current || !bar) return current;
    const prevClose = barPrevClose(bar);
    const price = barPrice(bar);
    const change = prevClose ? price - prevClose : 0;
    const turnover = bar.turnover ?? 0;
    return {
      ...current,
      price,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      volume:
        bar.volume === undefined
          ? current.volume
          : bar.volume / KLINE_VOLUME_SHARES_PER_LOT,
      amount:
        turnover > 0 ? turnover / KLINE_TURNOVER_YUAN_PER_WAN : current.amount,
      change,
      changePercent: prevClose ? (change / prevClose) * 100 : 0,
    };
  });

  return { hoveredBar, onCrosshairBar, displayQuote };
};
