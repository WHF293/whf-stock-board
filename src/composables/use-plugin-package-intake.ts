/**
 * 插件包入队与解析编排（批量上传的流水线大脑）
 *
 * 单包时代是「选一个包 → 点解析 → 看结果 → 点安装」的串行交互，批量上传把它拆成了两件事：
 *
 * 1. **入队即解析**（fire-and-forget）：`enqueue` 为每个文件建任务并**立刻**启动解析，
 *    不等前一个包 —— 于是「传了 A、B 再传 C」时 C 也能马上进入解析环节，
 *    各包彼此独立，谁先解析完谁先出结果；队列顺序（上传顺序）只用于冲突仲裁。
 * 2. **解析与安装分离**：解析全程自动、安装由用户拍板。解析只做「能不能装」的判断
 *    （含包间冲突），不写持久化、不挂内核；点安装才真正落内核。
 *
 * 流水线六步（见 `USER_PLUGIN_INTAKE_STEPS`）刻意拆开而不是合成一次调用：
 * 包坏了、产物写错了、清单对不上，三种失败在用户眼里都曾是同一句「解析失败」，
 * 拆开后进度条自己会说话。
 *
 * ⚠️ 与已安装记录 / 内置插件同 id **不是冲突**（那是升级与接管，合法）；
 * 冲突只指「同一批次里两个包抢同一个 id」，按上传顺序先到先得。
 */
import { computed, ref } from 'vue';
import { useUserPlugins } from './use-user-plugins';
import { auditPluginClassNames } from '../plugin/user-plugin-class-audit';
import { formatLintBlockers, lintUserPluginCode } from '../plugin/user-plugin-lint';
import {
  evaluateUserPluginModule,
  validateUserPluginDefinition,
} from '../plugin/user-plugin-loader';
import {
  checkManifestConsistency,
  parsePluginPackage,
} from '../utils/plugin-package';
import { detectPackageConflicts } from '../utils/detect-package-conflicts';
import {
  USER_PLUGIN_INTAKE_INSTALL_FAILED_PREFIX,
  USER_PLUGIN_INTAKE_STATUS,
  USER_PLUGIN_INTAKE_STEPS,
  USER_PLUGIN_INTAKE_STEP_STATE,
  USER_PLUGIN_INTAKE_UID_PREFIX,
  USER_PLUGIN_INTAKE_WARN_LINE,
  USER_PLUGIN_SOURCE,
} from '../constants/plugin.constants';
import type { ComputedRef, Ref } from 'vue';
import type { PluginDefinition } from '../types/plugin.types';
import type { UserPluginIntakeStatus, UserPluginIntakeStepKey, UserPluginIntakeStepState } from '../constants/plugin.constants';
import type { PackageConflictCandidate } from '../utils/detect-package-conflicts';
import type { PluginPackage } from '../utils/plugin-package';

/** 流水线里的一步（状态由编排层推进） */
export interface PluginPackageIntakeStep {
  /** 步骤 key（与 `USER_PLUGIN_INTAKE_STEPS` 对齐） */
  key: UserPluginIntakeStepKey;
  /** 步骤名 */
  label: string;
  /** 步骤状态 */
  state: UserPluginIntakeStepState;
}

/** 一个入队任务（= 一个上传的 zip 包） */
export interface PluginPackageIntakeTask {
  /** 任务 uid（列表 key 与移除定位；不持久化） */
  uid: string;
  /** 文件名 */
  fileName: string;
  /** 上传顺序（**冲突仲裁依据**：先上传者胜出） */
  order: number;
  /** 任务状态 */
  status: UserPluginIntakeStatus;
  /** 六步流水线进度 */
  steps: PluginPackageIntakeStep[];
  /** 解包结果（解包失败时为 null） */
  pkg: PluginPackage | null;
  /** 产物导出的插件定义（解析全过后非 null） */
  definition: PluginDefinition | null;
  /** 失败原因（解析失败 / 安装失败共用） */
  error: string;
  /** 非致命提醒（已格式化为「第 N 行：…」） */
  warnings: readonly string[];
  /** 包间冲突说明（无冲突时为空串） */
  conflict: string;
  /** 是否已落内核 */
  installed: boolean;
}

/** 批量安装结果统计 */
export interface PluginPackageIntakeInstallSummary {
  /** 成功安装的数量 */
  installed: number;
  /** 安装失败的数量 */
  failed: number;
}

/** `usePluginPackageIntake` 返回句柄 */
export interface UsePluginPackageIntakeReturn {
  /** 入队任务列表（顺序 = 上传顺序） */
  tasks: Ref<PluginPackageIntakeTask[]>;
  /** 可安装数量（解析完成且无冲突） */
  installableCount: ComputedRef<number>;
  /** 队列非空且全部已安装 */
  allInstalled: ComputedRef<boolean>;
  /** 是否仍有任务在推进（解析 / 安装） */
  busy: ComputedRef<boolean>;
  /**
   * 入队一批文件并立刻开始解析（不阻塞后续入队）
   * @param files 用户选择或拖入的 zip 文件
   */
  enqueue: (files: readonly File[]) => void;
  /**
   * 从队列移除一个任务，并重算包间冲突（被释放的同 id 包会回到待安装）
   * @param uid 任务 uid
   */
  remove: (uid: string) => void;
  /**
   * 安装单个包（串行链路的一次执行）
   * @param uid 任务 uid
   * @returns 是否安装成功
   */
  installOne: (uid: string) => Promise<boolean>;
  /**
   * 按上传顺序串行安装全部可安装的包
   *
   * 串行不是保守：安装会先 `unuse` 同 id 旧版本再 `use` 新版本，并行会让内核的
   * 卸载 / 挂载与持久化写入互相踩踏（同 id 升级时尤其明显）。
   * @returns 成功与失败的计数（失败原因已写回各自任务）
   */
  installAll: () => Promise<PluginPackageIntakeInstallSummary>;
  /**
   * 作废本轮尚未执行的安装（正在飞的那一次收不回来，会跑完为止）
   *
   * 用于「用户中途关掉弹窗」：已经点了安装的那一个没法撤回，但队列里剩下的
   * 不该在他看不见的时候继续往上装。
   */
  cancelPendingInstalls: () => void;
  /** 清空队列（关闭弹窗时调用；在途 import 的结果会被丢弃，不再写回界面） */
  reset: () => void;
}

/**
 * 建一份全新的六步进度（全部 pending）
 * @returns 步骤数组
 */
const createSteps = (): PluginPackageIntakeStep[] =>
  USER_PLUGIN_INTAKE_STEPS.map((step) => ({
    key: step.key,
    label: step.label,
    state: USER_PLUGIN_INTAKE_STEP_STATE.PENDING,
  }));

/**
 * 把任意抛出物压成可展示的一行文案
 * @param error catch 到的值
 * @returns 错误文案
 */
const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 插件包入队与解析编排
 *
 * 每个任务自己跑完整的六步流水线，任一步失败即终止并把后续步骤标记为 `skipped`；
 * 每有任务解析完成，就以「当前全部已解析任务」重跑一次包间冲突检测 ——
 * 因此先传 A 后传 B（同 id）时 B 被判冲突，而移除 A 后 B 会自动回到待安装。
 * @returns 队列与入队 / 移除 / 安装句柄
 */
export const usePluginPackageIntake = (): UsePluginPackageIntakeReturn => {
  const { install } = useUserPlugins();

  /** 任务队列（顺序 = 上传顺序，冲突仲裁据此判定） */
  const tasks = ref<PluginPackageIntakeTask[]>([]);

  /** uid / order 自增序号 */
  let sequence = 0;

  /**
   * 队列代数：每次 `reset` 自增。在途任务持有入队时的代数，
   * 回来发现代数变了说明队列已被清空（弹窗关了），直接丢弃结果不再写回。
   */
  let generation = 0;

  /**
   * 安装批次令牌：自增即作废「本轮还没轮到」的安装
   *
   * 已经发出的那一次 `await install()` 是真收不回来的（动态 import + 内核挂载都在飞），
   * 但队列里**后面那些**是用户还来得及反悔的动作 —— 弹窗一关就该停下，
   * 否则「关了窗」的用户会在毫无感知的情况下被陆续装上好几个插件。
   */
  let installRound = 0;

  /**
   * 在途任务是否仍属于当前队列
   * @param bornGeneration 任务入队时的代数
   * @returns true 表示结果仍应写回界面
   */
  const alive = (bornGeneration: number): boolean => bornGeneration === generation;

  /**
   * 把某一步置为指定状态
   * @param task 任务
   * @param key 步骤 key
   * @param state 目标状态
   */
  const markStep = (
    task: PluginPackageIntakeTask,
    key: UserPluginIntakeStepKey,
    state: UserPluginIntakeStepState,
  ): void => {
    const step = task.steps.find((item) => item.key === key);
    if (step) step.state = state;
  };

  /**
   * 以「当前全部已解析任务」重跑包间冲突检测并回写状态
   *
   * 只仲裁**已解析出 id、既没失败也没开始安装**的任务：解包失败的包没有 id（无从判定），
   * 失败 / 安装中 / 已装的任务都已离开「待仲裁候选」（失败的包必须靠用户移除重来，
   * 否则会被这里悄悄复活成待安装）。
   */
  const recomputeConflicts = (): void => {
    /** 有资格参与仲裁的任务（顺序 = 上传顺序） */
    const arbitral = tasks.value.filter(
      (task) => task.definition !== null
        && task.status !== USER_PLUGIN_INTAKE_STATUS.FAILED
        && task.status !== USER_PLUGIN_INTAKE_STATUS.INSTALLING
        && task.status !== USER_PLUGIN_INTAKE_STATUS.INSTALLED,
    );
    const candidates: PackageConflictCandidate[] = [];
    for (const task of arbitral) {
      const definition = task.definition;
      if (!definition) continue;
      candidates.push({ uid: task.uid, fileName: task.fileName, id: definition.id });
    }
    const conflicts = new Map(
      detectPackageConflicts(candidates).map((conflict) => [conflict.uid, conflict]),
    );
    for (const task of arbitral) {
      const hit = conflicts.get(task.uid);
      if (hit) {
        task.conflict = hit.message;
        task.status = USER_PLUGIN_INTAKE_STATUS.CONFLICT;
        markStep(task, 'conflict', USER_PLUGIN_INTAKE_STEP_STATE.FAILED);
        continue;
      }
      // 曾被判冲突的包若抢占者被移除，这里把它放回来（不要求用户重新上传）
      task.conflict = '';
      task.status = USER_PLUGIN_INTAKE_STATUS.READY;
      markStep(task, 'conflict', USER_PLUGIN_INTAKE_STEP_STATE.DONE);
    }
  };

  /**
   * 让任务在某一步失败：该步置 failed、后续全部 skipped、状态落到 failed
   * @param task 任务
   * @param key 失败的步骤 key
   * @param message 面向用户的失败原因
   */
  const failAt = (
    task: PluginPackageIntakeTask,
    key: UserPluginIntakeStepKey,
    message: string,
  ): void => {
    const index = task.steps.findIndex((step) => step.key === key);
    if (index >= 0) {
      task.steps[index].state = USER_PLUGIN_INTAKE_STEP_STATE.FAILED;
      for (let cursor = index + 1; cursor < task.steps.length; cursor += 1) {
        task.steps[cursor].state = USER_PLUGIN_INTAKE_STEP_STATE.SKIPPED;
      }
    }
    task.status = USER_PLUGIN_INTAKE_STATUS.FAILED;
    task.error = message;
    // 失败的任务拿不到可信 id，必须退出冲突仲裁（否则会凭空替别人判冲突）
    task.definition = null;
    task.conflict = '';
    recomputeConflicts();
  };

  /**
   * 跑完一个任务的六步解析流水线
   * @param bornGeneration 入队时的队列代数（回来时校验，防止关窗后被写回）
   * @param task 任务
   * @param file 用户上传的 zip 文件
   */
  const resolveTask = async (
    bornGeneration: number,
    task: PluginPackageIntakeTask,
    file: File,
  ): Promise<void> => {
    // ① 解包：zip → 入口产物代码 + 清单 + README
    markStep(task, 'unzip', USER_PLUGIN_INTAKE_STEP_STATE.RUNNING);
    let pkg: PluginPackage;
    try {
      pkg = parsePluginPackage(await file.arrayBuffer());
    } catch (error) {
      failAt(task, 'unzip', toMessage(error));
      return;
    }
    if (!alive(bornGeneration)) return;
    task.pkg = pkg;
    markStep(task, 'unzip', USER_PLUGIN_INTAKE_STEP_STATE.DONE);

    // ② 静态预检：致命写法（import / template …）在此拦下，不进 Blob import
    markStep(task, 'lint', USER_PLUGIN_INTAKE_STEP_STATE.RUNNING);
    const lint = lintUserPluginCode(pkg.code);
    if (lint.blockers.length > 0) {
      failAt(task, 'lint', formatLintBlockers(lint.blockers));
      return;
    }
    markStep(task, 'lint', USER_PLUGIN_INTAKE_STEP_STATE.DONE);

    // ③ 加载产物：Blob URL 动态 import，取回模块导出
    markStep(task, 'import', USER_PLUGIN_INTAKE_STEP_STATE.RUNNING);
    const evaluated = await evaluateUserPluginModule(pkg.code);
    if (!evaluated.ok) {
      failAt(task, 'import', evaluated.error);
      return;
    }
    if (!alive(bornGeneration)) return;
    markStep(task, 'import', USER_PLUGIN_INTAKE_STEP_STATE.DONE);

    // ④ 结构校验：形态 / 必填元信息 / id 合法性
    //    occupiedIds 传空数组 —— 同 id 是升级 / 接管，政策在 `install` 里，不在底层
    markStep(task, 'validate', USER_PLUGIN_INTAKE_STEP_STATE.RUNNING);
    const validated = validateUserPluginDefinition(evaluated.exported, []);
    if (!validated.ok) {
      failAt(task, 'validate', validated.error);
      return;
    }
    markStep(task, 'validate', USER_PLUGIN_INTAKE_STEP_STATE.DONE);

    // ⑤ 清单比对：包说一套、产物是另一套必须拦下，否则「装进去的与自己说的不一样」
    markStep(task, 'manifest', USER_PLUGIN_INTAKE_STEP_STATE.RUNNING);
    const inconsistency = checkManifestConsistency(pkg.manifest, validated.definition);
    if (inconsistency) {
      failAt(task, 'manifest', inconsistency);
      return;
    }
    markStep(task, 'manifest', USER_PLUGIN_INTAKE_STEP_STATE.DONE);

    // 队列若已被 reset（弹窗关了），别再往回写：下面是第 6 步与一次全局冲突重算
    if (!alive(bornGeneration)) return;

    task.definition = validated.definition;
    task.warnings = [
      ...lint.warnings,
      ...auditPluginClassNames(pkg.code),
    ].map((issue) => USER_PLUGIN_INTAKE_WARN_LINE(issue.line, issue.message));

    // ⑥ 冲突检测：以「当前全部已解析任务」重跑，本任务的状态（ready / conflict）由它定
    markStep(task, 'conflict', USER_PLUGIN_INTAKE_STEP_STATE.RUNNING);
    recomputeConflicts();
  };

  const enqueue = (files: readonly File[]): void => {
    const bornGeneration = generation;
    for (const file of files) {
      sequence += 1;
      const task: PluginPackageIntakeTask = {
        uid: `${USER_PLUGIN_INTAKE_UID_PREFIX}${sequence}`,
        fileName: file.name,
        order: sequence,
        status: USER_PLUGIN_INTAKE_STATUS.PARSING,
        steps: createSteps(),
        pkg: null,
        definition: null,
        error: '',
        warnings: [],
        conflict: '',
        installed: false,
      };
      tasks.value = [...tasks.value, task];
      // fire-and-forget：不等它，下一个文件立刻入队。兜底 catch 只防流水线之外的意外抛出
      resolveTask(bornGeneration, task, file).catch((error: unknown) => {
        failAt(task, 'unzip', toMessage(error));
      });
    }
  };

  const remove = (uid: string): void => {
    const index = tasks.value.findIndex((task) => task.uid === uid);
    if (index === -1) return;
    tasks.value = tasks.value.filter((task) => task.uid !== uid);
    // 移除可能释放被压制的同 id 包（先到先得：前者走了，后者转正）
    recomputeConflicts();
  };

  /**
   * 按给定任务列表**串行**安装
   *
   * 白名单语义的关键：**只装调用方快照进来的那些任务**。串行过程中每装完一个都会
   * 重算包间冲突，被它压着的同 id 包会被提升为 `ready` —— 那是**下一轮**才该装的东西；
   * 若这里继续按 uid 回查当前队列，同一批次两个同 id 包就会在同一轮里被装完，
   * 后者静默顶掉前者（持久化里只剩最后那份代码），正是冲突检测要防的事。
   * @param round 本轮允许安装的任务对象快照（顺序 = 上传顺序）
   * @returns 成功与失败计数
   */
  const runInstall = async (
    round: readonly PluginPackageIntakeTask[],
  ): Promise<PluginPackageIntakeInstallSummary> => {
    const token = installRound;
    let installed = 0;
    let failed = 0;
    for (const task of round) {
      // 双保险：快照到执行之间它可能已被移除 / 已失败（对象仍在内存里，状态却变了）
      if (!task.pkg) continue;
      if (task.status !== USER_PLUGIN_INTAKE_STATUS.READY) continue;
      task.status = USER_PLUGIN_INTAKE_STATUS.INSTALLING;
      const result = await install(task.pkg.code, {
        manifest: task.pkg.manifest,
        source: USER_PLUGIN_SOURCE.PACKAGE,
      });
      if (result.ok) {
        task.status = USER_PLUGIN_INTAKE_STATUS.INSTALLED;
        task.installed = true;
        installed += 1;
      } else {
        task.status = USER_PLUGIN_INTAKE_STATUS.FAILED;
        task.error = `${USER_PLUGIN_INTAKE_INSTALL_FAILED_PREFIX}${result.error}`;
        failed += 1;
      }
      // 本包已落定（装上或装失败）就退出仲裁候选：被它压着的同 id 包随即转正，
      // 不会出现「前者已装、后者永远卡在冲突里」的死局
      recomputeConflicts();
      // 本轮被作废（用户中途关了弹窗）→ 剩下的不装。已经发出去的那一个收不回来，跑完即止
      if (installRound !== token) break;
    }
    return { installed, failed };
  };

  const installOne = async (uid: string): Promise<boolean> => {
    const task = tasks.value.find((item) => item.uid === uid);
    if (!task) return false;
    const summary = await runInstall([task]);
    return summary.installed === 1;
  };

  const installAll = async (): Promise<PluginPackageIntakeInstallSummary> => {
    // 本轮白名单：**此刻**处于 ready 的任务。同 id 的后来者此刻是 conflict，不在白名单里；
    // 它被本轮提升成 ready 之后，要用户明明白白再点一次「安装全部」才会装上（那时它会
    // 顶着「升级」提示，不是静默覆盖）。
    const round = tasks.value.filter(
      (task) => task.status === USER_PLUGIN_INTAKE_STATUS.READY,
    );
    return runInstall(round);
  };

  const cancelPendingInstalls = (): void => {
    installRound += 1;
  };

  const reset = (): void => {
    // 代数自增让在途任务的结果作废（无法取消已发出的 import，但不会再碰到新队列）
    generation += 1;
    // 连本轮没轮到的安装一起作废：队列都清空了，再往下装就是自作主张
    installRound += 1;
    sequence = 0;
    tasks.value = [];
  };

  const installableCount = computed<number>(
    () => tasks.value.filter((task) => task.status === USER_PLUGIN_INTAKE_STATUS.READY).length,
  );

  const allInstalled = computed<boolean>(
    () => tasks.value.length > 0
      && tasks.value.every((task) => task.status === USER_PLUGIN_INTAKE_STATUS.INSTALLED),
  );

  const busy = computed<boolean>(() =>
    tasks.value.some(
      (task) => task.status === USER_PLUGIN_INTAKE_STATUS.PARSING
        || task.status === USER_PLUGIN_INTAKE_STATUS.INSTALLING,
    ));

  return {
    tasks,
    installableCount,
    allInstalled,
    busy,
    enqueue,
    remove,
    installOne,
    installAll,
    cancelPendingInstalls,
    reset,
  };
};
