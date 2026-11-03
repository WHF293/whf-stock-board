/**
 * 风格跷跷板视图常量集中管理
 *
 * 口径定论见 `.ai/开发方案/2026-10-23-前端-风险偏好跷跷板页面开发方案.md`
 * （2026-10-23 王总确认方向后按推荐项实现）。
 */

import { EXTRA_BOARDS, SW_LEVEL1_BOARDS } from './board-calendar.constants.ts';

/**
 * 防守端 · 老登价值桶 · 默认申万一级行业集合（静态，v2 扩容）
 *
 * v1（2026-10-23 王总确认）仅 5 个纯红利行业；v2（2026-11-03 王总指定重新设计）：
 * 防守端语义从「高股息红利」扩为「红利 + 老登价值」——白酒等大消费老登与
 * 地产基建链归入防守端，共 12 个申万一级行业。分组仅作归类注释，运行期不区分。
 *
 * 进攻端仍为逐日动态判定（当日达标板块归并），两桶冲突日抱团优先（防守端剔除）；
 * 改动本集合会整体改变历史剪刀差曲线（纯前端重算，零迁移）。
 */
export const STYLE_DEFENSIVE_BOARD_CODES: ReadonlyArray<string> = [
  // 红利核心（v1）
  'BK1283', // 银行
  'BK0437', // 煤炭
  'BK0464', // 石油石化
  'BK0427', // 公用事业
  'BK1210', // 交通运输
  // 大消费老登（v2）
  'BK0438', // 食品饮料（白酒等）
  'BK0433', // 农林牧渔
  'BK1213', // 商贸零售
  'BK0436', // 纺织服饰
  // 地产基建老登（v2）
  'BK1208', // 建筑材料
  'BK1209', // 建筑装饰
  'BK1202', // 房地产
];

/** 防守端行业名列表（由 SW_LEVEL1_BOARDS 映射，口径单源防漂移；快照口径说明用） */
export const STYLE_DEFENSIVE_BOARD_NAMES: ReadonlyArray<string> =
  STYLE_DEFENSIVE_BOARD_CODES.map(
    (code) => SW_LEVEL1_BOARDS.find((board) => board.code === code)?.name ?? code,
  );

/**
 * 追加板块（热门题材）→ 所属申万一级行业的归属映射（抱团判定用）
 *
 * 追加板块与申万一级必然重叠（半导体 ⊂ 电子…），抱团判定的命中板块必须
 * 归并到一级行业后再参与两桶聚合——聚合只用 31 个申万一级（完整划分零重叠），
 * 桶级成交额 / 涨跌家数求和才不会重复计算。
 */
export const HOT_BOARD_SW_PARENT: Readonly<Record<string, string>> = Object.fromEntries(
  EXTRA_BOARDS.map((extra) => {
    const parent =
      extra.code === 'BK1036'
        ? 'BK1201' // 半导体 ⊂ 电子
        : extra.code === 'BK0480'
          ? 'BK1204' // 航天航空 ⊂ 国防军工
          : extra.code === 'BK1408'
            ? 'BK1205' // 机器人 ⊂ 机械设备
            : 'BK1200'; // 光伏设备 / 新能源 ⊂ 电力设备
    return [extra.code, parent];
  }),
);

/** 申万一级行业代码集合（抱团候选归并 / 防守桶校验用） */
export const SW_LEVEL1_CODE_SET: ReadonlySet<string> = new Set(
  SW_LEVEL1_BOARDS.map((board) => board.code),
);

/**
 * 风格跷跷板线色（bump 图双轴叠加线 + 快照横幅圆点共用）
 *
 * 独立于涨跌语义色与题材段调色板：橙 = 进攻端、蓝 = 防守端（2026-10-23 定稿用色）
 */
export const SEESAW_LINE_COLORS = {
  AGGRESSIVE: '#e0592a',
  DEFENSIVE: '#3a7bd5',
} as const;

/** 两桶展示名（bump 图叠加线 series 名 / 快照横幅标题共用；防守端 v2 起为「红利 + 老登价值」口径） */
export const SEESAW_BUCKET_LABELS = {
  AGGRESSIVE: '进攻端 · 高情绪抱团',
  DEFENSIVE: '防守端 · 红利老登',
} as const;

/**
 * 风险偏好判定阈值（百分点）
 *
 * 当日进攻端与防守端的等权涨跌幅之差 ≥ +阈值 → 进攻占优；
 * ≤ -阈值 → 防守占优；否则均衡。任一端缺数 → 无法判定。
 */
export const SEESAW_BALANCE_THRESHOLD = 0.5;

/**
 * 抱团候选门槛：直接复用题材轮动的上榜口径（涨停家数 ≥ minLimitUp 且
 * 得分率 ≥ minScoreRate），并受题材轮动「设置」弹窗的上榜最低得分率联动
 * （两页共用同一 settings 值，口径一致）。
 */
export const SEESAW_USE_ROTATION_THRESHOLD = true;
