<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { APP_VERSION } from '../../common/constants/app-info.constants.ts';
import { MOBILE_DISCLAIMER } from '../constants';
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

/**
 * 我的（移动端）：应用信息卡 + 主题快捷两行（深色模式 / 主题色）+ 涨跌颜色设置入口 + 底部数据声明。
 * 深色模式与主题色原在同一「主题设置」入口里，2026-10-11 王总指示拆为两个独立选项，
 * 均行内直接切换；涨跌配色走「涨跌颜色设置」子页，自定义取色经主题色行末位彩点进入。
 */

const router = useRouter();
const settingsStore = useSettingsStore();

const goSettings = (): void => {
  void router.push('/settings');
};
const goTheme = (): void => {
  void router.push('/theme');
};

// ---- 深色模式（行内分段直切，与主题设置页共享同一持久化） ----

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

// ---- 主题色（行内色点直切；末位彩点进阶到主题设置页取自定义色） ----

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

// ---- 涨跌颜色设置（免责声明同款：行内点击展开后选择，不进二级页） ----

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
</script>

<template>
  <div class="m-tab-safe">
    <van-nav-bar title="我的" class="m-nav" safe-area-inset-top />

    <!-- 应用信息卡：logo 用软件 logo（public/favicon.svg，与 PC TitleBar 同源），2026-10-11 名称定为「股票看板」 -->
    <div class="m-mine-hero">
      <img class="m-app-logo" src="/favicon.svg" alt="股票看板" />
      <div>
        <div class="m-mine-hero__t">股票看板</div>
        <div class="m-mine-hero__d">
          v{{ APP_VERSION }} <span class="m-mini-tag">APK 直装版</span>
        </div>
      </div>
    </div>

    <div class="m-set-group" style="margin-top: 12px">
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
      <button class="m-set-row" @click="goSettings">
        <div class="m-set-row__ic">⚒</div>
        <div class="m-set-row__t">
          设置
          <span class="d">检查更新 · 轮询与缓存 · 免责声明</span>
        </div>
        <span class="m-set-row__arr">›</span>
      </button>
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
</style>
