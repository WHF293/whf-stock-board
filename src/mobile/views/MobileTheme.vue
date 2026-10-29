<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  THEME_COLOR_OPTIONS,
} from '../../common/constants/theme-color.constants.ts';
import type { ThemeColor } from '../../common/constants/theme-color.constants.ts';
import {
  TREND_THEME_OPTIONS,
} from '../../common/constants/trend-theme.constants.ts';
import type { TrendTheme } from '../../common/constants/trend-theme.constants.ts';
import { useSettingsStore } from '../../common/stores/settings';

/**
 * 主题设置页（移动端）
 *
 * 主题色（6 内置 + 自定义取色）/ 涨跌配色三套；
 * 全部写共享 settings store，html 属性由 MobileApp 的 useDocumentThemeSync 落盘生效。
 * 明暗模式已于 2026-10-11 上移到「我的」页独立选项（王总指示拆分），本页不再重复。
 */

const router = useRouter();
const settingsStore = useSettingsStore();

// ---- 主题色 ----

/** 自定义取色输入（隐藏的原生 color input，点「自定义」行触发） */
const customColorInput = ref<HTMLInputElement | null>(null);

const selectThemeColor = (color: ThemeColor): void => {
  settingsStore.setThemeColor(color);
  if (color === 'custom') customColorInput.value?.click();
};

const onCustomColorInput = (event: Event): void => {
  const value = (event.target as HTMLInputElement).value;
  settingsStore.setCustomThemeColor(value);
  settingsStore.setThemeColor('custom');
};

// ---- 涨跌配色 ----

const selectTrendTheme = (theme: TrendTheme): void => {
  settingsStore.setTrendTheme(theme);
};
</script>

<template>
  <!-- m-sub-page：≥600px 大屏限宽居中（mobile.css 断点适配分档） -->
  <div class="m-sub-page">
    <van-nav-bar title="主题设置" class="m-nav" fixed placeholder safe-area-inset-top left-arrow @click-left="router.back()" />

    <div class="m-theme-block" style="margin-top: 12px">
      <div class="m-theme-block__h">主题色 <span class="d">按钮 / 激活态 / TabBar</span></div>
      <div class="m-swatches">
        <button
          v-for="option in THEME_COLOR_OPTIONS"
          :key="option.value"
          class="m-sw"
          :class="{ 'm-sw--on': settingsStore.themeColor === option.value }"
          :style="{ background: option.swatch }"
          @click="selectThemeColor(option.value)"
        >
          <template v-if="settingsStore.themeColor === option.value">✓</template>
        </button>
      </div>
      <button class="m-set-row" style="border-bottom: 0; padding: 12px 2px 2px" @click="customColorInput?.click()">
        <div class="m-set-row__ic">✎</div>
        <div class="m-set-row__t">
          自定义主题色
          <span class="d">任意色值，实时预览</span>
        </div>
        <span class="m-set-row__extra m-num">{{ settingsStore.customThemeColor }}</span>
      </button>
      <input
        ref="customColorInput"
        type="color"
        :value="settingsStore.customThemeColor"
        style="position: absolute; width: 0; height: 0; opacity: 0"
        @change="onCustomColorInput"
      />
    </div>

    <div class="m-theme-block">
      <div class="m-theme-block__h">涨跌配色 <span class="d">全站涨跌色即时跟随</span></div>
      <div class="m-trend-cards">
        <button
          v-for="option in TREND_THEME_OPTIONS"
          :key="option.value"
          class="m-trend-card"
          :class="{ 'm-trend-card--on': settingsStore.trendTheme === option.value }"
          @click="selectTrendTheme(option.value)"
        >
          <span class="m-trend-card__nm">{{ option.label }}</span>
          <span
            class="m-trend-card__pill"
            :style="{ background: `${option.upSwatch}22`, color: option.upSwatch }"
          >
            +2.31%
          </span>
          <span
            class="m-trend-card__pill"
            :style="{ background: `${option.downSwatch}22`, color: option.downSwatch }"
          >
            -1.05%
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-theme-block {
  background: var(--color-surface);
  border-radius: 12px;
  margin: 0 12px 10px;
  padding: 14px 16px;
}
.m-theme-block__h {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.m-theme-block__h .d { font-size: 10.5px; color: var(--color-text-3); font-weight: 500; }
</style>
