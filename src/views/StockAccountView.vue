<script setup lang="ts">
/**
 * 股票账户（占位页）
 *
 * 当前为占位实现：居中展示占位插画 + 说明文案。
 * 后续接入「交割单 / 券商账户」数据后，本页展示持仓、成本、浮动盈亏、
 * 账户资产曲线等；数据侧计划用 SQLite（tauri-plugin-sql）本地落库，
 * 详见 `.ai/开发方案/2026-09-14-交割单与股票账户模块规划.md`。
 * 路由与左侧导航已就位，后续替换 <section> 内部实现即可。
 */
</script>

<template>
  <section
    class="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center px-4 text-center"
  >
    <!-- 占位插画：账户卡片概念图（内联 SVG，跟随 currentColor） -->
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
        <!-- 账户卡片 -->
        <rect x="16" y="34" width="88" height="56" rx="10" />
        <!-- 磁条 -->
        <path d="M16 50h88" />
        <!-- 余额标签 -->
        <path d="M32 68h20" />
        <!-- 芯片 -->
        <rect x="76" y="64" width="16" height="12" rx="3" />
        <!-- 账户主体（人像，暗示「我的账户」） -->
        <circle cx="60" cy="18" r="8" />
        <path d="M46 30a14 14 0 0 1 28 0" />
      </svg>
    </div>

    <h2 class="text-2xl font-semibold text-text">股票账户</h2>
    <p class="mt-3 max-w-md text-sm text-text-secondary">
      账户视图建设中。导入交割单后，本页将汇总你的持仓与盈亏，并支持
      <span class="font-medium text-text">在个股 K 线上标注买卖点</span>。
    </p>

    <!-- 待接入能力清单（占位提示，后续实现时移除） -->
    <ul
      class="mt-8 grid max-w-lg grid-cols-1 gap-3 text-left text-sm text-text-tertiary sm:grid-cols-2"
    >
      <li class="rounded-xl border border-flat-weak px-4 py-3">持仓总览（市值 / 成本 / 浮动盈亏）</li>
      <li class="rounded-xl border border-flat-weak px-4 py-3">账户资产与收益曲线</li>
      <li class="rounded-xl border border-flat-weak px-4 py-3">持仓分布与行业结构</li>
      <li class="rounded-xl border border-flat-weak px-4 py-3">个股 K 线买卖点（B / S）标注</li>
    </ul>

    <p class="mt-8 text-xs text-text-tertiary">
      数据来源：交割单导入 · 本地 SQLite 存储 · 路由与左侧导航已就位
    </p>
  </section>
</template>
