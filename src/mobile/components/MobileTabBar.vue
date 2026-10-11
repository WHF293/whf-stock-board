<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  MOBILE_TAB_ITEMS,
  MOBILE_TAB_THUMB_EASE_RESTORE,
  MOBILE_TAB_THUMB_EASE_TRAVEL,
  MOBILE_TAB_THUMB_RESTORE_DELAY_MS,
  MOBILE_TAB_THUMB_RESTORE_MS,
  MOBILE_TAB_THUMB_TRAVEL_MS,
  MOBILE_TAB_THUMB_TRAVEL_OPACITY,
  MOBILE_TAB_THUMB_TRAVEL_SCALE,
} from '../constants';

/**
 * 底部 TabBar：四个主 Tab（首页 / 自选 / 热点新闻 / 我的）
 * 仅在主 Tab 路由显示（二级页隐藏）；激活态由 router-link 的 active-class 按路径匹配；
 * 选中态的亮胶囊是指示器（__thumb），切换 tab 时平滑滑动到新位置——
 * 行程中均匀缩小至 80% 并降低不透明度，接近落点时回弹放大恢复（液态玻璃手感，规格见 DESIGN-MOBILE.md §3）
 */
const route = useRoute();
const visible = computed(() => MOBILE_TAB_ITEMS.some((item) => item.path === route.path));

/** 当前激活 Tab 序号（驱动指示胶囊的横向位移；非主 Tab 页组件不渲染） */
const activeIndex = computed(() =>
  MOBILE_TAB_ITEMS.findIndex((item) => item.path === route.path),
);

/** 指示胶囊样式：位移 + 行程中的缩放/透明度包络 */
const thumbStyle = ref<{ transform: string; transition: string; opacity: string }>({
  transform: `translateX(${activeIndex.value * 100}%)`,
  transition: `transform ${MOBILE_TAB_THUMB_TRAVEL_MS}ms ${MOBILE_TAB_THUMB_EASE_TRAVEL}`,
  opacity: '1',
});

let restoreTimer: number | undefined;

watch(activeIndex, (idx) => {
  window.clearTimeout(restoreTimer);
  // 行程：滑动 + 缩小 + 变透明
  thumbStyle.value = {
    transform: `translateX(${idx * 100}%) scale(${MOBILE_TAB_THUMB_TRAVEL_SCALE})`,
    transition: `transform ${MOBILE_TAB_THUMB_TRAVEL_MS}ms ${MOBILE_TAB_THUMB_EASE_TRAVEL}, opacity ${MOBILE_TAB_THUMB_TRAVEL_MS}ms ease`,
    opacity: MOBILE_TAB_THUMB_TRAVEL_OPACITY,
  };
  // 接近落点：回弹放大恢复默认
  restoreTimer = window.setTimeout(() => {
    thumbStyle.value = {
      transform: `translateX(${idx * 100}%) scale(1)`,
      transition: `transform ${MOBILE_TAB_THUMB_RESTORE_MS}ms ${MOBILE_TAB_THUMB_EASE_RESTORE}, opacity ${MOBILE_TAB_THUMB_RESTORE_MS}ms ease`,
      opacity: '1',
    };
  }, MOBILE_TAB_THUMB_RESTORE_DELAY_MS);
});

onUnmounted(() => window.clearTimeout(restoreTimer));
</script>

<template>
  <nav v-if="visible" class="m-tabbar">
    <span class="m-tabbar__thumb" :style="thumbStyle"></span>
    <router-link
      v-for="item in MOBILE_TAB_ITEMS"
      :key="item.path"
      :to="item.path"
      class="m-tabbar__item"
      active-class="m-tabbar__item--active"
    >
      <span class="m-tabbar__icon">{{ item.icon }}</span>
      <span>{{ item.label }}</span>
    </router-link>
  </nav>
</template>
