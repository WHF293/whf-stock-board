<script setup lang="ts">
import { computed } from 'vue';
import { MOBILE_TAB_ITEMS } from '../constants';
import { useBreakpoint } from '../composables/use-breakpoint';

/**
 * 左侧导航栏（≥600px 大屏形态，2026-10-28 重构为通栏贴边样式）
 *
 * Medium / Expanded 档替代底部 TabBar：全高通栏贴左缘（top/bottom 均为 0），
 * 顶部 app 标 + 竖排五主 Tab（图标 + 文案），形态对齐 YouTube Desktop 式图标侧栏
 * （王总 2026-10-28 指定，替代 v1 的悬浮居中胶囊 Rail）。
 * **全路由显示**（含二级页，与底部 TabBar 的「二级页隐藏」不同——大屏上导航常驻，
 * `.m-root` 的让位 padding 才能恒定成立），激活态由 router-link 的 active-class
 * 按路径匹配（二级页无高亮）。
 */
const { md } = useBreakpoint();

/** ≥600px（Medium 档及以上）即显示 */
const visible = computed(() => md.value);
</script>

<template>
  <div v-if="visible" class="m-rail-wrap" aria-label="主导航">
    <!-- 顶部 app 标（点击回首页），点击下方导航项切换主 Tab -->
    <router-link to="/" class="m-rail__logo">
      <img src="/favicon.svg" alt="首页" />
    </router-link>
    <nav class="m-rail">
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
  </div>
</template>

<style scoped>
/* 通栏壳：全高贴左缘、页面底色同源，导航项本体居中排布；
   独立壳层是为了让 logo 区与导航区共享同一背景/右描边（v1 玻璃胶囊的壳已废） */
.m-rail-wrap {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: 72px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  overflow-x: hidden;
  /* 顶部安全区（2026-10-31 真机反馈：pad 横屏 edge-to-edge 下状态栏盖住 app 标）：
     --m-inset-top 由 MainActivity 实测注入（dev/桌面 env() 恒 0），与 navbar 同源 */
  padding-top: var(--m-inset-top);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.m-rail__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 0 10px;
  flex-shrink: 0;
}
.m-rail__logo img {
  width: 30px;
  height: 30px;
  display: block;
}
.m-rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 6px;
}
.m-rail__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-2);
  text-decoration: none;
  border-radius: 12px;
  transition: color 0.25s ease, background-color 0.25s ease;
}
.m-rail__item--active {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}
.m-rail__icon {
  font-size: 20px;
  line-height: 1.2;
}
</style>
