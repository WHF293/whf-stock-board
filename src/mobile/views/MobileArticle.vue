<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * 原文阅读页（应用内 webview 容器）
 *
 * 需求稿 v1.1：点击新闻条目 → 新开容器加载原文页，保留应用内导航；
 * nav 下 3px 进度条反馈加载，右上 ↗ 系统浏览器兜底（部分站点禁 iframe 时是唯一出口，
 * 见开发方案「交互实现要点」的预研项说明）。
 * 进度条为无真实回调下的近似推进：到 90% 前缓慢爬升，iframe onload 后补满并隐藏。
 */

const route = useRoute();
const router = useRouter();

const url = computed(() => String(route.query.url ?? ''));
const title = computed(() => {
  const raw = String(route.query.title ?? '原文');
  return raw.length > 18 ? `${raw.slice(0, 18)}…` : raw;
});

const progress = ref(8);
const loaded = ref(false);
const slowHint = ref(false);

let progressTimer: number | undefined;
let slowTimer: number | undefined;

/** 进度近似推进：300ms 一步、步长递减，上限 90%（等待 iframe onload） */
const startProgress = (): void => {
  progressTimer = window.setInterval(() => {
    progress.value = Math.min(progress.value + Math.max(1, (90 - progress.value) / 8), 90);
  }, 300);
  slowTimer = window.setTimeout(() => {
    if (!loaded.value) slowHint.value = true;
  }, 8000);
};

const stopProgress = (): void => {
  if (progressTimer !== undefined) window.clearInterval(progressTimer);
  if (slowTimer !== undefined) window.clearTimeout(slowTimer);
};

const onIframeLoad = (): void => {
  loaded.value = true;
  progress.value = 100;
  stopProgress();
};

/** 系统浏览器兜底（容器被目标站拒嵌 / 排版异常时的出口） */
const openInBrowser = (): void => {
  if (url.value === '') return;
  void openUrl(url.value).catch(() => window.open(url.value, '_blank'));
};

const goBack = (): void => {
  // 容器内返回：先走网页历史回退（同源可控），无历史则关闭容器回列表
  router.back();
};

onMounted(() => {
  if (url.value !== '') startProgress();
});

onUnmounted(() => {
  stopProgress();
});
</script>

<template>
  <div class="m-article">
    <van-nav-bar
      class="m-nav"
      fixed
      placeholder
      safe-area-inset-top
      left-arrow
      :title="title"
      @click-left="goBack"
    >
      <template #right>
        <van-icon name="link-o" size="18" @click="openInBrowser" />
      </template>
    </van-nav-bar>

    <div v-if="url !== ''" class="m-wv-bar">
      <i :style="{ width: `${progress}%`, opacity: loaded ? 0 : 1 }"></i>
    </div>

    <div v-if="slowHint && !loaded" class="m-wv-hint">
      该站点加载较慢或限制内嵌展示，可点右上角在系统浏览器打开
    </div>

    <iframe
      v-if="url !== ''"
      :src="url"
      class="m-wv-frame"
      title="原文"
      referrerpolicy="no-referrer-when-downgrade"
      @load="onIframeLoad"
    ></iframe>

    <div v-if="url === ''" class="m-empty">缺少原文链接</div>
  </div>
</template>

<style scoped>
.m-article {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}
.m-wv-frame {
  flex: 1;
  border: 0;
  background: var(--color-surface);
}
</style>
