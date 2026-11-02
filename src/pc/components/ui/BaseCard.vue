<script setup lang="ts">
import MenuIcon from './MenuIcon.vue';
import BaseTooltip from './BaseTooltip.vue';

/**
 * 基础卡片：圆角 + 卡片面 + 柔和阴影，可选标题与右侧 extra 插槽
 *
 * 头部统一 min-h-8（32px = BaseButton 标准高度）：相邻卡片（有无 extra 按钮组）
 * 标题行同高居中，标题与正文起始位置纵向对齐（2026-11-02 王总反馈详情页
 * K 线卡与筹码分布卡头部错位）
 *
 * 标题可配置为可点击（clickableTitle）：hover 高亮 + 尾部箭头，点击发射
 * `title-click`，由调用方决定跳转目标；不开启时保持纯文本，现有用例零影响
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
  /** 标题是否可点击（hover 高亮 + 箭头提示；点击发射 title-click） */
  clickableTitle?: boolean;
  /**
   * 高光玻璃质感（theme.css `.pc-glass-card`：半透明底 + backdrop-blur +
   * 斜向高光带），透明度跟随设置页「玻璃透明度」滑杆、高光带跟随「玻璃高光带」开关。
   * 开启后不再挂 `bg-surface / shadow-card`（玻璃类自带底色与投影）
   */
  glass?: boolean;
  /**
   * 标题旁问号说明：传文案后标题右侧渲染 help 问号图标，hover 弹出说明
   * tooltip（Teleport 到 body，不受卡片 overflow 裁剪；折行宽度固定 280px）。
   * 替代正文底部的说明行（2026-11-02 王总指定：筹码分布说明改为标题旁问号）
   */
  tip?: string;
}>();

const emit = defineEmits<{
  /** 点击可点击标题（clickableTitle 时生效，跳转目标由调用方决定） */
  'title-click': [];
}>();
</script>

<template>
  <section
    class="rounded-card p-4"
    :class="[glass ? 'pc-glass-card' : 'bg-surface shadow-card', fill ? 'flex min-h-0 flex-col' : '']"
  >
    <header
      v-if="title || $slots.extra"
      class="mb-3 flex min-h-8 items-center justify-between gap-2"
      :class="fill ? 'shrink-0' : ''"
    >
      <!-- 标题 + 可选问号说明：包一层左组（问号紧贴标题），不传 tip 时零影响 -->
      <div class="flex min-w-0 items-center gap-1">
        <component
          :is="clickableTitle ? 'button' : 'h2'"
          :type="clickableTitle ? 'button' : undefined"
          class="text-sm font-semibold text-text"
          :class="
            clickableTitle
              ? 'pressable flex items-center gap-0.5 rounded text-left hover:text-primary active:scale-[0.98]'
              : ''
          "
          @click="clickableTitle && emit('title-click')"
        >
          {{ title }}
          <MenuIcon v-if="clickableTitle" name="chevronRight" :size="14" class="text-text-tertiary" />
        </component>
        <!-- BaseTooltip 须作为目标元素的子元素渲染（取 parentElement 定位，见其注释） -->
        <span v-if="tip" class="group/tip inline-flex cursor-help">
          <MenuIcon
            name="help"
            :size="14"
            class="text-text-tertiary transition-colors group-hover/tip:text-text"
          />
          <BaseTooltip :text="tip" placement="bottom" :wrap-width="280" />
        </span>
      </div>
      <slot name="extra" />
    </header>
    <slot />
  </section>
</template>
