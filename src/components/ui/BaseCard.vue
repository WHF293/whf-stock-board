<script setup lang="ts">
/**
 * 基础卡片：圆角 + 卡片面 + 柔和阴影，可选标题与右侧 extra 插槽
 */
defineProps<{
  /** 卡片标题；不传且无 extra 插槽时不渲染头部 */
  title?: string;
  /**
   * 撑满父容器高度（卡片变成 flex 列容器）
   *
   * 用于「卡片内有一张大表要尽量高」的整页布局：配合父级 flex 分配高度 +
   * 表格容器 `.table-scroll-fill`，正文即可吃掉卡片剩余高度。
   * 注意：调用方仍需给本卡片 `flex-1 min-h-0`（卡片自身是父级的 flex 子项）；
   * 默认插槽内容直接成为 flex 子项，需要撑高的那块自行加 `flex-1 min-h-0`
   * / `.table-scroll-fill`，其余内容（工具条、统计块）保持内容高即可。
   */
  fill?: boolean;
}>();
</script>

<template>
  <section
    class="rounded-card bg-surface p-4 shadow-card"
    :class="fill ? 'flex min-h-0 flex-col' : ''"
  >
    <header
      v-if="title || $slots.extra"
      class="mb-3 flex items-center justify-between gap-2"
      :class="fill ? 'shrink-0' : ''"
    >
      <h2 class="text-sm font-semibold text-text">{{ title }}</h2>
      <slot name="extra" />
    </header>
    <slot />
  </section>
</template>
