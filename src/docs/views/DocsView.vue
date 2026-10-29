<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { GUIDE_CHAPTERS } from '../../common/constants/whitepaper-content';
import type { GuideChapter } from '../../common/types/whitepaper.types';
import { parseQuery } from '../../common/utils/whitepaper-search';
import {
  DOCS_DEV_CHAPTER_IDS,
  DOCS_GROUP_ORDER,
  DOCS_HITS_PER_CHAPTER,
  DOCS_HITS_TOTAL_LIMIT,
  DOCS_TABS,
  type DocsTabValue,
} from '../constants/site.constants';
import { parseChapterLinks } from '../utils/chapter-inline-links';
import {
  buildWhitepaperSearchDocs,
  searchWhitepaper,
  type WhitepaperSearchGroup,
} from '../utils/whitepaper-search-index';

/**
 * 官网文档中心：软件白皮书整站渲染
 *
 * 内容与客户端单源（GUIDE_CHAPTERS），双 Tab 归组、关键字搜索均对齐客户端白皮书。
 * 目录按「应用侧栏路由分组」惯例排序（DOCS_GROUP_ORDER），不在侧栏路由里的章节归「二级页」组；
 * 正文按选中章节单章展示——目录点选 / 搜索命中 / 正文内 [文案](#章节id) 链接都会切换当前章节，
 * 并同步到地址栏（?tab= &chapter=），刷新与分享都能落回同一章。
 */

const route = useRoute();
const router = useRouter();

/** 当前文档 Tab */
const activeTab = ref<DocsTabValue>('user');

/** 当前选中章节 id（正文只渲染这一章） */
const activeChapterId = ref('');

/** 各 Tab 记住的选中章节（切 Tab 回来不丢阅读位置） */
const tabSelection = new Map<DocsTabValue, string>();

/** 按 Tab 归组后的章节（dev 章节归「开发者指南」，其余归「使用说明」） */
const tabChapters = computed<Record<DocsTabValue, GuideChapter[]>>(() => ({
  user: GUIDE_CHAPTERS.filter((chapter) => !DOCS_DEV_CHAPTER_IDS.has(chapter.id)),
  dev: GUIDE_CHAPTERS.filter((chapter) => DOCS_DEV_CHAPTER_IDS.has(chapter.id)),
}));

/** 当前 Tab 下的章节 */
const chapters = computed(() => tabChapters.value[activeTab.value]);

/**
 * 目录分组：按章节 tag 归组，组序按侧栏分组惯例（DOCS_GROUP_ORDER），未知 tag 追加在后
 */
const tocGroups = computed(() => {
  const byTag = new Map<string, GuideChapter[]>();
  for (const chapter of chapters.value) {
    const list = byTag.get(chapter.tag);
    if (list) list.push(chapter);
    else byTag.set(chapter.tag, [chapter]);
  }
  const rank = (tag: string): number => {
    const index = DOCS_GROUP_ORDER.indexOf(tag);
    return index < 0 ? DOCS_GROUP_ORDER.length : index;
  };
  return [...byTag.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([tag, list]) => ({ tag, chapters: list }));
});

/** 当前选中的章节（选中 id 失效时回落到本 Tab 第一章） */
const selectedChapter = computed(
  () => chapters.value.find((chapter) => chapter.id === activeChapterId.value) ?? chapters.value[0],
);

/**
 * 查章节所属 Tab
 * @param id 章节 id
 * @returns 所属 Tab；未知章节返回 undefined
 */
const tabOfChapter = (id: string): DocsTabValue | undefined => {
  if (tabChapters.value.dev.some((chapter) => chapter.id === id)) return 'dev';
  if (tabChapters.value.user.some((chapter) => chapter.id === id)) return 'user';
  return undefined;
};

/** 把当前 Tab 与章节同步进地址栏（hash 路由 query，刷新 / 分享可还原） */
const syncQuery = (): void => {
  void router.replace({ query: { ...route.query, tab: activeTab.value, chapter: activeChapterId.value } });
};

/**
 * 选中章节（正文单章渲染；目标在其他 Tab 时自动切 Tab）
 * @param id 章节 id
 */
const selectChapter = (id: string): void => {
  const tab = tabOfChapter(id);
  if (!tab) return;
  activeTab.value = tab;
  activeChapterId.value = id;
  tabSelection.set(tab, id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  syncQuery();
};

/**
 * 切换文档 Tab（恢复该 Tab 上次读到的章节，默认第一章）
 * @param tab 目标 Tab
 */
const switchTab = (tab: DocsTabValue): void => {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  activeChapterId.value = tabSelection.get(tab) ?? chapters.value[0]?.id ?? '';
  window.scrollTo({ top: 0 });
  syncQuery();
};

/**
 * 移动端章节下拉的 change 处理
 * @param event change 事件
 */
const onMobileSelect = (event: Event): void => {
  selectChapter((event.target as HTMLSelectElement).value);
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
  selectChapter(chapterId);
};

/* ------------------------------ 路由定位（?tab= / ?chapter=） ------------------------------ */

/** 应用路由参数（功能亮点卡「了解更多」与 ?tab=dev 直达都走这里） */
const applyRouteQuery = (): void => {
  const qTab = route.query.tab === 'dev' ? 'dev' : route.query.tab === 'user' ? 'user' : undefined;
  const qChapter = typeof route.query.chapter === 'string' ? route.query.chapter : '';
  if (qChapter) {
    const tab = tabOfChapter(qChapter);
    if (tab) {
      activeTab.value = tab;
      activeChapterId.value = qChapter;
      tabSelection.set(tab, qChapter);
      return;
    }
  }
  if (qTab && activeTab.value !== qTab) {
    activeTab.value = qTab;
    activeChapterId.value = tabSelection.get(qTab) ?? chapters.value[0]?.id ?? '';
  }
};

watch(() => route.query, applyRouteQuery);

onMounted(() => {
  applyRouteQuery();
  if (!activeChapterId.value) activeChapterId.value = chapters.value[0]?.id ?? '';
});

/* ------------------------------ 正文内章节链接 ------------------------------ */

/**
 * 行内富文本组件：把 `[文案](#章节id)` 渲染成可点的章节跳转链接，其余原样输出
 */
const RichText = Object.assign(
  (props: { text: string }) =>
    h(
      'span',
      parseChapterLinks(props.text).map((segment, index) => {
        if (!segment.chapterId) return segment.text;
        return h(
          'a',
          {
            key: index,
            href: `#/docs?chapter=${segment.chapterId}`,
            class:
              'cursor-pointer text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary',
            onClick: (event: Event) => {
              event.preventDefault();
              selectChapter(segment.chapterId ?? '');
            },
          },
          segment.text,
        );
      }),
    ),
  { props: { text: { type: String, required: true } } },
);
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

    <!-- 移动端章节下拉（桌面端用左侧目录） -->
    <div class="border-b border-flat-weak py-3 md:hidden">
      <select
        class="w-full rounded-lg bg-flat-weak px-3 py-2 text-xs text-text outline-none"
        :value="selectedChapter?.id ?? ''"
        @change="onMobileSelect"
      >
        <optgroup v-for="group in tocGroups" :key="group.tag" :label="group.tag">
          <option v-for="chapter in group.chapters" :key="chapter.id" :value="chapter.id">
            {{ chapter.title }}
          </option>
        </optgroup>
      </select>
    </div>

    <!-- 正文：左目录 + 右内容（单章展示） -->
    <div class="grid grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)]">
      <aside class="hidden border-r border-flat-weak py-4 md:block">
        <div v-for="group in tocGroups" :key="group.tag" class="mb-2">
          <div class="px-2.5 pb-1 text-[9.5px] font-extrabold uppercase tracking-wide text-text-tertiary">{{ group.tag }}</div>
          <button
            v-for="chapter in group.chapters"
            :key="chapter.id"
            type="button"
            class="block w-full rounded-lg px-2.5 py-1.5 text-left text-[11.5px] font-semibold leading-snug transition-colors"
            :class="selectedChapter?.id === chapter.id ? 'bg-primary-weak text-primary' : 'text-text-secondary hover:bg-flat-weak hover:text-text'"
            @click="selectChapter(chapter.id)"
          >
            {{ chapter.title }}
          </button>
        </div>
      </aside>

      <div class="min-w-0 py-5 md:pl-7">
        <article v-if="selectedChapter" :key="selectedChapter.id" class="s-doc-section mb-12 rounded-xl">
          <header>
            <span class="s-badge s-badge--plat">{{ selectedChapter.tag }}</span>
            <h2 class="mb-1 mt-2 text-xl font-extrabold text-text">{{ selectedChapter.title }}</h2>
            <p v-if="selectedChapter.intro" class="m-0 text-xs leading-relaxed text-text-secondary">{{ selectedChapter.intro }}</p>
          </header>

          <div v-for="(block, blockIndex) in selectedChapter.blocks" :key="blockIndex" class="mt-3.5">
            <p v-if="block.type === 'text'" class="m-0 text-[12.5px] leading-relaxed text-text-secondary">
              <RichText :text="block.text" />
            </p>

            <ul v-else-if="block.type === 'list'" class="m-0 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-text-secondary">
              <li v-for="(item, index) in block.items" :key="index"><RichText :text="item" /></li>
            </ul>

            <ol v-else-if="block.type === 'steps'" class="s-steps">
              <li v-for="(item, index) in block.items" :key="index"><RichText :text="item" /></li>
            </ol>

            <div v-else-if="block.type === 'defs'">
              <div v-for="item in block.items" :key="item.term" class="s-defs-row s-card px-3.5 py-2.5">
                <b class="mb-0.5 block text-[12.5px] text-text">{{ item.term }}</b>
                <p class="m-0 text-[11.5px] leading-relaxed text-text-secondary"><RichText :text="item.desc" /></p>
              </div>
            </div>

            <div v-else-if="block.type === 'tip'" class="s-tip">
              <span class="font-black" aria-hidden="true">!</span>
              <span><RichText :text="block.text" /></span>
            </div>

            <pre v-else-if="block.type === 'code'" class="s-code">{{ block.text }}</pre>

            <figure v-else-if="block.type === 'image'" class="s-card m-0 p-2">
              <img :src="block.src" :alt="block.alt ?? ''" class="w-full rounded-lg" loading="lazy">
              <figcaption v-if="block.caption" class="px-2 pb-1 pt-2 text-center text-[10.5px] text-text-tertiary">
                {{ block.caption }}
              </figcaption>
            </figure>

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
            v-if="selectedChapter.id === 'quick-start'"
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
