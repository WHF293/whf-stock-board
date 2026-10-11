<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { APP_VERSION, RELEASES_URL } from '../../common/constants/app-info.constants.ts';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  MOBILE_DISCLAIMER,
  MOBILE_POLLING_OPTIONS,
} from '../constants';
import {
  mobileCacheClear,
  mobileCacheSize,
} from '../cache';
import {
  readMobilePollingMs,
  writeMobilePollingMs,
} from '../composables/use-mobile-polling';

/**
 * 设置页（移动端 v1）：四组五项
 * 通用（检查更新）/ 数据（轮询间隔、清理缓存）/ 关于（免责声明、数据来源说明）。
 * 全部选择即时生效并持久化。
 */

const router = useRouter();

// ---- 检查更新 ----

type UpdateState = 'idle' | 'checking' | 'latest' | 'available';

const updateState = ref<UpdateState>('idle');
const latestTag = ref('');

/**
 * 比较语义化版本（x.y.z 逐段数值比较）
 * @param a 版本 a
 * @param b 版本 b
 * @returns a > b 返回正数
 */
const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/** 检查更新：比对 GitHub Release 最新 tag 与内置 APP_VERSION */
const checkUpdate = async (): Promise<void> => {
  if (updateState.value === 'checking') return;
  updateState.value = 'checking';
  try {
    const response = await fetch(
      'https://api.github.com/repos/WHF293/whf-stock-board/releases/latest',
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!response.ok) throw new Error(String(response.status));
    const payload = (await response.json()) as { tag_name?: string };
    latestTag.value = (payload.tag_name ?? '').replace(/^v/, '');
    updateState.value =
      latestTag.value !== '' && compareVersions(latestTag.value, APP_VERSION) > 0
        ? 'available'
        : 'latest';
  } catch {
    updateState.value = 'latest';
    showToast('检查失败，请稍后重试');
  }
};

/** 跳转 Release 页下载新版 APK（系统浏览器） */
const downloadLatest = (): void => {
  void openUrl(RELEASES_URL).catch(() => window.open(RELEASES_URL, '_blank'));
};

// ---- 轮询间隔 ----

const pollingMs = ref(readMobilePollingMs());

const selectPolling = (value: number): void => {
  pollingMs.value = value;
  writeMobilePollingMs(value);
};

// ---- 清理缓存 ----

const cacheSizeText = computed(() => {
  const size = mobileCacheSize();
  return `${(size / 1024).toFixed(1)} KB`;
});

const clearCache = async (): Promise<void> => {
  try {
    await showConfirmDialog({
      title: '清理数据缓存',
      message: `将清除榜单与新闻快照（${cacheSizeText.value}），清除后首次进入页面会重新加载。`,
    });
  } catch {
    return; // 用户取消
  }
  mobileCacheClear();
  showToast('已清理');
};

// ---- 关于 ----

const expanded = ref<'none' | 'disclaimer' | 'source'>('none');

const toggleAbout = (key: 'disclaimer' | 'source'): void => {
  expanded.value = expanded.value === key ? 'none' : key;
};
</script>

<template>
  <div>
    <van-nav-bar title="设置" class="m-nav" fixed placeholder safe-area-inset-top left-arrow @click-left="router.back()" />

    <div class="m-set-label">通用</div>
    <div class="m-set-group">
      <div class="m-set-row">
        <div class="m-set-row__ic">⭳</div>
        <div class="m-set-row__t">
          检查更新
          <span class="d">自动比对 GitHub Release 最新版本</span>
        </div>
        <span class="m-set-row__extra">v{{ APP_VERSION }}</span>
        <button class="m-mini-btn" @click="checkUpdate">
          {{ updateState === 'checking' ? '检查中…' : '检查更新' }}
        </button>
      </div>
      <div v-if="updateState === 'available'" class="m-set-row" style="border-bottom: 0">
        <div class="m-set-row__t">
          发现新版本 v{{ latestTag }}
          <span class="d">前往 Release 页下载新 APK，手动安装即可升级</span>
        </div>
        <button class="m-mini-btn" @click="downloadLatest">下载 APK</button>
      </div>
      <div v-else-if="updateState === 'latest'" class="m-set-row" style="border-bottom: 0">
        <div class="m-set-row__t"><span class="d">当前已是最新版本</span></div>
      </div>
    </div>

    <div class="m-set-label">数据</div>
    <div class="m-set-group">
      <div class="m-set-row" style="border-bottom: 1px solid var(--color-border)">
        <div class="m-set-row__ic">⏱</div>
        <div class="m-set-row__t">
          轮询间隔
          <span class="d">前台自动刷新周期 · 高频档可能触发上游限流</span>
        </div>
        <span class="m-set-row__extra m-num">
          {{ MOBILE_POLLING_OPTIONS.find((o) => o.value === pollingMs)?.label }}
        </span>
      </div>
      <div style="padding: 2px 16px 13px">
        <div class="m-seg">
          <button
            v-for="option in MOBILE_POLLING_OPTIONS"
            :key="option.value"
            class="m-seg__opt"
            :class="{ 'm-seg__opt--on': pollingMs === option.value }"
            @click="selectPolling(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <button class="m-set-row" @click="clearCache">
        <div class="m-set-row__ic">🗑</div>
        <div class="m-set-row__t">
          清理数据缓存
          <span class="d">榜单与新闻快照 · 30 分钟 TTL · 持久化</span>
        </div>
        <span class="m-set-row__extra">{{ cacheSizeText }}</span>
      </button>
    </div>

    <div class="m-set-label">关于</div>
    <div class="m-set-group">
      <button class="m-set-row" @click="toggleAbout('disclaimer')">
        <div class="m-set-row__ic">§</div>
        <div class="m-set-row__t">免责声明</div>
        <span class="m-set-row__arr">›</span>
      </button>
      <div v-if="expanded === 'disclaimer'" class="m-about-body">{{ MOBILE_DISCLAIMER }}</div>
      <button class="m-set-row" @click="toggleAbout('source')">
        <div class="m-set-row__ic">ℹ</div>
        <div class="m-set-row__t">数据来源说明</div>
        <span class="m-set-row__arr">›</span>
      </button>
      <div v-if="expanded === 'source'" class="m-about-body">
        行情与资讯数据来自新浪财经 / 东方财富 / 同花顺 / 澎湃新闻 / 财联社 / 通达信 / 雪球等第三方公开接口，
        经应用内直连获取并保留来源标注；数据可能存在延迟或缺失，以各官方渠道为准。
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-about-body {
  padding: 10px 16px 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-text-2);
  background: var(--color-surface);
}
</style>
