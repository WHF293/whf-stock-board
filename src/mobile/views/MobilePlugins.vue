<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { pluginKernel } from '../../common/plugin/index';
import { usePlugins } from '../../common/composables/use-plugins';
import { useUserPlugins } from '../../common/composables/use-user-plugins';
import {
  PLUGIN_DEVICE_LABEL,
  PLUGIN_MOBILE_READY_BADGE,
  PLUGIN_STATUS,
  PLUGIN_STATUS_LABEL,
  USER_PLUGIN_SOURCE,
  USER_PLUGIN_SOURCE_LABEL,
} from '../../common/constants/plugin.constants.ts';
import type { PluginDevice } from '../../common/constants/plugin.constants.ts';
import type { PluginRuntimeInfo } from '../../common/types/plugin.types.ts';
import {
  MOBILE_PLUGIN_BUILTIN_OWNER_LABEL,
  MOBILE_PLUGIN_DB_CLEANUP_DROP_LABEL,
  MOBILE_PLUGIN_DB_CLEANUP_KEEP_LABEL,
  MOBILE_PLUGIN_DB_CLEANUP_MESSAGE,
  MOBILE_PLUGIN_DB_CLEANUP_TITLE,
  MOBILE_PLUGIN_MARKET_PATH,
  MOBILE_PLUGIN_OPEN_PAGE_LABEL,
  MOBILE_PLUGIN_RETRY_LABEL,
  MOBILE_PLUGIN_UNINSTALL_LABEL,
  MOBILE_PLUGIN_UNINSTALL_MESSAGE,
  MOBILE_PLUGIN_UNINSTALL_TITLE,
  MOBILE_PLUGINS_EMPTY_HINT,
  MOBILE_PLUGINS_EMPTY_TEXT,
  MOBILE_PLUGINS_GO_MARKET_LABEL,
  MOBILE_PLUGINS_MARKET_ENTRY_LABEL,
  MOBILE_PLUGINS_TITLE,
  MOBILE_PLUGIN_TRUST_NOTE,
} from '../constants';

/**
 * 插件管理页（移动端，方案 P2）
 *
 * 只展示声明支持移动端（`devices` 含 mobile）的插件 —— 未声明的插件在移动端
 * 装配层根本不挂载，运行时清单里本就没有它们，这里再过滤一层是双保险。
 * 启停走 common 的 `usePlugins()`（黑名单持久化 + 内核即时收敛）；
 * 卸载走 `useUserPlugins()` 的真实流程：两段确认（卸载确认 → 数据表处置，
 * Vant showConfirmDialog 承载），与 PC 插件工坊同一套编排。
 */

const router = useRouter();

const { plugins, setEnabled, retry } = usePlugins();
const { records, isUserPlugin, uninstall, pendingDbCleanup, resolveDbCleanup } = useUserPlugins();

/** 声明支持移动端的插件清单（revision 驱动，安装 / 启停 / 卸载后自动刷新） */
const visiblePlugins = computed<readonly PluginRuntimeInfo[]>(() =>
  plugins.value.filter((plugin) => plugin.devices.includes('mobile')),
);

/** 插件贡献的导航菜单（点卡片进插件二级页的依据；revision 驱动） */
const pluginPages = computed(() => {
  void pluginKernel.revision.value;
  return [...pluginKernel.contributions.menu.items];
});

/**
 * 某插件贡献的第一个页面路径（menu 带 component 才有页面；无则空串）
 * @param id 插件 id
 * @returns 页面路径
 */
const pagePathOf = (id: string): string =>
  pluginPages.value.find((item) => item.pluginId === id)?.path ?? '';

/**
 * 插件的归属说明（内置 = 随应用分发；用户插件 = 安装来源）
 * @param info 插件运行时信息
 * @returns 归属文案
 */
const ownerLabelOf = (info: PluginRuntimeInfo): string => {
  if (info.builtin) return MOBILE_PLUGIN_BUILTIN_OWNER_LABEL;
  const source = records.value.find((record) => record.id === info.id)?.source;
  const key = (source ?? USER_PLUGIN_SOURCE.CODE) as keyof typeof USER_PLUGIN_SOURCE_LABEL;
  return USER_PLUGIN_SOURCE_LABEL[key] ?? USER_PLUGIN_SOURCE_LABEL[USER_PLUGIN_SOURCE.CODE];
};

/**
 * 支持端徽标组（含 mobile 时以「移动端可用」徽标代表移动端，避免同义徽标重复）
 * @param devices 支持端列表
 * @returns 徽标文案列表
 */
const deviceBadgesOf = (devices: readonly PluginDevice[]): readonly string[] =>
  devices.includes('mobile')
    ? [PLUGIN_MOBILE_READY_BADGE, ...devices.filter((device) => device !== 'mobile').map((device) => PLUGIN_DEVICE_LABEL[device])]
    : devices.map((device) => PLUGIN_DEVICE_LABEL[device]);

/**
 * 切换插件启停（写持久化黑名单 + 内核即时收敛，单向数据流在 usePlugins 内）
 * @param info 插件运行时信息
 * @param enabled 是否启用
 */
const onToggle = (info: PluginRuntimeInfo, enabled: boolean): void => {
  setEnabled(info.id, enabled);
};

/**
 * 重试挂载失败的插件
 * @param id 插件 id
 */
const onRetry = (id: string): void => {
  retry(id);
};

/**
 * 请求卸载（第一段确认）：确认后走 useUserPlugins 的真实卸载，
 * 若插件声明过数据表，`pendingDbCleanup` 会出现并触发第二段处置弹窗
 * @param info 插件运行时信息
 */
const onUninstall = (info: PluginRuntimeInfo): void => {
  void showConfirmDialog({
    title: MOBILE_PLUGIN_UNINSTALL_TITLE,
    message: MOBILE_PLUGIN_UNINSTALL_MESSAGE(info.name, info.version),
  })
    .then(() => {
      uninstall(info.id);
      showToast(`已卸载「${info.name}」`);
    })
    .catch(() => undefined);
};

// 第二段确认：数据表处置（待办由 use-user-plugins 模块级单例持有，watch 触发展示）
watch(pendingDbCleanup, (pending) => {
  if (!pending) return;
  void showConfirmDialog({
    title: MOBILE_PLUGIN_DB_CLEANUP_TITLE,
    message: MOBILE_PLUGIN_DB_CLEANUP_MESSAGE(pending.pluginName, pending.tables),
    confirmButtonText: MOBILE_PLUGIN_DB_CLEANUP_DROP_LABEL,
    cancelButtonText: MOBILE_PLUGIN_DB_CLEANUP_KEEP_LABEL,
  })
    .then(() => void resolveDbCleanup(true))
    .catch(() => void resolveDbCleanup(false));
});

/** 进插件市场页 */
const goMarket = (): void => {
  void router.push(MOBILE_PLUGIN_MARKET_PATH);
};

/**
 * 进插件贡献的二级页
 * @param id 插件 id
 */
const goPluginPage = (id: string): void => {
  const path = pagePathOf(id);
  if (path.length > 0) void router.push(path);
};
</script>

<template>
  <!-- m-sub-page：≥600px 大屏限宽居中（mobile.css 断点适配分档） -->
  <div class="m-sub-page">
    <van-nav-bar
      :title="MOBILE_PLUGINS_TITLE"
      class="m-nav"
      fixed
      placeholder
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    />

    <!-- 空态：还没有支持移动端的插件 -->
    <div v-if="visiblePlugins.length === 0" class="m-plug-empty">
      <div class="m-plug-empty__t">{{ MOBILE_PLUGINS_EMPTY_TEXT }}</div>
      <div class="m-plug-empty__d">{{ MOBILE_PLUGINS_EMPTY_HINT }}</div>
      <button class="m-plug-empty__btn" @click="goMarket">{{ MOBILE_PLUGINS_GO_MARKET_LABEL }}</button>
    </div>

    <template v-else>
      <div
        v-for="info in visiblePlugins"
        :key="info.id"
        class="m-plug-card"
        @click="goPluginPage(info.id)"
      >
        <div class="m-plug-card__head">
          <div class="m-plug-card__name">
            {{ info.name }}
            <span class="m-plug-card__ver">v{{ info.version }}</span>
          </div>
          <van-switch
            :model-value="info.status !== PLUGIN_STATUS.DISABLED"
            size="22px"
            @click.stop
            @update:model-value="(value: boolean) => onToggle(info, value)"
          />
        </div>

        <p v-if="info.description" class="m-plug-card__desc">{{ info.description }}</p>

        <div class="m-plug-card__tags">
          <span
            v-for="badge in deviceBadgesOf(info.devices)"
            :key="badge"
            class="m-plug-card__tag"
            :class="{ 'm-plug-card__tag--on': badge === PLUGIN_MOBILE_READY_BADGE }"
          >
            {{ badge }}
          </span>
          <span
            class="m-plug-card__tag"
            :class="{
              'm-plug-card__tag--ok': info.status === PLUGIN_STATUS.MOUNTED,
              'm-plug-card__tag--err': info.status === PLUGIN_STATUS.FAILED,
            }"
          >
            {{ PLUGIN_STATUS_LABEL[info.status] }}
          </span>
        </div>

        <div class="m-plug-card__meta">{{ ownerLabelOf(info) }} · {{ info.id }}</div>

        <div v-if="info.status === PLUGIN_STATUS.FAILED && info.error" class="m-plug-card__err">
          <span class="m-plug-card__err-t">{{ info.error }}</span>
          <button class="m-plug-card__act" @click.stop="onRetry(info.id)">
            {{ MOBILE_PLUGIN_RETRY_LABEL }}
          </button>
        </div>

        <div
          v-if="pagePathOf(info.id) || isUserPlugin(info.id)"
          class="m-plug-card__foot"
          :class="{ 'm-plug-card__foot--single': !isUserPlugin(info.id) }"
        >
          <button
            v-if="isUserPlugin(info.id)"
            class="m-plug-card__act m-plug-card__act--danger"
            @click.stop="onUninstall(info)"
          >
            {{ MOBILE_PLUGIN_UNINSTALL_LABEL }}
          </button>
          <button
            v-if="pagePathOf(info.id)"
            class="m-plug-card__act"
            @click.stop="goPluginPage(info.id)"
          >
            {{ MOBILE_PLUGIN_OPEN_PAGE_LABEL }} ›
          </button>
        </div>
      </div>
    </template>

    <!-- 市场入口：已装有插件时也能进市场装更多 -->
    <div v-if="visiblePlugins.length > 0" class="m-plug-market-row">
      <button class="m-plug-market-btn" @click="goMarket">
        {{ MOBILE_PLUGINS_MARKET_ENTRY_LABEL }}
      </button>
    </div>

    <div class="m-foot-note">{{ MOBILE_PLUGIN_TRUST_NOTE }}</div>
  </div>
</template>

<style scoped>
/* 空态：在 navbar 以下剩余空间内垂直水平居中（2026-10-31 真机反馈顶在上方；
   min-height 扣 navbar 占位高与安全区，内容超一屏时自然回落为顶部排布） */
.m-plug-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(100dvh - var(--van-nav-bar-height) - var(--m-inset-top));
  margin: 0 24px;
  text-align: center;
}
.m-plug-empty__t {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
}
.m-plug-empty__d {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-text-3);
}
.m-plug-empty__btn {
  margin-top: 18px;
  padding: 8px 22px;
  border-radius: 999px;
  background: var(--color-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  border: 0;
}
/* 插件卡（v3 清新版分层：surface 卡片 + hairline） */
.m-plug-card {
  margin: 10px 12px 0;
  padding: 13px 14px;
  background: var(--color-surface);
  border-radius: 12px;
}
.m-plug-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.m-plug-card__name {
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-plug-card__ver {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-3);
  font-family: var(--font-num);
}
.m-plug-card__desc {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-2);
}
.m-plug-card__tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
}
.m-plug-card__tag {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  background: var(--color-primary-weak);
  color: var(--color-primary);
}
.m-plug-card__tag--on {
  background: var(--color-down-weak);
  color: var(--color-down);
}
.m-plug-card__tag--ok {
  background: var(--color-down-weak);
  color: var(--color-down);
}
.m-plug-card__tag--err {
  background: var(--color-up-weak);
  color: var(--color-up);
}
.m-plug-card__meta {
  margin-top: 8px;
  font-size: 10.5px;
  color: var(--color-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 失败错误条（红字 + 重试） */
.m-plug-card__err {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-up-weak);
}
.m-plug-card__err-t {
  min-width: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-up);
  word-break: break-all;
}
/* 底部操作行 */
.m-plug-card__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--color-border);
}
.m-plug-card__foot--single {
  justify-content: flex-start;
}
.m-plug-card__act {
  padding: 4px 12px;
  border-radius: 999px;
  border: 0;
  background: var(--color-primary-weak);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
}
.m-plug-card__act--danger {
  background: transparent;
  color: var(--color-up);
  box-shadow: inset 0 0 0 1px var(--color-up);
}
/* 市场入口行 */
.m-plug-market-row {
  margin: 12px 12px 0;
  text-align: center;
}
.m-plug-market-btn {
  width: 100%;
  padding: 10px 0;
  border: 0;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 700;
}
</style>
