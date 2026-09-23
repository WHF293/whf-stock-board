<script setup lang="ts">
import { computed } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import { pluginUpdateNameList } from '../../composables/use-plugin-update';
import {
  PLUGIN_UPDATE_BAR_CHECKING,
  PLUGIN_UPDATE_BAR_FAIL,
  PLUGIN_UPDATE_BAR_LATEST,
  PLUGIN_UPDATE_BAR_UPDATE_ALL,
  PLUGIN_UPDATE_BAR_UPDATABLE,
  PLUGIN_UPDATE_RETRY_LABEL,
} from '../../constants/plugin-update.constants';
import type {
  PluginUpdateCandidate,
  PluginUpdateCheckStatus,
} from '../../types/plugin-update.types';

/**
 * 插件工坊内的更新提示条（四种形态：检查中 / 已是最新 / 失败重试 / N 个可更新）
 *
 * 样式**照抄**同卡片里「数据表处置询问」块（`PluginLabView` 的 pendingDbCleanup）：
 * 同卡片里两种提示条长得不一样，用户会以为是两个不同模块。
 *
 * 它自己不发请求：只渲染 `usePluginUpdate` 的状态，动作一律 emit 回宿主。
 */
const props = withDefaults(
  defineProps<{
    /** 检查状态（建议传 `usePluginUpdate().barStatus`） */
    status: PluginUpdateCheckStatus;
    /** 可更新项（status = updatable 时非空） */
    candidates?: readonly PluginUpdateCandidate[];
    /** 是否忙碌（检查中 / 正在装）：禁用按钮防重复提交 */
    busy?: boolean;
  }>(),
  { candidates: () => [], busy: false },
);

const emit = defineEmits<{
  /** 用户点「重试」（失败态） */
  check: [];
  /** 用户点「全部更新」 */
  updateAll: [];
}>();

/**
 * 实际渲染形态：`updatable` 但候选已被外部清空（用户卸载了那个插件、或已装完）时回落 latest
 *
 * 提示条独立于调用方再兜一次：直接吃裸 `status` 会渲染出「0 个插件可更新（）」的空壳，
 * 还挂着一个点了没反应的「全部更新」按钮。
 */
const effectiveStatus = computed<PluginUpdateCheckStatus>(() =>
  props.status === 'updatable' && props.candidates.length === 0 ? 'latest' : props.status,
);

/** idle 时什么都不渲染：一次都没查过就不该占版面 */
const visible = computed<boolean>(() => effectiveStatus.value !== 'idle');

/** 提示条正文 */
const text = computed<string>(() => {
  switch (effectiveStatus.value) {
    case 'checking':
      return PLUGIN_UPDATE_BAR_CHECKING;
    case 'fail':
      return PLUGIN_UPDATE_BAR_FAIL;
    case 'updatable':
      return PLUGIN_UPDATE_BAR_UPDATABLE(
        props.candidates.length,
        pluginUpdateNameList(props.candidates),
      );
    default:
      return PLUGIN_UPDATE_BAR_LATEST;
  }
});

/** 只有失败（重试）与有更新（全部更新）两种形态需要操作区 */
const showActions = computed<boolean>(
  () => effectiveStatus.value === 'fail' || effectiveStatus.value === 'updatable',
);
</script>

<template>
  <div v-if="visible" class="mb-3 rounded-card border border-flat-weak px-3 py-2.5">
    <p class="text-xs text-text-secondary">{{ text }}</p>
    <div v-if="showActions" class="mt-2 flex justify-end gap-2">
      <BaseButton
        v-if="effectiveStatus === 'fail'"
        variant="ghost"
        :disabled="busy"
        data-track="PLUGIN_UPDATE_CHECK"
        @click="emit('check')"
      >
        {{ PLUGIN_UPDATE_RETRY_LABEL }}
      </BaseButton>
      <BaseButton
        v-if="effectiveStatus === 'updatable'"
        variant="primary"
        :disabled="busy"
        data-track="PLUGIN_UPDATE_INSTALL"
        @click="emit('updateAll')"
      >
        {{ PLUGIN_UPDATE_BAR_UPDATE_ALL }}
      </BaseButton>
    </div>
  </div>
</template>
