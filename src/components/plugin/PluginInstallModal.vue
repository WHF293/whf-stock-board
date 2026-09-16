<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseTag from '../ui/BaseTag.vue';
import { importUserPluginCode } from '../../plugin/user-plugin-loader';
import { BUILTIN_PLUGINS } from '../../plugins';
import { useUserPlugins } from '../../composables/use-user-plugins';
import { useUserPluginsStore } from '../../stores/user-plugins';
import { USER_PLUGIN_AUTHOR_LABEL } from '../../constants/plugin.constants';
import type { PluginDefinition } from '../../types/plugin.types';

/**
 * 插件安装弹窗（应用内安装用户插件）
 *
 * 流程：粘贴代码或选择本地 .js 文件 → 「解析预览」（结构校验，不落内核）→
 * 「确认安装」（持久化代码 + 内核挂载，面板 / 菜单 / 路由即时生效）。
 * 插件代码与应用同权限执行，弹窗内有固定风险提示。
 */
const open = defineModel<boolean>('open', { required: true });

const { install } = useUserPlugins();

/** 代码输入框内容 */
const code = ref('');

/** 当前选中的本地文件名（仅展示用） */
const fileName = ref('');

/** 解析出的插件定义预览（null = 尚未解析或解析失败） */
const parsed = ref<PluginDefinition | null>(null);

/** 解析 / 安装的错误文案 */
const errorMessage = ref('');

/** 安装进行中（动态 import 是异步的，期间禁用按钮防重复提交） */
const busy = ref(false);

/** 预览元信息行（name / version / id / author） */
const metaLines = computed(() => {
  if (!parsed.value) return [];
  return [
    `id：${parsed.value.id}`,
    `版本：v${parsed.value.version}`,
    `作者：${parsed.value.author || USER_PLUGIN_AUTHOR_LABEL}`,
  ];
});

/** 打开弹窗时重置表单 */
watch(open, (value) => {
  if (!value) return;
  code.value = '';
  fileName.value = '';
  parsed.value = null;
  errorMessage.value = '';
  busy.value = false;
});

/** 解析预览：只校验，不安装 */
const onParse = async (): Promise<void> => {
  parsed.value = null;
  errorMessage.value = '';
  busy.value = true;
  // 复用安装链路的前半段（import + 结构校验 + id 占用检查），但这里不落存储与内核
  const occupiedIds = [
    ...BUILTIN_PLUGINS.map((plugin) => plugin.id),
    ...useUserPluginsStore().records.map((record) => record.id),
  ];
  const result = await importUserPluginCode(code.value, occupiedIds);
  busy.value = false;
  if (result.ok) {
    parsed.value = result.definition;
  } else {
    errorMessage.value = result.error;
  }
};

/** 确认安装：写持久化 + 内核挂载，成功后收起弹窗 */
const onInstall = async (): Promise<void> => {
  busy.value = true;
  const result = await install(code.value);
  busy.value = false;
  if (result.ok) {
    open.value = false;
    return;
  }
  errorMessage.value = result.error;
  parsed.value = null;
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
  parsed.value = null;
  errorMessage.value = '';
  input.value = '';
};
</script>

<template>
  <BaseModal v-model:open="open" title="安装插件" max-width-class="max-w-xl">
    <div class="rounded-card border border-warn-weak bg-warn-weak/40 px-3 py-2 text-xs text-text-secondary">
      ⚠️ 插件代码会以与应用相同的权限运行，请只安装来源可信的插件。
    </div>

    <div class="mt-3">
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
        @input="() => { parsed = null; errorMessage = ''; }"
      />
    </div>

    <div v-if="errorMessage" class="mt-2 rounded-card border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">
      {{ errorMessage }}
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
      <summary class="cursor-pointer select-none hover:text-text-secondary">插件格式说明 / 最小模板</summary>
      <pre class="mt-2 overflow-x-auto rounded-card bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-text-secondary">import { defineComponent, h } from 'vue';

export default {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  description: '示例：往左侧栏加一个面板',
  apply(ctx) {
    ctx.sidebar.add({
      id: 'main',
      title: '我的插件',
      mode: 'inline',
      position: 'nav',
      order: 300,
      component: defineComponent({
        render: () => h('div', { class: 'p-3 text-xs' }, 'Hello 插件'),
      }),
    });
  },
};</pre>
      <p class="mt-2">
        面板组件请用渲染函数（生产构建不含 Vue 运行时模板编译器）；完整贡献点见 AGENTS.md「插件体系」。
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
