<script setup lang="ts">
import { computed } from 'vue';
import BaseConfirmModal from '../ui/BaseConfirmModal.vue';
import { usePluginUiStore } from '../../stores/plugin-ui';

/**
 * 插件确认弹窗承载组件（挂在 MainLayout，与 notifications 同一范式）
 *
 * 插件响应的效果：`ctx.consume('app:ui').confirm({ … })` 是一个 Promise，
 * 这里把「等待中的请求」渲染成宿主的确认弹窗，用户点按钮即结算 Promise。
 * 弹窗不再挂在发起它的插件组件里 —— 插件面板被折叠 / 组件被卸载也不会丢失答复。
 */
const uiStore = usePluginUiStore();

/** 当前请求（无请求时用空对象兜底，避免 template 里到处判空） */
const options = computed(() => uiStore.pending?.options ?? {});

/** 弹窗开关：外部关闭（遮罩 / × / ESC）一律按「取消」结算 */
const open = computed<boolean>({
  get: () => uiStore.pending !== null,
  set: (value: boolean) => {
    if (!value) uiStore.settle(false);
  },
});
</script>

<template>
  <BaseConfirmModal
    v-model:open="open"
    :title="options.title ?? '确认'"
    :content="options.content ?? ''"
    :ok-text="options.okText ?? '确定'"
    :cancel-text="options.cancelText ?? '取消'"
    :ok-variant="options.okVariant ?? 'primary'"
    @ok="uiStore.settle(true)"
    @cancel="uiStore.settle(false)"
  />
</template>
