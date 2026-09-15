<script setup lang="ts">
import { computed } from 'vue';
/**
 * 内联 SVG 线性图标（不引第三方图标库，stroke 跟随 currentColor）
 *
 * 图标 path 源自通用 24x24 线性图标风格，key 与 MENU_ICON / 各使用处约定一致
 */
const ICON_PATHS: Record<string, string> = {
  dashboard:
    '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  star:
    '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  boards:
    '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="8" height="10" rx="1"/><rect x="13" y="10" width="8" height="10" rx="1"/>',
  funds:
    '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
  rank:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6" y="6" width="4" height="4"/><rect x="14" y="6" width="4" height="4"/><rect x="6" y="14" width="4" height="4"/><rect x="14" y="14" width="4" height="4"/>',
  news:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h6M7 12h6M7 15h4M16 9h1v6h-1z"/>',
  flame:
    '<path d="M12 3c1.5 3.5-4 5.5-4 9.5a4 4 0 0 0 8 0c0-1.8-1-3-1-3s2.5 1 2.5 3.5"/><path d="M12 21a8 8 0 0 0 8-8c0-4-3-7-4-9"/>',
  trophy:
    '<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 3"/><path d="M17 6h3a3 3 0 0 1-3 3"/><path d="M12 13v3"/><path d="M9 20h6"/><path d="M10 16h4v4h-4z"/>',
  filter:
    '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
  settings:
    '<path d="M4 6h8M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="15" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="15" cy="18" r="2"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:
    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  plus:
    '<path d="M12 5v14M5 12h14"/>',
  trash:
    '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  search:
    '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  close:
    '<path d="M18 6L6 18M6 6l12 12"/>',
  menu:
    '<path d="M4 6h16M4 12h16M4 18h16"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/>',
  grip:
    '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  arrowLeft:
    '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  info:
    '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
  chevronLeft:
    '<path d="M15 6l-6 6 6 6"/>',
  chevronRight:
    '<path d="M9 6l6 6-6 6"/>',
  chevronDown:
    '<path d="M6 9l6 6 6-6"/>',
  panelLeft:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  // 机器人/Agent：方形头 + 天线 + 双眼 + 嘴
  agent:
    '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 4v4"/><circle cx="12" cy="3" r="1"/><circle cx="9" cy="13" r="1.1"/><circle cx="15" cy="13" r="1.1"/><path d="M9 16.5h6"/>',
  // 股票账户：人像（账户主体）
  account:
    '<circle cx="12" cy="8" r="3.4"/><path d="M5.2 20a6.8 6.8 0 0 1 13.6 0"/>',
  // 交割单导入：单据 + 向上导入箭头
  tradeImport:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 18v-6"/><path d="M9.5 14.5 12 12l2.5 2.5"/>',
  // Skills：手册（打开的书）
  book: '<path d="M12 6c-1.8-1.6-4.2-2-8-2v14c3.8 0 6.2.4 8 2 1.8-1.6 4.2-2 8-2V4c-3.8 0-6.2.4-8 2z"/><path d="M12 6v14"/>',
  // MCP：插头/插座
  plug: '<path d="M9 3v6M15 3v6"/><path d="M6 9h12v3a6 6 0 0 1-12 0z"/><path d="M12 18v3"/>',
  // Model：芯片
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  // 更多（⋯）
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  // 置顶：图钉
  pin: '<path d="M12 17v5"/><path d="M5 11l6-8 8 4-6 8z"/>',
  // 编辑：铅笔
  pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/>',
  // 眼睛（明文切换）
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  // 眼睛闭合
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a15.6 15.6 0 0 1-3.1 3.9M6.1 6.1A15.4 15.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4-.8"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4 4"/>',
  // 分组：文件夹
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  // 板块日历：日历框 + 挂环 + 横线 + 日期点
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/>',
  // 放大打开（跳转详情页）
  expand:
    '<path d="M15 3h6v6M21 3l-8 8M9 21H3v-6M3 21l8-8"/>',
  // 竖向三滑杆（tabs 显示配置）
  sliders:
    '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  // 系统日志：终端窗口 + 提示符 + 文本行
  log: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3"/><path d="M13 15h4"/>',
};

const props = withDefaults(
  defineProps<{
    /** 图标 key（见 ICON_PATHS） */
    name: string;
    /** 图标尺寸（像素） */
    size?: number;
  }>(),
  { size: 16 },
);

/** 当前图标的 path 片段；未知 key 渲染为空避免报错（响应式，name 变化即时切换） */
const paths = computed(() => ICON_PATHS[props.name] ?? '');
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="paths"
  />
</template>
