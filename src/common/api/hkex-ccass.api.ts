import { proxyFetch } from './proxy-fetch';
import { fetchAllMarketQuotes } from './quotes.api.ts';
import {
  HKEX_CCASS_BASELINE_FALLBACK_DAYS,
  HKEX_CCASS_LATEST_PROBE_BACK_DAYS,
  HKEX_CCASS_PAGE_URL,
  HKEX_CCASS_QUARTER_END_MONTH_DAYS,
  HKEX_CCASS_STORE_MAX_DATES,
  HKEX_CCASS_STORE_VERSION,
  HKEX_CCASS_TOP_MOVER_COUNT,
  HKEX_CCASS_VIEWSTATE_TTL_MS,
} from '../constants/hkex-ccass.constants.ts';
import { appStorage } from '../utils/app-local-storage.ts';
import type {
  NorthboundEstimateMover,
  NorthboundEstimateState,
  NorthboundEstimateStore,
} from '../types/northbound.types.ts';

/**
 * 港交所披露易 CCASS 沪深股通持股纪录接口层（北向资金流向估算数据源）
 *
 * 2026-11-06 实测定型：东财自 2024-08 停采北向日度持股（RPT_MUTUAL_HOLD_DET
 * 北向明细止于 2024-09-30，季度表 _STA 仅存最新一期）后，港交所披露易的
 * 「滬港通及深港通持股紀錄查詢服務」仍在逐日披露全市场北向持股（CCASS 参与者
 * 日终合计），纪录保留 12 个月 —— 这是北向流向估算唯一存活的全市场日度来源。
 *
 * 上游形态：ASP.NET 回发页（GET 拿 __VIEWSTATE → POST 表单查指定日期），
 * 响应为整页 HTML（约 1.2MB / 每市场），结果表每行 = CCASS 内部码 + 名称 +
 * 持股量 + 占比。代码映射用英文版页面（mutualmarket.aspx）：每行名称内嵌
 * A 股代码（如 "FORTIOR ... (A #688279)"），实测 9xxxx/3xxxx 全覆盖；
 * 兜底规则：沪市 9xxxx 内部码 = 9 + A 股代码后四位（60xxxx）。
 *
 * 通道：proxyFetch（Tauri Rust 直连 / 浏览器同源 /stock-proxy 透传 POST），
 * 域名白名单 hkexnews.hk 已加入 proxy.constants 与 Tauri capabilities
 */

/** 每市场 ViewState 会话缓存（同一页可反复回发不同日期，无需逐次 GET） */
const viewstateCache = new Map<
  'sh' | 'sz',
  { viewstate: string; generator: string; today: string; expiresAt: number }
>();

/** 本地滚存库 storage key（appStorage 命名空间） */
const CCASS_STORE_KEY = 'northbound-ccass-estimate';

/**
 * Date → 本地 YYYY-MM-DD（不用 toISOString：UTC 换算在 UTC+8 会差一天）
 * @param date 日期对象
 * @returns YYYY-MM-DD
 */
const formatDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * YYYY-MM-DD 减 N 天
 * @param isoDate 起始日期
 * @param days 回退天数
 * @returns 回退后的 YYYY-MM-DD
 */
const minusDays = (isoDate: string, days: number): string => {
  const cursor = new Date(`${isoDate}T00:00:00`);
  cursor.setDate(cursor.getDate() - days);
  return formatDate(cursor);
};

/**
 * 从页面 HTML 提取隐藏表单字段值
 * @param html 查询页 HTML
 * @param name 字段名（__VIEWSTATE / __VIEWSTATEGENERATOR / today / originalShareholdingDate）
 * @returns 字段值（缺失为空串）
 */
const extractHidden = (html: string, name: string): string => {
  const match = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`));
  return match ? match[1] : '';
};

/**
 * 解析 CCASS 结果页数据行（mobile-list 结构：CCASS 码 / 名称 / 持股量）
 *
 * A 股代码优先取名称内嵌的 `#xxxxxx`（英文版页实测全量内嵌）；
 * 无内嵌时沪市 9xxxx 兜底为 60+后四位。两者都取不到的行（ETF 等）丢弃
 * @param html 结果页 HTML
 * @returns 代码 → 持股数（股）映射
 */
const parseHoldings = (html: string): Map<string, number> => {
  const rows = html.match(/<tr>\s*<td class="col-stock-code">[\s\S]*?<\/tr>/g) ?? [];
  const holdings = new Map<string, number>();
  for (const row of rows) {
    const ccassCode = (row.match(/mobile-list-body">(\d+)</) ?? [])[1] ?? '';
    const shares = Number(
      ((row.match(/col-shareholding"[\s\S]*?mobile-list-body">([\d,]+)</) ?? [])[1] ?? '').replaceAll(',', ''),
    );
    if (!ccassCode || !Number.isFinite(shares) || shares <= 0) {
      continue;
    }
    const embedded = (row.match(/#(\d{6})/) ?? [])[1];
    const code =
      embedded ??
      (ccassCode.length === 5 && ccassCode.startsWith('9') ? `60${ccassCode.slice(1)}` : '');
    if (!code) {
      continue;
    }
    holdings.set(code, shares);
  }
  return holdings;
};

/**
 * 获取（带缓存的）指定市场查询页回发表单
 *
 * ViewState 约 700KB~1MB：同一市场内逐日期回发复用，缓存 1 小时
 * @param market 市场（sh 沪股通 / sz 深股通）
 * @returns 回发表单字段
 */
const ensureFormBase = async (
  market: 'sh' | 'sz',
): Promise<{ viewstate: string; generator: string; today: string }> => {
  const cached = viewstateCache.get(market);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  const page = await proxyFetch(`${HKEX_CCASS_PAGE_URL}?t=${market}`);
  if (!page.ok) {
    throw new Error(`CCASS 查询页加载失败（${market.toUpperCase()} HTTP ${page.status}）`);
  }
  const html = await page.text();
  const entry = {
    viewstate: extractHidden(html, '__VIEWSTATE'),
    generator: extractHidden(html, '__VIEWSTATEGENERATOR'),
    // today 是页面上的防伪当前日期（YYYYMMDD），回发时原样携带
    today: extractHidden(html, 'today'),
    expiresAt: Date.now() + HKEX_CCASS_VIEWSTATE_TTL_MS,
  };
  if (!entry.viewstate) {
    throw new Error(`CCASS 查询页解析失败（${market.toUpperCase()} 无 ViewState）`);
  }
  viewstateCache.set(market, entry);
  return entry;
};

/**
 * 查询指定市场指定日期的北向持股快照
 * @param market 市场（sh / sz）
 * @param isoDate 日期（YYYY-MM-DD；非交易日无纪录返回空映射）
 * @returns 代码 → 持股数（股）
 */
const fetchMarketHoldings = async (market: 'sh' | 'sz', isoDate: string): Promise<Map<string, number>> => {
  const base = await ensureFormBase(market);
  const body = new URLSearchParams({
    __VIEWSTATE: base.viewstate,
    __VIEWSTATEGENERATOR: base.generator,
    txtShareholdingDate: isoDate.replaceAll('-', '/'),
    originalShareholdingDate: isoDate.replaceAll('-', '/'),
    sortBy: 'stockcode',
    sortDirection: 'asc',
    today: base.today,
    alertMsg: '',
    btnSearch: 'Search',
  }).toString();
  const res = await proxyFetch(`${HKEX_CCASS_PAGE_URL}?t=${market}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`CCASS 持股查询失败（${market.toUpperCase()} ${isoDate} HTTP ${res.status}）`);
  }
  return parseHoldings(await res.text());
};

/**
 * 读本地滚存库
 * @returns 滚存库对象（缺失 / 版本不符 / 损坏时返回空库）
 */
const readStore = (): NorthboundEstimateStore => {
  try {
    const raw = appStorage.getItem(CCASS_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as NorthboundEstimateStore;
      if (parsed.version === HKEX_CCASS_STORE_VERSION && parsed.snapshots && parsed.estimates) {
        return parsed;
      }
    }
  } catch {
    // 损坏即弃置重建
  }
  return { version: HKEX_CCASS_STORE_VERSION, snapshots: {}, estimates: [] };
};

/**
 * 写本地滚存库（快照日期数超限时按日期序淘汰最旧）
 * @param store
 */
const writeStore = (store: NorthboundEstimateStore): void => {
  const dates = Object.keys(store.snapshots).sort();
  while (dates.length > HKEX_CCASS_STORE_MAX_DATES) {
    delete store.snapshots[dates.shift() ?? ''];
  }
  appStorage.setItem(CCASS_STORE_KEY, JSON.stringify(store));
};

/**
 * 列出截至 today 的最近 count 个季末候选日（新 → 旧）
 * @param today 今天（YYYY-MM-DD）
 * @param count 数量
 * @returns 季末候选日（新 → 旧）
 */
const listQuarterEnds = (today: string, count: number): string[] => {
  const dates: string[] = [];
  const startYear = Number(today.slice(0, 4));
  for (let year = startYear; year >= startYear - 2 && dates.length < count; year -= 1) {
    for (let i = HKEX_CCASS_QUARTER_END_MONTH_DAYS.length - 1; i >= 0 && dates.length < count; i -= 1) {
      const date = `${year}-${HKEX_CCASS_QUARTER_END_MONTH_DAYS[i]}`;
      if (date <= today) {
        dates.push(date);
      }
    }
  }
  return dates;
};

/**
 * 差分两期快照并按现价折算
 * @param prev 基线快照
 * @param current 当前快照
 * @param prices 现价映射（6 位纯代码 → 元）
 * @param names 名称映射（Top 榜展示用）
 * @returns 汇总与增减持 Top 榜
 */
const diffSnapshots = (
  prev: Map<string, number>,
  current: Map<string, number>,
  prices: Map<string, number>,
  names: Map<string, string>,
): { netInflow: number; stockCount: number; topBuys: NorthboundEstimateMover[]; topSells: NorthboundEstimateMover[] } => {
  const movers: NorthboundEstimateMover[] = [];
  let netInflow = 0;
  const codes = new Set([...prev.keys(), ...current.keys()]);
  for (const code of codes) {
    const delta = (current.get(code) ?? 0) - (prev.get(code) ?? 0);
    if (delta === 0) {
      continue;
    }
    const price = prices.get(code);
    const amount = price !== undefined ? delta * price : null;
    if (amount !== null) {
      netInflow += amount;
    }
    movers.push({ code, name: names.get(code) ?? code, sharesDelta: delta, amount });
  }
  movers.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  return {
    netInflow,
    stockCount: codes.size,
    topBuys: movers.filter((m) => (m.amount ?? 0) > 0).slice(0, HKEX_CCASS_TOP_MOVER_COUNT),
    topSells: movers
      .filter((m) => (m.amount ?? 0) < 0)
      .slice(-HKEX_CCASS_TOP_MOVER_COUNT)
      .reverse(),
  };
};

/**
 * 拉取北向资金流向估算（港交所 CCASS 持股差分 × 现价）
 *
 * 流程：
 * 1. 探最新纪录日：沪市查询页 originalShareholdingDate 即上游最新披露日（T-1）；
 * 2. 快照获取带本地缓存（store.snapshots），缺失时拉上游（SH+SZ 各一回发），
 *    候选日无纪录（假日 / 未披露）逐日回退重试；
 * 3. 基线 = 最近一个已过季末；当前 = 最新纪录日；差分 × 现价（全市场行情一次拉齐）
 *    出当前季度进行中估算净流入与增减持 Top 榜；
 * 4. 季度滚过时把「上一季度（上上季末 → 上季末）」差分落定为季度点追加序列
 *    （收盘价以落定时刻现价近似、approxPriced 标记，此后不再重算），
 *    上一上季末快照若仍在 12 个月保留期内会顺带拉取入库。
 *
 * 请求量：首次 ≈ 1 页 + 6 回发（3 日期 × 2 市场，页/回发各约 1.2MB）+ 全市场行情；
 * 之后命中缓存时每日增量仅 2 次回发。快照 / 季度点落 appStorage
 * （northbound-ccass-estimate，快照保留 8 个日期），上游 12 个月保留期内可持续累积
 * @returns 当前季度估算 + 已落定季度序列
 */
export const fetchNorthboundEstimate = async (): Promise<NorthboundEstimateState> => {
  const store = readStore();

  /**
   * 单日快照（本地缓存优先，缺失拉上游；两市场全空 = 该日无纪录）
   * @param date 日期（YYYY-MM-DD）
   * @returns 代码 → 持股数映射（该日无纪录为 null）
   */
  const resolveSnapshot = async (date: string): Promise<Map<string, number> | null> => {
    const local = store.snapshots[date];
    if (local) {
      return new Map(Object.entries(local));
    }
    const [sh, sz] = await Promise.all([fetchMarketHoldings('sh', date), fetchMarketHoldings('sz', date)]);
    if (sh.size === 0 && sz.size === 0) {
      return null;
    }
    const merged = new Map([...sh, ...sz]);
    store.snapshots[date] = Object.fromEntries(merged);
    return merged;
  };

  // 1) 沪市查询页：拿 ViewState + 上游最新披露日（T-1）
  const shPage = await proxyFetch(`${HKEX_CCASS_PAGE_URL}?t=sh`);
  if (!shPage.ok) {
    throw new Error(`CCASS 查询页加载失败（HTTP ${shPage.status}）`);
  }
  const shHtml = await shPage.text();
  viewstateCache.set('sh', {
    viewstate: extractHidden(shHtml, '__VIEWSTATE'),
    generator: extractHidden(shHtml, '__VIEWSTATEGENERATOR'),
    today: extractHidden(shHtml, 'today'),
    expiresAt: Date.now() + HKEX_CCASS_VIEWSTATE_TTL_MS,
  });
  const todayRaw = extractHidden(shHtml, 'today');
  const todayIso =
    todayRaw.length === 8 ? `${todayRaw.slice(0, 4)}-${todayRaw.slice(4, 6)}-${todayRaw.slice(6, 8)}` : formatDate(new Date());
  const latestRaw = extractHidden(shHtml, 'originalShareholdingDate');
  const latestCandidate = latestRaw ? latestRaw.replaceAll('/', '-') : todayIso;

  // 2) 最新纪录日快照（候选日无纪录逐日回退）
  let latestDate: string | null = null;
  let current: Map<string, number> | null = null;
  for (let back = 0; back <= HKEX_CCASS_LATEST_PROBE_BACK_DAYS; back += 1) {
    const date = minusDays(latestCandidate, back);
    current = await resolveSnapshot(date);
    if (current) {
      latestDate = date;
      break;
    }
  }
  if (!latestDate || !current) {
    throw new Error('CCASS 近 7 日无北向持股纪录');
  }

  // 3) 基线季末快照（最近一个已过季末；假日无纪录逐日回退）
  const quarterEnds = listQuarterEnds(todayIso, 3);
  let baselineDate: string | null = null;
  let baseline: Map<string, number> | null = null;
  for (let back = 0; back <= HKEX_CCASS_BASELINE_FALLBACK_DAYS; back += 1) {
    const date = minusDays(quarterEnds[0], back);
    baseline = await resolveSnapshot(date);
    if (baseline) {
      baselineDate = date;
      break;
    }
  }
  if (!baselineDate || !baseline) {
    throw new Error('CCASS 基线季末快照不可得');
  }

  // 4) 现价与名称（全市场行情一次拉齐）
  const quotes = await fetchAllMarketQuotes();
  const prices = new Map<string, number>();
  const names = new Map<string, string>();
  for (const quote of quotes) {
    const code = quote.code.replace(/^(sh|sz|bj)/, '');
    prices.set(code, quote.price);
    names.set(code, quote.name);
  }

  // 5) 季度落定：已跨过基线季末（latestDate > quarterEnds[0]）且该季末尚未落定时，
  //    把「上一季度（上上季末 → 基线季末）」差分落定为季度点（收盘价以落定时刻
  //    现价近似、approxPriced 标记，此后不再重算）；跨季时间过久（> 45 天）不落定，
  //    现价失真过大（此后该季永久缺点，由后续季度自然接续）
  const lastCommitted = store.estimates[store.estimates.length - 1];
  const prevQuarterEnd = quarterEnds[1];
  if (
    latestDate > quarterEnds[0] &&
    (lastCommitted?.date ?? '') !== quarterEnds[0] &&
    minusDays(latestDate, 45) <= quarterEnds[0]
  ) {
    const prevSnapshot = await resolveSnapshot(prevQuarterEnd);
    if (prevSnapshot) {
      const committed = diffSnapshots(prevSnapshot, baseline, prices, names);
      store.estimates.push({
        date: baselineDate,
        prevDate: prevQuarterEnd,
        estimatedNetInflow: committed.netInflow,
        stockCount: committed.stockCount,
        approxPriced: true,
      });
    }
  }

  // 6) 当前季度差分（基线 → 最新）
  const live = diffSnapshots(baseline, current, prices, names);
  writeStore(store);

  return {
    baselineDate,
    latestDate,
    quarterNetInflow: live.netInflow,
    stockCount: live.stockCount,
    snapshotCount: current.size,
    topBuys: live.topBuys,
    topSells: live.topSells,
    estimates: store.estimates,
  };
};
