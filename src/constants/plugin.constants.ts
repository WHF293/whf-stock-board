/**
 * 插件系统常量（魔法值集中于此，禁止散落字面量）
 *
 * 设计对标 DeepSeek Harness（dsh）的 Cordis 内核：
 * 内核只负责插件的加载 / 卸载 / 依赖关系，具体能力（侧栏面板、菜单、
 * 路由、命令、Agent 工具…）全部由插件通过贡献点声明。
 */

/** 插件 id 合法形态：小写字母数字开头，可含 `.` `-` `_` `/`（如 `dsh-quick-note`） */
export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+)*$/;

/** 内置插件 id 前缀（内置插件随应用分发，不可删除） */
export const PLUGIN_BUILTIN_PREFIX = 'dsh-';

/** 持久化里记录的是**禁用黑名单**：升级新增的插件无需迁移即默认生效 */
export const PLUGIN_DISABLED_BY_DEFAULT = false;

/** 侧栏面板默认位置：导航菜单区（可选 `footer` 落到侧栏底部） */
export const SIDEBAR_PANEL_POSITION_DEFAULT = 'nav';

/** 侧栏面板默认展示形态：内联（直接渲染在侧栏内；可选 `drawer` 走右侧抽屉） */
export const SIDEBAR_PANEL_MODE_DEFAULT = 'inline';

/** 侧栏面板默认排序权重（越小越靠前；同值按注册先后） */
export const SIDEBAR_PANEL_ORDER_DEFAULT = 100;

/** 侧栏收起为图标栏时，内联面板是否仍渲染（默认不渲染，避免挤爆 64px 宽度） */
export const SIDEBAR_PANEL_VISIBLE_WHEN_COLLAPSED_DEFAULT = false;

/** 菜单项默认排序权重（插件菜单统一排在宿主菜单之后） */
export const MENU_ITEM_ORDER_DEFAULT = 500;

/** 停靠面板默认排序权重 */
export const DOCK_PANEL_ORDER_DEFAULT = 100;

/** 顶栏条目默认排序权重（越小越靠左，同值按注册先后） */
export const HEADER_ITEM_ORDER_DEFAULT = 100;

/** 顶栏条目轮播间隔默认值（毫秒） */
export const HEADER_ITEM_MARQUEE_INTERVAL_DEFAULT = 4000;

/**
 * 顶栏条目轮播间隔下限（毫秒）
 *
 * 插件写 0 / 负数 / 极小值都夹到这里：轮播是「放着不太动」的信息条，
 * 间隔过短既看不清也白烧 CPU。
 */
export const HEADER_ITEM_MARQUEE_INTERVAL_MIN = 1500;

/** 股票行操作默认排序权重（越小越靠前，同值按注册先后；宿主自带按钮不参与排序） */
export const STOCK_ROW_ACTION_ORDER_DEFAULT = 100;

/** 个股详情扩展区默认排序权重（越小越靠前，同值按注册先后） */
export const STOCK_DETAIL_SECTION_ORDER_DEFAULT = 100;

/** 插件自有存储命名空间前缀（appStorage 内按 `plugin:<id>` 分桶隔离） */
export const PLUGIN_STORAGE_NAMESPACE_PREFIX = 'plugin:';

/** 插件运行时状态 */
export const PLUGIN_STATUS = {
  /** 已挂载（贡献点全部生效） */
  MOUNTED: 'mounted',
  /** 挂载中：apply 返回了 Promise，尚未完成 */
  MOUNTING: 'mounting',
  /** 等待依赖：inject 声明的插件尚未挂载 */
  PENDING: 'pending',
  /** 被用户禁用（持久化黑名单命中，或依赖被禁用） */
  DISABLED: 'disabled',
  /** 挂载失败（apply 抛错，贡献点已回滚） */
  FAILED: 'failed',
} as const;

/** 插件运行时状态中文文案（插件管理弹窗展示） */
export const PLUGIN_STATUS_LABEL: Record<
  (typeof PLUGIN_STATUS)[keyof typeof PLUGIN_STATUS],
  string
> = {
  [PLUGIN_STATUS.MOUNTED]: '已挂载',
  [PLUGIN_STATUS.MOUNTING]: '挂载中',
  [PLUGIN_STATUS.PENDING]: '等待依赖',
  [PLUGIN_STATUS.DISABLED]: '已禁用',
  [PLUGIN_STATUS.FAILED]: '挂载失败',
};

/** 插件状态标签色调（BaseTag tone） */
export const PLUGIN_STATUS_TONE: Record<
  (typeof PLUGIN_STATUS)[keyof typeof PLUGIN_STATUS],
  'primary' | 'flat'
> = {
  [PLUGIN_STATUS.MOUNTED]: 'primary',
  [PLUGIN_STATUS.MOUNTING]: 'flat',
  [PLUGIN_STATUS.PENDING]: 'flat',
  [PLUGIN_STATUS.DISABLED]: 'flat',
  [PLUGIN_STATUS.FAILED]: 'flat',
};

/** 插件日志前缀（内核统一 `[plugin:<id>]` 形态） */
export const PLUGIN_LOG_PREFIX = '[plugin]';

/** 内核事件环形缓冲容量（插件工坊「最近事件」用，超出丢弃最旧一条） */
export const PLUGIN_EVENT_HISTORY_MAX = 200;

/** 事件名合法形态：`namespace:action` 或纯标识符（宽松，仅用于日志可读性） */
export const PLUGIN_EVENT_NAME_PATTERN = /^[a-z][a-z0-9:_-]*$/i;

/** 命令快捷键描述串的分隔符（如 `Ctrl+Alt+N`） */
export const PLUGIN_KEY_SEPARATOR = '+';

/**
 * 顶栏轮播行的语义色调
 *
 * 与涨跌语义色完全同源（红涨绿跌跟随 `data-trend` 主题）：插件只声明「这是什么语气」，
 * 具体色值由宿主在 `constants/header.constants.ts` 里映射，插件不碰色值。
 */
export const HEADER_MARQUEE_TONE = {
  /** 中性（默认）：次级信息，如「2 只待触发」 */
  DEFAULT: 'default',
  /** 涨向：红色（跟随涨跌主题） */
  UP: 'up',
  /** 跌向：绿色（跟随涨跌主题） */
  DOWN: 'down',
  /** 平盘：中性灰 */
  FLAT: 'flat',
  /** 品牌主色：提示 / 强调 */
  PRIMARY: 'primary',
} as const satisfies Record<string, string>;

/** 命令快捷键里的修饰键 token（小写） → ParsedCommandKeys 的修饰位字段名 */
export const PLUGIN_KEY_MODIFIER = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  meta: 'meta',
  cmd: 'meta',
  win: 'meta',
  command: 'meta',
} as const;

/** 命令快捷键里的具名键 token（小写） → KeyboardEvent.code */
export const PLUGIN_KEY_NAMED_CODE: Record<string, string> = {
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  space: 'Space',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

/** 单字符键 token → KeyboardEvent.code 前缀（字母 / 数字） */
export const PLUGIN_KEY_LETTER_PREFIX = 'Key';

/** 数字键 token → KeyboardEvent.code 前缀 */
export const PLUGIN_KEY_DIGIT_PREFIX = 'Digit';

/** 插件面板抽屉宽度（比设置抽屉窄：面板内容体量更小） */
export const PLUGIN_PANEL_DRAWER_WIDTH = 'min(560px, 66vw)';

/** 插件来源（内核挂载选项；用户插件 = 应用内安装、随 localStorage 分发） */
export const PLUGIN_ORIGIN = {
  BUILTIN: 'builtin',
  USER: 'user',
} as const;

/** 用户插件代码体积上限（localStorage 单命名空间别挤爆，512KB 足够一个面板插件） */
export const USER_PLUGIN_CODE_MAX_LENGTH = 512 * 1024;

/** 用户插件持久化条目数上限（防误贴超大文件刷爆存储） */
export const USER_PLUGIN_RECORD_MAX = 50;

/** 用户插件代码动态 import 时的 Blob MIME（ESM 模块） */
export const USER_PLUGIN_BLOB_MIME = 'text/javascript';

/** 用户插件缺省作者文案（定义里没写 author 时展示用） */
export const USER_PLUGIN_AUTHOR_LABEL = '用户安装';

/** 「插件页随插件撤销」浮窗的来源标签（宿主收尾时提示用户页面为什么变了） */
export const PLUGIN_VANISHED_NOTICE_SOURCE = '插件管理';

/**
 * 「插件页随插件撤销」浮窗标题
 * @param pluginName 消失页面所属的插件名
 * @returns 标题文案
 */
export const PLUGIN_VANISHED_NOTICE_TITLE = (pluginName: string): string =>
  `插件「${pluginName}」已不可用`;

/**
 * 「插件页随插件撤销」浮窗说明（原页面已撤销 + 用户被送到哪）
 * @param pageTitle 消失的页面标题（缺省时退化为「当前页」）
 * @param targetTitle 跳转目标页标题
 * @returns 说明文案
 */
export const PLUGIN_VANISHED_NOTICE_BODY = (
  pageTitle: string,
  targetTitle: string,
): string => `页面「${pageTitle || '当前页'}」已撤销，已转到「${targetTitle}」`;
