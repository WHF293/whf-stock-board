<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { fetchAppReleases } from '../api/github-releases.api';
import { HOME_FEATURES } from '../constants/home.constants';
import type { ReleasesResult } from '../types/release.types';
import { formatDateIso } from '../utils/format.utils';

/**
 * 官网首页：Hero（定位 + 双平台下载入口）+ 软件截图墙（README 素材）
 * + 功能亮点 + 数据说明。版本徽标与下载直链取 Releases API，失败静默降级。
 */

// 截图素材来自仓库 docs/screenshots（与 README 同源），构建期打包进官网产物
import agentAnalysisShot from '../../../docs/screenshots/agent-analysis.png';
import boardCalendarShot from '../../../docs/screenshots/board-calendar.png';
import hotBoardShot from '../../../docs/screenshots/hot-board.png';
import hotNewsShot from '../../../docs/screenshots/hot-news.png';
import marketOverviewShot from '../../../docs/screenshots/market-overview.png';
import pluginWorkshopShot from '../../../docs/screenshots/plugin-workshop.png';

/** 截图墙条目 */
interface ShotItem {
  src: string;
  caption: string;
}

/** 主视觉 + 截图墙（README 六模块截图） */
const SHOT_ITEMS: ShotItem[] = [
  { src: boardCalendarShot, caption: '板块日历' },
  { src: hotNewsShot, caption: '热点新闻' },
  { src: hotBoardShot, caption: '今天炒什么' },
  { src: agentAnalysisShot, caption: 'Agent 分析' },
  { src: pluginWorkshopShot, caption: '插件工坊' },
];

/** Releases 拉取结果（失败保持 null，版本徽标隐藏、按钮降级跳下载页） */
const releases = ref<ReleasesResult | null>(null);

/** 最新版本组 */
const latestRelease = computed(() => releases.value?.releases[0] ?? null);

/** 最新版 Windows 安装包（优先 NSIS 向导） */
const windowsPackage = computed(
  () => latestRelease.value?.packages.find((pkg) => pkg.kind === 'nsis') ?? null,
);

/** 最新版 Android APK */
const androidPackage = computed(
  () => latestRelease.value?.packages.find((pkg) => pkg.kind === 'apk') ?? null,
);

/** 仓库全部 tag 数（首页「持续迭代」统计；接口不可用时显示占位符） */
const totalTagCount = computed(() => releases.value?.totalTagCount);

/** 灯箱：当前放大的截图（null = 关闭） */
const lightbox = ref<ShotItem | null>(null);

onMounted(async () => {
  try {
    releases.value = await fetchAppReleases();
  } catch {
    // 接口不可用：隐藏版本徽标、下载按钮降级为跳下载页，不打扰首屏
  }
});
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="mx-auto grid max-w-6xl items-center gap-8 px-5 pb-10 pt-12 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <span
          v-if="latestRelease"
          class="inline-flex items-center gap-1.5 rounded-full bg-primary-weak px-2.5 py-1 text-[11px] font-extrabold text-primary"
        >
          <i class="h-1.5 w-1.5 rounded-full bg-down" aria-hidden="true" />
          {{ latestRelease.tag }} · {{ formatDateIso(latestRelease.publishedAt) }} 发布
        </span>
        <h1 class="mt-3 text-[30px] font-extrabold leading-tight text-text md:text-4xl">
          A 股行情看板，<br>本机运行更安心
        </h1>
        <p class="mt-3 max-w-xl text-[13px] leading-relaxed text-text-secondary">
          行情总览 / 自选股 / 行情全景 / 资金动向 / 涨停异动 / 龙虎榜·大宗 / 今天炒什么，一站式桌面看板。
          数据经本机直连腾讯与东方财富公开接口，无自建服务器，自选与设置只存在你自己的电脑里。
        </p>
        <div class="mt-5 flex flex-wrap items-center gap-2.5">
          <!-- Windows 主按钮：有直链直下，接口不可用降级跳下载页 -->
          <a v-if="windowsPackage" :href="windowsPackage.url" class="s-btn s-btn--primary" :download="windowsPackage.fileName">
            ⬇ Windows 安装包
          </a>
          <RouterLink v-else to="/download" class="s-btn s-btn--primary">⬇ Windows 安装包</RouterLink>
          <a v-if="androidPackage" :href="androidPackage.url" class="s-btn s-btn--ghost" :download="androidPackage.fileName">⬇ Android APK</a>
          <RouterLink v-else to="/download" class="s-btn s-btn--ghost">⬇ Android APK</RouterLink>
          <RouterLink to="/download" class="s-btn s-btn--outline">查看全部版本</RouterLink>
        </div>
        <div class="mt-4 flex flex-wrap gap-2 text-[10.5px] font-bold">
          <span class="rounded-full bg-primary-weak px-2.5 py-1 text-primary">🪟 Windows 10+ · x64</span>
          <span class="rounded-full bg-primary-weak px-2.5 py-1 text-primary">🤖 Android 8.0+ · arm64</span>
          <span class="rounded-full bg-flat-weak px-2.5 py-1 text-text-secondary">免登录 · 免注册</span>
          <span class="rounded-full bg-flat-weak px-2.5 py-1 text-text-secondary">数据仅存本机</span>
        </div>
      </div>
      <figure class="s-hero-shot m-0">
        <img
          :src="marketOverviewShot"
          alt="市场总览截图"
          class="w-full rounded-xl border border-flat-weak shadow-[var(--shadow-card)]"
        >
        <figcaption class="mt-2 text-center text-[10.5px] text-text-tertiary">
          市场总览——大盘指数 · 涨跌分布 · 资金流向 · 板块热力图 · 成交额趋势
        </figcaption>
      </figure>
    </section>

    <!-- 统计条 -->
    <section class="mx-auto grid max-w-6xl grid-cols-2 gap-2.5 px-5 pb-8 md:grid-cols-4">
      <div class="s-card px-4 py-3">
        <b class="block font-mono text-lg text-text">7 大</b>
        <span class="text-[10.5px] text-text-tertiary">功能模块 · 全站快捷键</span>
      </div>
      <div class="s-card px-4 py-3">
        <b class="block font-mono text-lg text-text">{{ totalTagCount ?? '—' }} 个</b>
        <span class="text-[10.5px] text-text-tertiary">版本持续迭代（2026-09 起）</span>
      </div>
      <div class="s-card px-4 py-3">
        <b class="block font-mono text-lg text-text">5 平台</b>
        <span class="text-[10.5px] text-text-tertiary">热股榜聚合 · 6 源新闻</span>
      </div>
      <div class="s-card px-4 py-3">
        <b class="block font-mono text-lg text-text">AI Agent</b>
        <span class="text-[10.5px] text-text-tertiary">内置分析师 · 可查本机数据</span>
      </div>
    </section>

    <!-- 截图墙 -->
    <section class="mx-auto max-w-6xl px-5 pb-4">
      <h4 class="mb-2.5 text-sm font-bold text-text">软件截图（来自 README · 点击放大）</h4>
      <div class="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <figure
          v-for="shot in SHOT_ITEMS"
          :key="shot.caption"
          class="s-shot-item s-card m-0 cursor-zoom-in overflow-hidden"
          @click="lightbox = shot"
        >
          <img :src="shot.src" :alt="shot.caption">
          <figcaption class="px-2.5 py-1.5 text-[10.5px] font-bold text-text-secondary">{{ shot.caption }}</figcaption>
        </figure>
      </div>
    </section>

    <!-- 功能亮点 -->
    <section class="mx-auto max-w-6xl px-5 pb-4 pt-6">
      <h4 class="mb-2.5 text-sm font-bold text-text">功能亮点</h4>
      <div class="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3">
        <article v-for="feature in HOME_FEATURES" :key="feature.title" class="s-card p-4">
          <div class="mb-2 grid h-8 w-8 place-items-center rounded-lg bg-primary-weak text-[15px] text-primary" aria-hidden="true">
            {{ feature.icon }}
          </div>
          <h5 class="mb-1 text-[13px] font-bold text-text">{{ feature.title }}</h5>
          <p class="mb-2 text-[11.5px] leading-relaxed text-text-secondary">{{ feature.desc }}</p>
          <RouterLink
            :to="{ path: '/docs', query: { chapter: feature.chapterId } }"
            class="text-[11px] font-extrabold text-primary hover:underline"
          >
            了解{{ feature.title }} →
          </RouterLink>
        </article>
      </div>
    </section>

    <!-- 数据说明 -->
    <section class="mx-auto max-w-6xl px-5 pb-2 pt-4">
      <h4 class="mb-2.5 text-sm font-bold text-text">数据说明</h4>
      <div class="s-card px-4 py-3.5 text-[11.5px] leading-loose text-text-secondary">
        行情数据来自公开接口（<b class="text-text">腾讯 / 东方财富</b>，经 stock-sdk 聚合），仅在 A 股交易时段（09:15–15:00）自动轮询刷新，
        非交易时段仅进入页面时请求一次。<b class="text-text">数据仅供个人学习参考，不构成投资建议</b>；网页版已关闭
        （静态托管无法代理部分接口），请使用 PC / Android 客户端获取全量数据。自选股、账户与设置数据仅保存在本机。
      </div>
    </section>

    <!-- 截图灯箱 -->
    <Teleport to="body">
      <div v-if="lightbox" class="s-lightbox" @click="lightbox = null">
        <img :src="lightbox.src" :alt="lightbox.caption">
        <p class="m-0 text-xs text-white/80">{{ lightbox.caption }}（点击任意处关闭）</p>
      </div>
    </Teleport>
  </div>
</template>
