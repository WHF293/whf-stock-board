/**
 * 题材轮动视图常量集中管理
 *
 * 口径定论见 `.ai/开发方案/2026-10-21-前端-题材轮动页面开发方案.md`
 * 与 UI 稿 `ui-drafts/2026-10-21-theme-rotation.html` 附录（2026-10-21 王总逐项过稿定稿）。
 */

/**
 * 主线宽度 TopN：每日取「涨停家数 ≥ 上榜阈值」板块的前 N 名作为主线候选
 *
 * 2026-10-21 王总指定默认 Top3（09:59 曾改 5、10:12 收回 3 定稿）；Top1 / Top3 / Top5 三档可切。
 */
export const ROTATION_TOP_N = 3;

/**
 * 主线宽度 TopN 选项（页内切换）
 *
 * 2026-10-21 王总指定仅保留 3 / 5 两档（Top1 移除）。
 */
export const ROTATION_TOP_N_OPTIONS = [3, 5] as const;

/**
 * 板块上榜阈值：当日涨停家数达到该值才有名次资格
 *
 * 过滤长尾杂音板块；回补日仅能算到涨跌停，天然满足该口径。
 */
export const ROTATION_MIN_LIMIT_UP = 2;

/**
 * 主线判定阈值：当日 Top1 涨停家数 ≥ 该值才打「主线」标签，否则「无主线」
 */
export const ROTATION_MAINLINE_MIN = 5;

/**
 * 缩量判定阈值：全市场涨停家数 < 该值时强制「无主线 · 缩量」
 *
 * 覆盖主线判定（节前缩量日榜单上题材仍在但情绪熄火）。
 */
export const ROTATION_LOW_VOLUME_LIMIT = 60;

/**
 * 展示范围档位（交易日数，2026-10-21 王总指定 10 / 20 / 30，默认近 10 日）
 */
export const ROTATION_RANGES = [10, 20, 30] as const;

/** 展示范围默认值 */
export const ROTATION_DEFAULT_RANGE: (typeof ROTATION_RANGES)[number] = 10;

/**
 * 题材段调色板（独立于涨跌语义色）
 *
 * 一段一色（同板块隔日重现开新段新色 = 轮动断点），颜色循环取用。
 */
export const ROTATION_PALETTE: ReadonlyArray<string> = [
  '#0e9488',
  '#6366f1',
  '#d97706',
  '#8b5cf6',
  '#db2777',
  '#0284c7',
];

/** bump 图单列宽度（像素；列宽固定不压缩，超出容器横向滚动） */
export const ROTATION_COL_WIDTH = 64;

/** bump 图容器高度（像素） */
export const ROTATION_CHART_HEIGHT = 340;

/** 涨停梯队统计的中军连板数（limitStreak = 2 计入中军） */
export const ROTATION_TIER_MID_STREAK = 2;

/** 题材段成员股明细的最大展示条数 */
export const ROTATION_MEMBER_LIMIT = 10;
