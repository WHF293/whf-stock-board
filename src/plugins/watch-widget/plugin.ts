/**
 * 插件 dsh-watch-widget · 任务栏盯盘小组件
 *
 * 把顶栏「自选盯盘」的轮播内容常驻成 **Windows 任务栏上方的置顶迷你条**
 * （摸鱼场景：上班时不开炒股软件也能一眼扫到自选盯盘标的）。架构上三件事：
 *
 * - **数据零冗余**：本插件不发任何上游请求。声明 `inject: ['watch:repo']` 等盯盘
 *   插件就绪后，`consume('watch:monitor')` 复用**同一份引擎实例**的报价快照
 *   （第二份引擎会导致上游请求翻倍 + 阈值 armed 状态双写，见 sidebar-watch/monitor.ts）；
 *   快照经 Tauri 事件 `watch-widget://lines` 推给小组件窗口，窗口是纯渲染端。
 * - **主窗口零改动**：条 / 气泡是独立轻量入口（`watch-widget.html`，不装插件内核、
 *   不装路由），生灭由设置开关驱动；插件卸载（或盯盘插件被停用触发依赖级联）时
 *   `ctx.onDispose` 关闭全部窗口，宿主可逆。
 * - **摸鱼交互**：条与气泡都 `focusable: false`（点击不抢工作窗口焦点）；
 *   hover 模式下鼠标离开自动隐藏、移到屏幕右下角热区唤回；
 *   单击条展开气泡看全部候选，点气泡标的 / 双击条上标的 → 唤起主窗口并跳
 *   股票详情整页（左侧列表 = 盯盘候选，复用详情页上下文机制）。
 */
import { computed, watch } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { cursorPosition } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { PhysicalPosition } from '@tauri-apps/api/dpi';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { WATCH_WIDGET_MODE } from '../../constants/watch-widget.constants';
import { NOTIFY_TONE } from '../../constants/notify.constants';
import { ROUTE_PATH } from '../../constants/router-meta.constants';
import { useTheme } from '../../composables/use-theme';
import { useDockPanelStore } from '../../stores/dock-panel';
import { useSettingsStore } from '../../stores/settings';
import { useStockContextStore } from '../../stores/stock-context';
import { useWatchlistStore } from '../../stores/watchlist';
import { router } from '../../router';
import { trackAction } from '../../weblog/weblogActions';
import { normalizeAShareCode } from '../../utils/normalize-a-share-code';
import { filterCandidatesByWatchlist } from '../sidebar-watch/candidates';
import {
  WATCH_WIDGET_BAR_HEIGHT,
  WATCH_WIDGET_BAR_WIDTH,
  WATCH_WIDGET_CURSOR_POLL_MS,
  WATCH_WIDGET_EVENTS,
  WATCH_WIDGET_NOTIFY_SOURCE,
  WATCH_WIDGET_POPOVER_WIDTH,
  WATCH_WIDGET_REVEAL_ZONE,
} from './constants';
import { buildWatchContextList, buildWatchWidgetRows } from './presenter';
import {
  getWorkArea,
  getWindowRect,
  openBarWindow,
  openPopoverWindow,
  positionPopover,
  rectContains,
  type PhysicalRect,
} from './windows';
import type { PluginDefinition } from '../../types/plugin.types';

/**
 * 任务栏盯盘小组件插件定义
 */
export const watchWidgetPlugin: PluginDefinition = {
  id: 'dsh-watch-widget',
  name: '任务栏盯盘小组件',
  version: '1.0.0',
  description:
    '在 Windows 任务栏上方常驻一个置顶盯盘迷你条（设置里开关，默认关）：轮播自选盯盘标的的名称 / 现价 / 涨跌幅，阈值触发带提示点；单击迷你条展开气泡看全部候选，点气泡里的标的（或双击迷你条当前标的）自动唤起主窗口并打开该股详情页（左侧列表即盯盘候选）。支持常驻显示 / 鼠标离开自动隐藏两种模式；仅桌面端，迷你条自身不产生任何行情请求。',
  author: '内置',
  inject: ['watch:repo'],
  apply: async (ctx) => {
    // 浏览器端无窗口概念，整个插件静默跳过（设置卡片会提示仅桌面端可用）
    if (!isTauri()) {
      ctx.logger.info('非 Tauri 环境，任务栏小组件不挂载');
      return;
    }

    // inject 已保证 repo 就绪；monitor 与 repo 由同一插件提供，理应同时就绪，仍兜底判空
    const repo = ctx.consume('watch:repo');
    const monitor = ctx.consume('watch:monitor');
    if (!repo || !monitor) {
      ctx.logger.warn('盯盘服务未就绪，任务栏小组件跳过');
      return;
    }

    const watchlistStore = useWatchlistStore();
    const settingsStore = useSettingsStore();

    // 浮窗服务由宿主提供；缺失时降级为只记日志（与盯盘引擎同一处理）
    const notify = ctx.consume('app:notify');

    /** 监控中的候选（候选池 ∩ 自选股，与顶栏轮播同一口径） */
    const candidates = computed(() =>
      filterCandidatesByWatchlist(repo.list(), watchlistStore.allSymbols),
    );

    /** 推送给小组件窗口的展示行（引擎报价一变即重算） */
    const rows = computed(() => buildWatchWidgetRows(candidates.value, monitor.quotes.value));

    // ---------- 窗口句柄与显隐状态（仅主窗口侧持有） ----------
    let barWindow: WebviewWindow | null = null;
    let popoverWindow: WebviewWindow | null = null;
    let barVisible = false;
    let popoverVisible = false;
    /**
     * 光标是否在「本次显示之后」到访过条 / 气泡
     *
     * hover 模式的隐藏以它为前提：条刚出现（或刚被角落热区唤回）时用户还没看过它，
     * 立刻隐藏等于「永远看不到」—— 必须先 hover 到访一次、再离开，超时才隐藏。
     */
    let cursorArmed = false;
    /** 条 / 气泡的物理矩形（鼠标靠近判定用；窗口显隐、拖动后刷新） */
    let barRect: PhysicalRect | null = null;
    let popoverRect: PhysicalRect | null = null;
    /** hover 模式的唤回热区（工作区右下角；停靠定位后计算一次） */
    let revealZone: PhysicalRect | null = null;

    /** 把当前快照推给条 / 气泡（两个窗口都不存在时跳过） */
    const pushLines = (): void => {
      if (!barWindow && !popoverWindow) return;
      void emit(WATCH_WIDGET_EVENTS.LINES, { rows: rows.value });
    };

    // 引擎轮询驱动推送（约数秒一次，量级极小，无需防抖）
    ctx.effect(() => watch(rows, pushLines, { immediate: true }));

    // ---------- 主题实时同步（明暗 / 主题色 / 涨跌配色） ----------
    /**
     * 主窗口主题三要素变化即广播给条 / 气泡。
     * 不依赖 storage 事件：WebView2 跨窗口 storage 事件实测不可达，
     * 主题跟随与行情数据共用同一条已验证的事件通道。
     */
    const { isDark } = useTheme();
    ctx.effect(() =>
      watch(
        [isDark, () => settingsStore.themeColor, () => settingsStore.trendTheme],
        ([dark, theme, trend]) => {
          if (!barWindow && !popoverWindow) return;
          void emit(WATCH_WIDGET_EVENTS.THEME, { dark, theme, trend });
        },
        { immediate: true },
      ),
    );

    // ---------- 气泡（单例窗口，隐藏复用） ----------
    const showPopover = async (): Promise<void> => {
      if (!barWindow) return;
      if (!popoverWindow) popoverWindow = await openPopoverWindow();
      if (!popoverWindow) return;
      await positionPopover(popoverWindow, barWindow, rows.value.length);
      popoverRect = await getWindowRect(popoverWindow);
      await popoverWindow.show().catch(() => undefined);
      popoverVisible = true;
    };

    const hidePopover = async (): Promise<void> => {
      if (!popoverWindow || !popoverVisible) return;
      await popoverWindow.hide().catch(() => undefined);
      popoverVisible = false;
    };

    const togglePopover = async (): Promise<void> => {
      if (popoverVisible) {
        await hidePopover();
      } else {
        await showPopover();
      }
    };

    // ---------- 盯盘条（设置开关驱动生灭） ----------
    const destroyWindows = async (): Promise<void> => {
      await hidePopover();
      if (popoverWindow) {
        void popoverWindow.close().catch(() => undefined);
        popoverWindow = null;
        popoverVisible = false;
        popoverRect = null;
      }
      if (barWindow) {
        void barWindow.close().catch(() => undefined);
        barWindow = null;
        barVisible = false;
        barRect = null;
        revealZone = null;
      }
    };

    const ensureBar = async (): Promise<void> => {
      if (barWindow) {
        await barWindow.show().catch(() => undefined);
        barVisible = true;
        return;
      }
      barWindow = await openBarWindow(settingsStore.watchWidget.position);
      if (!barWindow) {
        // 创建失败必须让用户看见（多为主窗口 capabilities 未重编译：重启应用即好）
        ctx.logger.warn('盯盘条创建失败（多为 capabilities 未重编译），请重启应用重试');
        notify?.notify({
          title: '任务栏小组件创建失败',
          body: '多为窗口权限未随构建生效：重启应用后重新开启即可',
          tone: NOTIFY_TONE.DOWN,
          source: WATCH_WIDGET_NOTIFY_SOURCE,
          dedupeKey: WATCH_WIDGET_NOTIFY_SOURCE,
        });
        return;
      }
      barVisible = true;
      cursorArmed = false;
      barRect = await getWindowRect(barWindow);
      // 唤回热区 = 工作区右下角（拖动过条也按此角落唤回，规则可预期）
      try {
        const area = await getWorkArea();
        revealZone = {
          x: area.right - WATCH_WIDGET_REVEAL_ZONE,
          y: area.bottom - WATCH_WIDGET_REVEAL_ZONE,
          width: WATCH_WIDGET_REVEAL_ZONE,
          height: WATCH_WIDGET_REVEAL_ZONE,
        };
      } catch {
        revealZone = null;
      }
      pushLines();
    };

    ctx.effect(() =>
      watch(
        () => settingsStore.watchWidget.enabled,
        (enabled) => {
          if (enabled) void ensureBar();
          else void destroyWindows();
        },
        { immediate: true },
      ),
    );

    // ---------- 打开股票：唤起主窗口 + 写上下文 + 跳详情整页 ----------
    const openStockInMain = (symbol: string): void => {
      if (!symbol) return;
      void hidePopover();
      // 主窗口可能正最小化 / 隐藏在托盘：显示 → 还原 → 聚焦，一步都不能省
      const main = getCurrentWebviewWindow();
      void main
        .show()
        .then(() => main.unminimize())
        .then(() => main.setFocus())
        .catch(() => undefined);
      // 与顶栏盯盘下拉「跳详情页」同一套交互：写入上下文（左列=盯盘候选）后路由跳转
      useStockContextStore().setContext(buildWatchContextList(candidates.value, monitor.quotes.value));
      useDockPanelStore().close();
      trackAction('STOCK_OPEN_PAGE', { target: symbol });
      void router.push(`${ROUTE_PATH.STOCK_DETAIL}/${normalizeAShareCode(symbol)}`);
    };

    // ---------- 跨窗口事件（小组件窗口只有事件通道，没有别的宿主上下文） ----------
    const unlistens: UnlistenFn[] = [];
    unlistens.push(
      await listen(WATCH_WIDGET_EVENTS.REQUEST, () => {
        pushLines();
      }),
    );
    unlistens.push(
      await listen(WATCH_WIDGET_EVENTS.POPOVER_TOGGLE, () => {
        void togglePopover();
      }),
    );
    unlistens.push(
      await listen<{ x: number; y: number }>(WATCH_WIDGET_EVENTS.BAR_MOVED, (event) => {
        // 拖动落点记忆到设置（下次开启原位恢复）；矩形同步刷新供鼠标判定
        settingsStore.setWatchWidget({ position: { x: event.payload.x, y: event.payload.y } });
        if (barWindow) {
          void getWindowRect(barWindow).then((rect) => {
            barRect = rect;
          });
        }
      }),
    );
    unlistens.push(
      await listen<{ symbol: string }>(WATCH_WIDGET_EVENTS.OPEN_STOCK, (event) => {
        openStockInMain(event.payload.symbol);
      }),
    );

    // ---------- 摸鱼显隐（hover 模式：离开超时隐藏，角落热区唤回） ----------
    let lastInsideAt = Date.now();
    const cursorTimer = window.setInterval(() => {
      if (!barWindow) return;
      void (async () => {
        let cursor: PhysicalPosition;
        try {
          cursor = await cursorPosition();
        } catch {
          return; // 光标查询失败（会话切换等）静默跳过本轮
        }
        const inside =
          rectContains(barRect, cursor.x, cursor.y, 4) || rectContains(popoverRect, cursor.x, cursor.y, 4);
        if (inside) {
          lastInsideAt = Date.now();
          cursorArmed = true;
          return;
        }
        // 条已隐藏：鼠标进入右下角热区 → 唤回（任何模式一致，规则可预期）
        if (!barVisible && revealZone && rectContains(revealZone, cursor.x, cursor.y)) {
          await barWindow.show().catch(() => undefined);
          barVisible = true;
          cursorArmed = false; // 唤回后同样等用户真正到访过才允许再隐藏
          lastInsideAt = Date.now();
          return;
        }
        // hover 模式：到访过、又离开超过延迟秒数 → 条与气泡一起隐藏（always 模式条常驻）
        const config = settingsStore.watchWidget;
        if (
          barVisible &&
          cursorArmed &&
          config.mode === WATCH_WIDGET_MODE.HOVER &&
          Date.now() - lastInsideAt >= config.hideDelaySec * 1000
        ) {
          await barWindow.hide().catch(() => undefined);
          barVisible = false;
          cursorArmed = false;
          await hidePopover();
          return;
        }
        // 气泡的离开隐藏与模式无关（它是临时浮层）
        if (popoverVisible && Date.now() - lastInsideAt >= config.hideDelaySec * 1000) {
          await hidePopover();
        }
      })();
    }, WATCH_WIDGET_CURSOR_POLL_MS);

    ctx.onDispose(() => {
      window.clearInterval(cursorTimer);
      for (const unlisten of unlistens) unlisten();
      void destroyWindows();
    });

    ctx.logger.info(
      `任务栏小组件就绪（条 ${WATCH_WIDGET_BAR_WIDTH}×${WATCH_WIDGET_BAR_HEIGHT}、气泡宽 ${WATCH_WIDGET_POPOVER_WIDTH}，显示模式 ${settingsStore.watchWidget.mode}）`,
    );
  },
};
