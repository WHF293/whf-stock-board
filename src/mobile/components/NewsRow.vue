<script setup lang="ts">
import { formatNewsTime } from '../utils/format';
import type { HotNewsItem } from '../../api/news.api';

/**
 * 新闻行（移动端通用列表行）：标题两行截断 + 来源/时间 + 缩略图（无图省略）
 * 点击整行上抛 open，由页面决定打开方式（原文 webview 容器 / 站内搜索页）
 */
defineProps<{ item: HotNewsItem }>();

const emit = defineEmits<{ open: [item: HotNewsItem] }>();
</script>

<template>
  <div class="m-news-row" @click="emit('open', item)">
    <div class="m-news-row__main">
      <div class="m-news-row__title">{{ item.title }}</div>
      <div class="m-news-row__meta">
        <span class="m-news-row__src">{{ item.media || '未知来源' }}</span>
        <span>{{ formatNewsTime(item.ctime) }}</span>
      </div>
    </div>
    <img
      v-if="item.img"
      :src="item.img"
      class="m-news-row__thumb"
      loading="lazy"
      referrerpolicy="no-referrer"
      alt=""
    />
  </div>
</template>
