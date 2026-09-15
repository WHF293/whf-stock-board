/**
 * 系统日志（埋点 / 报错采集）常量
 *
 * 采集口径参考 SkyWalking 浏览器探针（错误日志 + 行为日志 + 运行环境快照），
 * 但落点是本地 SQLite（个人桌面端无 OAP collector），不做远端上报。
 */

/** 日志库地址（独立于 agent.db / stock-board.db，见 src-tauri/src/lib.rs 的 WEBLOG_DB_V1） */
export const WEBLOG_DB_URL = 'sqlite:weblog.db';

/** 日志开关默认值（默认开启采集） */
export const WEBLOG_ENABLED_DEFAULT = true;

/** 日志保留天数：报错日志与行为日志同口径，超期记录在启动 / 定时裁剪中删除 */
export const WEBLOG_RETENTION_DAYS = 3;

/** 日志保留窗口（毫秒） */
export const WEBLOG_RETENTION_MS = WEBLOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** 时间戳展示格式（入库 time_text 与页面表格同口径） */
export const WEBLOG_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

/** 攒批落库间隔（毫秒）：写入先进内存队列，定时批量 INSERT */
export const WEBLOG_FLUSH_INTERVAL_MS = 1_500;

/** 攒批阈值：待写队列达到该条数立即落库，不等定时器 */
export const WEBLOG_FLUSH_BATCH_SIZE = 30;

/** 批量 INSERT 分块行数（插件无事务 API，一块一条多值语句；须保证 行数×列数 < SQLite 变量上限） */
export const WEBLOG_INSERT_CHUNK_SIZE = 25;

/** 单块 INSERT 失败后的重试次数（超限即丢弃该块，避免队列无限堆积） */
export const WEBLOG_INSERT_RETRY = 2;

/** 内存环形缓冲上限（非 Tauri 环境降级查看 / 落库前的即时回显都用它） */
export const WEBLOG_MEMORY_BUFFER_MAX = 1_500;

/** 保留期裁剪间隔（毫秒） */
export const WEBLOG_PRUNE_INTERVAL_MS = 30 * 60 * 1000;

/** 日志页单次查询默认条数 */
export const WEBLOG_QUERY_LIMIT = 500;

/** 日志页单次查询条数上限 */
export const WEBLOG_QUERY_LIMIT_MAX = 3_000;

/** 点击兜底埋点时，目标描述文案的最大长度 */
export const WEBLOG_CLICK_LABEL_MAX = 28;

/**
 * 点击兜底派发延迟（毫秒）
 *
 * 兜底记录不在点击当帧写，而是延后一点再写：期间若出现更精确的埋点
 * （data-track 命中的枚举动作、业务显式上报、表格行的开个股等），就认领并作废兜底，
 * 避免「点一次记两条」。延迟需大于 BaseTable 单击/双击合并窗口（250ms）。
 *
 * ⚠️ 该窗口较长，因此「取消」必须按点击序号认领（见 weblogActions 的
 * beginClickTracking / claimPendingClickFallback）：否则后一次点击的精准埋点
 * 会把前一次点击尚未派发的兜底一起清掉（曾漏记）。
 */
export const WEBLOG_CLICK_FALLBACK_DELAY_MS = 350;

/** 同一错误在窗口内的去重时长（毫秒）：轮询类失败每几秒一次，必须收敛 */
export const WEBLOG_DEDUPE_WINDOW_MS = 60_000;

/** 错误去重表容量上限（超出按插入顺序淘汰最旧条目） */
export const WEBLOG_DEDUPE_CACHE_MAX = 200;

/** stack 落库最大长度（超出截断，避免单条记录撑爆库） */
export const WEBLOG_STACK_MAX = 4_000;

/** message / detail 落库最大长度 */
export const WEBLOG_MESSAGE_MAX = 2_000;

/** 日志页时间范围筛选项（毫秒；0 = 全部保留期内） */
export const WEBLOG_RANGE_OPTIONS = [
  { label: '近1小时', value: 60 * 60 * 1000 },
  { label: '近6小时', value: 6 * 60 * 60 * 1000 },
  { label: '近24小时', value: 24 * 60 * 60 * 1000 },
  { label: '近3天', value: WEBLOG_RETENTION_MS },
] as const;

/** 日志页时间范围默认值（毫秒） */
export const WEBLOG_RANGE_DEFAULT = WEBLOG_RETENTION_MS;

/** 运行环境标识：Tauri 桌面端 */
export const WEBLOG_RUNTIME_TAURI = 'tauri';

/** 运行环境标识：浏览器 */
export const WEBLOG_RUNTIME_BROWSER = 'browser';

/** Windows 11 在 UA-CH platformVersion 中的起始主版本号（10 及以下为 Windows 10） */
export const WEBLOG_WIN11_MIN_PLATFORM_MAJOR = 13;

/**
 * 报错采集忽略名单（文案正则）
 *
 * - `ResizeObserver loop…` 是浏览器布局抖动告警，非真实故障，且在高频刷新页面刷屏；
 * - `Script error.` 是跨源脚本未带 CORS 头时的空壳信息，记录也无从定位。
 */
export const WEBLOG_IGNORED_ERROR_PATTERNS: readonly RegExp[] = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
];

/** 触发页面上下文为空时的兜底路径文案 */
export const WEBLOG_UNKNOWN_PATH = '(未知页面)';

/** 系统日志页自动刷新间隔（毫秒）：排错时盯着看，每 10 秒拉一次最新记录 */
export const WEBLOG_PAGE_AUTO_REFRESH_MS = 10_000;

/** 系统日志页表格每批渲染行数（配合 useLazyRows，避免一次挂 3000 行 DOM） */
export const WEBLOG_PAGE_CHUNK_SIZE = 100;

/** 系统日志页导出文件名前缀 */
export const WEBLOG_EXPORT_FILE_PREFIX = '系统日志';

/** 报错等级中文名（页面展示与筛选项共用） */
export const WEBLOG_LEVEL_LABEL = {
  warn: '警告',
  error: '错误',
  fatal: '致命',
} as const;

/** 报错来源中文名（页面「来源」列） */
export const WEBLOG_ERROR_KIND_LABEL = {
  'js-error': '运行异常',
  'resource-error': '资源加载',
  'unhandled-rejection': '未捕获拒绝',
  'vue-error': 'Vue 异常',
  'console-error': '业务错误',
  'api-error': '接口失败',
  manual: '手动上报',
} as const;

/** 行为日志状态中文名 */
export const WEBLOG_STATUS_LABEL = {
  ok: '成功',
  fail: '失败',
} as const;
