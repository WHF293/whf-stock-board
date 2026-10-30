<script setup lang="ts">
import { SKELETON_ROW_COUNT } from '../constants';

/**
 * 新闻列表骨架屏（移动端）：仿 NewsRow 几何（两行文字 + 右侧缩略图），
 * 充当频道首载 / 横滑切源的过渡态（骨架即 loading，不再展示加载文案）
 */
</script>

<template>
  <div class="m-news-skel">
    <div v-for="i in SKELETON_ROW_COUNT" :key="i" class="m-news-skel__row">
      <div class="m-news-skel__main">
        <div class="m-news-skel__bar m-news-skel__bar--title"></div>
        <div class="m-news-skel__bar m-news-skel__bar--meta"></div>
      </div>
      <div class="m-news-skel__thumb"></div>
    </div>
  </div>
</template>

<style scoped>
.m-news-skel__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
}
.m-news-skel__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.m-news-skel__bar {
  height: 13px;
  border-radius: 6px;
  background:
    linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.16), transparent);
  animation: m-shimmer 1.2s infinite;
}
.m-news-skel__bar--title {
  width: 86%;
}
.m-news-skel__bar--meta {
  width: 44%;
}
.m-news-skel__thumb {
  width: 64px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 8px;
  background:
    linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.16), transparent);
  animation: m-shimmer 1.2s infinite;
}
</style>
