/**
 * 系统日志（报错日志 / 行为日志）类型
 *
 * 字段命名与 weblog.db 的列一一对应（db 层做蛇形→驼峰映射，UI 不接触原始行）
 */

/** 行为日志分类（与 action_log.category 同口径） */
export type WeblogCategory = 'page' | 'navbar' | 'api' | 'business' | 'system';

/** 报错等级 */
export type WeblogLevel = 'warn' | 'error' | 'fatal';

/** 报错来源（采集通道） */
export type WeblogErrorKind =
  | 'js-error'
  | 'resource-error'
  | 'unhandled-rejection'
  | 'vue-error'
  | 'console-error'
  | 'api-error'
  | 'manual';

/** 运行环境 */
export type WeblogRuntime = 'tauri' | 'browser';

/** 行为日志状态（接口请求用 ok/fail，其他行为可缺省） */
export type WeblogLogStatus = 'ok' | 'fail';

/** 一个埋点动作的定义（key 即 action_log.action） */
export interface WeblogActionDef {
  /** 动作 key（枚举值，与库中 action 字段一致） */
  key: string;
  /** 所属分类 */
  category: WeblogCategory;
  /** 中文可读文案（表格直接展示） */
  label: string;
}

/** 采集到的运行环境快照（每条日志冗余落库，便于按版本 / 机器归因） */
export interface WeblogEnvInfo {
  /** 应用版本（APP_VERSION） */
  appVersion: string;
  /** 运行环境：Tauri 桌面端 / 浏览器 */
  runtime: WeblogRuntime;
  /** 操作系统名（如 Windows 11 / Windows 10 / macOS） */
  osName: string;
  /** 系统版本号（UA-CH platformVersion，取不到为空串） */
  osVersion: string;
  /** 完整 User-Agent */
  ua: string;
  /** 渲染内核（WebView2 x.y.z / Chrome x.y.z） */
  webview: string;
  /** 屏幕信息（宽x高@像素比） */
  screen: string;
  /** 本次会话标识（每次启动重新生成） */
  sessionId: string;
}

/** 行为日志写入入参（落库前的原始结构，time_text 等派生字段由写入层补齐） */
export interface WeblogActionInput {
  /** 动作 key（见 WEBLOG_ACTIONS） */
  action: string;
  /** 分类 */
  category: WeblogCategory;
  /** 可读文案 */
  label: string;
  /** 操作目标（路由 path / 接口地址 / CSS 选择器摘要） */
  target?: string | null;
  /** 补充说明（JSON 或短文本） */
  detail?: string | null;
  /** 触发时所在页面路由 */
  pagePath: string;
  /** 触发时页面标题 */
  pageTitle?: string | null;
  /** 耗时（毫秒；接口请求等有耗时的行为填） */
  durationMs?: number | null;
  /** 状态（ok / fail） */
  status?: WeblogLogStatus | null;
}

/** 报错日志写入入参 */
export interface WeblogErrorInput {
  /** 等级 */
  level: WeblogLevel;
  /** 来源通道 */
  kind: WeblogErrorKind;
  /** 错误主文案（Error.message 或字符串化后的抛出值） */
  message: string;
  /** 调用栈 */
  stack?: string | null;
  /** 触发页面路由 */
  pagePath: string;
  /** 触发页面标题 */
  pageTitle?: string | null;
  /** 关联接口地址（kind=api-error） */
  apiUrl?: string | null;
  /** 关联接口状态码 */
  apiStatus?: number | null;
  /** 接口耗时（毫秒） */
  durationMs?: number | null;
  /** 补充上下文（JSON 或短文本） */
  detail?: string | null;
}

/** 行为日志记录（已落库 / 内存快照的完整行） */
export interface WeblogActionLog extends WeblogActionInput {
  /** 自增主键（内存兜底记录为负值序号） */
  id: number;
  /** 触发时间（毫秒时间戳，倒序查看依据） */
  occurredAt: number;
  /** 触发时间展示串（YYYY-MM-DD HH:mm:ss） */
  timeText: string;
  /** 应用版本 */
  appVersion: string;
  /** 操作系统名 */
  osName: string | null;
  /** User-Agent（与报错日志同口径的运行环境快照） */
  ua: string | null;
  /** 链路标识（SkyWalking 语义，用于串联同一次交互） */
  traceId: string | null;
  /** 会话标识（本次启动） */
  sessionId: string | null;
}

/** 报错日志记录（已落库 / 内存快照的完整行） */
export interface WeblogErrorLog extends WeblogErrorInput {
  /** 自增主键（内存兜底记录为负值序号） */
  id: number;
  /** 触发时间（毫秒时间戳） */
  occurredAt: number;
  /** 触发时间展示串（YYYY-MM-DD HH:mm:ss） */
  timeText: string;
  /** 应用版本 */
  appVersion: string;
  /** 运行环境 */
  runtime: WeblogRuntime;
  /** 操作系统名 */
  osName: string | null;
  /** 系统版本号 */
  osVersion: string | null;
  /** User-Agent */
  ua: string | null;
  /** 渲染内核 */
  webview: string | null;
  /** 屏幕信息 */
  screen: string | null;
  /** 链路标识 */
  traceId: string | null;
}

/** 日志查询条件 */
export interface WeblogQuery {
  /** 关键字（在 message / label / target / detail 中模糊匹配） */
  keyword?: string;
  /** 分类筛选（行为日志） */
  category?: WeblogCategory | '';
  /** 等级筛选（报错日志） */
  level?: WeblogLevel | '';
  /** 只取该时间点之后的记录（毫秒；0 或缺省表示不限） */
  sinceMs?: number;
  /** 条数上限 */
  limit?: number;
}

/** 日志统计（页面头部概览用） */
export interface WeblogLogStats {
  /** 报错日志条数（保留期内） */
  errorCount: number;
  /** 行为日志条数（保留期内） */
  actionCount: number;
  /** 最早一条记录的保留起始时间（毫秒；无数据为 0） */
  retentionFrom: number;
}
