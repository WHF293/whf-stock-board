use tauri_plugin_sql::{Migration, MigrationKind};

/// agent.db v1：Agent 分析模块全部表（方案 §3，2026-09-14 第五版，仅 OpenAI 兼容规范）
///
/// 建表顺序遵循外键依赖：model_config → agent_profile → subagent → chat_group
/// → chat_session → chat_message（级联删）→ skill / mcp_server / app_setting。
const AGENT_DB_V1: &str = "
CREATE TABLE model_config (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  preset_key        TEXT,
  base_url          TEXT NOT NULL,
  api_key           TEXT NOT NULL,
  model_id          TEXT NOT NULL,
  supports_tools    INTEGER NOT NULL DEFAULT 1,
  supports_image    INTEGER NOT NULL DEFAULT 0,
  supports_thinking INTEGER NOT NULL DEFAULT 0,
  max_input_tokens  INTEGER,
  max_output_tokens INTEGER,
  temperature       REAL,
  is_default        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE agent_profile (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  description     TEXT,
  system_prompt   TEXT,
  model_id        INTEGER REFERENCES model_config(id) ON DELETE SET NULL,
  tool_names      TEXT NOT NULL DEFAULT '[]',
  skill_ids       TEXT NOT NULL DEFAULT '[]',
  mcp_ids         TEXT NOT NULL DEFAULT '[]',
  subagent_ids    TEXT NOT NULL DEFAULT '[]',
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE subagent (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  model_id    INTEGER REFERENCES model_config(id) ON DELETE SET NULL,
  tool_names  TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE chat_group (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE chat_session (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id         INTEGER REFERENCES chat_group(id) ON DELETE SET NULL,
  title            TEXT NOT NULL DEFAULT '新对话',
  model_id         INTEGER REFERENCES model_config(id) ON DELETE SET NULL,
  agent_profile_id INTEGER REFERENCES agent_profile(id) ON DELETE SET NULL,
  pinned           INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE chat_message (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  parts      TEXT,
  status     TEXT NOT NULL DEFAULT 'done',
  error      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_message_session ON chat_message(session_id, created_at);

CREATE TABLE skill (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  dir_name    TEXT NOT NULL UNIQUE,
  description TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE mcp_server (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  transport  TEXT NOT NULL,
  url        TEXT NOT NULL,
  headers    TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE app_setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
";

/// agent.db v2：资源授权（MCP / Skill 的 agent 级访问控制）
///
/// 背景：MCP / Skill 的授权有两个入口——资源侧（「谁能用我」，MCP/Skill 设置弹窗）
/// 与 agent 侧（「我能用什么」，profile / 子 agent 配置弹窗）。两者是**同一份关系的两个视图**，
/// 必须共用唯一事实源，否则必然冲突（一处勾上、另一处不同步 → 到底能不能用无从判断）。
///
/// 为什么 scope 单独建表而不是给 mcp_server / skill 加列：
/// **内置 MCP 服务器不在表里**（它们是 src/agent/mcp 下的常量），无法在自己的表上加列；
/// 用独立表可让内置（负数 id）与用户资源（自增正数 id）走同一套授权逻辑。
///
/// 判定规则（唯一权威）：
/// - 启用：`resource_scope.enabled = 0` → 该资源整体不装配（对任何 agent 都不可用）；
/// - 无该资源行 → 视作 enabled = 1 且 scope = 'all'；
/// - scope = 'all' → 全部 agent 可访问（grant 行被忽略但保留）；
/// - scope = 'custom' → 仅 resource_grant 中列出的 agent 可访问。
///   ⚠️ custom 且无任何 grant 行 = 含主 agent 在内谁都不可用（UI 必须警示，否则资源被静默锁死）。
///
/// 为什么 `enabled` 也放这张表：**内置 MCP / 内置子 agent 都没有自己的表**，
/// 无法在资源表上加启用列；用户资源（mcp_server / skill）虽有自己的 enabled 列，
/// 但为了「设置弹窗」一处读写、不与原管理弹窗打架，这里约定：
/// 内置资源以本表 enabled 为准；用户资源以自身表的 enabled 列为准（本表 enabled 仅作兜底）。
///
/// agent 标识：主 agent 用 ('main', 0)；子 agent 用 ('subagent', subagent.id)。
/// 内置 id 均为负数（子 agent 见 constants/builtin-subagents.ts，MCP 见 agent/mcp/constants.ts），
/// 与用户自增的正数 id 天然不冲突。
///
/// `subagent.skill_names`：子 agent 专属 skill 白名单（名称数组）。
/// 子 agent 默认**不继承**主 agent 的 skills（deepagents 语义），必须显式声明。
const AGENT_DB_V2: &str = "
ALTER TABLE subagent ADD COLUMN skill_names TEXT NOT NULL DEFAULT '[]';

CREATE TABLE resource_scope (
  resource_kind TEXT    NOT NULL,
  resource_id   INTEGER NOT NULL,
  scope         TEXT    NOT NULL DEFAULT 'all',
  enabled       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (resource_kind, resource_id)
);

CREATE TABLE resource_grant (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_kind TEXT    NOT NULL,
  resource_id   INTEGER NOT NULL,
  agent_kind    TEXT    NOT NULL,
  agent_id      INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (resource_kind, resource_id, agent_kind, agent_id)
);
CREATE INDEX idx_grant_agent ON resource_grant (agent_kind, agent_id, resource_kind);
CREATE INDEX idx_grant_res   ON resource_grant (resource_kind, resource_id);
";

/// agent.db v3：用户 subagent 启停 + 内置 subagent 启停落脚点
///
/// 内置 subagent（7 个金融分析师）是**纯常量**、库里没有 subagent 行，因此它们的
/// 启停无法写在自身表上 —— 统一走 v2 建的 `resource_scope`，以
/// `resource_kind='subagent', resource_id=<负数 id>` 记录 `enabled`。
/// 本版本只补用户 subagent 自己的 enabled 列，读写两轨由 store 的 toggleSubagent 分流。
///
/// ⚠️ `resource_scope` 表无需改动：它的 resource_kind 是自由 TEXT，
///    'subagent' 直接可用（`resource_grant` 对 subagent 不写入，无「精确授权」语义）。
const AGENT_DB_V3: &str = "
ALTER TABLE subagent ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
";

/// agent.db 全部迁移（后续版本往后追加，勿改动已有版本）
fn agent_db_migrations() -> Vec<Migration> {
  vec![
    Migration {
      version: 1,
      description: "create_agent_tables",
      sql: AGENT_DB_V1,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "add_resource_grant",
      sql: AGENT_DB_V2,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 3,
      description: "add_subagent_enabled",
      sql: AGENT_DB_V3,
      kind: MigrationKind::Up,
    },
  ]
}

/// stock-board.db v1：板块日历（板块热点 · 赚钱效应）全部表
///
/// 方案见 .ai/开发方案/2026-09-14-板块日历与赚钱效应开发方案.md §4。
/// 与 agent.db 分离：业务行情数据 vs Agent 数据，语义清晰。
///
/// 建表顺序：board_profile / board_constituent（静态档案与映射）
/// → board_daily（板块 × 交易日聚合）→ board_limit_stock（涨跌停明细）
/// → board_calendar_meta（采集台账）。
///
/// 口径说明（勿改）：
/// - 板块池 = 31 个申万一级行业 + 追加的热门板块（见前端 constants/board-calendar.constants.ts），
///   板块清单由前端常量决定，故无 scope 列；`board_constituent` 主键 (board_code, symbol)
///   天然支持「一只票同时属于多个板块」（追加板块与一级行业会重叠）；
/// - board_daily.score 一律按「净额口径」（涨停不重复计入上涨）落库；
/// - data_level：1 = 当日完整快照（涨跌停 + 涨跌家数齐全），0 = 仅回补到涨跌停。
const STOCK_BOARD_DB_V1: &str = "
CREATE TABLE IF NOT EXISTS board_profile (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  cons_count  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS board_constituent (
  board_code TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  market     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (board_code, symbol)
);
CREATE INDEX IF NOT EXISTS idx_constituent_symbol ON board_constituent(symbol);

CREATE TABLE IF NOT EXISTS board_daily (
  trade_date     TEXT NOT NULL,
  board_code     TEXT NOT NULL,
  board_name     TEXT NOT NULL,
  change_percent REAL,
  amount         REAL,
  limit_up       INTEGER NOT NULL DEFAULT 0,
  limit_down     INTEGER NOT NULL DEFAULT 0,
  up_count       INTEGER NOT NULL DEFAULT 0,
  down_count     INTEGER NOT NULL DEFAULT 0,
  flat_count     INTEGER NOT NULL DEFAULT 0,
  cons_count     INTEGER NOT NULL DEFAULT 0,
  score          REAL NOT NULL DEFAULT 0,
  score_rate     REAL NOT NULL DEFAULT 0,
  data_level     INTEGER NOT NULL DEFAULT 1,
  snapshot_at    INTEGER NOT NULL,
  is_final       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trade_date, board_code)
);
CREATE INDEX IF NOT EXISTS idx_board_daily_date  ON board_daily(trade_date);
CREATE INDEX IF NOT EXISTS idx_board_daily_board ON board_daily(board_code, trade_date);

CREATE TABLE IF NOT EXISTS board_limit_stock (
  trade_date     TEXT NOT NULL,
  board_code     TEXT NOT NULL,
  symbol         TEXT NOT NULL,
  name           TEXT NOT NULL,
  limit_type     INTEGER NOT NULL,
  change_percent REAL,
  price          REAL,
  amount         REAL,
  turnover_rate  REAL,
  seal_time      TEXT,
  open_times     INTEGER,
  limit_streak   INTEGER,
  PRIMARY KEY (trade_date, limit_type, symbol)
);
CREATE INDEX IF NOT EXISTS idx_limit_stock_board ON board_limit_stock(board_code, trade_date);

CREATE TABLE IF NOT EXISTS board_calendar_meta (
  trade_date            TEXT PRIMARY KEY,
  data_level            INTEGER NOT NULL DEFAULT 0,
  is_final              INTEGER NOT NULL DEFAULT 0,
  limit_up_cnt          INTEGER NOT NULL DEFAULT 0,
  limit_down_cnt        INTEGER NOT NULL DEFAULT 0,
  constituent_synced_at INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL
);
";

/// stock-board.db v2：增量采集状态（键值表）
///
/// 入库之后只做增量请求所需的持久化依据：
/// - `trade_dates`：交易日轴缓存（JSON 数组）——避免每次采集都拉一次腾讯日 K；
/// - `pool_boundary_date`：涨跌停池可回溯边界——避免每次采集都重探窗口外日期。
const STOCK_BOARD_DB_V2: &str = "
CREATE TABLE IF NOT EXISTS board_sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
";

/// stock-board.db v3：账户 · 对账单导入记录
///
/// 同花顺对账单按文件导入，一期先落导入档案（期间/原文），
/// 结构化解析（资金流水 / 持仓变动）待字段定稿后追加子表
const STOCK_BOARD_DB_V3: &str = "
CREATE TABLE IF NOT EXISTS account_statement (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  period_start TEXT,
  period_end   TEXT,
  raw_content  TEXT,
  imported_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_statement_account
  ON account_statement(account_id, imported_at);
";

/// stock-board.db v4：交割单 / 对账单成交流水（结构对齐同花顺导出文件表头）
///
/// 两表结构完全一致，仅数据来源不同：
/// - account_trade_record      ← 交割单（含「余额」列）
/// - account_statement_record  ← 对账单（含「备注」列，一期不落备注原文）
/// 去重键 dedupe_key 唯一，重复导入同一文件不会产生重复行；
/// v3 的 account_statement 占位表被两表取代，直接弃用
const STOCK_BOARD_DB_V4: &str = "
DROP TABLE IF EXISTS account_statement;

CREATE TABLE IF NOT EXISTS account_trade_record (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  trade_date   TEXT NOT NULL,
  trade_time   TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  stock_name   TEXT NOT NULL,
  action       TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  price        REAL NOT NULL,
  amount       REAL NOT NULL,
  balance      REAL,
  net_amount   REAL NOT NULL,
  after_amount REAL,
  stamp_tax    REAL NOT NULL DEFAULT 0,
  commission   REAL NOT NULL DEFAULT 0,
  transfer_fee REAL NOT NULL DEFAULT 0,
  entrust_fee  REAL NOT NULL DEFAULT 0,
  service_fee  REAL NOT NULL DEFAULT 0,
  contract_no  TEXT,
  deal_no      TEXT,
  market       TEXT,
  dedupe_key   TEXT NOT NULL UNIQUE,
  imported_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_record_account
  ON account_trade_record(account_id, trade_date);

CREATE TABLE IF NOT EXISTS account_statement_record (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  trade_date   TEXT NOT NULL,
  trade_time   TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  stock_name   TEXT NOT NULL,
  action       TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  price        REAL NOT NULL,
  amount       REAL NOT NULL,
  balance      REAL,
  net_amount   REAL NOT NULL,
  after_amount REAL,
  stamp_tax    REAL NOT NULL DEFAULT 0,
  commission   REAL NOT NULL DEFAULT 0,
  transfer_fee REAL NOT NULL DEFAULT 0,
  entrust_fee  REAL NOT NULL DEFAULT 0,
  service_fee  REAL NOT NULL DEFAULT 0,
  contract_no  TEXT,
  deal_no      TEXT,
  market       TEXT,
  dedupe_key   TEXT NOT NULL UNIQUE,
  imported_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_statement_record_account
  ON account_statement_record(account_id, trade_date);
";

/// V5：已保存新闻（Agent「保存新闻」MCP 工具与热点新闻收藏共用）
const STOCK_BOARD_DB_V5: &str = "
CREATE TABLE IF NOT EXISTS news_saved (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL UNIQUE,
  summary      TEXT,
  published_at INTEGER,
  saved_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_saved_saved_at ON news_saved(saved_at);
";

/// V6：自选股入库 + 插件存储镜像
///
/// - watchlist_group / watchlist_stock：自选股分组与个股（watchlist store 的 Tauri 端落地，
///   全量镜像模式：store 每次变更后整包重写，浏览器端无 SQLite 自动降级 localStorage）；
/// - plugin_storage：插件存储（`ctx.storage`）的 Tauri 端镜像 —— 插件永远不直接访问 SQL，
///   只用宿主的 storage API，localStorage 即时写 + 本表异步镜像，启动时以本表覆盖水合
const STOCK_BOARD_DB_V6: &str = "
CREATE TABLE IF NOT EXISTS watchlist_group (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist_stock (
  group_id   TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  name       TEXT NOT NULL,
  added_at   INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_stock_group
  ON watchlist_stock(group_id, sort_order);

CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, key)
);
";

/// weblog.db v1：系统日志（报错日志 + 行为日志）
///
/// 独立成库的理由：日志是高频写入 + 按保留期整段删除的「滚动数据」，
/// 与业务库（stock-board.db）/ Agent 配置库（agent.db）的生命周期完全不同，
/// 混在一起会让业务库被日志撑大且裁剪时锁表。
///
/// 口径（勿改）：
/// - `time_text` 冗余存 `YYYY-MM-DD HH:mm:ss` 展示串，页面表格直接读，
///   避免前端对每条记录再做一次格式化；
/// - `occurred_at` 毫秒时间戳是唯一排序 / 裁剪依据（保留 3 天）；
/// - 两表都带 `trace_id`（SkyWalking 语义的链路标识）与 `app_version` /
///   `os_name` / `ua` 等运行环境快照，便于按版本、按机器归因报错。
const WEBLOG_DB_V1: &str = "
CREATE TABLE IF NOT EXISTS error_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at INTEGER NOT NULL,
  time_text   TEXT    NOT NULL,
  level       TEXT    NOT NULL DEFAULT 'error',
  kind        TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  stack       TEXT,
  page_path   TEXT    NOT NULL DEFAULT '',
  page_title  TEXT,
  api_url     TEXT,
  api_status  INTEGER,
  duration_ms INTEGER,
  app_version TEXT    NOT NULL DEFAULT '',
  runtime     TEXT    NOT NULL DEFAULT 'browser',
  os_name     TEXT,
  os_version  TEXT,
  ua          TEXT,
  webview     TEXT,
  screen      TEXT,
  trace_id    TEXT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_error_log_time ON error_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_kind ON error_log(kind);

CREATE TABLE IF NOT EXISTS action_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at INTEGER NOT NULL,
  time_text   TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  label       TEXT    NOT NULL DEFAULT '',
  target      TEXT,
  detail      TEXT,
  page_path   TEXT    NOT NULL DEFAULT '',
  page_title  TEXT,
  duration_ms INTEGER,
  status      TEXT,
  app_version TEXT    NOT NULL DEFAULT '',
  os_name     TEXT,
  ua          TEXT,
  session_id  TEXT,
  trace_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_action_log_time     ON action_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_log_action   ON action_log(action);
CREATE INDEX IF NOT EXISTS idx_action_log_category ON action_log(category);
";

/// weblog.db 全部迁移（后续版本往后追加，勿改动已有版本）
fn weblog_db_migrations() -> Vec<Migration> {
  vec![Migration {
    version: 1,
    description: "create_weblog_tables",
    sql: WEBLOG_DB_V1,
    kind: MigrationKind::Up,
  }]
}

/// stock-board.db 全部迁移（后续版本往后追加，勿改动已有版本）
fn stock_board_db_migrations() -> Vec<Migration> {
  vec![
    Migration {
      version: 1,
      description: "create_stock_board_tables",
      sql: STOCK_BOARD_DB_V1,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "create_board_sync_state",
      sql: STOCK_BOARD_DB_V2,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 3,
      description: "create_account_statement",
      sql: STOCK_BOARD_DB_V3,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 4,
      description: "create_account_record_tables",
      sql: STOCK_BOARD_DB_V4,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 5,
      description: "create_news_saved",
      sql: STOCK_BOARD_DB_V5,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 6,
      description: "create_watchlist_and_plugin_storage",
      sql: STOCK_BOARD_DB_V6,
      kind: MigrationKind::Up,
    },
  ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:agent.db", agent_db_migrations())
        .add_migrations("sqlite:stock-board.db", stock_board_db_migrations())
        .add_migrations("sqlite:weblog.db", weblog_db_migrations())
        .build(),
    )
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
