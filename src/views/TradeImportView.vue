<script setup lang="ts">
/**
 * 交割单导入（占位页）
 *
 * 当前为占位实现：居中展示占位插画 + 说明文案。
 * 后续实现：导入券商交割单（CSV / Excel）→ 解析成交记录 → 落地本地
 * SQLite（tauri-plugin-sql），供「股票账户」页与「Agent 分析」消费。
 * 技术方案详见 `.ai/开发方案/2026-09-14-交割单与股票账户模块规划.md`。
 * 路由与左侧导航已就位，后续替换 <section> 内部实现即可。
 */
</script>

<template>
  <section
    class="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center px-4 text-center"
  >
    <!-- 占位插画：单据 + 导入箭头（内联 SVG，跟随 currentColor） -->
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
        <!-- 单据纸张 -->
        <path d="M34 14h36l20 20v72a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" />
        <!-- 折角 -->
        <path d="M70 14v20h20" />
        <!-- 文本行 -->
        <path d="M44 56h20M44 68h32" />
        <!-- 导入箭头 -->
        <path d="M60 104V82" />
        <path d="M50 92l10-10 10 10" />
      </svg>
    </div>

    <h2 class="text-2xl font-semibold text-text">交割单导入</h2>
    <p class="mt-3 max-w-md text-sm text-text-secondary">
      导入券商交割单，自动解析成交记录并本地留存。数据就绪后，
      <span class="font-medium text-text">Agent 即可分析你的账户情况</span>，K
      线也能显示买卖点。
    </p>

    <!-- 待接入能力清单（占位提示，后续实现时移除） -->
    <ul
      class="mt-8 grid max-w-lg grid-cols-1 gap-3 text-left text-sm text-text-tertiary sm:grid-cols-2"
    >
      <li class="rounded-xl border border-flat-weak px-4 py-3">券商交割单导入（CSV / Excel）</li>
      <li class="rounded-xl border border-flat-weak px-4 py-3">字段识别与重复记录去重</li>
      <li class="rounded-xl border border-flat-weak px-4 py-3">成交记录查询与导出</li>
      <li class="rounded-xl border border-flat-weak px-4 py-3">本地 SQLite 落库（离线可用）</li>
    </ul>

    <p class="mt-8 text-xs text-text-tertiary">
      存储方案：SQLite（tauri-plugin-sql）· 仅桌面端可用 · 路由与左侧导航已就位
    </p>
  </section>
</template>
