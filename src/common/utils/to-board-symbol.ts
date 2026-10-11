import { normalizeAShareCode } from './normalize-a-share-code';

/**
 * 各平台榜单的原始代码归一化为完整符号（sh600519 形态）
 *
 * 五个平台给出四种形态：6 位纯代码（同花顺 / 通达信）、`SH600418` 大写带前缀
 * （东财 / 雪球）、`sh600825` 小写带前缀（财联社）、非 A 股代码（雪球榜含港美
 * 股，如 `NVDA` / `00700`）——统一转小写后按形态分发；非 A 股代码返回空串，
 * 由取数层过滤（页面口径只保留 A 股）
 * @param raw 榜单条目的原始代码
 * @returns 完整符号（sh600519 形态）；非 A 股代码返回空串
 */
export const toBoardSymbol = (raw: string): string => {
  const code = raw.trim().toLowerCase();
  if (/^\d{6}$/.test(code)) {
    return normalizeAShareCode(code);
  }
  // 带市场前缀的形态：前缀限定 sh/sz/bj 且剩余为 6 位数字才认可（排除 NVDA 等）
  if (/^(sh|sz|bj)\d{6}$/.test(code)) {
    return code;
  }
  return '';
};
