<script setup lang="ts">
import { computed, ref } from 'vue';
import dayjs from 'dayjs';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PAGE_HEADER_ACTIONS_TARGET, usePageHeaderSlot } from '../../common/composables/use-page-header-slot';
import tzzbFavicon from '../../common/assets/tzzb-favicon.ico';
import { TZZB_OFFICIAL_SITE_URL } from '../../common/types/tzzb.types.ts';
import {
  fetchAuthorizedAt,
  fetchTzzbMcpConfig,
  saveTzzbMcpConfig,
  startTzzbMcpAuth,
  waitTzzbMcpAuthorized,
  type TzzbMcpConfig,
} from '../../common/api/tzzb.api.ts';
import { NOTIFY_TONE } from '../../common/constants/notify.constants.ts';
import { useNotificationsStore } from '../../common/stores/notifications';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import BaseModal from '../components/ui/BaseModal.vue';
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

/** 鉴权进行中（防重入 + 菜单项态） */
const authRunning = ref(false);

/** 账本 MCP 气泡菜单开关（点外部透明遮罩收起，同 HeaderTools 文档气泡） */
const mcpMenuOpen = ref(false);

/** 「编辑 MCP」弹窗开关 */
const editMcpOpen = ref(false);

/** 编辑弹窗加载态（回填配置中） */
const editLoading = ref(false);

/** 编辑弹窗保存态（防重入） */
const editSaving = ref(false);

/** 编辑弹窗草稿：上游 endpoint（空串 = 回落 .env.local） */
const draftUrl = ref('');

/** 编辑弹窗回填的当前配置（状态行展示来源与生效值） */
const mcpConfig = ref<TzzbMcpConfig | null>(null);

/**
 * 草稿 URL 校验（非空时必须能解析为 http/https；空 = 回落 env，合法）
 */
const draftUrlError = computed(() => {
  const value = draftUrl.value.trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '仅支持 http(s) 地址';
    return '';
  } catch {
    return '不是合法的 URL';
  }
});

/** 状态行文案（弹窗内展示当前生效 endpoint 与来源） */
const effectiveText = computed(() => {
  const config = mcpConfig.value;
  if (!config) return '';
  if (config.customUrl) return `当前生效：自定义（${config.customUrl}）`;
  if (config.envConfigured) return '当前生效：.env.local 兜底（未自定义）';
  return '当前生效：未配置（MCP 通道不可用）';
});

/**
 * 系统默认浏览器打开投资账本官网（plugin-opener；纯浏览器 dev 环境兜底新标签页）
 */
const openOfficialSite = (): void => {
  void openUrl(TZZB_OFFICIAL_SITE_URL).catch(() =>
    window.open(TZZB_OFFICIAL_SITE_URL, '_blank', 'noopener'),
  );
};

/**
 * 重新触发 MCP 浏览器鉴权（菜单项「鉴权重置」）：dev server 起回调监听 →
 * 拉起系统浏览器到授权页 → 轮询授权时间直到落盘（浮窗反馈结果；
 * 页面顶栏同步状态的授权时间随之刷新）
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

/** 菜单项：鉴权重置（收起菜单后走既有鉴权流） */
const onResetAuth = (): void => {
  mcpMenuOpen.value = false;
  void runMcpAuth();
};

/** 菜单项：编辑 MCP（拉取当前配置回填草稿，打开弹窗） */
const onEditMcp = (): void => {
  mcpMenuOpen.value = false;
  editMcpOpen.value = true;
  editLoading.value = true;
  void fetchTzzbMcpConfig()
    .then((config) => {
      mcpConfig.value = config;
      draftUrl.value = config?.customUrl ?? '';
    })
    .finally(() => {
      editLoading.value = false;
    });
};

/**
 * 保存编辑：落盘 tzzb-mcp.config.local.json（dev server 即时生效，无需重启）；
 * 换了上游地址时 server 端自动作废旧 OAuth 凭据，提示重新鉴权
 */
const onSaveMcpConfig = async (): Promise<void> => {
  if (editSaving.value || draftUrlError.value) return;
  editSaving.value = true;
  try {
    const prevUrl = mcpConfig.value?.effectiveUrl ?? null;
    const config = await saveTzzbMcpConfig(draftUrl.value.trim());
    mcpConfig.value = config;
    editMcpOpen.value = false;
    const changed = prevUrl !== null && config.effectiveUrl !== null && prevUrl !== config.effectiveUrl;
    notifications.push({
      title: '账本 MCP 配置已保存',
      body: changed
        ? `已切换上游，请执行「鉴权重置」完成新地址授权（${config.effectiveUrl}）`
        : `生效地址：${config.effectiveUrl ?? '未配置'}`,
      tone: NOTIFY_TONE.UP,
    });
  } catch (err) {
    notifications.push({
      title: '账本 MCP 配置保存失败',
      body: err instanceof Error ? err.message : String(err),
      tone: NOTIFY_TONE.DOWN,
    });
  } finally {
    editSaving.value = false;
  }
};
</script>

<template>
  <!-- 官网入口上移 MainLayout 页头：高光玻璃按钮（BaseButton ghost，与「插件设置」
       同款玻璃底），官网 favicon + 常驻文案（王总 2026-10-23 指定）；
       账本MCP = 气泡菜单（王总 2026-11-02 指定）：鉴权重置（原 MCP鉴权按钮逻辑）/
       编辑MCP（弹窗编辑上游 endpoint，落盘 tzzb-mcp.config.local.json 即时生效） -->
  <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
    <BaseButton
      variant="ghost"
      title="在系统浏览器打开投资账本官网"
      @click="openOfficialSite"
    >
      <img :src="tzzbFavicon" alt="投资账本" class="h-4 w-4 shrink-0" />
      <span class="text-text-secondary">投资账本官网</span>
    </BaseButton>
    <!-- 账本MCP：气泡菜单挂点（relative wrapper 保证菜单锚定本按钮） -->
    <div class="relative">
      <BaseButton
        variant="ghost"
        title="投资账本 MCP 通道管理"
        @click="mcpMenuOpen = !mcpMenuOpen"
      >
        <MenuIcon name="plug" :size="14" />
        <span class="text-text-secondary">账本MCP</span>
      </BaseButton>
      <!-- 气泡菜单：点外部收起（透明遮罩，同 HeaderTools 文档气泡） -->
      <div v-if="mcpMenuOpen" class="fixed inset-0 z-40" @click="mcpMenuOpen = false" />
      <div
        v-if="mcpMenuOpen"
        class="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-xl border border-flat-weak bg-surface p-1 shadow-[var(--shadow-card)]"
        role="menu"
      >
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text hover:bg-flat-weak disabled:cursor-not-allowed disabled:opacity-50"
          role="menuitem"
          :disabled="authRunning"
          @click="onResetAuth"
        >
          <MenuIcon name="refresh" :size="14" class="shrink-0 text-text-secondary" />
          {{ authRunning ? '鉴权中…' : '鉴权重置' }}
        </button>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text hover:bg-flat-weak"
          role="menuitem"
          @click="onEditMcp"
        >
          <MenuIcon name="pencil" :size="14" class="shrink-0 text-text-secondary" />
          编辑MCP
        </button>
      </div>
    </div>

    <!-- 编辑 MCP 弹窗：上游 endpoint 可视化编辑（草稿模式，保存才落盘） -->
    <BaseModal v-model:open="editMcpOpen" title="编辑账本 MCP" max-width-class="max-w-md">
      <p class="mb-3 text-xs leading-relaxed text-text-tertiary">
        投资账本 MCP 上游地址（同源代理 /tzzb-mcp 转发）。保存写入
        tzzb-mcp.config.local.json 并立即生效，无需重启；留空保存则回落 .env.local。
        更换地址后旧授权自动作废，请重新「鉴权重置」。
      </p>
      <div v-if="editLoading" class="py-2 text-xs text-text-tertiary">读取当前配置…</div>
      <div v-else class="space-y-2">
        <BaseInput v-model="draftUrl" placeholder="https://tzzb.10jqka.com.cn/mcp" />
        <p v-if="draftUrlError" class="text-xs text-down">{{ draftUrlError }}</p>
        <p v-if="effectiveText" class="text-xs text-text-tertiary">{{ effectiveText }}</p>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="editMcpOpen = false">取消</BaseButton>
        <BaseButton :disabled="editLoading || editSaving || !!draftUrlError" @click="void onSaveMcpConfig()">
          保存
        </BaseButton>
      </template>
    </BaseModal>
  </Teleport>

  <TzzbDashboard />
</template>
