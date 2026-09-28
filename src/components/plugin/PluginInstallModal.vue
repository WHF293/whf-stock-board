<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import BaseTag from '../ui/BaseTag.vue';
import PluginPackageIntakeCard from './PluginPackageIntakeCard.vue';
import { auditPluginClassNames } from '../../plugin/user-plugin-class-audit';
import { importUserPluginCode } from '../../plugin/user-plugin-loader';
import { BUILTIN_PLUGINS } from '../../plugins';
import { usePluginPackageIntake } from '../../composables/use-plugin-package-intake';
import { useUserPlugins } from '../../composables/use-user-plugins';
import { useUserPluginsStore } from '../../stores/user-plugins';
import {
  USER_PLUGIN_AUTHOR_LABEL,
  USER_PLUGIN_INTAKE_CLOSE_LABEL,
  USER_PLUGIN_INTAKE_DROP_ACTIVE_HINT,
  USER_PLUGIN_INTAKE_DROP_HINT,
  USER_PLUGIN_INTAKE_EMPTY_TEXT,
  USER_PLUGIN_INTAKE_FINISH_LABEL,
  USER_PLUGIN_INTAKE_INSTALL_ALL_LABEL,
  USER_PLUGIN_INTAKE_WARN_LINE,
  USER_PLUGIN_INTAKE_WARN_TITLE,
  USER_PLUGIN_PACKAGE_ACCEPT,
  USER_PLUGIN_SOURCE,
} from '../../constants/plugin.constants';
import type { PluginDefinition } from '../../types/plugin.types';

/**
 * 插件安装弹窗（应用内安装用户插件）
 *
 * 两种来源，两条不同的交互节奏：
 * - **zip 插件包**（第三方分发的常态）：拖拽 / 多选入队，**选中即自动解析** ——
 *   每个包各跑各的六步流水线（解包 → 静态预检 → 加载产物 → 结构校验 → 清单比对 → 冲突检测），
 *   先传先解析、互不阻塞；解析完由用户拍板单装或批量装。
 *   同一批次里两个包抢同一 id 按上传顺序仲裁（先上传者胜出），被判冲突的卡给「和谁撞了 + 怎么办」；
 *   与已装记录同 id 是升级、与内置插件同 id 是接管，都不算冲突。
 * - **粘贴 / 选择单文件 JS**：给作者自己调试用，保持「解析预览 → 确认安装」两步。
 *
 * 无论哪条路，最终都落到 `useUserPlugins.install`（写持久化 + 内核挂载，面板 / 菜单 /
 * 路由即时生效）。插件代码与应用同权限执行，弹窗内有固定风险提示。
 */
const open = defineModel<boolean>('open', { required: true });

const { install } = useUserPlugins();
const userPluginsStore = useUserPluginsStore();

/** zip 包队列与解析编排（批量上传的全部状态机都在里面） */
const {
  tasks,
  installableCount,
  allInstalled,
  busy: parseBusy,
  enqueue,
  remove,
  installOne: installTask,
  installAll: installTasks,
  cancelPendingInstalls,
  reset: resetIntake,
} = usePluginPackageIntake();

/** 安装来源切换选项 */
const SOURCE_OPTIONS = [
  { label: 'zip 插件包', value: 'package' },
  { label: '粘贴代码', value: 'code' },
] as const;

/** 当前安装来源（zip 包 / 单文件代码） */
const mode = ref<'package' | 'code'>('package');

/** 拖拽悬停态（投放区高亮） */
const dragging = ref(false);

/** 批量安装进行中（期间禁用按钮防重复提交） */
const installing = ref(false);

/** 代码输入框内容（zip 包模式不使用） */
const code = ref('');

/** 当前选中的本地文件名（仅展示用，zip 包模式不使用） */
const fileName = ref('');

/** 解析出的插件定义预览（code 模式；null = 尚未解析或解析失败） */
const parsed = ref<PluginDefinition | null>(null);

/** code 模式的解析 / 安装错误文案 */
const errorMessage = ref('');

/** code 模式的非致命提醒 */
const warningLines = ref<string[]>([]);

/** code 模式的解析 / 安装进行中 */
const codeBusy = ref(false);

/** 待覆盖的旧安装记录（同 id 已装过 = 升级 / 重装；null = 首次安装） */
const existingRecord = computed(() => {
  const id = parsed.value?.id;
  if (!id) return null;
  return userPluginsStore.records.find((record) => record.id === id) ?? null;
});

/** 本次会接管的内置插件定义（同 id 且随应用里发了默认实现） */
const builtinConflict = computed(() => {
  const id = parsed.value?.id;
  if (!id) return null;
  return BUILTIN_PLUGINS.find((plugin) => plugin.id === id) ?? null;
});

/** 覆盖安装 / 接管安装的提示（首次安装时为空串） */
const upgradeHint = computed(() => {
  const previous = existingRecord.value;
  if (!previous || !parsed.value) return '';
  return previous.version === parsed.value.version
    ? `已安装 v${previous.version}，本次将覆盖重装（插件数据表保留）`
    : `已安装 v${previous.version}，本次将升级到 v${parsed.value.version}（插件数据表保留）`;
});

/** 接管内置版本的提示（同 id 的内置实现会被本次安装顶替） */
const takeoverHint = computed(() => {
  if (!builtinConflict.value || existingRecord.value || !parsed.value) return '';
  return `内置版 v${builtinConflict.value.version} 将被本版本接管；卸载本插件即刻恢复内置实现`;
});

/** code 模式安装按钮文案（说清楚这次到底是装、升级还是接管） */
const codeInstallLabel = computed(() => {
  if (existingRecord.value) return '确认升级';
  if (builtinConflict.value) return '确认接管安装';
  return '确认安装';
});

/** 底部主按钮文案（全部装完变「完成」，否则显示可安装数量） */
const installAllLabel = computed(() =>
  allInstalled.value
    ? USER_PLUGIN_INTAKE_FINISH_LABEL
    : USER_PLUGIN_INTAKE_INSTALL_ALL_LABEL(installableCount.value));

/** 底部主按钮是否可点（有可装的包且没有任务在跑；全部装完后点它即关闭） */
const canInstallAll = computed(
  () => allInstalled.value || (installableCount.value > 0 && !parseBusy.value && !installing.value),
);

/** 预览元信息行（name / version / id / author） */
const metaLines = computed(() => {
  if (!parsed.value) return [];
  return [
    `id：${parsed.value.id}`,
    `版本：v${parsed.value.version}`,
    `作者：${parsed.value.author || USER_PLUGIN_AUTHOR_LABEL}`,
  ];
});

/** 打开 / 关闭弹窗：打开时重置表单与队列；关闭时清空队列（不留残留的解析结果） */
watch(open, (value) => {
  if (!value) {
    if (installing.value) {
      // 安装途中被 ESC / 点遮罩关掉（关闭按钮本身已禁用）：正在飞的那一次收不回来，跑完为止，
      // 但队列里**剩下的**必须停下 —— 用户已经 dismiss 了，不能在他看不见的时候继续往上装插件。
      // 队列本身留着不动（任务此刻正处在 installing 中间态），下次打开弹窗时统一 reset。
      cancelPendingInstalls();
      return;
    }
    // 安装进行中被 ESC / 点遮罩关掉之外的情况：直接清队列，不留上一次会话的包
    resetIntake();
    return;
  }
  mode.value = 'package';
  dragging.value = false;
  installing.value = false;
  resetCodeState();
  resetIntake();
});

/** 切换来源时清掉另一侧的残留（避免装到旧内容） */
watch(mode, () => {
  resetCodeState();
  resetIntake();
});

/** 清空 code 模式的输入与解析态（打开弹窗 / 切换来源时用，避免装到上一次的内容） */
function resetCodeState(): void {
  code.value = '';
  fileName.value = '';
  parsed.value = null;
  errorMessage.value = '';
  warningLines.value = [];
  codeBusy.value = false;
}

/**
 * 只清 code 模式的解析结果（改代码时用）
 *
 * 与 `resetCodeState` 的区别：**不动输入框内容** —— 这个挂在 textarea 的 input 事件上，
 * 清了输入框就等于用户每敲一个字都被清空。
 */
function clearCodeParse(): void {
  parsed.value = null;
  errorMessage.value = '';
  warningLines.value = [];
}

/**
 * 汇总要展示的非致命提醒
 *
 * 静态预检现在只管「必然加载失败」；样式能不能看由 `auditPluginClassNames` 单独判 ——
 * 它查的是宿主**当前真实加载的 CSS**（CSSOM），不猜，因此不复述「可能没样式」这类空话。
 * @param source 待装的插件代码原文（样式审计的输入）
 * @param issues 静态预检提醒
 */
const pushWarnings = (
  source: string,
  issues: readonly { line: number; message: string }[] | undefined,
): void => {
  warningLines.value = [
    ...(issues ?? []),
    ...auditPluginClassNames(source),
  ].map((issue) => USER_PLUGIN_INTAKE_WARN_LINE(issue.line, issue.message));
};

/** code 模式：解析预览（只校验，不安装） */
const onParse = async (): Promise<void> => {
  errorMessage.value = '';
  parsed.value = null;
  codeBusy.value = true;
  // 复用安装链路的前半段（静态预检 + import + 结构校验 + id 占用检查），但不落存储与内核
  // 内置 id 与已装过的 id 都**不算占用**：前者是接管、后者是升级，
  // 都由 install 的高层政策处理；交给底层只会得到一句「已被占用」，用户无从下手。
  const result = await importUserPluginCode(code.value, []);
  codeBusy.value = false;
  pushWarnings(code.value, result.warnings);
  if (!result.ok) {
    errorMessage.value = result.error;
    return;
  }
  parsed.value = result.definition;
};

/** code 模式：确认安装（写持久化 + 内核挂载，成功后收起弹窗） */
const onInstall = async (): Promise<void> => {
  codeBusy.value = true;
  const result = await install(code.value, { source: USER_PLUGIN_SOURCE.CODE });
  codeBusy.value = false;
  pushWarnings(code.value, result.warnings);
  if (result.ok) {
    open.value = false;
    return;
  }
  errorMessage.value = result.error;
  parsed.value = null;
};

/**
 * code 模式：选择本地 .js 文件，读入文本框
 * @param event 文件选择框 change 事件
 */
const onPickFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  code.value = await file.text();
  parsed.value = null;
  errorMessage.value = '';
  warningLines.value = [];
  input.value = '';
};

/**
 * zip 包模式：选择文件（支持一次选多个），选中即入队并自动开始解析
 * @param event 文件选择框 change 事件
 */
const onPickPackages = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  enqueue(Array.from(input.files ?? []));
  // 清空 value：否则连选两次同一批文件时第二次不会触发 change
  input.value = '';
};

/**
 * zip 包模式：拖放文件入队（同样选中即解析）
 * @param event 拖放事件
 */
const onDropPackages = (event: DragEvent): void => {
  dragging.value = false;
  enqueue(Array.from(event.dataTransfer?.files ?? []));
};

/**
 * 拖拽悬停：必须 preventDefault，否则浏览器不会派发 drop
 * @param event 拖拽事件
 */
const onDragOver = (event: DragEvent): void => {
  event.preventDefault();
  dragging.value = true;
};

/**
 * 拖拽离开：只有真正离开投放区（不是移动到子元素）才取消高亮
 * @param event 拖拽事件
 */
const onDragLeave = (event: DragEvent): void => {
  const current = event.currentTarget as HTMLElement | null;
  const related = event.relatedTarget as Node | null;
  if (current && related && current.contains(related)) return;
  dragging.value = false;
};

/**
 * 安装单个包（串行链路的一次执行；失败时卡片自己转红框，弹窗不关）
 * @param uid 入队任务 uid
 */
const onInstallOne = async (uid: string): Promise<void> => {
  installing.value = true;
  await installTask(uid);
  installing.value = false;
};

/** 安装全部可安装的包（串行；装完且队列里再无可装包才收起弹窗，有失败则留在弹窗里看红框） */
const onInstallAll = async (): Promise<void> => {
  if (allInstalled.value) {
    open.value = false;
    return;
  }
  installing.value = true;
  const summary = await installTasks();
  installing.value = false;
  // 关窗的前提是「没有东西还值得用户看」：本轮可能把同 id 的后来者提升成了待安装
  // （升则可能顶掉刚装上的那个），这时必须留在页面上让他看见，而不是悄悄收摊。
  if (summary.failed === 0 && installableCount.value === 0 && !parseBusy.value) {
    open.value = false;
  }
};
</script>

<template>
  <BaseModal
    v-model:open="open"
    title="安装插件"
    :max-width-class="mode === 'package' ? 'max-w-2xl' : 'max-w-xl'"
  >
    <div class="rounded-card border border-primary/30 bg-primary-weak/60 px-3 py-2 text-xs text-text-secondary">
      ⚠️ 插件代码会以与应用相同的权限运行，请只安装来源可信的插件。
    </div>

    <div class="mt-3">
      <BaseTabs v-model="mode" :options="SOURCE_OPTIONS" />
    </div>

    <div v-if="mode === 'package'" class="mt-3">
      <label
        class="block cursor-pointer rounded-card border border-dashed px-4 py-5 text-center text-xs transition-colors"
        :class="dragging
          ? 'border-primary bg-primary-weak/60 text-primary'
          : 'border-flat-weak text-text-tertiary hover:border-primary/60 hover:text-text-secondary'"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop.prevent="onDropPackages"
      >
        <input
          type="file"
          multiple
          :accept="USER_PLUGIN_PACKAGE_ACCEPT"
          class="hidden"
          @change="onPickPackages"
        />
        <p>{{ dragging ? USER_PLUGIN_INTAKE_DROP_ACTIVE_HINT : USER_PLUGIN_INTAKE_DROP_HINT }}</p>
        <p class="mt-1 text-text-tertiary">包内需含入口产物（默认 main.js），建议带 manifest.json 与 README.md。</p>
      </label>

      <p v-if="tasks.length === 0" class="mt-2 text-xs text-text-tertiary">
        {{ USER_PLUGIN_INTAKE_EMPTY_TEXT }}
      </p>

      <ul v-else class="mt-2 space-y-2">
        <li v-for="task in tasks" :key="task.uid">
          <PluginPackageIntakeCard
            :task="task"
            :busy="installing"
            @remove="remove"
            @install="onInstallOne"
          />
        </li>
      </ul>
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
        @input="clearCodeParse"
      />
    </div>

    <div v-if="errorMessage" class="mt-2 whitespace-pre-line rounded-card border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">
      {{ errorMessage }}
    </div>

    <div v-if="warningLines.length > 0" class="mt-2 rounded-card border border-primary/30 bg-primary-weak/60 px-3 py-2">
      <p class="text-xs font-medium text-primary">{{ USER_PLUGIN_INTAKE_WARN_TITLE }}</p>
      <p v-for="(line, warnIndex) in warningLines" :key="warnIndex" class="mt-0.5 whitespace-pre-line text-xs text-text-secondary">
        {{ line }}
      </p>
    </div>

    <div v-if="mode === 'code' && parsed" class="mt-2 rounded-card border border-flat-weak px-3 py-2">
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
      <div v-if="mode === 'package'" class="flex items-center justify-end gap-2">
        <BaseButton variant="ghost" :disabled="installing" @click="open = false">
          {{ USER_PLUGIN_INTAKE_CLOSE_LABEL }}
        </BaseButton>
        <BaseButton variant="primary" :disabled="!canInstallAll" @click="onInstallAll">
          {{ installAllLabel }}
        </BaseButton>
      </div>
      <div v-else class="flex items-center justify-end gap-2">
        <BaseButton variant="ghost" :disabled="codeBusy || code.trim().length === 0" @click="onParse">
          解析预览
        </BaseButton>
        <BaseButton variant="primary" :disabled="!parsed || codeBusy" @click="onInstall">
          {{ codeInstallLabel }}
        </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
