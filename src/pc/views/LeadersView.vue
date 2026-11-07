<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import PanoramaLeadersBoard from '../components/business/PanoramaLeadersBoard.vue';
import { PAGE_HEADER_ACTIONS_TARGET, usePageHeaderSlot } from '../../common/composables/use-page-header-slot';

/**
 * 龙头（原「行情全景」页行业龙头页签独立成页，2026-11-06 王总指定拆分）：
 * 板块 / 细分赛道静态清单卡片流，数据 / 轮询 / 拖拽排序均由 PanoramaLeadersBoard 自管；
 * 页面入口在市场总览页头「龙头」按钮
 */

/** 龙头面板实例（调用其暴露的 refresh / loading，页头刷新按钮用） */
const boardRef = ref<InstanceType<typeof PanoramaLeadersBoard> | null>(null);

/** 刷新按钮是否旋转中（读面板暴露的 loading） */
const isRefreshing = computed(() => boardRef.value?.loading ?? false);

/** 点刷新按钮：重拉全部龙头报价 */
const onManualRefresh = (): void => {
  boardRef.value?.refresh();
};

/** 页头挂载守卫（KeepAlive 缓存页：激活才投射，防按钮残留）——刷新按钮上移页头用 */
const { active: headerSlotActive } = usePageHeaderSlot();
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <!-- 提示为辅助信息：容器过窄（抽屉打开挤主区）时整体隐藏，避免被挤成一字一行竖排 -->
    <div class="flex shrink-0 items-center justify-end">
      <span class="hidden shrink-0 text-xs text-text-tertiary @4xl:block">未开盘时展示最近交易日收盘数据</span>
    </div>

    <!-- 手动刷新上移 MainLayout 页头（原行情全景 2026-11-02 王总指定，「插件设置」左侧）：
         重拉全部龙头报价，拉取中图标旋转 -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <BaseButton
        variant="ghost"
        :disabled="isRefreshing"
        @click="onManualRefresh"
      >
        <MenuIcon name="refresh" :size="14" :class="{ 'animate-spin': isRefreshing }" />
        {{ isRefreshing ? '刷新中…' : '刷新' }}
      </BaseButton>
    </Teleport>

    <!-- 板块 / 细分赛道龙头卡片流（数据自管，吃满剩余高度） -->
    <PanoramaLeadersBoard ref="boardRef" class="min-h-0 flex-1" />
  </div>
</template>
