/**
 * 资源授权判定（**唯一权威实现**）
 *
 * MCP / Skill 的授权有两个入口——资源侧（设置弹窗勾 agent）与 agent 侧（配置弹窗勾资源），
 * 二者共用 `resource_grant` 表作为唯一事实源。所有「某 agent 能否用某资源」的判断
 * 都必须走本文件，不要在 UI 或运行时各写一份，否则语义会漂移。
 *
 * 判定规则：
 * - `access_scope = 'all'`    → 全部 agent 可用（与 grant 行无关）；
 * - `access_scope = 'custom'` → 仅 grant 表列出的 agent 可用。
 *   ⚠️ custom 且集合为空 = 含主 agent 在内谁都不可用，UI 必须警示。
 */
import type {
  AccessScope,
  GrantAgentKind,
  GrantResourceKind,
  ResourceGrant,
  ResourceScope,
} from '@/types/agent.types';

/**
 * 主 agent 在授权表中的 id
 *
 * 主 agent 是单例角色，不按 profile 区分（profile 是「人设」，不是 agent 实例）。
 */
export const MAIN_AGENT_ID = 0;

/**
 * 资源键（用于索引与 Map 查找）
 * @param kind 资源类型
 * @param id 资源 id
 * @returns 形如 `mcp:3` 的键
 */
export const resourceKey = (kind: GrantResourceKind, id: number): string =>
  kind + ':' + String(id);

/**
 * agent 键（用于索引与 Set 查找）
 * @param agentKind agent 类型
 * @param agentId agent id
 * @returns 形如 `subagent:-3` 的键
 */
export const agentKey = (agentKind: GrantAgentKind, agentId: number): string =>
  agentKind + ':' + String(agentId);

/**
 * 判定单个 agent 能否访问某资源
 * @param scope 资源访问范围
 * @param grantedKeys 该资源已授权的 agent 键集合（仅 scope='custom' 时参与判断）
 * @param agentKind 目标 agent 类型
 * @param agentId 目标 agent id
 * @returns 是否允许访问
 */
export const isResourceAllowed = (
  scope: AccessScope,
  grantedKeys: ReadonlySet<string>,
  agentKind: GrantAgentKind,
  agentId: number,
): boolean => (scope === 'all' ? true : grantedKeys.has(agentKey(agentKind, agentId)));

/**
 * 授权行数组 → 「资源键 → 该资源被授权的 agent 键集合」索引
 * @param grants 授权行数组
 * @returns 资源键 → agent 键集合
 */
export const indexGrantsByResource = (
  grants: readonly ResourceGrant[],
): Map<string, Set<string>> => {
  const index = new Map<string, Set<string>>();
  for (const grant of grants) {
    const key = resourceKey(grant.resourceKind, grant.resourceId);
    const bucket = index.get(key) ?? new Set<string>();
    bucket.add(agentKey(grant.agentKind, grant.agentId));
    index.set(key, bucket);
  }
  return index;
};

/** 空的授权集合（scope='all' 场景复用，避免反复构造） */
export const EMPTY_GRANTED_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * 范围行数组 → 「资源键 → 范围行」索引
 * @param scopes 范围行数组
 * @returns 资源键 → 范围行（**缺行的资源表示「启用 + 全部可访问」**）
 */
export const indexScopesByResource = (
  scopes: readonly ResourceScope[],
): Map<string, ResourceScope> => {
  const index = new Map<string, ResourceScope>();
  for (const row of scopes) {
    index.set(resourceKey(row.resourceKind, row.resourceId), row);
  }
  return index;
};

/** 一次运行所需的全部授权上下文（构建一次、查多次） */
export interface AccessContext {
  /** 资源键 → 范围行（缺行 = 启用且 scope='all'） */
  scopes: ReadonlyMap<string, ResourceScope>;
  /** 资源键 → 已授权的 agent 键集合 */
  grants: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * 由范围行与授权行构建访问上下文
 * @param scopes 范围行数组
 * @param grants 授权行数组
 * @returns 访问上下文
 */
export const buildAccessContext = (
  scopes: readonly ResourceScope[],
  grants: readonly ResourceGrant[],
): AccessContext => ({
  scopes: indexScopesByResource(scopes),
  grants: indexGrantsByResource(grants),
});

/**
 * 资源是否整体启用（缺行 = 启用）
 *
 * ⚠️ 用户资源（mcp_server / skill）的启用状态以自身表的 `enabled` 为准，
 * 调用方应先把该值作为 `fallback` 传进来；内置资源没有自己的表，只能用本表。
 *
 * @param ctx 访问上下文
 * @param kind 资源类型
 * @param id 资源 id
 * @param fallback 缺行时的启用状态（用户资源传自身 enabled 列；内置传 true）
 * @returns 是否启用
 */
export const isResourceEnabled = (
  ctx: AccessContext,
  kind: GrantResourceKind,
  id: number,
  fallback = true,
): boolean => ctx.scopes.get(resourceKey(kind, id))?.enabled ?? fallback;

/**
 * 判定某 agent 能否使用某资源（**启用 ∧ 授权**，唯一权威入口）
 *
 * 两个条件缺一不可：资源被关掉时连主 agent 也用不了；scope='custom' 时只认 grant 集合。
 *
 * @param ctx 访问上下文
 * @param kind 资源类型
 * @param id 资源 id
 * @param agentKind agent 类型
 * @param agentId agent id（主 agent 用 MAIN_AGENT_ID）
 * @param fallbackEnabled 缺行时的启用状态（用户资源传自身 enabled 列；内置传 true）
 * @returns 是否可用
 */
export const canUseResource = (
  ctx: AccessContext,
  kind: GrantResourceKind,
  id: number,
  agentKind: GrantAgentKind,
  agentId: number,
  fallbackEnabled = true,
): boolean => {
  if (!isResourceEnabled(ctx, kind, id, fallbackEnabled)) return false;
  const scope = ctx.scopes.get(resourceKey(kind, id))?.scope ?? 'all';
  const granted = ctx.grants.get(resourceKey(kind, id)) ?? EMPTY_GRANTED_KEYS;
  return isResourceAllowed(scope, granted, agentKind, agentId);
};

/**
 * 从范围行与授权行算出「某资源在 custom 且无任何授权对象」的静默锁死状态
 *
 * UI 警示用：这种资源对包含主 agent 在内的所有 agent 都不可用，
 * 但用户从弹窗上看「已启用、精确设置」很容易以为没事，必须显式提示。
 *
 * @param ctx 访问上下文
 * @param kind 资源类型
 * @param id 资源 id
 * @returns 是否处于「精确设置但无人可用」状态
 */
export const isResourceOrphaned = (
  ctx: AccessContext,
  kind: GrantResourceKind,
  id: number,
): boolean => {
  const key = resourceKey(kind, id);
  const scope = ctx.scopes.get(key)?.scope ?? 'all';
  if (scope !== 'custom') return false;
  return (ctx.grants.get(key)?.size ?? 0) === 0;
};
