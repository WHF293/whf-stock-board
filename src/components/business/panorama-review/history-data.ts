/**
 * 插件 dsh-bull-review（历史牛市复盘）· 取数层
 *
 * 复用已验证的新浪 K 线源（`api/sina-kline.api.ts`）：`monthly` 周期一次拿到上游全部
 * 月 K 历史（实测 `sh000001` 覆盖 1990-12 至今，datalen=1000 未触顶）。
 * ⚠️ 不用 `sdk.kline`：东财行情域本机封禁（见 SERVER_API.md）。
 * 批量拉取串行 + `delay(500)` 错峰 —— 同一上游连续请求的频率红线。
 */
import dayjs from 'dayjs';
import { fetchSinaKline } from '../../../api/sina-kline.api';
import { delay } from '../../../utils/delay';
import { BULL_INDEX_LIST, BULL_SYNC_DELAY_MS } from './constants';
import type { MonthlyBar } from './types';

/**
 * 拉取单只指数的全部月 K（升序）
 * @param symbol 指数符号（新浪形态，如 `sh000001`）
 * @returns 月 K 序列（升序；脏数据已过滤）
 */
export const fetchIndexMonthlyBars = async (symbol: string): Promise<MonthlyBar[]> => {
  const bars = await fetchSinaKline(symbol, 'monthly');
  return bars
    .map((bar) => ({
      month: dayjs(bar.timestamp).format('YYYY-MM'),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }))
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0);
};

/**
 * 批量拉取全部叠加指数的月 K（串行错峰）
 * @param onStep 每完成一只的回调（已完成数 / 总数 / 指数名），用于同步进度展示
 * @returns symbol → 月 K 序列
 */
export const fetchAllIndexMonthlies = async (
  onStep?: (done: number, total: number, name: string) => void,
): Promise<Record<string, MonthlyBar[]>> => {
  const result: Record<string, MonthlyBar[]> = {};

  for (const [index, ref] of BULL_INDEX_LIST.entries()) {
    if (index > 0) {
      await delay(BULL_SYNC_DELAY_MS);
    }
    onStep?.(index, BULL_INDEX_LIST.length, ref.name);
    result[ref.symbol] = await fetchIndexMonthlyBars(ref.symbol);
  }
  return result;
};
