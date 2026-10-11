<script setup lang="ts">
import ReleasePackageTable from './ReleasePackageTable.vue';
import { formatDateIso } from '../utils/format.utils';
import type { AppRelease } from '../types/release.types';

/**
 * 历史版本组卡：版本头（版本号 / 平台徽标 / 日期 / GitHub 链接）
 * + 更新内容编号列表 + 紧凑资产表
 */

interface Props {
  /** 版本组数据（归一化后的一个 GitHub Release） */
  release: AppRelease;
}

const props = defineProps<Props>();

/** 版本包含的平台徽标（去重后按 windows → android 排列） */
const platformBadges = [...new Set(props.release.packages.map((pkg) => pkg.platform))];
</script>

<template>
  <article class="s-card overflow-hidden">
    <header class="flex flex-wrap items-center gap-2 border-b border-flat-weak bg-bg px-4 py-3">
      <span class="font-mono text-[15.5px] font-extrabold text-text">{{ props.release.tag }}</span>
      <span v-for="platform in platformBadges" :key="platform" class="s-badge s-badge--plat">{{ platform === 'windows' ? '🪟' : '🤖' }}</span>
      <span v-if="props.release.publishedAt" class="s-badge s-badge--muted">{{ formatDateIso(props.release.publishedAt) }}</span>
      <a
        :href="props.release.htmlUrl"
        target="_blank"
        rel="noopener"
        class="ml-auto text-[10.5px] font-extrabold text-primary hover:underline"
      >GitHub ↗</a>
    </header>
    <div v-if="props.release.notes.length > 0" class="px-4 pb-1 pt-2.5 text-[11.5px] leading-relaxed text-text-secondary">
      <b class="text-text">更新内容</b>
      <ol class="mt-1 list-none space-y-0.5 pl-0">
        <li v-for="(note, index) in props.release.notes" :key="index">{{ index + 1 }}. {{ note }}</li>
      </ol>
    </div>
    <div class="pt-2">
      <ReleasePackageTable :packages="props.release.packages" compact />
    </div>
  </article>
</template>
