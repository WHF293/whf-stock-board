import { BATCH_ADD_SPLITTER, WATCHLIST_SYMBOL_PATTERN } from '../constants/watchlist.constants';
import { toFullSymbol } from './to-full-symbol';
import type { BatchSymbolCandidate } from '../types/watchlist.types';

/**
 * 解析批量添加弹窗里的代码文本
 *
 * 处理链：按分隔符切分 → 去空白 → 丢弃空串 → 归一化为完整符号 → 按合法形态分流。
 * 去重发生在**归一化之后**（`600519` 与 `sh600519` 是同一只票，只保留首次出现的原文）。
 *
 * ⚠️ 形态判定用的是 stock-sdk 的归化结果，它比直觉宽松：`abc` → `usABC`、
 * `12` → `sz12` 都算「合法形态」并被送去上游，最终由返回条数判定为查不到
 * （见 `match-batch-quotes.ts`）。本地只拦**归化不了**的输入（中文、纯符号等）。
 * 这样用户无论打出什么古怪内容，得到的都是同一句「查询不到 xxx 股票」，
 * 不会因为两条提示通道（格式无效 / 查不到）而困惑。
 *
 * 这里只做纯文本处理 —— 代码形态合法不等于标的存在，存在性必须请求上游。
 * @param text 用户粘贴的原始文本（可含中英文逗号 / 顿号 / 分号 / 换行 / 空格）
 * @returns valid 可继续校验的候选（保序、已去重）；invalid 形态非法的原始输入（保序）
 */
export const parseBatchSymbols = (
  text: string,
): { valid: BatchSymbolCandidate[]; invalid: string[] } => {
  const seen = new Set<string>();
  const valid: BatchSymbolCandidate[] = [];
  const invalid: string[] = [];

  for (const raw of text.split(BATCH_ADD_SPLITTER)) {
    const input = raw.trim();
    if (!input) {
      continue;
    }
    const symbol = toFullSymbol(input);
    // 大小写不敏感：usAAPL 与 usaapl 是同一只，别重复请求上游
    const dedupeKey = symbol.toUpperCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    if (WATCHLIST_SYMBOL_PATTERN.test(symbol)) {
      valid.push({ input, symbol });
    } else {
      invalid.push(input);
    }
  }

  return { valid, invalid };
};
