import { AGENT_DB_URL } from './agent.constants';
import { STORAGE_KEY_SECTOR_FLOW_HISTORY } from './storage-key.constants';
import type { DataPortCategory } from '../types/data-port.types';

/**
 * 数据迁移登记表（硬性规范，见 AGENTS.md「数据迁移登记规范」）
 *
 * 设置页「数据迁移」（导出 / 导入 JSON 文件换机）由本表驱动：
 * 导出 = 遍历勾选类别逐表 SELECT / 读 localStorage 命名空间；导入 = 按类别覆盖写入。
 * **任何新增本地持久化数据（SQLite 新表 / 新 localStorage 命名空间）必须在此登记一个类别，
 * 否则跨机迁移不包含它**。镜像类键（真身在他处：watchlist / stock.account / plugin:*）
 * 与 weblog.db 日志表禁止登记。
 */

/** 导出格式版本（结构变更时 +1；导入端只接受 <= 当前值） */
export const DATA_PORT_FORMAT_VERSION = 1;

/** 导出文件名前缀 */
export const DATA_PORT_FILE_PREFIX = 'whf-stock-board';

/** 备份目录名（相对 appDataDir） */
export const DATA_PORT_BACKUP_DIR = 'backups';

/** 备份文件保留份数（超出删最旧） */
export const DATA_PORT_BACKUP_KEEP = 3;

/** SQLite 分块写入每批行数（kline_bar 等大表） */
export const DATA_PORT_CHUNK_SIZE = 500;

/** Agent 库连接串（与 use-agent-db 共用同一单例） */
export const DATA_PORT_AGENT_DB_URL = AGENT_DB_URL;

/** 本地行情快照类别的独立 key（whf:app 整包之外） */
const NS_SECTOR_FLOW_HISTORY = STORAGE_KEY_SECTOR_FLOW_HISTORY;

export const DATA_PORT_MANIFEST: readonly DataPortCategory[] = [
  // ---------- localStorage（whf:app 命名空间白名单 + 独立 key） ----------
  {
    id: 'app-settings',
    label: '应用设置',
    db: 'stock-board',
    storage: 'local-storage',
    nsKeys: ['settings', 'colorScheme'],
    defaultEnabled: true,
    tip: '外观 / 主题色 / 涨跌配色 / 轮询 / 侧栏顶栏编排 / 图表指标 / 明暗模式偏好',
  },
  {
    id: 'ui-state',
    label: '页面状态',
    db: 'stock-board',
    storage: 'local-storage',
    nsKeys: [
      'tabConfig',
      'hotNews.filter',
      'marketRank.curve',
      'marketRank.sectorView',
      'dockPanel',
      'stockSearch',
    ],
    defaultEnabled: true,
  },
  {
    id: 'plugins',
    label: '插件与用户插件',
    db: 'stock-board',
    storage: 'local-storage',
    nsKeys: ['plugin', 'plugin.user'],
    defaultEnabled: true,
    tip: '插件禁用黑名单 / 侧栏折叠态 / 应用内安装的插件代码',
  },
  {
    id: 'market-snapshots',
    label: '本地行情快照',
    db: 'stock-board',
    storage: 'local-storage',
    nsKeys: ['panorama.review'],
    independentKeys: [NS_SECTOR_FLOW_HISTORY],
    defaultEnabled: true,
    tip: '历史牛市复盘指数月 K 快照 / 板块历史净流入数据',
  },

  // ---------- stock-board.db ----------
  {
    id: 'watchlist',
    label: '自选股',
    db: 'stock-board',
    storage: 'sqlite',
    tables: [
      { table: 'watchlist_group', label: '自选股分组', writeMode: 'replace' },
      { table: 'watchlist_stock', label: '自选股个股', writeMode: 'replace' },
    ],
    defaultEnabled: true,
  },
  {
    id: 'stock-account',
    label: '股票账户与流水',
    db: 'stock-board',
    storage: 'sqlite',
    tables: [
      { table: 'account_trade_record', label: '交割单流水', writeMode: 'replace' },
      { table: 'account_statement_record', label: '对账单流水', writeMode: 'replace' },
    ],
    defaultEnabled: true,
    tip: '手工导入的成交流水，删了不可再生',
  },
  {
    id: 'board-calendar',
    label: '板块日历',
    db: 'stock-board',
    storage: 'sqlite',
    tables: [
      { table: 'board_profile', label: '板块池', writeMode: 'replace' },
      { table: 'board_constituent', label: '板块成分股', writeMode: 'replace' },
      { table: 'board_daily', label: '板块每日快照', writeMode: 'replace' },
      { table: 'board_limit_stock', label: '涨跌停池', writeMode: 'replace' },
      { table: 'board_calendar_meta', label: '日历元信息', writeMode: 'replace' },
      { table: 'board_sync_state', label: '采集状态', writeMode: 'replace' },
    ],
    defaultEnabled: true,
    tip: '可重新采集，但重爬耗时较长，建议导出',
  },
  {
    id: 'news-saved',
    label: '收藏新闻',
    db: 'stock-board',
    storage: 'sqlite',
    tables: [{ table: 'news_saved', label: '收藏新闻', writeMode: 'replace' }],
    defaultEnabled: true,
    tip: '删了不可再生',
  },
  {
    id: 'plugin-storage',
    label: '插件数据',
    db: 'stock-board',
    storage: 'sqlite',
    tables: [{ table: 'plugin_storage', label: '插件存储', writeMode: 'replace' }],
    defaultEnabled: true,
    tip: '速记 / 盯盘到价等插件本地数据（真身，启动时反向覆盖 localStorage）',
  },
  {
    id: 'kline-cache',
    label: '日 K 缓存',
    db: 'stock-board',
    storage: 'sqlite',
    tables: [
      { table: 'kline_bar', label: '日 K 明细', writeMode: 'replace' },
      { table: 'kline_cache_meta', label: '缓存水位', writeMode: 'replace' },
    ],
    defaultEnabled: false,
    tip: '体积较大且可再生（打开个股时按需重拉），一般无需迁移',
  },

  // ---------- agent.db ----------
  {
    id: 'agent-config',
    label: 'Agent 配置',
    db: 'agent',
    storage: 'sqlite',
    tables: [
      { table: 'model_config', label: '模型配置', writeMode: 'upsert', pk: 'id' },
      { table: 'agent_profile', label: 'Agent 配置', writeMode: 'upsert', pk: 'id' },
      { table: 'subagent', label: '子 Agent', writeMode: 'upsert', pk: 'id' },
      { table: 'skill', label: '技能', writeMode: 'upsert', pk: 'id' },
      { table: 'mcp_server', label: 'MCP 服务器', writeMode: 'upsert', pk: 'id' },
      { table: 'app_setting', label: '应用级设置', writeMode: 'upsert', pk: 'key' },
    ],
    defaultEnabled: true,
    tip: '按主键合并，保留本机多出的配置行',
  },
  {
    id: 'agent-chat',
    label: 'Agent 会话',
    db: 'agent',
    storage: 'sqlite',
    tables: [
      { table: 'chat_group', label: '会话分组', writeMode: 'replace' },
      { table: 'chat_session', label: '会话', writeMode: 'replace' },
      { table: 'chat_message', label: '会话消息', writeMode: 'replace' },
    ],
    defaultEnabled: false,
    tip: '消息可能很大，且会整体覆盖本机会话（不做合并）',
  },
];
