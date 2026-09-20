<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseTag from '../components/ui/BaseTag.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import NoticeBar from '../components/ui/NoticeBar.vue';
import { APP_VERSION } from '../constants/app-info.constants';
import {
  buildSnippet,
  matchAll,
  parseQuery,
  type HighlightSegment,
} from '../utils/whitepaper-search';

/**
 * 软件白皮书：面向新用户的全站功能说明文档
 *
 * 内容用统一数据结构描述（章节 -> 内容块），模板按块类型渲染，
 * 避免整页手写标签：改文案只动数据，不动模板。
 * 章节 id 同时作为目录锚点；目录高亮由 IntersectionObserver 驱动。
 */

/** 通用内容块 */
type GuideBlock =
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'steps'; items: string[] }
  | { type: 'defs'; items: { term: string; desc: string }[] }
  | { type: 'tip'; text: string }
  | { type: 'table'; head: string[]; rows: string[][] };

/** 白皮书章节 */
interface GuideChapter {
  /** 章节锚点 id（目录跳转用） */
  id: string;
  /** 章节标题 */
  title: string;
  /** 右上角标签（分组归类） */
  tag: string;
  /** 左侧目录图标 key（见 MenuIcon） */
  icon: string;
  /** 引导语（可选） */
  intro?: string;
  /** 内容块 */
  blocks: GuideBlock[];
}

/** 白皮书章节内容（顺序即阅读顺序） */
const GUIDE_CHAPTERS: GuideChapter[] = [
  {
    id: 'quick-start',
    title: '快速上手',
    tag: '必读',
    icon: 'info',
    intro:
      '本软件是本机运行的 A 股行情看板（Windows 桌面客户端；也可在本地以网页开发模式运行）。行情来自公开数据接口，仅供个人学习参考。',
    blocks: [
      {
        type: 'steps',
        items: [
          '打开软件后默认进入「市场总览」，顶栏会显示当前交易状态（盘前 / 交易中 / 午间休市 / 已收盘 / 休市）。',
          '按个人习惯调一次偏好：顶栏的月亮/太阳按钮切换暗色与亮色；侧栏底部「设置」里调整行情刷新间隔、主题色与涨跌配色。',
          '按「大势 → 个股 → 板块 → 自选」的顺序看盘：市场总览看整体，市场榜单看个股强弱，行情全景看板块结构，自选股盯持仓。',
          '需要深挖某只标的时，在任意表格或卡片里单击行打开右侧详情面板，双击行进入个股详情整页。',
          '需要 AI 帮忙读盘时，点顶栏机器人图标打开「Agent 分析」；首次使用需先在 Model 管理里添加模型并「设为默认」。',
          '不熟悉界面时，点顶栏最右侧的书本图标回到本白皮书，随时查功能与口径。',
        ],
      },
      {
        type: 'tip',
        text: '全站通用手势：表格行单击 = 右侧个股详情面板（不离开当前页）；双击 = 个股详情整页；Esc 关闭面板、搜索弹窗与对话框。',
      },
    ],
  },
  {
    id: 'interface',
    title: '界面总览：侧栏、顶栏与面板',
    tag: '必读',
    icon: 'menu',
    intro: '先认清四块区域，后面每个页面都在这套框架里。',
    blocks: [
      {
        type: 'defs',
        items: [
          {
            term: '左侧导航',
            desc: '全站页面入口（市场总览、市场榜单、行情全景、板块日历、自选股、选股器、热点新闻、账户管理）。底部是「设置」入口，点开为右侧抽屉。',
          },
          {
            term: '顶栏',
            desc: '左侧是当前页面标题；右侧依次为市场状态徽标、亮/暗切换、搜索个股、Agent 分析、软件白皮书。',
          },
          {
            term: '内容区',
            desc: '页面主区，宽度上限 1600px，超宽屏下居中留白，避免表格过宽难以扫读。',
          },
          {
            term: '个股详情面板',
            desc: '右侧停靠面板，默认收起。打开后不离开当前页面即可看分时、K 线、五档与加自选；左缘竖向手柄可拖动宽度（375px 至 60% 视口宽），宽度会被记住。',
          },
          {
            term: '弹窗与抽屉',
            desc: '设置、页签配置、筛选器、导出等都在弹窗/抽屉内完成。多数配置是「草稿模式」：改动先在弹窗内暂存，点「确认」才保存。',
          },
        ],
      },
      {
        type: 'defs',
        items: [
          {
            term: '市场状态徽标',
            desc: '显示盘前 / 交易中 / 午间休市 / 已收盘 / 休市，交易中为绿色圆点。全部行情自动刷新都以此判断是否轮询。',
          },
          {
            term: '搜索个股',
            desc: '支持代码 / 名称 / 拼音；↑ ↓ 切换候选，Enter 确认，选中后直接打开右侧详情面板。',
          },
          {
            term: '亮/暗切换',
            desc: '一键切换明暗主题，选择会被记住；若用桌面客户端，切换后全部页面与图表同步跟随。',
          },
          {
            term: 'Agent 分析',
            desc: '桌面端会打开独立窗口（已打开则聚焦到该窗口）；浏览器开发模式下降级为站内页面。',
          },
          {
            term: '软件白皮书',
            desc: '即本页面，放的是功能说明与看盘口径。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '侧栏可收起：点侧栏顶部箭头，或按 Ctrl + Shift + B；收起后仅显示图标，鼠标悬停显示名称。',
          '侧栏顺序可自定义：设置 →「侧栏导航 → 路由顺序编排」拖拽排序，弹窗内「恢复默认」可一键复原，确认后立即生效并记住。',
          '按 Shift + Tab 可在页面之间循环切换（按当前侧栏顺序，跳过设置页）。',
        ],
      },
    ],
  },
  {
    id: 'dashboard',
    title: '市场总览：一屏看大势',
    tag: '看盘',
    icon: 'dashboard',
    intro: '定位：把指数、量能、涨跌结构、资金方向与板块热度放在同一屏，用于判断「今天是什么市」。',
    blocks: [
      {
        type: 'defs',
        items: [
          {
            term: '指数卡',
            desc: '4 个 A 股主指数（上证指数、深证成指、创业板指、科创50）+ 6 个全球指数（恒生、道指、纳指、标普500、日经225、KOSPI）。单击卡片看详情，右上箭头可展开/收起指数区域（仅当一行放不下时出现）。',
          },
          {
            term: '成交额与资金速览',
            desc: '展示两市成交额与主力净流入，并给出近 30 / 60 / 180 日成交额走势（总成交额、上证、深证三条线）。图表视图下可切换「成交量 / 相对成交量」：相对成交量为当日成交额较上一交易日的差额（放量 +、缩量 −，带 0 轴基准线）。表格列有日期、总成交额、较上日、上证、深证，可点表头排序，也可切换到列表逐日核对。',
          },
          {
            term: '涨跌分布',
            desc: '把全市场按涨跌幅分成 8 个区间（≤-7%、-7~-5%、-5~-3%、-3~0%、0~3%、3~5%、5~7%、≥7%）统计家数与占比，可切换图表/列表、查看近 30 / 60 / 180 日。',
          },
          {
            term: '主力净流入（近 10 日）',
            desc: '逐日列出主力净流入、主力占比、超大单、大单、小单净额，可排序；折线图带零轴基准，正负一眼分辨。',
          },
          {
            term: '板块热力（按总市值加权）',
            desc: '色块面积 = 板块总市值，颜色 = 板块涨跌幅；可切换热力图/列表，可调 Top10 / 20 / 30 / 50。点板块下钻到成分股视图（此时面积 = 成交额，取前 30），点成分股开面板、双击进详情页。',
          },
          {
            term: '卡片标题跳转',
            desc: '「成交额」「主力净流入（近 10 日）」两张卡的标题可点击，直达市场榜单；「涨跌分布」「板块热力」两张卡的标题可点击，直达行情全景（默认即 A 股全景模块）。可点击的标题 hover 会高亮并带箭头。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '看方向：主指数与全球指数先定基调，隔夜外盘影响开盘情绪。',
          '看增量：两市成交额与「较上日」判断是放量还是缩量，量能决定行情级别。',
          '看结构：涨跌分布是赚钱效应的直接读数——指数上涨但下跌家数占多数，多为权重或少数主线拉动，追高风险大。',
          '看资金：主力净流入方向（尤其超大单）体现大资金态度，与指数同向时趋势更可信。',
          '看热点：板块热力图色块越大越红，说明大市值板块在领涨；颜色红但面积小的板块持续性需打问号。',
          '五项互相印证时结论最可靠；出现背离时，先降低仓位预期，再去行情全景与板块日历里找原因。',
        ],
      },
      {
        type: 'tip',
        text: '成交额趋势、主力净流入、涨跌分布属于重数据，只在进入页面时拉取一次，不随刷新间隔轮询；想看最新值可切到别的页面再回来。',
      },
    ],
  },
  {
    id: 'market-rank',
    title: '市场榜单：资金、行情与市场异动',
    tag: '看盘',
    icon: 'rank',
    intro: '定位：用排行榜快速找到当日最强、最活跃与资金最集中的标的，并一站式查看涨停、盘口异动、龙虎榜与大宗交易（原「市场异动」页已并入为本页页签）。',
    blocks: [
      {
        type: 'defs',
        items: [
          {
            term: '涨幅榜 / 跌幅榜 / 成交额榜 / 换手率榜',
            desc: '取自全 A 股快照，各自按对应维度取前 100 名。点表头可排序的列：涨跌幅、涨跌额、成交量、成交额、换手率（最新价不可排序）。',
          },
          {
            term: '板块净流入 / 个股主力',
            desc: '资金流两榜，各取前 15；板块净流入默认排在第一个页签（此前自定义过页签顺序的，可在页签配置里调整或恢复默认）。板块净流入行可展开成分股表格，继续查看板块内部结构。北向持股页签已下线（上游长期无数据）。',
          },
          {
            term: '板块净流入 · 曲线 / 列表',
            desc: '板块净流入模块内的「曲线 / 列表」切换按钮，默认展示曲线：曲线把多个行业板块的当日「累计主力净流入」分时曲线同屏叠加（默认净流入前 8 + 净流出前 8，可自选，上限 26 个），按收盘净流入正负着涨跌两色，悬停可对比同一时刻各行业的资金量，提供「选择行业」（确认后只补拉新增行业）与「刷新」（整场重拉）；列表即主力净流入榜单。视图选择会被记住——手动切到列表后，下次进入保持列表。',
          },
          {
            term: '查看历史净流入',
            desc: '板块净流入模块工具条上的入口，打开「板块历史净流入」页：两行布满、左右横向滑动的卡片流（同热点新闻页），展示板块严格跟随「选择行业」的当前勾选——勾几个展示几个（上限 26）。每板块一张逐日主力净流入双向条形卡，最新交易日排最上，红条向左为净流入、绿条向右为净流出，悬停可看当日数值，卡片头部为历史累计净额，卡内逐日上下滚动。历史数据在本机随使用自动累积——进入本页即为勾选行业确保数据就绪（未入库的一次补齐完整历史），盘中进入板块净流入页签或本页时增量更新，收盘后与非交易日直接读本地不再请求；每板块最多保留约一年（250 个交易日）。「刷新」按钮可强制更新当日数据；若有行业的历史拉取失败（多为数据源限流封禁），统计处会提示缺失数量，等几十分钟风控解除后再点「刷新」补齐即可。',
          },
          {
            term: '涨停（原市场异动页签）',
            desc: '连板梯队按连板数分组展示当日涨停股，3 板及以上高亮，用于一眼判断情绪高度；另有六个股池：涨停池（默认）、昨日涨停、强势股、次新股、炸板股、跌停池，表格含现价、涨跌幅、连板数、首次封板时间、封单、换手率、所属行业。',
          },
          {
            term: '异动（原市场异动页签）',
            desc: '盘口异动按时间轴列出（最多 50 条），类型包括火箭发射、大笔买入、大单扫货、封涨停板、向上缺口、60 日新高等；板块异动给出行情涨跌幅、主力净流入、异动次数与最频繁个股。',
          },
          {
            term: '龙虎榜 / 大宗交易（原市场异动页签）',
            desc: '龙虎榜：日期下拉（近 7 日）+「涨 / 跌」切换，列出收盘价、涨跌幅、龙虎榜净买额、净买占比、上榜原因、上榜后 5 日表现。大宗交易：日期下拉，列出成交价、成交量、成交额、溢价率、买方营业部、卖方营业部。',
          },
          {
            term: '页签配置',
            desc: '点页签栏右侧的配置按钮，可勾选哪些榜单参与展示、拖拽调整顺序，设置会被记住。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '涨幅榜前排看题材强度与跟风广度，跌幅榜用来识别杀跌方向、避免逆势加仓。',
          '成交额榜看资金承接与主流焦点，换手率榜看活跃度与分歧程度（过高的换手往往伴随剧烈波动）。',
          '涨停页的连板梯队是情绪体温计：梯队断层（高位只剩一两只）通常先于情绪退潮出现；炸板股与跌停池数量上升说明承接转弱，「昨日涨停」今天的溢价高低直接反映接力意愿。',
          '龙虎榜看席位性质与净买额：机构席位偏中期、游资席位偏短线，「上榜后 5 日」可用于校准跟风节奏；大宗交易溢价率为正是接盘方愿意溢价拿货，大幅折价则要留意减持压力。',
          '盘口异动适合盘中跟踪：「大单扫货」「封涨停板」密集出现时，再看一眼板块与资金是否同向确认。',
          '「板块净流入 + 板块上涨」同向说明有真金白银介入；「涨幅高但板块净流出」则有拉高派发嫌疑。',
          '板块净流入行展开成分股，可确认上涨是否由少数龙头撑起（龙头拉、多数绿 = 内部不齐心）。',
          '板块净流入切到曲线视图看资金的日内节奏：全程抬升 = 持续吸筹；冲高回落 = 尾盘兑现；尾盘陡拉 = 抢筹博弈次日。收盘后打开即为全天完整曲线。',
        ],
      },
      {
        type: 'tip',
        text: '行情类榜单在交易时段每 30 秒刷新一次；资金流类为重接口，进入页签只拉一次（板块净流入的曲线视图同理，不自动轮询，换行业或点「刷新」才会再请求）。涨停 / 异动 / 龙虎榜 / 大宗为近 7 日快照，同样不参与轮询，需要最新数据可切走页签再切回。表头排序只作用于已加载的前 100 / 15 条数据，不等价于全市场排序。',
      },
    ],
  },
  {
    id: 'panorama',
    title: '行情全景：跨市场视角',
    tag: '看盘',
    icon: 'globe',
    intro: '定位：从「板块」和「跨市场」两个角度补足个股视角，包含 A 股全景、美股全景、全球宏观三个页签。',
    blocks: [
      {
        type: 'defs',
        items: [
          {
            term: 'A股全景 · 排序与类型',
            desc: '排序可按涨跌幅或按总市值；类型可在行业板块与概念板块之间切换，前者看产业主线，后者看题材热点。',
          },
          {
            term: 'A股全景 · 展示形式',
            desc: '列表模式给出逐条数值与成分股入口；平铺模式只显示板块名与涨跌幅，用于快速扫全屏格局。',
          },
          {
            term: 'A股全景 · 统计与筛选',
            desc: '顶部四格统计（涨幅＞3% / 涨幅≥0% / 跌幅＜3% / 跌幅＞3%）可直接点击筛选；筛选共 7 项：全部、上涨板块、下跌板块、涨幅＞3%、涨幅≥0%、跌幅＜3%、跌幅＞3%。3% 是强弱分界线。',
          },
          {
            term: 'A股全景 · 列表列与成分股',
            desc: '列为板块、最新价、涨跌幅、总市值、换手率、上涨家数、下跌家数、领涨股；涨跌幅可排序。点行首三角展开成分股（分批加载，每批 60 行），成分股单击开面板、双击进详情页。',
          },
          {
            term: '美股全景',
            desc: 'SPY、DIA 与 13 只行业 SPDR ETF 的涨跌表现；仅在美股时段（21:30–24:00、00:00–04:00）轮询。',
          },
          {
            term: '全球宏观',
            desc: '分四组：全球指数、贵金属、其他商品、利率债，用于快速核对避险情绪与商品走势。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '先「行业板块 + 按涨跌幅」确认当日主线，再切「概念板块」找题材的细分方向。',
          '切「按市值」排序，可判断是大市值在护盘，还是中小市值在进攻。',
          '用板块的上涨家数与下跌家数比看内部一致性：涨幅靠前但下跌家数多，说明只是龙头在拉，持续性存疑。',
          '美股全景与全球宏观用来判断外部环境，是隔夜情绪的参考依据。',
        ],
      },
      {
        type: 'tip',
        text: '未开盘时展示最近交易日的收盘数据；页签本身可配置显隐与顺序（页签栏右侧配置按钮）。',
      },
    ],
  },
  {
    id: 'board-calendar',
    title: '板块日历：热点轮动与赚钱效应',
    tag: '看盘',
    icon: 'calendar',
    intro:
      '定位：把「每个交易日哪个板块最强」做成矩阵，横向看持续性、纵向看扩散度，用于回溯和跟踪主线。',
    blocks: [
      {
        type: 'defs',
        items: [
          {
            term: '热门口径',
            desc: '近 5 日涨停（默认）或当日成交额，决定板块行的自动排序依据。',
          },
          {
            term: '展示范围',
            desc: '10 / 20 / 30 / 60 / 180 天或全部，默认 10 个交易日。',
          },
          {
            term: '板块过滤器',
            desc: '控制参与统计的板块。可选 36 个板块（31 个申万一级 + 半导体、航天航空、机器人、光伏设备、新能源 5 个高关注方向），支持全选、全不选、反选、按热门口径重排、恢复默认，并可拖拽行序；改动要点「确认」才保存。',
          },
          {
            term: '单元格读数',
            desc: '显示「涨停 N / 跌停 N」；右上角带 ⓘ 标记的格子是历史回补数据，不参与色阶着色。点格子打开明细弹窗：上方是摘要（涨停、跌停、上涨、下跌、成分股数、成交额、得分、得分率），下方两个页签「涨跌停明细」（本地库，历史日期也能看）与「全部成分股」（仅当日可用）。',
          },
          {
            term: '板块详情页',
            desc: '点击首列板块名称进入：成分股 × 交易日的涨跌幅矩阵，列是交易日、行是成分股，格内为该股当日涨跌幅（前复权口径，除权日不失真；红涨绿跌 7 档色阶）。行恒按涨跌幅从高到低排——默认按最新交易日，点任意列头改按那天排，也可切「区间累计」按窗口累计涨跌幅排；展示范围 10 / 20 / 30 / 60 / 120 天（默认 10）。单击成分股行打开右侧个股侧栏，双击进入股票详情整页。逐票取数、本页不自动轮询，需要最新数据点右上角「刷新」。',
          },
          {
            term: '色阶（7 档）',
            desc: '按得分率（得分 ÷ 成分股数）着色：≥+3 强多、+1.5~+3 偏多、0~+1.5 微多、0 中性、-1.5~0 微空、-3~-1.5 偏空、≤-3 极空。',
          },
          {
            term: '得分口径',
            desc: '涨停 × 10 + 跌停 × (-10) + 净上涨 × 5 + 净下跌 × (-5)，再除以成分股数得到得分率，使不同规模板块可横向比较。',
          },
          {
            term: '查看赚钱效应 / 恢复热门排序 / 刷新',
            desc: '「查看赚钱效应」打开气泡图，气泡面积正比于得分率绝对值，右半区为赚钱效应方向；图高度固定（板块过多时自动缩小气泡适配，切换口径高度不变，极端聚集时整图等比缩小，不出现滚动条）；「恢复热门排序」仅在自定义过行序后出现；「刷新」在采集进行中或浏览器开发模式下不可用。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '横向读一行（同一板块跨日）：连续多日强多说明主线在延续；由强多转中性或转空要警惕退潮。',
          '纵向读一列（同一天各板块）：多数板块偏多 = 普涨格局；仅少数板块偏多 = 结构性行情，仓位应更集中。',
          '小板块的家数容易被规模误导，比较不同板块强度时以得分率为主、涨停家数为辅。',
          '当日 15:00 后数据定稿，适合盘后复盘与次日预案；盘中看到的是实时快照。',
        ],
      },
      {
        type: 'tip',
        text: '数据来自本地数据库并逐日累积：交易日在 15:00 后当日数据定稿，历史回补窗口约 20 个交易日。桌面客户端才会持续累积；浏览器开发模式只保留当日。',
      },
    ],
  },
  {
    id: 'watchlist',
    title: '自选股：分组盯盘',
    tag: '日常',
    icon: 'star',
    intro: '定位：把长期跟踪的标的按分组管理，盘中集中盯价格、涨跌与量能。',
    blocks: [
      {
        type: 'defs',
        items: [
          {
            term: '分组页签',
            desc: '页签切换分组；点「添加股票」搜索（代码 / 名称 / 拼音）加入当前分组；点「新建分组」输入名称即建。',
          },
          {
            term: '表格列与排序',
            desc: '列为名称（含代码）、现价、涨跌幅、成交额、换手率与删除按钮；涨跌幅可点表头排序，拖动每行左侧手柄可调整顺序。',
          },
          {
            term: '删除分组',
            desc: '仅非默认分组可删除（默认分组受保护），删除前二次确认。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '盯盘时先看涨跌幅与成交额：价涨量增是有效上涨，价涨但成交额萎缩要留意乏力。',
          '加入自选也可以从右侧详情面板完成：面板里的「加入自选」可一次勾选多个分组，还能就地新建分组。',
          '同一标的在多个分组中只保存一次，不会重复占用行情请求。',
        ],
      },
      {
        type: 'tip',
        text: '自选股与设置保存在本机用户数据目录，覆盖安装新版本不会丢失。',
      },
    ],
  },
  {
    id: 'screener',
    title: '选股器：条件筛选、信号扫描与尾盘选股',
    tag: '工具',
    icon: 'filter',
    intro: '三个页签分别解决「按条件找股」「按技术信号找股」「按当日盘口强度找隔夜标的」。三者都是点一次算一次，不轮询。',
    blocks: [
      {
        type: 'defs',
        items: [
          {
            term: '基础筛选',
            desc: '条件为涨幅≥、涨幅≤、换手率≥、换手率≤、量比≥、PE(TTM)≤，留空即不限制；结果条数可选 Top10 / 20 / 50（默认 20），结果按成交额降序给出。',
          },
          {
            term: '基础筛选 · 单票回测',
            desc: '结果行内的「回测」按钮，对指定标的（如 600519 或 sh600519）跑 MA5/MA20 金叉死叉策略：近一年日 K，含买入 0.03%、卖出 0.13% 的费用，输出策略总收益、买入持有基准、胜率、最大回撤、交易次数与权益曲线。',
          },
          {
            term: '信号扫描 · 股票池',
            desc: '五种来源池：自选股、手选板块（行业/概念 + 成分股上限 30 / 50 / 80）、榜单 TopN（按成交额/涨幅/换手率，取 Top20 / 50 / 100）、涨停·强势池（涨停池/强势股/昨日涨停/次新股/炸板池/跌停池）、盘口异动池。',
          },
          {
            term: '信号扫描 · 信号模板',
            desc: '8 个模板可多选，默认 MA 金叉：MA 金叉 / MA 死叉 / MACD 金叉 / MACD 死叉 / RSI 超卖 / RSI 超买 / BOLL 上轨突破 / BOLL 下轨跌破。扫描支持进度显示与取消，离开页面会中止任务，结果可一键加自选。',
          },
          {
            term: '尾盘选股',
            desc: '按当日分时表现筛选：默认流通市值 50~200 亿、量比≥1.2、涨幅 3%~5%、换手率 5%~10%、分时强度≥80%，各项可改，并可勾选「过滤 ST 股票」。分时强度 = 当日价格站在分时均价之上的时间占比。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '信号口径：MA 金叉 = MA5 上穿 MA10；MACD 金叉 = DIF 上穿 DEA；RSI 超卖 = RSI6 或 RSI12 低于 30，超买 = 高于 70；BOLL 突破 = 收盘价越过上轨/下轨。判定基于最新两根 K 线，属「当日触发」清单。',
          '尾盘选股面向「当天收工前挑隔夜标的」：分时强度越高说明全天走势越稳；涨幅 3%~5% 的设定避开已涨停与走势过弱的标的。',
          '选股结果是候选清单而非结论，应回到行情全景（板块是否同向）与市场榜单（资金是否流入）再确认一次。',
          '回测结论只用来看策略的历史特征（胜率、回撤与费用影响），不等于未来收益。',
        ],
      },
      {
        type: 'tip',
        text: '全市场筛选与分时数据为批量请求（并发受限），一次全市场扫描需等待数十秒；北交所标的缺少可用日 K 数据源，信号扫描会自动跳过。日 K 为不复权数据，回测未考虑除权除息影响。',
      },
    ],
  },
  {
    id: 'hot-news',
    title: '热点新闻：多源消息面',
    tag: '日常',
    icon: 'news',
    intro: '定位：把多个财经资讯源并排放在一屏，用于快速掌握消息面与市场注意力。',
    blocks: [
      {
        type: 'defs',
        items: [
          {
            term: '卡片流',
            desc: '每个已启用的新闻源一张卡片，横向滚动排列。卡片顶部是源名称与条数，右上放大按钮可打开宽屏弹窗两列查看（数据与分页与卡片共享）。',
          },
          {
            term: '新闻源设置',
            desc: '点顶部「新闻源设置」勾选启用哪些源、拖拽调整顺序，点「确认」后生效；全部取消勾选时页面会为空（弹窗内有提示）。',
          },
          {
            term: '卡片内子视图',
            desc: '每个源可能有多个栏目（如快讯、推荐、热搜、领涨概念、热点主题、深度、热榜等），用卡片内的切换条切换；同花顺的热点主题还带主题标签可单选。',
          },
          {
            term: '加载与刷新',
            desc: '卡片底部提供「加载更多」与「强制刷新」；列表滚动到底部附近也会自动加载下一页，已加载内容按条目 id 去重。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '盘前扫「快讯 + 热搜」，确认隔夜消息与当天市场注意力所在。',
          '盘中看到某个板块突然拉升时，用快讯回溯原因（政策、订单、业绩、公告），判断是消息驱动还是资金接力。',
          '「领涨概念 / 热点主题」与行情全景的概念板块排行互相印证：消息先到、资金后到，两者同时出现时确定性更高。',
          '阅读顺序建议由快到慢：快讯（时间线）→ 热榜（关注度）→ 深度（逻辑），避免一上来就读长文错过盘口变化。',
        ],
      },
      {
        type: 'tip',
        text: '点击卡片会在新窗口打开原文（桌面端为独立小窗）。列表结果有 30 分钟本地缓存，切走页面再回来不会立即重复请求；需要最新内容时点卡片底部的「强制刷新」。',
      },
    ],
  },
  {
    id: 'stock-account',
    title: '账户管理：交割单与对账单',
    tag: '工具',
    icon: 'account',
    intro: '定位：把券商流水导入本机数据库，用于核对交易、成本与费用；数据只存在本机。',
    blocks: [
      {
        type: 'steps',
        items: [
          '点「＋添加」创建账户（名称必填、不可重名，备注可选），可创建多个账户分别管理。',
          '点「交割单导入」或「对账单导入」，选择一个目标账户（默认当前激活账户），点击或拖入文件。',
          '导入完成后会提示「解析 N 条：新增 X，跳过重复 Y」，重复导入同一文件不会产生重复数据。',
          '在卡片内一级切换对账单 / 交割单，二级切换 全部 / 按股票汇总 / 按月汇总 查看；点每个视图右上角「导出 excel」导出明细。',
        ],
      },
      {
        type: 'defs',
        items: [
          {
            term: '支持的文件',
            desc: '同花顺导出的对账单与交割单，扩展名 .csv / .xlsx / .xls，单个文件不超过 10MB。文件实为 GBK 编码的制表符文本，按列名识别字段。',
          },
          {
            term: '去重规则',
            desc: '以「账户 + 类型 + 日期 + 时间 + 代码 + 成交编号」为唯一键做库级去重，同一笔成交不会重复入库。',
          },
          {
            term: '汇总口径',
            desc: '汇总行给出笔数、买入/卖出数量与金额，费用合计 = 佣金 + 印花税 + 过户费 + 委托费 + 服务费，净发生金额为各行净额之和。',
          },
          {
            term: '账户管理',
            desc: '点卡片右上角的 ☰ 按钮勾选账户标签显隐、拖拽排序（至少保留一个）；删除账户会级联删除该账户的对账单与交割单，需二次确认。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '交割单是「已成交事实」，对账单是「资金流水」，两者互补：用交割单核对实际买卖点与持仓成本，用对账单核对费用与资金余额变化。',
          '按股票汇总能快速看出每只标的的累计盈亏与费用占比；按月汇总可对照月度盈亏记录。',
          '费用合计是看得见的交易摩擦成本，减少无效交易是最直接的成本优化。',
        ],
      },
      {
        type: 'tip',
        text: '账户数据写入本机 SQLite 数据库，仅桌面客户端可用（浏览器开发模式下导入不可用）。导入前请先在软件中创建账户。',
      },
    ],
  },
  {
    id: 'stock-detail',
    title: '个股详情：面板与整页',
    tag: '看盘',
    icon: 'expand',
    intro: '定位：单只标的的完整视图，包含报价、分时/分时K 线、五档盘口、指标与自选操作。',
    blocks: [
      {
        type: 'defs',
        items: [
          {
            term: '打开方式',
            desc: '任意表格/卡片行单击 = 右侧面板（不离开当前页）；双击 = 个股详情整页；顶栏搜索选中 = 打开面板；已打开面板时点面板右上角放大图标 = 切到整页。',
          },
          {
            term: '面板宽度',
            desc: '拖动面板左缘的竖向手柄调节宽度（375px 至 60% 视口宽），宽度会被记住。面板宽度≥500px 时才展示五档盘口，避免主图被挤得过窄。',
          },
          {
            term: '报价头',
            desc: '现价、涨跌幅与涨跌额，以及高、低、开、市值、流通市值、成交量、换手率、成交额、市盈率；数值随涨跌主题配色变化。',
          },
          {
            term: '周期切换',
            desc: '分时 / 日K / 周K / 月K / 5分 / 五日。K 线在打开面板或切换周期时拉取一次，不参与轮询。',
          },
          {
            term: '图表指标',
            desc: '点图表右上角的指标配置按钮：主图可选 MA（5，10，30）或 BOLL；副图可选 VOL、MACD、BOLL、KDJ、RSI、MACD&KDJ，多选则显示多个独立面板。配置会被记住。分时与五日固定为主图 + 均价线 + VOL + MACD，不参与配置。',
          },
          {
            term: '面板副图',
            desc: '右侧面板（侧栏详情）的 K 线副图固定只显示成交量，不分周期；需要完整副图指标时双击行切到个股详情整页。',
          },
          {
            term: '五档盘口',
            desc: '买一至买五在左（涨色）、卖一至卖五在右（跌色），每档显示价格与手数。',
          },
          {
            term: '自选操作',
            desc: '未加自选时按钮为「加入自选」，可一次勾选多个分组（也能就地新建分组）；已加自选时改为「从自选移除」，可选择只从部分分组移除。',
          },
          {
            term: '整页额外内容',
            desc: '左侧来源列表（从搜索结果或榜单进入时保留来源，可收起）、五档盘口，以及按账户筛选的「我的交易记录」。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '分时图看当日强弱：价格长时间站在均价上方为强势，分时均价是短线多空分界；冲高回落跌破均价要警惕。',
          '五档盘口看即时买卖力量：挂单厚但价格不动，说明有大单压盘或托盘，需结合成交额判断真假。',
          '日 K 用 MA 与 MACD 确认趋势与动能，BOLL 判断超买超卖与轨道收敛后的方向选择。',
          '多周期配合：用周 K、月 K 判断大级别位置，避免只用分钟级信号做中线决策。',
          '配合成交量与换手率区分「放量突破」与「缩量横盘」，量价背离时结论要打折。',
        ],
      },
      {
        type: 'tip',
        text: 'K 线数据取自新浪源且为不复权数据，除权除息日会出现跳空，做长周期分析时请留意；报价部分仍按设置的刷新间隔更新。',
      },
    ],
  },
  {
    id: 'agent',
    title: 'AI Agent：让模型读你自己的数据',
    tag: '进阶',
    icon: 'agent',
    intro:
      '定位：内置 AI 分析师，可调用本软件的行情数据工具查数据、算指标、做归纳，输出可直接落到看盘流程里。该功能需要桌面客户端。',
    blocks: [
      {
        type: 'steps',
        items: [
          '配置模型（首次必做）：打开 Agent 分析 → 左栏「Model」→ 添加模型。选供应商预设（OpenAI / DeepSeek / Moonshot / OpenRouter / Ollama 或自定义）→ 填接口地址与 API Key → 点「测试连接」验证连通 → 填「模型 ID」（这一项才是实际请求使用的模型名）与展示名 → 保存后「设为默认」。',
          '开始对话：左栏「新建对话」，输入框上方选择模式，Enter 发送、Shift + Enter 换行；运行中发送键会变成停止按钮。',
          '按需扩展能力：左栏管理 MCP（数据工具接入）与 Skill（专项方法论），并在「访问设置」里授权给哪些 Agent 使用。',
          '多角色协作：在「Agents」里新建 Agent 配置（主模型、子 Agent 编排、可用 Skills 与 MCP），再用它发起对话。',
        ],
      },
      {
        type: 'defs',
        items: [
          {
            term: '模型配置项',
            desc: '除接口地址与密钥外，还有工具调用、图片输入、思考模式开关，以及输入上下文与输出上限档位。若未配置默认模型就发送消息，会出现提示并自动弹出 Model 管理。',
          },
          {
            term: 'MCP 管理',
            desc: '内置服务器（应用接口 / stock-sdk / 市场数据）不可删除或编辑，但可开关与授权；远端 MCP 支持「手动填写」（名称、传输方式 Streamable HTTP 或 SSE、URL、请求头）与「粘贴 JSON」（标准 mcpServers 结构）两种添加方式。',
          },
          {
            term: 'Skill 管理',
            desc: '内置 Skill 不可删除；用户 Skill 可关闭、授权或删除，添加方式为登记信息（名称 / 目录名 / 描述）或导入 zip 包（需包含 SKILL.md）。',
          },
          {
            term: '资源授权',
            desc: '每个 MCP / Skill 卡片右侧的滑杆按钮打开「访问设置」：先打开启用开关，再选「全部 Agent 都可以访问」或「精确设置」（逐个勾选主 Agent 与子 Agent）。注意：精确设置里一个都不勾，等于该资源对包括主 Agent 在内的所有 Agent 都不可用，弹窗会有红色警示。',
          },
          {
            term: '模式开关',
            desc: '输入框上方的「专业模式 / 日常模式」分段控件：专业模式（默认）只回答金融、股票相关问题；日常模式不限制话题。若所用 Agent 配置自带系统提示词，专业模式会把金融边界叠加在其上，界面有对应说明。',
          },
          {
            term: '工具调用卡片',
            desc: '展示调用的工具名、来源服务、状态（运行中 / 完成 / 失败）、耗时与入参摘要，可展开查看入参；结果较长时可查看原始结果。这说明数字来自本软件的数据通道，而不是模型自行编造。',
          },
          {
            term: '会话树',
            desc: '会话可按分组管理：拖拽换组、重命名、置顶、删除；分组本身也可重命名或删除。首条提问会自动成为会话名。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '适合交给它的事：把当日板块数据读出来做归纳、按条件筛股票并说明理由、把热点新闻与板块表现做关联、对某只个股做多角度清单式检查。',
          '提问尽量带上范围与口径（例如「今天涨幅＞3% 的行业板块里，哪些主力资金是净流入的」），回答更容易落到可验证的数据。',
          '看到工具调用卡片时，可展开核对入参，确认它查的是你要的那个口径。',
        ],
      },
      {
        type: 'tip',
        text: '模型密钥、对话与工具调用记录都保存在本机数据库。AI 输出仅供学习参考，投资决策仍需自己判断。',
      },
    ],
  },
  {
    id: 'settings',
    title: '设置与全局开关',
    tag: '配置',
    icon: 'settings',
    intro: '设置入口在侧栏底部，以右侧抽屉形式打开，改动即时生效并自动记住。',
    blocks: [
      {
        type: 'defs',
        items: [
          {
            term: '数据获取',
            desc: '数据来源说明入口、代理自检（手动探测一次数据通道，给出耗时或失败原因，用于排查「某个卡片没数据」）、清空 SDK 缓存（清掉代码表、交易日历、板块映射等实例级缓存，下次请求重新拉取）。',
          },
          {
            term: '行情自动刷新（开关）',
            desc: '总开关。关闭后所有页面停止轮询，手动刷新浏览器仍可拉取；用于临时省请求或规避上游限频。',
          },
          {
            term: '刷新间隔',
            desc: '行情类数据按此间隔轮询；重数据（全市场快照等）保持不低于 1 分钟的克制档。间隔只在总开关开启时可选。',
          },
          {
            term: '初始设置引导',
            desc: '新用户首次打开软件时弹出一次：依次选择外观模式（白天 / 黑暗）、系统主题色与涨跌主题色，选择即时生效；点「开始使用」或关闭弹窗即完成，此后不再出现，偏好可随时在设置页调整。老版本升级用户不会看到该引导。',
          },
          {
            term: '主题色',
            desc: '清新绿 / 淡雅蓝 / 淡雅粉 / 极光紫 / 活力橙 / 黑金，即时生效并记住选择，暗色模式自动适配。',
          },
          {
            term: '涨跌颜色',
            desc: '红涨绿跌（A 股习惯，默认）/ 红跌绿涨（欧美习惯）/ 红涨蓝跌。选项左侧色块为涨、右侧为跌，全站文本与图表同步跟随——切换后旧习惯的读数结论要重新适应。',
          },
          {
            term: '全局水印（开关）',
            desc: '斜向平铺「数据仅供个人学习参考」字样，覆盖全部页面，默认开启。',
          },
          {
            term: '快捷键说明',
            desc: '弹窗查看全部快捷键（见本白皮书「快捷键」章节）。',
          },
          {
            term: '侧栏导航',
            desc: '「路由顺序编排」拖拽调整左侧导航顺序，确认后立即刷新侧栏；弹窗内「恢复默认」复原默认顺序与显隐。',
          },
          {
            term: '系统日志',
            desc: '日志采集开关：记录报错与操作行为（页面显示、按钮点击、接口请求），本地保留最近若干天，超期自动清理；系统类事件不受开关影响。点「查看」进入系统日志页（报错日志 / 行为日志两个页签，支持按时间、分类、关键字筛选与导出）。',
          },
          {
            term: '系统',
            desc: 'GitHub 仓库入口、当前版本号与「检查更新」（对比 GitHub Releases 最新版本，发现新版会给出下载入口）。',
          },
        ],
      },
      {
        type: 'list',
        items: [
          '全局开关（本页）：行情自动刷新、刷新间隔、主题色、涨跌颜色、全局水印、日志采集、侧栏顺序。',
          '页面级开关（各页面自己的工具条）：页签显隐与排序（市场榜单、行情全景、账户标签）、图表/列表切换、TopN 或 Top 条数、板块热力展示形式、板块日历的热门口径与展示范围、板块过滤器、新闻源设置、选股条件与股票池、K 线指标配置等。',
          '页面级配置多数是「草稿模式」：在弹窗内改动后必须点「确认」才保存。',
        ],
      },
    ],
  },
  {
    id: 'playbook',
    title: '看盘流程参考：从盘前到盘后',
    tag: '流程',
    icon: 'trophy',
    intro: '一份可直接照做的流程，把各页面串成一条线；按自己的持仓周期调整顺序即可。',
    blocks: [
      {
        type: 'steps',
        items: [
          '盘前（09:15–09:25）：市场总览看全球指数与昨日资金方向；热点新闻扫快讯与热搜，确认隔夜消息；板块日历看最近 3~5 个交易日哪条线持续偏多。',
          '早盘（09:30–10:00）：市场榜单的盘口异动看资金第一时间冲向哪里，再用涨幅榜与成交额榜确认题材强度；自选股盯持仓与关注池的开盘表现。',
          '盘中（10:00–14:30）：行情全景 A 股全景筛「涨幅＞3%」看主升方向、筛「跌幅＞3%」看杀跌方向；板块日历当日列看板块内的涨停扩散；个股详情面板看分时与五档决定买卖点。',
          '尾盘（14:30–15:00）：选股器尾盘选股按分时强度挑隔夜候选；市场榜单的涨停页看涨停池与连板梯队判断情绪能否延续到次日。',
          '盘后：龙虎榜与大宗交易看资金去向；板块日历当日数据在 15:00 后定稿，用于复盘；账户管理导入当日交割单，核对成交与费用。',
        ],
      },
      {
        type: 'list',
        items: [
          '消息 → 板块 → 个股：热点新闻（原因）→ 行情全景概念板块排行（资金回应）→ 市场榜单涨幅榜（龙头与跟风）。',
          '情绪 → 接力：市场榜单涨停页的连板梯队与炸板股数量（情绪与承接）→ 昨日涨停今日表现（接力意愿）。',
          '资金 → 结构：市场总览涨跌分布与主力净流入（整体结构）→ 板块日历得分率（板块内部强度）→ 个股五档与分时强度（个体强弱）。',
          '结论 → 验证：选股器给出的只是候选清单，必须回到板块方向与资金流上再确认一次。',
          '风格匹配：短线看分时、涨停池、盘口异动与龙虎榜；中线看板块日历、主力净流入与周 K、月 K 位置。',
        ],
      },
      {
        type: 'tip',
        text: '本软件只提供数据、统计口径与工具，不提供买卖建议；行情数据可能有延迟、缺失或受上游限频影响，请以券商行情为准。',
      },
    ],
  },
  {
    id: 'shortcuts',
    title: '快捷键与通用操作',
    tag: '参考',
    icon: 'sliders',
    blocks: [
      {
        type: 'table',
        head: ['操作', '作用'],
        rows: [
          ['Ctrl + Shift + B', '收起 / 展开左侧导航栏'],
          ['Shift + Tab', '按侧栏顺序切换到下一个页面（到尾回到第一个）'],
          ['Esc', '关闭个股详情面板、搜索弹窗或对话框'],
          ['↑ / ↓', '搜索弹窗内切换候选标的'],
          ['Enter', '搜索弹窗内确认选中；Agent 输入框内发送消息'],
          ['Shift + Enter', 'Agent 输入框内换行'],
          ['单击表格行', '在当前页右侧打开个股详情面板'],
          ['双击表格行', '进入个股详情整页（并携带来源列表）'],
        ],
      },
      {
        type: 'list',
        items: [
          '页面切换动画方向跟随侧栏顺序：向侧栏更靠前的页面切换时，内容从左侧滑入。',
          '进入页面后若短暂空白，通常是 KeepAlive 缓存的上一份状态在复用，数据会在请求返回后刷新。',
          '数值显示为「--」表示该字段上游未返回（如无市盈率、无成交），不是零。',
        ],
      },
    ],
  },
  {
    id: 'faq',
    title: '常见问题与数据说明',
    tag: '参考',
    icon: 'info',
    blocks: [
      {
        type: 'defs',
        items: [
          {
            term: '卡片显示「暂无数据」',
            desc: '多为上游公开接口限频或临时封禁。先在设置里点「代理自检」确认通道是否通畅，稍后重试；重接口（龙虎榜、大宗、全市场快照、成交额趋势）不参与轮询，需要切走页面再重新进入才会重新拉取。',
          },
          {
            term: '数据不刷新',
            desc: '确认设置里的「行情自动刷新」处于开启状态，且当前在交易时段（A 股 09:15–15:00；美股 21:30–24:00 与 00:00–04:00）。非交易时段只在进入页面时请求一次。',
          },
          {
            term: '市场状态显示「休市」',
            desc: '周末、法定节假日属于休市；「盘前」与「已收盘」都属于非交易时段。',
          },
          {
            term: '板块日历缺少历史格子',
            desc: '历史数据由本机逐日累积，回补窗口约 20 个交易日；且需要桌面客户端（浏览器开发模式只保留当日）。',
          },
          {
            term: '导入交割单提示失败或解析为 0 条',
            desc: '确认文件来自同花顺导出的对账单或交割单（.csv / .xlsx / .xls，≤10MB），并先在软件中创建账户。',
          },
          {
            term: 'Agent 无法发送消息',
            desc: '尚未配置模型。发送时会提示并自动弹出 Model 管理，添加模型后务必「设为默认」。',
          },
          {
            term: '双击没有进入个股详情整页',
            desc: '整页详情需要能识别到标的代码；从本软件的表格、卡片、搜索结果进入的标的都已规范化，手工输入时建议先在搜索弹窗里选中。',
          },
          {
            term: '排查报错',
            desc: '在设置里开启「日志采集」，然后到「设置 → 系统日志 → 查看」按时间与关键字检索报错与操作记录。',
          },
          {
            term: '数据与免责声明',
            desc: '行情来自公开数据接口，仅供个人学习参考，不构成任何投资建议；数据可能存在延迟、缺失或口径差异，请以券商行情为准。',
          },
        ],
      },
    ],
  },
];

/* -------------------------------- 关键字搜索 -------------------------------- */

/** 搜索索引条目：白皮书中一处可定位的文本 */
interface GuideSearchDoc {
  /** 索引序号（唯一，用于判断当前键盘选中项） */
  index: number;
  /** 所属章节 id（跳转锚点） */
  chapterId: string;
  /** 所属章节标题（结果分组标题） */
  chapterTitle: string;
  /** 所属内容块在章节内的下标（-1 表示章节级：标题 / 引导语） */
  blockIndex: number;
  /** 结果来源标签，如「步骤 2」「Ctrl + Shift + B」 */
  label: string;
  /** 完整原文（匹配与摘要都基于它） */
  text: string;
}

/** 搜索结果条目：索引条目 + 命中摘要 */
interface GuideSearchHit extends GuideSearchDoc {
  /** 命中摘要（高亮分段） */
  snippet: HighlightSegment[];
}

/** 搜索结果分组（按章节归拢，保持文档顺序） */
interface GuideSearchGroup {
  /** 章节 id */
  chapterId: string;
  /** 章节标题 */
  chapterTitle: string;
  /** 该章节命中的条目 */
  hits: GuideSearchHit[];
}

/** 单章最多展示的命中条目数（避免一章吃掉整块面板） */
const HITS_PER_CHAPTER = 6;

/** 结果总条数上限（宽泛词如「的」不至于产生上千个 DOM 节点） */
const HITS_TOTAL_LIMIT = 60;

/**
 * 构建搜索索引：章节标题 / 引导语 / 内容块逐个拆条
 *
 * 表格按行拆（快捷键表最需要按「Ctrl + xxx」直达），名词解释把 term 与 desc 合成一条。
 * @returns 扁平索引（顺序即文档顺序）
 */
const buildSearchDocs = (): GuideSearchDoc[] => {
  const docs: GuideSearchDoc[] = [];
  for (const chapter of GUIDE_CHAPTERS) {
    const base = { chapterId: chapter.id, chapterTitle: chapter.title };
    docs.push({ ...base, index: docs.length, blockIndex: -1, label: '章节', text: chapter.title });
    if (chapter.intro) {
      docs.push({ ...base, index: docs.length, blockIndex: -1, label: '引导语', text: chapter.intro });
    }

    chapter.blocks.forEach((block, blockIndex) => {
      /**
       * 追加一条索引
       * @param label 来源标签
       * @param text 完整原文
       */
      const push = (label: string, text: string): void => {
        docs.push({ ...base, index: docs.length, blockIndex, label, text });
      };

      if (block.type === 'text') {
        push('正文', block.text);
      } else if (block.type === 'list') {
        block.items.forEach((item, i) => push(`要点 ${i + 1}`, item));
      } else if (block.type === 'steps') {
        block.items.forEach((item, i) => push(`步骤 ${i + 1}`, item));
      } else if (block.type === 'defs') {
        block.items.forEach((item) => push(`名词 · ${item.term}`, `${item.term}：${item.desc}`));
      } else if (block.type === 'tip') {
        push('提示', block.text);
      } else {
        block.rows.forEach((row) => push(row[0] ?? '表格', row.join(' · ')));
      }
    });
  }
  return docs;
};

/** 搜索索引（静态文档，构建一次） */
const SEARCH_DOCS: GuideSearchDoc[] = buildSearchDocs();

/** 搜索关键字（输入框绑定） */
const searchKeyword = ref('');

/** 输入区是否聚焦（控制结果面板显隐；面板内已阻止默认 mousedown，滚动不会误关） */
const searchFocused = ref(false);

/** 当前键盘选中的索引序号（↑↓ 移动，默认第一条） */
const activeDocIndex = ref(0);

/** 结果面板最大高度（px，按视口实测，超出则面板内滚动） */
const panelMaxHeight = ref(360);

/** 结果面板元素引用（量取可用高度用） */
const searchPanelRef = ref<HTMLElement | null>(null);

/** 搜索输入框引用（选中结果后主动失焦用） */
const searchInputRef = ref<HTMLInputElement | null>(null);

/** 正在闪烁提示的章节 id（定位后短暂高亮） */
const flashChapterId = ref('');

/** 闪烁计时器 */
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** 词条（空白分词、小写化） */
const searchTerms = computed<string[]>(() => parseQuery(searchKeyword.value));

/** 是否处于搜索态 */
const isSearching = computed<boolean>(() => searchTerms.value.length > 0);

/** 是否显示结果面板（聚焦 + 有关键字） */
const showSearchPanel = computed<boolean>(() => searchFocused.value && isSearching.value);

/** 全量命中分组（未截断，用于统计总数） */
const allSearchGroups = computed<GuideSearchGroup[]>(() => {
  const terms = searchTerms.value;
  if (terms.length === 0) return [];

  const groups: GuideSearchGroup[] = [];
  const byChapter = new Map<string, GuideSearchGroup>();
  for (const doc of SEARCH_DOCS) {
    if (!matchAll(doc.text, terms) && !matchAll(doc.label, terms)) continue;
    let group = byChapter.get(doc.chapterId);
    if (!group) {
      group = { chapterId: doc.chapterId, chapterTitle: doc.chapterTitle, hits: [] };
      byChapter.set(doc.chapterId, group);
      groups.push(group);
    }
    group.hits.push({ ...doc, snippet: buildSnippet(doc.text, terms) });
  }
  return groups;
});

/** 命中总条数 */
const searchHitCount = computed<number>(() =>
  allSearchGroups.value.reduce((sum, group) => sum + group.hits.length, 0),
);

/** 展示用分组（每章截断 + 总量截断） */
const searchGroups = computed<GuideSearchGroup[]>(() => {
  const groups: GuideSearchGroup[] = [];
  let shown = 0;
  for (const group of allSearchGroups.value) {
    if (shown >= HITS_TOTAL_LIMIT) break;
    const hits = group.hits.slice(0, Math.min(HITS_PER_CHAPTER, HITS_TOTAL_LIMIT - shown));
    shown += hits.length;
    groups.push({ ...group, hits });
  }
  return groups;
});

/** 展示中的结果扁平序列（键盘上下移动与计数用） */
const flatHits = computed<GuideSearchHit[]>(() =>
  searchGroups.value.flatMap((group) => group.hits),
);

/**
 * 内容块锚点 id（搜索结果精确跳到具体段落）
 * @param chapterId 章节 id
 * @param blockIndex 块下标
 * @returns 锚点 id
 */
const blockAnchorId = (chapterId: string, blockIndex: number): string =>
  `wp-${chapterId}-b${blockIndex}`;

/**
 * 按视口实测结果面板可用高度：面板顶到视口底减去呼吸位
 *
 * 目录卡片是 sticky 的，贴顶后该值稳定；未贴顶时算出的是偏小的保守值，不会溢出视口。
 */
const syncPanelMaxHeight = (): void => {
  const element = searchPanelRef.value;
  if (!element) return;
  const top = element.getBoundingClientRect().top;
  panelMaxHeight.value = Math.max(180, Math.round(window.innerHeight - top - 16));
};

/** 清空搜索并收起面板 */
const clearSearch = (): void => {
  searchKeyword.value = '';
  searchFocused.value = false;
};

/**
 * 跳到某条命中结果：滚到对应内容块（章节级则滚到卡片）并短暂高亮章节
 * @param hit 命中条目
 */
const jumpToHit = (hit: GuideSearchHit): void => {
  activeChapterId.value = hit.chapterId;
  const target =
    hit.blockIndex >= 0
      ? (document.getElementById(blockAnchorId(hit.chapterId, hit.blockIndex)) ??
        document.getElementById(hit.chapterId))
      : document.getElementById(hit.chapterId);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  flashChapterId.value = hit.chapterId;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashChapterId.value = '';
  }, 1400);

  // 选中后清空并失焦：面板与目录一起收起，视线直接落到定位处；再点输入框可重新搜索
  clearSearch();
  searchInputRef.value?.blur();
};

/**
 * 搜索框键盘操作：↑↓ 移动、Enter 跳转、Esc 清空
 * @param event 键盘事件
 */
const onSearchKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    // 阻止冒泡：避免同时触发全局 Esc（关闭个股详情面板等）
    event.stopPropagation();
    clearSearch();
    return;
  }
  if (!showSearchPanel.value) return;

  const hits = flatHits.value;
  if (hits.length === 0) return;
  // activeDocIndex 可能已不在当前结果集里（键盘未动过），findIndex 返回 -1 时按第一条算
  const current = Math.max(
    hits.findIndex((hit) => hit.index === activeDocIndex.value),
    0,
  );

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = hits[(current + step + hits.length) % hits.length];
    if (next) activeDocIndex.value = next.index;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const hit = hits[current];
    if (hit) jumpToHit(hit);
  }
};

// 词条变化后把键盘选中项重置到第一条（结果集变了，旧下标会指到别处）
watch(searchTerms, () => {
  activeDocIndex.value = flatHits.value[0]?.index ?? 0;
});

// 输入即视为「要搜索」：Esc 收起面板后输入框仍聚焦（不会再触发 focusin），
// 若只看焦点状态，用户直接接着打字就会「面板打不开」。
watch(searchKeyword, (value) => {
  if (value.trim().length > 0) searchFocused.value = true;
});

// 面板展开后量一次可用高度；命中数变化（内容变长）也重算
watch([showSearchPanel, () => flatHits.value.length], () => {
  if (!showSearchPanel.value) return;
  void nextTick(syncPanelMaxHeight);
});

/** 当前高亮的章节 id（目录高亮 + 点击后立即反馈） */
const activeChapterId = ref<string>(GUIDE_CHAPTERS[0]?.id ?? '');

/** 章节滚动观察器（视口相交驱动目录高亮） */
let chapterObserver: IntersectionObserver | null = null;

/**
 * 跳到指定章节
 * @param id 章节锚点 id
 */
const scrollToChapter = (id: string): void => {
  activeChapterId.value = id;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

onMounted(() => {
  window.addEventListener('resize', syncPanelMaxHeight);
  if (typeof IntersectionObserver === 'undefined') return;
  chapterObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) activeChapterId.value = entry.target.id;
      }
    },
    // 上边距内缩、下边距大幅内缩：以「章节标题刚进入上部可视区」为判定点
    { rootMargin: '-72px 0px -70% 0px', threshold: 0 },
  );
  for (const chapter of GUIDE_CHAPTERS) {
    const element = document.getElementById(chapter.id);
    if (element) chapterObserver.observe(element);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncPanelMaxHeight);
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
  chapterObserver?.disconnect();
  chapterObserver = null;
});
</script>

<template>
  <div class="space-y-4">
    <!-- 文档头：标题 + 版本 + 阅读建议 -->
    <BaseCard>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-text">软件白皮书</h2>
          <p class="mt-1 max-w-3xl text-sm leading-6 text-text-secondary">
            全站功能说明与看盘口径：每个页面能做什么、每个按钮和开关管什么、数据怎么读、限制在哪里。
            新用户建议按左侧目录顺序读一遍；老用户可直接按目录跳到需要的章节。
          </p>
        </div>
        <BaseTag tone="primary">v{{ APP_VERSION }}</BaseTag>
      </div>
    </BaseCard>

    <NoticeBar
      text="本文档描述的是当前版本的实际行为。行情数据来自公开接口，可能存在延迟或缺失；软件只提供数据与统计口径，不构成投资建议。"
    />

    <div class="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
      <!-- 目录：宽屏固定左侧，窄屏隐藏（正文按顺序阅读即可） -->
      <nav class="hidden lg:block">
        <div class="sticky top-0 z-20 space-y-1 rounded-card bg-surface p-3 shadow-card">
          <!-- 关键字搜索：结果面板浮在目录之上，最大高度贴着视口底，超出面板内滚动 -->
          <div class="relative" @focusin="searchFocused = true" @focusout="searchFocused = false">
            <MenuIcon
              name="search"
              :size="14"
              class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
            />
            <input
              ref="searchInputRef"
              v-model="searchKeyword"
              type="text"
              class="w-full rounded-lg bg-flat-weak py-1.5 pl-8 pr-7 text-xs text-text outline-none transition-colors placeholder:text-text-tertiary focus:ring-1 focus:ring-primary"
              placeholder="搜索关键字"
              aria-label="搜索白皮书"
              @keydown="onSearchKeydown"
            />
            <button
              v-if="isSearching"
              type="button"
              class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-tertiary hover:text-text"
              aria-label="清空搜索"
              @mousedown.prevent="clearSearch"
            >
              <MenuIcon name="close" :size="12" />
            </button>

            <div
              v-if="showSearchPanel"
              ref="searchPanelRef"
              class="absolute left-0 top-full z-30 mt-1 w-[min(30rem,calc(100vw-3rem))] overflow-y-auto overscroll-contain rounded-card border border-flat-weak bg-surface py-1 shadow-card"
              :style="{ maxHeight: `${panelMaxHeight}px` }"
              data-wp-search-panel
              @mousedown.prevent
            >
              <p v-if="flatHits.length === 0" class="px-3 py-3 text-xs text-text-tertiary">
                没有找到「{{ searchKeyword.trim() }}」相关内容
              </p>
              <template v-else>
                <div v-for="group in searchGroups" :key="group.chapterId" class="mt-0.5 first:mt-0">
                  <p
                    class="px-3 py-1 text-[11px] font-medium text-text-tertiary"
                    :data-wp-group="group.chapterId"
                  >
                    {{ group.chapterTitle }}
                  </p>
                  <button
                    v-for="hit in group.hits"
                    :key="hit.index"
                    type="button"
                    class="pressable flex w-full flex-col gap-0.5 px-3 py-1.5 text-left active:scale-[0.99]"
                    :class="
                      hit.index === activeDocIndex
                        ? 'bg-primary-weak'
                        : 'hover:bg-flat-weak'
                    "
                    :data-wp-hit="hit.index"
                    :data-wp-target="
                      hit.blockIndex >= 0 ? blockAnchorId(hit.chapterId, hit.blockIndex) : hit.chapterId
                    "
                    @click="jumpToHit(hit)"
                  >
                    <span class="text-[11px] font-medium text-primary" data-wp-hit-label>{{ hit.label }}</span>
                    <span class="text-xs leading-5 text-text-secondary">
                      <template v-for="(segment, segIndex) in hit.snippet" :key="segIndex">
                        <mark
                          v-if="segment.hit"
                          class="rounded-[3px] bg-primary/20 px-0.5 text-text"
                        >{{ segment.text }}</mark>
                        <template v-else>{{ segment.text }}</template>
                      </template>
                    </span>
                  </button>
                </div>
                <p
                  v-if="searchHitCount > flatHits.length"
                  class="px-3 py-1.5 text-[11px] text-text-tertiary"
                >
                  共 {{ searchHitCount }} 条，仅显示前 {{ flatHits.length }} 条，输入更具体的关键字可缩小范围
                </p>
              </template>
            </div>
          </div>

          <!--
            目录列表在搜索态下**不卸载**：这 17 个按钮 v-if 增删会让左列高度突变，
            实测会打断跳转时的平滑滚动（滚到半路停住）。故只切换下面这行文案。
          -->
          <p class="px-2 pb-1 pt-1 text-xs font-medium text-text-tertiary">
            {{ isSearching ? `${searchHitCount} 条结果 · Esc 退出搜索` : '目录' }}
          </p>
          <button
            v-for="chapter in GUIDE_CHAPTERS"
            :key="chapter.id"
            type="button"
            class="pressable flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs active:scale-[0.98]"
            :class="
              activeChapterId === chapter.id
                ? 'bg-primary-weak font-medium text-primary'
                : 'text-text-secondary hover:bg-flat-weak hover:text-text'
            "
            @click="scrollToChapter(chapter.id)"
          >
            <MenuIcon :name="chapter.icon" :size="14" class="shrink-0" />
            <span class="truncate">{{ chapter.title }}</span>
          </button>
        </div>
      </nav>

      <!-- 正文：章节卡片 -->
      <div class="space-y-4">
        <BaseCard
          v-for="chapter in GUIDE_CHAPTERS"
          :id="chapter.id"
          :key="chapter.id"
          :title="chapter.title"
          class="transition-shadow duration-500"
          :class="flashChapterId === chapter.id ? 'ring-2 ring-primary' : ''"
        >
          <template #extra>
            <BaseTag tone="flat">{{ chapter.tag }}</BaseTag>
          </template>

          <p
            v-if="chapter.intro"
            class="mb-3 text-sm leading-6 text-text-secondary"
          >
            {{ chapter.intro }}
          </p>

          <div class="space-y-4">
            <template v-for="(block, index) in chapter.blocks" :key="index">
              <!-- 段落 -->
              <p
                v-if="block.type === 'text'"
                :id="blockAnchorId(chapter.id, index)"
                class="scroll-mt-16 text-sm leading-6 text-text-secondary"
              >
                {{ block.text }}
              </p>

              <!-- 要点列表 -->
              <ul
                v-else-if="block.type === 'list'"
                :id="blockAnchorId(chapter.id, index)"
                class="scroll-mt-16 space-y-1.5"
              >
                <li
                  v-for="item in block.items"
                  :key="item"
                  class="flex gap-2 text-sm leading-6 text-text-secondary"
                >
                  <span class="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  <span>{{ item }}</span>
                </li>
              </ul>

              <!-- 步骤列表 -->
              <ol
                v-else-if="block.type === 'steps'"
                :id="blockAnchorId(chapter.id, index)"
                class="scroll-mt-16 space-y-2"
              >
                <li
                  v-for="(item, stepIndex) in block.items"
                  :key="item"
                  class="flex gap-2.5 text-sm leading-6 text-text-secondary"
                >
                  <span
                    class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-weak text-xs font-semibold text-primary"
                  >
                    {{ stepIndex + 1 }}
                  </span>
                  <span>{{ item }}</span>
                </li>
              </ol>

              <!-- 名词解释：名称 + 说明 -->
              <dl
                v-else-if="block.type === 'defs'"
                :id="blockAnchorId(chapter.id, index)"
                class="scroll-mt-16 space-y-2"
              >
                <div
                  v-for="item in block.items"
                  :key="item.term"
                  class="grid gap-1 rounded-lg bg-flat-weak px-3 py-2 sm:grid-cols-[minmax(7rem,10rem)_1fr] sm:gap-3"
                >
                  <dt class="text-sm font-medium text-text">{{ item.term }}</dt>
                  <dd class="text-sm leading-6 text-text-secondary">
                    {{ item.desc }}
                  </dd>
                </div>
              </dl>

              <!-- 提示条 -->
              <div
                v-else-if="block.type === 'tip'"
                :id="blockAnchorId(chapter.id, index)"
                class="flex scroll-mt-16 items-start gap-2 rounded-lg bg-primary-weak px-3 py-2.5 text-xs leading-5 text-text-secondary"
              >
                <MenuIcon name="info" :size="14" class="mt-0.5 shrink-0 text-primary" />
                <p>{{ block.text }}</p>
              </div>

              <!-- 表格 -->
              <div v-else :id="blockAnchorId(chapter.id, index)" class="scroll-mt-16 overflow-x-auto">
                <table class="w-full min-w-[420px] text-left text-sm">
                  <thead>
                    <tr class="border-b border-flat-weak text-xs text-text-tertiary">
                      <th
                        v-for="head in block.head"
                        :key="head"
                        class="py-2 pr-4 font-medium"
                      >
                        {{ head }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in block.rows"
                      :key="row.join('|')"
                      class="border-b border-flat-weak last:border-0"
                    >
                      <td
                        v-for="(cell, cellIndex) in row"
                        :key="cell"
                        class="py-2 pr-4 align-top"
                        :class="cellIndex === 0 ? 'text-text' : 'text-text-secondary'"
                      >
                        {{ cell }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </BaseCard>
      </div>
    </div>
  </div>
</template>
