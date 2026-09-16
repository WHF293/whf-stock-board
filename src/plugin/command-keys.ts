/**
 * 插件命令快捷键的解析与匹配
 *
 * 插件只声明「`Ctrl+Alt+N`」这样的描述串，由宿主在 capture 阶段统一匹配 ——
 * 好处是同一组合键不会被两个插件各挂一份监听；插件卸载后监听天然不存在。
 */
import {
  PLUGIN_KEY_DIGIT_PREFIX,
  PLUGIN_KEY_LETTER_PREFIX,
  PLUGIN_KEY_MODIFIER,
  PLUGIN_KEY_NAMED_CODE,
  PLUGIN_KEY_SEPARATOR,
} from '../constants/plugin.constants';

/** 解析后的快捷键 */
export interface ParsedCommandKeys {
  /** 是否要求 Ctrl */
  ctrl: boolean;
  /** 是否要求 Shift */
  shift: boolean;
  /** 是否要求 Alt */
  alt: boolean;
  /** 是否要求 Meta（Cmd / Win） */
  meta: boolean;
  /** 目标键的 KeyboardEvent.code（如 `KeyN` / `Tab`） */
  code: string;
}

/**
 * 把单个 token 转成 KeyboardEvent.code
 * @param token 形如 `N` / `7` / `Tab` 的片段
 * @returns KeyboardEvent.code；无法识别返回空串
 */
const toKeyCode = (token: string): string => {
  const lower = token.toLowerCase();
  if (lower.length === 1 && /[a-z]/.test(lower)) {
    return `${PLUGIN_KEY_LETTER_PREFIX}${lower.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(lower)) {
    return `${PLUGIN_KEY_DIGIT_PREFIX}${lower}`;
  }
  return PLUGIN_KEY_NAMED_CODE[lower] ?? '';
};

/**
 * 解析快捷键描述串
 * @param keys 形如 `Ctrl+Alt+N` 的描述串
 * @returns 解析结果；缺少主键或主键无法识别时返回 null
 */
export const parseCommandKeys = (keys: string): ParsedCommandKeys | null => {
  const tokens = keys
    .split(PLUGIN_KEY_SEPARATOR)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const parsed: ParsedCommandKeys = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    code: '',
  };
  for (const token of tokens) {
    const modifier = PLUGIN_KEY_MODIFIER[token.toLowerCase() as keyof typeof PLUGIN_KEY_MODIFIER];
    if (modifier) {
      parsed[modifier] = true;
      continue;
    }
    const code = toKeyCode(token);
    if (!code) return null;
    parsed.code = code;
  }
  return parsed.code ? parsed : null;
};

/**
 * 判断键盘事件是否命中解析后的快捷键（修饰键需完全一致）
 * @param event 键盘事件
 * @param parsed 解析后的快捷键
 * @returns 是否命中
 */
export const matchesCommandKeys = (
  event: KeyboardEvent,
  parsed: ParsedCommandKeys,
): boolean =>
  event.ctrlKey === parsed.ctrl &&
  event.shiftKey === parsed.shift &&
  event.altKey === parsed.alt &&
  event.metaKey === parsed.meta &&
  event.code === parsed.code;
