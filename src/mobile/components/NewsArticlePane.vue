<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * 新闻原文阅读窗格（大屏 ≥840px 热点新闻页右栏，2026-10-28 新增）
 *
 * 复刻 MobileArticle 的应用内 webview 容器逻辑（iframe + 近似进度条 + 系统浏览器
 * 兜底），但形态为内嵌窗格而非整页容器：大屏上左侧列表右侧原文同屏主从布局，
 * 点击列表行就地换稿，不再跳 /article 路由。
 * article 为 null 时显示占位态。
 */

/** 窗格加载目标（url 为空串 = 占位态） */
export interface NewsArticlePaneTarget {
  url: string;
  title: string;
  media: string;
}

const props = defineProps<{ article: NewsArticlePaneTarget | null }>();

const emit = defineEmits<{ close: [] }>();

/** 标题（窗格头部，限 24 字截断——窗格比整页容器宽，截断阈值放宽） */
const title = computed(() => {
  const raw = props.article?.title ?? '';
  return raw.length > 24 ? `${raw.slice(0, 24)}…` : raw || '原文';
});

const progress = ref(8);
const loaded = ref(false);
const slowHint = ref(false);

let progressTimer: number | undefined;
let slowTimer: number | undefined;

/** 进度近似推进：300ms 一步、步长递减，上限 90%（等待 iframe onload） */
const startProgress = (): void => {
  stopProgress();
  progress.value = 8;
  loaded.value = false;
  slowHint.value = false;
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
  progressTimer = undefined;
  slowTimer = undefined;
};

const onIframeLoad = (): void => {
  loaded.value = true;
  progress.value = 100;
  stopProgress();
};

/** 系统浏览器兜底（容器被目标站拒嵌 / 排版异常时的出口） */
const openInBrowser = (): void => {
  const url = props.article?.url;
  if (!url) return;
  void openUrl(url).catch(() => window.open(url, '_blank'));
};

/** 换稿 / 清空（含组件卸载）都要停进度计时器；同 url 重挂由 :key 保证 */
watch(
  () => props.article,
  (article) => {
    if (article) startProgress();
    else stopProgress();
  },
  { immediate: true },
);

onUnmounted(stopProgress);
</script>

<template>
  <div class="m-news-pane">
    <template v-if="article">
      <div class="m-news-pane__head">
        <div class="m-news-pane__title">
          <span class="m-news-pane__media">{{ article.media || '未知来源' }}</span>
          {{ title }}
        </div>
        <div class="m-news-pane__acts">
          <van-icon name="link-o" size="17" @click="openInBrowser" />
          <van-icon name="cross" size="17" @click="emit('close')" />
        </div>
      </div>
      <div class="m-news-pane__bar">
        <i :style="{ width: `${progress}%`, opacity: loaded ? 0 : 1 }"></i>
      </div>
      <div v-if="slowHint && !loaded" class="m-news-pane__hint">
        该站点加载较慢或限制内嵌展示，可点右上角在系统浏览器打开
      </div>
      <iframe
        :key="article.url"
        :src="article.url"
        class="m-news-pane__frame"
        title="原文"
        referrerpolicy="no-referrer-when-downgrade"
        @load="onIframeLoad"
      ></iframe>
    </template>
    <div v-else class="m-news-pane__empty">
      <van-icon name="description-o" />
      <div>点击左侧新闻，在此阅读原文</div>
    </div>
  </div>
</template>

<style scoped>
.m-news-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-surface);
}
.m-news-pane__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.m-news-pane__title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-news-pane__media {
  font-weight: 500;
  font-size: 12px;
  color: var(--color-text-2);
  margin-right: 8px;
}
.m-news-pane__acts {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--color-text-2);
  flex-shrink: 0;
}
.m-news-pane__bar {
  height: 3px;
  background: transparent;
  flex-shrink: 0;
  position: relative;
}
.m-news-pane__bar i {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  display: block;
  background: var(--color-primary);
  transition: width 0.3s ease, opacity 0.3s ease;
}
.m-news-pane__hint {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--color-warning, #b45309);
  background: var(--color-primary-soft);
  flex-shrink: 0;
}
.m-news-pane__frame {
  flex: 1;
  min-height: 0;
  border: 0;
  background: var(--color-surface);
}
.m-news-pane__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-text-3);
  font-size: 13px;
}
.m-news-pane__empty .van-icon {
  font-size: 34px;
  color: var(--color-text-3);
  opacity: 0.6;
}
</style>
