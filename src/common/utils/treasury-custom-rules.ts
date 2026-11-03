/**
 * 我的祖训（自定义祖训）· appStorage 存取
 *
 * 2026-11-03 王总指定：弹窗内可增删自定义祖训，持久化记住。跨窗口共享
 * localStorage——横条窗口每轮换句前重读（≤5s 延迟），无需事件通道。
 * 读取端做了完备清洗（非数组 / 条目非对象 / 主句空串等坏数据静默剔除），
 * 手改存储不会打崩横条轮播。
 */
import { appStorage } from './app-local-storage';
import {
  STORAGE_NS_TREASURY_CUSTOM_RULES,
  TREASURY_CUSTOM_RULES_MAX,
  type TreasuryRule,
} from '../constants/treasury.constants.ts';

/** 单条上限（字符）：横条单行展示，超长没有意义 */
const RULE_TITLE_MAX_CHARS = 60;
const RULE_DESC_MAX_CHARS = 120;

/**
 * 读取自定义祖训（坏数据静默清洗：非数组 / 主句空、超长截断、上限裁剪）
 * @returns 清洗后的自定义祖训列表（顺序 = 添加顺序）
 */
export const loadTreasuryCustomRules = (): TreasuryRule[] => {
  const raw = appStorage.getItem(STORAGE_NS_TREASURY_CUSTOM_RULES);
  if (raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const rules: TreasuryRule[] = [];
    for (const item of parsed) {
      if (rules.length >= TREASURY_CUSTOM_RULES_MAX) break;
      if (typeof item !== 'object' || item === null) continue;
      const candidate = item as { title?: unknown; desc?: unknown };
      const title = typeof candidate.title === 'string' ? candidate.title.trim().slice(0, RULE_TITLE_MAX_CHARS) : '';
      if (title === '') continue;
      const desc =
        typeof candidate.desc === 'string' ? candidate.desc.trim().slice(0, RULE_DESC_MAX_CHARS) : '';
      rules.push(desc === '' ? { title } : { title, desc });
    }
    return rules;
  } catch {
    // 非法 JSON 回落空列表（下次保存即覆盖修复）
    return [];
  }
};

/**
 * 保存自定义祖训（上限裁剪 + 主句空串剔除，与读取端同一套清洗）
 * @param rules 待保存列表
 */
export const saveTreasuryCustomRules = (rules: readonly TreasuryRule[]): void => {
  const sanitized = rules
    .map((rule) => ({
      title: rule.title.trim().slice(0, RULE_TITLE_MAX_CHARS),
      desc: (rule.desc ?? '').trim().slice(0, RULE_DESC_MAX_CHARS),
    }))
    .filter((rule) => rule.title !== '')
    .slice(0, TREASURY_CUSTOM_RULES_MAX);
  appStorage.setItem(STORAGE_NS_TREASURY_CUSTOM_RULES, JSON.stringify(sanitized));
};
