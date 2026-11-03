/**
 * 大A宝典独立窗口（webview 容器）
 *
 * - 与盯盘小组件同思路的轻量独立窗口：Tauri 下用独立 WebviewWindow 打开
 *   `treasury.html`（多页轻量入口，纯静态文案渲染端，见 src/widget/treasury-main.ts）；
 * - 两个窗口：桌面横条（treasury-fab，常驻屏幕轮播祖训，2026-11-03 王总指定参考
 *   盯盘条形态）与弹窗（treasury-bubble，横条点击打开的完整内容窗口）；
 * - capabilities 的 windows 列表须包含这两个 label（treasury.json），否则 IPC 全被拒
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { appStorage } from './app-local-storage';
import {
  STORAGE_NS_TREASURY_BAR_POSITION,
  TREASURY_BAR_HEIGHT,
  TREASURY_BAR_WINDOW_LABEL,
  TREASURY_BAR_WINDOW_URL,
  TREASURY_BAR_WIDTH,
  TREASURY_POPUP_WINDOW_LABEL,
} from '../constants/treasury.constants.ts';

/** 宝典弹窗窗口 label（全局唯一；capabilities 按此授权） */
export const TREASURY_WINDOW_LABEL = TREASURY_POPUP_WINDOW_LABEL;

/** 窗口默认尺寸（内容为自定义标题栏 + 平铺清单一行两条 + 免责底栏，可拉伸） */
const TREASURY_WINDOW_WIDTH = 680;
const TREASURY_WINDOW_HEIGHT = 560;

/** 横条默认停靠时距屏幕 / 工作区右、下边缘的边距（逻辑像素，与盯盘条同款 8） */
const TREASURY_BAR_DOCK_MARGIN = 8;

/**
 * 查询宝典窗口是否已打开
 * @returns 已打开的窗口实例（null = 未打开）
 */
export const getTreasuryWindow = (): Promise<WebviewWindow | null> =>
  WebviewWindow.getByLabel(TREASURY_WINDOW_LABEL);

/**
 * 打开（或唤醒 / 聚焦）宝典独立窗口
 *
 * - Tauri：已有窗口（含「收起」隐藏态）→ show + 聚焦；否则创建新 WebviewWindow
 *   （decorations:false 去系统三键，标题栏在视图内自绘，2026-11-03 王总指定；
 *   收起 = hide 保活不销毁，秒回不重载）；
 * - 浏览器（开发模式）：window.open 弹独立小窗（多页入口在 vite dev / 构建产物
 *   下均可直达），返回 true 表示已打开
 *
 * ⚠️ WebviewWindow 构造函数是同步返回的，创建成败经 tauri://created / tauri://error
 * 事件异步到达，必须等事件再下结论，否则创建失败会被误报成功
 * @returns 是否已打开（窗口）
 */
export const openTreasuryWindow = async (): Promise<boolean> => {
  if (isTauri()) {
    try {
      const existing = await getTreasuryWindow();
      if (existing) {
        // 收起（隐藏）态先唤醒再聚焦；前台态 show 为幂等 no-op
        await existing.show();
        await existing.setFocus();
        return true;
      }
      return await new Promise<boolean>((resolve) => {
        const win = new WebviewWindow(TREASURY_WINDOW_LABEL, {
          url: 'treasury.html',
          title: '大A宝典',
          width: TREASURY_WINDOW_WIDTH,
          height: TREASURY_WINDOW_HEIGHT,
          center: true,
          resizable: true,
          decorations: false,
        });
        win.once('tauri://created', () => resolve(true));
        win.once('tauri://error', (event) => {
          console.error('[treasury-window] create failed', event);
          resolve(false);
        });
      });
    } catch (error) {
      console.error('[treasury-window] open', error);
      return false;
    }
  }
  // 浏览器开发模式：多页入口直接弹小窗
  const features = `width=${TREASURY_WINDOW_WIDTH},height=${TREASURY_WINDOW_HEIGHT},menubar=no,toolbar=no,location=no,status=no`;
  return window.open('treasury.html', TREASURY_WINDOW_LABEL, features) !== null;
};

/**
 * 收起宝典弹窗窗口（弹窗标题栏「收起」按钮入口）
 *
 * 收起 ≠ 关闭：Tauri 下 hide() 保活实例（内容与输入中的祖训草稿不丢），
 * 横条 / 固钉点击经 openTreasuryWindow 秒回；浏览器态只能 close。
 */
export const collapseTreasuryWindow = async (): Promise<void> => {
  if (!isTauri()) {
    window.close();
    return;
  }
  try {
    await getCurrentWindow().hide();
  } catch (error) {
    console.error('[treasury-window] collapse', error);
  }
};

/**
 * 关闭宝典桌面横条窗口（设置页开关关闭入口）
 *
 * 设置关掉即销毁横条（轮播随之停止）；重新开启由 ensureTreasuryBarWindow 重建。
 * 未打开时为静默空操作。
 */
export const closeTreasuryBarWindow = async (): Promise<void> => {
  try {
    const existing = await WebviewWindow.getByLabel(TREASURY_BAR_WINDOW_LABEL);
    await existing?.close();
  } catch (error) {
    console.error('[treasury-bar] close', error);
  }
};

/**
 * 计算横条默认停靠位置（屏幕 / 工作区右下角）
 *
 * 走主窗口既有 `get_work_area` 命令（SPI 精确工作区，盯盘条同款）；查询失败回退
 * `screen.width/height - 预留 48px 任务栏` 启发式。物理坐标 ÷ devicePixelRatio
 * （主窗口 webview 的缩放比 = 横条所在主屏缩放比）得到 WebviewWindow options
 * 需要的逻辑像素坐标。
 * @returns 逻辑坐标（x/y = 左上角）；拿不到任何信息时返回 null（交 Tauri 居中兜底）
 */
const resolveBarDefaultPosition = async (): Promise<{ x: number; y: number } | null> => {
  const scale = window.devicePixelRatio || 1;
  const barPhysW = TREASURY_BAR_WIDTH * scale;
  const barPhysH = TREASURY_BAR_HEIGHT * scale;
  const marginPhys = TREASURY_BAR_DOCK_MARGIN * scale;
  let right: number | null = null;
  let bottom: number | null = null;
  try {
    const area = await invoke<[number, number, number, number] | null>('get_work_area');
    if (area) {
      [, , right, bottom] = area;
    }
  } catch {
    // 命令不可用走启发式
  }
  if (right === null || bottom === null) {
    if (typeof window.screen?.width !== 'number' || window.screen.width <= 0) return null;
    right = (window.screen.width - 48) * scale;
    bottom = (window.screen.height - 48) * scale;
  }
  return {
    x: (right - barPhysW - marginPhys) / scale,
    y: (bottom - barPhysH - marginPhys) / scale,
  };
};

/**
 * 确保宝典桌面横条窗口存在（主窗口启动时调用；已存在则不动）
 *
 * 位置恢复：appStorage 记忆的物理坐标优先（÷ 缩放比转逻辑坐标），无记忆则停靠
 * 屏幕右下角。窗口形态：无边框 + 透明 + 置顶 + 不进任务栏 + 不可拉伸 + 不抢焦点
 * （贴近盯盘条）。
 */
export const ensureTreasuryBarWindow = async (): Promise<void> => {
  if (!isTauri()) return;
  try {
    const existing = await WebviewWindow.getByLabel(TREASURY_BAR_WINDOW_LABEL);
    if (existing) return;
    const scale = window.devicePixelRatio || 1;
    // 位置：记忆物理坐标优先（横条端拖动后写入，跨窗口共享 localStorage）
    let position: { x: number; y: number } | null = null;
    const raw = appStorage.getItem(STORAGE_NS_TREASURY_BAR_POSITION);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { x: number; y: number };
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          position = { x: parsed.x / scale, y: parsed.y / scale };
        }
      } catch {
        // 坏数据走默认停靠
      }
    }
    position ??= await resolveBarDefaultPosition();
    await new Promise<void>((resolve) => {
      const win = new WebviewWindow(TREASURY_BAR_WINDOW_LABEL, {
        url: TREASURY_BAR_WINDOW_URL,
        title: '大A宝典',
        width: TREASURY_BAR_WIDTH,
        height: TREASURY_BAR_HEIGHT,
        ...(position ? { x: position.x, y: position.y } : {}),
        resizable: false,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focus: false,
        shadow: false,
      });
      win.once('tauri://created', () => resolve());
      win.once('tauri://error', (event) => {
        console.error('[treasury-bar] create failed', event);
        resolve(); // 创建失败不阻塞主窗口启动（下次启动重试）
      });
    });
  } catch (error) {
    console.error('[treasury-bar] ensure', error);
  }
};
