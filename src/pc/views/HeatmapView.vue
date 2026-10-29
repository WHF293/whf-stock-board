<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import NoticeBar from '../components/ui/NoticeBar.vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  DAPANYUNTU_EMBED_URL,
  DAPANYUNTU_SITE_URL,
  HEATMAP_THEME_MESSAGE_SOURCE,
} from '../../common/constants/panorama.constants.ts';
import { useTheme } from '../../common/composables/use-theme.ts';

/**
 * 大盘云图页（原「行情全景-大盘云图」tab，2026-10-13 独立成页）
 *
 * iframe 直嵌 dapanyuntu.com：第三方 Next.js 站点（Cloudflare 托管），
 * 响应头无 X-Frame-Options / CSP frame-ancestors，可被安全嵌入（2026-10-13 实测）；
 * 数据与交互全部由对方页面自管，本页不取数、不代理。
 * 顶部提示条声明内容来源并提供原站跳转入口（PC 惯例 window.open noopener）。
 * 若对方日后加嵌入限制或 DNS 不可达，此处表现为空白/错误框——届时下线该页即可。
 *
 * 主题跟随（2026-10-13）：跨域 iframe 无法由父页面直接注入脚本，依赖 Tauri 侧
 * initialization_script_for_all_frames 在第三方页面每个 document 创建时注入桥
 * （见 src-tauri/src/lib.rs HEATMAP_THEME_INIT_SCRIPT，纯浏览器 dev / 移动端无此
 * 机制，postMessage 静默失效）。本页职责：
 * - 收到 iframe 的 ready 消息即回发当前主题（早于 load 完成首次同步）；
 * - iframe load 兜底重发一次（防 ready 消息早于本组件监听注册而丢失）；
 * - 主应用明暗切换时实时推送。
 * 协议消息两端约定 source = HEATMAP_THEME_MESSAGE_SOURCE，缺省直接丢弃。
 */

/** 系统默认浏览器打开原站（Tauri plugin-opener；纯浏览器 dev 环境无 runtime 时兜底新标签页） */
const openSite = (): void => {
  void openUrl(DAPANYUNTU_SITE_URL).catch(() => window.open(DAPANYUNTU_SITE_URL, '_blank'));
};

const { isDark } = useTheme();

const iframeRef = ref<HTMLIFrameElement | null>(null);

/** 把当前宿主主题推送给 iframe（contentWindow 未就绪时静默跳过） */
const syncIframeTheme = (): void => {
  const contentWindow = iframeRef.value?.contentWindow;
  if (!contentWindow) return;
  contentWindow.postMessage(
    { source: HEATMAP_THEME_MESSAGE_SOURCE, type: 'heatmap-theme', dark: isDark.value },
    '*',
  );
};

/**
 * iframe 注入脚本就绪信号：回发当前主题完成首次同步
 * @param event 宿主窗口收到的 postMessage 事件
 */
const onHostMessage = (event: MessageEvent): void => {
  const data = event.data as { source?: unknown; type?: unknown } | null;
  if (
    !data ||
    data.source !== HEATMAP_THEME_MESSAGE_SOURCE ||
    data.type !== 'heatmap-theme-ready' ||
    event.source !== iframeRef.value?.contentWindow
  ) {
    return;
  }
  syncIframeTheme();
};

window.addEventListener('message', onHostMessage);
watch(isDark, syncIframeTheme);
onBeforeUnmount(() => {
  window.removeEventListener('message', onHostMessage);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <!-- 来源提示条：声明第三方嵌入 + 原站跳转入口（NoticeBar 统一公告条样式） -->
    <NoticeBar
      text="本页为第三方站点「大盘云图」的嵌入展示（dapanyuntu.com），数据与交互均由原站提供"
      class="shrink-0"
    >
      <template #action>
        <button
          type="button"
          class="flex shrink-0 items-center gap-1 self-start text-xs font-medium text-primary hover:underline"
          data-track="HEATMAP_OPEN_SITE"
          @click="openSite"
        >
          访问原站
          <MenuIcon name="expand" :size="12" />
        </button>
      </template>
    </NoticeBar>

    <!-- 云图 iframe：撑满剩余高度；load 兜底重发主题（防 ready 消息早于监听注册丢失） -->
    <div class="min-h-0 flex-1 overflow-hidden rounded-xl border border-flat-weak bg-surface">
      <iframe
        ref="iframeRef"
        :src="DAPANYUNTU_EMBED_URL"
        title="大盘云图"
        class="h-full w-full border-0"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        allow="fullscreen"
        @load="syncIframeTheme"
      ></iframe>
    </div>
  </div>
</template>
