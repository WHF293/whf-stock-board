/**
 * 定时任务状态（Agent 分析 · agent_schedule 表）
 *
 * 职责：任务列表内存态 + 落库同步；创建任务时自动建绑定会话并按档位折算
 * 过期时间；「立即测试」与心跳到期触发共用同一条执行路径（runNow）；
 * 30s 心跳（startTicker，幂等启动、随应用生命周期常驻）做分钟匹配与去重。
 *
 * 边界：会话树内存态归 agent store 管——这里只旁路写入（建会话），落库后
 * 调 `agentStore.refreshSessions()` 刷新；执行链路在 `agent/schedule-runner.ts`。
 */
import { ref } from 'vue';
import { defineStore } from 'pinia';
import * as db from '@/composables/use-agent-db';
import { useAgentStore } from '@/stores/agent';
import { runScheduleTask } from '@/agent/schedule-runner';
import { minuteBucket } from '@/utils/minute-bucket';
import { SCHEDULE_DURATIONS, SCHEDULE_RUN_STATUS, SCHEDULE_TICK_MS } from '@/constants/schedule.constants';
import type { AgentProfile, ChatSession, ModelConfig, SubagentDef } from '@/types/agent.types';
import type { ScheduleFormInput, ScheduleTask } from '@/types/schedule.types';

export const useScheduleStore = defineStore('schedule', () => {
  /* --------------------------------- 状态 --------------------------------- */

  /** 任务列表（创建时间升序） */
  const tasks = ref<ScheduleTask[]>([]);
  /** 正在执行的任务 id（立即测试 / 心跳触发共用；防重入） */
  const runningIds = ref(new Set<number>());
  /** 是否已从 DB 初始化 */
  const initialized = ref(false);

  /** 心跳定时器句柄（幂等启动；随应用生命周期常驻，不随页面卸载） */
  let ticker: number | null = null;
  /** 心跳防重入（上一轮 tick 里若有任务在执行，30s 后的下轮跳过判定） */
  let ticking = false;

  /* --------------------------------- 初始化 -------------------------------- */

  /**
   * 从 DB 恢复任务列表（仅 Tauri 端调用；重复调用幂等）
   */
  async function init(): Promise<void> {
    if (initialized.value) return;
    initialized.value = true;
    tasks.value = await db.listSchedules();
  }

  /** 重读任务列表（执行状态回写等旁路落库后的刷新） */
  async function reload(): Promise<void> {
    tasks.value = await db.listSchedules();
  }

  /* --------------------------------- 任务 CRUD -------------------------------- */

  /**
   * 新建定时任务：自动创建绑定会话（标题 = 任务名）→ 按档位折算过期时间 → 落库
   * @param form 表单字段
   */
  async function createTask(form: ScheduleFormInput): Promise<void> {
    const agentStore = useAgentStore();
    const sessionId = await db.createSession({ title: form.name });
    await db.createSchedule({
      ...form,
      sessionId,
      expiresAt: Date.now() + SCHEDULE_DURATIONS[form.durationKey].ms,
    });
    await reload();
    // 会话树归 agent store 管；init() 幂等守卫不会重跑，必须显式刷新
    await agentStore.refreshSessions();
  }

  /**
   * 编辑任务计划字段（会话锚点与过期时间不随编辑变，见 use-agent-db.updateSchedule）
   * @param id 任务 id
   * @param form 表单字段
   */
  async function updateTask(id: number, form: ScheduleFormInput): Promise<void> {
    await db.updateSchedule(id, form);
    await reload();
  }

  /**
   * 启用 / 停用任务（停用保留配置，心跳跳过）
   * @param id 任务 id
   * @param enabled 是否启用
   */
  async function toggleTask(id: number, enabled: boolean): Promise<void> {
    await db.setScheduleEnabled(id, enabled);
    const target = tasks.value.find((t) => t.id === id);
    if (target) target.enabled = enabled;
  }

  /**
   * 删除任务（绑定会话保留：历史执行记录还有价值，由用户自行决定是否删会话）
   * @param id 任务 id
   */
  async function removeTask(id: number): Promise<void> {
    await db.deleteSchedule(id);
    tasks.value = tasks.value.filter((t) => t.id !== id);
  }

  /* --------------------------------- 执行 --------------------------------- */

  /**
   * 解析任务的运行时（模型按 会话绑定 > Agent 配置 > 默认 三级回落）
   * @param task 任务
   * @returns 会话 / 配置 / 模型 / 子 agent（均可为空或空数组，由调用方判定）
   */
  function resolveRuntime(task: ScheduleTask): {
    session: ChatSession | null;
    profile: AgentProfile | null;
    model: ModelConfig | null;
    subagents: SubagentDef[];
  } {
    const agentStore = useAgentStore();
    const session = agentStore.sessions.find((s) => s.id === task.sessionId) ?? null;
    const profile =
      session?.agentProfileId != null
        ? (agentStore.profiles.find((p) => p.id === session.agentProfileId) ?? null)
        : null;
    const modelId = session?.modelId ?? profile?.modelId ?? null;
    const model =
      (modelId !== null ? agentStore.models.find((m) => m.id === modelId) : undefined) ??
      agentStore.defaultModel;
    const subagents = (profile?.subagentIds ?? [])
      .map((id) => agentStore.subagents.find((s) => s.id === id))
      .filter((s): s is SubagentDef => s !== undefined);
    return { session, profile, model, subagents };
  }

  /**
   * 立即执行一次任务（「立即测试」按钮与心跳到期触发共用）
   *
   * 前置校验失败（会话缺失 / 无模型）直接标记状态返回，不进运行链路；
   * 触发即写 last_run_at（同分钟去重的事实源）与 'running' 状态。
   *
   * @param task 任务
   */
  async function runNow(task: ScheduleTask): Promise<void> {
    if (runningIds.value.has(task.id)) return;
    const agentStore = useAgentStore();
    const { session, profile, model, subagents } = resolveRuntime(task);

    // 绑定会话已被删除：标记缺失并自动禁用，避免每个到期 tick 都空跑
    if (!session) {
      await db.markScheduleRun(task.id, SCHEDULE_RUN_STATUS.sessionMissing);
      await db.setScheduleEnabled(task.id, false);
      task.enabled = false;
      task.lastRunAt = Date.now();
      task.lastRunStatus = SCHEDULE_RUN_STATUS.sessionMissing;
      return;
    }
    // 模型三级回落全落空：无法发起请求
    if (!model) {
      await db.markScheduleRun(task.id, SCHEDULE_RUN_STATUS.noModel);
      task.lastRunAt = Date.now();
      task.lastRunStatus = SCHEDULE_RUN_STATUS.noModel;
      return;
    }

    runningIds.value.add(task.id);
    await db.markScheduleRun(task.id, SCHEDULE_RUN_STATUS.running);
    task.lastRunAt = Date.now();
    task.lastRunStatus = SCHEDULE_RUN_STATUS.running;
    try {
      const result = await runScheduleTask({
        taskId: task.id,
        sessionId: task.sessionId,
        prompt: task.prompt,
        model,
        profile,
        subagents,
        userSkills: agentStore.skills,
      });
      task.lastRunStatus = result;
    } catch (error) {
      // 准备阶段抛错（取历史 / 插消息失败）：本轮没有消息记录，仅标记任务状态
      console.warn('[schedule] 任务执行失败：', error);
      task.lastRunStatus = SCHEDULE_RUN_STATUS.error;
    } finally {
      runningIds.value.delete(task.id);
    }
  }

  /* --------------------------------- 心跳 --------------------------------- */

  /**
   * 到期判定（单个任务）
   * @param task 任务
   * @param now 当前时刻
   * @param bucket 当前分钟桶
   * @returns 是否应在本轮触发
   */
  function isDue(task: ScheduleTask, now: Date, bucket: number): boolean {
    if (!task.enabled) return false;
    if (task.expiresAt !== null && now.getTime() >= task.expiresAt) return false;
    if (task.hour !== now.getHours() || task.minute !== now.getMinutes()) return false;
    if (task.scheduleType === 'weekly' && task.weekday !== now.getDay()) return false;
    // 同分钟只触发一次（触发即写 last_run_at，这里读内存态即可）
    if (task.lastRunAt !== null && minuteBucket(task.lastRunAt) === bucket) return false;
    return true;
  }

  /** 一轮心跳检查（防重入；命中的任务逐个串行执行） */
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const now = new Date();
      const bucket = minuteBucket(now.getTime());
      for (const task of [...tasks.value]) {
        if (!isDue(task, now, bucket)) continue;
        await runNow(task);
      }
    } finally {
      ticking = false;
    }
  }

  /**
   * 启动心跳（幂等；随应用生命周期常驻——任务语义是「应用开着就跑」，
   * 与用户是否停留在 Agent 分析页无关，30s 一次的空闲判定开销可忽略）
   */
  function startTicker(): void {
    if (ticker !== null) return;
    ticker = window.setInterval(() => void tick(), SCHEDULE_TICK_MS);
  }

  return {
    tasks,
    runningIds,
    initialized,
    init,
    reload,
    createTask,
    updateTask,
    toggleTask,
    removeTask,
    runNow,
    startTicker,
  };
});
