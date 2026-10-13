<script setup lang="ts">
/**
 * 行情全景（v2 二期二级页，稿：market-modules-v2 P0-P2；规范：DESIGN-MOBILE.md §5.1）
 *
 * 模块 chips：A股 / 美球 / 宏观（2026-10-13 王总：「资金」模块整体移除，
 * 「板块主力净流入榜」迁往 tabbar 资金流向页，mini 曲线由该页「板块资金」完整版覆盖）；
 * 新股次新股 v4.5.2 拆为独立页 /ipo，入口在首页金刚区；
 * - A股：涨跌统计 4 卡（由板块表现前端现算，口径同 PC）+ 行业/概念板块行（点击手风琴展开成分股，行点击进个股页）
 * - 美球：美股行业 ETF / 全球指数 / 外盘商品 三组涨跌列表
 * 数据层全部复用 PC common api；分区独立加载与降级（DESIGN-MOBILE.md §6）
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
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
import { PANORAMA_MACRO_GROUPS } from '../../common/constants/panorama.constants';
import { delay } from '../../common/utils/delay';
import type { PanoramaItem, PanoramaMacroGroup } from '../../common/types/panorama.types';
import type { BoardRow } from '../../common/constants/boards.constants';
import { BOARD_STAT_THRESHOLD } from '../../common/constants/boards.constants';
import { toFullSymbol } from '../../common/utils/to-full-symbol';
import { mobileCacheGet, mobileCacheSet } from '../cache';
import { pctClass } from '../utils/format';

const router = useRouter();

/** 模块 chips */
const MODULES = [
  { key: 'cn', label: 'A股' },
  { key: 'global', label: '美球' },
  { key: 'macro', label: '宏观' },
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

/* === 全球宏观（对齐 PC PanoramaView「宏观」模块：分组关键词匹配） === */
const macroGroups = ref<PanoramaMacroGroup[]>([]);
const macroLoading = ref(false);
const macroError = ref(false);

/** 宏观取数错峰间隔（PC 同款 500ms，避免对同一上游并发齐射） */
const MACRO_REQUEST_GAP_MS = 500;

/**
 * 在条目列表内按关键词顺序匹配（名称包含即命中）：
 * 优先名称与关键词完全一致的条目（指数 / 主力连续合约），否则取最后一个命中
 * （外盘合约按到期月升序排列，最后一个为最新主力）——口径照搬 PC PanoramaView
 * @param items 上游条目
 * @param keywords 展示关键词
 * @returns 匹配到的条目（顺序与 keywords 一致，未命中跳过）
 */
const matchKeywords = (items: PanoramaItem[], keywords: readonly string[]): PanoramaItem[] =>
  keywords.flatMap((keyword) => {
    const hits = items.filter((item) => item.name.includes(keyword));
    const exact = hits.find((item) => item.name === keyword);
    const hit = exact ?? hits.at(-1);
    return hit ? [hit] : [];
  });

const loadMacro = async (force = false): Promise<void> => {
  macroLoading.value = true;
  macroError.value = false;
  try {
    const key = 'panorama.macro';
    const cached = force ? null : mobileCacheGet<PanoramaMacroGroup[]>(key);
    if (cached) {
      macroGroups.value = cached.value;
    } else {
      // 全球指数 → 外盘商品串行错峰（PC fetchMacro 同款），再按配置分组匹配
      const indexItems = await fetchGlobalIndexPanorama();
      await delay(MACRO_REQUEST_GAP_MS);
      const futuresItems = await fetchGlobalFuturesPanorama();
      macroGroups.value = PANORAMA_MACRO_GROUPS.map((group) => {
        const pool = group.source === 'index' ? indexItems : futuresItems;
        return { label: group.label, items: matchKeywords(pool, group.keywords) };
      }).filter((group) => group.items.length > 0);
      mobileCacheSet(key, macroGroups.value);
    }
  } catch {
    macroError.value = true;
  } finally {
    macroLoading.value = false;
  }
};

/* === 模块切换：惰性加载 === */
const loadedModules = new Set<ModuleKey>();
const loadModule = (key: ModuleKey, force = false): void => {
  if (!force && loadedModules.has(key)) return;
  loadedModules.add(key);
  if (key === 'cn') void loadBoards(force);
  else if (key === 'macro') void loadMacro(force);
  else void loadGlobal(force);
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

        <!-- === 全球宏观（PC 同款分组：全球指数 / 贵金属 / 其他商品 / 利率债…） === -->
        <template v-else>
          <div v-if="macroLoading" class="m-card m-skel-fill">
            <div v-for="i in 8" :key="i" class="m-skel-row"></div>
          </div>
          <div v-else-if="macroError || macroGroups.length === 0" class="m-state">
            宏观数据加载失败
            <span class="retry" @click="loadModule('macro', true)">重试</span>
          </div>
          <template v-else>
            <template v-for="group in macroGroups" :key="group.label">
              <div class="m-sec"><span class="m-sec__t">{{ group.label }}</span></div>
              <div class="m-card">
                <div v-for="it in group.items" :key="it.name" class="m-row">
                  <span class="m-row__nm">{{ it.name }}</span>
                  <span class="m-row__pct" :class="pctClass(it.changePercent)">
                    {{ fmtPct(it.changePercent) }}
                  </span>
                </div>
              </div>
            </template>
          </template>
        </template>
      </van-pull-refresh>
      <div class="m-sub-tail"></div>
    </div>
  </div>
</template>
