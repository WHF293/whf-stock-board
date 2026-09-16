/**
 * MCP 层常量
 */

/** MCP Apps UI 资源地址前缀（`ui://<serverKey>/<appName>`） */
export const UI_RESOURCE_PREFIX = 'ui://';

/** MCP Apps 资源 MIME（规范固定形态，非此值不渲染） */
export const MCP_APP_MIME = 'text/html;profile=mcp-app';

/** MCP App 宿主 iframe 的沙箱策略：只给 allow-scripts（**不给 allow-same-origin**） */
export const MCP_APP_SANDBOX = 'allow-scripts';

/** 单个 MCP App 实例允许的反向工具调用次数上限（防 UI 侧死循环） */
export const MCP_APP_MAX_TOOL_CALLS = 8;

/** MCP App 宿主默认高度（px，收到 size-changed 前的占位高度） */
export const MCP_APP_DEFAULT_HEIGHT = 180;

/** MCP App 宿主最大高度（px，避免超长 HTML 撑爆消息流） */
export const MCP_APP_MAX_HEIGHT = 640;

/** 工具卡持久化的 UI 载荷上限（字节，超限只留 resourceUri 不留数据，防消息表膨胀） */
export const MCP_UI_PAYLOAD_MAX_BYTES = 65536;

/**
 * 内置 MCP 服务器的授权 id（**负数约定**）
 *
 * 内置服务器不在 `mcp_server` 表里、没有自增 id，但同样需要参与资源授权
 * （否则「限制子 agent 不得使用某内置工具集」无法表达）。沿用与内置 subagent
 * 相同的负数 id 约定，使其与远端服务器（正数 id）共用 `resource_grant` 表。
 *
 * ⚠️ 这些值一旦发货即成为持久化契约，不得变更。
 */
export const BUILTIN_MCP_IDS = {
  /** 应用接口（app-api）：新闻库 + 本地库读写 */
  appApi: -1,
  /** 行情算法（stock-sdk）：行情/K线/指标/回测 */
  stockSdk: -2,
  /** 市场数据（market-data）：资金流/板块/龙虎榜/涨停池/新闻 */
  marketData: -3,
} as const;
