import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

/**
 * Agent 消息正文的 Markdown 渲染（md → 消毒后 HTML）
 *
 * markdown-it 单例：`html: false` 禁内嵌 HTML（LLM 输出里的原生标签一律
 * 转义为纯文本，防提示注入挂马）、`linkify` 自动识别裸链接、`breaks` 单换行
 * 转 <br>（贴合聊天输出的断行习惯）；输出再经 DOMPurify 白名单消毒，
 * 链接统一新开页。流式逐字重解析由调用方（Vue computed）驱动，几 KB 文本
 * 单次解析亚毫秒级，无性能压力
 */

/** markdown-it 实例（CommonMark + GFM 表格 / 删除线默认开启） */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

/** 代码围栏（三连反引号） */
const FENCE_PATTERN = /```/g;

/**
 * 补齐未闭合的代码围栏（流式中间态）
 *
 * 打字过程中代码围栏（三连反引号）数量为奇数意味着还有一个未闭合的围栏，
 * 不补的话本次解析会把后半段整体吞进代码块、光标区域闪烁变形；
 * 补一个闭合行，围栏写完后自然恢复原貌
 * @param source 原始 markdown 文本
 * @returns 围栏配平后的文本
 */
const balanceFences = (source: string): string =>
  (source.match(FENCE_PATTERN)?.length ?? 0) % 2 === 1 ? `${source}\n\`\`\`` : source;

// 消毒后处理：链接一律新开页（渲染环境是应用内 webview，防站内跳转打断会话）
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * Markdown 文本 → 消毒后的 HTML 字符串
 * @param source 原始 markdown 文本（支持流式半截文本：未闭合代码围栏自动补齐）
 * @returns 可安全经 v-html 注入的 HTML（空白输入返回空串）
 */
export const renderMarkdown = (source: string): string =>
  source === '' ? '' : DOMPurify.sanitize(md.render(balanceFences(source)));
