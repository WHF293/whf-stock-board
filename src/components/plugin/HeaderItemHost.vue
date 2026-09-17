<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { onClickOutside, useIntervalFn } from '@vueuse/core';
import MenuIcon from '../ui/MenuIcon.vue';
import { PLUGIN_PANEL_HOST_KEY } from '../../plugin/panel-host';
import { usePluginPanelsStore } from '../../stores/plugin-panels';
import {
  HEADER_MARQUEE_LABEL_MAX_EM,
  HEADER_MARQUEE_LINE_HEIGHT,
  HEADER_MARQUEE_SLIDE_EASING,
  HEADER_MARQUEE_SLIDE_MS,
  HEADER_MARQUEE_TONE_CLASS,
  HEADER_MARQUEE_VALUE_WIDTH_PX,
  HEADER_MARQUEE_VIEWPORT_PX,
} from '../../constants/header.constants';
import { HEADER_MARQUEE_TONE } from '../../constants/plugin.constants';
import { trackAction } from '../../weblog/weblogActions';
import type { CSSProperties } from 'vue';
import type { HeaderMarqueeLine, RegisteredHeaderItem } from '../../types/plugin.types';

/**
 * 插件顶栏条目宿主（应用右上角工具条上的一个插件入口）
 *
 * 三件事：
 * - **收起态**：只有一条轮播信息，**不展示图标**（顶栏位置金贵，让给数据本身）。
 *   插件经 `marquee()` 给数据源，宿主按 `marqueeIntervalMs` 上下滑动切换下一条
 *   （Swiper 式：整条滑出、下一条滑入，不是文字平移跑马灯）；
 * - **展开态**：点击开下拉面板，面板里渲染插件的 `component`，
 *   并把宿主上下文 `provide` 下去（面板可 `usePluginPanelHost()?.close()` 自己收起）；
 * - **关闭**：点条目名以外区域 / 再点一次触发按钮 / ESC（无弹窗时）。
 *
 * 轮播计时器挂在**本组件**而不是注册表：条目被隐藏（设置页关掉）或插件卸载时
 * 组件一起消失，不存在需要额外清理的计时器。
 */
const props = defineProps<{
  /** 内核注册的顶栏条目 */
  item: RegisteredHeaderItem;
}>();

/** 下拉面板是否展开 */
const open = ref(false);

/** 条目根元素（外部点击判定的边界，触发按钮与面板都在它内部） */
const rootRef = ref<HTMLElement | null>(null);

/** 轮播位移（单位：行）；多条时允许等于行数，即停在末尾的首行副本上 */
const cursor = ref(0);

/** 是否处于滑动动画中：静默回绕的瞬间要关掉过渡，否则会「倒着滑回去」 */
const sliding = ref(true);

/** 插件的轮播数据源（在 computed 内求值，插件读自己的 ref 即可自动跟随） */
const lines = computed<readonly HeaderMarqueeLine[]>(() => props.item.marquee());

/**
 * 实际渲染的轨道行
 *
 * 多于一条时末尾追加一份首行副本：滑到副本上再静默归零，观感就是无限向上循环
 * （没有副本的话，最后一条要「倒着滑」回第一条）。
 */
const trackLines = computed<readonly HeaderMarqueeLine[]>(() => {
  const list = lines.value;
  if (list.length <= 1) return list;
  const head = list[0];
  return head ? [...list, head] : list;
});

/** 是否有可轮播内容；没有则按钮回落为条目名 */
const hasLines = computed(() => trackLines.value.length > 0);

/** 每行样式：与视窗同高（两处必须一致，差 1px 切换瞬间就会露出半截字） */
const lineHeightStyle = computed<CSSProperties>(() => ({
  height: `${HEADER_MARQUEE_LINE_HEIGHT}px`,
}));

/**
 * 视窗样式：高一行、宽固定（= 名称上限 60 + 数值列 111 = 171，推导见常量注释）
 *
 * 两列宽全写死：视窗是定值，顶栏永不被轮播内容推挤，数字也不左右横跳。
 */
const viewportStyle = computed<CSSProperties>(() => ({
  height: `${HEADER_MARQUEE_LINE_HEIGHT}px`,
  width: `${HEADER_MARQUEE_VIEWPORT_PX}px`,
}));

/** 行首标签上限：5 字宽（em 随字号缩放），超出省略号 —— 空间不够时从名称里省 */
const labelStyle = computed<CSSProperties>(() => ({
  maxWidth: `${HEADER_MARQUEE_LABEL_MAX_EM}em`,
}));

/** 数值列固定宽：按最坏 `99999.99 +9999.99%` 预留（冗余设计），数字位置稳定 */
const valueStyle = computed<CSSProperties>(() => ({
  width: `${HEADER_MARQUEE_VALUE_WIDTH_PX}px`,
}));

/** 轨道位移样式（每行滑动 LINE_HEIGHT 像素；回绕瞬间无过渡） */
const trackStyle = computed<CSSProperties>(() => ({
  transform: `translateY(${-cursor.value * HEADER_MARQUEE_LINE_HEIGHT}px)`,
  transition: sliding.value
    ? `transform ${HEADER_MARQUEE_SLIDE_MS}ms ${HEADER_MARQUEE_SLIDE_EASING}`
    : 'none',
}));

/**
 * 单行色调类名
 * @param line 轮播行
 * @returns 文本色类名（缺省中性）
 */
const lineClass = (line: HeaderMarqueeLine): string =>
  HEADER_MARQUEE_TONE_CLASS[line.tone ?? HEADER_MARQUEE_TONE.DEFAULT];

/**
 * 静默回到第一行
 *
 * 关过渡 → 归零 → 等两帧（让浏览器先把归零后的布局应用到位）→ 恢复过渡。
 * 少了这两帧，恢复过渡和归零会并进同一次样式计算，归零那一下仍旧被当成动画播放。
 */
const resetTrack = (): void => {
  sliding.value = false;
  cursor.value = 0;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sliding.value = true;
    });
  });
};

/**
 * 一次滑动结束
 *
 * 停在末尾副本上（位移等于行数）说明这一轮走完了，静默归零接着循环；
 * 常规切换停在中间位置，什么都不做。
 *
 * 必须校验 `target`/`propertyName`：按钮里别的元素（如箭头图标的旋转）也会
 * 冒泡出 transitionend，不校验就可能把回绕提前触发。
 * @param event 过渡结束事件
 */
const onSlideEnd = (event: TransitionEvent): void => {
  if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
  if (cursor.value < lines.value.length) return;
  resetTrack();
};

// 候选池增删（行数变化）时回到第一行：否则位移可能落在新列表之外，视窗会空着
watch(
  () => lines.value.length,
  () => {
    if (cursor.value !== 0) resetTrack();
  },
);

// 轮播：只有一行不需要定时器空转，面板展开时也没必要继续轮（用户正在看明细）
useIntervalFn(
  () => {
    if (open.value) return;
    if (lines.value.length <= 1) {
      if (cursor.value !== 0) resetTrack();
      return;
    }
    cursor.value += 1;
  },
  () => props.item.marqueeIntervalMs,
);

provide(PLUGIN_PANEL_HOST_KEY, {
  key: props.item.key,
  mode: 'header',
  close: (): void => {
    open.value = false;
  },
});

// 「打开面板」服务（panel:open）：宿主把意图写进 store，这里消费并展开自己。
// 于是命令 / 事件 / 别的插件都能唤醒这个下拉，不必去摸 DOM。
const panelsStore = usePluginPanelsStore();
watch(
  () => [panelsStore.headerSeq, panelsStore.headerItemKey] as const,
  ([, key]) => {
    if (key !== props.item.key) return;
    open.value = true;
  },
);

onClickOutside(rootRef, () => {
  open.value = false;
});

/**
 * ESC 关闭下拉
 *
 * 下拉里可以再打开弹窗（如阈值编辑），那一层的 ESC 归弹窗消费 ——
 * BaseModal 打开时会在 body 上挂 `role="dialog"`，据此让位，避免按一次 ESC 关两层。
 * @param event 键盘事件
 */
const onKeydown = (event: KeyboardEvent): void => {
  if (!open.value || event.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  open.value = false;
};

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
});

/** 切换下拉面板（展开时记一条行为埋点） */
const onToggle = (): void => {
  open.value = !open.value;
  if (open.value) {
    trackAction('HEADER_ITEM_OPEN', { target: props.item.key, detail: props.item.title });
  }
};
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="pressable flex items-center gap-1 rounded-lg px-2 py-1.5 text-text-secondary hover:bg-flat-weak active:scale-[0.98]"
      :class="open ? 'bg-flat-weak text-text' : ''"
      :aria-label="item.title"
      :aria-expanded="open"
      :data-track-detail="item.title"
      @click="onToggle"
    >
      <!-- 轮播视窗：宽度按最坏情况预算（推导见 HEADER_MARQUEE_VIEWPORT_PX），
           文案长短变化时不推挤相邻按钮；高度固定为一行，轨道上下滑动把下一条滑进来 -->
      <span v-if="hasLines" class="overflow-hidden" :style="viewportStyle">
        <span class="flex flex-col" :style="trackStyle" @transitionend="onSlideEnd">
          <!-- 两列宽全固定：名称上限 5 字（超出省略号）、数值列按最坏宽度预留。
               两列之间不留间距（数值列已是冗余预留），名称短时空白落在数值列右侧 -->
          <span
            v-for="(line, index) in trackLines"
            :key="`${index}-${line.text}`"
            class="flex items-center text-xs"
            :class="lineClass(line)"
            :style="lineHeightStyle"
            :aria-label="line.text"
          >
            <span class="min-w-0 truncate text-left" :style="labelStyle">{{ line.label ?? line.text }}</span>
            <span v-if="line.value" class="shrink-0 tabular-nums" :style="valueStyle">{{ line.value }}</span>
          </span>
        </span>
      </span>
      <span v-else class="text-xs text-text-tertiary">{{ item.title }}</span>
      <MenuIcon
        name="chevronDown"
        :size="12"
        class="shrink-0 transition-transform"
        :class="open ? 'rotate-180' : ''"
      />
    </button>

    <!-- 下拉面板：内容全部由插件决定，宿主只给承载与标题 -->
    <div
      v-if="open"
      class="absolute right-0 top-full z-50 mt-2 w-80 rounded-card bg-surface p-3 shadow-lg"
      role="region"
      :aria-label="item.title"
    >
      <p class="mb-2 text-xs font-medium text-text-secondary">{{ item.title }}</p>
      <component :is="item.component" v-bind="item.props" />
    </div>
  </div>
</template>
