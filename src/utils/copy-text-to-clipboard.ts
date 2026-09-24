/**
 * 复制文本到系统剪贴板
 *
 * navigator.clipboard.writeText 优先（Tauri WebView2 的 tauri.localhost 属
 * secure context，可用）；权限被拒或 API 缺失时退回临时 textarea +
 * execCommand 兜底。两路都失败返回 false，由调用方决定失败提示。
 */

/**
 * 复制文本到剪贴板
 * @param text 待复制文本
 * @returns 是否复制成功
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 剪贴板权限被拒等异常：落到 execCommand 兜底
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // 移出视口但保持可选中（display:none 会让 select 失效）
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
