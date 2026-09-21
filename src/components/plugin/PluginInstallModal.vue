<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import BaseTag from '../ui/BaseTag.vue';
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
 * 插件安装弹窗（应用内安装用户插件）
 *
 * 两种来源，同一条安装链路：
 * - **zip 插件包**（第三方分发的常态）：manifest.json + 入口产物 + 可选 README，
 *   解包后取入口产物代码 → 静态预检 → 结构校验 → 清单一致性校验 → 安装；
 * - **粘贴 / 选择单文件 JS**：给作者自己调试用，同一条链路，只是没有清单。
 *
 * 流程：「解析预览」（结构校验，不落内核）→「确认安装」（持久化代码 + 内核挂载，
 * 面板 / 菜单 / 路由即时生效）。插件代码与应用同权限执行，弹窗内有固定风险提示。
 */
const open = defineModel<boolean>('open', { required: true });

const { install } = useUserPlugins();

/** 安装来源切换选项 */
const SOURCE_OPTIONS = [
  { label: 'zip 插件包', value: 'package' },
  { label: '粘贴代码', value: 'code' },
] as const;

/** README 预览最多展示的字符数（包内文档可能很长，弹窗里只给个开头） */
const README_PREVIEW_MAX = 600;

/** 当前安装来源（zip 包 / 单文件代码） */
const mode = ref<'package' | 'code'>('package');

/** 代码输入框内容（zip 包模式下由解包结果填充，不展示在界面上） */
const code = ref('');

/** 当前选中的本地文件名（仅展示用） */
const fileName = ref('');

/** zip 包解析结果（null = 未选择或解析失败） */
const pkg = ref<PluginPackage | null>(null);

/** 解析出的插件定义预览（null = 尚未解析或解析失败） */
const parsed = ref<PluginDefinition | null>(null);

/** 解析 / 安装的错误文案 */
const errorMessage = ref('');

/** 静态预检的非致命提醒（能装，但可能显示不正常） */
const warningLines = ref<string[]>([]);

/** 安装进行中（动态 import 是异步的，期间禁用按钮防重复提交） */
const busy = ref(false);

/** 预览元信息行（name / version / id / author） */
const metaLines = computed(() => {
  if (!parsed.value) return [];
  return [
    `id：${parsed.value.id}`,
    `版本：v${parsed.value.version}`,
    `作者：${parsed.value.author || pkg.value?.manifest.author || USER_PLUGIN_AUTHOR_LABEL}`,
  ];
});

/** 包信息行（入口 / 包内文件数 / 清单有无） */
const packageLines = computed(() => {
  if (!pkg.value) return [];
  return [
    `入口：${pkg.value.entryPath}`,
    `包内 ${pkg.value.files.length} 个文件`,
    pkg.value.hasManifest ? '含 manifest.json' : '无 manifest.json（元信息取自产物）',
  ];
});

/** README 预览文本（超长截断） */
const readmePreview = computed(() => {
  const text = pkg.value?.readme ?? '';
  if (text.length <= README_PREVIEW_MAX) return text;
  return `${text.slice(0, README_PREVIEW_MAX)}…`;
});

/** 清空解析态（换来源 / 换文件 / 改代码时都要重来） */
const resetParseState = (): void => {
  parsed.value = null;
  errorMessage.value = '';
  warningLines.value = [];
};

/** 打开弹窗时重置表单 */
watch(open, (value) => {
  if (!value) return;
  mode.value = 'package';
  code.value = '';
  fileName.value = '';
  pkg.value = null;
  resetParseState();
  busy.value = false;
});

/** 切换来源时清掉另一侧的残留（避免装到旧内容） */
watch(mode, () => {
  code.value = '';
  fileName.value = '';
  pkg.value = null;
  resetParseState();
});

/**
 * 把静态预检的非致命提醒压成展示文案
 * @param issues 预检提醒列表（含源码行号）
 */
const pushWarnings = (issues: readonly { line: number; message: string }[] | undefined): void => {
  warningLines.value = (issues ?? []).map((issue) => `第 ${issue.line} 行：${issue.message}`);
};

/** 解析预览：只校验，不安装 */
const onParse = async (): Promise<void> => {
  resetParseState();
  busy.value = true;
  // 复用安装链路的前半段（静态预检 + import + 结构校验 + id 占用检查），但不落存储与内核
  const occupiedIds = [
    ...BUILTIN_PLUGINS.map((plugin) => plugin.id),
    ...useUserPluginsStore().records.map((record) => record.id),
  ];
  const result = await importUserPluginCode(code.value, occupiedIds);
  busy.value = false;
  pushWarnings(result.warnings);
  if (!result.ok) {
    errorMessage.value = result.error;
    return;
  }
  // zip 包：清单与产物必须一致，否则「包里写一套、装进去是另一套」
  if (pkg.value) {
    const inconsistency = checkManifestConsistency(pkg.value.manifest, result.definition);
    if (inconsistency) {
      errorMessage.value = inconsistency;
      return;
    }
  }
  parsed.value = result.definition;
};

/** 确认安装：写持久化 + 内核挂载，成功后收起弹窗 */
const onInstall = async (): Promise<void> => {
  busy.value = true;
  const result = await install(code.value, {
    manifest: pkg.value?.manifest,
    source: pkg.value ? USER_PLUGIN_SOURCE.PACKAGE : USER_PLUGIN_SOURCE.CODE,
  });
  busy.value = false;
  pushWarnings(result.warnings);
  if (result.ok) {
    open.value = false;
    return;
  }
  errorMessage.value = result.error;
  parsed.value = null;
};

/**
 * 选择 zip 插件包并解包
 * @param event 文件选择框 change 事件
 */
const onPickPackage = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  pkg.value = null;
  code.value = '';
  resetParseState();
  input.value = '';
  try {
    const parsedPackage = parsePluginPackage(await file.arrayBuffer());
    pkg.value = parsedPackage;
    code.value = parsedPackage.code;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
};

/**
 * 选择本地 .js 文件，读入文本框
 * @param event 文件选择框 change 事件
 */
const onPickFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  code.value = await file.text();
  resetParseState();
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
      <div class="flex items-center justify-between">
        <p class="text-xs text-text-tertiary">选择第三方打包好的 .zip 插件包</p>
        <label class="cursor-pointer text-xs text-primary hover:underline">
          选择 .zip 文件
          <input type="file" :accept="USER_PLUGIN_PACKAGE_ACCEPT" class="hidden" @change="onPickPackage" />
        </label>
      </div>
      <p v-if="fileName" class="mt-1 text-xs text-text-tertiary">已读取：{{ fileName }}</p>
      <div
        v-if="pkg"
        class="mt-2 rounded-card border border-flat-weak bg-surface px-3 py-2"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-text">{{ pkg.manifest.name || '待解析的插件包' }}</span>
          <BaseTag v-if="pkg.manifest.version" tone="flat">v{{ pkg.manifest.version }}</BaseTag>
        </div>
        <p v-if="pkg.manifest.description" class="mt-1 text-xs text-text-secondary">
          {{ pkg.manifest.description }}
        </p>
        <p class="mt-1 text-xs text-text-tertiary">{{ packageLines.join(' · ') }}</p>
        <details v-if="readmePreview" class="mt-2 text-xs text-text-tertiary">
          <summary class="cursor-pointer select-none hover:text-text-secondary">README</summary>
          <pre
            class="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-card bg-flat-weak px-2.5 py-2 font-mono text-xs leading-relaxed text-text-secondary"
          >{{ readmePreview }}</pre>
        </details>
      </div>
      <p v-else class="mt-2 text-xs text-text-tertiary">
        包内需含入口产物（默认 main.js），建议带 manifest.json 与 README.md。
      </p>
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
        @input="resetParseState"
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
        <BaseButton variant="ghost" :disabled="busy || code.trim().length === 0" @click="onParse">
          解析预览
        </BaseButton>
        <BaseButton variant="primary" :disabled="!parsed || busy" @click="onInstall">
          确认安装
        </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
