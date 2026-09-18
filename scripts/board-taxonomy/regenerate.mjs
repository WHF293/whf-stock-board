/**
 * 重生成 `src/constants/board-taxonomy.constants.ts` 的板块归属数据段
 *
 * 背景：A股全景的行业板块直接展示东财 clist（fs=m:90+t:2）的 496 条 ——
 * 那是申万一级 / 二级 / 三级混排。上游**不返回**板块的父级字段，父子关系靠本脚本离线推断：
 * 以 31 个申万一级板块的成分股集合为锚点，算每个板块成分股落在各一级集合内的覆盖率，取最大者。
 *
 * 上游新增 / 下线板块后重跑本脚本即可（会把新结果写回 constants 的 AUTO-GENERATED 段）。
 *
 * 用法：
 *   node scripts/board-taxonomy/regenerate.mjs            # 写回 constants
 *   node scripts/board-taxonomy/regenerate.mjs --dry-run  # 只打印报告，不改文件
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const CONSTANTS_PATH = join(ROOT, 'src', 'constants', 'board-taxonomy.constants.ts');
const CALENDAR_PATH = join(ROOT, 'src', 'constants', 'board-calendar.constants.ts');

const DRY_RUN = process.argv.includes('--dry-run');

/** 东财 push2delay 域：本地实测连通性最稳（push2 主域在本机不通） */
const HOST = 'https://push2delay.eastmoney.com/api/qt/clist/get';
/** 行业板块分类码 */
const FS_INDUSTRY = 'm:90+t:2';
/** 单页上限 */
const PAGE_SIZE = 100;
/** 请求间隔（ms），控制频率 */
const THROTTLE_MS = 90;
/** 最高覆盖率低于此值视为无法判定（不写入映射，交给 UI 的「未归类」兜底） */
const MIN_COVERAGE = 0.5;
/** 与次选分差低于此值视为歧义（写入但告警） */
const AMBIGUOUS_GAP = 0.15;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 从 board-calendar.constants.ts 解析申万一级行业清单（避免两处各维护一份）
 * @returns {{code: string, name: string}[]} 31 个申万一级板块
 */
function readSwLevel1Boards() {
  const source = readFileSync(CALENDAR_PATH, 'utf8');
  const start = source.indexOf('export const SW_LEVEL1_BOARDS');
  const end = source.indexOf('追加板块');
  const section = source.slice(start, end === -1 ? undefined : end);
  return [...section.matchAll(/\{ code: '([^']+)', name: '([^']+)' \}/g)].map((m) => ({
    code: m[1],
    name: m[2],
  }));
}

/**
 * 拉取东财 clist 全量分页
 *
 * ⚠️ 必须按代码（fid=f12&po=0）排序分页，**不能用默认的按涨跌幅（fid=f3）**：
 * 本接口单页上限 100、行业板块有 496 条需 5 页，而按涨跌幅排序时相邻两次请求之间
 * 行情在变，板块会跨页漂移 —— 实测两次抓取分别得到 494 / 496 个唯一板块
 * （同一 code 重复出现、另一些被挤掉）。按代码排序时顺序只受增删板块影响，稳定。
 * @param {string} fs 市场分类码
 * @param {string} fields 取值字段
 * @returns {Promise<object[]>} diff 原始条目
 */
async function fetchClistAll(fs, fields) {
  const all = [];
  let total = null;
  for (let pn = 1; pn <= 20; pn += 1) {
    const query = `pn=${pn}&pz=${PAGE_SIZE}&po=0&np=1&fltt=2&invt=2&fid=f12&fs=${fs}&fields=${fields}`;
    let body;
    for (let retry = 0; retry < 3; retry += 1) {
      const res = await fetch(`${HOST}?${query}`, {
        headers: { Referer: 'https://quote.eastmoney.com/' },
      });
      body = await res.json();
      if (body?.data?.diff) break;
      await sleep(400);
    }
    const diff = body?.data?.diff ?? [];
    if (diff.length === 0) break;
    total ??= body?.data?.total ?? null;
    all.push(...diff);
    if (all.length >= (total ?? 0)) break;
    await sleep(THROTTLE_MS);
  }
  if (total !== null && all.length !== total) {
    throw new Error(`分页抓取不完整：上游 total=${total}，实收 ${all.length} 条 —— 重跑本脚本`);
  }
  return all;
}

/**
 * 拉取某板块全量成分股代码
 * @param {string} code 板块代码（BKxxxx）
 * @returns {Promise<string[]>} 成分股 6 位代码
 */
async function fetchMembers(code) {
  const rows = await fetchClistAll(`b:${code}`, 'f12');
  return rows.map((row) => row.f12);
}

console.log('1/4 读取申万一级清单 …');
const swLevel1 = readSwLevel1Boards();
if (swLevel1.length !== 31) {
  throw new Error(`申万一级解析到 ${swLevel1.length} 条，预期 31 条 —— 检查 board-calendar.constants.ts`);
}
console.log(`    31 个一级行业 ✓`);

console.log('2/4 拉取行业板块全量清单 …');
const boardRows = await fetchClistAll(FS_INDUSTRY, 'f12,f14');
/** 上游对个别板块会重复返回（实测 BK1435 / BK1476 各 2 次），按 code 去重 */
const boards = [];
const seenCode = new Set();
for (const row of boardRows) {
  if (seenCode.has(row.f12)) continue;
  seenCode.add(row.f12);
  boards.push({ code: row.f12, name: row.f14 });
}
console.log(`    上游 ${boardRows.length} 条 → 去重后 ${boards.length} 个板块`);

console.log('3/4 拉取 31 个一级板块成分股（锚点）…');
const anchors = new Map();
const anchorCodes = new Set();
for (const board of swLevel1) {
  anchors.set(board.name, new Set(await fetchMembers(board.code)));
  anchorCodes.add(board.code);
  await sleep(THROTTLE_MS);
}
const union = new Set();
for (const set of anchors.values()) for (const code of set) union.add(code);
let overlapPairs = 0;
const names = [...anchors.keys()];
for (let i = 0; i < names.length; i += 1) {
  for (let j = i + 1; j < names.length; j += 1) {
    for (const code of anchors.get(names[i])) {
      if (anchors.get(names[j]).has(code)) {
        overlapPairs += 1;
        break;
      }
    }
  }
}
console.log(`    锚点并集 ${union.size} 只股票，一级之间重叠 ${overlapPairs} 组`);

console.log('4/4 推断归属 …');
/** 分组结果：industry → code[] */
const grouped = new Map(names.map((name) => [name, []]));
const warnings = [];
let unassigned = 0;

for (const board of boards) {
  if (anchorCodes.has(board.code)) continue;
  const members = await fetchMembers(board.code);
  await sleep(THROTTLE_MS);
  if (members.length === 0) {
    warnings.push(`${board.name}(${board.code})：无成分股，跳过`);
    unassigned += 1;
    continue;
  }
  const scores = names
    .map((name) => {
      const set = anchors.get(name);
      let hit = 0;
      for (const code of members) if (set.has(code)) hit += 1;
      return { name, rate: hit / members.length };
    })
    .sort((a, b) => b.rate - a.rate);
  const [top, second] = scores;
  if (top.rate < MIN_COVERAGE) {
    warnings.push(
      `${board.name}(${board.code})：最高覆盖率仅 ${(top.rate * 100).toFixed(1)}%（${top.name}），未归类`,
    );
    unassigned += 1;
    continue;
  }
  if (second && top.rate - second.rate < AMBIGUOUS_GAP) {
    warnings.push(
      `${board.name}(${board.code})：${top.name} ${(top.rate * 100).toFixed(1)}% vs ` +
        `${second.name} ${(second.rate * 100).toFixed(1)}%，归属存疑`,
    );
  }
  grouped.get(top.name).push(board.code);
}

const assigned = [...grouped.values()].reduce((sum, list) => sum + list.length, 0);
console.log('');
console.log(`结果：${assigned} 个细分板块已归类，${unassigned} 个未归类，${warnings.length} 条告警`);
for (const warning of warnings) console.log(`  ⚠️ ${warning}`);

/** 生成 AUTO-GENERATED 段 */
const lines = ['  // AUTO-GENERATED-START（本段由 scripts/board-taxonomy/regenerate.mjs 整体重写，勿手工编辑）'];
for (const board of swLevel1) {
  const codes = grouped.get(board.name).sort();
  if (codes.length === 0) continue;
  lines.push('  {');
  lines.push(`    industry: '${board.name}',`);
  lines.push('    codes: [');
  for (let i = 0; i < codes.length; i += 8) {
    lines.push(`      ${codes.slice(i, i + 8).map((code) => `'${code}'`).join(', ')},`);
  }
  lines.push('    ],');
  lines.push('  },');
}
lines.push('  // AUTO-GENERATED-END');

if (DRY_RUN) {
  console.log('\n--- dry-run，未写回文件。生成内容预览 ---');
  console.log(lines.slice(0, 12).join('\n'));
  process.exit(0);
}

const source = readFileSync(CONSTANTS_PATH, 'utf8');
const startTag = '  // AUTO-GENERATED-START（本段由 scripts/board-taxonomy/regenerate.mjs 整体重写，勿手工编辑）';
const endTag = '  // AUTO-GENERATED-END';
const startIndex = source.indexOf(startTag);
const endIndex = source.indexOf(endTag);
if (startIndex === -1 || endIndex === -1) {
  throw new Error('constants 里找不到 AUTO-GENERATED 标记段，无法写回');
}
const next =
  source.slice(0, startIndex) +
  lines.join('\n') +
  source.slice(endIndex + endTag.length);
writeFileSync(CONSTANTS_PATH, next, 'utf8');
console.log(`\n已写回 ${CONSTANTS_PATH}`);
console.log(`覆盖板块数：${assigned + swLevel1.length}（31 个一级 + ${assigned} 个细分）`);
