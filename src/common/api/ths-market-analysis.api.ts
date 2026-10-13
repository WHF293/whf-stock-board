import { proxyFetch } from './proxy-fetch';
import {
  THS_CHART_DATA_URL,
  THS_CHART_KEY,
  THS_REFERER_HOME,
  THS_TURNOVER_HEADER_KEY,
  toThsChartHeaderMap,
} from '../constants/ths-market.constants.ts';
import type {
  ThsChartResponse,
  ThsTurnoverDay,
  ThsTurnoverMinute,
} from '../types/ths-market.types.ts';

/**
 * 拉取同花顺 dq 域 get_chart_data 图表数据（JSON/UTF-8）
 *
 * 接口为同花顺首页「实时成交额」模块数据源，已 curl 实测（2026-10-13 盘中）：
 * turnover_minute 直出同时刻环比（turnover_change）与预测全天（predict_turnover），
 * turnover_day 直出近 60 日均（average_turnover）——页面不再自算这两个口径
 * @param chartKey 图表 key（turnover_minute / turnover_day）
 * @returns 原始图表响应（status_code 非 0 时抛错）
 */
const fetchThsChartData = async (chartKey: string): Promise<ThsChartResponse> => {
  const url = `${THS_CHART_DATA_URL}?chart_key=${chartKey}`;
  const response = await proxyFetch(url, {
    headers: { Referer: THS_REFERER_HOME },
  });
  if (!response.ok) {
    throw new Error(`同花顺图表数据请求失败：HTTP ${response.status}`);
  }
  const payload = (await response.json()) as ThsChartResponse;
  if (payload?.status_code !== 0 || !payload?.data?.charts) {
    throw new Error(`同花顺图表数据响应异常：status_code=${payload?.status_code}`);
  }
  return payload;
};

/**
 * 拉取市场成交额分时（同花顺后端直出同时刻环比与预测全天）
 *
 * point_list 行 = [时间戳ms, 当日累计, 昨日同时刻累计, 较昨日变动, null]；
 * header 五项：turnover / turnover_pre / turnover_change / predict_turnover /
 * predict_turnover_change_rate。轮询频率见 THS_POLLING_INTERVAL.TURNOVER_MINUTE
 * @returns 分时数据（字段缺失归 null，由 UI 展示「--」）
 */
export const fetchThsTurnoverMinute = async (): Promise<ThsTurnoverMinute> => {
  const payload = await fetchThsChartData(THS_CHART_KEY.TURNOVER_MINUTE);
  const header = toThsChartHeaderMap(payload);
  const K = THS_TURNOVER_HEADER_KEY;
  const points = (payload.data.charts.point_list ?? [])
    .map((row) => ({
      time: typeof row[0] === 'number' ? row[0] : 0,
      turnover: typeof row[1] === 'number' ? row[1] : null,
      pre: typeof row[2] === 'number' ? row[2] : null,
      change: typeof row[3] === 'number' ? row[3] : null,
    }))
    .filter((point) => point.time > 0);
  const lastPoint = points.at(-1)?.time ?? null;
  return {
    turnover: header[K.TURNOVER] ?? null,
    turnoverPre: header[K.TURNOVER_PRE] ?? null,
    turnoverChange: header[K.TURNOVER_CHANGE] ?? null,
    predictTurnover: header[K.PREDICT_TURNOVER] ?? null,
    predictChangeRate: header[K.PREDICT_CHANGE_RATE] ?? null,
    updatedAt: lastPoint,
    points,
  };
};

/**
 * 拉取市场成交额日 K（近 60 个交易日）
 *
 * header 两项：turnover（当日成交额）、average_turnover（近 60 日平均，后端直出）；
 * point_list 行 = [时间戳ms, 当日成交额, 0]。5 日均由 `computeTurnoverAverages`
 * 对 points 近 5 条本地平均，无需再请求
 * @returns 日 K 数据（字段缺失归 null）
 */
export const fetchThsTurnoverDay = async (): Promise<ThsTurnoverDay> => {
  const payload = await fetchThsChartData(THS_CHART_KEY.TURNOVER_DAY);
  const header = toThsChartHeaderMap(payload);
  const K = THS_TURNOVER_HEADER_KEY;
  const points = (payload.data.charts.point_list ?? [])
    .map((row) => ({
      time: typeof row[0] === 'number' ? row[0] : 0,
      turnover: typeof row[1] === 'number' ? row[1] : null,
    }))
    .filter((point) => point.time > 0);
  return {
    turnover: header[K.TURNOVER] ?? null,
    averageTurnover: header[K.AVERAGE_TURNOVER] ?? null,
    points,
  };
};
