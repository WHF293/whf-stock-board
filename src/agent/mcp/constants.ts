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
