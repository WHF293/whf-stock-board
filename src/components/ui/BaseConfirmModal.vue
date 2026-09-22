<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import BaseButton from './BaseButton.vue';
import MenuIcon from './MenuIcon.vue';

/**
 * 通用确认弹窗（antd Modal 风格）
 *
 * 交互约定：
 * - v-model:open 控制显隐
 * - 居中卡片 + 半透明遮罩 + 点击遮罩关闭 + ESC 关闭 + 右上 × 关闭
 * - 打开时锁定 body 滚动，关闭后恢复
 * - 确认按钮支持 primary / danger 两种变体（危险操作用 danger）
 *
 * 使用方监听 @ok / @cancel；弹窗本身在用户确认或取消后自动关闭，
 * 调用方无需在回调里再设 open=false
 *
 * 插槽：
 * - 默认插槽 / #title：正文与标题自定义
 * - #footer-extra：操作栏左侧附加区（左侧动作按钮，如「恢复默认」），取消 / 确认恒在右侧
 */
withDefaults(
  defineProps<{
    /** 弹窗标题（支持 #title 插槽覆盖） */
    title?: string;
    /** 正文文案（默认插槽可覆盖更复杂内容） */
    content?: string;
    /** 确认按钮文案 */
    okText?: string;
    /** 取消按钮文案 */
    cancelText?: string;
    /** 确认按钮变体：primary 主色 / danger 危险（红） */
    okVariant?: 'primary' | 'danger';
    /** 卡片最大宽度（Tailwind 类，如 'max-w-md' 'max-w-lg'） */
    maxWidthClass?: string;
  }>(),
  {
    title: '确认',
    content: '',
    okText: '确定',
    cancelText: '取消',
    okVariant: 'primary',
    maxWidthClass: 'max-w-md',
  },
);

const open = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{
  /** 用户点击确认按钮 */
  ok: [];
  /** 用户点击取消 / 遮罩 / × / ESC */
  cancel: [];
}>();

/** 确认：发射 ok 事件并关闭 */
const onOk = (): void => {
  emit('ok');
  open.value = false;
};

/** 取消：发射 cancel 事件并关闭 */
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

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('keydown', handleKeydown);
    document.body.style.overflow = 'hidden';
  } else {
    document.removeEventListener('keydown', handleKeydown);
    document.body.style.overflow = '';
  }
});

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
        <!-- 卡片：限高 + 纵向 flex —— 标题 / 操作栏固定，正文区内部滚动，
             保证条目再多弹窗也不会超出视口（矮窗口下是唯一可靠约束） -->
        <div
          class="relative z-10 flex max-h-full w-full flex-col rounded-lg bg-surface shadow-2xl"
          :class="maxWidthClass"
          @click.stop
        >
          <!-- 标题栏 -->
          <div class="flex shrink-0 items-center justify-between gap-2 border-b border-flat-weak px-5 py-3.5">
            <h3 class="truncate text-base font-semibold text-text">
              <slot name="title">{{ title }}</slot>
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
          <!-- 正文：flex-1 + min-h-0 才能在纵向 flex 里被压缩，超高时内部滚动 -->
          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-text-secondary">
            <slot>{{ content }}</slot>
          </div>
          <!-- 操作栏（#footer-extra 放左侧附加动作，如「恢复默认」；留空时与原布局一致） -->
          <div class="flex shrink-0 items-center justify-between gap-2 border-t border-flat-weak px-5 py-3">
            <div class="flex items-center gap-2">
              <slot name="footer-extra" />
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <BaseButton variant="ghost" @click="onCancel">{{ cancelText }}</BaseButton>
              <BaseButton :variant="okVariant" @click="onOk">{{ okText }}</BaseButton>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 整体淡入淡出（antd 风格：遮罩和卡片同时过渡；这里简化为整体透明度） */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
