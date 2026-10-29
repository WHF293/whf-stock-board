/**
 * 软件白皮书的内容块与章节类型
 *
 * 客户端白皮书页（WhitepaperView.vue）与官网文档页（src/docs）共用同一份内容数据，
 * 类型在这里单源定义，两侧只做渲染。
 */

/** 通用内容块 */
export type GuideBlock =
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'steps'; items: string[] }
  | { type: 'defs'; items: { term: string; desc: string }[] }
  | { type: 'tip'; text: string }
  | { type: 'code'; text: string }
  | { type: 'image'; src: string; alt?: string; caption?: string }
  | { type: 'table'; head: string[]; rows: string[][] };

/** 白皮书章节 */
export interface GuideChapter {
  /** 章节锚点 id（目录跳转用） */
  id: string;
  /** 章节标题 */
  title: string;
  /** 右上角标签（分组归类） */
  tag: string;
  /** 左侧目录图标 key（见 MenuIcon） */
  icon: string;
  /** 引导语（可选） */
  intro?: string;
  /** 内容块 */
  blocks: GuideBlock[];
}

