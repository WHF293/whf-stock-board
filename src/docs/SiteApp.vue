<script setup lang="ts">
import { useRoute } from 'vue-router';
import { SITE_ISSUES_URL, SITE_RELEASES_URL, SITE_REPO_URL } from './constants/site.constants';

/** 站点壳：顶栏导航 + 路由出口 + 页脚（官网固定亮色，不做明暗切换） */

const route = useRoute();

/** 顶栏入口（name 用于激活态比对） */
const NAV_ITEMS = [
  { name: 'home', label: '首页' },
  { name: 'docs', label: '软件文档' },
  { name: 'download', label: '下载中心' },
  { name: 'plugins', label: '插件生态' },
] as const;
</script>

<template>
  <div class="min-h-screen bg-bg text-text">
    <!-- 顶栏 -->
    <header class="sticky top-0 z-40 border-b border-flat-weak bg-surface">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-5 px-5">
        <RouterLink to="/" class="flex items-center gap-2 text-[15px] font-extrabold text-text">
          <img src="./logo.png" alt="" class="h-7 w-7 rounded-lg" aria-hidden="true">
          股票看板
        </RouterLink>
        <nav class="flex items-center gap-1 text-[13px] font-semibold text-text-secondary">
          <RouterLink
            v-for="item in NAV_ITEMS"
            :key="item.name"
            :to="{ name: item.name }"
            class="rounded-lg px-3 py-1.5 transition-colors hover:bg-flat-weak"
            :class="route.name === item.name ? 'bg-primary-weak text-primary' : 'text-text-secondary hover:text-text'"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <a
          :href="SITE_REPO_URL"
          target="_blank"
          rel="noopener"
          class="ml-auto flex items-center gap-1.5 rounded-lg bg-flat-weak px-3 py-1.5 text-xs font-bold text-text transition-opacity hover:opacity-80"
        >★ GitHub</a>
      </div>
    </header>

    <main>
      <RouterView />
    </main>

    <!-- 页脚 -->
    <footer class="mt-16 bg-flat-weak text-text-secondary">
      <div class="mx-auto grid max-w-6xl gap-8 px-5 py-9 text-[11.5px] leading-relaxed md:grid-cols-3">
        <div>
          <div class="mb-2 flex items-center gap-2 text-[13px] font-extrabold text-text">
            <img src="./logo.png" alt="" class="h-6 w-6 rounded-md" aria-hidden="true">
            股票看板
          </div>
          <p>
            A 股看板应用（个人学习用）：浏览器 SPA + Tauri 2 桌面客户端 + Android 客户端共用同一套
            Vue 3 代码库，数据仅存本机。
          </p>
        </div>
        <div>
          <h6 class="mb-2 text-xs font-bold text-text">站点</h6>
          <RouterLink to="/" class="block py-0.5 text-primary hover:underline">首页</RouterLink>
          <RouterLink to="/docs" class="block py-0.5 text-primary hover:underline">软件文档（白皮书）</RouterLink>
          <RouterLink to="/download" class="block py-0.5 text-primary hover:underline">下载中心</RouterLink>
          <RouterLink to="/plugins" class="block py-0.5 text-primary hover:underline">插件生态</RouterLink>
        </div>
        <div>
          <h6 class="mb-2 text-xs font-bold text-text">相关</h6>
          <a :href="SITE_RELEASES_URL" target="_blank" rel="noopener" class="block py-0.5 text-primary hover:underline">更新日志（GitHub Releases）</a>
          <a :href="SITE_REPO_URL" target="_blank" rel="noopener" class="block py-0.5 text-primary hover:underline">GitHub 仓库</a>
          <a :href="SITE_ISSUES_URL" target="_blank" rel="noopener" class="block py-0.5 text-primary hover:underline">问题反馈 Issues</a>
        </div>
      </div>
      <div class="border-t border-flat-weak">
        <div class="mx-auto max-w-6xl px-5 py-4 text-[11px] text-text-tertiary">
          © 2026 WHF · 本应用由 AI 编码代理（ZCode × GLM）全程实现 ·
          行情数据仅供个人学习参考，不构成投资建议
        </div>
      </div>
    </footer>
  </div>
</template>
