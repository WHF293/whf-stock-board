<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { GUIDE_CHAPTERS } from '../../common/constants/whitepaper-content';
import type { GuideChapter } from '../../common/types/whitepaper.types';
import { parseQuery } from '../../common/utils/whitepaper-search';
import {
  DOCS_DEV_CHAPTER_IDS,
  DOCS_HITS_PER_CHAPTER,
  DOCS_HITS_TOTAL_LIMIT,
  DOCS_TABS,
  type DocsTabValue,
} from '../constants/site.constants';
import {
  buildWhitepaperSearchDocs,
  searchWhitepaper,
  type WhitepaperSearchGroup,
} from '../utils/whitepaper-search-index';

/**
 * 官网文档中心：软件白皮书整站渲染
 *
 * 内容与客户端单源（GUIDE_CHAPTERS），双 Tab 归组、章节目录（滚动高亮）、
 * 关键字搜索（与客户端同款分词 / 摘要工具与展示阈值）均对齐客户端白皮书。
 */

const route = useRoute();

/** 当前文档 Tab */
const activeTab = ref<DocsTabValue>('user');

/** 按 Tab 归组后的章节（dev 章节归「开发者指南」，其余归「使用说明」） */
const tabChapters = computed<Record<DocsTabValue, GuideChapter[]>>(() => ({
  user: GUIDE_CHAPTERS.filter((chapter) => !DOCS_DEV_CHAPTER_IDS.has(chapter.id)),
  dev: GUIDE_CHAPTERS.filter((chapter) => DOCS_DEV_CHAPTER_IDS.has(chapter.id)),
}));

/** 当前 Tab 下的章节（目录与正文共用） */
const chapters = computed(() => tabChapters.value[activeTab.value]);

/** 目录分组：相邻同 tag 章节归为一组（tag 顺序随内容数据走） */
const tocGroups = computed(() => {
  const groups: { tag: string; chapters: GuideChapter[] }[] = [];
  for (const chapter of chapters.value) {
    const last = groups[groups.length - 1];
    if (last && last.tag === chapter.tag) last.chapters.push(chapter);
    else groups.push({ tag: chapter.tag, chapters: [chapter] });
  }
  return groups;
});

/* ------------------------------ 滚动高亮 / 章节跳转 ------------------------------ */

/** 当前阅读到的章节 id（滚动监听驱动，驱动目录高亮） */
const activeChapterId = ref('');

/** 定位后短暂高亮的章节 id */
const flashChapterId = ref('');

/** 闪烁计时器 */
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** 章节根元素注册表（模板函数 ref 填充） */
const sectionRefs = new Map<string, HTMLElement>();

/**
 * 模板函数 ref：登记章节根元素
 * @param id 章节 id
 * @returns ref 回调
 */
const setSectionRef = (id: string) => (el: unknown): void => {
  if (el instanceof HTMLElement) sectionRefs.set(id, el);
};

/** 滚动监听：取视口顶部以下最近的章节为当前章节 */
const onScroll = (): void => {
  let current = chapters.value[0]?.id ?? '';
  for (const chapter of chapters.value) {
    const el = sectionRefs.get(chapter.id);
    if (el && el.getBoundingClientRect().top <= 96) current = chapter.id;
  }
  activeChapterId.value = current;
};

/**
 * 滚动定位到章节并短暂高亮
 * @param id 章节 id
 */
const scrollToChapter = (id: string): void => {
  const el = sectionRefs.get(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  flashChapterId.value = id;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashChapterId.value = '';
  }, 1300);
};

/**
 * 跳转到章节（章节不在当前 Tab 时先切 Tab 再定位）
 * @param id 章节 id
 */
const jumpToChapter = (id: string): void => {
  const exists = chapters.value.some((chapter) => chapter.id === id);
  if (!exists) activeTab.value = DOCS_DEV_CHAPTER_IDS.has(id) ? 'dev' : 'user';
  void nextTick(() => scrollToChapter(id));
};

/**
 * 切换文档 Tab（清空旧章节注册表，滚动位置回到文档区顶部）
 * @param tab 目标 Tab
 */
const switchTab = (tab: DocsTabValue): void => {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  sectionRefs.clear();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  void nextTick(onScroll);
};

/* ------------------------------ 关键字搜索 ------------------------------ */

/** 全量搜索索引（静态内容，构建一次） */
const SEARCH_DOCS = buildWhitepaperSearchDocs(GUIDE_CHAPTERS);

/** 搜索关键字 */
const searchKeyword = ref('');

/** 输入框聚焦态（控制结果面板显隐） */
const searchFocused = ref(false);

/** 词条 */
const searchTerms = computed(() => parseQuery(searchKeyword.value));

/** 是否处于搜索态 */
const isSearching = computed(() => searchTerms.value.length > 0);

/** 是否显示结果面板 */
const showSearchPanel = computed(() => searchFocused.value && isSearching.value);

/** 全量命中分组（未截断） */
const allSearchGroups = computed(() => searchWhitepaper(SEARCH_DOCS, searchTerms.value));

/** 命中总条数 */
const searchHitCount = computed(() => allSearchGroups.value.hitCount);

/** 展示用分组：每章截断 + 总量截断（与客户端白皮书同款阈值） */
const searchDisplayGroups = computed<WhitepaperSearchGroup[]>(() => {
  let budget = DOCS_HITS_TOTAL_LIMIT;
  const groups: WhitepaperSearchGroup[] = [];
  for (const group of allSearchGroups.value.groups) {
    if (budget <= 0) break;
    const hits = group.hits.slice(0, Math.min(DOCS_HITS_PER_CHAPTER, budget));
    budget -= hits.length;
    groups.push({ ...group, hits });
  }
  return groups;
});

/**
 * 选中搜索结果：关面板、跳章节
 * @param chapterId 章节 id
 */
const pickSearchHit = (chapterId: string): void => {
  searchFocused.value = false;
  jumpToChapter(chapterId);
};

/* ------------------------------ 路由定位（?tab= / ?chapter=） ------------------------------ */

/** 应用路由参数（功能亮点卡「了解更多」与 ?tab=dev 直达都走这里） */
const applyRouteQuery = (): void => {
  if (route.query.tab === 'dev') activeTab.value = 'dev';
  const chapter = typeof route.query.chapter === 'string' ? route.query.chapter : '';
  if (chapter) void nextTick(() => jumpToChapter(chapter));
};

watch(() => route.query, applyRouteQuery);

onMounted(() => {
  applyRouteQuery();
  window.addEventListener('scroll', onScroll, { passive: true });
  void nextTick(onScroll);
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll);
  if (flashTimer) clearTimeout(flashTimer);
});
</script>

<template>
  <div class="mx-auto max-w-6xl px-5">
    <!-- 工具条：文档 Tab + 关键字搜索 -->
    <div class="flex flex-wrap items-center gap-3 border-b border-flat-weak bg-bg py-3">
      <div class="inline-flex gap-1 rounded-lg bg-flat-weak p-0.5">
        <button
          v-for="tab in DOCS_TABS"
          :key="tab.value"
          type="button"
          class="rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors"
          :class="activeTab === tab.value ? 'bg-surface text-primary shadow-[var(--shadow-card)]' : 'text-text-secondary hover:text-text'"
          @click="switchTab(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="relative ml-auto w-full max-w-xs">
        <input
          v-model="searchKeyword"
          class="w-full rounded-lg bg-flat-weak px-3 py-1.5 text-xs text-text outline-none placeholder:text-text-tertiary focus:shadow-[inset_0_0_0_1px_var(--color-primary)]"
          placeholder="搜索章节 / 名词 / 快捷键…"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
        >
        <!-- 结果面板 -->
        <div
          v-if="showSearchPanel"
          class="s-card absolute right-0 top-10 z-30 max-h-[420px] w-[380px] overflow-y-auto p-2"
        >
          <p v-if="searchDisplayGroups.length === 0" class="m-0 px-2 py-6 text-center text-xs text-text-tertiary">
            没有命中「{{ searchKeyword }}」的内容
          </p>
          <div v-for="group in searchDisplayGroups" :key="group.chapterId" class="mb-1">
            <div class="px-2 pb-0.5 pt-1.5 text-[10px] font-extrabold uppercase tracking-wide text-text-tertiary">
              {{ group.chapterTitle }} · {{ group.hits.length }} 条
            </div>
            <button
              v-for="hit in group.hits"
              :key="`${group.chapterId}-${hit.label}-${hit.text.slice(0, 12)}`"
              type="button"
              class="block w-full rounded-lg px-2 py-1.5 text-left text-[11.5px] leading-relaxed text-text-secondary hover:bg-primary-weak"
              @mousedown.prevent="pickSearchHit(group.chapterId)"
            >
              <span class="mr-1.5 text-[10px] font-bold text-text-tertiary">{{ hit.label }}</span>
              <template v-for="(seg, index) in hit.snippet" :key="index">
                <b v-if="seg.hit" class="text-primary">{{ seg.text }}</b>
                <template v-else>{{ seg.text }}</template>
              </template>
            </button>
          </div>
          <p class="m-0 border-t border-flat-weak px-2 pb-1 pt-1.5 text-right text-[10px] text-text-tertiary">
            共命中 {{ searchHitCount }} 条
          </p>
        </div>
      </div>
    </div>

    <!-- 正文：左目录 + 右内容 -->
    <div class="grid grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)]">
      <aside class="hidden border-r border-flat-weak py-4 md:block">
        <div v-for="group in tocGroups" :key="group.tag" class="mb-2">
          <div class="px-2.5 pb-1 text-[9.5px] font-extrabold uppercase tracking-wide text-text-tertiary">{{ group.tag }}</div>
          <button
            v-for="chapter in group.chapters"
            :key="chapter.id"
            type="button"
            class="block w-full rounded-lg px-2.5 py-1.5 text-left text-[11.5px] font-semibold leading-snug transition-colors"
            :class="activeChapterId === chapter.id ? 'bg-primary-weak text-primary' : 'text-text-secondary hover:bg-flat-weak hover:text-text'"
            @click="jumpToChapter(chapter.id)"
          >
            {{ chapter.title }}
          </button>
        </div>
      </aside>

      <div class="min-w-0 py-5 md:pl-7">
        <article
          v-for="chapter in chapters"
          :id="`wp-${chapter.id}`"
          :key="chapter.id"
          :ref="setSectionRef(chapter.id)"
          class="s-doc-section mb-12 rounded-xl"
          :class="{ 'is-flash': flashChapterId === chapter.id }"
        >
          <header>
            <span class="s-badge s-badge--plat">{{ chapter.tag }}</span>
            <h2 class="mb-1 mt-2 text-xl font-extrabold text-text">{{ chapter.title }}</h2>
            <p v-if="chapter.intro" class="m-0 text-xs leading-relaxed text-text-secondary">{{ chapter.intro }}</p>
          </header>

          <div v-for="(block, blockIndex) in chapter.blocks" :key="blockIndex" class="mt-3.5">
            <p v-if="block.type === 'text'" class="m-0 text-[12.5px] leading-relaxed text-text-secondary">{{ block.text }}</p>

            <ul v-else-if="block.type === 'list'" class="m-0 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-text-secondary">
              <li v-for="(item, index) in block.items" :key="index">{{ item }}</li>
            </ul>

            <ol v-else-if="block.type === 'steps'" class="s-steps">
              <li v-for="(item, index) in block.items" :key="index">{{ item }}</li>
            </ol>

            <div v-else-if="block.type === 'defs'">
              <div v-for="item in block.items" :key="item.term" class="s-defs-row s-card px-3.5 py-2.5">
                <b class="mb-0.5 block text-[12.5px] text-text">{{ item.term }}</b>
                <p class="m-0 text-[11.5px] leading-relaxed text-text-secondary">{{ item.desc }}</p>
              </div>
            </div>

            <div v-else-if="block.type === 'tip'" class="s-tip">
              <span class="font-black" aria-hidden="true">!</span>
              <span>{{ block.text }}</span>
            </div>

            <pre v-else-if="block.type === 'code'" class="s-code">{{ block.text }}</pre>

            <div v-else class="s-card overflow-x-auto">
              <table class="w-full border-collapse text-left text-[11.5px]">
                <thead>
                  <tr>
                    <th
                      v-for="head in block.head"
                      :key="head"
                      class="border-b border-flat-weak px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-text-tertiary"
                    >
                      {{ head }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex" class="border-b border-flat-weak">
                    <td
                      v-for="(cell, cellIndex) in row"
                      :key="cellIndex"
                      class="px-3 py-2 align-top leading-relaxed"
                      :class="cellIndex === 0 ? 'font-semibold text-text' : 'text-text-secondary'"
                    >
                      {{ cell }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 首章尾部：下载 CTA（全页仅此一处） -->
          <div
            v-if="chapter.id === 'quick-start'"
            class="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-flat-weak bg-primary-weak/60 px-4 py-3"
          >
            <div>
              <b class="text-[12.5px] text-text">还没有安装？</b>
              <p class="m-0 mt-0.5 text-[11px] text-text-secondary">前往下载中心获取最新版，Windows 与 Android 双平台。</p>
            </div>
            <RouterLink to="/download" class="s-btn s-btn--primary s-btn--sm ml-auto">⬇ 前往下载</RouterLink>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>
