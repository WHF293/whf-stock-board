/**
 * 全局命令面板（Ctrl+K）类型
 *
 * 面板合并三类结果源：个股（远程搜索）/ 页面（宿主菜单 + 插件菜单）/ 命令（插件贡献），
 * 每条可执行项统一抽象为 `PaletteItem`，执行语义由 `kind` 决定（见 CommandPalette.vue）
 */

/** 结果项类型（决定执行行为与分组归属） */
export const PALETTE_ITEM_KIND = {
  /** 个股：执行 = openStock 打开右侧详情 */
  STOCK: 'stock',
  /** 页面：执行 = router.push(path) */
  PAGE: 'page',
  /** 插件命令：执行 = command.run() */
  COMMAND: 'command',
} as const satisfies Record<string, string>;

/** 结果项类型（`typeof` 形式供类型引用与常量遍历） */
export type PaletteItemKind = (typeof PALETTE_ITEM_KIND)[keyof typeof PALETTE_ITEM_KIND];

/** 命令面板一条可执行结果项 */
export interface PaletteItem {
  /** 结果类型 */
  kind: PaletteItemKind;
  /** 主标题（股票名 / 页面标题 / 命令标题） */
  label: string;
  /** 次级说明（股票代码 / 路由路径 / 快捷键描述，可空） */
  detail: string;
  /** MenuIcon 图标 key（个股恒为 search；页面用菜单 icon；命令恒为 grip） */
  icon: string;
  /** 匹配得分（越高越靠前；仅前端过滤组使用，远程搜索组恒为 0） */
  score: number;
  /** 再执行定位串：个股 = 完整符号 / 页面 = 路由路径 / 命令 = 注册表 key（`<pluginId>#<id>`） */
  ref: string;
}

/**
 * 最近使用记录的持久化形态（localStorage JSON 数组元素）
 *
 * 全部为可序列化标量——命令类只存注册表 key，恢复时回注册表查 run()，
 * 查不到（插件已卸载/更名）则丢弃该条，不报错
 */
export interface RecentPaletteEntry {
  /** 结果类型 */
  kind: PaletteItemKind;
  /** 主标题 */
  label: string;
  /** 次级说明 */
  detail: string;
  /** 图标 key */
  icon: string;
  /** 再执行定位串（语义同 PaletteItem.ref） */
  ref: string;
}
