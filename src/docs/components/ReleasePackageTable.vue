<script setup lang="ts">
import { formatBytes, formatCount } from '../utils/format.utils';
import { RELEASE_KIND_LABELS, RELEASE_PLATFORM_LABELS } from '../constants/site.constants';
import type { ReleasePackage } from '../types/release.types';

/**
 * 安装包资产表（最新版推荐区与历史版本组卡共用）
 *
 * compact 为 true 时是历史版本组的紧凑变体：无副标题说明行、下载按钮为图标态。
 */

interface Props {
  /** 安装包列表（调用方已按推荐顺序排好） */
  packages: readonly ReleasePackage[];
  /** 紧凑态（历史版本组内使用） */
  compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), { compact: false });
</script>

<template>
  <table class="w-full border-collapse text-left text-[11.5px]">
    <thead>
      <tr>
        <th class="rounded-tl-lg bg-bg px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-wide text-text-tertiary">文件</th>
        <th class="bg-bg px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-wide text-text-tertiary">平台</th>
        <th class="bg-bg px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-wide text-text-tertiary">大小</th>
        <th class="rounded-tr-lg bg-bg px-3 py-1.5 text-right text-[9.5px] font-bold uppercase tracking-wide text-text-tertiary">下载</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="pkg in props.packages" :key="pkg.fileName" class="border-t border-flat-weak">
        <td class="px-3 py-2.5 align-middle">
          <div class="font-mono text-[10.5px] font-bold text-text">{{ pkg.fileName }}</div>
          <div v-if="!props.compact" class="mt-0.5 text-[10px] text-text-tertiary">{{ RELEASE_KIND_LABELS[pkg.kind] }}</div>
        </td>
        <td class="px-3 py-2.5 align-middle text-text-secondary">{{ RELEASE_PLATFORM_LABELS[pkg.platform] }}</td>
        <td class="px-3 py-2.5 align-middle font-semibold text-text-secondary">{{ formatBytes(pkg.sizeBytes) }}</td>
        <td class="px-3 py-2.5 text-right align-middle">
          <div class="text-[10px] text-text-tertiary">{{ formatCount(pkg.downloadCount) }} 次下载</div>
          <a
            :href="pkg.url"
            class="s-btn s-btn--sm"
            :class="pkg.kind === 'nsis' && !props.compact ? 's-btn--primary' : 's-btn--ghost'"
            :download="pkg.fileName"
          >{{ props.compact ? '⬇' : '⬇ 下载' }}</a>
        </td>
      </tr>
    </tbody>
  </table>
</template>
