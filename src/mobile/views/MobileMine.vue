<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { openUrl } from '@tauri-apps/plugin-opener';
import { APP_VERSION, RELEASES_URL, SITE_URL } from '../../common/constants/app-info.constants.ts';
import {
  MOBILE_PLUGINS_PATH,
  MOBILE_DISCLAIMER,
  MOBILE_POLLING_OPTIONS,
} from '../constants';
import { THEME_COLOR_OPTIONS } from '../../common/constants/theme-color.constants.ts';
import type { ThemeColor } from '../../common/constants/theme-color.constants.ts';
import { TREND_THEME_OPTIONS } from '../../common/constants/trend-theme.constants.ts';
import type { TrendTheme } from '../../common/constants/trend-theme.constants.ts';
import { useSettingsStore } from '../../common/stores/settings';
import {
  readMobileColorScheme,
  writeMobileColorScheme,
  type MobileColorScheme,
} from '../composables/use-mobile-color-scheme';
import { mobileCacheClear, mobileCacheSize } from '../cache';
import { readMobilePollingMs, writeMobilePollingMs } from '../composables/use-mobile-polling';
import { useMobileUpdate } from '../composables/use-mobile-update';
import { isDebugMode, setDebugMode } from '../debug/debug-mode';
import { DEBUG_TAP_COUNT, DEBUG_TAP_WINDOW_MS } from '../constants';

/**
 * 我的（移动端）：应用信息卡 + 设置项全部平铺（2026-10-11 王总指示，原「设置」二级页内容并入）。
 * 分组沿用原设置页：外观（深色模式 / 主题色 / 涨跌颜色）、通用（官方网站 / 检查更新）、
 * 数据（轮询间隔 / 清理缓存）、关于（免责声明 / 数据来源说明）。全部选择即时生效并持久化。
 * 深色模式与主题色行内直切；涨跌配色行内展开；自定义取色经主题色行末位彩点进 /theme 子页。
 */

const router = useRouter();
const settingsStore = useSettingsStore();

// ---- 调试模式：应用信息卡连点 10 次切换（2026-10-12 王总需求） ----

/** 近次点按时间戳（滑动窗口，窗口外过期剔除） */
const debugTapTimes: number[] = [];

/**
 * 应用信息卡点按处理：DEBUG_TAP_WINDOW_MS 内累计 DEBUG_TAP_COUNT 次
 * 切换调试模式，触发时震动 + toast 反馈
 */
const onHeroTap = (): void => {
  const now = Date.now();
  debugTapTimes.push(now);
  while (debugTapTimes.length > 0 && now - debugTapTimes[0] > DEBUG_TAP_WINDOW_MS) {
    debugTapTimes.shift();
  }
  if (debugTapTimes.length < DEBUG_TAP_COUNT) return;
  debugTapTimes.length = 0;
  setDebugMode(!isDebugMode.value);
  navigator.vibrate?.(30);
  showToast(isDebugMode.value ? '调试模式已开启' : '调试模式已关闭');
};

const goTheme = (): void => {
  void router.push('/theme');
};

/** 进插件管理页（2026-10-30 移动端插件体系 P2 入口） */
const goPlugins = (): void => {
  void router.push(MOBILE_PLUGINS_PATH);
};

// ---- 外观：深色模式（行内分段直切，与主题设置页共享同一持久化） ----

const colorScheme = ref<MobileColorScheme>(readMobileColorScheme());

const colorSchemeOptions: readonly { label: string; value: MobileColorScheme }[] = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '跟随', value: 'auto' },
];

const selectColorScheme = (scheme: MobileColorScheme): void => {
  colorScheme.value = scheme;
  writeMobileColorScheme(scheme);
};

// ---- 外观：主题色（行内色点直切；末位彩点进阶到主题设置页取自定义色） ----

/**
 * 当前主题色对应的展示名（自定义时显示色值）
 * @returns 主题色中文名，自定义主题返回色值
 */
const themeColorName = (): string =>
  THEME_COLOR_OPTIONS.find((option) => option.value === settingsStore.themeColor)?.label ??
  settingsStore.customThemeColor;

const selectThemeColor = (color: ThemeColor): void => {
  settingsStore.setThemeColor(color);
};

// ---- 外观：涨跌颜色设置（行内点击展开后选择，不进二级页） ----

const trendOpen = ref(false);

const toggleTrend = (): void => {
  trendOpen.value = !trendOpen.value;
};

/**
 * 当前涨跌配色展示名
 * @returns 涨跌配色方案中文名（如「红涨绿跌」）
 */
const trendName = (): string =>
  TREND_THEME_OPTIONS.find((option) => option.value === settingsStore.trendTheme)?.label ?? '';

const selectTrendTheme = (theme: TrendTheme): void => {
  settingsStore.setTrendTheme(theme);
};

// ---- 通用：检查更新（直下 APK + 拉起安装，链路共用见 use-mobile-update） ----

const { updateState, latestTag, progress, checkUpdate, downloadLatest } = useMobileUpdate(
  (text) => showToast(text),
  () => void openUrl(RELEASES_URL).catch(() => window.open(RELEASES_URL, '_blank')),
);

/** 打开官网（软件文档 / 下载中心 / 插件生态，系统浏览器） */
const openSite = (): void => {
  void openUrl(SITE_URL).catch(() => window.open(SITE_URL, '_blank'));
};

// ---- 数据：轮询间隔 ----

const pollingMs = ref(readMobilePollingMs());

const selectPolling = (value: number): void => {
  pollingMs.value = value;
  writeMobilePollingMs(value);
};

// ---- 数据：清理缓存 ----

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

// ---- 关于：免责声明 / 数据来源说明（行内展开） ----

const expanded = ref<'none' | 'disclaimer' | 'source'>('none');

const toggleAbout = (key: 'disclaimer' | 'source'): void => {
  expanded.value = expanded.value === key ? 'none' : key;
};
</script>

<template>
  <div class="m-tab-safe">
    <!-- 2026-10-20 起回归 TabBar 第五主 Tab（此前 2026-10-12 曾移出、由首页 navbar logo 进入）；
         主 Tab 无返回键 -->
    <van-nav-bar title="我的" class="m-nav" safe-area-inset-top />

    <!-- 应用信息卡：logo 用软件 logo（public/favicon.svg，与 PC TitleBar 同源），2026-10-11 名称定为「股票看板」；
         连点 10 次（3s 窗口）切换调试模式 -->
    <div class="m-mine-hero" @click="onHeroTap">
      <img class="m-app-logo" src="/favicon.svg" alt="股票看板" />
      <div>
        <div class="m-mine-hero__t">股票看板</div>
        <div class="m-mine-hero__d">
          v{{ APP_VERSION }} <span class="m-mini-tag">APK 直装版</span>
          <span v-if="isDebugMode" class="m-mini-tag">调试</span>
        </div>
      </div>
    </div>

    <!-- 外观（原「我的」组） -->
    <div class="m-set-label">外观</div>
    <div class="m-set-group">
      <!-- 深色模式：行内分段直切 -->
      <div class="m-set-row">
        <div class="m-set-row__ic">◐</div>
        <div class="m-set-row__t">
          深色模式
          <span class="d">浅色 / 深色 / 跟随系统</span>
        </div>
        <div class="m-seg m-seg--mini">
          <button
            v-for="option in colorSchemeOptions"
            :key="option.value"
            class="m-seg__opt"
            :class="{ 'm-seg__opt--on': colorScheme === option.value }"
            @click="selectColorScheme(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <!-- 主题色：行内色点直切，末位彩点跳主题设置页取自定义色 -->
      <div class="m-set-row">
        <div class="m-set-row__ic">✦</div>
        <div class="m-set-row__t">
          主题色
          <span class="d">当前 {{ themeColorName() }}</span>
        </div>
        <div class="m-theme-dots">
          <button
            v-for="option in THEME_COLOR_OPTIONS"
            :key="option.value"
            class="m-theme-dot"
            :class="{ 'm-theme-dot--on': settingsStore.themeColor === option.value }"
            :style="option.value === 'custom' ? undefined : { background: option.swatch }"
            :aria-label="option.label"
            @click="option.value === 'custom' ? goTheme() : selectThemeColor(option.value)"
          >
            <span v-if="option.value === 'custom'" class="m-theme-dot__rainbow" />
            <span v-else-if="settingsStore.themeColor === option.value" class="m-theme-dot__check">✓</span>
          </button>
        </div>
      </div>
      <!-- 涨跌颜色设置：行内展开选择（免责声明同款交互），不进二级页 -->
      <button class="m-set-row" @click="toggleTrend">
        <div class="m-set-row__ic">⚙</div>
        <div class="m-set-row__t">
          涨跌颜色设置
          <span class="d">当前 {{ trendName() }} · 点击{{ trendOpen ? '收起' : '展开' }}</span>
        </div>
        <span class="m-set-row__arr">{{ trendOpen ? '⌄' : '›' }}</span>
      </button>
      <div v-if="trendOpen" class="m-trend-body">
        <div class="m-trend-cards">
          <button
            v-for="option in TREND_THEME_OPTIONS"
            :key="option.value"
            class="m-trend-card"
            :class="{ 'm-trend-card--on': settingsStore.trendTheme === option.value }"
            @click="selectTrendTheme(option.value)"
          >
            <span class="m-trend-card__nm">{{ option.label }}</span>
            <span class="m-trend-card__pill" :style="{ background: `${option.upSwatch}22`, color: option.upSwatch }">+2.31%</span>
            <span class="m-trend-card__pill" :style="{ background: `${option.downSwatch}22`, color: option.downSwatch }">-1.05%</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 通用（原设置页分组沿用） -->
    <div class="m-set-label">通用</div>
    <div class="m-set-group">
      <button class="m-set-row" @click="goPlugins">
        <div class="m-set-row__ic">⬡</div>
        <div class="m-set-row__t">
          插件
          <span class="d">插件市场 · 启停与卸载管理</span>
        </div>
        <span class="m-set-row__arr">›</span>
      </button>
      <button class="m-set-row" @click="openSite">
        <div class="m-set-row__ic">⌂</div>
        <div class="m-set-row__t">
          官方网站
          <span class="d">软件文档 · 下载中心 · 插件生态</span>
        </div>
        <span class="m-set-row__extra">↗</span>
      </button>
      <div class="m-set-row">
        <div class="m-set-row__ic">⭳</div>
        <div class="m-set-row__t">
          检查更新
          <span class="d">自动比对 GitHub Release 最新版本</span>
        </div>
        <span class="m-set-row__extra">v{{ APP_VERSION }}</span>
        <button class="m-mini-btn" :disabled="updateState === 'downloading'" @click="checkUpdate">
          {{ updateState === 'checking' ? '检查中…' : '检查更新' }}
        </button>
      </div>
      <div v-if="updateState === 'available'" class="m-set-row" style="border-bottom: 0">
        <div class="m-set-row__t">
          发现新版本 v{{ latestTag }}
          <span class="d">点「更新」直接下载 APK，完成后自动打开安装界面</span>
        </div>
        <button class="m-mini-btn" @click="downloadLatest">更新</button>
      </div>
      <div v-else-if="updateState === 'downloading'" class="m-set-row" style="border-bottom: 0">
        <div class="m-set-row__t">
          正在下载新版本
          <span class="d">下载完成后将自动打开系统安装界面，请留意系统弹窗</span>
        </div>
        <span class="m-set-row__extra">{{ progress }}%</span>
      </div>
      <div v-else-if="updateState === 'latest'" class="m-set-row" style="border-bottom: 0">
        <div class="m-set-row__t"><span class="d">当前已是最新版本</span></div>
      </div>
    </div>

    <!-- 数据（原设置页分组沿用） -->
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

    <!-- 关于（原设置页分组沿用） -->
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

    <div class="m-foot-note">{{ MOBILE_DISCLAIMER }}</div>
  </div>
</template>

<style scoped>
.m-mine-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
  padding: 20px 16px;
  background: var(--color-surface);
  border-radius: 12px;
  margin-inline: 12px;
}
.m-app-logo {
  width: 54px;
  height: 54px;
  border-radius: 14px;
  flex-shrink: 0;
  box-shadow: var(--m-card-shadow);
}
.m-mine-hero__t { font-size: 17px; font-weight: 800; line-height: 1.3; }
.m-mine-hero__d {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--color-text-3);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.m-mini-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--color-primary-weak);
  color: var(--color-primary);
}
/* 涨跌颜色设置行内展开体（免责声明 m-about-body 同构） */
.m-trend-body { padding: 12px 16px 14px; background: var(--color-surface); }
/* 主题色行内色点：22px 圆点，选中描边 + 白勾 */
.m-theme-dots { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.m-theme-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
}
.m-theme-dot--on { border-color: var(--color-text); }
.m-theme-dot__check { font-size: 10px; color: #fff; font-weight: 800; line-height: 1; }
.m-theme-dot__rainbow {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(#ff4134, #f97316, #f59e0b, #10b981, #0ea5e9, #8b5cf6, #ff4134);
}
/* 关于行内展开体（自 MobileSettings 迁入） */
.m-about-body {
  padding: 10px 16px 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-text-2);
  background: var(--color-surface);
}
</style>
