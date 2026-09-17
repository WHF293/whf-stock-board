<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { onClickOutside, useIntervalFn } from '@vueuse/core';
import MenuIcon from '../ui/MenuIcon.vue';
import { PLUGIN_PANEL_HOST_KEY } from '../../plugin/panel-host';
import { usePluginPanelsStore } from '../../stores/plugin-panels';
import { HEADER_MARQUEE_TONE_CLASS } from '../../constants/header.constants';
import { HEADER_MARQUEE_TONE } from '../../constants/plugin.constants';
import { trackAction } from '../../weblog/weblogActions';
import type { HeaderMarqueeLine, RegisteredHeaderItem } from '../../types/plugin.types';

/**
 * 插件顶栏条目宿主（应用右上角工具条上的一个插件入口）
 *
 * 三件事：
 * - **收起态**：图标 + 一条轮播信息（插件经 `marquee()` 给数据源，宿主按
 *   `marqueeIntervalMs` 轮流取一条）—— 不点开也能看到最新一条；
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

/** 轮播下标（对行数取模，行数变化不需要重置） */
const cursor = ref(0);

/** 插件的轮播数据源（在 computed 内求值，插件读自己的 ref 即可自动跟随） */
const lines = computed<readonly HeaderMarqueeLine[]>(() => props.item.marquee());

/** 当前展示的那一行；无可展示内容时为 null（回落为条目名） */
const currentLine = computed<HeaderMarqueeLine | null>(() => {
  const list = lines.value;
  if (list.length === 0) return null;
  return list[cursor.value % list.length] ?? null;
});

/** 轮播文案色类（无内容时条目名用弱化色，与普通图标按钮区分开） */
const marqueeClass = computed(() =>
  HEADER_MARQUEE_TONE_CLASS[currentLine.value?.tone ?? HEADER_MARQUEE_TONE.DEFAULT],
);

// 轮播：只有一行时不需要定时器空转，面板展开时也没必要继续轮
useIntervalFn(
  () => {
    if (open.value) return;
    const total = lines.value.length;
    if (total <= 1) {
      cursor.value = 0;
      return;
    }
    cursor.value = (cursor.value + 1) % total;
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
      class="pressable flex items-center gap-1.5 rounded-lg py-1.5 pl-2 pr-1.5 text-text-secondary hover:bg-flat-weak active:scale-[0.98]"
      :class="open ? 'bg-flat-weak text-text' : ''"
      :aria-label="item.title"
      :aria-expanded="open"
      :data-track-detail="item.title"
      @click="onToggle"
    >
      <MenuIcon :name="item.icon" :size="16" />
      <!-- 轮播文本框宽度固定：文案长短变化时不推挤左侧其它顶栏按钮 -->
      <span v-if="currentLine" class="w-44 truncate text-left text-xs tabular-nums" :class="marqueeClass">
        {{ currentLine.text }}
      </span>
      <span v-else class="text-xs text-text-tertiary">{{ item.title }}</span>
      <MenuIcon
        name="chevronDown"
        :size="12"
        class="transition-transform"
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
