<script setup lang="ts">
import BaseButton from '../ui/BaseButton.vue';
import type { ThsHotTheme } from '../../api/news.api';
import type { HotNewsViewOption } from '../../constants/hot-news.constants';

/**
 * 热点新闻卡片的通道切换控件（子视图分段控件 + 可选主题 chips 行）
 *
 * 同花顺卡片（热点主题/快讯/头条 + 主题 chips）与东方财富卡片
 * （快讯/推荐/热搜/领涨概念）共用：子视图列表由父组件以 views 传入，
 * 主题 chips 仅同花顺「热点主题」子视图使用（传入 themes 且 active 为 theme 才渲染）；
 * 卡片本体与卡片放大弹窗共用这一套控件（两处只有布局宽紧差异），
 * 选中态与副作用全部由父组件持有，本组件只渲染 + 上抛事件
 */

withDefaults(
  defineProps<{
    /** 子视图选项列表（值 + 展示名） */
    views: readonly HotNewsViewOption[];
    /** 当前选中的子视图值 */
    active: string;
    /** 宽松布局（放大弹窗内：主题 chips 换行铺满，而非单行横向滚动） */
    roomy?: boolean;
    /** 主题列表（仅同花顺热点主题子视图消费；不传则不渲染 chips 行） */
    themes?: ThsHotTheme[];
    /** 当前选中的主题 id */
    selectedThemeId?: string;
    /** 主题列表加载中 */
    themesLoading?: boolean;
    /** 主题列表加载失败 */
    themesError?: boolean;
  }>(),
  {
    roomy: false,
    themes: undefined,
    selectedThemeId: '',
    themesLoading: false,
    themesError: false,
  },
);

const emit = defineEmits<{
  /** 切换子视图 */
  selectView: [value: string];
  /** 切换主题 */
  selectTheme: [themeId: string];
  /** 重试拉取主题列表 */
  retryThemes: [];
}>();
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- 子视图切换：分段控件（等宽段，选中段用 primary） -->
    <div class="flex gap-1 rounded-lg bg-flat-weak/50 p-0.5">
      <button
        v-for="view in views"
        :key="view.value"
        type="button"
        class="pressable flex-1 rounded-md px-2 py-1 text-xs"
        :class="
          active === view.value
            ? 'bg-primary font-medium text-white'
            : 'text-text-secondary hover:text-text'
        "
        @click="emit('selectView', view.value)"
      >
        {{ view.label }}
      </button>
    </div>

    <!-- 同花顺热点主题子视图：主题 chips（单选切换，切换后该通道分页重置） -->
    <div
      v-if="themes && active === 'theme'"
      class="flex items-center gap-1.5"
      :class="roomy ? 'flex-wrap' : 'overflow-x-auto'"
    >
      <template v-if="themes.length > 0">
        <button
          v-for="theme in themes"
          :key="theme.themeId"
          type="button"
          class="pressable shrink-0 rounded-full px-2.5 py-1 text-xs"
          :class="
            selectedThemeId === theme.themeId
              ? 'bg-primary text-white'
              : 'bg-flat-weak text-text-secondary hover:text-text'
          "
          @click="emit('selectTheme', theme.themeId)"
        >
          {{ theme.themeName }}
        </button>
      </template>
      <span v-else-if="themesLoading" class="text-xs text-text-tertiary">
        主题加载中...
      </span>
      <template v-else-if="themesError">
        <span class="text-xs text-text-tertiary">主题加载失败</span>
        <BaseButton variant="ghost" @click="emit('retryThemes')">
          重试
        </BaseButton>
      </template>
    </div>
  </div>
</template>
