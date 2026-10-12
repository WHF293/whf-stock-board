<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useDocumentThemeSync } from '../common/composables/use-document-theme';
import MobileTabBar from './components/MobileTabBar.vue';
import DebugOverlay from './debug/DebugOverlay.vue';
import { isDebugMode } from './debug/debug-mode';
import { MOBILE_TAB_PATHS } from './router';

// 主题三轴落 <html>（明暗 class / data-theme / data-trend），与桌面共用同一持久化；
// 设置 store 经 localStorage 整包共享，跨端切换后水合正确
useDocumentThemeSync();

// ---------- 页面切换（对齐 PC MainLayout 的 KeepAlive + 方向进入动画） ----------

const route = useRoute();

/**
 * 当前页面的进入动画类名（空串 = 本轮不播放）
 *
 * 为什么不用 `<Transition mode="out-in">`：out-in 必须先等旧页离场动画回调整完
 * 才会插入新页；一旦该回调没触发（快速连点、WebView 窗口被遮挡时节流动画），
 * 新页就永远不会插入 —— 表现为「内容区空白，且怎么切路由都无法恢复」。
 * keyframes 在元素插入时直接播放，没有离场/进入状态机，不存在卡死路径。
 * 动画类定义复用 theme.css 的 .page-anim-forward / .page-anim-back（PC 同款）。
 */
const pageAnim = ref('');

/** 页面滑入方向：前进（右侧滑入）/ 后退（左侧滑入） */
type PageAnim = '' | 'page-anim-forward' | 'page-anim-back';

/**
 * 路由在「前进 / 后退」判定序中的下标：主 Tab 按底部 TabBar 顺序
 * （MOBILE_TAB_PATHS 声明序），二级页一律视为最末 ——
 * 任意页进二级页 = 前进，二级页返回 = 后退；Tab 之间按下标比方向
 * @param path 路由路径
 * @returns 判定序下标
 */
const animOrderOf = (path: string): number => {
  const index = MOBILE_TAB_PATHS.indexOf(path);
  return index >= 0 ? index : MOBILE_TAB_PATHS.length;
};

watch(
  () => route.path,
  (to, from) => {
    const next: PageAnim =
      animOrderOf(to) < animOrderOf(from) ? 'page-anim-back' : 'page-anim-forward';
    // KeepAlive 复用已缓存页面的 DOM 时，同一个元素上的 CSS 动画不会自动重播；
    // 先清空类名、下一帧再赋回，强制动画重新触发
    pageAnim.value = '';
    void nextTick(() => {
      pageAnim.value = next;
    });
  },
);
</script>

<template>
  <div class="m-root">
    <!-- keep-alive + 按路径键控（对齐 PC MainLayout）：
         缓存按完整路径区分，/stock/:code、/rank/:rank 这类同组件带参路由
         各自独立实例，回退恢复原页状态；隐藏页轮询经 onDeactivated 停止
         （use-mobile-polling 已内置）；进入动画由 pageAnim 类名驱动 -->
    <router-view v-slot="{ Component, route: routeRecord }">
      <keep-alive>
        <component :is="Component" :key="routeRecord.path" :class="pageAnim" />
      </keep-alive>
    </router-view>
    <MobileTabBar />
    <!-- 调试模式覆盖层（「我的」页应用卡连点 10 次开启）：悬浮球 + 网络请求面板，
         放 router-view 之外，任意页面可唤起 -->
    <DebugOverlay v-if="isDebugMode" />
  </div>
</template>
