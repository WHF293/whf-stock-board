/**
 * 生产环境禁用开发者工具入口手段
 *
 * 拦截 F12 / Ctrl+Shift+I|J|C 快捷键与右键菜单，阻止常见的开发者工具打开路径；
 * 仅在线上（import.meta.env.PROD）由 main.ts 调用，开发环境不受影响
 */

/**
 * 拦截开发者工具相关快捷键（F12 / Ctrl+Shift+I|J|C）
 * @param event 键盘事件
 */
const onKeydown = (event: KeyboardEvent): void => {
  const isF12 = event.key === 'F12';
  const isShiftInspection =
    event.ctrlKey && event.shiftKey && ['I', 'J', 'C', 'i', 'j', 'c'].includes(event.key);
  if (isF12 || isShiftInspection) {
    event.preventDefault();
    event.stopPropagation();
  }
};

/**
 * 拦截右键菜单（阻断「检查元素」入口）
 * @param event 鼠标事件
 */
const onContextMenu = (event: MouseEvent): void => {
  event.preventDefault();
};

/**
 * 启用开发者工具禁用（生产环境一次性挂载全局监听）
 */
export const disableDevtools = (): void => {
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('contextmenu', onContextMenu);
};
