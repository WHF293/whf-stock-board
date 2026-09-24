<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useAgentStore } from '@/stores/agent';
import { listBuiltinMcpServers } from '@/agent/mcp/registry';
import { BUILTIN_SKILLS } from '@/constants/builtin-skills';
import {
  listResourceGrants,
  listResourceScopes,
  setResourceGrantTarget,
} from '@/composables/use-agent-db';
import type { GrantResourceKind, SubagentDef } from '@/types/agent.types';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';

/**
 * Subagent 编辑弹窗（新建 / 编辑共用）
 *
 * 两种输入形式：
 * - 填空输入：调用名 / 何时使用描述 / system prompt / 独立模型逐项填写；
 * - 纯文本输入：粘贴完整描述词文档（markdown），自动从中抽取「何时使用」描述
 *   （首个「角色」段落中「」内的职责概括），正文整篇作为 system prompt。
 *
 * 资源勾选（专属技能 / 可用数据源）：一次勾选同时落两处 ——
 * `subagent.skill_names` 声明 + `resource_grant` 授权（run-context 的收敛口径是
 * 「声明 ∩ 授权」，见 agent/run-context.ts；「agent 编辑弹窗勾资源」与
 * 「资源设置弹窗勾 agent」是同一份关系的两个视图，读写都落 resource_grant）。
 */
const store = useAgentStore();

const open = defineModel<boolean>('open', { required: true });

/** 编辑目标（null = 新建） */
const target = defineModel<SubagentDef | null>('target', { default: null });

/** 输入形式：form 填空 / text 纯文本 */
const mode = ref<'form' | 'text'>('form');

const form = reactive({
  name: '',
  description: '',
  prompt: '',
  modelId: null as number | null,
});
const formError = ref('');

/** 纯文本模式：调用名 + 完整描述词文本 */
const plain = reactive({ name: '', text: '' });
/** 从文本抽取出的描述（预览给用户） */
const derivedDescription = ref('');

/** 勾选的技能资源 id（skillNames 的声明集 + 已授权集，打开时装配） */
const selectedSkillIds = ref<Set<number>>(new Set());
/** 勾选的 MCP 资源 id（授权集，打开时装配） */
const selectedMcpIds = ref<Set<number>>(new Set());
/** 打开时的勾选快照（保存时做差集，只增删变动行） */
const initialSkillIds = ref<Set<number>>(new Set());
const initialMcpIds = ref<Set<number>>(new Set());

/** 停用资源 id 集（resource_scope.enabled = false 的行；缺行 = 启用） */
const disabledResourceIds = ref<{ skill: Set<number>; mcp: Set<number> }>({
  skill: new Set(),
  mcp: new Set(),
});

/** 可勾选的技能项（内置 + 启用的用户 skill；停用的不展示——运行时也拿不到） */
const skillOptions = computed(() => [
  ...BUILTIN_SKILLS.filter((s) => !disabledResourceIds.value.skill.has(s.id)).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
  })),
  ...store.skills
    .filter((s) => s.enabled && !disabledResourceIds.value.skill.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, description: s.description ?? '' })),
]);

/** 可勾选的 MCP 项（宿主内置 + 插件贡献 + 启用的远端） */
const mcpOptions = computed(() => [
  ...listBuiltinMcpServers()
    .filter((s) => !disabledResourceIds.value.mcp.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, description: s.description })),
  ...store.mcps
    .filter((m) => m.enabled && !disabledResourceIds.value.mcp.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, description: m.url })),
]);

/**
 * skill 资源 id → skill 名（写 skillNames 声明用）
 * @param id 技能资源 id
 * @returns skill 名；未命中返回 undefined
 */
const skillNameById = (id: number): string | undefined =>
  skillOptions.value.find((s) => s.id === id)?.name;

/**
 * skill 名 → 资源 id（装配初始勾选用；声明里的失效名忽略）
 * @param name skill 名
 * @returns 技能资源 id；未命中返回 undefined
 */
const skillIdByName = (name: string): number | undefined =>
  [...BUILTIN_SKILLS, ...store.skills].find((s) => s.name === name)?.id;

/**
 * 装配打开时的初始状态：表单字段 + 勾选快照（声明 ∪ 授权，再剔除停用项）
 *
 * 授权读库失败不阻断弹窗：勾选退化为「仅声明」，保存仍可用（差集为空时不动授权）。
 */
const setupForm = (): void => {
  form.name = target.value?.name ?? '';
  form.description = target.value?.description ?? '';
  form.prompt = target.value?.prompt ?? '';
  form.modelId = target.value?.modelId ?? null;
  plain.name = target.value?.name ?? '';
  plain.text = target.value?.prompt ?? '';
  derivedDescription.value = '';
  formError.value = '';
  // 编辑已有 subagent 时：有完整字段的用填空模式；只贴文本的新建默认纯文本
  mode.value = 'form';

  const declaredSkillIds = (target.value?.skillNames ?? [])
    .map(skillIdByName)
    .filter((id): id is number => id !== undefined);
  const granted = { skill: new Set<number>(), mcp: new Set<number>() };
  void (async () => {
    try {
      const [grants, scopes] = await Promise.all([listResourceGrants(), listResourceScopes()]);
      if (!open.value) return; // 弹窗已关闭，丢弃过期快照
      const disabled = {
        skill: new Set(scopes.filter((r) => r.resourceKind === 'skill' && !r.enabled).map((r) => r.resourceId)),
        mcp: new Set(scopes.filter((r) => r.resourceKind === 'mcp' && !r.enabled).map((r) => r.resourceId)),
      };
      disabledResourceIds.value = disabled;
      for (const row of grants) {
        if (row.agentKind !== 'subagent' || row.agentId !== target.value?.id) continue;
        if (row.resourceKind === 'skill' || row.resourceKind === 'mcp') {
          granted[row.resourceKind].add(row.resourceId);
        }
      }
    } catch (error) {
      console.warn('[agent] 读取授权失败，勾选初值退化为仅声明：' + (error instanceof Error ? error.message : String(error)));
    }
    const mergedSkill = new Set([...declaredSkillIds, ...granted.skill]);
    const mergedMcp = new Set(granted.mcp);
    selectedSkillIds.value = new Set([...mergedSkill].filter((id) => !disabledResourceIds.value.skill.has(id)));
    selectedMcpIds.value = new Set([...mergedMcp].filter((id) => !disabledResourceIds.value.mcp.has(id)));
    initialSkillIds.value = new Set(selectedSkillIds.value);
    initialMcpIds.value = new Set(selectedMcpIds.value);
  })();
};

watch(open, (isOpen) => {
  if (isOpen) setupForm();
});

/**
 * 差集写授权行：新勾选的授予、取消勾选的撤销（不动 scope 与其他目标）
 * @param kind 资源类型
 * @param subagentId 子 agent id
 * @param selected 当前勾选集
 * @param initial 打开时快照
 */
const persistGrantDiff = async (
  kind: GrantResourceKind,
  subagentId: number,
  selected: Set<number>,
  initial: Set<number>,
): Promise<void> => {
  for (const id of selected) {
    if (!initial.has(id)) await setResourceGrantTarget(kind, id, 'subagent', subagentId, true);
  }
  for (const id of initial) {
    if (!selected.has(id)) await setResourceGrantTarget(kind, id, 'subagent', subagentId, false);
  }
};

/** 保存：先落 subagent 定义（含 skillNames 声明），再差集写授权行 */
const save = async (): Promise<void> => {
  const isText = mode.value === 'text';
  const name = (isText ? plain.name : form.name).trim();
  if (!name) {
    formError.value = '调用名不能为空';
    return;
  }
  const prompt = (isText ? plain.text : form.prompt).trim();
  if (isText && !prompt) {
    formError.value = '描述词文本不能为空';
    return;
  }
  const description = isText
    ? derivedDescription.value || '（粘贴导入的 subagent）'
    : form.description.trim();
  if (!description) {
    formError.value = '「何时使用」描述不能为空';
    return;
  }
  // skillNames 声明与勾选集保持一致（失效 id 已在装配时剔除）
  const skillNames = [...selectedSkillIds.value]
    .map(skillNameById)
    .filter((n): n is string => n !== undefined);
  const subagentId = await store.upsertSubagent({
    id: target.value?.id,
    name,
    description,
    prompt,
    modelId: form.modelId,
    toolNames: target.value?.toolNames ?? [],
    skillNames,
    // 新建默认启用；编辑时沿用现状（启停以列表开关为主，这里只是不丢失）
    enabled: target.value?.enabled ?? true,
  });
  await persistGrantDiff('skill', subagentId, selectedSkillIds.value, initialSkillIds.value);
  await persistGrantDiff('mcp', subagentId, selectedMcpIds.value, initialMcpIds.value);
  open.value = false;
};
</script>

<template>
  <BaseModal v-model:open="open" :title="target ? '编辑 Subagent' : '新建 Subagent'" max-width-class="max-w-lg">
    <div class="space-y-4">
      <!-- 输入形式切换 -->
      <div class="flex gap-1.5">
        <button
          v-for="m in [
            { key: 'form', label: '填空输入' },
            { key: 'text', label: '纯文本输入' },
          ]"
          :key="m.key"
          type="button"
          class="rounded-full border px-3 py-1 text-xs transition-colors"
          :class="
            mode === m.key
              ? 'border-primary bg-primary-weak text-primary'
              : 'border-flat-weak text-text-secondary hover:border-primary'
          "
          @click="mode = m.key as 'form' | 'text'"
        >
          {{ m.label }}
        </button>
      </div>

      <!-- 填空输入 -->
      <template v-if="mode === 'form'">
        <div>
          <p class="mb-1.5 text-sm text-text-secondary">调用名（蛇形，如 kline_analyst）</p>
          <input
            v-model="form.name"
            type="text"
            placeholder="kline_analyst"
            class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
          />
        </div>
        <div>
          <p class="mb-1.5 text-sm text-text-secondary">何时使用（主 agent 据此决定派发）</p>
          <input
            v-model="form.description"
            type="text"
            placeholder="例如：当需要深入分析个股 K 线与技术指标时使用"
            class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
          />
        </div>
        <div>
          <p class="mb-1.5 text-sm text-text-secondary">System Prompt</p>
          <textarea
            v-model="form.prompt"
            rows="5"
            placeholder="子 agent 的系统提示词（隔离上下文中运行）"
            class="w-full resize-y rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
          />
        </div>
      </template>

      <!-- 纯文本输入：粘贴完整描述词 -->
      <template v-else>
        <div>
          <p class="mb-1.5 text-sm text-text-secondary">调用名（蛇形，主 agent 经 task 工具按名派发）</p>
          <input
            v-model="plain.name"
            type="text"
            placeholder="stock_research_analyst"
            class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 font-mono text-sm text-text outline-none focus:border-primary"
          />
        </div>
        <div>
          <p class="mb-1.5 text-sm text-text-secondary">描述词全文（整篇作为 System Prompt）</p>
          <textarea
            v-model="plain.text"
            rows="12"
            placeholder="# 角色&#10;你是一名「xxx Agent」，负责……&#10;&#10;# 工作流程&#10;……"
            class="w-full resize-y rounded-lg border border-flat-weak bg-transparent px-3 py-2 font-mono text-xs text-text outline-none focus:border-primary"
          />
        </div>
        <p v-if="derivedDescription" class="text-xs text-text-tertiary">
          自动抽取的「何时使用」描述：{{ derivedDescription }}
        </p>
      </template>

      <div>
        <p class="mb-1.5 text-sm text-text-secondary">独立模型（可选，空 = 继承主 agent）</p>
        <select
          v-model="form.modelId"
          class="w-full rounded-lg border border-flat-weak bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
        >
          <option :value="null">继承主 agent 模型</option>
          <option v-for="model in store.models" :key="model.id" :value="model.id">
            {{ model.name }}{{ model.supportsTools ? '' : '（不支持工具）' }}
          </option>
        </select>
      </div>

      <!-- 专属技能：一次勾选同时落声明与授权 -->
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">专属技能（空 = 无技能；勾选即声明使用并授予访问权限）</p>
        <div v-if="skillOptions.length > 0" class="flex flex-wrap gap-1.5">
          <button
            v-for="skill in skillOptions"
            :key="skill.id"
            type="button"
            class="rounded-full border px-3 py-1 text-xs transition-colors"
            :class="
              selectedSkillIds.has(skill.id)
                ? 'border-primary bg-primary-weak text-primary'
                : 'border-flat-weak text-text-secondary hover:border-primary'
            "
            :title="skill.description"
            @click="
              selectedSkillIds.has(skill.id)
                ? selectedSkillIds.delete(skill.id)
                : selectedSkillIds.add(skill.id)
            "
          >
            {{ skill.name }}
          </button>
        </div>
        <p v-else class="text-xs text-text-tertiary">暂无可用技能</p>
      </div>

      <!-- 可用数据源：勾选即授予该子 agent 对应 MCP 工具集 -->
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">可用数据源 MCP（空 = 无工具；勾选即授予访问权限）</p>
        <div v-if="mcpOptions.length > 0" class="flex flex-wrap gap-1.5">
          <button
            v-for="server in mcpOptions"
            :key="server.id"
            type="button"
            class="rounded-full border px-3 py-1 text-xs transition-colors"
            :class="
              selectedMcpIds.has(server.id)
                ? 'border-primary bg-primary-weak text-primary'
                : 'border-flat-weak text-text-secondary hover:border-primary'
            "
            :title="server.description"
            @click="
              selectedMcpIds.has(server.id)
                ? selectedMcpIds.delete(server.id)
                : selectedMcpIds.add(server.id)
            "
          >
            {{ server.name }}
          </button>
        </div>
        <p v-else class="text-xs text-text-tertiary">暂无可用数据源</p>
      </div>

      <p v-if="formError" class="text-xs text-up">{{ formError }}</p>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="open = false">取消</BaseButton>
      <BaseButton variant="primary" @click="save">保存</BaseButton>
    </template>
  </BaseModal>
</template>
