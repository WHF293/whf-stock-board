import type { RegisteredHeaderItem } from './plugin.types';

/** 顶栏渲染项：宿主自带项（`panel` 为 null，按 id 分支渲染）与插件条目（渲染 HeaderItemHost） */
export interface HeaderRenderItem {
  /** 唯一键（宿主项 = 项 id；插件条目 = `<pluginId>#<id>`，也是设置页持久化的键） */
  key: string;
  /** 宿主项 id 或插件条目全局键 */
  id: string;
  /** 条目名 */
  title: string;
  /** 图标 key */
  icon: string;
  /** 插件条目（宿主自带项为 null） */
  panel: RegisteredHeaderItem | null;
}
