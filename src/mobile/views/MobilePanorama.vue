<script setup lang="ts">
/**
 * 行情全景（v2 二期二级页，稿：market-modules-v2 P0-P2；规范：DESIGN-MOBILE.md §5.1）
 *
 * 模块 chips：A股 / 美球 / 宏观（2026-10-13 王总：「资金」模块整体移除，
 * 「板块主力净流入榜」迁往 tabbar 资金流向页，mini 曲线由该页「板块资金」完整版覆盖）；
 * 新股次新股 v4.5.2 拆为独立页 /ipo，入口在首页金刚区；
 * - A股：36 板块统一口径涨跌列表（板块日历池，2026-10-29 王总指定；原行业/概念
 *   手风琴与涨跌统计卡随统一口径移除，样式对齐美球行）
 * - 美球：美股行业 ETF / 全球指数 / 外盘商品 三组涨跌列表
 * 数据层全部复用 PC common api；分区独立加载与降级（DESIGN-MOBILE.md §6）
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchCalendarBoardPanorama } from '../../common/api/board-calendar.api';
import {
  fetchGlobalFuturesPanorama,
  fetchGlobalIndexPanorama,
  fetchUsSectorPanorama,
} from '../../common/api/panorama.api';
import { PANORAMA_MACRO_GROUPS } from '../../common/constants/panorama.constants';
import { delay } from '../../common/utils/delay';
import type { PanoramaItem, PanoramaMacroGroup } from '../../common/types/panorama.types';
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

/* === A股板块（36 板块统一口径：板块日历池，样式对齐美球涨跌行） === */
const cnBoards = ref<PanoramaItem[]>([]);
const boardLoading = ref(false);
const boardError = ref(false);

const loadBoards = async (force = false): Promise<void> => {
  boardLoading.value = true;
  boardError.value = false;
  try {
    const key = 'panorama.cnBoards';
    const cached = force ? null : mobileCacheGet<PanoramaItem[]>(key);
    if (cached) {
      cnBoards.value = cached.value;
    } else {
      const list = await fetchCalendarBoardPanorama();
      cnBoards.value = list;
      mobileCacheSet(key, list);
    }
  } catch {
    boardError.value = true;
  } finally {
    boardLoading.value = false;
  }
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

/** 模块分组 Tabs 绑定下标（van-tabs 的 active 是 index，这里做 index ↔ module key 互转） */
const activeModuleIndex = computed({
  get: () => Math.max(0, MODULES.findIndex((m) => m.key === activeModule.value)),
  set: (index: number) => onModuleClick(MODULES[index]!.key),
});

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

    <!-- 模块分组 Tabs（参考今天炒什么：van-tabs 选择器模式，空 van-tab 只当分段选择器） -->
    <van-tabs
      v-model:active="activeModuleIndex"
      class="m-tabs m-tabs--selector"
      :ellipsis="false"
    >
      <van-tab v-for="m in MODULES" :key="m.key" :title="m.label" />
    </van-tabs>

    <div class="m-sub-scroll">
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <!-- === A股（36 板块统一口径，行样式对齐美球） === -->
        <template v-if="activeModule === 'cn'">
          <div v-if="boardLoading" class="m-card m-skel-fill">
            <div v-for="i in 8" :key="i" class="m-skel-row"></div>
          </div>
          <div v-else-if="boardError" class="m-state">
            板块数据加载失败
            <span class="retry" @click="loadModule('cn', true)">重试</span>
          </div>
          <div v-else class="m-card">
            <div v-for="row in cnBoards" :key="row.name" class="m-row">
              <span class="m-row__nm">{{ row.name }}</span>
              <span class="m-row__pct" :class="pctClass(row.changePercent)">
                {{ fmtPct(row.changePercent) }}
              </span>
            </div>
          </div>
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

<style scoped>
/* navbar/tabs 与清单卡之间留空隙（2026-10-31 真机反馈列表贴顶；同新股独立页 .m-sub-scroll） */
.m-sub-scroll {
  padding-top: 10px;
}
</style>
