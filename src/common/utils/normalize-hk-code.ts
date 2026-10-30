/**
 * 同花顺港股代码 → 腾讯港股符号（`HK2715` / `K81810` → `hk02715`）
 *
 * 同花顺港股板块页代码列形态不一：正股 `HK2715`（HK 前缀 + 4 位）、
 * 权证 `K81810`（单字母前缀 + 5 位）等。统一剥掉数字以外的字符，
 * 剩余数字补零到 5 位并加 `hk` 前缀（腾讯符号口径）
 * @param rawCode 同花顺港股代码原文（如 `HK2715` / `K81810`）
 * @returns 腾讯港股符号（`hk02715`）；无数字时返回空串
 */
export const normalizeHkCode = (rawCode: string): string => {
  const digits = rawCode.replace(/\D/g, '');
  if (digits === '') return '';
  return `hk${digits.padStart(5, '0')}`;
};
