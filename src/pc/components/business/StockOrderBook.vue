<script setup lang="ts">
import { computed } from 'vue';
import { formatPrice } from '../../../common/utils/format-price';
import BaseEmpty from '../ui/BaseEmpty.vue';
import type { FullQuote } from '../../../common/types/stock-quote.types.ts';

/**
 * 五档盘口：每档一行「档位 / 价格 / 手数」；
 * 颜色跟随系统涨跌主题色：买盘整列用涨色，卖盘整列用跌色（不按档位价格相对昨收 individually 着色）
 *
 * 深度底色（2026-10-22 王总指定）：每档行底加一条渐变色带，宽度按本档手数
 * 占本侧五档最大手数的比例——手数越大色带越宽，盘口厚度一眼可读；
 * 色带用 up-weak / down-weak token 渐变到透明，暗色模式与涨跌配色主题自动跟随
 *
 * 布局两种（默认左右分栏，买盘在左 / 卖盘在右）：
 * - horizontal（默认）：grid 两列，左买右卖，每档「档位 / 价格 / 手数」三列；
 * - vertical（详情页右栏收起态）：上下堆叠，买盘在上 / 卖盘在下；窄栏精简为
 *   「价格 / 手数」两列，档位列收起（宽度 0），**悬停该行时档位（买1…/卖1…）
 *   滑出显示**（2026-10-24 王总指定）
 */
const props = defineProps<{
  /** 完整报价（含五档数据）；为 null 时不渲染 */
  quote: FullQuote | null;
  /** 上下堆叠布局（买盘在上 / 卖盘在下）；默认 false 左右分栏 */
  vertical?: boolean;
}>();

/** 买盘（买一 -> 买五） */
const bidLevels = computed(() => props.quote?.bid ?? []);
/** 卖盘（卖一 -> 卖五） */
const askLevels = computed(() => props.quote?.ask ?? []);

/** 买侧五档最大手数（深度色带宽度的分母；空盘口为 0 防除零） */
const bidMaxVolume = computed(() => Math.max(0, ...bidLevels.value.map((level) => Number(level.volume))));
/** 卖侧五档最大手数 */
const askMaxVolume = computed(() => Math.max(0, ...askLevels.value.map((level) => Number(level.volume))));

/**
 * 档位深度色带内联样式（宽度 = 本档手数 / 本侧最大手数）
 * @param volume 本档手数
 * @param maxVolume 本侧五档最大手数
 * @returns 背景渐变样式（maxVolume 为 0 时返回空对象不渲染色带）
 */
const depthStyle = (volume: number | string, maxVolume: number): Record<string, string> => {
  if (maxVolume <= 0) {
    return {};
  }
  const ratio = Math.min(1, Math.max(0, Number(volume) / maxVolume));
  return { width: `${(ratio * 100).toFixed(1)}%` };
};
</script>

<template>
  <!--
    五档盘口：每档一行「档位 / 价格 / 手数」
    - 左右分栏（默认）：列宽均分，左 1fr 买 / 右 1fr 卖（中间无分隔线，纯空间分区）
    - 上下堆叠（vertical）：买盘在上 / 卖盘在下，每块占满整行
  -->
  <div
    v-if="quote"
    class="text-xs tabular-nums"
    :class="vertical ? 'flex flex-col gap-3' : 'grid grid-cols-2 gap-x-4'"
  >
    <!-- 买盘（买一 在上 / 买五 在下）：整列涨色 + 深度渐变底 -->
    <div>
      <div class="mb-1 text-center text-xs font-medium text-up">买盘</div>
      <div
        class="grid items-center border-b border-flat-weak py-1 text-text-tertiary"
        :class="vertical ? 'grid-cols-[0_1.2fr_1fr]' : 'grid-cols-[1fr_1.2fr_1fr]'"
      >
        <span class="overflow-hidden whitespace-nowrap text-left">档位</span>
        <span class="text-center">价格</span>
        <span class="text-right">手数</span>
      </div>
      <div
        v-for="(level, index) in bidLevels"
        :key="`b${level.price}`"
        class="group relative grid items-center overflow-hidden border-b border-flat-weak/50 py-1.5"
        :class="
          vertical
            ? 'grid-cols-[0_1.2fr_1fr] transition-[grid-template-columns] duration-150 group-hover:grid-cols-[1.75rem_1.2fr_1fr]'
            : 'grid-cols-[1fr_1.2fr_1fr]'
        "
      >
        <!-- 深度色带：绝对定位铺在行底，文字加 relative 保证盖在色带上 -->
        <span
          class="absolute inset-y-0 left-0"
          style="background: linear-gradient(to right, var(--color-up-weak) 0%, transparent 88%)"
          :style="depthStyle(level.volume, bidMaxVolume)"
        ></span>
        <span class="relative overflow-hidden whitespace-nowrap text-up">买{{ index + 1 }}</span>
        <span class="relative text-center text-up">{{ formatPrice(level.price) }}</span>
        <span class="relative text-right text-up/80">{{ level.volume }}</span>
      </div>
    </div>
    <!-- 卖盘（卖一 在上 / 卖五 在下）：整列跌色 + 深度渐变底 -->
    <div>
      <div class="mb-1 text-center text-xs font-medium text-down">卖盘</div>
      <div
        class="grid items-center border-b border-flat-weak py-1 text-text-tertiary"
        :class="vertical ? 'grid-cols-[0_1.2fr_1fr]' : 'grid-cols-[1fr_1.2fr_1fr]'"
      >
        <span class="overflow-hidden whitespace-nowrap text-left">档位</span>
        <span class="text-center">价格</span>
        <span class="text-right">手数</span>
      </div>
      <div
        v-for="(level, index) in askLevels"
        :key="`a${level.price}`"
        class="group relative grid items-center overflow-hidden border-b border-flat-weak/50 py-1.5"
        :class="
          vertical
            ? 'grid-cols-[0_1.2fr_1fr] transition-[grid-template-columns] duration-150 group-hover:grid-cols-[1.75rem_1.2fr_1fr]'
            : 'grid-cols-[1fr_1.2fr_1fr]'
        "
      >
        <span
          class="absolute inset-y-0 left-0"
          style="background: linear-gradient(to right, var(--color-down-weak) 0%, transparent 88%)"
          :style="depthStyle(level.volume, askMaxVolume)"
        ></span>
        <span class="relative overflow-hidden whitespace-nowrap text-down">卖{{ index + 1 }}</span>
        <span class="relative text-center text-down">{{ formatPrice(level.price) }}</span>
        <span class="relative text-right text-down/80">{{ level.volume }}</span>
      </div>
    </div>
  </div>
  <BaseEmpty v-else text="暂无盘口数据" />
</template>
