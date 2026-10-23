<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import { useSlidingThumb } from '../../../common/composables/use-sliding-thumb';
import type { ThsHotTheme } from '../../../common/api/news.api.ts';
import type { HotNewsViewOption } from '../../../common/constants/hot-news.constants.ts';

/**
 * 热点新闻卡片的通道切换控件（子视图分段控件 + 可选主题 chips 行）
 *
 * 同花顺卡片（热点主题/快讯/头条 + 主题 chips）与东方财富卡片
 * （快讯/推荐/热搜/领涨概念）共用：子视图列表由父组件以 views 传入，
 * 主题 chips 仅同花顺「热点主题」子视图使用（传入 themes 且 active 为 theme 才渲染）；
 * 卡片本体与卡片放大弹窗共用这一套控件（两处只有布局宽紧差异），
 * 选中态与副作用全部由父组件持有，本组件只渲染 + 上抛事件
 *
 * 两组选中态均用共享滑动玻璃气泡（useSlidingThumb，与 BaseTabs/移动端 TabBar 同款动画）：
 * 玻璃底挂在组内 thumb 层上，切换时滑到新项
 */

const props = withDefaults(
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

/** 子视图分段容器（气泡定位父级） */
const viewsRef = ref<HTMLElement | null>(null);
/** 主题 chips 容器（v-if 延迟渲染，composable 内已处理挂载重测） */
const themesRef = ref<HTMLElement | null>(null);

/** 激活子视图序号（驱动气泡位移；未匹配 = -1 气泡隐藏） */
const activeViewIndex = computed(() =>
  props.views.findIndex((view) => view.value === props.active),
);
/** 激活主题序号（chips 行未渲染 / 未选中时为 -1） */
const activeThemeIndex = computed(() =>
  (props.themes ?? []).findIndex((theme) => theme.themeId === props.selectedThemeId),
);

const { thumbStyle: viewThumbStyle } = useSlidingThumb({
  container: viewsRef,
  activeIndex: activeViewIndex,
});
const { thumbStyle: themeThumbStyle, measure: measureThemes } = useSlidingThumb({
  container: themesRef,
  activeIndex: activeThemeIndex,
});

// 主题列表变化（异步加载完成 / 重试重拉）后重量取 chips 气泡几何
watch(
  () => [props.themes, props.active === 'theme'] as const,
  () => {
    void nextTick(measureThemes);
  },
  { flush: 'post' },
);
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- 子视图切换：分段控件（等宽段，选中段玻璃底由滑动气泡提供） -->
    <div ref="viewsRef" class="relative flex gap-1 rounded-lg bg-flat-weak/50 p-0.5">
      <span
        v-if="viewThumbStyle"
        class="pc-nav-bubble pointer-events-none absolute left-0 top-0 z-0 rounded-md"
        :style="viewThumbStyle"
      ></span>
      <button
        v-for="view in views"
        :key="view.value"
        type="button"
        class="pressable relative flex-1 rounded-md px-2 py-1 text-xs"
        :class="active === view.value ? 'font-medium text-primary' : 'text-text-secondary hover:text-text'"
        @click="emit('selectView', view.value)"
      >
        {{ view.label }}
      </button>
    </div>

    <!-- 同花顺热点主题子视图：主题 chips（单选切换，切换后该通道分页重置） -->
    <div
      v-if="themes && active === 'theme'"
      ref="themesRef"
      class="relative flex items-center gap-1.5"
      :class="roomy ? 'flex-wrap' : 'overflow-x-auto'"
    >
      <span
        v-if="themeThumbStyle"
        class="pc-nav-bubble pointer-events-none absolute left-0 top-0 z-0 rounded-full"
        :style="themeThumbStyle"
      ></span>
      <template v-if="themes.length > 0">
        <button
          v-for="theme in themes"
          :key="theme.themeId"
          type="button"
          class="pressable relative shrink-0 rounded-full px-2.5 py-1 text-xs"
          :class="
            selectedThemeId === theme.themeId
              ? 'font-medium text-primary'
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
