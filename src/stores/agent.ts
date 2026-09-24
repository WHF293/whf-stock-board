/**
 * Agent 分析页面状态（pinia）
 *
 * 职责：会话树/分组的内存态 + 落库同步；当前会话；左栏角标计数；
 * 运行中会话 id 集合（M3 由 RunRegistry 驱动，此处先留展示位）。
 * 不持有消息内容——消息按需经 use-agent-db 按 session_id 读取。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as db from '@/composables/use-agent-db';
import type {
  AgentProfile,
  ChatGroup,
  ChatSession,
  GrantResourceKind,
  McpServer,
  ModelConfig,
  Skill,
  SubagentDef,
} from '@/types/agent.types';
import { withBuiltinSubagents } from '@/constants/builtin-subagents';
import { resourceKey } from '@/utils/resource-access';

export const useAgentStore = defineStore('agent', () => {
  /* --------------------------------- 状态 --------------------------------- */

  /** 分组列表（已排序） */
  const groups = ref<ChatGroup[]>([]);
  /** 全量会话（已排序） */
  const sessions = ref<ChatSession[]>([]);
  /** 当前会话 id */
  const currentSessionId = ref<number | null>(null);
  /** 左栏角标计数 */
  const counts = ref<db.AgentCounts>({ models: 0, profiles: 0, skills: 0, mcps: 0 });
  /** 页面级侧栏收起（桌面端，独立于全局侧栏状态） */
  const sidebarCollapsed = ref(false);
  /** 是否已从 DB 初始化 */
  const initialized = ref(false);

  /** 模型配置列表 */
  const models = ref<ModelConfig[]>([]);
  /** Skill 列表 */
  const skills = ref<Skill[]>([]);
  /** MCP 服务器列表 */
  const mcps = ref<McpServer[]>([]);
  /** Agent 配置列表 */
  const profiles = ref<AgentProfile[]>([]);
  /** subagent 定义列表 */
  const subagents = ref<SubagentDef[]>([]);

  /**
   * 内置资源（mcp / skill / subagent，负数 id）的启用状态
   *
   * 内置资源是源码常量、库里没有自己的行，启停只能落在 `resource_scope.enabled`。
   * 这里缓存一份，免得列表里每个开关都去查库。键见 `resourceKey`（形如 `mcp:-3`）。
   *
   * ⚠️ 用户资源的启用状态**不在这里**：它们读各自实体的 `enabled` 字段
   * （skill.enabled / mcp_server.enabled / subagent.enabled），两轨不要混。
   */
  const builtinEnabled = ref<Record<string, boolean>>({});

  /* --------------------------------- 计算属性 -------------------------------- */

  /** 默认模型（无默认取首个；都没有 = null） */
  const defaultModel = computed<ModelConfig | null>(
    () => models.value.find((m) => m.isDefault) ?? models.value[0] ?? null,
  );

  /** 当前激活会话 */
  const activeSession = computed<ChatSession | null>(
    () => sessions.value.find((s) => s.id === currentSessionId.value) ?? null,
  );

  /** 当前会话绑定的 Agent 配置（未绑定 = null） */
  const activeProfile = computed<AgentProfile | null>(() => {
    const pid = activeSession.value?.agentProfileId;
    return pid ? (profiles.value.find((p) => p.id === pid) ?? null) : null;
  });

  /**
   * 当前实际生效的模型：会话绑定 > Agent 配置 > 默认模型
   *
   * ⚠️ 这是「请求真正发出去的模型」的唯一事实源。`defaultModel` 只是三级回落的
   * 兜底，会话 / 配置里绑了别的模型时就轮不到它——UI 必须据此标注「使用中」，
   * 否则用户改了默认模型却发现请求用的还是另一个会无从判断。
   */
  const effectiveModel = computed<ModelConfig | null>(() => {
    const modelId = activeSession.value?.modelId ?? activeProfile.value?.modelId ?? null;
    return models.value.find((m) => m.id === modelId) ?? defaultModel.value;
  });

  /**
   * 某分组（含未分组 null）下的会话列表
   * @param groupId 分组 id，null = 未分组
   * @returns 会话数组
   */
  const sessionsOfGroup = (groupId: number | null): ChatSession[] =>
    sessions.value.filter((s) => s.groupId === groupId);

  /* --------------------------------- 初始化 -------------------------------- */

  /**
   * 从 DB 恢复会话树（仅 Tauri 端调用；重复调用幂等）
   */
  async function init(): Promise<void> {
    if (initialized.value) return;
    initialized.value = true;
    const [
      groupList,
      sessionList,
      countResult,
      modelList,
      skillList,
      mcpList,
      profileList,
      subagentList,
      scopeList,
    ] = await Promise.all([
      db.listGroups(),
      db.listSessions(),
      db.getAgentCounts(),
      db.listModels(),
      db.listSkills(),
      db.listMcps(),
      db.listProfiles(),
      db.listSubagents(),
      // 内置资源的启停落在 resource_scope（见 builtinEnabled 注释）
      db.listResourceScopes(),
    ]);
    groups.value = groupList;
    sessions.value = sessionList;
    counts.value = countResult;
    models.value = modelList;
    skills.value = skillList;
    mcps.value = mcpList;
    profiles.value = profileList;
    builtinEnabled.value = Object.fromEntries(
      scopeList.map((row) => [resourceKey(row.resourceKind, row.resourceId), row.enabled]),
    );
    subagents.value = withBuiltinSubagents(subagentList, (id) =>
      isBuiltinEnabled('subagent', id),
    );
    // 默认选中最近可用的首个会话
    if (currentSessionId.value === null && sessionList.length > 0) {
      currentSessionId.value = sessionList[0].id;
    }
  }

  /** 刷新角标计数 */
  async function refreshCounts(): Promise<void> {
    counts.value = await db.getAgentCounts();
  }

  /**
   * 从 DB 重读会话树（不选中新会话、不动当前会话）
   *
   * 供定时任务等旁路写入方（创建绑定会话）刷新内存态使用——`init()` 有幂等
   * 守卫、二次调用不会重跑，旁路落库后必须走这里才能在会话树里看到新会话。
   */
  async function refreshSessions(): Promise<void> {
    sessions.value = await db.listSessions();
  }

  /* --------------------------------- 会话操作 -------------------------------- */

  /**
   * 新建会话并选中
   * @param groupId 归属分组（null = 未分组）
   * @returns 新会话 id
   */
  async function newSession(groupId: number | null = null): Promise<number> {
    const id = await db.createSession({ groupId });
    const list = await db.listSessions();
    sessions.value = list;
    currentSessionId.value = id;
    return id;
  }

  /**
   * 重命名会话
   * @param id 会话 id
   * @param title 新标题（空串拒绝）
   */
  async function renameSession(id: number, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;
    await db.renameSession(id, trimmed);
    const target = sessions.value.find((s) => s.id === id);
    if (target) target.title = trimmed;
  }

  /**
   * 切换模型（输入框模型下拉的唯一入口）
   *
   * 有会话 → 绑定到当前会话并同步内存（`effectiveModel` computed 自动跟随）；
   * 无会话 → 把该模型设为**默认模型**（会话建立前先改三级回落的兜底，
   * 下一条消息发送时新建的会话即用此模型）。
   *
   * @param modelId 模型 id
   */
  async function setSessionModel(modelId: number): Promise<void> {
    const session = activeSession.value;
    if (session) {
      if (session.modelId === modelId) return;
      await db.updateSessionModel(session.id, modelId);
      session.modelId = modelId;
      return;
    }
    const target = models.value.find((m) => m.id === modelId);
    if (!target || target.isDefault) return;
    // 无会话：改默认模型（saveModel 的 isDefault 语义会自动清其它默认）
    await upsertModel({ ...target, isDefault: true });
  }

  /**
   * 删除会话（级联删消息；若删除的是当前会话则回退到列表首个）
   * @param id 会话 id
   */
  async function removeSession(id: number): Promise<void> {
    await db.deleteSession(id);
    sessions.value = sessions.value.filter((s) => s.id !== id);
    if (currentSessionId.value === id) {
      currentSessionId.value = sessions.value[0]?.id ?? null;
    }
  }

  /**
   * 移动会话到分组（⋯ 菜单「移动分组」入口；拖拽走 applySessionOrders）
   * @param id 会话 id
   * @param groupId 目标分组 id，null = 未分组
   */
  async function moveSessionToGroup(id: number, groupId: number | null): Promise<void> {
    const target = sessions.value.find((s) => s.id === id);
    if (!target || target.groupId === groupId) return;
    await db.moveSession(id, groupId);
    sessions.value = await db.listSessions();
  }

  /**
   * 置顶 / 取消置顶（本地重排 + 落库）
   * @param id 会话 id
   */
  async function togglePin(id: number): Promise<void> {
    const target = sessions.value.find((s) => s.id === id);
    if (!target) return;
    const next = !target.pinned;
    await db.setSessionPinned(id, next);
    target.pinned = next;
  }

  /**
   * 会话拖拽排序 / 跨组移动落库
   * @param orders id → 新 sort_order / group_id
   */
  async function applySessionOrders(
    orders: Array<{ id: number; sortOrder: number; groupId: number | null }>,
  ): Promise<void> {
    await db.updateSessionOrders(orders);
    sessions.value = await db.listSessions();
  }

  /* --------------------------------- 分组操作 -------------------------------- */

  /**
   * 新建分组
   * @param name 分组名
   */
  async function addGroup(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await db.createGroup(trimmed);
    groups.value = await db.listGroups();
  }

  /**
   * 重命名分组
   * @param id 分组 id
   * @param name 新名称
   */
  async function renameGroup(id: number, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await db.renameGroup(id, trimmed);
    const target = groups.value.find((g) => g.id === id);
    if (target) target.name = trimmed;
  }

  /**
   * 删除分组（组内会话回落「未分组」）
   * @param id 分组 id
   */
  async function removeGroup(id: number): Promise<void> {
    await db.deleteGroup(id);
    groups.value = groups.value.filter((g) => g.id !== id);
    sessions.value = await db.listSessions();
  }

  /**
   * 分组拖拽排序落库
   * @param orderedIds 拖拽后的分组 id 顺序
   */
  async function applyGroupOrders(orderedIds: number[]): Promise<void> {
    await db.updateGroupOrders(orderedIds.map((id, index) => ({ id, sortOrder: index })));
    groups.value = await db.listGroups();
  }

  /* ------------------------------ 管理对象 CRUD ------------------------------ */

  /**
   * 新增 / 更新模型配置
   * @param input 模型字段（id 缺省 = 新建）
   */
  async function upsertModel(input: db.SaveModelInput): Promise<void> {
    await db.saveModel(input);
    models.value = await db.listModels();
    await refreshCounts();
  }

  /**
   * 删除模型
   * @param id 模型 id
   */
  async function removeModel(id: number): Promise<void> {
    await db.deleteModel(id);
    models.value = models.value.filter((m) => m.id !== id);
    await refreshCounts();
  }

  /**
   * 新增 Skill
   * @param name 展示名
   * @param dirName 唯一目录名
   * @param description 描述
   * @returns 新 id；目录名重复 = -1
   */
  async function addSkill(name: string, dirName: string, description: string | null): Promise<number> {
    const id = await db.createSkill({ name, dirName, description });
    if (id > 0) {
      skills.value = await db.listSkills();
      await refreshCounts();
    }
    return id;
  }

  /**
   * 内置资源是否启用（无记录 = 启用）
   * @param kind 资源类型
   * @param id 内置资源 id（负数）
   * @returns 是否启用
   */
  function isBuiltinEnabled(kind: GrantResourceKind, id: number): boolean {
    return builtinEnabled.value[resourceKey(kind, id)] ?? true;
  }

  /**
   * 切换内置资源的启用状态
   *
   * 只写 `resource_scope.enabled`，**不碰访问范围与勾选**（那是设置弹窗的事），
   * 这样列表开关与「访问设置」弹窗改的是同一行的不同字段，互不覆盖。
   *
   * @param kind 资源类型
   * @param id 内置资源 id（负数）
   * @param enabled 是否启用
   */
  async function toggleBuiltin(
    kind: GrantResourceKind,
    id: number,
    enabled: boolean,
  ): Promise<void> {
    await db.setResourceEnabled(kind, id, enabled);
    builtinEnabled.value = { ...builtinEnabled.value, [resourceKey(kind, id)]: enabled };
    if (kind === 'subagent') {
      // 内置 subagent 的 enabled 直接读列表项，同步一份让 UI 立即反映
      const target = subagents.value.find((s) => s.id === id);
      if (target) target.enabled = enabled;
    }
  }

  /**
   * 启用 / 停用 Skill
   *
   * 分两轨：内置 skill（负数 id）没有自己的表，启停写 `resource_scope`；
   * 用户 skill 写自身表的 `enabled`。
   *
   * @param id Skill id
   * @param enabled 是否启用
   */
  async function toggleSkill(id: number, enabled: boolean): Promise<void> {
    if (id < 0) {
      await toggleBuiltin('skill', id, enabled);
      return;
    }
    await db.setSkillEnabled(id, enabled);
    const target = skills.value.find((s) => s.id === id);
    if (target) target.enabled = enabled;
    await refreshCounts();
  }

  /**
   * 启用 / 停用 subagent
   *
   * 内置 subagent 是源码常量（库里无行）→ 写 `resource_scope`；
   * 用户 subagent → 写自身表的 `enabled`。
   *
   * @param id subagent id
   * @param enabled 是否启用
   */
  async function toggleSubagent(id: number, enabled: boolean): Promise<void> {
    if (id < 0) {
      await toggleBuiltin('subagent', id, enabled);
      return;
    }
    await db.setSubagentEnabled(id, enabled);
    const target = subagents.value.find((s) => s.id === id);
    if (target) target.enabled = enabled;
  }

  /**
   * 删除 Skill
   * @param id Skill id
   */
  async function removeSkill(id: number): Promise<void> {
    await db.deleteSkill(id);
    skills.value = skills.value.filter((s) => s.id !== id);
    await refreshCounts();
  }

  /**
   * 新增 MCP 服务器
   * @param input 服务器字段
   * @param input.name 展示名
   * @param input.transport 传输方式
   * @param input.url 服务地址
   * @param input.headers 请求头键值对
   */
  async function addMcp(input: db.McpCreateInput): Promise<void> {
    await db.createMcp(input);
    mcps.value = await db.listMcps();
    await refreshCounts();
  }

  /**
   * 更新 MCP 服务器字段（不含启停状态）
   * @param id MCP id
   * @param input 服务器字段
   */
  async function updateMcp(id: number, input: db.McpCreateInput): Promise<void> {
    await db.updateMcp(id, input);
    mcps.value = await db.listMcps();
    await refreshCounts();
  }

  /**
   * 启用 / 停用 MCP 服务器
   *
   * 分两轨：内置 MCP（负数 id）写 `resource_scope.enabled` —— 它的工具分组
   * 由运行时按授权过滤，停用后下次运行即不再装载；远端 MCP 写自身表并需重连。
   *
   * @param id MCP id
   * @param enabled 是否启用
   */
  async function toggleMcp(id: number, enabled: boolean): Promise<void> {
    if (id < 0) {
      await toggleBuiltin('mcp', id, enabled);
      return;
    }
    await db.setMcpEnabled(id, enabled);
    const target = mcps.value.find((m) => m.id === id);
    if (target) target.enabled = enabled;
    await refreshCounts();
  }

  /**
   * 删除 MCP 服务器
   * @param id MCP id
   */
  async function removeMcp(id: number): Promise<void> {
    await db.deleteMcp(id);
    mcps.value = mcps.value.filter((m) => m.id !== id);
    await refreshCounts();
  }

  /**
   * 新增 / 更新 Agent 配置
   * @param input 配置字段（id 缺省 = 新建）
   */
  async function upsertProfile(input: db.SaveProfileInput): Promise<void> {
    await db.saveProfile(input);
    profiles.value = await db.listProfiles();
    await refreshCounts();
  }

  /**
   * 删除 Agent 配置
   * @param id 配置 id
   */
  async function removeProfile(id: number): Promise<void> {
    await db.deleteProfile(id);
    profiles.value = profiles.value.filter((p) => p.id !== id);
    await refreshCounts();
  }

  /**
   * 新增 / 更新 subagent 定义
   * @param input 定义字段（id 缺省 = 新建）
   * @returns 生效的 subagent id（新建场景写授权行需要）
   */
  async function upsertSubagent(input: db.SaveSubagentInput): Promise<number> {
    const id = await db.saveSubagent(input);
    // ⚠️ 必须带上内置项的启用状态查询，否则刷新列表会把内置 subagent 的启停重置为「启用」
    subagents.value = withBuiltinSubagents(await db.listSubagents(), (bid) =>
      isBuiltinEnabled('subagent', bid),
    );
    return id;
  }

  /**
   * 删除 subagent 定义（各 profile 的引用 id 由运行时容错忽略）
   * @param id subagent id
   */
  async function removeSubagent(id: number): Promise<void> {
    await db.deleteSubagent(id);
    subagents.value = subagents.value.filter((s) => s.id !== id);
  }

  return {
    groups,
    sessions,
    currentSessionId,
    counts,
    sidebarCollapsed,
    initialized,
    models,
    skills,
    mcps,
    profiles,
    subagents,
    builtinEnabled,
    defaultModel,
    activeSession,
    activeProfile,
    effectiveModel,
    sessionsOfGroup,
    init,
    refreshCounts,
    refreshSessions,
    newSession,
    renameSession,
    setSessionModel,
    removeSession,
    togglePin,
    moveSessionToGroup,
    applySessionOrders,
    addGroup,
    renameGroup,
    removeGroup,
    applyGroupOrders,
    upsertModel,
    removeModel,
    addSkill,
    toggleSkill,
    removeSkill,
    addMcp,
    updateMcp,
    toggleMcp,
    removeMcp,
    upsertProfile,
    removeProfile,
    upsertSubagent,
    removeSubagent,
    isBuiltinEnabled,
    toggleBuiltin,
    toggleSubagent,
  };
});
