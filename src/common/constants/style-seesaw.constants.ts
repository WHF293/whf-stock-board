/**
 * 风格跷跷板视图常量集中管理
 *
 * 口径定论见 `.ai/开发方案/2026-10-23-前端-风险偏好跷跷板页面开发方案.md`
 * （2026-10-23 王总确认方向后按推荐项实现）。
 */

import { EXTRA_BOARDS, SW_LEVEL1_BOARDS } from './board-calendar.constants.ts';

/**
 * 高股息红利桶 · 默认申万一级行业集合（防守端，王总 2026-10-23 确认）
 *
 * v1 纯行业映射，不做股息率精修（项目暂无股息率数据源，v1.1 抓包确认字段后接入）。
 */
export const STYLE_DEFENSIVE_BOARD_CODES: ReadonlyArray<string> = [
  'BK1283', // 银行
  'BK0437', // 煤炭
  'BK0464', // 石油石化
  'BK0427', // 公用事业
  'BK1210', // 交通运输
];

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
 * 风格跷跷板展示范围档位（交易日数；与题材轮动 ROTATION_RANGES 同档独立常量）
 */
export const SEESAW_RANGES = [10, 20, 30] as const;

/** 展示范围默认值 */
export const SEESAW_DEFAULT_RANGE: (typeof SEESAW_RANGES)[number] = 10;

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
