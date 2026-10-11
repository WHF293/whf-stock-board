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
import { BULL_PATTERNS, BULL_ROUNDS } from '../../pc/components/business/panorama-review/rounds';
import { BEAR_PATTERNS, BEAR_ROUNDS } from '../../pc/components/business/panorama-review/bears';
import type {
  MonthlyBar,
  ReviewBearStats,
  ReviewEventCategory,
  ReviewRoundMeta,
  ReviewRoundStats,
  ReviewStageTone,
} from '../../pc/components/business/panorama-review/types';

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

/* === 阶段色带（月K收盘折线缩略 + 底部四段色带 + 顶/底标注） === */

interface BandSegment {
  tone: ReviewStageTone;
  x: number;
  w: number;
}
interface BandView {
  points: string;
  lineColor: string;
  segments: BandSegment[];
  markX: number;
  markY: number;
  markLabel: string;
}

/**
 * 计算阶段色带视图：窗口内月序为时间轴（0~100），色带段按阶段起止月定位，
 * 折线取窗口内月收盘；牛市标顶点、熊市标底点。
 * @param round 轮次档案
 * @param bars 该轮叠加指数全量月K（升序）
 * @returns 色带视图；窗口内数据不足两根时为 null
 */
const bandOf = (round: ReviewRoundMeta, bars: MonthlyBar[] | undefined): BandView | null => {
  if (!bars) return null;
  const inWindow = bars.filter((bar) => bar.month >= round.window.start && bar.month <= round.window.end);
  if (inWindow.length < 2) return null;
  const total = inWindow.length - 1;
  const xOf = (month: string): number => {
    const idx = inWindow.findIndex((bar) => bar.month >= month);
    return ((idx < 0 ? total : idx) / total) * 100;
  };
  const closes = inWindow.map((bar) => bar.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const points = inWindow
    .map((bar, i) => `${((i / total) * 100).toFixed(2)},${(56 - ((bar.close - min) / span) * 46).toFixed(2)}`)
    .join(' ');
  const segments = round.stages.map((stage) => {
    const x1 = xOf(stage.start);
    const x2 = xOf(stage.end);
    return { tone: stage.tone, x: x1, w: Math.max(x2 - x1, 1.5) };
  });
  const isBull = activeView.value !== 'bear';
  const mark = isBull
    ? inWindow.reduce((best, bar) => (bar.close > best.close ? bar : best), inWindow[0]!)
    : inWindow.reduce((best, bar) => (bar.close < best.close ? bar : best), inWindow[0]!);
  const markIdx = inWindow.indexOf(mark);
  return {
    points,
    lineColor: isBull ? 'var(--color-primary)' : 'var(--color-down)',
    segments,
    markX: (markIdx / total) * 100,
    markY: 56 - ((mark.close - min) / span) * 46,
    markLabel: `${shortMonth(mark.month)} ${isBull ? '顶' : '底'} ${mark.close.toFixed(0)}`,
  };
};

/** 当前轮的色带视图（chips 切换即重算） */
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
  <div class="m-page-flex">
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
              {{ round.short }}
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

            <!-- 阶段色带：月K收盘折线 + 四段色带 + 顶/底标注 -->
            <div v-if="band" class="m-br-band">
              <div class="cap"><span>{{ shortMonth(currentRound.window.start) }}</span><span>{{ band.markLabel }}</span><span>{{ shortMonth(currentRound.window.end) }}</span></div>
              <svg viewBox="0 0 100 62" preserveAspectRatio="none">
                <polyline :points="band.points" fill="none" :stroke="band.lineColor" stroke-width="1.4" />
                <rect
                  v-for="seg in band.segments"
                  :key="seg.tone + String(seg.x)"
                  :x="seg.x"
                  y="57"
                  :width="seg.w"
                  height="5"
                  :class="toneClass(seg.tone)"
                />
                <circle :cx="band.markX" :cy="band.markY" r="2.4" class="mk" />
              </svg>
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
