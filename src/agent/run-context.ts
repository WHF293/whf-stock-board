/**
 * 一次运行的上下文装配（授权 × 资源 → 主/子 agent 各自的工具与 skill）
 *
 * 这里是 R3/R4「子 agent 级权限」的**唯一落地点**：把
 * `resource_scope`（启用 + 全部/精确）+ `resource_grant`（精确到哪个 agent）
 * 翻译成 deepagents 需要的三个入参：
 * - `tools`：主 agent 可用工具（按 server 分组过滤后拍平）；
 * - `subagentTools`：每个子 agent 自己的工具子集（**逐个都写**，缺项会继承全量）；
 * - `skills` / `skillPathByName` / `skillFiles`：skill 虚拟文件系统与各 agent 的声明列表。
 *
 * 三个关键取舍（改动前请先想清楚）：
 *
 * 1. **虚拟文件是全量并集，声明列表才是权限边界。**
 *    SkillsMiddleware 把 `skills` sources 里的 name/description 注入提示词，模型据此
 *    决定读哪份 SKILL.md。因此「某 agent 该知道哪些 skill」由各自的 `skills` 列表决定；
 *    而 `files` 里放的是「至少有一个 agent 被授权的 skill 并集」——放多了等于对子 agent
 *    留了个可以主动读到的后门（软边界）。真正对**所有人**关闭的 skill 连文件都不给。
 *
 * 2. **子 agent 一律显式给工具子集，不给 `undefined`。**
 *    `toSubAgents` 里 `subagentTools.get(id) ?? fallbackTools` 的兜底是「继承主 agent 全量」，
 *    这在授权语义下是危险的默认值（漏配 = 全开）。所以每个参与运行的子 agent 都必须有 Map 项，
 *    哪怕是空数组（= 无工具）。
 *
 * 3. **profile 里的 mcpIds / skillIds 不参与装配。**
 *    它们是历史字段（当时资源没有 id），现在授权只有一个事实源即 resource_grant；
 *    再读它们就会出现「两处都能勾、两处不一致」的经典问题。
 *
 * 4. **对话级强制包含（forced）只放宽授权，不放宽启停。**
 *    输入框 + 菜单显式勾选的资源以 `forcedMcpIds` / `forcedSkillIds` 传入：
 *    绕过 scope/grant 判定（用户显式选择 > 配置层授权），但停用的资源压根不进
 *    server 分组 / 不装载，勾了也无效。forced MCP 只并入主 agent；forced skill
 *    只进主 agent 的声明列表——子 agent 各自的工具与 skill 口径不变。
 */
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { McpRuntime, McpToolEventSink } from '@/agent/mcp/types';
import { buildSkillFileBundle, resolveSkillPaths } from '@/utils/agent-skill-files';
import type { SkillFileBundle } from '@/utils/agent-skill-files';
import { loadSkillSources, type LoadedSkill } from '@/utils/agent-skill-loader';
import type { VirtualFileData } from '@/agent/create-agent';
import {
  MAIN_AGENT_ID,
  buildAccessContext,
  canUseResource,
  isResourceEnabled,
  type AccessContext,
} from '@/utils/resource-access';
import { listResourceGrants, listResourceScopes } from '@/composables/use-agent-db';
import type { Skill, SubagentDef } from '@/types/agent.types';

/** 装配入参 */
export interface BuildRunContextParams {
  /** MCP 运行时（内置 + 已启用远端） */
  runtime: McpRuntime;
  /** 工具事件接收器（写消息 parts 的工具卡） */
  sink: McpToolEventSink;
  /** 本次参与运行的子 agent（已按 profile.subagentIds 解析） */
  subagents: readonly SubagentDef[];
  /** DB 里的用户 skill 列表（用于读盘装载） */
  userSkills: readonly Skill[];
  /**
   * 对话级强制包含的 MCP server 资源 id（输入框 + 菜单显式勾选）
   *
   * 绕过 scope/grant 判定（用户显式选择 > 配置层授权），但**不绕过 enabled**——
   * 停用的服务器不进 server 分组，勾了也无效。只并入主 agent，不扩给子 agent。
   */
  forcedMcpIds?: readonly number[];
  /**
   * 对话级强制包含的 skill 资源 id（同上；只进主 agent 的声明列表，
   * 子 agent 的 skillNames 仍按其自身授权收敛）
   */
  forcedSkillIds?: readonly number[];
}

/** 一次运行可用的资源全集（直接喂给 startAgentRun） */
export interface RunContext {
  /** 主 agent 工具集 */
  tools: StructuredToolInterface[];
  /** 子 agent id → 该子 agent 的工具子集（每个子 agent 都有键） */
  subagentTools: Map<number, StructuredToolInterface[]>;
  /** 子 agent 定义（skillNames 已按授权收敛后的副本） */
  subagents: SubagentDef[];
  /** 主 agent 可见的 skill 目录列表 */
  skills: string[];
  /** skill 名 → 虚拟目录路径（子 agent 按 skillNames 映射） */
  skillPathByName: Map<string, string>;
  /** 虚拟 skill 文件（至少有一个 agent 被授权的并集） */
  skillFiles: Record<string, VirtualFileData>;
}

/**
 * 资源是否对某 agent 开放（缺范围行时按「启用」处理）
 *
 * 启用状态的三个来源各有分工，这里 fallback 统一传 true，避免多处判启用造成语义分裂：
 * - 用户 skill：装载阶段只装 `enabled` 的（文件都不进虚拟 FS）；
 * - 远端 MCP：连接阶段只连 `enabled` 的（压根不进 server 分组）；
 * - 内置 MCP / 内置 skill：没有自己的表，启用状态就写在范围行的 `enabled` 上，
 *   由下面 `canUseResource` 的 `isResourceEnabled` 直接读到（缺行 = 启用）。
 *
 * @param ctx 访问上下文
 * @param kind 资源类型
 * @param id 资源 id
 * @param agentKind agent 类型
 * @param agentId agent id
 * @returns 是否开放
 */
const open = (
  ctx: AccessContext,
  kind: 'mcp' | 'skill',
  id: number,
  agentKind: 'main' | 'subagent',
  agentId: number,
): boolean => canUseResource(ctx, kind, id, agentKind, agentId, true);

/**
 * 装配一次运行的上下文
 *
 * 任何一步失败都不抛：授权读库失败 → 退化为「全部可用」（与历史行为一致，
 * 宁可多给工具也不要让整个对话卡死）；skill 装载失败 → 只丢用户 skill。
 *
 * @param params 装配入参
 * @returns 运行上下文
 */
export const buildRunContext = async (params: BuildRunContextParams): Promise<RunContext> => {
  const { runtime, sink, userSkills } = params;
  /** 对话级强制包含（+ 菜单勾选）的 MCP / skill 资源 id 集合 */
  const forcedMcp = new Set(params.forcedMcpIds ?? []);
  const forcedSkill = new Set(params.forcedSkillIds ?? []);

  // --- 授权上下文（读库失败 → 空范围 + 空授权 = 全部开放，与旧行为对齐） ---
  let ctx: AccessContext = { scopes: new Map(), grants: new Map() };
  try {
    const [scopes, grants] = await Promise.all([listResourceScopes(), listResourceGrants()]);
    ctx = buildAccessContext(scopes, grants);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[agent] 读取资源授权失败，本次按「全部可用」装配：' + message);
  }

  // --- 停用的子 agent 直接剔除：不进派发清单，也不参与 skill 收敛 ---
  // 内置（id<0）的启停只在 resource_scope 里（库里无 subagent 行）→ fallback 恒 true；
  // 用户 subagent 的启停读自身 enabled 列。两者合成一个表达式，避免两处判据漂移。
  const subagents = params.subagents.filter((subagent) =>
    isResourceEnabled(ctx, 'subagent', subagent.id, subagent.id < 0 ? true : subagent.enabled),
  );

  // --- MCP：按 server 分组过滤（只用分组版，避免 createTools 的重复注册副作用） ---
  const groups = runtime.createToolsByServer(sink);
  const tools: StructuredToolInterface[] = [];
  const subagentTools = new Map<number, StructuredToolInterface[]>();
  for (const subagent of subagents) {
    subagentTools.set(subagent.id, []);
  }
  for (const group of groups) {
    const groupTools = group.tools as StructuredToolInterface[];
    // forced：对话级强制包含只并入主 agent；子 agent 的工具仍按其自身授权
    if (
      forcedMcp.has(group.resourceId) ||
      open(ctx, 'mcp', group.resourceId, 'main', MAIN_AGENT_ID)
    ) {
      tools.push(...groupTools);
    }
    for (const subagent of subagents) {
      if (open(ctx, 'mcp', group.resourceId, 'subagent', subagent.id)) {
        subagentTools.get(subagent.id)!.push(...groupTools);
      }
    }
  }

  // --- Skill：装载 → 按授权收敛声明列表 ---
  const loaded: LoadedSkill[] = await loadSkillSources(userSkills);
  const mainSkillNames: string[] = [];
  /** 至少有一个 agent 被授权的 skill 名（决定虚拟文件里放哪些） */
  const liveSkillNames = new Set<string>();
  const visibleToSubagent = new Map<number, Set<string>>();

  for (const skill of loaded) {
    // forced：对话级强制包含只给主 agent 声明（虚拟文件并集随 anyone 自动覆盖）
    const forced = forcedSkill.has(skill.resourceId);
    const mainOk = forced || open(ctx, 'skill', skill.resourceId, 'main', MAIN_AGENT_ID);
    if (mainOk) mainSkillNames.push(skill.source.name);
    let anyone = mainOk;
    for (const subagent of subagents) {
      if (!open(ctx, 'skill', skill.resourceId, 'subagent', subagent.id)) continue;
      anyone = true;
      const set = visibleToSubagent.get(subagent.id) ?? new Set<string>();
      set.add(skill.source.name);
      visibleToSubagent.set(subagent.id, set);
    }
    if (anyone) liveSkillNames.add(skill.source.name);
  }

  const bundle: SkillFileBundle = buildSkillFileBundle(
    loaded.filter((skill) => liveSkillNames.has(skill.source.name)).map((skill) => skill.source),
  );

  // --- 子 agent 定义副本：skillNames 收敛到「既声明又被授权」 ---
  const scopedSubagents: SubagentDef[] = subagents.map((subagent) => {
    const allowed = visibleToSubagent.get(subagent.id);
    if (!allowed) return { ...subagent, skillNames: [] };
    return {
      ...subagent,
      skillNames: subagent.skillNames.filter((name) => allowed.has(name)),
    };
  });

  return {
    tools,
    subagentTools,
    subagents: scopedSubagents,
    skills: resolveSkillPaths(mainSkillNames, bundle.pathByName),
    skillPathByName: bundle.pathByName,
    skillFiles: bundle.files,
  };
};
