<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import { fetchMarketFundFlow, fetchSectorFundFlowRank } from '../../common/api/flow.api.ts';
import {
  fetchSectorFlowCurves,
  pickDefaultCurveCodes,
} from '../../common/api/sector-flow-curve.api.ts';
import {
  ensureSectorFlowHistories,
  readSectorFlowHistory,
} from '../../common/api/sector-flow-history.api.ts';
import type { SectorFlowHistoryEntry } from '../../common/api/sector-flow-history.api.ts';
import type { MarketFundFlow, SectorFundFlowItem } from '../../common/types/flow.types.ts';
import type {
  SectorFlowCurve,
  SectorFlowCurveView,
} from '../../common/types/sector-flow-curve.types.ts';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_LINE_BLUE,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../common/constants/chart.constants.ts';
import { YUAN_PER_YI } from '../../common/constants/format.constants.ts';
import { STORAGE_NS_MOBILE_FUND_FLOW_CURVE } from '../../common/constants/storage-key.constants.ts';
import { useMarketStatusStore } from '../../common/stores/market-status';
import { useSettingsStore } from '../../common/stores/settings';
import { toFullSymbol } from '../../common/utils/to-full-symbol';
import { readTrendColors } from '../../common/utils/trend-colors';
import { formatYuanWithSign } from '../../common/utils/format-yuan';
import { formatPct, pctClass } from '../utils/format';
import { appStorage } from '../../common/utils/app-local-storage';
import type { EChartsCoreOption } from 'echarts/core';
import MobileEChart from '../components/MobileEChart.vue';
import MobileGesturePager from '../components/MobileGesturePager.vue';
import {
  FUND_FLOW_CHART_HEIGHT_MAIN,
  FUND_FLOW_CHART_HEIGHT_SECTOR,
  FUND_FLOW_HISTORY_CARD_HEIGHT,
  FUND_FLOW_HISTORY_DAYS,
  FUND_FLOW_MARKET_DAYS,
  FUND_FLOW_SECTOR_DEFAULT_PER_SIDE,
  FUND_FLOW_SECTOR_MAX,
} from '../constants';

/**
 * 资金流向（移动端，v4.3 主 Tab）
 *
 * 四大模块，数据与 PC 同源（PC 端零改动）：
 * 1. 主力净流入：大盘资金流近 10 日折线（PC 市场总览-主力净流入同口径），
 *    每个数据点标注数值（涨跌着色），tooltip + crosshair；
 * 2. 板块资金：多板块当日累计主力净流入分时叠加曲线（PC 行情全景-最新板块资金同口径），
 *    板块池与 PC 一致（行业榜单全量），每次最多选中 8 个，弹窗选择，
 *    appStorage 持久化（独立 key mobile.fundFlowCurve，不与 PC 互通）；
 * 3. 板块历史净流入：逐日双向条形卡（PC BoardFlowDailyCard 样式复刻），一次一页，只显示最近 10 个交易日
 *    （2026-10-13 王总；条形宽度与头部累计额均按展示行归一），
 *    MobileGesturePager 翻页（底部通栏手势条：条上滑动按方向切页 + 点按直达，边界 toast，2026-10-12 与首页统一）；
 * 4. 板块主力净流入榜：当日 top 30（2026-10-13 王总：自行情全景-资金模块迁入，
 *    全景页「资金」chip 整体移除），行尾「＋/✓」一键切换曲线与历史已选集，
 *    行点击进领涨股个股页（沿用原全景页行为）。
 *
 * 重接口不轮询：进入页面 / 手动刷新触发（东财系并发 3 红线由 api 层限流）
 */

const settingsStore = useSettingsStore();
const marketStatus = useMarketStatusStore();

// ---------- 主力净流入（近 10 日大盘资金流） ----------

const marketFlow = ref<MarketFundFlow[]>([]);
const marketLoading = ref(false);
const marketError = ref(false);
/** 最近一次失败的真实错误（错误态透出，真机排障用） */
const marketErrorDetail = ref('');

/** 拉取大盘资金流并截取近 N 日 */
const loadMarketFlow = async (): Promise<void> => {
  marketLoading.value = true;
  marketError.value = false;
  try {
    const flows = await fetchMarketFundFlow();
    marketFlow.value = flows.slice(-FUND_FLOW_MARKET_DAYS);
  } catch (error) {
    marketError.value = true;
    marketErrorDetail.value = error instanceof Error ? error.message : String(error);
  } finally {
    marketLoading.value = false;
  }
};

/** 主力净流入折线 option：每点标注数值（正涨色 / 负跌色）+ tooltip + crosshair + 零线 */
const marketOption = computed<EChartsCoreOption>(() => {
  const colors = readTrendColors();
  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params: unknown) => {
        const list = params as { axisValue: string; value: number }[];
        const item = list[0];
        if (!item) {
          return '';
        }
        return `${item.axisValue}<br/>主力净流入：${formatYuanWithSign(item.value)}`;
      },
    },
    // crosshair：十字准线（横纵两条轴指示线）
    axisPointer: { type: 'cross' },
    grid: { left: 6, right: 12, top: 28, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: marketFlow.value.map((day) => day.date.slice(5)),
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: {
        color: CHART_TEXT_COLOR,
        fontSize: 10,
        formatter: (value: number) => `${(value / YUAN_PER_YI).toFixed(0)}亿`,
      },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: [
      {
        name: '主力净流入',
        type: 'line',
        smooth: true,
        // 曲线固定蓝色（2026-10-13 王总：主力净流入折线不随主题变化；逐点标注仍按正负涨跌色）
        lineStyle: { width: 2, color: CHART_LINE_BLUE },
        areaStyle: { opacity: 0.08, color: CHART_LINE_BLUE },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { type: 'dashed', color: CHART_TEXT_COLOR, opacity: 0.6 },
          data: [{ yAxis: 0 }],
        },
        // 逐点标注：symbol 与数值 label 按正负着涨跌色（value 单位元，标注换算亿；
        // 上游缺数时 mainNetInflow 为 null，颜色与标注按 0 兜底）
        data: marketFlow.value.map((day) => {
          const trendColor = (day.mainNetInflow ?? 0) >= 0 ? colors.up : colors.down;
          return {
            value: day.mainNetInflow,
            itemStyle: { color: trendColor },
            label: {
              show: true,
              position: 'top',
              fontSize: 9,
              color: trendColor,
              formatter: (point: { value: number }) =>
                `${(point.value / YUAN_PER_YI).toFixed(1)}亿`,
            },
          };
        }),
      },
    ],
  };
});

// ---------- 板块排名 / 已选板块（板块池与 PC 一致，选中上限 8） ----------

const sectorRank = ref<SectorFundFlowItem[]>([]);
const rankLoading = ref(false);
const rankError = ref(false);
/** 最近一次失败的真实错误（错误态透出，真机排障用） */
const rankErrorDetail = ref('');

/** 已选板块代码（BK 编号，勾选顺序即历史卡展示顺序） */
const selectedCodes = ref<string[]>([]);

/**
 * 读取持久化的已选板块（坏数据回退空，榜单就绪后补默认勾选）
 * @returns 已选板块代码列表
 */
const readSelectedCodes = (): string[] => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_MOBILE_FUND_FLOW_CURVE);
    const parsed = raw ? (JSON.parse(raw) as { codes?: unknown }) : null;
    return Array.isArray(parsed?.codes)
      ? parsed.codes.filter((code): code is string => typeof code === 'string')
      : [];
  } catch {
    return [];
  }
};

/** 拉取板块净流入排名（进行中共享同一任务防重入） */
let rankTask: Promise<void> | null = null;
const loadSectorRank = (): Promise<void> => {
  if (!rankTask) {
    rankTask = (async () => {
      rankLoading.value = true;
      rankError.value = false;
      try {
        sectorRank.value = await fetchSectorFundFlowRank();
      } catch (error) {
        rankError.value = true;
        rankErrorDetail.value = error instanceof Error ? error.message : String(error);
      } finally {
        rankLoading.value = false;
        rankTask = null;
      }
    })();
  }
  return rankTask;
};

// 已选板块持久化（JSON 比对避免无效写入）
watch(selectedCodes, (codes) => {
  const serialized = JSON.stringify({ codes });
  if (appStorage.getItem(STORAGE_NS_MOBILE_FUND_FLOW_CURVE) !== serialized) {
    appStorage.setItem(STORAGE_NS_MOBILE_FUND_FLOW_CURVE, serialized);
  }
});

// ---------- 板块资金曲线（多板块当日分时叠加，进页拉一次不轮询） ----------

const curveViews = ref<SectorFlowCurveView[]>([]);
const curveLoading = ref(false);
const curveError = ref(false);
/** 最近一次失败的真实错误（全部板块拉取失败时透出，真机排障用） */
const curveErrorDetail = ref('');
/** 本轮加载进度（含失败条目，仅进度展示） */
const curveProgress = ref({ done: 0, total: 0 });

/** 板块排名索引（BK 编号 → 排名行），合并曲线名称 / 涨跌幅用 */
const sectorRankByCode = computed(
  () => new Map(sectorRank.value.map((item) => [item.code, item])),
);

/** 曲线「截至」文案（交易日 + 最后分钟点） */
const curveAsOfText = computed(() => {
  const first = curveViews.value[0];
  const lastPoint = first?.points[first.points.length - 1];
  if (!first || !lastPoint) {
    return '';
  }
  return `${first.tradeDate} ${lastPoint.time}`;
});

/**
 * 合并单条曲线为视图模型：补名称 / 涨跌幅，按「流入值降序 → 流出幅度降序」插入
 * @param curve 刚拉到的曲线
 */
const mergeCurveView = (curve: SectorFlowCurve): void => {
  const rankItem = sectorRankByCode.value.get(curve.code);
  const finalOf = (row: SectorFlowCurveView): number =>
    row.points[row.points.length - 1]?.mainNetInflow ?? 0;
  const rest = curveViews.value.filter((row) => row.code !== curve.code);
  rest.push({
    ...curve,
    // 名称三级回填：榜单 → 曲线接口自带 → BK 编号兜底（王总 2026-10-12：tooltip 须显示板块名）
    name: rankItem?.name ?? curve.name ?? curve.code,
    changePercent: rankItem?.changePercent ?? null,
  });
  rest.sort((a, b) => {
    const fa = finalOf(a);
    const fb = finalOf(b);
    if (fa >= 0 && fb < 0) return -1;
    if (fa < 0 && fb >= 0) return 1;
    return fa >= 0 ? fb - fa : fa - fb;
  });
  curveViews.value = rest;
};

/**
 * 拉取已选板块中尚无曲线的部分（并发 3 限流在 api 层；渐进渲染）
 * @param codes 目标板块代码列表
 */
const loadSectorCurves = async (codes: readonly string[]): Promise<void> => {
  const targets = codes.filter((code) => !curveViews.value.some((row) => row.code === code));
  if (targets.length === 0) {
    return;
  }
  curveLoading.value = true;
  curveError.value = false;
  curveErrorDetail.value = '';
  curveProgress.value = { done: 0, total: targets.length };
  try {
    await fetchSectorFlowCurves(targets, {
      onCurve: (curve) => {
        mergeCurveView(curve);
        curveProgress.value.done += 1;
      },
      onError: (_code, error) => {
        // 批量接口按条吞错不 reject；记下真实错误，全军覆没时透出（真机排障用）
        curveErrorDetail.value = error instanceof Error ? error.message : String(error);
      },
    });
    // 全部失败（批量接口不抛错，以产出为判据）
    curveError.value = targets.length > 0 && curveViews.value.length === 0;
  } catch (error) {
    curveError.value = curveViews.value.length === 0;
    curveErrorDetail.value = error instanceof Error ? error.message : String(error);
  } finally {
    curveLoading.value = false;
  }
};

/** 刷新曲线：清空现有数据按当前已选整场重拉 */
const refreshCurves = (): void => {
  if (curveLoading.value || selectedCodes.value.length === 0) {
    return;
  }
  curveViews.value = [];
  void loadSectorCurves(selectedCodes.value);
};

// 榜单晚于曲线就绪时回填名称 / 涨跌幅（错过合并窗口的曲线避免显示 BK 编号）
watch(sectorRankByCode, (map) => {
  if (map.size === 0 || curveViews.value.length === 0) {
    return;
  }
  curveViews.value = curveViews.value.map((row) => {
    const item = map.get(row.code);
    return item ? { ...row, name: item.name, changePercent: item.changePercent } : row;
  });
});

/** 板块资金多曲线 option（多行业当日累计主力净流入分时叠加；配色口径同 PC 曲线视图） */
const sectorOption = computed<EChartsCoreOption>(() => {
  // 依赖涨跌配色与主题色：切换后本 computed 重新求值
  void settingsStore.trendTheme;
  void settingsStore.themeColor;
  const colors = readTrendColors();
  const upPalette = [colors.upStrong, colors.up, colors.upLight, colors.upPale];
  const downPalette = [colors.downStrong, colors.down, colors.downLight, colors.downPale];
  let upIndex = 0;
  let downIndex = 0;
  const colorList = curveViews.value.map((curve) => {
    const final = curve.points[curve.points.length - 1]?.mainNetInflow ?? 0;
    if (final >= 0) {
      return upPalette[upIndex++ % upPalette.length]!;
    }
    return downPalette[downIndex++ % downPalette.length]!;
  });

  // 公共时间轴 = 点数最多的曲线（同日各板块分钟一致，防御个别缺失）
  let timeline: string[] = [];
  for (const curve of curveViews.value) {
    if (curve.points.length > timeline.length) {
      timeline = curve.points.map((point) => point.time);
    }
  }
  const alignedSeries = curveViews.value.map((curve) => {
    const valueByTime = new Map(curve.points.map((point) => [point.time, point.mainNetInflow]));
    return timeline.map((time) => valueByTime.get(time) ?? null);
  });

  return {
    animation: false,
    legend: {
      type: 'scroll',
      top: 0,
      textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 },
      pageIconColor: CHART_TEXT_COLOR,
      pageIconInactiveColor: CHART_SPLIT_LINE_COLOR,
      itemWidth: 14,
      itemHeight: 7,
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params: unknown) => {
        const items = params as {
          marker: string;
          seriesName: string;
          axisValue: string;
          value: number | null;
        }[];
        const list = items.filter(
          (item): item is (typeof items)[number] & { value: number } => item.value !== null,
        );
        if (list.length === 0) {
          return '';
        }
        const rows = [...list]
          .sort((a, b) => b.value - a.value)
          .map(
            (item) =>
              `${item.marker}${item.seriesName} <b>${(item.value / YUAN_PER_YI).toFixed(2)}亿</b>`,
          );
        return `${list[0].axisValue}<br/>${rows.join('<br/>')}`;
      },
    },
    grid: { left: 6, right: 12, top: 30, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: timeline,
      boundaryGap: false,
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: {
        color: CHART_TEXT_COLOR,
        fontSize: 10,
        formatter: (value: number) => `${(value / YUAN_PER_YI).toFixed(0)}亿`,
      },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: curveViews.value.map((curve, index) => {
      const color = colorList[index]!;
      const line: Record<string, unknown> = {
        name: curve.name,
        type: 'line',
        data: alignedSeries[index],
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1.5, color },
        itemStyle: { color },
        emphasis: { focus: 'series' },
      };
      if (index === 0) {
        line.markLine = {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { type: 'dashed', color: CHART_TEXT_COLOR, opacity: 0.6 },
          data: [{ yAxis: 0 }],
        };
      }
      return line;
    }),
  };
});

// ---------- 板块选择弹窗（板块池与 PC 一致，单轮最多勾 8 个） ----------

const pickerOpen = ref(false);
/** 弹窗内暂存勾选（确认时才生效） */
const pendingCodes = ref<string[]>([]);

/** 弹窗列表：按当日主力净流入降序全量列出 */
const rankSorted = computed(() =>
  [...sectorRank.value].sort((a, b) => (b.mainNetInflow ?? 0) - (a.mainNetInflow ?? 0)),
);

/** 打开弹窗：以当前已选初始化暂存勾选（榜单缺席时顺带补拉） */
const openPicker = (): void => {
  pendingCodes.value = [...selectedCodes.value];
  pickerOpen.value = true;
  if (sectorRank.value.length === 0 && !rankLoading.value) {
    void loadSectorRank();
  }
};

/**
 * 切换某个板块的勾选（达上限后禁止继续勾选）
 * @param code 板块代码
 */
const togglePending = (code: string): void => {
  if (pendingCodes.value.includes(code)) {
    pendingCodes.value = pendingCodes.value.filter((item) => item !== code);
    return;
  }
  if (pendingCodes.value.length < FUND_FLOW_SECTOR_MAX) {
    pendingCodes.value = [...pendingCodes.value, code];
  }
};

/** 确认选择：替换已选集合（未勾选的曲线随 watch 过滤移除，新勾选增量拉取） */
const confirmPicker = (): void => {
  pickerOpen.value = false;
  selectedCodes.value = [...pendingCodes.value];
};

// 已选变化：过滤曲线视图 + 增量拉取 + 历史补齐 + 翻页重置到第一页
watch(selectedCodes, (codes) => {
  curveViews.value = curveViews.value.filter((row) => codes.includes(row.code));
  pagerCurrent.value = 0;
  if (codes.length > 0) {
    void loadSectorCurves(codes);
  }
  ensureFlowHistory();
});

// ---------- 板块历史净流入（本地渐进累积，数据层与 PC 共用） ----------

/** 板块历史（BK 编号索引，读自本地库 whf:sector-flow-history） */
const historyMap = ref<Record<string, SectorFlowHistoryEntry>>({});
/** 拉新合并进行中 */
const historyEnsuring = ref(false);

/**
 * 确保已选板块的历史就绪（盘中拉新合并 / 盘后与非交易日只读本地；
 * 重复触发由 api 层任务共享 + 节流防重入）
 */
const ensureFlowHistory = (): void => {
  if (selectedCodes.value.length === 0) {
    return;
  }
  historyEnsuring.value = true;
  void ensureSectorFlowHistories(selectedCodes.value, {
    isTradingDay: marketStatus.isTradingDay === true,
    inPollingWindow: marketStatus.isASharePollingWindow,
  })
    .then((map) => {
      historyMap.value = map;
    })
    .catch((error: unknown) => {
      console.error('[mobile-fund-flow] history', error);
    })
    .finally(() => {
      historyEnsuring.value = false;
    });
};

/** 历史净流入翻页：当前页下标 */
const pagerCurrent = ref(0);

/** 展示列表 = 已选板块逐个出卡；未入库（拉取失败 / 未就绪）的板块以占位卡展示 */
const displayBoards = computed(() =>
  selectedCodes.value.map((code) => {
    const entry = historyMap.value[code];
    return {
      code,
      name: entry?.name ?? sectorRankByCode.value.get(code)?.name ?? code,
      points: entry?.points ?? [],
      missing: !entry,
    };
  }),
);

/** 当前页板块（模板消费；越界时为 undefined，模板侧已判空） */
const currentBoard = computed(() => displayBoards.value[pagerCurrent.value]);

/** 当前页板块的展示期（最近 10 个交易日）累计净额（元），与卡内展示行口径一致 */
const currentNetSum = computed(() =>
  currentDescPoints.value.reduce((sum, row) => sum + row.net, 0),
);

/** 当前页板块的展示期累计净额文案（亿，带符号） */
const currentNetSumText = computed(() => {
  const value = (currentNetSum.value / YUAN_PER_YI).toFixed(2);
  return currentNetSum.value >= 0 ? `+${value}` : value;
});

/** 当前页逐日行（倒序：最新交易日排最上；只显示最近 10 个交易日，王总 2026-10-13） */
const currentDescPoints = computed(() =>
  [...(currentBoard.value?.points ?? [])].reverse().slice(0, FUND_FLOW_HISTORY_DAYS),
);

/**
 * 条形行宽度（PC BoardFlowDailyCard.barWidthOf 同口径）：
 * 净流入 / 流出各占中线一侧，长度按卡内展示行最大绝对值归一，区间 [2, 48]%
 * @param net 当日净流入（元）
 * @param points 当前卡展示的逐日数据（归一基准）
 * @returns CSS width 值（零值返回 0%）
 */
const barWidthOf = (net: number, points: readonly { net: number }[]): string => {
  if (net === 0) {
    return '0%';
  }
  const maxAbs = Math.max(1, ...points.map((row) => Math.abs(row.net)));
  const pct = Math.max(2, Math.min(48, (Math.abs(net) / maxAbs) * 48));
  return `${pct}%`;
};

// 已选板块数变化时收拢越界的当前页
watch(displayBoards, (boards) => {
  if (pagerCurrent.value > boards.length - 1) {
    pagerCurrent.value = Math.max(boards.length - 1, 0);
  }
});

// 交易日历异步就绪后补一次拉新判定（冷启动 isTradingDay 初始为 null）
watch(
  () => marketStatus.isTradingDay,
  (value, previous) => {
    if (value !== null && previous === null) {
      ensureFlowHistory();
    }
  },
);

// ---------- 模块四：板块主力净流入榜（自行情全景-资金迁入，复用 sectorRank 数据） ----------

const router = useRouter();

/** 榜单展示：当日净流入降序前 30 */
const rankTop30 = computed(() => rankSorted.value.slice(0, 30));

/**
 * 榜单行尾勾选态（已在曲线与历史已选集内）
 * @param code 板块代码
 * @returns 是否已勾选
 */
const isPicked = (code: string): boolean => selectedCodes.value.includes(code);

/**
 * 行尾「＋/✓」：切换该板块在曲线与历史已选集的勾选
 * （复用 8 个上限与 appStorage 持久化，加入/移除由既有 watch 自动拉取/清理曲线与历史）
 * @param code 板块代码
 */
const toggleRankCode = (code: string): void => {
  if (selectedCodes.value.includes(code)) {
    selectedCodes.value = selectedCodes.value.filter((item) => item !== code);
    return;
  }
  if (selectedCodes.value.length >= FUND_FLOW_SECTOR_MAX) {
    showToast(`最多选择 ${FUND_FLOW_SECTOR_MAX} 个板块`);
    return;
  }
  selectedCodes.value = [...selectedCodes.value, code];
};

/**
 * 行点击：进领涨股个股页（沿用原全景-资金行为；无领涨股不跳转）
 * @param item 榜单行
 */
const goRankRow = (item: SectorFundFlowItem): void => {
  if (!item.topStockCode) return;
  void router.push(`/stock/${toFullSymbol(item.topStockCode)}`);
};

// ---------- 初始化：三模块并行就绪 ----------

onMounted(() => {
  selectedCodes.value = readSelectedCodes();
  historyMap.value = readSectorFlowHistory();
  void loadMarketFlow();
  // 移动端没有 PC MainLayout 的日历刷新链路：进页补一次交易日历刷新，
  // isTradingDay 就绪（null → 值）后由上方 watcher 补拉历史净流入
  void marketStatus.refresh().catch(() => undefined);
  void (async () => {
    await loadSectorRank();
    // 首次使用（无持久化勾选）：按当日净流入流入 / 流出各取前 N 补默认勾选
    if (selectedCodes.value.length === 0 && sectorRank.value.length > 0) {
      selectedCodes.value = pickDefaultCurveCodes(
        sectorRank.value,
        FUND_FLOW_SECTOR_DEFAULT_PER_SIDE,
      );
    }
    if (selectedCodes.value.length > 0) {
      void loadSectorCurves(selectedCodes.value);
      ensureFlowHistory();
    }
  })();
});
</script>

<template>
  <div class="m-page-flex">
    <!-- 2026-10-20 起移出 TabBar（入口 = 首页金刚区），二级页形态带返回键 -->
    <van-nav-bar
      title="资金流向"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    />

    <div class="m-ff-scroll">
      <!-- 模块一：主力净流入（近 10 日，每点标注 + tooltip + crosshair） -->
      <section class="m-ff-card">
        <header class="m-ff-head">
          <h2 class="m-ff-head__title">主力净流入</h2>
          <span class="m-ff-head__sub">近 {{ FUND_FLOW_MARKET_DAYS }} 日 · 单位亿</span>
          <button class="m-ff-head__btn" :disabled="marketLoading" @click="loadMarketFlow">↻</button>
        </header>
        <div v-if="marketLoading && marketFlow.length === 0" class="m-ff-skeleton">加载中…</div>
        <div v-else-if="marketError && marketFlow.length === 0" class="m-ff-error">
          <span>加载失败，请检查网络后重试</span>
          <span v-if="marketErrorDetail" class="m-ff-error__detail">{{ marketErrorDetail }}</span>
          <button class="m-ff-error__retry" @click="loadMarketFlow">↻ 重新加载</button>
        </div>
        <MobileEChart
          v-else-if="marketFlow.length > 0"
          :options="marketOption"
          :style="{ height: `${FUND_FLOW_CHART_HEIGHT_MAIN}px` }"
        />
        <div v-else class="m-ff-empty">暂无数据</div>
      </section>

      <!-- 模块二：板块资金（板块池与 PC 一致，最多选 8，弹窗选择） -->
      <section class="m-ff-card">
        <header class="m-ff-head">
          <h2 class="m-ff-head__title">板块资金</h2>
          <span class="m-ff-head__sub">
            <template v-if="curveAsOfText">截至 {{ curveAsOfText }}</template>
            <template v-if="curveLoading">
              · 加载 {{ curveProgress.done }}/{{ curveProgress.total }}
            </template>
          </span>
          <button class="m-ff-head__btn" :disabled="curveLoading" @click="refreshCurves">↻</button>
          <button class="m-ff-head__btn m-ff-head__btn--pick" @click="openPicker">
            选择板块 {{ selectedCodes.length }}/{{ FUND_FLOW_SECTOR_MAX }}
          </button>
        </header>
        <div v-if="curveLoading && curveViews.length === 0" class="m-ff-skeleton">
          加载曲线 {{ curveProgress.done }}/{{ curveProgress.total }}…
        </div>
        <div v-else-if="curveError && curveViews.length === 0" class="m-ff-error">
          <span>板块资金曲线加载失败</span>
          <span v-if="curveErrorDetail" class="m-ff-error__detail">{{ curveErrorDetail }}</span>
          <button class="m-ff-error__retry" @click="refreshCurves">↻ 重新加载</button>
        </div>
        <MobileEChart
          v-else-if="curveViews.length > 0"
          not-merge
          :options="sectorOption"
          :style="{ height: `${FUND_FLOW_CHART_HEIGHT_SECTOR}px` }"
        />
        <div v-else class="m-ff-empty">暂无曲线数据，请点击「选择板块」添加</div>
      </section>

      <!-- 模块三：板块历史净流入（一页一板块，手势翻页 + 底部指示条） -->
      <section class="m-ff-card">
        <header class="m-ff-head">
          <h2 class="m-ff-head__title">板块历史净流入</h2>
          <span class="m-ff-head__sub">
            {{ displayBoards.length }} 个板块<template v-if="historyEnsuring"> · 更新中…</template>
          </span>
          <button
            class="m-ff-head__btn"
            :disabled="historyEnsuring || selectedCodes.length === 0"
            @click="ensureFlowHistory()"
          >
            ↻
          </button>
        </header>

        <div
          v-if="historyEnsuring && displayBoards.every((board) => board.missing)"
          class="m-ff-skeleton"
        >
          历史数据准备中…
        </div>
        <MobileGesturePager
          v-else-if="displayBoards.length > 0"
          v-model:current="pagerCurrent"
          :total="displayBoards.length"
          class="m-ff-history"
          :style="{ height: `${FUND_FLOW_HISTORY_CARD_HEIGHT}px` }"
        >
          <!-- 单页：板块逐日双向条形卡（PC BoardFlowDailyCard 样式复刻） -->
          <section v-if="currentBoard" class="m-ff-hcard">
            <header class="m-ff-hcard__head">
              <h3 class="m-ff-hcard__name">{{ currentBoard.name }}（{{ currentBoard.code }}）</h3>
              <span v-if="currentBoard.missing" class="m-ff-hcard__sum is-missing">--</span>
              <span
                v-else
                class="m-ff-hcard__sum"
                :class="currentNetSum >= 0 ? 'is-up' : 'is-down'"
              >
                {{ currentNetSumText }}亿
              </span>
            </header>
            <div v-if="currentBoard.missing" class="m-ff-hcard__missing">
              <span>历史拉取失败</span>
              <span>稍后点「↻」重试</span>
            </div>
            <div v-else class="m-ff-hcard__rows">
              <div v-for="row in currentDescPoints" :key="row.date" class="m-ff-hcard__row">
                <span class="m-ff-hcard__date">{{ row.date.slice(5) }}</span>
                <div class="m-ff-hcard__track">
                  <div class="m-ff-hcard__zero"></div>
                  <div
                    v-if="row.net > 0"
                    class="m-ff-hcard__bar is-up"
                    :style="{ width: barWidthOf(row.net, currentDescPoints) }"
                  ></div>
                  <div
                    v-else-if="row.net < 0"
                    class="m-ff-hcard__bar is-down"
                    :style="{ width: barWidthOf(row.net, currentDescPoints) }"
                  ></div>
                </div>
              </div>
              <div v-if="currentBoard.points.length === 0" class="m-ff-hcard__missing">
                <span>暂无历史数据</span>
              </div>
            </div>
          </section>
        </MobileGesturePager>
        <div v-else class="m-ff-empty">
          在「板块资金」的「选择板块」勾选后，这里展示逐日净流入历史
        </div>
      </section>

      <!-- 模块四：板块主力净流入榜（2026-10-13 自行情全景-资金迁入） -->
      <section class="m-ff-card">
        <header class="m-ff-head">
          <h2 class="m-ff-head__title">板块主力净流入</h2>
          <span class="m-ff-head__sub">当日 · 前 30</span>
          <button
            class="m-ff-head__btn"
            :disabled="rankLoading"
            @click="loadSectorRank"
          >
            ↻
          </button>
        </header>
        <div v-if="rankLoading && sectorRank.length === 0" class="m-ff-skeleton">加载中…</div>
        <div v-else-if="rankError && sectorRank.length === 0" class="m-ff-error">
          <span>板块榜单加载失败</span>
          <span v-if="rankErrorDetail" class="m-ff-error__detail">{{ rankErrorDetail }}</span>
          <button class="m-ff-error__retry" :disabled="rankLoading" @click="loadSectorRank">
            ↻ 重新加载
          </button>
        </div>
        <div v-else-if="rankTop30.length > 0" class="m-ff-rank">
          <div
            v-for="(item, idx) in rankTop30"
            :key="item.code"
            class="m-ff-rank__row"
            @click="goRankRow(item)"
          >
            <span class="m-ff-rank__idx" :class="{ 'is-top': idx < 3 }">{{ idx + 1 }}</span>
            <div class="m-ff-rank__main">
              <div class="m-ff-rank__name">{{ item.name }}</div>
              <div v-if="item.topStockName" class="m-ff-rank__lead">
                领涨 {{ item.topStockName }}
              </div>
            </div>
            <span
              class="m-ff-rank__val"
              :class="(item.mainNetInflow ?? 0) >= 0 ? 'is-up' : 'is-down'"
            >
              {{ formatYuanWithSign(item.mainNetInflow) }}
            </span>
            <span class="m-row__pct pill" :class="pctClass(item.changePercent)">
              {{ formatPct(item.changePercent) }}
            </span>
            <button
              class="m-ff-rank__add"
              :class="{ 'is-on': isPicked(item.code) }"
              :title="isPicked(item.code) ? '已加入曲线与历史，点击移除' : '加入曲线与历史已选集'"
              @click.stop="toggleRankCode(item.code)"
            >
              {{ isPicked(item.code) ? '✓' : '＋' }}
            </button>
          </div>
          <div class="m-ff-rank__foot">行点击看领涨股 · 行尾「＋」加入上方曲线与历史已选集</div>
        </div>
        <div v-else class="m-ff-empty">暂无数据</div>
      </section>
    </div>

    <!-- 选择板块弹层（按当日主力净流入降序全量列出，上限 8） -->
    <van-popup v-model:show="pickerOpen" position="bottom" round style="height: 75dvh">
      <div class="m-ff-picker">
        <div class="m-ff-picker__head">
          <div class="m-ff-picker__title">选择板块</div>
          <div class="m-ff-picker__meta">
            按当日主力净流入排序 · 最多 {{ FUND_FLOW_SECTOR_MAX }} 个
            <button
              class="m-ff-picker__clear"
              :disabled="pendingCodes.length === 0"
              @click="pendingCodes = []"
            >
              清空
            </button>
          </div>
        </div>
        <div v-if="rankLoading && sectorRank.length === 0" class="m-ff-skeleton">加载中…</div>
        <div v-else-if="sectorRank.length === 0" class="m-ff-error">
          <span>行业榜单加载失败</span>
          <span v-if="rankErrorDetail" class="m-ff-error__detail">{{ rankErrorDetail }}</span>
          <button class="m-ff-error__retry" :disabled="rankLoading" @click="loadSectorRank">
            ↻ 重试
          </button>
        </div>
        <div v-else class="m-ff-picker__list">
          <label
            v-for="item in rankSorted"
            :key="item.code"
            class="m-ff-picker__row"
            :class="{
              'm-ff-picker__row--off':
                !pendingCodes.includes(item.code) && pendingCodes.length >= FUND_FLOW_SECTOR_MAX,
            }"
          >
            <input
              type="checkbox"
              class="m-ff-picker__check"
              :checked="pendingCodes.includes(item.code)"
              :disabled="
                !pendingCodes.includes(item.code) && pendingCodes.length >= FUND_FLOW_SECTOR_MAX
              "
              @change="togglePending(item.code)"
            />
            <span class="m-ff-picker__name">{{ item.name }}</span>
            <span
              class="m-ff-picker__val"
              :class="(item.mainNetInflow ?? 0) >= 0 ? 'is-up' : 'is-down'"
            >
              {{ formatYuanWithSign(item.mainNetInflow) }}
            </span>
          </label>
        </div>
        <van-button
          type="primary"
          block
          round
          :disabled="pendingCodes.length === 0"
          @click="confirmPicker"
        >
          确定（{{ pendingCodes.length }}）
        </van-button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.m-ff-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 底部内边距给悬浮 TabBar 让位（与 .m-tab-safe 同值），否则末屏内容被遮挡 */
  padding: 10px 12px calc(88px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.m-ff-card {
  background: var(--color-surface);
  border-radius: 12px;
  padding: 12px 12px 8px;
}
.m-ff-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.m-ff-head__title {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
}
.m-ff-head__sub {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  color: var(--color-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-ff-head__btn {
  flex-shrink: 0;
  border: none;
  background: var(--m-page-bg);
  color: var(--color-text-2);
  border-radius: 999px;
  min-height: 24px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.m-ff-head__btn:disabled {
  opacity: 0.5;
}
.m-ff-head__btn--pick {
  background: var(--color-primary-weak);
  color: var(--color-primary);
}
.m-ff-skeleton,
.m-ff-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  font-size: 12px;
  color: var(--color-text-3);
  text-align: center;
}
.m-ff-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
  font-size: 12px;
  color: var(--color-text-2);
  text-align: center;
}
.m-ff-error__retry {
  border: none;
  background: var(--color-primary-weak);
  color: var(--color-primary);
  border-radius: 999px;
  min-height: 26px;
  padding: 0 14px;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
}
.m-ff-error__retry:disabled {
  opacity: 0.5;
}
/* 真实错误详情（真机排障透出；小号弱色，可换行） */
.m-ff-error__detail {
  font-size: 10px;
  color: var(--color-text-3);
  word-break: break-all;
  text-align: left;
  max-width: 100%;
}

/* 历史卡（PC BoardFlowDailyCard 样式复刻：双向条形 + 中线零轴，最新交易日排最上） */
.m-ff-hcard {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--m-page-bg);
  border-radius: 10px;
  padding: 10px 12px;
}
.m-ff-hcard__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  flex-shrink: 0;
}
.m-ff-hcard__name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 700;
  margin: 0;
}
.m-ff-hcard__sum {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.m-ff-hcard__sum.is-missing {
  color: var(--color-text-3);
  font-weight: 500;
}
.m-ff-hcard__sum.is-up {
  color: var(--color-up);
}
.m-ff-hcard__sum.is-down {
  color: var(--color-down);
}
.m-ff-hcard__rows {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* WebView 默认隐藏 overlay 滚动条，显式画出细滑块（PC 同为原生滚动条，此处对齐观感） */
.m-ff-hcard__rows::-webkit-scrollbar {
  width: 4px;
}
.m-ff-hcard__rows::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 999px;
}
.m-ff-hcard__row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.m-ff-hcard__date {
  width: 36px;
  flex-shrink: 0;
  text-align: right;
  font-size: 10px;
  color: var(--color-text-3);
  font-variant-numeric: tabular-nums;
}
.m-ff-hcard__track {
  position: relative;
  height: 10px;
  flex: 1;
  min-width: 0;
}
.m-ff-hcard__zero {
  position: absolute;
  inset-block: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--color-border);
}
.m-ff-hcard__bar {
  position: absolute;
  inset-block: 0;
}
.m-ff-hcard__bar.is-up {
  right: 50%;
  border-radius: 2px 0 0 2px;
  background: var(--color-up);
}
.m-ff-hcard__bar.is-down {
  left: 50%;
  border-radius: 0 2px 2px 0;
  background: var(--color-down);
}
.m-ff-hcard__missing {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-3);
}

/* 模块四：板块主力净流入榜（自全景-资金迁入；行样式对齐稿子 rank-row 体系） */
.m-ff-rank {
  display: flex;
  flex-direction: column;
}
.m-ff-rank__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 2px;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
}
.m-ff-rank__idx {
  width: 18px;
  flex-shrink: 0;
  text-align: center;
  font-size: 11px;
  font-weight: 800;
  color: var(--color-text-3);
  font-variant-numeric: tabular-nums;
}
.m-ff-rank__idx.is-top {
  color: var(--color-up);
}
.m-ff-rank__main {
  flex: 1;
  min-width: 0;
}
.m-ff-rank__name {
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-ff-rank__lead {
  font-size: 10px;
  color: var(--color-text-3);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-ff-rank__val {
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.m-ff-rank__val.is-up {
  color: var(--color-up);
}
.m-ff-rank__val.is-down {
  color: var(--color-down);
}
.m-ff-rank__add {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px dashed var(--color-border);
  background: none;
  color: var(--color-text-3);
  font-size: 13px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.m-ff-rank__add.is-on {
  border-style: solid;
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-weak);
}
.m-ff-rank__foot {
  padding: 8px 2px 2px;
  font-size: 10.5px;
  color: var(--color-text-3);
  text-align: center;
}

/* 选择板块弹层 */
.m-ff-picker {
  padding: 14px 16px calc(16px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.m-ff-picker__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-ff-picker__title {
  font-size: 15px;
  font-weight: 700;
}
.m-ff-picker__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-3);
}
.m-ff-picker__clear {
  border: none;
  background: none;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 600;
  padding: 0;
  cursor: pointer;
}
.m-ff-picker__clear:disabled {
  opacity: 0.5;
}
.m-ff-picker__list {
  overflow-y: auto;
  /* 弹层固定 75dvh（王总 2026-10-12）：列表吃掉头部/按钮之外的剩余高度 */
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 10px;
}
.m-ff-picker__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  cursor: pointer;
  border-radius: 6px;
}
.m-ff-picker__row--off {
  opacity: 0.45;
}
.m-ff-picker__check {
  accent-color: var(--color-primary);
  margin: 0;
}
.m-ff-picker__name {
  min-width: 0;
  flex: 1;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-ff-picker__val {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.m-ff-picker__val.is-up {
  color: var(--color-up);
}
.m-ff-picker__val.is-down {
  color: var(--color-down);
}
</style>
