<script setup lang="ts">
/**
 * Agent 分析（占位页）
 *
 * 当前为占位实现：居中展示占位插画 + 说明文案，页面骨架预留给后续
 * 接入 deepagents 实现的「本地 Agent」分析能力（自选标的诊断、板块
 * 联动解读、策略建议等）。路由与左侧导航已就位，后续替换 <section>
 * 内部实现即可，无需改动路由与菜单。
 */
</script>

<template>
  <section
    class="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center px-4 text-center"
  >
    <!-- 占位插画：本地 Agent 概念图（内联 SVG，跟随主题 currentColor） -->
    <div
      class="mb-8 flex h-40 w-40 items-center justify-center rounded-3xl border border-flat-weak bg-flat-weak/30"
    >
      <svg
        width="112"
        height="112"
        viewBox="0 0 120 120"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="text-primary"
        aria-hidden="true"
      >
        <!-- 机器人头部 -->
        <rect x="28" y="40" width="64" height="48" rx="10" />
        <!-- 天线 -->
        <path d="M60 40V26" />
        <circle cx="60" cy="20" r="5" />
        <!-- 双眼 -->
        <circle cx="46" cy="62" r="5" />
        <circle cx="74" cy="62" r="5" />
        <!-- 嘴 -->
        <path d="M44 80h32" />
        <!-- 底座连接线（暗示本地运行） -->
        <path d="M60 88v14" />
        <rect x="40" y="102" width="40" height="8" rx="4" />
      </svg>
    </div>

    <h2 class="text-2xl font-semibold text-text">Agent 分析</h2>
    <p class="mt-3 max-w-md text-sm text-text-secondary">
      本地智能体分析即将上线。本页面为占位实现，后续将接入
      <span class="font-medium text-text">deepagents</span>
      实现的本地 Agent，提供标的诊断、板块联动解读与策略建议等能力。
    </p>

    <!-- 待接入能力清单（占位提示，后续实现时移除） -->
    <ul
      class="mt-8 grid max-w-lg grid-cols-1 gap-3 text-left text-sm text-text-tertiary sm:grid-cols-2"
    >
      <li class="rounded-xl border border-flat-weak px-4 py-3">自选标的智能诊断</li>
      <li class="rounded-xl border border-flat-weak px-4 py-3">板块联动与资金解读</li>
      <li class="rounded-xl border border-flat-weak px-4 py-3">盘面异动自动归因</li>
      <li class="rounded-xl border border-flat-weak px-4 py-3">个性化策略建议</li>
    </ul>

    <p class="mt-8 text-xs text-text-tertiary">
      路由与左侧导航已就位，仅等待本地 Agent 能力接入
    </p>
  </section>
</template>
