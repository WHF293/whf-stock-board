<script setup lang="ts">
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

/** 当前图标的 path 片段；未知 key 渲染为空避免报错 */
const paths = ICON_PATHS[props.name] ?? '';
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
