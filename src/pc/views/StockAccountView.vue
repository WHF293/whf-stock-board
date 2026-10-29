<script setup lang="ts">
import { ref } from 'vue';
import dayjs from 'dayjs';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PAGE_HEADER_ACTIONS_TARGET, usePageHeaderSlot } from '../../common/composables/use-page-header-slot';
import tzzbFavicon from '../../common/assets/tzzb-favicon.ico';
import { TZZB_OFFICIAL_SITE_URL } from '../../common/types/tzzb.types.ts';
import { fetchAuthorizedAt, startTzzbMcpAuth, waitTzzbMcpAuthorized } from '../../common/api/tzzb.api.ts';
import { NOTIFY_TONE } from '../../common/constants/notify.constants.ts';
import { useNotificationsStore } from '../../common/stores/notifications';
import BaseButton from '../components/ui/BaseButton.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
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

/** 浮窗（鉴权发起 / 完成 / 失败反馈） */
const notifications = useNotificationsStore();

/** 鉴权进行中（防重入 + 按钮态） */
const authRunning = ref(false);

/**
 * 系统默认浏览器打开投资账本官网（plugin-opener；纯浏览器 dev 环境兜底新标签页）
 */
const openOfficialSite = (): void => {
  void openUrl(TZZB_OFFICIAL_SITE_URL).catch(() =>
    window.open(TZZB_OFFICIAL_SITE_URL, '_blank', 'noopener'),
  );
};

/**
 * 重新触发 MCP 浏览器鉴权：dev server 起回调监听 → 拉起系统浏览器到授权页 →
 * 轮询授权时间直到落盘（浮窗反馈结果；页面顶栏同步状态的授权时间随之刷新）
 */
const runMcpAuth = async (): Promise<void> => {
  if (authRunning.value) return;
  authRunning.value = true;
  try {
    const beforeAt = (await fetchAuthorizedAt()) ?? 0;
    const authorizeUrl = await startTzzbMcpAuth();
    await openUrl(authorizeUrl).catch(() => window.open(authorizeUrl, '_blank', 'noopener'));
    notifications.push({
      title: 'MCP 鉴权',
      body: '已打开同花顺授权页，完成登录后自动检测',
      tone: NOTIFY_TONE.PRIMARY,
    });
    const authorizedAt = await waitTzzbMcpAuthorized(beforeAt);
    notifications.push({
      title: 'MCP 鉴权完成',
      body: `授权时间 ${dayjs(authorizedAt).format('YYYY-MM-DD HH:mm')}`,
      tone: NOTIFY_TONE.UP,
    });
  } catch (err) {
    notifications.push({
      title: 'MCP 鉴权失败',
      body: err instanceof Error ? err.message : String(err),
      tone: NOTIFY_TONE.DOWN,
    });
  } finally {
    authRunning.value = false;
  }
};
</script>

<template>
  <!-- 官网入口上移 MainLayout 页头：高光玻璃按钮（BaseButton ghost，与「插件设置」
       同款玻璃底），官网 favicon + 常驻文案（王总 2026-10-23 指定）；
       MCP鉴权 = 重新触发浏览器授权（王总 2026-10-27 指定，位于官网按钮右侧） -->
  <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
    <BaseButton
      variant="ghost"
      title="在系统浏览器打开投资账本官网"
      @click="openOfficialSite"
    >
      <img :src="tzzbFavicon" alt="投资账本" class="h-4 w-4 shrink-0" />
      <span class="text-text-secondary">投资账本官网</span>
    </BaseButton>
    <BaseButton
      variant="ghost"
      :disabled="authRunning"
      :title="authRunning ? '鉴权进行中，请在浏览器完成登录' : '重新触发投资账本 MCP 浏览器授权'"
      @click="void runMcpAuth()"
    >
      <MenuIcon name="plug" :size="14" />
      <span class="text-text-secondary">{{ authRunning ? '鉴权中…' : 'MCP鉴权' }}</span>
    </BaseButton>
  </Teleport>

  <TzzbDashboard />
</template>
