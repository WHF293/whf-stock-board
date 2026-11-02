<script setup lang="ts">
import MenuIcon from './MenuIcon.vue';

/**
 * 公告条：图标 + 文案提示条，用于设置页轮询规则等全局说明
 *
 * tone：
 * - info（默认）：主色弱底（湖青），中性说明
 * - warn：琥珀警示底（Tailwind 默认琥珀色板，亮暗各一档），
 *   用于「操作不当会触发上游风控」类风险提示
 */
const props = withDefaults(
  defineProps<{
    /** 公告文案 */
    text: string;
    /** 款式：info 中性说明 / warn 风险警示 */
    tone?: 'info' | 'warn';
  }>(),
  { tone: 'info' },
);
</script>

<template>
  <div
    class="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-5"
    :class="
      props.tone === 'warn'
        ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
        : 'bg-primary-weak text-text-secondary'
    "
    role="note"
  >
    <MenuIcon
      :name="props.tone === 'warn' ? 'warn' : 'info'"
      :size="14"
      class="mt-0.5 shrink-0"
      :class="props.tone === 'warn' ? 'text-amber-500 dark:text-amber-400' : 'text-primary'"
    />
    <p class="min-w-0 flex-1">{{ text }}</p>
    <!-- 右侧动作区（可选）：原站跳转 / 重试按钮等 -->
    <slot name="action" />
  </div>
</template>
