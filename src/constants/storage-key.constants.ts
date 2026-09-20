/**
 * 本地存储键集中管理
 *
 * 全站持久化统一收敛到单一 localStorage key（STORAGE_KEY_APP）：
 * value 为按命名空间划分的对象 { [ns]: value }，经 appStorage 适配器读写；
 * 本文件常量为各 store 的命名空间（不再是独立 localStorage key）
 */

/** 统一持久化外层 key（localStorage 唯一键） */
export const STORAGE_KEY_APP = 'whf:app';

/** 自选股分组命名空间 */
export const STORAGE_NS_WATCHLIST = 'watchlist';

/** 股票账户命名空间 */
export const STORAGE_NS_STOCK_ACCOUNT = 'stock.account';

/** 应用设置命名空间 */
export const STORAGE_NS_SETTINGS = 'settings';

/** 明暗模式命名空间 */
export const STORAGE_NS_COLOR_SCHEME = 'colorScheme';

/** 右侧停靠面板命名空间（宽度 / 侧栏开关） */
export const STORAGE_NS_DOCK_PANEL = 'dockPanel';

/** 热点新闻页 - 源勾选状态命名空间（用户启用哪些新闻源） */
export const STORAGE_NS_HOT_NEWS_FILTER = 'hotNews.filter';

/** 标的搜索历史命名空间（用户确认过的标的，最新在前，最多 SEARCH_HISTORY_MAX 条） */
export const STORAGE_NS_STOCK_SEARCH = 'stockSearch';

/** 页面 tabs 配置命名空间（各页面 tab 显隐 + 顺序，按页面 key 分桶） */
export const STORAGE_NS_TAB_CONFIG = 'tabConfig';

/** 市场榜单页 - 行业资金曲线已选行业命名空间（BK 编号列表） */
export const STORAGE_NS_MARKET_RANK_CURVE = 'marketRank.curve';

/** 市场榜单页 - 板块净流入视图模式命名空间（曲线 / 列表） */
export const STORAGE_NS_MARKET_RANK_SECTOR_VIEW = 'marketRank.sectorView';

/** 插件系统命名空间（禁用黑名单 + 侧栏面板折叠态） */
export const STORAGE_NS_PLUGIN = 'plugin';

/** 用户安装插件命名空间（应用内安装的插件代码持久化） */
export const STORAGE_NS_USER_PLUGINS = 'plugin.user';

/** 市场榜单页 - 板块历史净流入独立存储 key（不走 whf:app 整包：历史数据量随使用增长，避免整包写放大） */
export const STORAGE_KEY_SECTOR_FLOW_HISTORY = 'whf:sector-flow-history';
