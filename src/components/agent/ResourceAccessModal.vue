<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useAgentStore } from '@/stores/agent';
import {
  getResourceGrantState,
  saveResourceGrantState,
  listResourceGrants,
  listResourceScopes,
} from '@/composables/use-agent-db';
import {
  MAIN_AGENT_ID,
  agentKey,
  buildAccessContext,
  isResourceOrphaned,
} from '@/utils/resource-access';
import type { AccessScope, GrantResourceKind, GrantTarget } from '@/types/agent.types';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseSwitch from '@/components/ui/BaseSwitch.vue';
import MenuIcon from '@/components/ui/MenuIcon.vue';

/**
 * 资源访问设置弹窗（MCP / Skill 共用）
 *
 * 对应需求：每个 skill / mcp 一个「设置」按钮 → 弹窗内先问「是否启用」，
 * 启用后再选访问权限【全部 agent 可访问 / 精确设置】；选精确设置则把主 agent
 * 与全部子 agent 罗列出来用 checkbox 勾选，保存后持久化。
 *
 * 数据落点（与「agent 侧勾资源」共用同一张表，天然一致、无需同步）：
 * - 访问范围 → `resource_scope.scope`；
 * - 精确勾选 → `resource_grant`（先删后插整体覆盖）；
 * - 启用状态 → 内置资源写 `resource_scope.enabled`；用户资源写自身表的 enabled 列
 *   （skill.enabled / mcp_server.enabled，因为运行时的前置过滤读的是它）。
 */
const store = useAgentStore();

const open = defineModel<boolean>('open', { required: true });

const props = defineProps<{
  /** 受控资源类型 */
  kind: GrantResourceKind;
  /** 资源 id（内置为负数常量 id，用户资源为正数自增 id） */
  resourceId: number;
  /** 展示名（弹窗标题） */
  resourceName: string;
  /** 是否内置资源（决定启用状态写哪张表） */
  builtin: boolean;
  /** 用户资源自身表的启用状态；内置资源忽略此值（改从范围行读） */
  enabled?: boolean;
}>();

const emit = defineEmits<{
  /** 保存成功（父组件据此刷新运行时缓存 / 列表） */
  changed: [];
}>();

/** 当前选择：全部 / 精确 */
const scope = ref<AccessScope>('all');
/** 是否启用（草稿；props 里的同名项是「用户资源自身表的初始值」） */
const draftEnabled = ref(true);
/** 库里的授权集合（打开时载入，用于回填勾选） */
const grantedKeys = ref<ReadonlySet<string>>(new Set<string>());
/** 编辑中的勾选集合 */
const checkedKeys = ref<Set<string>>(new Set<string>());
const loading = ref(false);
const saving = ref(false);
const error = ref('');

/**
 * 可授权的 agent 列表：主 agent（单例）+ 全部子 agent（内置 + 用户）
 * @returns 授权目标列表
 */
const targets = computed<GrantTarget[]>(() => [
  { kind: 'main', id: MAIN_AGENT_ID, name: '主 Agent', builtin: true },
  ...store.subagents.map((subagent) => ({
    kind: 'subagent' as const,
    id: subagent.id,
    name: subagent.name,
    builtin: subagent.id < 0,
  })),
]);

/** 已勾选数量（精确设置下用于警示「谁都不可用」） */
const checkedCount = computed(
  () => targets.value.filter((target) => checkedKeys.value.has(agentKey(target.kind, target.id))).length,
);

/**
 * 精确设置但一个都没勾：含主 agent 在内全部不可用
 *
 * 这个状态非常容易误存（弹窗上看是「已启用 + 精确设置」），必须显式警示，
 * 否则用户会以为资源生效了，实际被静默锁死。
 */
const isOrphanRisk = computed(() => scope.value === 'custom' && checkedCount.value === 0);

/**
 * 勾选/取消一个 agent
 * @param target 目标 agent
 * @param next 勾选后的状态
 */
const setChecked = (target: GrantTarget, next: boolean): void => {
  const key = agentKey(target.kind, target.id);
  const draft = new Set(checkedKeys.value);
  if (next) draft.add(key);
  else draft.delete(key);
  checkedKeys.value = draft;
};

/**
 * 用「库里的授权集合」回填勾选状态
 *
 * ⚠️ 单独抽出来是因为 `targets` 依赖 store.subagents，而 store 初始化是异步的：
 * 若授权状态先到、子 agent 列表后到，就必须重新回填，否则已授权的子 agent
 * 会显示成未勾选（一保存就丢授权）。
 * @returns 无
 */
const syncCheckedFromGranted = (): void => {
  const next = new Set<string>();
  for (const target of targets.value) {
    const key = agentKey(target.kind, target.id);
    if (grantedKeys.value.has(key)) next.add(key);
  }
  checkedKeys.value = next;
};

/** 打开时载入现有授权状态 */
watch(open, (isOpen) => {
  if (!isOpen) return;
  void loadState();
});

/** 子 agent 列表到位/变化后重新回填勾选 */
watch(targets, () => {
  if (open.value && !loading.value) syncCheckedFromGranted();
});

/**
 * 载入授权状态（范围 + 启用 + 勾选集合）
 * @returns 无
 */
const loadState = async (): Promise<void> => {
  loading.value = true;
  error.value = '';
  try {
    const state = await getResourceGrantState(props.kind, props.resourceId);
    scope.value = state.scope;
    // 内置资源的启用状态只存在于范围行；用户资源的启用状态在自身表
    draftEnabled.value = props.builtin ? state.enabled : (props.enabled ?? true);
    grantedKeys.value = new Set(
      state.targets.map((target) => agentKey(target.agentKind, target.agentId)),
    );
    syncCheckedFromGranted();
  } catch (err) {
    error.value = '读取授权状态失败：' + (err instanceof Error ? err.message : String(err));
  } finally {
    loading.value = false;
  }
};

/** 保存授权（范围 + 启用 + 勾选） */
const save = async (): Promise<void> => {
  saving.value = true;
  error.value = '';
  try {
    const chosen = targets.value.filter((target) =>
      checkedKeys.value.has(agentKey(target.kind, target.id)),
    );
    await saveResourceGrantState(props.kind, props.resourceId, {
      scope: scope.value,
      enabled: draftEnabled.value,
      targets: chosen.map((target) => ({ agentKind: target.kind, agentId: target.id })),
    });
    // 用户资源的启用状态还要写自身表：运行时的前置过滤（skill 装载 / MCP 连接）读的是它
    if (!props.builtin && draftEnabled.value !== (props.enabled ?? true)) {
      if (props.kind === 'skill') await store.toggleSkill(props.resourceId, draftEnabled.value);
      else await store.toggleMcp(props.resourceId, draftEnabled.value);
    }
    emit('changed');
    open.value = false;
  } catch (err) {
    error.value = '保存失败：' + (err instanceof Error ? err.message : String(err));
  } finally {
    saving.value = false;
  }
};

/* ------------------------------ 全貌视图（诊断用） ----------------------------- */

/** 静默锁死 / 整体停用的提示文案（空串 = 无异常） */
const effectiveSummary = ref('');

/**
 * 计算当前资源的整体可用性（与运行时 `canUseResource` 走同一份判定）
 *
 * 目的：弹窗里看到的就是运行时会发生的，用户不用猜。
 * @returns 无
 */
const refreshSummary = async (): Promise<void> => {
  try {
    const [scopes, grants] = await Promise.all([listResourceScopes(), listResourceGrants()]);
    const ctx = buildAccessContext(scopes, grants);
    if (!draftEnabled.value) {
      effectiveSummary.value = '资源已停用，所有 agent 都无法使用';
      return;
    }
    effectiveSummary.value = isResourceOrphaned(ctx, props.kind, props.resourceId)
      ? '当前设置下所有 agent 都无法使用该资源'
      : '';
  } catch {
    effectiveSummary.value = '';
  }
};

watch([open, draftEnabled], () => {
  if (open.value) void refreshSummary();
});

onMounted(() => {
  // 子 agent 列表可能还没载入（弹窗先于页面初始化打开）；init 幂等且自带缓存
  void store.init().catch(() => undefined);
});
</script>

<template>
  <BaseModal v-model:open="open" :title="`访问设置 · ${resourceName}`" max-width-class="max-w-md">
    <div class="space-y-4">
      <!-- 是否启用 -->
      <label class="flex cursor-pointer items-center justify-between gap-3 select-none">
        <span class="min-w-0">
          <span class="block text-sm text-text">启用该{{ kind === 'mcp' ? ' MCP 服务器' : ' Skill' }}</span>
          <span class="mt-0.5 block text-xs text-text-tertiary">
            关闭后任何 agent 都不会装配它（工具不会出现在模型可见的工具表里）
          </span>
        </span>
        <BaseSwitch v-model="draftEnabled" />
      </label>

      <!-- 访问权限（仅启用时有意义） -->
      <div :class="draftEnabled ? '' : 'pointer-events-none opacity-45'">
        <p class="mb-1.5 text-sm text-text-secondary">访问权限</p>
        <div class="space-y-1.5">
          <label class="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-flat-weak">
            <input v-model="scope" type="radio" value="all" class="mt-0.5 accent-primary" />
            <span>
              <span class="block text-sm text-text">全部 Agent 都可以访问</span>
              <span class="block text-xs text-text-tertiary">主 Agent 与所有子 Agent（含以后新增的）都能用</span>
            </span>
          </label>
          <label class="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-flat-weak">
            <input v-model="scope" type="radio" value="custom" class="mt-0.5 accent-primary" />
            <span>
              <span class="block text-sm text-text">精确设置</span>
              <span class="block text-xs text-text-tertiary">只允许下面勾选的 Agent 使用</span>
            </span>
          </label>
        </div>
      </div>

      <!-- 精确设置：主 agent + 全部子 agent 逐项勾选 -->
      <div v-if="draftEnabled && scope === 'custom'" class="rounded-xl border border-flat-weak">
        <p class="border-b border-flat-weak px-3 py-2 text-xs text-text-secondary">
          勾选允许使用的 Agent（已勾选 {{ checkedCount }} / {{ targets.length }}）
        </p>
        <div class="max-h-64 overflow-y-auto p-1.5">
          <label
            v-for="target in targets"
            :key="agentKey(target.kind, target.id)"
            class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-flat-weak"
          >
            <input
              type="checkbox"
              class="accent-primary"
              :checked="checkedKeys.has(agentKey(target.kind, target.id))"
              @change="setChecked(target, ($event.target as HTMLInputElement).checked)"
            />
            <span class="min-w-0 flex-1 truncate text-sm text-text">{{ target.name }}</span>
            <span
              v-if="target.kind === 'main'"
              class="shrink-0 rounded-full bg-primary-weak px-1.5 py-0.5 text-[10px] leading-none text-primary"
            >
              调度
            </span>
            <span
              v-else-if="target.builtin"
              class="shrink-0 rounded-full bg-flat-weak px-1.5 py-0.5 text-[10px] leading-none text-text-tertiary"
            >
              内置
            </span>
          </label>
          <p v-if="loading" class="px-2 py-3 text-center text-xs text-text-tertiary">读取中…</p>
        </div>
      </div>

      <!-- 静默锁死警示 -->
      <p
        v-if="isOrphanRisk"
        class="flex items-start gap-1.5 rounded-lg bg-up-weak px-3 py-2 text-xs text-up"
        role="alert"
      >
        <MenuIcon name="info" :size="14" class="mt-0.5 shrink-0" />
        一个都没勾：主 Agent 与所有子 Agent 都将无法使用该资源，等于把它关掉。
      </p>

      <p v-else-if="effectiveSummary" class="rounded-lg bg-primary-weak px-3 py-2 text-xs text-primary">
        {{ effectiveSummary }}
      </p>

      <p v-if="error" class="rounded-lg bg-up-weak px-3 py-2 text-xs text-up" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="open = false">取消</BaseButton>
      <BaseButton variant="primary" :disabled="saving || loading" @click="void save()">
        {{ saving ? '保存中…' : '保存' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
