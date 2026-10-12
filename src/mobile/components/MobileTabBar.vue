<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  MOBILE_TAB_DRAG_SLOP_PX,
  MOBILE_TAB_ITEMS,
  MOBILE_TAB_THUMB_EASE_RESTORE,
  MOBILE_TAB_THUMB_EASE_TRAVEL,
  MOBILE_TAB_THUMB_RESTORE_DELAY_MS,
  MOBILE_TAB_THUMB_RESTORE_MS,
  MOBILE_TAB_THUMB_TRAVEL_MS,
  MOBILE_TAB_THUMB_TRAVEL_OPACITY,
  MOBILE_TAB_THUMB_TRAVEL_SCALE,
} from '../constants';
import { attachLiquidGlass, type LiquidGlassHandle } from '../utils/liquid-glass';

/**
 * 底部 TabBar：四个主 Tab（首页 / 自选 / 热点新闻 / 我的）
 * 仅在主 Tab 路由显示（二级页隐藏）；激活态由 router-link 的 active-class 按路径匹配；
 * 选中态的亮胶囊是指示器（__thumb），切换 tab 时平滑滑动到新位置——
 * 行程中均匀缩小至 80% 并降低不透明度，接近落点时回弹放大恢复（液态玻璃手感，规格见 DESIGN-MOBILE.md §3）
 * 另支持按住气泡左右拖拽跟手，松手（含手指离开 tabbar / 离开屏幕）吸附到最近 tab（DESIGN-MOBILE.md §2.2）
 *
 * 玻璃质感：Chromium 系 WebView 下由 util 挂 SVG 折射滤镜升级为真液态玻璃
 * （边缘折射 + 低磨砂，`.m-tabbar--liquid` 档），不支持的环境保持原磨砂玻璃回退。
 */
const route = useRoute();
const router = useRouter();
const visible = computed(() => MOBILE_TAB_ITEMS.some((item) => item.path === route.path));

/** TabBar 根元素（液态玻璃滤镜的挂载目标 + 拖拽事件挂载点） */
const tabbarRef = ref<HTMLElement | null>(null);

/** 液态玻璃滤镜句柄（null = 不支持或未挂载，走磨砂回退） */
let glassHandle: LiquidGlassHandle | null = null;

/** 按当前可见状态挂载 / 卸载折射滤镜（尺寸就绪后在 nextTick 量取） */
const setupGlass = (): void => {
  glassHandle?.destroy();
  glassHandle = null;
  if (visible.value && tabbarRef.value) {
    glassHandle = attachLiquidGlass(tabbarRef.value);
  }
};

onMounted(() => {
  void nextTick(setupGlass);
});

watch(visible, () => {
  void nextTick(setupGlass);
});

onUnmounted(() => glassHandle?.destroy());

/** 当前激活 Tab 序号（驱动指示胶囊的横向位移；非主 Tab 页组件不渲染） */
const activeIndex = computed(() =>
  MOBILE_TAB_ITEMS.findIndex((item) => item.path === route.path),
);

/** 指示胶囊样式：位移 + 行程中的缩放/透明度包络（拖拽期间被直接改写为跟手态） */
const thumbStyle = ref<{ transform: string; transition: string; opacity: string }>({
  transform: `translateX(${activeIndex.value * 100}%)`,
  transition: `transform ${MOBILE_TAB_THUMB_TRAVEL_MS}ms ${MOBILE_TAB_THUMB_EASE_TRAVEL}`,
  opacity: '1',
});

let restoreTimer: number | undefined;

/* ---- 气泡拖拽跟手（DESIGN-MOBILE.md §2.2）----
 * pointerdown 命中激活项（气泡所在位置）→ 记录几何 + setPointerCapture（手指滑出 tabbar /
 * 屏幕仍能收到 move/up）→ 越过 slop 进入拖拽：气泡关过渡、px 级跟手、缩至行程档；
 * 松手吸附最近 tab：跳转路由 + 回弹恢复；skipNextTravel 让 watch(activeIndex) 跳过
 * 行程动画，避免吸附后又播一次 340ms 滑动。位移小于 slop 视为普通点击，行为不变。 */

/** 拖拽中（气泡处于跟手态） */
let dragging = false;
/** 本次手势是否已越过 slop、确认为拖拽 */
let dragArmed = false;
/** pointerdown 起点横坐标（用于 slop 判定） */
let downX = 0;
/** 只跟踪按下时的这根手指，其余指针忽略 */
let dragPointerId: number | null = null;
/** pointerdown 时量取的 tabbar 几何 */
let navRect: DOMRect | null = null;
/** 单个 tab 槽位宽度（px）＝(底座宽 - 左右 padding) / 4 */
let slotWidth = 0;
/** 拖拽结束后吞掉落点处 router-link 的 click，防止松手即二次跳转 */
let suppressClick = false;
/** 拖拽吸附触发的路由跳转：watch(activeIndex) 首帧跳过行程动画 */
let skipNextTravel = false;

/**
 * 拖拽中气泡的 translateX（px）：clamp 在玻璃底座内（左右各 6px padding）
 * @param clientX 指针横坐标
 * @returns translateX 样式值
 */
const dragTranslateX = (clientX: number): string => {
  if (!navRect) return '0px';
  const max = Math.max(navRect.width - 12 - slotWidth, 0);
  const raw = clientX - navRect.left - 6 - slotWidth / 2;
  return `${Math.min(Math.max(raw, 0), max)}px`;
};

/**
 * 进入拖拽跟手态：关过渡 + 缩至行程档（与点击切换同一缩小比例/透明度）
 * @param clientX
 */
const enterDrag = (clientX: number): void => {
  dragging = true;
  thumbStyle.value = {
    transform: `translateX(${dragTranslateX(clientX)}) scale(${MOBILE_TAB_THUMB_TRAVEL_SCALE})`,
    transition: 'none',
    opacity: MOBILE_TAB_THUMB_TRAVEL_OPACITY,
  };
};

/**
 * 松手 / 取消：吸附最近 tab 并回弹落定
 * @param clientX
 */
const endDrag = (clientX: number): void => {
  if (!dragging || !navRect) return;
  dragging = false;
  window.clearTimeout(restoreTimer);
  const idx = Math.min(
    Math.max(Math.floor((clientX - navRect.left - 6) / slotWidth), 0),
    MOBILE_TAB_ITEMS.length - 1,
  );
  const settle = (target: number): void => {
    thumbStyle.value = {
      transform: `translateX(${target * 100}%) scale(1)`,
      transition: `transform ${MOBILE_TAB_THUMB_RESTORE_MS}ms ${MOBILE_TAB_THUMB_EASE_RESTORE}, opacity ${MOBILE_TAB_THUMB_RESTORE_MS}ms ease`,
      opacity: '1',
    };
  };
  if (idx !== activeIndex.value) {
    // 吸附目标 ≠ 当前 tab：跳转路由；watch 首帧跳过行程动画，气泡直接回弹落定
    skipNextTravel = true;
    settle(idx);
    void router.push(MOBILE_TAB_ITEMS[idx].path);
  } else {
    // 原位松手：仅回弹恢复
    settle(idx);
  }
  // 吞掉本次手势产生的 click，下一次点击不受影响
  suppressClick = true;
};

const onPointerDown = (e: PointerEvent): void => {
  // 只认主键单指；按住气泡 = 按在激活项上（thumb 本身 pointer-events:none）
  if (dragging || !e.isPrimary) return;
  const target = e.target as Element | null;
  if (!target?.closest('.m-tabbar__item--active')) return;
  const nav = tabbarRef.value;
  if (!nav) return;
  navRect = nav.getBoundingClientRect();
  slotWidth = (navRect.width - 12) / MOBILE_TAB_ITEMS.length;
  downX = e.clientX;
  dragArmed = false;
  dragPointerId = e.pointerId;
  nav.setPointerCapture(e.pointerId);
};

const onPointerMove = (e: PointerEvent): void => {
  if (dragPointerId === null || e.pointerId !== dragPointerId) return;
  if (!dragging) {
    // 未过 slop 前不干扰普通点击；越过即进入跟手态
    if (!dragArmed && Math.abs(e.clientX - downX) >= MOBILE_TAB_DRAG_SLOP_PX) {
      dragArmed = true;
      enterDrag(e.clientX);
    }
    return;
  }
  thumbStyle.value = {
    ...thumbStyle.value,
    transform: `translateX(${dragTranslateX(e.clientX)}) scale(${MOBILE_TAB_THUMB_TRAVEL_SCALE})`,
  };
};

const onPointerUp = (e: PointerEvent): void => {
  if (dragPointerId === null || e.pointerId !== dragPointerId) return;
  dragPointerId = null;
  if (dragging) endDrag(e.clientX);
};

const onPointerCancel = (e: PointerEvent): void => {
  if (dragPointerId === null || e.pointerId !== dragPointerId) return;
  dragPointerId = null;
  // 系统打断（来电、手势冲突等）：视为松手，按最后位置吸附
  if (dragging) endDrag(e.clientX);
};

/**
 * 拖拽结束后吞一次 click，防止松手位置 router-link 的默认跳转
 * @param e
 */
const onClickCapture = (e: MouseEvent): void => {
  if (!suppressClick) return;
  suppressClick = false;
  e.preventDefault();
  e.stopPropagation();
};

watch(activeIndex, (idx) => {
  // 拖拽吸附触发的跳转：气泡已在 endDrag 里直接回弹落定，跳过行程动画
  if (skipNextTravel) {
    skipNextTravel = false;
    return;
  }
  window.clearTimeout(restoreTimer);
  // 行程：滑动 + 缩小 + 变透明
  thumbStyle.value = {
    transform: `translateX(${idx * 100}%) scale(${MOBILE_TAB_THUMB_TRAVEL_SCALE})`,
    transition: `transform ${MOBILE_TAB_THUMB_TRAVEL_MS}ms ${MOBILE_TAB_THUMB_EASE_TRAVEL}, opacity ${MOBILE_TAB_THUMB_TRAVEL_MS}ms ease`,
    opacity: MOBILE_TAB_THUMB_TRAVEL_OPACITY,
  };
  // 接近落点：回弹放大恢复默认
  restoreTimer = window.setTimeout(() => {
    thumbStyle.value = {
      transform: `translateX(${idx * 100}%) scale(1)`,
      transition: `transform ${MOBILE_TAB_THUMB_RESTORE_MS}ms ${MOBILE_TAB_THUMB_EASE_RESTORE}, opacity ${MOBILE_TAB_THUMB_RESTORE_MS}ms ease`,
      opacity: '1',
    };
  }, MOBILE_TAB_THUMB_RESTORE_DELAY_MS);
});

onUnmounted(() => window.clearTimeout(restoreTimer));
</script>

<template>
  <nav
    v-if="visible"
    ref="tabbarRef"
    class="m-tabbar"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @click.capture="onClickCapture"
    @dragstart.prevent
  >
    <span class="m-tabbar__thumb" :style="thumbStyle"></span>
    <router-link
      v-for="item in MOBILE_TAB_ITEMS"
      :key="item.path"
      :to="item.path"
      class="m-tabbar__item"
      active-class="m-tabbar__item--active"
    >
      <span class="m-tabbar__icon">{{ item.icon }}</span>
      <span>{{ item.label }}</span>
    </router-link>
  </nav>
</template>
