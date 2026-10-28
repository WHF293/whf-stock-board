/**
 * 禁用双指捏合 / 触控板捏合缩放页面
 *
 * - viewport meta 的 `user-scalable=no` 在部分安卓 WebView（无障碍缩放开启时）会被忽略，
 *   触屏侧再拦一层：触控点 ≥2 的 touchmove 一律 preventDefault（单指滚动不受影响）。
 * - PC 端触控板捏合在 Chromium 里等价于 Ctrl+滚轮缩放，拦 `wheel` 事件且 `ctrlKey` 为真时
 *   preventDefault；Ctrl+加减键的页面缩放同样拦截。
 */

/** Ctrl+滚轮 / Ctrl+加减键组合键位码 */
const ZOOM_KEY_CODES = new Set(['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Digit0', 'Numpad0']);

/**
 * 挂载全局缩放手势拦截监听（幂等）
 *
 * @returns 解绑函数，用于移除全部监听
 */
export const disablePinchZoom = (): (() => void) => {
  const onTouchMove = (event: TouchEvent): void => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  };

  const onGestureStart = (event: Event): void => {
    event.preventDefault();
  };

  const onWheel = (event: WheelEvent): void => {
    if (event.ctrlKey) {
      event.preventDefault();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey && ZOOM_KEY_CODES.has(event.code)) {
      event.preventDefault();
    }
  };

  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('gesturestart', onGestureStart);
  document.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('keydown', onKeyDown);

  return () => {
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('gesturestart', onGestureStart);
    document.removeEventListener('wheel', onWheel);
    document.removeEventListener('keydown', onKeyDown);
  };
};
