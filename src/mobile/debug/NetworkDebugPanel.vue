<script setup lang="ts">
import { computed, ref } from 'vue';
import { showToast } from 'vant';
import { setDebugMode } from './debug-mode';
import { clearNetworkDebugRecords, networkDebugRecords } from './network-recorder';
import type { NetworkDebugRecord } from './network-recorder';

/**
 * 调试网络面板（van-popup 底部近全屏）
 *
 * 列表态：方法徽标 / 主机 / 数据源标注 / 路径 / 状态 / 耗时 / 时间，支持关键字过滤；
 * 详情态：完整 URL + 响应体（GBK 自动回退解码，超长截断）+ 一键复制。
 * 底部动作：清空记录、关闭调试模式（关闭即摘捕获钩子并卸载整个 DebugOverlay）。
 */
defineProps<{ show: boolean }>();

const emit = defineEmits<{ 'update:show': [value: boolean] }>();

const keyword = ref('');
const detail = ref<NetworkDebugRecord | null>(null);

/**
 * van-popup 显隐双向绑定中转
 * @param value popup 最新的显隐值
 */
const onPopupShow = (value: boolean): void => {
  emit('update:show', value);
};

/** 关闭面板 */
const close = (): void => {
  emit('update:show', false);
};

/** 关键字过滤（命中 URL 或数据源标注；大小写不敏感） */
const filtered = computed<readonly NetworkDebugRecord[]>(() => {
  const kw = keyword.value.trim();
  if (kw === '') return networkDebugRecords;
  const lower = kw.toLowerCase();
  return networkDebugRecords.filter(
    (record) => record.url.toLowerCase().includes(lower) || record.source.includes(kw),
  );
});

/**
 * 毫秒时间 → HH:MM:SS
 * @param ms 时间戳
 * @returns 时分秒文本
 */
const timeText = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/**
 * 方法徽标色调类名
 * @param method 请求方法
 * @returns 'get' | 'post' | 'other'
 */
const methodClass = (method: string): string =>
  method === 'GET' ? 'get' : method === 'POST' ? 'post' : 'other';

/**
 * 状态列展示文本
 * @param record 记录
 * @returns 状态码文本，传输层失败为「失败」
 */
const statusText = (record: NetworkDebugRecord): string =>
  record.status === null ? '失败' : String(record.status);

/** 清空全部记录并退出详情态 */
const clearAll = (): void => {
  clearNetworkDebugRecords();
  detail.value = null;
};

/** 关闭调试模式：摘捕获钩子 + 卸载悬浮球与面板 */
const disableDebug = (): void => {
  setDebugMode(false);
  close();
};

/**
 * 复制响应体到剪贴板（Clipboard API 不可用时回退 execCommand）
 */
const copyBody = async (): Promise<void> => {
  const text = detail.value?.body;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    showToast(done ? '已复制' : '复制失败');
  }
};
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    :style="{ height: '94%' }"
    :close-on-popstate="false"
    @update:show="onPopupShow"
  >
    <div class="m-dbg">
      <template v-if="detail === null">
        <div class="m-dbg__head">
          <div class="m-dbg__title">
            网络请求
            <span class="m-dbg__cnt">{{ filtered.length }} 条</span>
          </div>
          <button class="m-dbg__close" aria-label="关闭" @click="close">✕</button>
        </div>
        <input
          v-model="keyword"
          class="m-dbg__search"
          type="text"
          placeholder="按 URL / 数据源过滤（腾讯 / 东财 / 同花顺…）"
        >
        <div class="m-dbg__list">
          <button v-for="record in filtered" :key="record.id" class="m-dbg__row" @click="detail = record">
            <div class="m-dbg__row-top">
              <span class="m-dbg__method" :class="methodClass(record.method)">{{ record.method }}</span>
              <span class="m-dbg__host">{{ record.host }}</span>
              <span class="m-dbg__src">{{ record.source }}</span>
            </div>
            <div class="m-dbg__path">{{ record.path }}</div>
            <div class="m-dbg__row-sub">
              <span class="m-dbg__status" :class="record.ok ? 'ok' : 'bad'">{{ statusText(record) }}</span>
              <span>{{ record.durationMs }}ms</span>
              <span>{{ timeText(record.startedAt) }}</span>
              <span v-if="record.error" class="m-dbg__err">{{ record.error }}</span>
            </div>
          </button>
          <div v-if="filtered.length === 0" class="m-dbg__empty">
            暂无捕获记录（JSONP 类源不经过统一收口，无法捕获）
          </div>
        </div>
        <div class="m-dbg__foot">
          <button class="m-dbg__act" @click="clearAll">清空</button>
          <button class="m-dbg__act m-dbg__act--danger" @click="disableDebug">关闭调试模式</button>
        </div>
      </template>
      <template v-else>
        <div class="m-dbg__head">
          <button class="m-dbg__back" @click="detail = null">‹ 返回</button>
          <div class="m-dbg__title">请求详情</div>
          <button class="m-dbg__close" aria-label="关闭" @click="close">✕</button>
        </div>
        <div class="m-dbg__detail">
          <div class="m-dbg__kv">
            <span class="m-dbg__k">数据源</span>
            <span>{{ detail.source }}</span>
          </div>
          <div class="m-dbg__kv">
            <span class="m-dbg__k">状态</span>
            <span :class="detail.ok ? 'ok' : 'bad'">{{ statusText(detail) }} · {{ detail.durationMs }}ms</span>
          </div>
          <div class="m-dbg__kv">
            <span class="m-dbg__k">时间</span>
            <span>{{ timeText(detail.startedAt) }}</span>
          </div>
          <div v-if="detail.error" class="m-dbg__kv">
            <span class="m-dbg__k">错误</span>
            <span class="bad">{{ detail.error }}</span>
          </div>
          <div class="m-dbg__url">{{ detail.url }}</div>
          <div class="m-dbg__body-head">
            <span class="m-dbg__k">响应内容{{ detail.bodyTruncated ? '（已截断）' : '' }}</span>
            <button class="m-dbg__copy" :disabled="detail.body === null" @click="copyBody">复制</button>
          </div>
          <pre class="m-dbg__body">{{ detail.bodyPending ? '（响应体读取中…）' : (detail.body ?? '（无响应体）') }}</pre>
        </div>
      </template>
    </div>
  </van-popup>
</template>

<style scoped>
.m-dbg {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--m-page-bg, var(--color-bg));
}
.m-dbg__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 6px;
}
.m-dbg__title {
  font-size: 15px;
  font-weight: 700;
}
.m-dbg__cnt {
  margin-left: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-3);
}
.m-dbg__close,
.m-dbg__back {
  border: 0;
  background: none;
  color: var(--color-text-2);
  font-size: 14px;
  padding: 4px 6px;
}
.m-dbg__back { color: var(--color-primary); }
.m-dbg__search {
  margin: 4px 12px 8px;
  padding: 7px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  outline: none;
}
.m-dbg__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 8px;
  -webkit-overflow-scrolling: touch;
}
.m-dbg__row {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  padding: 9px 12px;
  margin-bottom: 6px;
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-text);
}
.m-dbg__row-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.m-dbg__method {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 5px;
  color: #fff;
}
.m-dbg__method.get { background: var(--color-info, #378add); }
.m-dbg__method.post { background: var(--color-warning, #ba7517); }
.m-dbg__method.other { background: var(--color-text-3); }
.m-dbg__host {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 700;
}
.m-dbg__src {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--color-primary-weak);
  color: var(--color-primary);
}
.m-dbg__path {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-dbg__row-sub {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--color-text-2);
}
.m-dbg__status { font-weight: 800; }
.m-dbg__status.ok { color: var(--color-up, #10b981); }
.m-dbg__status.bad,
.bad { color: var(--color-down, #e24b4a); }
.m-dbg__err {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-down, #e24b4a);
}
.m-dbg__empty {
  padding: 40px 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--color-text-3);
  line-height: 1.7;
}
.m-dbg__foot {
  display: flex;
  gap: 10px;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.m-dbg__act {
  flex: 1;
  padding: 9px 0;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-text-2);
  font-size: 13px;
  font-weight: 600;
}
.m-dbg__act--danger {
  border-color: color-mix(in srgb, var(--color-down, #e24b4a) 40%, transparent);
  color: var(--color-down, #e24b4a);
}
.m-dbg__detail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  -webkit-overflow-scrolling: touch;
}
.m-dbg__kv {
  display: flex;
  gap: 10px;
  padding: 6px 0;
  font-size: 13px;
  color: var(--color-text);
}
.m-dbg__k {
  flex-shrink: 0;
  color: var(--color-text-3);
  font-size: 12px;
}
.m-dbg__url {
  margin: 8px 0;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--color-surface);
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
  color: var(--color-text-2);
}
.m-dbg__body-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0 6px;
}
.m-dbg__copy {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 600;
  padding: 3px 12px;
}
.m-dbg__copy:disabled { color: var(--color-text-3); }
.m-dbg__body {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--color-text-2);
  min-height: 120px;
}
</style>
