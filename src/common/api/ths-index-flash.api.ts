import { proxyFetch } from './proxy-fetch';
import { THS_INDEX_FLASH_URL, THS_REFERER_Q } from '../constants/ths-market.constants.ts';
import type { ThsIndexFlash } from '../types/ths-market.types.ts';

/**
 * 拉取同花顺 q 域 indexflash 接口（大盘评分等，GBK JSON）
 *
 * curl 实测（2026-10-13 盘中）返回顶层四键：zdt_data / zdfb_data / jrbx_data /
 * dppj_data；dppj_data 即行情中心「大盘评级」环形的分数（实测 5.7，一位小数）。
 * 投资建议文案不在接口里——同花顺前端（hssc_v1.min.js）写死五档映射，
 * 已照抄进 `THS_RATING_GRADES`，消费方用 `getThsRatingAdvice` 取文案。
 * GBK 解码：TextDecoder('gbk')，与既有同花顺 HTML 解析同法
 * @returns 大盘评分（字段缺失或非法归 null；zdt/jrbx 透传登记不消费）
 */
export const fetchThsIndexFlash = async (): Promise<ThsIndexFlash> => {
  const response = await proxyFetch(THS_INDEX_FLASH_URL, {
    headers: { Referer: THS_REFERER_Q },
  });
  if (!response.ok) {
    throw new Error(`同花顺大盘评级请求失败：HTTP ${response.status}`);
  }
  const text = new TextDecoder('gbk').decode(await response.arrayBuffer());
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('同花顺大盘评级响应解析失败（非 JSON）');
  }
  const dppjRaw = payload.dppj_data;
  const dppj = typeof dppjRaw === 'number' && Number.isFinite(dppjRaw) ? dppjRaw : null;
  return {
    dppj,
    zdtData: payload.zdt_data ?? null,
    jrbxData: payload.jrbx_data ?? null,
  };
};
