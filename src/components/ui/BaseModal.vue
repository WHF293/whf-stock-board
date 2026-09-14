<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import MenuIcon from './MenuIcon.vue';

/**
 * 通用表单弹窗容器（antd Modal 风格）
 *
 * 与 BaseConfirmModal 的区别：正文与底部操作区完全由调用方插槽定制，
 * 适合表单类弹窗（创建账户 / 导入向导等）；纯确认场景请用 BaseConfirmModal
 *
 * 交互约定：
 * - v-model:open 控制显隐
 * - 居中卡片 + 半透明遮罩 + 点击遮罩关闭 + ESC 关闭 + 右上 × 关闭
 * - 打开时锁定 body 滚动，关闭后恢复
 */
withDefaults(
  defineProps<{
    /** 弹窗标题 */
    title: string;
    /** 卡片最大宽度（Tailwind 类，如 'max-w-md' 'max-w-lg'） */
    maxWidthClass?: string;
  }>(),
  {
    maxWidthClass: 'max-w-lg',
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

// 全局 ESC 监听 + body 滚动锁：immediate 兜底「挂载时就是打开态」的场景
//（否则首帧即 open 的弹窗永远不会挂监听，ESC 与滚动锁全部失效）
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

/** 组件卸载兜底清理（避免快速路由切换时残留监听） */
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <!-- 遮罩（独立点击关闭，避免冒泡到卡片） -->
        <div class="absolute inset-0 bg-black/45" @click="onCancel" />
        <!-- 卡片 -->
        <div
          class="relative z-10 flex max-h-[85dvh] w-full flex-col rounded-lg bg-surface shadow-2xl"
          :class="maxWidthClass"
          @click.stop
        >
          <!-- 标题栏 -->
          <div
            class="flex shrink-0 items-center justify-between gap-2 border-b border-flat-weak px-5 py-3.5"
          >
            <h3 class="truncate text-base font-semibold text-text">
              {{ title }}
            </h3>
            <button
              type="button"
              class="pressable shrink-0 rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
              aria-label="关闭"
              @click="onCancel"
            >
              <MenuIcon name="close" :size="16" />
            </button>
          </div>
          <!-- 正文（调用方定制） -->
          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <slot />
          </div>
          <!-- 操作栏（调用方定制按钮） -->
          <div
            v-if="$slots.footer"
            class="flex shrink-0 items-center justify-end gap-2 border-t border-flat-weak px-5 py-3"
          >
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 整体淡入淡出（与 BaseConfirmModal 一致） */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
