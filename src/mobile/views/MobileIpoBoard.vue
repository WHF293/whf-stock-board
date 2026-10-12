<script setup lang="ts">
/**
 * 新股次新股（v4.5.2 起自家行情全景独立拆出的二级页，入口在首页金刚区；形态参考异动独立榜页）
 *
 * 数据：同花顺新股频道「新股申购与上市」整页清单（fetchIpoBoard，GBK HTML 服务端渲染全量），
 * 上游默认序 = 未申购在前按申购日期升序；发行价 / 打新收益两列表头可点击排序
 * （点新列默认降序、同列翻转，交互与异动页表头一致）；下拉强制重拉，30 分钟 TTL 缓存
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchIpoBoard } from '../../common/api/ipo-board.api';
import type { IpoBoardItem } from '../../common/types/ipo-board.types';
import { mobileCacheGet, mobileCacheSet } from '../cache';
import { pctClass } from '../utils/format';

const router = useRouter();

const ipoList = ref<IpoBoardItem[]>([]);
const loading = ref(false);
const error = ref(false);

/** 缓存 key（独立页自有命名；与原行情全景模块的 panorama.ipo 同数据不同 key，互不影响） */
const CACHE_KEY = 'ipo.board';

const loadIpo = async (force = false): Promise<void> => {
  loading.value = true;
  error.value = false;
  try {
    const cached = force ? null : mobileCacheGet<IpoBoardItem[]>(CACHE_KEY);
    if (cached) {
      ipoList.value = cached.value;
    } else {
      const list = await fetchIpoBoard();
      ipoList.value = list;
      mobileCacheSet(CACHE_KEY, list);
    }
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
};
loadIpo();

/* === 表头排序（交互同异动页：点列默认降序，同列翻转升降；null = 上游默认序） === */
type IpoSortKey = 'issuePrice' | 'earn';
const sortKey = ref<IpoSortKey | null>(null);
const sortAsc = ref(false);

/**
 * 表头点击排序
 * @param key 排序列（发行价 / 打新收益）
 */
const onHeaderSort = (key: IpoSortKey): void => {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value;
  } else {
    sortKey.value = key;
    sortAsc.value = false;
  }
};

/** 展示行（排序后；null 值排末尾，与值列「--」占位一致） */
const rows = computed(() => {
  if (sortKey.value === null) return ipoList.value;
  const key = sortKey.value;
  const val = (it: IpoBoardItem): number | null => it[key];
  return [...ipoList.value].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return sortAsc.value ? va - vb : vb - va;
  });
});

/** 整页下拉刷新
 * @returns 无返回值，finally 里复位 v-model 收起下拉状态 */
const refreshing = ref(false);
const onRefresh = async (): Promise<void> => {
  try {
    await loadIpo(true);
  } finally {
    refreshing.value = false;
  }
};
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar
      title="新股次新股"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    />

    <div class="m-sub-scroll">
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <div v-if="loading" class="m-card m-skel-fill">
          <div v-for="i in 10" :key="i" class="m-skel-row"></div>
        </div>
        <div v-else-if="error" class="m-state">
          新股清单加载失败
          <span class="retry" @click="loadIpo(true)">重试</span>
        </div>
        <div v-else class="m-card">
          <!-- 表头（发行价 / 打新收益可点排序，箭头指示当前列与升降序，交互同异动页） -->
          <div class="m-rowhead">
            <div class="m-rowhead__nm">名称</div>
            <span
              class="m-rowhead__v"
              :class="{
                'm-rowhead__v--sort': true,
                'm-rowhead__v--on': sortKey === 'issuePrice',
              }"
              @click="onHeaderSort('issuePrice')"
            >
              发行价
              <template v-if="sortKey === 'issuePrice'">{{ sortAsc ? '▲' : '▼' }}</template>
            </span>
            <span
              class="m-rowhead__v"
              :class="{
                'm-rowhead__v--sort': true,
                'm-rowhead__v--on': sortKey === 'earn',
              }"
              @click="onHeaderSort('earn')"
            >
              打新收益
              <template v-if="sortKey === 'earn'">{{ sortAsc ? '▲' : '▼' }}</template>
            </span>
          </div>
          <div v-for="it in rows" :key="it.code" class="m-row">
            <div class="m-row__nm">
              {{ it.name }}
              <span class="sub">申购日 {{ it.applyDate || '--' }}</span>
            </div>
            <span class="m-ipo-px m-row__val sm">
              {{ it.issuePrice?.toFixed(2) ?? '--' }}
            </span>
            <span class="m-row__pct" :class="pctClass(it.earn === null ? null : 1)">
              {{ it.earn === null ? '--' : `${it.earn.toFixed(0)}元` }}
            </span>
          </div>
          <div v-if="!rows.length" class="m-state">暂无新股数据</div>
        </div>
      </van-pull-refresh>
      <div class="m-sub-tail"></div>
    </div>
  </div>
</template>

<style scoped>
/* navbar 与清单卡之间留空隙（独立页无 chips 缓冲，同异动独立榜页） */
.m-sub-scroll {
  padding-top: 10px;
}
/* 表头行：与 MobileMarketRank scoped 内的 .m-rowhead 同款（scoped 样式不跨组件，需自带） */
.m-rowhead {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px 7px;
  border-bottom: 1px solid var(--color-border);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-text-3);
}
.m-rowhead__nm {
  flex: 1;
  min-width: 0;
}
.m-rowhead__v {
  flex-shrink: 0;
  min-width: 58px;
  text-align: right;
}
/* 可排序值列：可点 + 当前排序列主色高亮 */
.m-rowhead__v--sort {
  cursor: pointer;
  user-select: none;
}
.m-rowhead__v--on {
  color: var(--color-primary);
}
/* 发行价列：与表头 / 收益列的 58px 右对齐列宽一致（.m-row__val 自身无定宽） */
.m-ipo-px {
  min-width: 58px;
  text-align: right;
}
</style>
