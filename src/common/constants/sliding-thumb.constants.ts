/**
 * PC 按钮组滑动气泡（use-sliding-thumb）动画规格
 *
 * 与移动端 TabBar 指示胶囊（src/mobile/constants.ts 的 MOBILE_TAB_THUMB_* 系列）
 * 同一套手感：行程「滑动 + 缩小 + 变透明」，接近落点回弹放大恢复（液态玻璃感）。
 * 移动端那份本次不迁移，两处数值需保持一致；规格来源见 mobile/constants.ts 注释
 * （.ai/项目资源/stock-board-mobile-ui-clean-v2.html 附录 §1-②）。
 */

/** 行程位移时长（毫秒；先快后慢曲线） */
export const SLIDING_THUMB_TRAVEL_MS = 340;

/** 行程缓动（easeOutQuint 感，与移动端横滑过渡同族） */
export const SLIDING_THUMB_EASE_TRAVEL = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** 行程中的缩小比例 */
export const SLIDING_THUMB_TRAVEL_SCALE = 0.8;

/** 行程中的不透明度 */
export const SLIDING_THUMB_TRAVEL_OPACITY = '0.55';

/** 行程开始多少毫秒后开始恢复（接近落点，行程未完即切到回弹段，浏览器对 transform 重定向） */
export const SLIDING_THUMB_RESTORE_DELAY_MS = 160;

/** 恢复时长（毫秒；轻回弹曲线） */
export const SLIDING_THUMB_RESTORE_MS = 220;

/** 恢复缓动（轻微过冲的回弹） */
export const SLIDING_THUMB_EASE_RESTORE = 'cubic-bezier(0.3, 1.35, 0.6, 1)';

/** 系统减少动态效果偏好的媒体查询（命中时气泡直接跳位，不播过渡） */
export const SLIDING_THUMB_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
