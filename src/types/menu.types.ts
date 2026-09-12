/**
 * 左侧导航菜单项
 */
export interface MenuItem {
  /** 路由路径 */
  path: string;
  /** 菜单标题 */
  title: string;
  /** 图标 key（MenuIcon 组件渲染） */
  icon: string;
}
