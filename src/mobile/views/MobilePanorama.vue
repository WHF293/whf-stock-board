<script setup lang="ts">
/**
 * 行情全景（v2 二期二级页，稿：market-modules-v2 P0-P2；规范：design-mobile.md §5.1）
 *
 * 模块 chips：A股 / 资金 / 美球 / 新股；
 * - A股：涨跌统计 4 卡（由板块表现前端现算，口径同 PC）+ 行业/概念板块行（点击手风琴展开成分股，行点击进个股页）
 * - 资金：板块主力净流入榜 + 净流入/净流出前 2 板块的当日逐分钟累计曲线（SVG）
 * - 美球：美股行业 ETF / 全球指数 / 外盘商品 三组涨跌列表
 * - 新股：打新表（发行价/申购日/收益）
 * 数据层全部复用 PC common api；分区独立加载与降级（design-mobile.md §6）
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import {
  fetchConceptBoards,
  fetchConceptConstituents,
  fetchIndustryBoards,
  fetchIndustryConstituents,
} from '../../common/api/board.api';
import {
  fetchGlobalFuturesPanorama,
  fetchGlobalIndexPanorama,
  fetchUsSectorPanorama,
} from '../../common/api/panorama.api';
import { fetchSectorFundFlowRank } from '../../common/api/flow.api';
import {
  fetchSectorFlowCurves,
  pickDefaultCurveCodes,
} from '../../common/api/sector-flow-curve.api';
import { fetchIpoBoard } from '../../common/api/ipo-board.api';
import type { SectorFundFlowItem } from '../../common/types/flow.types';
import type { SectorFlowCurve } from '../../common/types/sector-flow-curve.types';
import type { PanoramaItem } from '../../common/types/panorama.types';
import type { IpoBoardItem } from '../../common/types/ipo-board.types';
import type { BoardRow } from '../../common/constants/boards.constants';
import { BOARD_STAT_THRESHOLD } from '../../common/constants/boards.constants';
import { toFullSymbol } from '../../common/utils/to-full-symbol';
import { mobileCacheGet, mobileCacheSet } from '../cache';
import { pctClass } from '../utils/format';

const router = useRouter();

/** 模块 chips */
const MODULES = [
  { key: 'cn', label: 'A股' },
  { key: 'flow', label: '资金' },
  { key: 'global', label: '美球' },
  { key: 'ipo', label: '新股' },
] as const;
type ModuleKey = (typeof MODULES)[number]['key'];
const activeModule = ref<ModuleKey>('cn');

/** 行业/概念 tab */
type BoardKind = 'industry' | 'concept';
const boardKind = ref<BoardKind>('industry');

/* === A股板块 === */
const boardsByKind = ref<Record<BoardKind, BoardRow[]>>({ industry: [], concept: [] });
const boardLoading = ref(false);
const boardError = ref(false);
/** 手风琴展开的板块 code（单开） */
const expandedCode = ref<string | null>(null);
/** 成分股缓存（code → 行视图，行业/概念字段取并集渲染） */
const constituentsByCode = ref<
  Record<string, { name: string; code: string; price: number | null; changePercent: number | null }[]>
>({});
const constituentsLoading = ref(false);

const loadBoards = async (force = false): Promise<void> => {
  boardLoading.value = true;
  boardError.value = false;
  try {
    const key = 'panorama.boards';
    const cached = force ? null : mobileCacheGet<Record<BoardKind, BoardRow[]>>(key);
    if (cached) {
      boardsByKind.value = cached.value;
    } else {
      const [industry, concept] = await Promise.all([fetchIndustryBoards(), fetchConceptBoards()]);
      boardsByKind.value = { industry, concept };
      mobileCacheSet(key, boardsByKind.value);
    }
  } catch {
    boardError.value = true;
  } finally {
    boardLoading.value = false;
  }
};

/** 涨跌统计卡（口径同 PC：>3 强涨 / ≥0 红盘 / <0 绿盘 / <-3 强跌，按当前 tab 的板块集） */
const stats = computed(() => {
  const rows = boardsByKind.value[boardKind.value];
  let upStrong = 0;
  let upAll = 0;
  let downMild = 0;
  let downStrong = 0;
  for (const row of rows) {
    const pct = row.changePercent ?? 0;
    if (pct >= 0) {
      upAll += 1;
      if (pct > BOARD_STAT_THRESHOLD.STRONG) upStrong += 1;
    } else {
      downMild += 1;
      if (pct < -BOARD_STAT_THRESHOLD.STRONG) downStrong += 1;
    }
  }
  return [
    { t: '强涨板块', v: upStrong, cls: 'm-up' },
    { t: '红盘板块', v: upAll, cls: 'm-up' },
    { t: '绿盘板块', v: downMild, cls: 'm-down' },
    { t: '强跌板块', v: downStrong, cls: 'm-down' },
  ];
});

const activeBoards = computed(() => boardsByKind.value[boardKind.value]);

/** 手风琴展开：拉成分股（有缓存直接展开）
 * @param row 被点击的板块行 */
const onBoardClick = async (row: BoardRow): Promise<void> => {
  if (expandedCode.value === row.code) {
    expandedCode.value = null;
    return;
  }
  expandedCode.value = row.code;
  if (constituentsByCode.value[row.code]) return;
  constituentsLoading.value = true;
  try {
    const list =
      boardKind.value === 'industry'
        ? await fetchIndustryConstituents(row.code)
        : await fetchConceptConstituents(row.code);
    constituentsByCode.value[row.code] = list.map((c) => ({
      name: c.name,
      code: String(c.code),
      price: c.price,
      changePercent: c.changePercent,
    }));
  } catch {
    constituentsByCode.value[row.code] = [];
  } finally {
    constituentsLoading.value = false;
  }
};

const goStock = (code: string): void => {
  void router.push(`/stock/${toFullSymbol(code)}`);
};

/* === 板块资金 === */
const flowRank = ref<SectorFundFlowItem[]>([]);
const flowLoading = ref(false);
const flowError = ref(false);
/** 曲线（最多 4 条：流入/流出各前 2） */
const curves = ref<SectorFlowCurve[]>([]);
const curveNames = computed(() => {
  const nameByCode = new Map(flowRank.value.map((r) => [r.code, r.name]));
  return curves.value.map((c) => ({ code: c.code, name: nameByCode.get(c.code) ?? c.code }));
});

const loadFlow = async (force = false): Promise<void> => {
  flowLoading.value = true;
  flowError.value = false;
  try {
    const key = 'panorama.flow';
    const cached = force ? null : mobileCacheGet<SectorFundFlowItem[]>(key);
    if (cached) {
      flowRank.value = cached.value;
    } else {
      const rank = await fetchSectorFundFlowRank();
      flowRank.value = rank;
      mobileCacheSet(key, rank);
    }
    // 曲线不落缓存（当日逐分钟，切页回来要新）；取流入/流出各前 2
    const codes = pickDefaultCurveCodes(flowRank.value, 2);
    curves.value = await fetchSectorFlowCurves(codes);
  } catch {
    flowError.value = true;
  } finally {
    flowLoading.value = false;
  }
};

/** SVG 曲线：把各曲线 points 归一到同一 320x120 视窗 */
const CURVE_W = 320;
const CURVE_H = 120;
const curvePaths = computed(() => {
  const valid = curves.value.filter((c) => c.points.length > 1);
  if (!valid.length) return [];
  const all = valid.flatMap((c) => c.points.map((p) => p.mainNetInflow));
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 0);
  const span = max - min || 1;
  const maxLen = Math.max(...valid.map((c) => c.points.length));
  const COLORS = ['#e02020', '#f1998e', '#00b578', '#7fd3b3'];
  return valid.map((curve, i) => {
    const pts = curve.points.map((p, idx) => {
      const x = (idx / (maxLen - 1)) * CURVE_W;
      const y = CURVE_H - ((p.mainNetInflow - min) / span) * (CURVE_H - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { code: curve.code, color: COLORS[i % COLORS.length], d: `M${pts.join('L')}` };
  });
});
const fmtYi = (v: number | null): string =>
  v === null ? '--' : `${(v / 1e8).toFixed(v >= 1e8 || v <= -1e8 ? 1 : 2)}亿`;

/* === 美球 === */
const usSectors = ref<PanoramaItem[]>([]);
const globalIdx = ref<PanoramaItem[]>([]);
const futures = ref<PanoramaItem[]>([]);
const globalLoading = ref(false);
const globalError = ref(false);

const loadGlobal = async (force = false): Promise<void> => {
  globalLoading.value = true;
  globalError.value = false;
  try {
    const key = 'panorama.global';
    const cached = force ? null : mobileCacheGet<{ us: PanoramaItem[]; idx: PanoramaItem[]; fu: PanoramaItem[] }>(key);
    if (cached) {
      usSectors.value = cached.value.us;
      globalIdx.value = cached.value.idx;
      futures.value = cached.value.fu;
    } else {
      const [us, idx, fu] = await Promise.all([
        fetchUsSectorPanorama(),
        fetchGlobalIndexPanorama(),
        fetchGlobalFuturesPanorama(),
      ]);
      usSectors.value = us;
      globalIdx.value = idx;
      futures.value = fu;
      mobileCacheSet(key, { us, idx, fu });
    }
  } catch {
    globalError.value = true;
  } finally {
    globalLoading.value = false;
  }
};

/* === 新股 === */
const ipoList = ref<IpoBoardItem[]>([]);
const ipoLoading = ref(false);
const ipoError = ref(false);

const loadIpo = async (force = false): Promise<void> => {
  ipoLoading.value = true;
  ipoError.value = false;
  try {
    const key = 'panorama.ipo';
    const cached = force ? null : mobileCacheGet<IpoBoardItem[]>(key);
    if (cached) {
      ipoList.value = cached.value;
    } else {
      const list = await fetchIpoBoard();
      ipoList.value = list;
      mobileCacheSet(key, list);
    }
  } catch {
    ipoError.value = true;
  } finally {
    ipoLoading.value = false;
  }
};

/* === 模块切换：惰性加载 === */
const loadedModules = new Set<ModuleKey>();
const loadModule = (key: ModuleKey, force = false): void => {
  if (!force && loadedModules.has(key)) return;
  loadedModules.add(key);
  if (key === 'cn') void loadBoards(force);
  else if (key === 'flow') void loadFlow(force);
  else if (key === 'global') void loadGlobal(force);
  else void loadIpo(force);
};
loadModule('cn');

const onModuleClick = (key: ModuleKey): void => {
  activeModule.value = key;
  loadModule(key);
};

/** 整页下拉刷新：当前模块强制重拉
 * @returns 无返回值，finally 里复位 v-model 收起下拉状态 */
const refreshing = ref(false);
const onRefresh = async (): Promise<void> => {
  try {
    loadModule(activeModule.value, true);
  } finally {
    refreshing.value = false;
  }
};

const back = (): void => {
  router.back();
};

const fmtPct = (v: number | null): string => (v === null ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const goPanoramaDeep = (path: string): void => {
  void router.push(path);
};
// 预留：PC 端「查看历史净流入」在移动端暂以 toast 占位（二期深化）
const onHistoryClick = (): void => {
  showToast('历史净流入移动端后续开放');
  goPanoramaDeep('/market-rank');
};
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar
      title="行情全景"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="back"
    />

    <!-- 模块 chips -->
    <div class="m-chips">
      <button
        v-for="m in MODULES"
        :key="m.key"
        class="m-chip"
        :class="{ 'm-chip--active': activeModule === m.key }"
        @click="onModuleClick(m.key)"
      >
        {{ m.label }}
      </button>
    </div>

    <div class="m-sub-scroll">
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <!-- === A股 === -->
        <template v-if="activeModule === 'cn'">
          <div v-if="boardLoading" class="m-card m-skel-fill">
            <div v-for="i in 8" :key="i" class="m-skel-row"></div>
          </div>
          <div v-else-if="boardError" class="m-state">
            板块数据加载失败
            <span class="retry" @click="loadModule('cn', true)">重试</span>
          </div>
          <template v-else>
            <div class="m-pan-stats">
              <div v-for="s in stats" :key="s.t" class="m-pan-stat">
                <div class="m-pan-stat__v" :class="s.cls">{{ s.v }}</div>
                <div class="m-pan-stat__t">{{ s.t }}</div>
              </div>
            </div>
            <div class="m-chips" style="padding-top: 8px">
              <button
                class="m-chip"
                :class="{ 'm-chip--active': boardKind === 'industry' }"
                @click="boardKind = 'industry'"
              >
                行业板块
              </button>
              <button
                class="m-chip"
                :class="{ 'm-chip--active': boardKind === 'concept' }"
                @click="boardKind = 'concept'"
              >
                概念板块
              </button>
            </div>
            <div class="m-card">
              <div v-for="row in activeBoards" :key="row.code">
                <!-- 板块行：名 + 涨跌家数 mini-bar + 涨跌幅 -->
                <div class="m-row" @click="onBoardClick(row)">
                  <div class="m-row__nm">
                    {{ row.name }}
                    <span class="sub">
                      领涨 {{ row.leadingStock || '--' }}
                      {{ row.leadingStockChangePercent === null || row.leadingStockChangePercent === undefined ? '' : fmtPct(row.leadingStockChangePercent) }}
                    </span>
                  </div>
                  <div class="m-mini-bar">
                    <span
                      class="m-mini-bar__up"
                      :style="{ flex: `${Math.max(row.riseCount ?? 0, 1)}` }"
                    ></span>
                    <span
                      class="m-mini-bar__down"
                      :style="{ flex: `${Math.max(row.fallCount ?? 0, 1)}` }"
                    ></span>
                  </div>
                  <span class="m-row__pct pill" :class="pctClass(row.changePercent)">
                    {{ fmtPct(row.changePercent) }}
                  </span>
                </div>
                <!-- 手风琴：成分股（前 10，点击进个股页） -->
                <div v-if="expandedCode === row.code" class="m-pan-board-row__acc">
                  <div v-if="constituentsLoading" class="m-state" style="padding: 10px 0">
                    成分股加载中…
                  </div>
                  <template v-else>
                    <div
                      v-for="c in (constituentsByCode[row.code] || []).slice(0, 10)"
                      :key="c.code"
                      class="m-pan-const-row"
                      @click.stop="goStock(c.code)"
                    >
                      <span class="m-pan-const-row__nm">
                        {{ c.name }}<span class="code">{{ c.code }}</span>
                      </span>
                      <span class="m-row__val sm">{{ c.price?.toFixed(2) ?? '--' }}</span>
                      <span class="m-row__pct" :class="pctClass(c.changePercent)">
                        {{ fmtPct(c.changePercent) }}
                      </span>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </template>
        </template>

        <!-- === 板块资金 === -->
        <template v-else-if="activeModule === 'flow'">
          <div v-if="flowLoading" class="m-card m-skel-fill">
            <div v-for="i in 8" :key="i" class="m-skel-row"></div>
          </div>
          <div v-else-if="flowError" class="m-state">
            资金数据加载失败
            <span class="retry" @click="loadModule('flow', true)">重试</span>
          </div>
          <template v-else>
            <div v-if="curvePaths.length" class="m-pan-curve m-card">
              <svg :viewBox="`0 0 ${CURVE_W} ${CURVE_H}`">
                <path
                  v-for="p in curvePaths"
                  :key="p.code"
                  :d="p.d"
                  fill="none"
                  :stroke="p.color"
                  stroke-width="1.5"
                />
              </svg>
              <div class="m-sec" style="padding: 6px 0 0">
                <span
                  v-for="c in curveNames"
                  :key="c.code"
                  class="m-home-sec__s"
                  style="margin-right: 10px"
                >
                  {{ c.name }}
                </span>
              </div>
            </div>
            <div class="m-sec">
              <span class="m-sec__t">板块主力净流入</span>
              <span class="m-sec__s" @click="onHistoryClick">历史曲线 ›</span>
            </div>
            <div class="m-card">
              <div
                v-for="r in flowRank.slice(0, 30)"
                :key="r.code"
                class="m-row"
                @click="goStock(r.topStockCode || '')"
              >
                <div class="m-row__nm">
                  {{ r.name }}
                  <span v-if="r.topStockName" class="sub">领涨 {{ r.topStockName }}</span>
                </div>
                <span class="m-row__val" :class="pctClass(r.mainNetInflow)">
                  {{ fmtYi(r.mainNetInflow) }}
                </span>
                <span class="m-row__pct pill" :class="pctClass(r.changePercent)">
                  {{ fmtPct(r.changePercent) }}
                </span>
              </div>
            </div>
          </template>
        </template>

        <!-- === 美球 === -->
        <template v-else-if="activeModule === 'global'">
          <div v-if="globalLoading" class="m-card m-skel-fill">
            <div v-for="i in 8" :key="i" class="m-skel-row"></div>
          </div>
          <div v-else-if="globalError" class="m-state">
            全球数据加载失败
            <span class="retry" @click="loadModule('global', true)">重试</span>
          </div>
          <template v-else>
            <div class="m-sec"><span class="m-sec__t">美股行业 ETF</span></div>
            <div class="m-card">
              <div v-for="it in usSectors" :key="it.name" class="m-row">
                <span class="m-row__nm">{{ it.name }}</span>
                <span class="m-row__pct" :class="pctClass(it.changePercent)">
                  {{ fmtPct(it.changePercent) }}
                </span>
              </div>
            </div>
            <div class="m-sec"><span class="m-sec__t">全球指数</span></div>
            <div class="m-card">
              <div v-for="it in globalIdx" :key="it.name" class="m-row">
                <span class="m-row__nm">{{ it.name }}</span>
                <span class="m-row__pct" :class="pctClass(it.changePercent)">
                  {{ fmtPct(it.changePercent) }}
                </span>
              </div>
            </div>
            <div class="m-sec"><span class="m-sec__t">外盘商品</span></div>
            <div class="m-card">
              <div v-for="it in futures" :key="it.name" class="m-row">
                <span class="m-row__nm">{{ it.name }}</span>
                <span class="m-row__pct" :class="pctClass(it.changePercent)">
                  {{ fmtPct(it.changePercent) }}
                </span>
              </div>
            </div>
          </template>
        </template>

        <!-- === 新股 === -->
        <template v-else>
          <div v-if="ipoLoading" class="m-card m-skel-fill">
            <div v-for="i in 8" :key="i" class="m-skel-row"></div>
          </div>
          <div v-else-if="ipoError" class="m-state">
            打新数据加载失败
            <span class="retry" @click="loadModule('ipo', true)">重试</span>
          </div>
          <div v-else class="m-card">
            <div v-for="it in ipoList" :key="it.code" class="m-row">
              <div class="m-row__nm">
                {{ it.name }}
                <span class="sub">申购日 {{ it.applyDate || '--' }}</span>
              </div>
              <span class="m-row__val sm">发行 {{ it.issuePrice?.toFixed(2) ?? '--' }}</span>
              <span class="m-row__pct" :class="pctClass(it.earn === null ? null : 1)">
                {{ it.earn === null ? '--' : `${it.earn.toFixed(0)}元` }}
              </span>
            </div>
          </div>
        </template>
      </van-pull-refresh>
      <div class="m-sub-tail"></div>
    </div>
  </div>
</template>
