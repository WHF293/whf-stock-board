import { ref } from 'vue';
import type { Ref } from 'vue';

/**
 * 模块级共享的收起态（会话级，不持久化）。
 *
 * ⚠️ 不能写成组件内 ref：详情页路由是 `/stock-detail/:symbol`，MainLayout 的
 * KeepAlive 以 `routeRecord.path`（含 symbol）为 key，**每只股票各缓存一个页面实例**，
 * 组件内 ref 会变成"按股票各存一份"——股票 A 收起、切到股票 B 变展开、切回 A 又收起。
 * 收起态是布局偏好，与股票无关，必须放在组件实例之外。
 */
const isListCollapsed = ref(false);
const isInfoCollapsed = ref(false);

/**
 * 股票详情页左右面板收起态（左侧来源列表 / 右侧信息栏共用，跨股票共享、会话级）
 * @returns 两个可读写 ref：`isListCollapsed` 左侧列表收起态、`isInfoCollapsed` 右侧信息栏收起态
 */
export const useDetailPanelCollapse = (): {
  isListCollapsed: Ref<boolean>;
  isInfoCollapsed: Ref<boolean>;
} => ({
  isListCollapsed,
  isInfoCollapsed,
});
