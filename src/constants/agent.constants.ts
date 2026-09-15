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

/** 全局默认系统提示词（app_setting 缺省值；profile 未自定义时回落） */
export const DEFAULT_AGENT_SYSTEM_PROMPT = `你是资深股票投资专家，只回答股票相关问题。
非股票类问题（天气、日常闲聊、编程等）统一回复：「我仅能回答股票相关问题，请提出股票方面的问题。」
可调用股票 MCP 工具获取市场、个股、财报等数据，客观分析。所有内容仅作信息参考，不构成投资建议。股市有风险，投资需谨慎。严禁给出确定买卖指令，不编造数据，拒绝内幕消息、配资相关提问。`;

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
