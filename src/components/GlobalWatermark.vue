<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '../stores/settings';
import {
  WATERMARK_FILL,
  WATERMARK_ROTATE_DEG,
  WATERMARK_TEXT,
  WATERMARK_TILE,
} from '../constants/watermark.constants';

/**
 * 全局水印：斜向平铺「数据仅供个人学习参考」，覆盖内容区且不拦截交互；
 * 设置页可开关（settings store 持久化）
 */
const settingsStore = useSettingsStore();

/** SVG data-uri 平铺背景（构建组件时生成一次；固定灰在亮暗底均可辨识） */
const backgroundImage = computed(() => {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${WATERMARK_TILE.WIDTH}' height='${WATERMARK_TILE.HEIGHT}'>` +
    `<text x='16' y='${WATERMARK_TILE.HEIGHT / 2}' font-size='14' fill='${WATERMARK_FILL}' ` +
    `transform='rotate(${WATERMARK_ROTATE_DEG} 16 ${WATERMARK_TILE.HEIGHT / 2})'>${WATERMARK_TEXT}</text>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
});
</script>

<template>
  <div
    v-if="settingsStore.watermarkEnabled"
    class="pointer-events-none fixed inset-0 z-30 select-none"
    :style="{ backgroundImage }"
    aria-hidden="true"
  />
</template>
