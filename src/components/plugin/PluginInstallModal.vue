<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import BaseTag from '../ui/BaseTag.vue';
import { auditPluginClassNames } from '../../plugin/user-plugin-class-audit';
import { importUserPluginCode } from '../../plugin/user-plugin-loader';
import { BUILTIN_PLUGINS } from '../../plugins';
import { useUserPlugins } from '../../composables/use-user-plugins';
import { useUserPluginsStore } from '../../stores/user-plugins';
import { checkManifestConsistency, parsePluginPackage } from '../../utils/plugin-package';
import {
  USER_PLUGIN_AUTHOR_LABEL,
  USER_PLUGIN_PACKAGE_ACCEPT,
  USER_PLUGIN_SOURCE,
} from '../../constants/plugin.constants';
import type { PluginPackage } from '../../utils/plugin-package';
import type { PluginDefinition } from '../../types/plugin.types';

/**
 * 插件安装弹窗（应用内安装用户插件，支持 zip 包批量安装）
 *
 * 两种来源，同一条安装链路：
 * - **zip 插件包**（第三方分发的常态）：manifest.json + 入口产物 + 可选 README，
 *   解包后取入口产物代码 → 静态预检 → 结构校验 → 清单一致性校验 → 安装；
 *   文件选择框可**多选**，一次批量装多个插件（逐条校验、逐个安装、汇总结果）。
 * - **粘贴 / 选择单文件 JS**：给作者自己调试用，同一条链路，只是没有清单。
 *
 * 底部主按钮按流程**分步**出现（一次只有一个动作，走完一步换下一个）：
 * 「选择 .zip 文件」→「解析预览」→「确认安装」；批量安装结束若有失败，变为「完成」收尾。
 * 插件代码与应用同权限执行，弹窗内有固定风险提示。
 */
const open = defineModel<boolean>('open', { required: true });

const { install } = useUserPlugins();
const userPluginsStore = useUserPluginsStore();

/** 安装来源切换选项 */
const SOURCE_OPTIONS = [
  { label: 'zip 插件包', value: 'package' },
  { label: '粘贴代码', value: 'code' },
] as const;

/** README 预览最多展示的字符数（包内文档可能很长，弹窗里只给个开头） */
const README_PREVIEW_MAX = 600;

/**
 * zip 批量安装时的单个候选包（一个 .zip 文件对应一条）
 *
 * 状态沿「解包 → 解析 → 安装」三段推进，每段的错误都挂在条目自己身上，
 * 批量时互不牵连：一个包坏了不影响其余包继续安装。
 */
interface PackageCandidate {
  /** 列表 key（同批可能出现同名文件，用自增序号保证唯一） */
  uid: number;
  /** 来源 zip 文件名（展示用） */
  fileName: string;
  /** zip 解包结果（null = 解包失败） */
  pkg: PluginPackage | null;
  /** 解包失败原因（成功为空串） */
  pkgError: string;
  /** 入口产物代码（解包成功才有） */
  code: string;
  /** 解析预览通过的插件定义（null = 未通过或还没解析） */
  definition: PluginDefinition | null;
  /** 解析预览失败原因（通过为空串） */
  parseError: string;
  /** 静态预检 / 样式审计的非致命提醒（带行号，能装但可能显示异常） */
  warningLines: readonly string[];
  /** 覆盖升级提示（首次安装为空串） */
  upgradeHint: string;
  /** 接管内置版提示（不涉及为空串） */
  takeoverHint: string;
  /** 是否覆盖安装（同 id 已装过 = 升级 / 重装） */
  upgraded: boolean;
  /** 是否接管内置版（同 id 且随应用分发了内置实现） */
  takeover: boolean;
  /** 本次是否安装它（批量列表的勾选态；解析失败一律 false） */
  selected: boolean;
  /** 单条安装进度 */
  installState: 'pending' | 'installing' | 'ok' | 'fail';
  /** 安装失败原因（成功 / 未安装为空串） */
  installError: string;
}

/** 候选条目状态标签 */
interface CandidateStatus {
  /** 标签文案 */
  label: string;
  /** 标签色调（错误用 up 语义色，与弹窗内错误块一致） */
  tone: 'primary' | 'up' | 'flat';
}

/** 底部主按钮当前所处的流程步骤（选文件 → 解析预览 → 确认安装 / 完成） */
type FooterStep = 'pick' | 'parse' | 'install' | 'done';

/** 当前安装来源（zip 包 / 单文件代码） */
const mode = ref<'package' | 'code'>('package');

/** 代码输入框内容（粘贴代码模式；zip 模式的代码在候选条目里，不进文本框） */
const code = ref('');

/** 当前选中的本地文件名（粘贴代码模式展示用） */
const fileName = ref('');

/** zip 包解析出的插件定义预览（粘贴代码模式专用；null = 尚未解析或解析失败） */
const parsed = ref<PluginDefinition | null>(null);

/** 解析 / 安装的错误文案（粘贴代码模式专用；zip 模式的错误挂在各候选条目上） */
const errorMessage = ref('');

/** 静态预检的非致命提醒（粘贴代码模式专用） */
const warningLines = ref<string[]>([]);

/** zip 模式的候选条目（未选文件时为空数组） */
const candidates = ref<PackageCandidate[]>([]);

/** 隐藏的 zip 文件选择框（底部「选择 .zip 文件」主按钮与正文右上角入口共用） */
const zipInputRef = ref<HTMLInputElement | null>(null);

/** 候选条目自增序号（列表 key 用，同批可能出现同名文件） */
let candidateSeq = 0;

/** 解析 / 安装进行中（动态 import 是异步的，期间禁用按钮防重复提交） */
const busy = ref(false);

/** 批量安装进度（total 为 0 表示没有安装任务在进行或已完成） */
const installProgress = ref({ done: 0, total: 0 });

/** 批量安装是否已跑完一轮（有失败时留在弹窗内，底部主按钮变「完成」） */
const installDone = ref(false);

/** 是否为批量安装（zip 模式选了多于一个包；批量列表才显示勾选框） */
const isBatch = computed(() => mode.value === 'package' && candidates.value.length > 1);

/** 校验通过的候选条数 */
const validCount = computed(() => candidates.value.filter((c) => c.definition !== null).length);

/** 勾选待装的候选数（批量安装按钮文案与可点判定用） */
const selectedCount = computed(
  () => candidates.value.filter((c) => c.definition !== null && c.selected).length,
);

/** 本轮批量安装成功的条数 */
const installOkCount = computed(() => candidates.value.filter((c) => c.installState === 'ok').length);

/** 本轮批量安装失败的条数 */
const installFailCount = computed(
  () => candidates.value.filter((c) => c.installState === 'fail').length,
);

/** 安装完成汇总文案（全部成功时只报成功数，有失败附带去向说明） */
const installSummary = computed(() => {
  let text = `安装完成：成功 ${installOkCount.value} 个`;
  if (installFailCount.value > 0) {
    text += `、失败 ${installFailCount.value} 个（原因见对应条目，可重新选择 .zip 文件重试）`;
  }
  return `${text}。`;
});

/** 待覆盖的旧安装记录（粘贴代码模式预览用；null = 首次安装） */
const existingRecord = computed(() => {
  const id = parsed.value?.id;
  if (!id) return null;
  return userPluginsStore.records.find((record) => record.id === id) ?? null;
});

/** 本次会接管的内置插件定义（粘贴代码模式预览用） */
const builtinConflict = computed(() => {
  const id = parsed.value?.id;
  if (!id) return null;
  return BUILTIN_PLUGINS.find((plugin) => plugin.id === id) ?? null;
});

/** 覆盖安装 / 接管安装的提示（粘贴代码模式预览用；首次安装时为空串） */
const upgradeHint = computed(() => {
  const previous = existingRecord.value;
  if (!previous || !parsed.value) return '';
  const same = previous.version === parsed.value.version;
  return same
    ? `已安装 v${previous.version}，本次将覆盖重装（插件数据表保留）`
    : `已安装 v${previous.version}，本次将升级到 v${parsed.value.version}（插件数据表保留）`;
});

/** 接管内置版本的提示（粘贴代码模式预览用） */
const takeoverHint = computed(() => {
  if (!builtinConflict.value || existingRecord.value || !parsed.value) return '';
  return `内置版 v${builtinConflict.value.version} 将被本版本接管；卸载本插件即刻恢复内置实现`;
});

/** 底部主按钮所处步骤（决定按钮文案与动作，见组件注释的分步说明） */
const footerStep = computed<FooterStep>(() => {
  if (mode.value === 'package') {
    if (candidates.value.length === 0) return 'pick';
    if (installDone.value) return 'done';
    if (validCount.value > 0) return 'install';
    return 'parse';
  }
  return parsed.value ? 'install' : 'parse';
});

/** 「解析预览」是否可点（没有可解析的内容时置灰） */
const canParse = computed(() => {
  if (busy.value) return false;
  if (mode.value === 'package') return candidates.value.length > 0;
  return code.value.trim().length > 0;
});

/** 「确认安装」是否可点（批量看勾选数，单发看是否已解析通过） */
const canInstall = computed(() => {
  if (busy.value) return false;
  if (mode.value === 'package') return selectedCount.value > 0;
  return parsed.value !== null;
});

/** 安装按钮文案（说清楚这次到底是装、升级还是接管，避免误以为装出第二份） */
const installLabel = computed(() => {
  if (mode.value === 'package') {
    if (isBatch.value) return `确认安装（${selectedCount.value} 个）`;
    const only = candidates.value[0];
    if (only?.upgraded) return '确认升级';
    if (only?.takeover) return '确认接管安装';
    return '确认安装';
  }
  if (existingRecord.value) return '确认升级';
  if (builtinConflict.value) return '确认接管安装';
  return '确认安装';
});

/** 粘贴代码模式的预览元信息行（name / version / id / author） */
const metaLines = computed(() => {
  if (!parsed.value) return [];
  return [
    `id：${parsed.value.id}`,
    `版本：v${parsed.value.version}`,
    `作者：${parsed.value.author || USER_PLUGIN_AUTHOR_LABEL}`,
  ];
});

/**
 * 清空粘贴代码模式的解析态（换来源 / 改代码时都要重来）
 */
const resetCodeState = (): void => {
  parsed.value = null;
  errorMessage.value = '';
  warningLines.value = [];
};

/**
 * 清空 zip 包模式状态（换文件 / 切来源 / 打开弹窗时）
 */
const resetPackageState = (): void => {
  candidates.value = [];
  installProgress.value = { done: 0, total: 0 };
  installDone.value = false;
};

/** 打开弹窗时重置表单 */
watch(open, (value) => {
  if (!value) return;
  mode.value = 'package';
  code.value = '';
  fileName.value = '';
  resetPackageState();
  resetCodeState();
  busy.value = false;
});

/** 切换来源时清掉另一侧的残留（避免装到旧内容） */
watch(mode, () => {
  code.value = '';
  fileName.value = '';
  resetPackageState();
  resetCodeState();
});

/**
 * 新建一个待解析的候选条目
 * @param fileName 来源 zip 文件名
 * @returns 空白候选条目
 */
const createCandidate = (fileName: string): PackageCandidate => {
  candidateSeq += 1;
  return {
    uid: candidateSeq,
    fileName,
    pkg: null,
    pkgError: '',
    code: '',
    definition: null,
    parseError: '',
    warningLines: [],
    upgradeHint: '',
    takeoverHint: '',
    upgraded: false,
    takeover: false,
    selected: false,
    installState: 'pending',
    installError: '',
  };
};

/**
 * 计算候选条目的状态标签（按安装结果 → 包错误 → 解析结果 → 待解析取最高优先级）
 * @param candidate 候选条目
 * @returns 状态标签；无可展示状态时为 null
 */
const candidateStatus = (candidate: PackageCandidate): CandidateStatus | null => {
  if (candidate.installState === 'ok') return { label: '已安装', tone: 'primary' };
  if (candidate.installState === 'installing') return { label: '安装中…', tone: 'flat' };
  if (candidate.installState === 'fail') return { label: '安装失败', tone: 'up' };
  if (candidate.pkgError) return { label: '读取失败', tone: 'up' };
  if (candidate.parseError) return { label: '解析失败', tone: 'up' };
  if (candidate.definition) return { label: '校验通过', tone: 'primary' };
  if (candidate.pkg) return { label: '待解析', tone: 'flat' };
  return null;
};

/**
 * 候选条目状态标签文案（模板用，避免非空断言）
 * @param candidate 候选条目
 * @returns 文案（无状态时为空串，标签不渲染）
 */
const candidateStatusLabel = (candidate: PackageCandidate): string =>
  candidateStatus(candidate)?.label ?? '';

/**
 * 候选条目状态标签色调（模板用，避免非空断言）
 * @param candidate 候选条目
 * @returns 色调（无状态时退化为 flat）
 */
const candidateStatusTone = (candidate: PackageCandidate): CandidateStatus['tone'] =>
  candidateStatus(candidate)?.tone ?? 'flat';

/**
 * 候选条目的包信息行（入口 / 包内文件数 / 清单有无）
 * @param candidate 候选条目
 * @returns 信息行文本（未解包成功时为空串）
 */
const packageLineText = (candidate: PackageCandidate): string => {
  const pkg = candidate.pkg;
  if (!pkg) return '';
  return [
    `入口：${pkg.entryPath}`,
    `包内 ${pkg.files.length} 个文件`,
    pkg.hasManifest ? '含 manifest.json' : '无 manifest.json（元信息取自产物）',
  ].join(' · ');
};

/**
 * 候选条目的定义元信息行（id / 版本 / 作者，解析通过后展示）
 * @param candidate 候选条目
 * @returns 信息行文本（未解析通过时为空串）
 */
const metaLineText = (candidate: PackageCandidate): string => {
  const definition = candidate.definition;
  if (!definition) return '';
  return [
    `id：${definition.id}`,
    `版本：v${definition.version}`,
    `作者：${definition.author || candidate.pkg?.manifest.author || USER_PLUGIN_AUTHOR_LABEL}`,
  ].join(' · ');
};

/**
 * 候选条目的 README 预览文本（超长截断）
 * @param candidate 候选条目
 * @returns 预览文本（无 README 为空串）
 */
const readmeText = (candidate: PackageCandidate): string => {
  const text = candidate.pkg?.readme ?? '';
  if (text.length <= README_PREVIEW_MAX) return text;
  return `${text.slice(0, README_PREVIEW_MAX)}…`;
};

/**
 * 填充候选条目的升级 / 接管提示与默认勾选态（解析通过后调用）
 * @param candidate 候选条目
 */
const applyCandidateHints = (candidate: PackageCandidate): void => {
  const definition = candidate.definition;
  if (!definition) {
    candidate.upgraded = false;
    candidate.takeover = false;
    candidate.upgradeHint = '';
    candidate.takeoverHint = '';
    candidate.selected = false;
    return;
  }
  const previous = userPluginsStore.records.find((record) => record.id === definition.id) ?? null;
  const builtin = BUILTIN_PLUGINS.find((plugin) => plugin.id === definition.id) ?? null;
  candidate.upgraded = previous !== null;
  candidate.takeover = builtin !== null && previous === null;
  if (previous) {
    const same = previous.version === definition.version;
    candidate.upgradeHint = same
      ? `已安装 v${previous.version}，本次将覆盖重装（插件数据表保留）`
      : `已安装 v${previous.version}，本次将升级到 v${definition.version}（插件数据表保留）`;
  } else {
    candidate.upgradeHint = '';
  }
  candidate.takeoverHint = candidate.takeover
    ? `内置版 v${builtin?.version} 将被本版本接管；卸载本插件即刻恢复内置实现`
    : '';
  candidate.selected = true;
};

/**
 * 同批去重：同 id 的插件一次只能装一份，同 id 的后续包标为解析失败
 *
 * 不拦住会先后装出两份同 id 插件（后者覆盖前者），用户还以为批量装了两个插件。
 */
const dedupeCandidatesById = (): void => {
  const seen = new Map<string, string>();
  for (const candidate of candidates.value) {
    const id = candidate.definition?.id;
    if (!id) continue;
    const firstFile = seen.get(id);
    if (firstFile) {
      candidate.definition = null;
      candidate.parseError = `插件 id 与「${firstFile}」重复，同一批只能安装一个`;
      candidate.selected = false;
      continue;
    }
    seen.set(id, candidate.fileName);
  }
};

/**
 * 选择 zip 插件包（可多选）并逐个解包
 *
 * 解包（读清单 / 定位入口）在选文件时就地完成、就地报错；代码级校验留给「解析预览」。
 * @param event 文件选择框 change 事件
 */
const onPickPackage = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length === 0) return;
  resetPackageState();
  const list: PackageCandidate[] = [];
  for (const file of files) {
    const candidate = createCandidate(file.name);
    try {
      const parsedPackage = parsePluginPackage(await file.arrayBuffer());
      candidate.pkg = parsedPackage;
      candidate.code = parsedPackage.code;
    } catch (error) {
      candidate.pkgError = error instanceof Error ? error.message : String(error);
    }
    list.push(candidate);
  }
  candidates.value = list;
};

/** 批量解析预览：逐条跑静态预检 + 结构校验 + 清单一致性，只校验不安装 */
const onParsePackages = async (): Promise<void> => {
  busy.value = true;
  for (const candidate of candidates.value) {
    candidate.definition = null;
    candidate.parseError = '';
    candidate.warningLines = [];
    candidate.installState = 'pending';
    candidate.installError = '';
    if (!candidate.pkg) continue;
    // 复用安装链路的前半段（静态预检 + import + 结构校验），但不落存储与内核
    const result = await importUserPluginCode(candidate.code, []);
    candidate.warningLines = [...(result.warnings ?? []), ...auditPluginClassNames(candidate.code)].map(
      (issue) => `第 ${issue.line} 行：${issue.message}`,
    );
    if (!result.ok) {
      candidate.parseError = result.error;
      continue;
    }
    // zip 包：清单与产物必须一致，否则「包里写一套、装进去是另一套」
    const inconsistency = checkManifestConsistency(candidate.pkg.manifest, result.definition);
    if (inconsistency) {
      candidate.parseError = inconsistency;
      continue;
    }
    candidate.definition = result.definition;
  }
  dedupeCandidatesById();
  for (const candidate of candidates.value) applyCandidateHints(candidate);
  busy.value = false;
};

/** 批量安装：逐个安装勾选的候选（顺序执行，单条失败不中断其余）；全数成功才收起弹窗 */
const onInstallPackages = async (): Promise<void> => {
  const targets = candidates.value.filter((candidate) => candidate.selected && candidate.definition);
  if (targets.length === 0) return;
  busy.value = true;
  installProgress.value = { done: 0, total: targets.length };
  for (const candidate of targets) {
    candidate.installState = 'installing';
    const result = await install(candidate.code, {
      manifest: candidate.pkg?.manifest,
      source: USER_PLUGIN_SOURCE.PACKAGE,
    });
    if (result.ok) {
      candidate.installState = 'ok';
    } else {
      candidate.installState = 'fail';
      candidate.installError = result.error;
    }
    installProgress.value = { ...installProgress.value, done: installProgress.value.done + 1 };
  }
  busy.value = false;
  installDone.value = true;
  // 全部成功才自动收起；有失败则留在弹窗里逐条看原因，底部主按钮换「完成」
  if (installFailCount.value === 0) open.value = false;
};

/** 粘贴代码模式的解析预览：只校验，不安装 */
const onParseCode = async (): Promise<void> => {
  resetCodeState();
  busy.value = true;
  // 复用安装链路的前半段（静态预检 + import + 结构校验 + id 占用检查），但不落存储与内核
  // 内置 id 与已装过的 id 都**不算占用**：前者是接管、后者是升级，
  // 都由 install 的高层政策处理；交给底层只会得到一句「已被占用」，用户无从下手。
  const result = await importUserPluginCode(code.value, []);
  busy.value = false;
  warningLines.value = [...(result.warnings ?? []), ...auditPluginClassNames(code.value)].map(
    (issue) => `第 ${issue.line} 行：${issue.message}`,
  );
  if (!result.ok) {
    errorMessage.value = result.error;
    return;
  }
  parsed.value = result.definition;
};

/** 粘贴代码模式的确认安装：写持久化 + 内核挂载，成功后收起弹窗 */
const onInstallCode = async (): Promise<void> => {
  if (!parsed.value) return;
  busy.value = true;
  const result = await install(code.value, { source: USER_PLUGIN_SOURCE.CODE });
  busy.value = false;
  warningLines.value = [...(result.warnings ?? []), ...auditPluginClassNames(code.value)].map(
    (issue) => `第 ${issue.line} 行：${issue.message}`,
  );
  if (result.ok) {
    open.value = false;
    return;
  }
  errorMessage.value = result.error;
  parsed.value = null;
};

/** 底部「解析预览」入口（按当前来源分发到批量 / 单发链路） */
const onParse = async (): Promise<void> => {
  if (mode.value === 'package') {
    await onParsePackages();
    return;
  }
  await onParseCode();
};

/** 底部「确认安装」入口（按当前来源分发到批量 / 单发链路） */
const onInstall = async (): Promise<void> => {
  if (mode.value === 'package') {
    await onInstallPackages();
    return;
  }
  await onInstallCode();
};

/**
 * 选择本地 .js 文件读入文本框（粘贴代码模式）
 * @param event 文件选择框 change 事件
 */
const onPickFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  code.value = await file.text();
  resetCodeState();
  input.value = '';
};
</script>

<template>
  <BaseModal v-model:open="open" title="安装插件" max-width-class="max-w-xl">
    <div class="rounded-card border border-primary/30 bg-primary-weak/60 px-3 py-2 text-xs text-text-secondary">
      ⚠️ 插件代码会以与应用相同的权限运行，请只安装来源可信的插件。
    </div>

    <div class="mt-3">
      <BaseTabs v-model="mode" :options="SOURCE_OPTIONS" />
    </div>

    <div v-if="mode === 'package'" class="mt-3">
      <input
        ref="zipInputRef"
        type="file"
        :accept="USER_PLUGIN_PACKAGE_ACCEPT"
        multiple
        class="hidden"
        @change="onPickPackage"
      />
      <div class="flex items-center justify-between">
        <p class="text-xs text-text-tertiary">选择第三方打包好的 .zip 插件包（可多选批量安装）</p>
        <button
          type="button"
          class="cursor-pointer text-xs text-primary hover:underline"
          @click="zipInputRef?.click()"
        >
          选择 .zip 文件
        </button>
      </div>
      <p v-if="candidates.length === 0" class="mt-2 text-xs text-text-tertiary">
        包内需含入口产物（默认 main.js），建议带 manifest.json 与 README.md。
      </p>
      <template v-else>
        <div
          v-if="busy && installProgress.total > 0"
          class="mt-2 rounded-card border border-primary/30 bg-primary-weak/60 px-3 py-2 text-xs text-primary"
        >
          正在安装 {{ installProgress.done }}/{{ installProgress.total }}…
        </div>
        <div
          v-else-if="installDone"
          class="mt-2 rounded-card border border-flat-weak bg-surface px-3 py-2 text-xs text-text-secondary"
        >
          {{ installSummary }}
        </div>
        <ul class="mt-2 space-y-2">
          <li
            v-for="candidate in candidates"
            :key="candidate.uid"
            class="rounded-card border border-flat-weak bg-surface px-3 py-2"
          >
            <div class="flex items-start gap-2">
              <input
                v-if="isBatch && candidate.pkg"
                v-model="candidate.selected"
                type="checkbox"
                class="accent-primary mt-0.5"
                :disabled="busy"
                :aria-label="`安装 ${candidate.fileName}`"
              />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-medium text-text">
                    {{ candidate.pkg?.manifest.name || candidate.fileName }}
                  </span>
                  <BaseTag v-if="candidate.pkg?.manifest.version" tone="flat">
                    v{{ candidate.pkg.manifest.version }}
                  </BaseTag>
                  <BaseTag v-if="candidateStatusLabel(candidate)" :tone="candidateStatusTone(candidate)">
                    {{ candidateStatusLabel(candidate) }}
                  </BaseTag>
                </div>
                <p v-if="candidate.pkg?.manifest.description" class="mt-1 text-xs text-text-secondary">
                  {{ candidate.pkg.manifest.description }}
                </p>
                <p v-if="candidate.pkg" class="mt-1 text-xs text-text-tertiary">
                  {{ packageLineText(candidate) }}
                </p>
                <p v-if="candidate.definition" class="mt-1 text-xs text-text-tertiary">
                  {{ metaLineText(candidate) }}
                </p>
                <p v-if="candidate.upgradeHint" class="mt-1.5 text-xs text-primary">
                  {{ candidate.upgradeHint }}
                </p>
                <p v-if="candidate.takeoverHint" class="mt-1.5 text-xs text-primary">
                  {{ candidate.takeoverHint }}
                </p>
                <p v-if="candidate.pkgError" class="mt-1.5 whitespace-pre-line text-xs text-up">
                  {{ candidate.pkgError }}
                </p>
                <p v-if="candidate.parseError" class="mt-1.5 whitespace-pre-line text-xs text-up">
                  {{ candidate.parseError }}
                </p>
                <p v-if="candidate.installError" class="mt-1.5 whitespace-pre-line text-xs text-up">
                  {{ candidate.installError }}
                </p>
                <p
                  v-for="line in candidate.warningLines"
                  :key="line"
                  class="mt-0.5 whitespace-pre-line text-xs text-text-secondary"
                >
                  {{ line }}
                </p>
                <details v-if="!isBatch && candidate.pkg?.readme" class="mt-2 text-xs text-text-tertiary">
                  <summary class="cursor-pointer select-none hover:text-text-secondary">README</summary>
                  <pre
                    class="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-card bg-flat-weak px-2.5 py-2 font-mono text-xs leading-relaxed text-text-secondary"
                  >{{ readmeText(candidate) }}</pre>
                </details>
              </div>
            </div>
          </li>
        </ul>
      </template>
    </div>

    <div v-else class="mt-3">
      <div class="mb-1.5 flex items-center justify-between">
        <p class="text-xs text-text-tertiary">插件代码（预构建 ESM JS，export default { … }）</p>
        <label class="cursor-pointer text-xs text-primary hover:underline">
          选择本地 .js 文件
          <input type="file" accept=".js,.mjs,text/javascript" class="hidden" @change="onPickFile" />
        </label>
      </div>
      <p v-if="fileName" class="mb-1 text-xs text-text-tertiary">已读取：{{ fileName }}</p>
      <textarea
        v-model="code"
        rows="9"
        spellcheck="false"
        placeholder="export default { id: 'my-plugin', name: '我的插件', version: '1.0.0', description: '…', apply(ctx) { … } }"
        class="w-full resize-y rounded-card border border-flat-weak bg-surface px-3 py-2 font-mono text-xs text-text outline-none focus:border-primary"
        @input="resetCodeState"
      />
    </div>

    <div v-if="errorMessage" class="mt-2 whitespace-pre-line rounded-card border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">
      {{ errorMessage }}
    </div>

    <div v-if="warningLines.length > 0" class="mt-2 rounded-card border border-primary/30 bg-primary-weak/60 px-3 py-2">
      <p class="text-xs font-medium text-primary">能装，但可能显示不正常：</p>
      <p v-for="line in warningLines" :key="line" class="mt-0.5 whitespace-pre-line text-xs text-text-secondary">
        {{ line }}
      </p>
    </div>

    <div v-if="parsed" class="mt-2 rounded-card border border-flat-weak px-3 py-2">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-text">{{ parsed.name }}</span>
        <BaseTag tone="primary">校验通过</BaseTag>
      </div>
      <p class="mt-1 text-xs text-text-secondary">{{ parsed.description }}</p>
      <p class="mt-1 text-xs text-text-tertiary">{{ metaLines.join(' · ') }}</p>
      <p v-if="upgradeHint" class="mt-1.5 text-xs text-primary">{{ upgradeHint }}</p>
      <p v-if="takeoverHint" class="mt-1.5 text-xs text-primary">{{ takeoverHint }}</p>
    </div>

    <details class="mt-3 text-xs text-text-tertiary">
      <summary class="cursor-pointer select-none hover:text-text-secondary">插件包格式 / 最小模板</summary>
      <pre class="mt-2 overflow-x-auto rounded-card bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-text-secondary">my-plugin.zip
├── manifest.json
├── main.js
└── README.md

// manifest.json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "一句话说明",
  "author": "作者名",
  "entry": "main.js",
  "readme": "README.md"
}</pre>
      <p class="mt-2">
        产物必须是<strong>单文件</strong> ESM 且不能残留 import（宿主运行时没有打包器也没有编译器）：
        需要 h / ref 就写 <code>const { h, ref } = ctx.vue;</code>，需要 UI 组件就用 <code>app:ui</code>，
        然后用 <code>npx esbuild src/main.js --bundle --format=esm --outfile=main.js</code> 打包成单文件再压缩。
        完整约定见仓库根目录 <strong>PLUGIN_WIKI.md</strong>。
      </p>
    </details>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <BaseButton
          v-if="footerStep === 'pick'"
          variant="primary"
          :disabled="busy"
          @click="zipInputRef?.click()"
        >
          选择 .zip 文件
        </BaseButton>
        <BaseButton v-else-if="footerStep === 'parse'" variant="primary" :disabled="!canParse" @click="onParse">
          解析预览
        </BaseButton>
        <BaseButton v-else-if="footerStep === 'install'" variant="primary" :disabled="!canInstall" @click="onInstall">
          {{ installLabel }}
        </BaseButton>
        <BaseButton v-else variant="primary" @click="open = false">完成</BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
