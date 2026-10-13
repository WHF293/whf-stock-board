<script setup lang="ts">
import MenuIcon from '../components/ui/MenuIcon.vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  DAPANYUNTU_EMBED_URL,
  DAPANYUNTU_SITE_URL,
} from '../../common/constants/panorama.constants.ts';

/**
 * 大盘云图页（原「行情全景-大盘云图」tab，2026-10-13 独立成页）
 *
 * iframe 直嵌 dapanyuntu.com：第三方 Next.js 站点（Cloudflare 托管），
 * 响应头无 X-Frame-Options / CSP frame-ancestors，可被安全嵌入（2026-10-13 实测）；
 * 数据与交互全部由对方页面自管，本页不取数、不代理、不做任何注入。
 * 顶部提示条声明内容来源并提供原站跳转入口（PC 惯例 window.open noopener）。
 * 若对方日后加嵌入限制或 DNS 不可达，此处表现为空白/错误框——届时下线该页即可。
 */

/** 系统默认浏览器打开原站（Tauri plugin-opener；纯浏览器 dev 环境无 runtime 时兜底新标签页） */
const openSite = (): void => {
  void openUrl(DAPANYUNTU_SITE_URL).catch(() => window.open(DAPANYUNTU_SITE_URL, '_blank'));
};
</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-2">
    <!-- 来源提示条：声明第三方嵌入 + 原站跳转入口 -->
    <div
      class="flex shrink-0 items-center justify-between gap-3 rounded-lg bg-flat-weak px-3 py-1.5"
    >
      <span class="truncate text-xs text-text-tertiary">
        本页为第三方站点「大盘云图」的嵌入展示（dapanyuntu.com），数据与交互均由原站提供
      </span>
      <button
        type="button"
        class="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        data-track="HEATMAP_OPEN_SITE"
        @click="openSite"
      >
        访问原站
        <MenuIcon name="expand" :size="12" />
      </button>
    </div>

    <!-- 云图 iframe：撑满剩余高度 -->
    <div class="min-h-0 flex-1 overflow-hidden rounded-xl border border-flat-weak bg-surface">
      <iframe
        :src="DAPANYUNTU_EMBED_URL"
        title="大盘云图"
        class="h-full w-full border-0"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        allow="fullscreen"
      ></iframe>
    </div>
  </div>
</template>
