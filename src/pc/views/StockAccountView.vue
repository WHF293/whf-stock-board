<script setup lang="ts">
import { openUrl } from '@tauri-apps/plugin-opener';
import { PAGE_HEADER_ACTIONS_TARGET, usePageHeaderSlot } from '../../common/composables/use-page-header-slot';
import tzzbFavicon from '../../common/assets/tzzb-favicon.ico';
import { TZZB_OFFICIAL_SITE_URL } from '../../common/types/tzzb.types.ts';
import BaseButton from '../components/ui/BaseButton.vue';
import TzzbDashboard from '../components/account/tzzb/TzzbDashboard.vue';

/**
 * 股票账户 · 投资账本数据中心
 *
 * 数据由同花顺投资账本官方 MCP 同步（common/api/tzzb.api.ts，
 * 方案见 .ai/项目资源/投资账本MCP同步-开发方案.md）。
 * 六大模块：账户选择器 / 指标行 + 资产曲线 / 盈亏日历（三级下钻）/
 * 建清仓记录 / 清仓分析 / 品种总盈亏 / 交易记录（股票 + 基金）。
 * 旧的手工交割单 / 对账单导入已于 2026-10-23 下线。
 */

/** 页头挂载守卫（KeepAlive 缓存页：激活才投射，防按钮残留） */
const { active: headerSlotActive } = usePageHeaderSlot();

/**
 * 系统默认浏览器打开投资账本官网（plugin-opener；纯浏览器 dev 环境兜底新标签页）
 */
const openOfficialSite = (): void => {
  void openUrl(TZZB_OFFICIAL_SITE_URL).catch(() =>
    window.open(TZZB_OFFICIAL_SITE_URL, '_blank', 'noopener'),
  );
};
</script>

<template>
  <!-- 官网入口上移 MainLayout 页头：高光玻璃按钮（BaseButton ghost，与「插件设置」
       同款玻璃底），官网 favicon + 常驻文案（王总 2026-10-23 指定） -->
  <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
    <BaseButton
      variant="ghost"
      title="在系统浏览器打开投资账本官网"
      @click="openOfficialSite"
    >
      <img :src="tzzbFavicon" alt="投资账本" class="h-4 w-4 shrink-0" />
      <span class="text-text-secondary">投资账本官网</span>
    </BaseButton>
  </Teleport>

  <TzzbDashboard />
</template>
