import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * 系统默认浏览器打开外部链接（供 `app:open-url` 插件服务与宿主自身共用）
 *
 * Tauri 内走 plugin-opener；纯浏览器 dev 环境无 runtime 时兜底新标签页。
 * @param url 目标地址
 */
export const openExternalUrl = (url: string): void => {
  try {
    void openUrl(url).catch(() => window.open(url, '_blank'));
  } catch {
    window.open(url, '_blank');
  }
};
