/**
 * 同批次插件包的**包间冲突检测**（纯函数，可被 node 冒烟直跑）
 *
 * 批量上传带来一个单包时代不存在的问题：一次会话里塞进来的几个包，可能本来就是
 * 同一个插件的不同版本（作者改了包名重新导出、用户手滑选了两次同一份）。
 * 逐个装是合法的（同 id = 升级 / 接管），但**同一批次里静默装两个同 id** 一定是误操作：
 * 后装的会把先装的顶掉，用户以为装了两份插件，实际只剩最后一个。
 *
 * 仲裁规则刻意做得可预测：**按上传先后顺序，先上传者胜出**（先到先得）。
 * 队列顺序就是用户看到的顺序，不需要另立优先级，也不需要弹出让用户选 ——
 * 后到的包给出「和谁撞了 + 怎么办」的文案，用户自己决定移除哪一个。
 *
 * 与之区分的两类「同 id」**不算冲突**，由安装链路的高层政策处理：
 * - 与已安装记录同 id = 升级 / 覆盖重装；
 * - 与内置插件同 id = 接管内置版（卸载即恢复）。
 *
 * 只吃「已解析出 id」的候选包：解包就失败的包没有 id，无从判定，也不该拖累别人。
 */
import { USER_PLUGIN_PACKAGE_CONFLICT_MESSAGE } from '../constants/plugin.constants';

/** 待仲裁的候选包（**必须按上传先后顺序传入**：先传者胜出） */
export interface PackageConflictCandidate {
  /** 入队任务 uid（回写给谁） */
  uid: string;
  /** 包名（用于告诉用户「和谁撞了」） */
  fileName: string;
  /** 解析出的插件 id（仲裁依据） */
  id: string;
}

/** 一条包间冲突（挂在后上传者身上） */
export interface PackageConflict {
  /** 被判冲突的入队任务 uid */
  uid: string;
  /** 抢占同一 id 的**更早上传**的包名 */
  otherFileName: string;
  /** 面向用户的冲突说明（含「该怎么办」） */
  message: string;
}

/**
 * 按上传顺序检测同批次包之间的插件 id 冲突
 *
 * 先到先得：同一个 id 的**第一个**候选包胜出，其后每一个同 id 候选都被判冲突，
 * 冲突对象一律指向最早那个 —— 三个包同一 id 时，第二、三个都指向第一个。
 * @param candidates 已解析出 id 的候选包（按上传先后顺序；未排序时以数组顺序为准）
 * @returns 冲突列表（每个被判冲突的包一条；无冲突时为空数组）
 */
export const detectPackageConflicts = (
  candidates: readonly PackageConflictCandidate[],
): PackageConflict[] => {
  /** 插件 id → 该 id 的先到者（唯一胜出者） */
  const winners = new Map<string, PackageConflictCandidate>();
  const conflicts: PackageConflict[] = [];
  for (const candidate of candidates) {
    const winner = winners.get(candidate.id);
    if (!winner) {
      winners.set(candidate.id, candidate);
      continue;
    }
    conflicts.push({
      uid: candidate.uid,
      otherFileName: winner.fileName,
      message: USER_PLUGIN_PACKAGE_CONFLICT_MESSAGE(winner.fileName, candidate.id),
    });
  }
  return conflicts;
};
