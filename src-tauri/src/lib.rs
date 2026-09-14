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

/// agent.db 全部迁移（后续版本往后追加，勿改动已有版本）
fn agent_db_migrations() -> Vec<Migration> {
  vec![Migration {
    version: 1,
    description: "create_agent_tables",
    sql: AGENT_DB_V1,
    kind: MigrationKind::Up,
  }]
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
/// - 候选池固定为 31 个申万一级行业，故无 scope 列；
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
