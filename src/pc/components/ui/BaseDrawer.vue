<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import MenuIcon from './MenuIcon.vue';

/**
 * 右侧抽屉（antd Drawer 风格）
 *
 * 与 BaseModal 的区别：面板从右侧滑入、纵向撑满、宽度可配（默认 2/3 视口宽），
 * 适合承载整页体量的内容（如设置页）；居中小表单请用 BaseModal
 *
 * 交互约定（与 BaseModal 一致）：
 * - v-model:open 控制显隐；遮罩点击 / ESC / 右上 × 关闭
 * - 打开时锁定 body 滚动，关闭后恢复
 * - 滑入动画：面板 translateX(100%) -> 0（antd 同款缓动），遮罩同步淡入
 */
withDefaults(
  defineProps<{
    /** 抽屉标题（头部左侧） */
    title: string;
    /** 面板宽度（CSS width，默认 2/3 视口宽） */
    width?: string;
  }>(),
  {
    width: '66vw',
  },
);

const open = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{
  /** 用户点击取消 / 遮罩 / × / ESC（关闭意图，由本组件自行关闭） */
  cancel: [];
}>();

/** 关闭：发射 cancel 事件并关闭 */
const onCancel = (): void => {
  emit('cancel');
  open.value = false;
};

/** 全局 ESC 监听：仅在打开时挂载
 * @param event 键盘事件
 */
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    onCancel();
  }
};

// ESC 监听 + body 滚动锁：immediate 兜底「挂载时就是打开态」的场景
watch(
  open,
  (isOpen) => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeydown);
      document.body.style.overflow = 'hidden';
    } else {
      document.removeEventListener('keydown', handleKeydown);
      document.body.style.overflow = '';
    }
  },
  { immediate: true },
);

/** 组件卸载兜底清理 */
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <!-- 显式 duration：transition 定义在子元素（面板/遮罩）上，
         根元素无 transition 时 Vue 侦听不到结束时机，leave 会被立即卸载 -->
    <Transition name="drawer" :duration="300">
      <div
        v-if="open"
        class="fixed inset-0 z-50"
        role="dialog"
        aria-modal="true"
      >
        <!-- 遮罩（点击关闭） -->
        <div class="drawer-mask absolute inset-0 bg-black/45" @click="onCancel" />
        <!-- 面板（右侧滑入，纵向撑满） -->
        <div
          class="drawer-panel absolute inset-y-0 right-0 flex flex-col bg-surface shadow-2xl"
          :style="{ width }"
          @click.stop
        >
          <!-- 头部：标题 + 关闭 -->
          <div
            class="flex shrink-0 items-center justify-between gap-2 border-b border-flat-weak px-6 py-3.5"
          >
            <h3 class="truncate text-base font-semibold text-text">{{ title }}</h3>
            <button
              type="button"
              class="pressable shrink-0 rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
              aria-label="关闭"
              @click="onCancel"
            >
              <MenuIcon name="close" :size="16" />
            </button>
          </div>
          <!-- 正文（调用方定制，独立滚动） -->
          <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 面板滑入滑出 + 遮罩淡入淡出（antd Drawer 同款缓动） */
.drawer-enter-active .drawer-panel,
.drawer-leave-active .drawer-panel {
  transition: transform 0.3s cubic-bezier(0.23, 1, 0.32, 1);
}
.drawer-enter-from .drawer-panel,
.drawer-leave-to .drawer-panel {
  transform: translateX(100%);
}
.drawer-enter-active .drawer-mask,
.drawer-leave-active .drawer-mask {
  transition: opacity 0.3s cubic-bezier(0.23, 1, 0.32, 1);
}
.drawer-enter-from .drawer-mask,
.drawer-leave-to .drawer-mask {
  opacity: 0;
}
</style>
