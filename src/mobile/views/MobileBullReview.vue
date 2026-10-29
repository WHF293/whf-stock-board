<script setup lang="ts">
/**
 * 历史牛熊（移动端，/bull-review）：PC「行情全景 → 历史复盘」的移动版
 * （UI 稿：.ai/项目资源/stock-board-mobile-bull-review-v1.html）
 *
 * - 三页签：历史牛市 / 历史熊市 / 模式库（与 PC 一一对应），牛熊各自记忆最后浏览轮次
 * - 轮次 chips 横滑；档案卡 / 统计条（judge.ts 月K回算）/ 阶段色带（月K折线 + 四段色带）/
 *   阶段明细 / 事件时间线（竖向）/ 错配画像（五胶囊行）/ 复盘解读，纵向滚动
 * - 模式库：PC 880px 对比表改横滑迷你卡组（牛 / 熊两组）+ 规律紧凑卡
 * - 数据与判定复用 PC 单源（rounds / bears / judge / history-data），月K落 appStorage（离线可用）；
 *   「更新到最新」手动补最新月份（三指数串行 0.5s 错峰）；PC 端组件零改动
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { loadBullReview } from '../api/bull-review.api';
import { BULL_PATTERNS, BULL_ROUNDS } from '../../common/board-review/rounds';
import { BEAR_PATTERNS, BEAR_ROUNDS } from '../../common/board-review/bears';
import type {
  MonthlyBar,
  ReviewBearStats,
  ReviewEventCategory,
  ReviewRoundMeta,
  ReviewRoundStats,
  ReviewStageTone,
} from '../../common/board-review/types';

const router = useRouter();

/* === 页签与轮次 === */

type BullView = 'bull' | 'bear' | 'library';
const VIEW_TABS: readonly { value: BullView; label: string }[] = [
  { value: 'bull', label: '历史牛市' },
  { value: 'bear', label: '历史熊市' },
  { value: 'library', label: '模式库' },
];
const activeView = ref<BullView>('bull');

/** 牛 / 熊各自记忆最后浏览的轮次 */
const activeBullId = ref(BULL_ROUNDS[0]?.id ?? '');
const activeBearId = ref(BEAR_ROUNDS[0]?.id ?? '');

const currentBull = computed(() => BULL_ROUNDS.find((round) => round.id === activeBullId.value));
const currentBear = computed(() => BEAR_ROUNDS.find((round) => round.id === activeBearId.value));

/* === 数据装载 === */

const loading = ref(true);
const refreshing = ref(false);
const loadError = ref(false);
const syncedAt = ref(0);
const bullStats = ref<Record<string, ReviewRoundStats>>({});
const bearStats = ref<Record<string, ReviewBearStats>>({});
/** 指数符号 → 全量月K（阶段色带绘图用；内存态，随快照刷新） */
const barsMap = ref<Record<string, MonthlyBar[]>>({});

const load = async (force = false): Promise<void> => {
  if (force) refreshing.value = true;
  else loading.value = true;
  loadError.value = false;
  try {
    const data = await loadBullReview({ force });
    syncedAt.value = data.syncedAt;
    bullStats.value = data.bullStats;
    bearStats.value = data.bearStats;
    barsMap.value = data.bars;
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
};

void load();

/* === 展示格式化与视图模型 === */

/**
 * `YYYY-MM` → `YY.MM`（阶段起止月紧凑展示）
 * @param month 月份串
 * @returns 形如 `16.01`；非法输入原样返回
 */
const shortMonth = (month: string): string => {
  const [year, mon] = month.split('-');
  return year && mon ? `${year.slice(2)}.${mon}` : month;
};

/** 当前页签的轮次列表与选中轮次 */
const activeRounds = computed(() => (activeView.value === 'bear' ? BEAR_ROUNDS : BULL_ROUNDS));
const activeRoundId = computed(() => (activeView.value === 'bear' ? activeBearId.value : activeBullId.value));
const currentRound = computed(() => (activeView.value === 'bear' ? currentBear.value : currentBull.value));
const isBullView = computed(() => activeView.value === 'bull');

/**
 * 选中轮次切换（牛熊 chips 共用）
 * @param id 轮次 id
 */
const pickRound = (id: string): void => {
  if (activeView.value === 'bear') activeBearId.value = id;
  else activeBullId.value = id;
};

/** 事件类别徽标文案（五维度，与 PC RoundEventTimeline 同文案） */
const CATEGORY_LABEL: Record<ReviewEventCategory, string> = {
  leader: '龙头动向',
  policy: '国内政策',
  overseas: '海外环境',
  funds: '资金情绪',
  sector: '产业业绩',
};

/** 阶段名配色 class（牛市 s1-s4 与熊市 s1-s4 各自映射，口径同 PC *_STAGE_*_CSS_VAR）
 * @param tone 阶段色调槽位
 * @returns 色块 class */
const toneClass = (tone: ReviewStageTone): string => `s${tone[1]}`;

/** 阶段名文字配色 class（同上色板映射）
 * @param tone 阶段色调槽位
 * @returns 文字色 class */
const toneTextClass = (tone: ReviewStageTone): string => `ts${tone[1]}`;

/* === 行情阶段图（PC RoundTimelineChart 移动版，自绘 SVG：全高阶段色带 +
       月K收盘线 + 起点/顶点/低点标注 + 关键位虚线 + 双轴刻度） === */

/** 绘图区常量（viewBox 内坐标；viewBox 366 宽 ≈ 390 屏 − 2×12 卡边距，近乎 1:1 不变形） */
const CHART = {
  W: 366, H: 226,
  plotL: 36, plotR: 358, plotT: 18, plotB: 196,
} as const;
const PLOT_W = CHART.plotR - CHART.plotL;
const PLOT_H = CHART.plotB - CHART.plotT;

interface BandSegment {
  tone: ReviewStageTone;
  x: number;
  w: number;
}
interface BandMark {
  x: number;
  y: number;
  label: string;
  /** 文字锚定方向（靠右半区文字往左伸，防出界） */
  anchor: 'start' | 'end';
  /** 标注色 class：lb-u 红 / lb-d 绿 / lb-n 灰 */
  cls: string;
  /** 相对点的纵向偏移（顶点上浮 / 低点下沉） */
  dy: number;
}
interface BandTick {
  pos: number;
  label: string;
  anchor: 'start' | 'middle' | 'end';
}
interface BandView {
  linePoints: string;
  areaPoints: string;
  segments: BandSegment[];
  stageLabels: { tone: ReviewStageTone; x: number; name: string }[];
  marks: BandMark[];
  guideX: number | null;
  guideCls: string;
  yTicks: BandTick[];
  xTicks: BandTick[];
}

/**
 * 计算行情阶段图视图：窗口内月序为时间轴，色带段按阶段起止月铺满绘图区全高，
 * 折线为月收盘；标注与关键位与 PC 同口径（judge.ts 回算：牛市起点/顶点/低点、熊市顶部/低点）。
 * @param round 轮次档案
 * @param bars 该轮叠加指数全量月K（升序）
 * @returns 图视图；窗口内数据不足两根时为 null
 */
const bandOf = (round: ReviewRoundMeta, bars: MonthlyBar[] | undefined): BandView | null => {
  if (!bars) return null;
  const inWindow = bars.filter((bar) => bar.month >= round.window.start && bar.month <= round.window.end);
  if (inWindow.length < 2) return null;
  const total = inWindow.length - 1;
  const isBull = activeView.value !== 'bear';
  /** 月份 → 绘图区 x（stage 边界月不命中时向后取最近月，末段兜底到终点）
   * @param month 月份串（YYYY-MM）
   * @returns 绘图区 x 坐标 */
  const xOf = (month: string): number => {
    const idx = inWindow.findIndex((bar) => bar.month >= month);
    return CHART.plotL + ((idx < 0 ? total : idx) / total) * PLOT_W;
  };
  const closes = inWindow.map((bar) => bar.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const xAt = (i: number): number => CHART.plotL + (i / total) * PLOT_W;
  const yAt = (close: number): number => CHART.plotT + (1 - (close - min) / span) * PLOT_H;

  const pts = inWindow.map((bar, i) => ({ x: xAt(i), y: yAt(bar.close) }));
  const linePoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPoints = `${CHART.plotL},${CHART.plotB} ${linePoints} ${CHART.plotR},${CHART.plotB}`;

  const segments: BandSegment[] = round.stages.map((stage) => {
    const x1 = xOf(stage.start);
    const x2 = xOf(stage.end);
    return { tone: stage.tone, x: x1, w: Math.max(x2 - x1, 2) };
  });
  /** 阶段名图内标签：段宽能容纳文字（字数 × 10px + 6）才显示，窄段看图例，防重叠 */
  const stageLabels = round.stages
    .map((stage) => ({ tone: stage.tone, x: xOf(stage.start) + 5, name: stage.name, w: xOf(stage.end) - xOf(stage.start) }))
    .filter((s) => s.w >= s.name.length * 10 + 6)
    .map((s) => ({ tone: s.tone, x: Math.min(s.x, CHART.plotR - s.name.length * 10 - 4), name: s.name }));

  /**
   * 标注点通用组装（防出界：x 靠右 anchor 翻转，y 出界上下翻转）
   * @param month 月份串（YYYY-MM）
   * @param close 收盘点位
   * @param label 标注文案
   * @param cls 标注色 class
   * @param above 文字是否在点上方
   * @returns 标注点视图模型
   */
  const markOf = (month: string, close: number, label: string, cls: string, above: boolean): BandMark => {
    const idx = inWindow.findIndex((bar) => bar.month >= month);
    const t = (idx < 0 ? total : idx) / total;
    const y = yAt(close);
    return {
      x: xAt(idx < 0 ? total : idx),
      y,
      label,
      anchor: t > 0.62 ? 'end' : 'start',
      cls,
      dy: above ? -8 : (y + 14 > CHART.plotB ? -8 : 14),
    };
  };

  const marks: BandMark[] = [];
  let guideX: number | null = null;
  let guideCls = 'lb-u';
  if (isBull) {
    marks.push({
      x: CHART.plotL, y: yAt(inWindow[0]!.close),
      label: `起点 ${inWindow[0]!.close.toFixed(0)}`,
      anchor: 'start', cls: 'lb-n', dy: -8,
    });
    const bull = bullStats.value[round.id];
    if (bull) {
      marks.push(
        markOf(bull.peakMonth, bull.peakClose, `顶点 ${bull.peakClose.toFixed(0)}（${bull.peakMonth}）`, 'lb-u', true),
        markOf(bull.troughMonth, bull.troughClose, `低点 ${bull.troughClose.toFixed(0)}（${bull.troughMonth}）`, 'lb-d', false),
      );
      guideX = xOf(bull.peakMonth);
    }
  } else {
    const bear = bearStats.value[round.id];
    marks.push({
      x: CHART.plotL, y: yAt(inWindow[0]!.close),
      label: `顶部 ${inWindow[0]!.close.toFixed(0)}（${inWindow[0]!.month}）`,
      anchor: 'start', cls: 'lb-u', dy: -8,
    });
    if (bear) {
      marks.push(markOf(bear.troughMonth, bear.troughClose, `低点 ${bear.troughClose.toFixed(0)}（${bear.troughMonth}）`, 'lb-d', false));
      guideX = xOf(bear.troughMonth);
      guideCls = 'lb-d';
    }
  }

  /** y 轴 4 档刻度 + 浅网格 */
  const yTicks = [0, 1, 2, 3].map((i) => {
    const v = min + (span * i) / 3;
    return { pos: yAt(v), label: v.toFixed(0), anchor: 'end' as const };
  });
  /** x 轴 ≤7 档月份刻度（全格式 YYYY-MM，同 PC）；末月已选时丢弃过近的倒数第二档，防重叠 */
  const step = Math.max(1, Math.ceil(inWindow.length / 6));
  const xTicks = inWindow
    .map((bar, i) => ({ bar, i }))
    .filter(({ i }) => i === total || (i % step === 0 && total - i >= Math.ceil(step * 0.6)))
    .map(({ bar, i }) => ({
      pos: xAt(i),
      label: bar.month,
      anchor: (i === 0 ? 'start' : i === total ? 'end' : 'middle') as 'start' | 'middle' | 'end',
    }));

  return { linePoints, areaPoints, segments, stageLabels, marks, guideX, guideCls, yTicks, xTicks };
};

/** 当前轮的阶段图视图（chips 切换即重算） */
const band = computed(() =>
  activeView.value === 'library' ? null : bandOf(currentRound.value!, barsMap.value[currentRound.value!.indexSymbol]),
);

/* === 模式库：横滑迷你卡组（数字来自回算统计） === */

interface LibCard {
  short: string;
  name: string;
  /** 主数字文案（进行中轮次为「进行中」） */
  main: string;
  mainCls: string;
  /** 副行：回撤 / 反弹 + 形态 */
  sub: string;
}

/** 牛市对比卡（无统计的进行中轮次显示「进行中」） */
const bullCards = computed<LibCard[]>(() =>
  BULL_ROUNDS.map((round) => {
    const stats = bullStats.value[round.id];
    return {
      short: `${round.short} ${round.name.split('（')[0]}`,
      name: round.name,
      main: stats ? `+${stats.gainPercent.toFixed(0)}%` : '进行中',
      mainCls: stats ? 'u' : 'n',
      sub: stats ? `回撤 ${stats.drawdownPercent.toFixed(0)}% · ${round.collapseLabel.split('·')[1] ?? ''}` : '…',
    };
  }),
);

/** 熊市对比卡 */
const bearCards = computed<LibCard[]>(() =>
  BEAR_ROUNDS.map((round) => {
    const stats = bearStats.value[round.id];
    return {
      short: `${round.short} ${round.name.split('（')[0]}`,
      name: round.name,
      main: stats ? `${stats.drawdownPercent.toFixed(0)}%` : '进行中',
      mainCls: stats ? 'd' : 'n',
      sub: stats ? `反弹 +${stats.bouncePercent.toFixed(0)}% · ${round.collapseLabel.split('·')[1] ?? ''}` : '…',
    };
  }),
);
</script>

<template>
  <div class="m-page-flex m-br-page">
    <van-nav-bar title="历史牛熊" class="m-nav" safe-area-inset-top left-arrow @click-left="router.back()">
      <template #right>
        <span class="m-br-refresh" @click="load(true)">{{ refreshing ? '同步中…' : '更新到最新' }}</span>
      </template>
    </van-nav-bar>

    <!-- 三页签 -->
    <div class="m-br-seg">
      <span
        v-for="tab in VIEW_TABS"
        :key="tab.value"
        :class="{ on: activeView === tab.value }"
        @click="activeView = tab.value"
      >{{ tab.label }}</span>
    </div>

    <div class="m-sub-scroll">
      <!-- 首次同步（三指数月K 串行错峰拉取） -->
      <div v-if="loading" class="m-state">指数月K同步中…</div>
      <div v-else-if="loadError" class="m-state">
        月K同步失败（上游限频或网络异常）
        <span class="retry" @click="load(true)">重试</span>
      </div>

      <template v-else>
        <!-- ══════ 牛市 / 熊市 ══════ -->
        <template v-if="activeView !== 'library' && currentRound">
          <div class="m-br-chips">
            <span
              v-for="round in activeRounds"
              :key="round.id"
              class="m-br-chip"
              :class="{ on: activeRoundId === round.id }"
              @click="pickRound(round.id)"
            >
              {{ round.name.split('（')[0] }}
              <i v-if="round.status.includes('进行中')">进行中</i>
            </span>
          </div>

          <!-- 档案卡 -->
          <div class="m-card">
            <div class="m-br-head">
              <b class="m-br-name">{{ currentRound.name }}</b>
              <span class="m-badge m-badge--t">{{ currentRound.roundType }}</span>
              <span class="m-badge m-badge--f">{{ currentRound.collapseLabel }}</span>
              <span class="m-badge m-badge--l">{{ currentRound.status }}</span>
            </div>
            <div class="m-br-span">{{ currentRound.span }} · 叠加：{{ currentRound.indexName }}</div>
            <div class="m-br-kv">
              <b>{{ isBullView ? '抱团主线' : '下跌主线' }}</b><span>{{ currentRound.mainline }}</span>
              <b>中军池</b><span>{{ currentRound.midCaps }}</span>
              <b>大环境</b><span>{{ currentRound.macro }}</span>
              <b>{{ isBullView ? '同期对手' : '逆势结构' }}</b><span>{{ currentRound.rival }}</span>
            </div>

            <!-- 统计条：数字由 judge.ts 从月K回算 -->
            <div class="m-br-stats">
              <template v-if="isBullView && bullStats[currentRound.id]">
                <div class="st"><b class="u">+{{ bullStats[currentRound.id]!.gainPercent.toFixed(0) }}%</b><span>区间最大涨幅</span></div>
                <div class="st"><b class="d">{{ bullStats[currentRound.id]!.drawdownPercent.toFixed(0) }}%</b><span>退潮最大回撤</span></div>
                <div class="st"><b class="n">{{ bullStats[currentRound.id]!.monthsToPeak }} 月</b><span>至顶时长</span></div>
                <div class="st"><b class="n">{{ shortMonth(bullStats[currentRound.id]!.endMonth) }}</b><span>窗口末月</span></div>
              </template>
              <template v-else-if="!isBullView && bearStats[currentRound.id]">
                <div class="st"><b class="d">{{ bearStats[currentRound.id]!.drawdownPercent.toFixed(0) }}%</b><span>区间最大跌幅</span></div>
                <div class="st"><b class="u">+{{ bearStats[currentRound.id]!.bouncePercent.toFixed(0) }}%</b><span>见底后最大反弹</span></div>
                <div class="st"><b class="n">{{ bearStats[currentRound.id]!.monthsToTrough }} 月</b><span>下跌时长</span></div>
                <div class="st"><b class="n">{{ bearStats[currentRound.id]!.monthsTotal }} 月</b><span>窗口总时长</span></div>
              </template>
              <div v-else class="m-br-nostats">窗口内月K不足，暂无法回算统计</div>
            </div>

            <!-- 行情阶段图：PC RoundTimelineChart 移动版（全高色带 + 月K收盘线 + 标注 + 关键位虚线） -->
            <div v-if="band" class="m-br-band">
              <div class="hd">
                <span class="t">行情阶段 · {{ currentRound.indexName }}月K</span>
                <span class="lg">
                  <span v-for="stage in currentRound.stages" :key="stage.name">
                    <i :class="toneClass(stage.tone)"></i>{{ stage.name }}
                  </span>
                </span>
              </div>
              <svg viewBox="0 0 366 226" role="img" aria-label="行情阶段图">
                <rect
                  v-for="seg in band.segments"
                  :key="seg.tone + String(seg.x)"
                  :x="seg.x"
                  :y="18"
                  :width="seg.w"
                  height="178"
                  :class="toneClass(seg.tone)"
                />
                <line
                  v-for="tick in band.yTicks"
                  :key="'gy' + tick.label"
                  :x1="36" :x2="358" :y1="tick.pos" :y2="tick.pos"
                  class="grid"
                />
                <line
                  v-if="band.guideX !== null"
                  :x1="band.guideX" :x2="band.guideX" :y1="18" :y2="196"
                  :class="band.guideCls" stroke-dasharray="3 3" opacity="0.6"
                />
                <polygon :points="band.areaPoints" class="area" />
                <polyline :points="band.linePoints" fill="none" class="line" stroke-width="1.6" />
                <text
                  v-for="stage in band.stageLabels"
                  :key="'sl' + stage.name"
                  :x="stage.x" y="30"
                  :class="toneTextClass(stage.tone)"
                >{{ stage.name }}</text>
                <text
                  v-for="tick in band.yTicks"
                  :key="'yt' + tick.label"
                  :x="30" :y="tick.pos + 3"
                  class="axis-t"
                  :text-anchor="tick.anchor"
                >{{ tick.label }}</text>
                <text
                  v-for="tick in band.xTicks"
                  :key="'xt' + tick.label"
                  :x="tick.pos" y="209"
                  class="axis-t"
                  :text-anchor="tick.anchor"
                >{{ tick.label }}</text>
                <g v-for="mark in band.marks" :key="mark.label">
                  <circle :cx="mark.x" :cy="mark.y" r="2.8" :class="mark.cls" stroke="#fff" stroke-width="0.8" />
                  <text :x="mark.x + (mark.anchor === 'end' ? -5 : 5)" :y="mark.y + mark.dy" :class="mark.cls" :text-anchor="mark.anchor">{{ mark.label }}</text>
                </g>
              </svg>
              <p class="fn">色带为复盘档案声明的阶段区间；顶 / 底与涨跌幅由 judge.ts 从月K回算，关键位月份以数据为准。</p>
            </div>
          </div>

          <!-- 阶段明细 -->
          <div class="m-card">
            <div class="m-br-sub">阶段拆解（{{ currentRound.stages.length }}）</div>
            <div class="m-br-stages">
              <div v-for="stage in currentRound.stages" :key="stage.name" class="m-br-stage">
                <span class="bar" :class="toneClass(stage.tone)"></span>
                <div class="bd">
                  <div class="nm" :class="toneTextClass(stage.tone)">{{ stage.name }}</div>
                  <div class="ds">{{ stage.desc }}</div>
                </div>
                <span class="mo">{{ shortMonth(stage.start) }}–{{ shortMonth(stage.end) }}</span>
              </div>
            </div>
          </div>

          <!-- 事件时间线（竖向） -->
          <div class="m-card">
            <div class="m-br-sub">关键事件时间线（{{ currentRound.events.length }} 条）</div>
            <div class="m-br-tl">
              <div v-for="event in currentRound.events" :key="event.date + event.title" class="m-br-ev">
                <div class="d">{{ event.date }}</div>
                <div class="tt">
                  {{ event.title }}
                  <span class="cat">{{ CATEGORY_LABEL[event.category] }}</span>
                  <span class="cat kind" :class="{ k: event.kind === 'landed' }">{{ event.kind === 'landed' ? '落地' : '预期' }}</span>
                </div>
                <div class="ds">{{ event.detail }}</div>
              </div>
            </div>
          </div>

          <!-- 错配画像 -->
          <div class="m-card">
            <div class="m-br-sub">见顶前错配画像（五维度）</div>
            <div class="m-br-mis">
              <div v-for="m in currentRound.mismatch" :key="m.dimension" class="mi">
                <span>{{ m.dimension }}</span>
                <span class="v" :class="m.diverged ? 'hit' : 'ok'">{{ m.diverged ? '背离 · 鱼尾信号' : '未背离' }}</span>
              </div>
            </div>
          </div>

          <!-- 复盘解读 + 免责 -->
          <div class="m-card">
            <div class="m-br-sub">复盘解读</div>
            <p class="m-br-review">{{ currentRound.review }}</p>
          </div>
          <div class="m-br-tip"><b>!</b><span>复盘观点仅供参考，不构成投资建议；本页能识别「已确认的退潮 / 见底」，不能预测时点。</span></div>
        </template>

        <!-- ══════ 模式库 ══════ -->
        <template v-else>
          <div class="m-card">
            <div class="m-br-sub m-up-t">七轮牛市横向对比（左右滑查看 · 点卡回档案）</div>
            <div class="m-br-librow">
              <div v-for="card in bullCards" :key="card.short" class="m-br-lr" @click="activeView = 'bull'; activeBullId = BULL_ROUNDS.find((r) => card.short.includes(r.short))!.id">
                <div class="s">{{ card.short }}</div>
                <div class="g u2">{{ card.main }}</div>
                <div class="f">{{ card.sub }}</div>
              </div>
            </div>
          </div>
          <div class="m-card">
            <div class="m-br-sub m-down-t">七轮熊市横向对比（左右滑查看）</div>
            <div class="m-br-librow">
              <div v-for="card in bearCards" :key="card.short" class="m-br-lr" @click="activeView = 'bear'; activeBearId = BEAR_ROUNDS.find((r) => card.short.includes(r.short))!.id">
                <div class="s">{{ card.short }}</div>
                <div class="g d2">{{ card.main }}</div>
                <div class="f">{{ card.sub }}</div>
              </div>
            </div>
          </div>
          <div class="m-card">
            <div class="m-br-sub">牛市规律卡</div>
            <div v-for="pattern in BULL_PATTERNS" :key="pattern.title" class="m-br-rule">
              <b>{{ pattern.title }}</b>{{ pattern.desc }}
            </div>
          </div>
          <div class="m-card">
            <div class="m-br-sub">熊市规律卡</div>
            <div v-for="pattern in BEAR_PATTERNS" :key="pattern.title" class="m-br-rule">
              <b>{{ pattern.title }}</b>{{ pattern.desc }}
            </div>
          </div>
          <div class="m-br-tip"><b>!</b><span>对比数字由月K回算（judge.ts），随「更新到最新」刷新；进行中轮次截至窗口末月。</span></div>
        </template>

        <div class="m-sub-tail"></div>
      </template>
    </div>
  </div>
</template>
