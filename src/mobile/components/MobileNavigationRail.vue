<script setup lang="ts">
import { computed } from 'vue';
import { MOBILE_TAB_ITEMS } from '../constants';
import { useBreakpoint } from '../composables/use-breakpoint';

/**
 * 左侧导航 Rail（≥600px 大屏形态，2026-10-28 小米自由窗口适配新增）
 *
 * Medium / Expanded 档替代底部 TabBar：竖排五主 Tab（图标 + 文案），玻璃面板
 * 样式与 .m-tabbar 同源 token（mobile.css .m-rail）。**全路由显示**（含二级页，
 * 与底部 TabBar 的「二级页隐藏」不同——大屏上导航常驻，`.m-root` 的让位 padding
 * 才能恒定成立），激活态由 router-link 的 active-class 按路径匹配（二级页无高亮）。
 */
const { md } = useBreakpoint();

/** ≥600px（Medium 档及以上）即显示 */
const visible = computed(() => md.value);
</script>

<template>
  <nav v-if="visible" class="m-rail" aria-label="主导航">
    <router-link
      v-for="item in MOBILE_TAB_ITEMS"
      :key="item.path"
      :to="item.path"
      class="m-rail__item"
      active-class="m-rail__item--active"
    >
      <span class="m-rail__icon"><van-icon :name="item.icon" /></span>
      <span>{{ item.label }}</span>
    </router-link>
  </nav>
</template>
