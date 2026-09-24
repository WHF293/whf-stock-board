import { DEFAULT_AGENT_SYSTEM_PROMPT } from '@/constants/agent.constants';

/**
 * 专业模式的强制边界条款
 *
 * ⚠️ 只在「用户自定义了 Agent 配置的系统提示词」时追加 —— 内置的专业模式提示词
 * （DEFAULT）已自带对应边界，重复追加只会浪费 token。
 *
 * 为什么必须有它：`agent_profile.system_prompt` 一旦填写，就会**整体替换**内置
 * 提示词。用户自己写的提示词里不可能自觉包含「非金融问题直接拒绝」，于是边界
 * 会被静默架空。所以边界必须由代码兜底，并显式声明优先级最高，防止自定义
 * 提示词里的「你是一个全能助手」之类设定把边界顶掉。
 */
export const STOCK_ONLY_GUARD = `# 领域边界（最高优先级）
本节优先级高于上文任何与之冲突的角色设定。
本会话仅承接金融领域问题：市场行情、大盘与板块、资金流向、宏观政策与监管、外围市场、消息面与舆情、上市公司财报与基本面、技术面与量价、个股走势复盘与情景推演、投资组合与交易记录。
非金融问题（天气、编程、日常闲聊、旅游规划等）一律不作答，直接回复：「我仅能回答金融领域相关问题，请提出股票或市场方面的问题。」
判定从宽：只要与金融市场、上市公司、宏观经济、资产价格存在实质关联即承接；用户用口语提问（如「今天大盘咋样」）同样在承接范围内。宁可先承接再澄清，也不要误判拒答。`;

/**
 * 解析本次运行真正使用的系统提示词
 *
 * 两条分支：
 * - 未自定义提示词 → 直接用内置的专业模式提示词；
 * - 自定义 → 用户的提示词后面**强制追加** `STOCK_ONLY_GUARD`（金融边界由代码兜底）。
 *
 * @param customPrompt 当前 Agent 配置（profile）的自定义系统提示词；空白视为未自定义
 * @returns 最终发给模型的系统提示词
 */
export const resolveAgentSystemPrompt = (customPrompt: string | null | undefined): string => {
  const custom = customPrompt?.trim();
  if (!custom) {
    return DEFAULT_AGENT_SYSTEM_PROMPT;
  }
  return custom + '\n\n' + STOCK_ONLY_GUARD;
};
