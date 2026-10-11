<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { fetchAppReleases } from '../api/github-releases.api';
import ReleaseGroup from '../components/ReleaseGroup.vue';
import ReleasePackageTable from '../components/ReleasePackageTable.vue';
import {
  MIN_DOWNLOAD_VERSION,
  RELEASE_PAGE_SIZE,
  RELEASES_CACHE_TTL_MS,
  SITE_RELEASES_URL,
} from '../constants/site.constants';
import type { ReleasePlatform, ReleasesResult } from '../types/release.types';
import { formatDateIso } from '../utils/format.utils';
import { detectVisitorPlatform } from '../utils/platform.utils';
import { orderByVisitorPlatform } from '../utils/release-asset.utils';

/**
 * 下载中心：最新版推荐区 + 历史版本分组分页（仅 v3.0.0+）
 *
 * 数据来自 GitHub Releases API（1h 缓存 + 过期缓存后台刷新 + 失败兜底）；
 * 分页与平台筛选写入 URL query（?platform=&page=），可直接分享定位。
 */

const route = useRoute();
const router = useRouter();

/** 平台筛选项（value 与 URL query 对应） */
const PLATFORM_FILTERS = [
  { value: 'all', label: '全部平台' },
  { value: 'windows', label: '🪟 Windows' },
  { value: 'android', label: '🤖 Android' },
] as const satisfies readonly { value: 'all' | ReleasePlatform; label: string }[];

/** 平台筛选值 */
type PlatformFilterValue = 'all' | ReleasePlatform;

/** 首次加载态（无数据时的骨架） */
const loading = ref(true);

/** 加载失败态（无可用缓存才出现） */
const loadError = ref(false);

/** 后台静默刷新中（有过期缓存兜底展示时） */
const refreshing = ref(false);

/** Releases 拉取结果 */
const result = ref<ReleasesResult | null>(null);

/** 平台筛选 */
const platformFilter = ref<PlatformFilterValue>('all');

/** 当前页（历史版本列表） */
const page = ref(1);

/** 访问端平台（决定推荐位排序） */
const visitorPlatform = detectVisitorPlatform();

/** 最新版本组（平台筛选后无对应资产时隐藏） */
const latestRelease = computed(() => {
  const first = result.value?.releases[0] ?? null;
  if (!first) return null;
  if (platformFilter.value !== 'all' && !first.packages.some((pkg) => pkg.platform === platformFilter.value)) return null;
  return first;
});

/** 最新版安装包（访问端平台优先） */
const latestPackages = computed(() =>
  latestRelease.value ? orderByVisitorPlatform(latestRelease.value.packages, visitorPlatform) : [],
);

/** 最新版展示的更新内容（最多 3 条，完整内容点 GitHub 看） */
const latestNotes = computed(() => (latestRelease.value ? latestRelease.value.notes.slice(0, 3) : []));

/** 历史版本列表（去掉最新版 + 平台筛选） */
const filteredRest = computed(() =>
  (result.value?.releases ?? []).slice(1).filter((release) =>
    platformFilter.value === 'all' || release.packages.some((pkg) => pkg.platform === platformFilter.value),
  ),
);

/** 总页数 */
const pageCount = computed(() => Math.max(1, Math.ceil(filteredRest.value.length / RELEASE_PAGE_SIZE)));

/** 展示页（深链页码越界时收敛到末页） */
const displayPage = computed(() => Math.min(page.value, pageCount.value));

/** 当前页的版本组 */
const pagedReleases = computed(() =>
  filteredRest.value.slice((displayPage.value - 1) * RELEASE_PAGE_SIZE, displayPage.value * RELEASE_PAGE_SIZE),
);

/** 空态：当前筛选组合下没有可下载版本 */
const showEmpty = computed(() => !loading.value && !loadError.value && filteredRest.value.length === 0);

/** 平台筛选计数（含最新版） */
const platformCounts = computed<Record<PlatformFilterValue, number>>(() => {
  const releases = result.value?.releases ?? [];
  const count = (platform: ReleasePlatform): number =>
    releases.filter((release) => release.packages.some((pkg) => pkg.platform === platform)).length;
  return { all: releases.length, windows: count('windows'), android: count('android') };
});

/** 分页器页码序列 */
const pageNumbers = computed(() => Array.from({ length: pageCount.value }, (_, index) => index + 1));

/**
 * 拉取数据（首屏；失败且无缓存时进错误态）
 * @param force 是否跳过新鲜缓存强制请求
 */
const load = async (force = false): Promise<void> => {
  loading.value = result.value === null;
  loadError.value = false;
  try {
    const fetched = await fetchAppReleases({ force });
    result.value = fetched;
    // 过期缓存兜底展示后，后台静默刷新（stale-while-revalidate）
    if (fetched.fromCache && fetched.cachedAt !== null && Date.now() - fetched.cachedAt > RELEASES_CACHE_TTL_MS) {
      void refreshInBackground();
    }
  } catch {
    if (result.value === null) loadError.value = true;
  }
};

/** 后台静默刷新（失败时保留旧缓存展示，不打扰） */
const refreshInBackground = async (): Promise<void> => {
  refreshing.value = true;
  try {
    result.value = await fetchAppReleases({ force: true });
  } catch {
    // 静默失败：继续展示旧缓存
  } finally {
    refreshing.value = false;
  }
};

/** 从路由 query 同步筛选与页码 */
const syncFromRoute = (): void => {
  const query = route.query;
  platformFilter.value = query.platform === 'windows' || query.platform === 'android' ? query.platform : 'all';
  const parsed = Number(query.page);
  page.value = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

/**
 * 写路由 query（undefined 项删除）
 * @param patch 变更项
 */
const updateQuery = (patch: Record<string, string | undefined>): void => {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) {
    if (typeof value === 'string' && value !== '') query[key] = value;
  }
  void router.replace({ query });
};

/**
 * 切换平台筛选（回到第 1 页）
 * @param value 目标筛选
 */
const setPlatformFilter = (value: PlatformFilterValue): void => {
  if (platformFilter.value === value) return;
  updateQuery({ platform: value === 'all' ? undefined : value, page: undefined });
};

/**
 * 翻页（滚动回版本列表顶部）
 * @param target 目标页码
 */
const goPage = (target: number): void => {
  const clamped = Math.min(Math.max(1, target), pageCount.value);
  if (clamped === displayPage.value) return;
  updateQuery({ page: clamped === 1 ? undefined : String(clamped) });
  document.getElementById('all-releases')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/** 清除筛选（空态按钮） */
const clearFilter = (): void => {
  setPlatformFilter('all');
};

watch(() => route.query, syncFromRoute);

onMounted(() => {
  syncFromRoute();
  void load();
});
</script>

<template>
  <div class="mx-auto max-w-6xl px-5">
    <!-- 页头 -->
    <div class="pb-2 pt-8">
      <h2 class="m-0 text-xl font-extrabold text-text">下载中心</h2>
      <p class="m-0 mt-1 text-xs text-text-secondary">
        安装包由 GitHub Actions 从公开源码自动构建并发布到 GitHub Releases，本页实时同步 ·
        仅提供 v{{ MIN_DOWNLOAD_VERSION }} 及之后版本（{{ result?.releases.length ?? '—' }} 个）
      </p>
    </div>

    <!-- ① 首次加载骨架 -->
    <template v-if="loading && result === null">
      <div class="s-card mt-3.5 p-4">
        <div class="flex items-center gap-2.5">
          <span class="s-skeleton h-6 w-24" />
          <span class="s-skeleton h-4 w-20" />
          <span class="s-skeleton h-4 w-24" />
        </div>
        <span class="s-skeleton mt-3 block h-3 w-3/4" />
        <span class="s-skeleton mt-2 block h-3 w-1/2" />
        <span class="s-skeleton mt-4 block h-24 rounded-xl" />
      </div>
      <div v-for="index in 2" :key="index" class="s-card mt-3 overflow-hidden">
        <div class="flex items-center gap-2 border-b border-flat-weak bg-bg px-4 py-3">
          <span class="s-skeleton h-4 w-16" />
          <span class="s-skeleton h-4 w-10" />
          <span class="s-skeleton ml-auto h-4 w-20" />
        </div>
        <div class="p-4">
          <span class="s-skeleton block h-16 rounded-xl" />
        </div>
      </div>
    </template>

    <!-- ② 加载失败（限流且无缓存） -->
    <div v-else-if="loadError" class="s-card mt-3.5 flex flex-col items-center px-6 py-10 text-center">
      <div class="mb-3 grid h-16 w-16 place-items-center rounded-full bg-up-weak text-3xl font-black text-up" aria-hidden="true">!</div>
      <div class="text-[15px] font-extrabold text-text">下载列表暂时加载失败</div>
      <p class="mb-3 mt-1.5 max-w-md text-xs leading-relaxed text-text-secondary">
        GitHub 匿名接口每小时限 60 次请求，当前可能已触发限流或网络异常。<br>
        你可以直接前往 GitHub Releases 下载全部版本，或稍后重试。
      </p>
      <div class="flex gap-2">
        <button type="button" class="s-btn s-btn--primary s-btn--sm" @click="load(true)">↻ 重新加载</button>
        <a :href="SITE_RELEASES_URL" target="_blank" rel="noopener" class="s-btn s-btn--outline s-btn--sm">前往 GitHub Releases ↗</a>
      </div>
    </div>

    <!-- ③ 数据就绪 -->
    <template v-else>
      <!-- 最新版推荐区 -->
      <article v-if="latestRelease" class="s-card mt-3.5 border border-flat-weak p-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-[22px] font-extrabold text-text">{{ latestRelease.tag }}</span>
          <span class="s-badge s-badge--latest">✓ Latest 最新版</span>
          <span v-for="platform in [...new Set(latestRelease.packages.map((pkg) => pkg.platform))]" :key="platform" class="s-badge s-badge--plat">
            {{ platform === 'windows' ? '🪟 Windows' : '🤖 Android' }}
          </span>
          <span v-if="latestRelease.publishedAt" class="s-badge s-badge--muted">{{ formatDateIso(latestRelease.publishedAt) }} 发布</span>
          <a :href="latestRelease.htmlUrl" target="_blank" rel="noopener" class="ml-auto text-[10.5px] font-extrabold text-primary hover:underline">
            在 GitHub 查看此版本 ↗
          </a>
        </div>
        <ul v-if="latestNotes.length > 0" class="m-0 mt-2.5 list-none space-y-1 pl-0 text-xs leading-relaxed text-text-secondary">
          <li v-for="(note, index) in latestNotes" :key="index" class="relative pl-4 before:absolute before:left-1 before:top-2 before:h-1.5 before:w-1.5 before:rounded-full before:bg-primary">
            {{ note }}
          </li>
        </ul>
        <div class="mt-3 overflow-x-auto">
          <ReleasePackageTable :packages="latestPackages" />
        </div>
        <p v-if="visitorPlatform === 'android'" class="m-0 mt-2 text-[10.5px] text-text-tertiary">
          检测到你在使用 Android 设备，APK 已排在推荐位
        </p>
      </article>

      <!-- 安全提示 / 升级方式（固定文案，与 Release 安全提示逐字一致口径） -->
      <div class="mt-3 flex gap-2.5 rounded-lg bg-up-weak px-3.5 py-2.5 text-[11.5px] leading-relaxed text-up">
        <span class="text-sm" aria-hidden="true">⚠</span>
        <span>
          <b>首次运行安全提示：</b>本应用未购买代码签名证书，Windows 首次运行可能提示「已保护你的电脑」——点击<b>「更多信息」→「仍要运行」</b>即可；
          Android 安装时 Play Protect 可能提示，选择<b>「仍要安装」</b>。安装包均由 GitHub Actions 从公开源码构建，可自行审计。
        </span>
      </div>
      <div class="mt-2 flex gap-2.5 rounded-lg bg-flat-weak px-3.5 py-2.5 text-[11px] leading-relaxed text-text-secondary">
        <span aria-hidden="true">✓</span>
        <span>
          <b class="text-text">升级方式：</b>直接下载新版安装包覆盖安装，无需卸载；自选股 / 设置 / 主题等数据存于本机用户数据目录，升级不受影响。
        </span>
      </div>

      <!-- 全部版本：筛选 + 分组分页 -->
      <div id="all-releases" class="pb-2 pt-7">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="m-0 mr-1 text-base font-extrabold text-text">全部版本</h3>
          <span
            v-if="refreshing"
            class="s-badge s-badge--muted"
          >同步最新数据中…</span>
        </div>
        <p class="m-0 mt-1 text-[11.5px] text-text-tertiary">
          共 {{ result?.releases.length ?? 0 }} 个版本 · 更早的历史版本不提供下载
        </p>
        <div class="mt-2.5 flex flex-wrap gap-2">
          <button
            v-for="filter in PLATFORM_FILTERS"
            :key="filter.value"
            type="button"
            class="s-chip"
            :class="{ 'is-active': platformFilter === filter.value }"
            @click="setPlatformFilter(filter.value)"
          >
            {{ filter.label }} <span class="ml-0.5 font-mono text-[10px] opacity-75">{{ platformCounts[filter.value] }}</span>
          </button>
        </div>
      </div>

      <!-- 空态 -->
      <div v-if="showEmpty" class="s-card mt-3 flex flex-col items-center px-6 py-10 text-center">
        <div class="mb-3 grid h-16 w-16 place-items-center rounded-xl bg-flat-weak text-3xl" aria-hidden="true">🤖</div>
        <div class="text-[15px] font-extrabold text-text">当前筛选条件下没有可下载的版本</div>
        <p class="mb-3 mt-1.5 text-xs leading-relaxed text-text-secondary">
          Android APK 自 v4.0.0 起提供，更早版本只有 Windows 安装包。<br>切换到「全部平台」查看完整列表。
        </p>
        <button type="button" class="s-btn s-btn--primary s-btn--sm" @click="clearFilter">清除筛选</button>
      </div>

      <!-- 版本分组列表 -->
      <template v-else>
        <div v-for="release in pagedReleases" :key="release.tag" class="mt-3">
          <ReleaseGroup :release="release" />
        </div>

        <!-- 分页器 -->
        <nav class="mt-4 flex flex-wrap items-center justify-center gap-1.5" aria-label="版本分页">
          <button type="button" class="s-btn s-btn--ghost s-btn--sm" :disabled="displayPage <= 1" @click="goPage(displayPage - 1)">«</button>
          <button
            v-for="pageNumber in pageNumbers"
            :key="pageNumber"
            type="button"
            class="s-btn s-btn--page"
            :class="pageNumber === displayPage ? 's-btn--primary' : 's-btn--ghost'"
            @click="goPage(pageNumber)"
          >
            {{ pageNumber }}
          </button>
          <button type="button" class="s-btn s-btn--ghost s-btn--sm" :disabled="displayPage >= pageCount" @click="goPage(displayPage + 1)">»</button>
          <span class="ml-2 text-[10.5px] text-text-tertiary">
            共 {{ filteredRest.length }} 个版本 · 每页 {{ RELEASE_PAGE_SIZE }} 个 · 第 {{ displayPage }} / {{ pageCount }} 页
          </span>
        </nav>
        <p class="m-0 py-3 text-center text-[10.5px] text-text-tertiary">
          分页为前端分页（数据一次拉全量并缓存 1 小时）；页码与筛选写入链接，可直接分享定位
        </p>
      </template>
    </template>
  </div>
</template>
