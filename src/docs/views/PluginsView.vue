<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { fetchPluginCatalog } from '../api/plugin-market.api';
import { DOCS_TABS, PLUGIN_REPO_URL } from '../constants/site.constants';
import type { PluginCatalog } from '../types/plugin.types';
import { formatBytes, formatDateIso } from '../utils/format.utils';

/**
 * 官网插件生态页：官方插件清单动态取自插件仓库最新 Release 的 zip 产物
 * （插件数量 / 版本 / 大小全由数据源决定，名称与描述从仓库 README 补齐），
 * 只提供最新版 zip 下载，历史版本与源码导流到插件仓库。
 */

/** 拉取结果（失败保持 null） */
const catalog = ref<(PluginCatalog & { fromCache: boolean }) | null>(null);

/** 首次加载态 */
const loading = ref(true);

/** 加载失败态（无可用缓存才出现） */
const loadError = ref(false);

/** 产物发布日期 */
const publishedDate = computed(() =>
  catalog.value ? formatDateIso(catalog.value.publishedAt) : '',
);

onMounted(async () => {
  try {
    catalog.value = await fetchPluginCatalog();
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="mx-auto max-w-6xl px-5">
    <!-- 页头 -->
    <div class="pb-2 pt-8">
      <h2 class="m-0 text-xl font-extrabold text-text">插件生态</h2>
      <p class="m-0 mt-1 max-w-3xl text-xs leading-relaxed text-text-secondary">
        应用内置插件内核：侧栏面板、页面、顶栏工具、快捷键、个股详情扩展区、Agent 数据工具都由插件贡献，
        插件工坊里即装即用、卸载即全量撤销。下列官方插件以 zip 产物包分发，
        清单与版本实时取自插件仓库最新 Release 产物。
      </p>
    </div>

    <!-- ① 首次加载骨架 -->
    <template v-if="loading">
      <div v-for="index in 3" :key="index" class="s-card mt-3 p-4">
        <div class="flex items-center gap-2.5">
          <span class="s-skeleton h-4 w-24" />
          <span class="s-skeleton h-4 w-16" />
          <span class="s-skeleton ml-auto h-7 w-20 rounded-lg" />
        </div>
        <span class="s-skeleton mt-3 block h-3 w-3/4" />
        <span class="s-skeleton mt-2 block h-3 w-1/2" />
      </div>
    </template>

    <!-- ② 加载失败（限流且无缓存） -->
    <div v-else-if="loadError" class="s-card mt-3.5 flex flex-col items-center px-6 py-10 text-center">
      <div class="mb-3 grid h-16 w-16 place-items-center rounded-full bg-up-weak text-3xl font-black text-up" aria-hidden="true">!</div>
      <div class="text-[15px] font-extrabold text-text">插件清单暂时加载失败</div>
      <p class="mb-3 mt-1.5 max-w-md text-xs leading-relaxed text-text-secondary">
        插件清单来自插件仓库的 GitHub 接口（匿名限流 60 次/小时），当前可能已触发限流。<br>
        你可以直接前往插件仓库浏览全部插件与历史版本。
      </p>
      <div class="flex gap-2">
        <a :href="PLUGIN_REPO_URL" target="_blank" rel="noopener" class="s-btn s-btn--outline s-btn--sm">前往插件仓库 ↗</a>
      </div>
    </div>

    <!-- ③ 数据就绪 -->
    <template v-else-if="catalog">
      <p class="m-0 mt-1 text-[11px] text-text-tertiary">
        共 {{ catalog.plugins.length }} 个官方插件 · 最新产物 {{ catalog.tag }}<template v-if="publishedDate">（{{ publishedDate }} 发布）</template>
        <a :href="catalog.releaseUrl" target="_blank" rel="noopener" class="ml-1 font-bold text-primary hover:underline">该版本 Release ↗</a>
      </p>

      <!-- 空态：最新产物里没有插件（正常不会出现，兜住） -->
      <div v-if="catalog.plugins.length === 0" class="s-card mt-3.5 flex flex-col items-center px-6 py-10 text-center">
        <div class="mb-3 grid h-16 w-16 place-items-center rounded-xl bg-flat-weak text-3xl" aria-hidden="true">⬡</div>
        <div class="text-[15px] font-extrabold text-text">最新产物里还没有插件</div>
        <p class="mb-3 mt-1.5 text-xs leading-relaxed text-text-secondary">可能是出包流水线异常，请前往插件仓库确认。</p>
        <a :href="PLUGIN_REPO_URL" target="_blank" rel="noopener" class="s-btn s-btn--outline s-btn--sm">前往插件仓库 ↗</a>
      </div>

      <!-- 插件卡片 -->
      <article v-for="plugin in catalog.plugins" :key="plugin.id" class="s-card mt-3.5 p-4">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="m-0 text-[15px] font-extrabold text-text">{{ plugin.name }}</h3>
          <span class="s-badge s-badge--plat">v{{ plugin.version }}</span>
          <span class="font-mono text-[10.5px] text-text-tertiary">{{ plugin.id }}</span>
          <div class="ml-auto flex items-center gap-2">
            <a :href="plugin.downloadUrl" class="s-btn s-btn--primary s-btn--sm" :download="plugin.zipName">⬇ 下载最新版（{{ formatBytes(plugin.zipSize) }}）</a>
          </div>
        </div>
        <p v-if="plugin.description" class="mb-2 mt-2.5 text-xs leading-relaxed text-text-secondary">{{ plugin.description }}</p>
        <div class="mt-2.5 flex flex-wrap items-center gap-3 text-[10.5px]">
          <a :href="PLUGIN_REPO_URL" target="_blank" rel="noopener" class="font-bold text-primary hover:underline">历史版本与源码 → 插件仓库 ↗</a>
          <span class="font-mono text-text-tertiary">{{ plugin.zipName }}</span>
        </div>
      </article>

      <!-- 安装方式 -->
      <div class="mt-3 flex gap-2.5 rounded-lg bg-flat-weak px-3.5 py-2.5 text-[11px] leading-relaxed text-text-secondary">
        <span aria-hidden="true">✓</span>
        <span>
          <b class="text-text">安装方式：</b>打开应用 → 插件工坊 →「插件市场」可**在线安装**（默认最新版，
          可展开历史版本选装旧版；还支持添加第三方 GitHub 插件仓库源）；
          或「安装自定义插件」→ 选择下载的 .zip 包，解析预览通过后确认安装；
          与已装插件同 id 时为升级覆盖（插件数据保留）。只安装来源可信的插件。
        </span>
      </div>

      <!-- 开发者导流 -->
      <div class="mt-3 mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-flat-weak bg-primary-weak/60 px-4 py-3">
        <div>
          <b class="text-[12.5px] text-text">想自己写一个插件？</b>
          <p class="m-0 mt-0.5 text-[11px] text-text-secondary">九大贡献点、宿主服务与渲染函数速成，见软件文档的「开发者指南」。</p>
        </div>
        <RouterLink
          :to="{ path: '/docs', query: { tab: DOCS_TABS[1]?.value } }"
          class="s-btn s-btn--primary s-btn--sm ml-auto"
        >
          查看开发者指南
        </RouterLink>
      </div>
    </template>
  </div>
</template>
