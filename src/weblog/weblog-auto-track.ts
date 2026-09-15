/**
 * 自动埋点：页面显示 + 全量点击兜底
 *
 * - 页面显示：订阅 `router.afterEach`，每个路由切到即记一条（详情页按前缀归到 PAGE_STOCK_DETAIL）；
 * - 点击兜底：`document` 捕获阶段统一监听 click，
 *   元素带 `data-track="WEBLOG_ACTIONS 的键"` 就按该动作记录（可再用 `data-track-detail` 补充说明），
 *   否则落到 `CLICK_ELEMENT` 并带上元素摘要 —— 这样「用户全部操作」不丢，
 *   同时高频/关键入口仍能被枚举成可读动作（新增按钮只需加属性，不必改监听逻辑）。
 */
import type { Router } from 'vue-router';
import { WEBLOG_CLICK_LABEL_MAX } from '../constants/weblog.constants';
import { truncateText } from '../utils/truncate-text';
import { isWeblogActionKey } from './weblogActions.enum';
import { beginClickTracking, trackAction, trackClickFallback, trackPageView } from './weblogActions';

/** 埋点动作属性名（在元素上标 data-track="NAV_THEME_TOGGLE"） */
const TRACK_ATTR = 'data-track';

/** 埋点说明属性名（可选，用于补充「点了哪个菜单 / 哪只股票」） */
const TRACK_DETAIL_ATTR = 'data-track-detail';

/** 兜底定位可交互祖先的选择器（点中内部 span 时上溯到真正的按钮） */
const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'label',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="option"]',
  'input',
  'select',
].join(',');

/** 是否已挂载 */
let installed = false;

/**
 * 取元素的可读摘要（标签 + id + aria-label/title/文本）
 * @param el 目标元素
 * @returns 形如 `button「搜索个股」` 的摘要
 */
const describeElement = (el: Element): string => {
  const tag = el.tagName.toLowerCase();
  const idPart = el.id ? `#${el.id}` : '';
  const raw =
    el.getAttribute('aria-label') ??
    el.getAttribute('title') ??
    el.getAttribute('placeholder') ??
    el.textContent ??
    '';
  const label = raw.replace(/\s+/g, ' ').trim();
  const classHint = typeof el.className === 'string' ? el.className.split(/\s+/)[0] : '';
  const parts = [`${tag}${idPart}`];
  if (classHint) parts.push(`.${classHint}`);
  if (label) parts.push(`「${truncateText(label, WEBLOG_CLICK_LABEL_MAX)}」`);
  return parts.join('');
};

/**
 * 全局点击处理（捕获阶段：即使业务处理函数 stopPropagation 也能记录）
 *
 * 两条路径：
 * - 元素（或祖先）带 data-track → 立即按枚举动作记录；
 * - 未标注 → 走延迟兜底（若随后出现更精确的埋点则自动取消，一次点击只留一条）。
 * @param event 鼠标事件
 */
const onClick = (event: MouseEvent): void => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  // 先给这一次点击领序号：同一次点击的兜底才能被认领，不会误伤上一次点击待派的兜底
  beginClickTracking();
  // 命中带 data-track 的元素即按枚举动作记录；否则上溯到可交互祖先做兜底
  const tracked = target.closest(`[${TRACK_ATTR}]`);
  const element = tracked ?? target.closest(INTERACTIVE_SELECTOR) ?? target;
  const trackKey = element.getAttribute(TRACK_ATTR);
  const trackDetail = element.getAttribute(TRACK_DETAIL_ATTR);
  if (trackKey && isWeblogActionKey(trackKey)) {
    trackAction(trackKey, { target: describeElement(element), detail: trackDetail });
    return;
  }
  trackClickFallback({ target: describeElement(element), detail: trackDetail });
};

/**
 * 挂载自动埋点（页面显示 + 点击兜底）
 * @param router 路由实例（用于订阅页面切换）
 */
export const initWeblogAutoTrack = (router: Router): void => {
  if (installed) return;
  installed = true;

  router.afterEach((to) => {
    const title = typeof to.meta.title === 'string' ? to.meta.title : to.path;
    trackPageView(to.path, title);
  });

  // 首个页面：afterEach 只对「本钩子注册之后发生的导航」生效，
  // 应用启动时若当前路由已解析（独立窗口直开某路径）需补记一条
  const initial = router.currentRoute.value;
  if (initial.matched.length > 0) {
    const title = typeof initial.meta.title === 'string' ? initial.meta.title : initial.path;
    trackPageView(initial.path, title);
  }

  document.addEventListener('click', onClick, true);
};

/**
 * 卸载自动埋点
 */
export const destroyWeblogAutoTrack = (): void => {
  if (!installed) return;
  installed = false;
  document.removeEventListener('click', onClick, true);
};
