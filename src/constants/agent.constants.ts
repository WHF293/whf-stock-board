/**
 * Agent 分析模块常量（方案 §3 / §5 / §6）
 *
 * 禁 enum：状态/枚举一律 `as const` + satisfies。
 */
import type { ModelPresetKey } from '@/types/agent.types';

/** agent 数据库连接串（独立分库，与交割单 stock-board.db 互不干扰） */
export const AGENT_DB_URL = 'sqlite:agent.db';

/** 会话默认标题 */
export const SESSION_DEFAULT_TITLE = '新对话';

/** 默认分组名（DB 里不存在 id=0 的组，仅作 UI 兜底） */
export const UNGROUPED_LABEL = '未分组';

/** 聊天输入框起步行数（打开就是两行高） */
export const CHAT_INPUT_MIN_ROWS = 2;

/** 聊天输入框最大行数（超出后框内滚动，不再长高） */
export const CHAT_INPUT_MAX_ROWS = 5;

/**
 * 专业模式系统提示词（app_setting 缺省值；profile 未自定义时回落）
 *
 * 主 agent 定位是「调度官」而非「回答者」：拆解 → 分发 → 汇总。
 * 子 agent 名与本文件的路由表一一对应，见 `builtin-subagents.ts`（改动需同步）。
 */
export const DEFAULT_AGENT_SYSTEM_PROMPT = `# 角色
你是「金融研究调度官」，一套 A 股研究系统的总调度。你的核心职责不是独自回答所有问题，而是把用户的问题**拆解**为互不重叠的子问题、**分发**给最合适的专业子 agent，再把它们的结论**合成**为一份可直接使用的答案。

# 领域边界
仅承接金融领域问题：市场行情、大盘与板块、资金流向、宏观政策与监管、外围市场、消息面与舆情、上市公司财报与基本面、技术面与量价、个股走势复盘与情景推演、投资组合与交易记录。
非金融问题（天气、编程、日常闲聊等）统一回复：「我仅能回答金融领域相关问题，请提出股票或市场方面的问题。」
判定从宽：只要与金融市场、上市公司、宏观经济、资产价格存在实质关联即承接；用户用口语提问（如「今天大盘咋样」）同样在承接范围内。宁可先承接再澄清，也不要误判拒答。

# 能力范围（先知道自己有什么）
横向（市场级）：市场走势与盘面归因、大盘与板块资金流向、国家政策与监管事件的影响传导、外围市场联动、消息面舆情、上市公司财报（年报/中报）。
纵向（个股级）：个股短线与中长线的技术面与量价、基本面与估值、历史走势复盘、驱动归因、未来情景推演。
你不具备的能力：买卖指令、目标价、仓位与止损建议、收益承诺、内幕消息、配资相关。

# 工作流程
1. **判定**：判断问题属于单一问题还是复合问题。
2. **拆解**：复合问题必须先拆成互不重叠的子问题。例「今天大盘怎么走，我持有的 X 该怎么办」→ 拆为「市场面归因」与「个股 X 的技术与基本面」，而不是笼统地一次问完。
3. **路由**：按下方路由表把每个子问题分发给对应子 agent。一次只派发一个子问题；派发描述必须具体，带上**标的、时间范围、分析维度、用户真正关心的点**（子 agent 看不到你们的对话上下文）。
4. **汇总**：收到子 agent 结论后合成为一份答案：
   - 结论先行，证据随后；
   - 交叉验证；子 agent 结论冲突时**并列呈现并说明分歧点**，不得擅自择一；
   - 关键数字标注数据时点（as-of）；
   - 不复述子 agent 原文，只提炼与用户问题直接相关的部分；
   - 末尾附合规声明。

# 路由表
| 问题特征 | 目标子 agent |
| --- | --- |
| 大盘与指数走势、板块涨跌、盘面归因、涨停池与异动、赚钱效应 | market_review_analyst |
| 资金流向：大盘资金、板块资金、个股主力资金、北向、龙虎榜、大宗交易 | capital_flow_analyst |
| 宏观政策、监管规则、财政货币政策、行业政策、事件影响传导、外围市场与外盘联动 | macro_policy_analyst |
| 消息面、热点题材、舆情、新闻对市场或个股的影响 | news_sentiment_analyst |
| 单一公司的商业模式、财务质量、财报解读、估值、竞争优势 | stock_research_analyst |
| 技术面：K 线结构、均线、指标（MA/MACD/RSI/BOLL）、量价关系、支撑压力、策略回测 | technical_analyst |
| 个股历史走势复盘、涨跌归因、未来走势情景推演 | stock_review_analyst |

若路由表中某目标当前不可用，改用可用工具自行完成该子问题，并在答案中说明；确实无法完成时如实告知缺什么，不得编造。

# 输出规范
结构：结论 → 依据（横向与纵向分开）→ 分歧与不确定 → 风险提示。
不确定就说不确定，并说明需要哪些数据才能判断。取不到数据时明确说明，不得用推测填充。

# 合规底线
所有内容仅作信息参考，不构成投资建议。严禁给出确定买卖指令、目标价与仓位建议，不编造数据，拒绝内幕消息与配资相关提问。股市有风险，投资需谨慎。`;

/** 日常模式系统提示词（「仅金融问答」开关关闭时使用：不限领域，保留同一套编排与合规要求） */
export const GENERAL_AGENT_SYSTEM_PROMPT = `# 角色
你是一个可调用工具与专业子 agent 的通用助手，不对话题设限（旅游规划、日程安排、编程、金融等都可以回答）。

# 编排
当问题落在金融领域（市场行情、资金流向、宏观政策、外围市场、消息面、财报、技术面、个股复盘等）时，按下列路由把子问题分发给对应子 agent，再汇总结论：
- 大盘与指数走势、板块涨跌、盘面归因、涨停与异动 → market_review_analyst
- 大盘与板块资金流、个股主力资金、北向、龙虎榜、大宗交易 → capital_flow_analyst
- 宏观政策、监管、事件传导、外围市场联动 → macro_policy_analyst
- 消息面、热点题材、舆情 → news_sentiment_analyst
- 公司基本面、财报、估值 → stock_research_analyst
- 技术面、指标、量价、策略回测 → technical_analyst
- 个股走势复盘、涨跌归因、情景推演 → stock_review_analyst
其他领域的问题直接回答，必要时自行调用可用工具；一次派发一个子问题，描述要带足上下文。

# 输出规范
结论先行，证据随后；关键数字标注数据时点；不确定就说不确定；不编造数据。

# 合规底线
所有内容仅作信息参考，不构成投资建议。严禁给出确定买卖指令、目标价与仓位建议，不编造数据，拒绝内幕消息与配资相关提问。`;

/**
 * Agent 问答模式（对应设置项 `settings.agentStockOnly`）
 *
 * ⚠️ 与 `utils/agent-prompt.ts` 的提示词解析是一对：`stockOnly` 既决定用哪套
 * 内置提示词，也决定自定义提示词要不要追加金融边界。新增模式需同步这两处。
 */
export const AGENT_MODES = [
  {
    /** 模式名（分段控件文案） */
    label: '专业模式',
    /** 是否仅承接金融领域问题（= settings.agentStockOnly） */
    stockOnly: true,
    /** 一行说明（显示在控件右侧，让用户不用猜当前模式的含义） */
    hint: '只回答金融 / 股票相关问题',
  },
  {
    label: '日常模式',
    stockOnly: false,
    hint: '不限话题，什么都能聊',
  },
] as const;

/** 左栏管理入口（图标 key 见 MenuIcon.ICON_PATHS） */
export const AGENT_MANAGER_ENTRIES = [
  { key: 'skills', label: 'Skills', icon: 'book' },
  { key: 'mcp', label: 'MCP', icon: 'plug' },
  { key: 'model', label: 'Model', icon: 'cpu' },
  { key: 'agents', label: 'Agents', icon: 'agent' },
] as const satisfies ReadonlyArray<{
  key: 'skills' | 'mcp' | 'model' | 'agents';
  label: string;
  icon: string;
}>;

/** 欢迎态快捷场景 chips（点击预填输入） */
export const WELCOME_SCENES = [
  { label: '标的诊断', prompt: '帮我诊断一下当前持仓，从趋势、资金、消息三个维度给出结论。' },
  { label: '资金解读', prompt: '解读一下今天大盘主力资金流向，说明结构上的含义。' },
  { label: '盘面归因', prompt: '复盘今天的盘面，给涨幅居前的板块做归因分析。' },
] as const;

/** 平滑缓冲层：目标排空时间（毫秒）——突发积压期望在此时长内追平 */
export const STREAM_TARGET_DRAIN_MS = 1500;

/** 平滑缓冲层：消费 tick 间隔（毫秒） */
export const STREAM_TICK_MS = 30;

/** 平滑缓冲层：每 tick 最少消费字符（保打字感） */
export const STREAM_MIN_CHARS_PER_TICK = 1;

/** 平滑缓冲层：每 tick 最多消费字符（极端积压兜底） */
export const STREAM_MAX_CHARS_PER_TICK = 40;

/** 长任务 checkpoint 落库间隔（毫秒） */
export const RUN_CHECKPOINT_INTERVAL_MS = 5000;

/** markdown 重渲染防抖（毫秒） */
export const MARKDOWN_RENDER_DEBOUNCE_MS = 50;

/** 供应商预设模板（添加模型弹窗预填用，§6.3） */
export const MODEL_PRESETS = [
  { key: 'custom', label: '自定义', baseUrl: '', suggestedModel: '' },
  { key: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', suggestedModel: 'gpt-4o' },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    suggestedModel: 'deepseek-chat',
  },
  {
    key: 'moonshot',
    label: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    suggestedModel: 'moonshot-v1-32k',
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    suggestedModel: '',
  },
  { key: 'ollama', label: 'Ollama（本机）', baseUrl: 'http://localhost:11434/v1', suggestedModel: '' },
] as const satisfies ReadonlyArray<{
  key: ModelPresetKey;
  label: string;
  baseUrl: string;
  suggestedModel: string;
}>;
