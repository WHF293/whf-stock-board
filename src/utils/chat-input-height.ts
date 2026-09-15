/**
 * 聊天输入框高度计算（纯函数，便于单测）
 *
 * textarea 原生不会随内容长高，必须手动把高度夹在 [最小行数, 最大行数] 之间，
 * 超出上限时切换为框内滚动。这里只做算术，DOM 读写留在组件里。
 */

/** 输入框高度解算入参 */
export interface InputHeightParams {
  /** 行高（px，取自 computed style） */
  lineHeight: number;
  /** 内容实际高度（px，textarea 归零高度后的 scrollHeight） */
  contentHeight: number;
  /** 最小行数 */
  minRows: number;
  /** 最大行数 */
  maxRows: number;
}

/** 输入框高度解算结果 */
export interface InputHeightResult {
  /** 应设置的像素高度 */
  height: number;
  /** 是否需要在框内滚动（内容超过最大行数） */
  scrollable: boolean;
}

/**
 * 计算输入框目标高度与是否滚动
 *
 * @param params 行高 / 内容高度 / 行数上下限
 * @returns 目标高度与滚动标记
 */
export function resolveInputHeight(params: InputHeightParams): InputHeightResult {
  const { lineHeight, contentHeight, minRows, maxRows } = params;
  const min = lineHeight * minRows;
  const max = lineHeight * maxRows;
  return {
    height: Math.min(Math.max(contentHeight, min), max),
    scrollable: contentHeight > max,
  };
}
