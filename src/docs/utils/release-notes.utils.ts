/**
 * Release body 的「更新内容」提取
 *
 * Release 描述由 CI 生成：`## 更新内容` 小节内每行一条 `N. 提交主题`，
 * 遇到下一个 `##` 小节即止。这里只提取纯文本行，渲染层走模板插值
 * （不走 v-html），从根上杜绝注入。
 */

/** 更新内容小节标题（CI 生成口径） */
const NOTES_SECTION_HEADING = /^##\s*更新内容/;

/** 任意二级小节标题（用于判断离开更新内容小节） */
const ANY_SECTION_HEADING = /^##\s/;

/** 编号列表行（如 `1. feat: xxx`） */
const NUMBERED_LINE = /^\s*\d+\.\s+(.*)$/;

/**
 * 从 Release body 提取「更新内容」编号列表（纯文本）
 * @param body Release 描述原文（可能为 null）
 * @returns 编号列表文案数组；无小节或无条目时为空数组
 */
export function extractReleaseNotes(body: string | null): string[] {
  if (!body) return [];
  const notes: string[] = [];
  let inNotesSection = false;
  for (const line of body.split(/\r?\n/)) {
    if (ANY_SECTION_HEADING.test(line)) {
      if (inNotesSection) break;
      inNotesSection = NOTES_SECTION_HEADING.test(line);
      continue;
    }
    if (!inNotesSection) continue;
    const matched = NUMBERED_LINE.exec(line);
    const text = matched?.[1]?.trim();
    if (text) notes.push(text);
  }
  return notes;
}
