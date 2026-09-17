<script setup lang="ts">
import { computed } from 'vue';
import MenuIcon from './MenuIcon.vue';
import { NOTIFY_TONE_CLASS } from '../../constants/notify.constants';
import { useNotificationsStore } from '../../stores/notifications';
import type { NotifyTone } from '../../types/notify.types';

/**
 * 应用通知浮窗宿主（右下角常驻）
 *
 * 由 MainLayout 渲染一次，跨路由常驻：任何插件经 `app:notify` 服务弹的提醒都落在这里，
 * 与触发它的面板是否挂载无关（盯盘面板折叠后提醒照常出现）。
 *
 * 视觉：无边框，靠 `shadow-card` + 左侧语义色强调条表达层级与语气；
 * 语气色走 `bg-up / bg-down` 等 token，因此自动跟随 `data-trend` 涨跌主题。
 */
const store = useNotificationsStore();

/** 待展示浮窗（新条目在末尾，从下往上堆） */
const items = computed(() => store.items);

/**
 * 取某条浮窗的语气配色类名
 * @param tone 语气
 * @returns 强调条 / 来源标签类名
 */
const toneClass = (tone: NotifyTone): (typeof NOTIFY_TONE_CLASS)[NotifyTone] =>
  NOTIFY_TONE_CLASS[tone];
</script>

<template>
  <!-- 右下角：避开右侧停靠面板的报价头部，也不会盖住页面主内容 -->
  <div
    class="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col-reverse gap-2"
    aria-live="polite"
  >
    <TransitionGroup name="notify">
      <div
        v-for="item in items"
        :key="item.id"
        class="pointer-events-auto flex overflow-hidden rounded-card bg-surface shadow-card"
        role="alert"
      >
        <!-- 语气强调条 -->
        <span class="w-1 shrink-0" :class="toneClass(item.tone).bar" />

        <button
          type="button"
          class="pressable min-w-0 flex-1 px-3 py-2.5 text-left active:scale-[0.99]"
          :title="item.body ? `${item.title} ${item.body}` : item.title"
          @click="store.activate(item.id)"
        >
          <span
            v-if="item.source"
            class="block text-[10px] font-medium"
            :class="toneClass(item.tone).label"
          >
            {{ item.source }}
          </span>
          <span class="block truncate text-sm font-medium text-text">{{ item.title }}</span>
          <span v-if="item.body" class="mt-0.5 block truncate text-xs text-text-secondary">
            {{ item.body }}
          </span>
        </button>

        <button
          type="button"
          class="pressable shrink-0 self-start rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
          aria-label="关闭提醒"
          @click="store.dismiss(item.id)"
        >
          <MenuIcon name="close" :size="12" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* 从右侧滑入 / 向右滑出：与「右侧浮窗」的空间方位一致 */
.notify-enter-active,
.notify-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.notify-enter-from,
.notify-leave-to {
  opacity: 0;
  transform: translateX(12px);
}

/* 挤掉最旧一条时其余条目平滑上移 */
.notify-move {
  transition: transform 180ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .notify-enter-active,
  .notify-leave-active,
  .notify-move {
    transition: none;
  }
}
</style>
