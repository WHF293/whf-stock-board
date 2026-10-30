<script setup lang="ts">
import { SKELETON_ROW_COUNT } from '../constants';

/**
 * 榜单骨架屏（移动端，今天炒什么用）：仿 m-board-row 几何（名次 + 名称两行 + 价格 + 热度），
 * 充当榜单首载 / 横滑切平台的过渡态（骨架即 loading，不再展示加载文案）
 */
</script>

<template>
  <div class="m-board-skel">
    <div v-for="i in SKELETON_ROW_COUNT" :key="i" class="m-board-skel__row">
      <div class="m-board-skel__rank"></div>
      <div class="m-board-skel__main">
        <div class="m-board-skel__bar m-board-skel__bar--name"></div>
        <div class="m-board-skel__bar m-board-skel__bar--code"></div>
      </div>
      <div class="m-board-skel__col">
        <div class="m-board-skel__bar m-board-skel__bar--px"></div>
        <div class="m-board-skel__bar m-board-skel__bar--pct"></div>
      </div>
      <div class="m-board-skel__col">
        <div class="m-board-skel__bar m-board-skel__bar--heat"></div>
        <div class="m-board-skel__bar m-board-skel__bar--chg"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-board-skel__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--color-border);
}
.m-board-skel__rank {
  width: 20px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 4px;
  background:
    linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.16), transparent);
  animation: m-shimmer 1.2s infinite;
}
.m-board-skel__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.m-board-skel__col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.m-board-skel__bar {
  height: 12px;
  border-radius: 5px;
  background:
    linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.16), transparent);
  animation: m-shimmer 1.2s infinite;
}
.m-board-skel__bar--name {
  width: 76px;
}
.m-board-skel__bar--code {
  width: 52px;
}
.m-board-skel__bar--px {
  width: 44px;
}
.m-board-skel__bar--pct {
  width: 36px;
}
.m-board-skel__bar--heat {
  width: 40px;
}
.m-board-skel__bar--chg {
  width: 30px;
}
</style>
