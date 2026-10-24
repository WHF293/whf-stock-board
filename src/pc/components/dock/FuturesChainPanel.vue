<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import NoticeBar from '../ui/NoticeBar.vue';
import { useTheme } from '../../../common/composables/use-theme';
import {
  FUTURES_CHAIN_DARK_FILTER,
  FUTURES_CHAIN_PAGE_URL_TEMPLATE,
} from '../../../common/constants/futures.constants.ts';

/**
 * 期货品种产业链基本面面板（dock 内容组件）
 *
 * iframe 嵌入同花顺产业链 F10 页面（上游无暗色模式、跨域不可注入样式，
 * 暗色模式经父页面在 iframe 元素上挂 CSS filter 反色实现，见
 * FUTURES_CHAIN_DARK_FILTER 的说明）；加载期展示遮罩，主力合约缺失降级空态。
 */
const props = defineProps<{
  /** 主力合约代码（如 au2612，产业链页面 hash 的 code 参数） */
  contractCode: string;
  /** 品种名（iframe 无障碍标题用） */
  varietyName: string;
}>();

const { isDark } = useTheme();

/** iframe 地址（合约代码变化时整页重载） */
const frameSrc = computed(() =>
  FUTURES_CHAIN_PAGE_URL_TEMPLATE.replace('{code}', encodeURIComponent(props.contractCode)),
);

/** iframe 是否已加载完成（load 事件后撤遮罩） */
const frameLoaded = ref(false);

watch(
  () => props.contractCode,
  () => {
    frameLoaded.value = false;
  },
);

/** iframe 元素上的暗色反色滤镜（亮色模式不挂滤镜） */
const frameStyle = computed(() => ({
  filter: isDark.value ? FUTURES_CHAIN_DARK_FILTER : 'none',
}));

/** 顶部来源公告条文案（王总 2026-10-24 指定：标注页面来源为同花顺期货通） */
const SOURCE_NOTICE_TEXT = '页面来源：同花顺期货通（10jqka）产业链 F10 · 本应用内嵌展示，数据口径以原页面为准';
</script>

<template>
  <div class="flex size-full min-h-0 flex-col">
    <!-- 来源公告条（常驻，不随 iframe 滚动） -->
    <NoticeBar :text="SOURCE_NOTICE_TEXT" />

    <div class="relative min-h-0 flex-1 overflow-hidden">
      <!-- 主力合约缺失：上游映射接口未返回该品种，降级空态（不做无 code 的裸页） -->
      <BaseEmpty v-if="!contractCode" text="暂无该品种的主力合约数据，无法打开产业链页面" />

      <iframe
        v-else
        :key="frameSrc"
        :src="frameSrc"
        :style="frameStyle"
        class="size-full border-0 bg-surface"
        :title="`${varietyName}产业链基本面（同花顺期货通）`"
        referrerpolicy="no-referrer-when-downgrade"
        @load="frameLoaded = true"
      />

      <!-- 加载遮罩：iframe 首次 load 前覆盖，避免白屏闪现 -->
      <div
        v-if="contractCode && !frameLoaded"
        class="absolute inset-0 flex items-center justify-center bg-surface text-sm text-text-tertiary"
      >
        正在加载 {{ varietyName }} 产业链页面…
      </div>
    </div>
  </div>
</template>
