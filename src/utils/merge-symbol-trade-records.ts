import type { AccountTradeRecord } from '../types/account.types';

/**
 * 跨表同笔交易的匹配键
 *
 * 优先用成交编号（交割单与对账单来自同一券商导出，同笔交易编号一致）；
 * 无编号（少数指定交易等）时退化为 日期+时间+代码+数量+价格+操作
 * @param record 成交记录
 * @returns 匹配键
 */
const crossTableIdentity = (record: AccountTradeRecord): string =>
  record.dealNo
    ? `${record.tradeDate}|${record.tradeTime}|${record.symbol}|${record.dealNo}`
    : [
        record.tradeDate,
        record.tradeTime,
        record.symbol,
        record.quantity,
        record.price,
        record.action,
      ].join('|');

/**
 * 合并个股成交记录（交割单全保留 + 对账单补齐缺的那部分）
 *
 * ⚠️ 只在**跨表**去重，绝不表内去重：实测存在同一秒、同价、同数量但成交编号
 * 不同的两笔真实成交（如 515880 在 2026-07-23 13:00:03 买入 7400 股 ×2），
 * 表内去重会吃掉其中一笔。
 * @param trades 交割单记录（覆盖历史更长，全量保留）
 * @param statements 对账单记录（仅补充交割单里没有的）
 * @returns 合并后的记录（按日期时间倒序，最新在前）
 */
export const mergeSymbolTradeRecords = (
  trades: AccountTradeRecord[],
  statements: AccountTradeRecord[],
): AccountTradeRecord[] => {
  const seen = new Set(trades.map(crossTableIdentity));
  return [
    ...trades,
    ...statements.filter((record) => !seen.has(crossTableIdentity(record))),
  ].sort((a, b) => `${b.tradeDate} ${b.tradeTime}`.localeCompare(`${a.tradeDate} ${a.tradeTime}`));
};
