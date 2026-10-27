/**
 * 归一化用户输入的 GitHub 仓库地址为 `owner/repo`
 *
 * 插件市场添加第三方源时，用户可能输入完整 URL（带 .git / 尾斜杠 / tree 子路径）、
 * 无协议简写（`github.com/owner/repo`）或裸 `owner/repo`，这里统一收敛；
 * 解析不出 owner / repo 两段时报错，不猜测（错一个字符就是另一个仓库的代码）。
 */

/** github.com 域名（含 www） */
const GITHUB_HOST_PATTERN = /^(?:www\.)?github\.com$/i;

/** owner / repo 单段合法性（GitHub 命名超集：字母数字下划线点连字符） */
const SEGMENT_PATTERN = /^[\w.-]+$/;

/** 无法解析时的统一报错文案 */
const ERR_MESSAGE = '无法识别仓库地址，请输入 owner/repo 或 GitHub 仓库页面地址';

/**
 * 校验并拼出仓库全名
 * @param owner 归属段
 * @param repoName 仓库段（剥 .git 后缀）
 * @returns `owner/repo`
 * @throws Error 段缺失或不合法时抛出
 */
const buildRepo = (owner: string | undefined, repoName: string | undefined): string => {
  const repo = repoName?.replace(/\.git$/i, '');
  if (!owner || !repo || !SEGMENT_PATTERN.test(owner) || !SEGMENT_PATTERN.test(repo)) {
    throw new Error(ERR_MESSAGE);
  }
  return `${owner}/${repo}`;
};

/**
 * 从输入解析并归一化 GitHub 仓库全名
 * @param input 用户输入（`owner/repo` 或 github.com 仓库 URL / 无协议简写）
 * @returns `owner/repo`（原样保留大小写；去首尾空白）
 * @throws Error 输入无法解析出 owner / repo 两段时抛出（message 可直接展示）
 */
export const normalizeRepoInput = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error('请输入仓库地址');
  // 含 github.com 一律按 URL 解析：无协议先补 https://，交给 WHATWG 归一化
  // （顺带吃掉 /tree/<分支>/ 子路径、尾斜杠、//，并防 `..` 穿越段）
  if (trimmed.includes('github.com')) {
    try {
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const url = new URL(withScheme);
      if (!GITHUB_HOST_PATTERN.test(url.hostname.toLowerCase())) {
        throw new Error(ERR_MESSAGE);
      }
      const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
      return buildRepo(segments[0], segments[1]);
    } catch (error) {
      // 明确给了 URL 却解析不出：不退回裸拆分（那会把域名当 owner），直接报错
      throw error instanceof Error && error.message === ERR_MESSAGE
        ? error
        : new Error(ERR_MESSAGE);
    }
  }
  // 裸 owner/repo 形态（含首尾斜杠容错）
  const segments = trimmed.replace(/^\/+|\/+$/g, '').split('/').filter((segment) => segment.length > 0);
  return buildRepo(segments[0], segments[1]);
};
