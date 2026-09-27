<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '../../utils/render-markdown';

/**
 * Markdown 正文渲染（Agent 助手消息用）
 *
 * 接收原文（含流式半截文本），经 renderMarkdown（markdown-it + DOMPurify）
 * 解析为消毒后的 HTML 注入；排版样式在 .md-body 全局类上（v-html 内容
 * 不受 scoped 作用域约束），配色全部走主题 token，明暗 / 主题色自动跟随
 */

const props = defineProps<{
  /** markdown 原文（流式期间逐字增长，组件随内容变化重新解析） */
  content: string;
}>();

/** 消毒后的 HTML（v-html 注入） */
const html = computed(() => renderMarkdown(props.content));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html —— 内容已经 DOMPurify 白名单消毒 -->
  <div class="md-body" v-html="html" />
</template>

<!-- 非 scoped：v-html 注入的节点拿不到 scoped data 属性，样式挂在唯一类名 .md-body 上 -->
<style>
.md-body {
  line-height: 1.65;
  overflow-wrap: break-word;
}
.md-body > :first-child {
  margin-top: 0;
}
.md-body > :last-child {
  margin-bottom: 0;
}
.md-body p {
  margin: 0.5em 0;
}
.md-body h1,
.md-body h2,
.md-body h3,
.md-body h4 {
  margin: 1em 0 0.4em;
  font-weight: 600;
  line-height: 1.4;
}
.md-body h1 {
  font-size: 1.25em;
}
.md-body h2 {
  font-size: 1.15em;
}
.md-body h3 {
  font-size: 1.05em;
}
.md-body h4 {
  font-size: 1em;
}
.md-body ul,
.md-body ol {
  margin: 0.5em 0;
  padding-left: 1.5em;
}
.md-body ul {
  list-style: disc;
}
.md-body ol {
  list-style: decimal;
}
.md-body li {
  margin: 0.2em 0;
}
.md-body table {
  display: block;
  width: max-content;
  max-width: 100%;
  margin: 0.6em 0;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.92em;
}
.md-body th,
.md-body td {
  padding: 0.35em 0.7em;
  border: 1px solid var(--color-flat-weak);
  text-align: left;
}
.md-body th {
  background: var(--color-flat-weak);
  font-weight: 600;
}
.md-body code {
  padding: 0.1em 0.4em;
  border-radius: 5px;
  background: var(--color-flat-weak);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
}
.md-body pre {
  margin: 0.6em 0;
  padding: 0.75em 1em;
  border-radius: 8px;
  background: var(--color-flat-weak);
  overflow-x: auto;
}
.md-body pre code {
  padding: 0;
  background: transparent;
  font-size: 0.88em;
}
.md-body blockquote {
  margin: 0.6em 0;
  padding-left: 0.8em;
  border-left: 3px solid var(--color-flat-weak);
  color: var(--color-text-secondary);
}
.md-body a {
  color: var(--color-primary);
}
.md-body hr {
  margin: 1em 0;
  border: none;
  border-top: 1px solid var(--color-flat-weak);
}
</style>
