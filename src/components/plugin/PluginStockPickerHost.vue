<script setup lang="ts">
import { computed } from 'vue';
import StockSearchModal from '../business/StockSearchModal.vue';
import { usePluginUiStore } from '../../stores/plugin-ui';

/**
 * 插件选股弹窗承载组件（挂在 MainLayout，与 PluginConfirmHost 同一范式）
 *
 * 插件侧的效果：`ctx.consume('app:stock-picker').pick()` 是一个 Promise，
 * 这里把「等待中的请求」渲染成全站统一的标的搜索弹窗（含「上次搜索」与键盘上下键），
 * 用户挑中即结算 Promise；取消 / 关闭结算为 null。
 *
 * 弹窗由宿主渲染而不是挂在插件组件里 —— 插件面板被折叠 / 组件被卸载也不会丢失结果。
 * 插件因此不必各写一个搜索框：自己写的那一份一定更差，且样式与宿主的搜索不一致。
 */
const uiStore = usePluginUiStore();

/** 弹窗开关：搜索弹窗的关闭（遮罩 / × / ESC）一律按「取消」结算 */
const open = computed<boolean>({
  get: () => uiStore.pendingPick !== null,
  set: (value: boolean) => {
    if (!value) uiStore.settlePick(null);
  },
});

/**
 * 挑中一只：回传给发起插件并收起弹窗
 * @param result 选中的标的
 */
const onSelect = (result: Parameters<typeof uiStore.settlePick>[0]): void => {
  uiStore.settlePick(result);
};
</script>

<template>
  <StockSearchModal :open="open" @close="uiStore.settlePick(null)" @select="onSelect" />
</template>
