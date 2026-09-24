<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { useScheduleStore } from '@/stores/schedule';
import { useNotificationsStore } from '@/stores/notifications';
import { NOTIFY_TONE, NOTIFY_QUICK_TIMEOUT_MS } from '@/constants/notify.constants';
import {
  SCHEDULE_DURATIONS,
  SCHEDULE_DEFAULT_DURATION,
  SCHEDULE_DURATION_KEYS,
  SCHEDULE_EXPIRY_FORMAT,
  SCHEDULE_WEEKDAY_LABELS,
} from '@/constants/schedule.constants';
import type { ScheduleDurationKey, ScheduleFormInput, ScheduleTask, ScheduleType } from '@/types/schedule.types';
import { copyTextToClipboard } from '@/utils/copy-text-to-clipboard';
import { scheduleTaskToJson } from '@/utils/schedule-task-to-json';
import { parseScheduleTaskJson } from '@/utils/parse-schedule-task-json';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseConfirmModal from '@/components/ui/BaseConfirmModal.vue';
import BaseEmpty from '@/components/ui/BaseEmpty.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSwitch from '@/components/ui/BaseSwitch.vue';
import MenuIcon from '@/components/ui/MenuIcon.vue';

/**
 * 定时任务管理页（Agent 分析右区的「定时任务」视图）
 *
 * - 列表态：任务卡片（周期 / 有效期 / 上次执行状态 + 立即测试 / 编辑 / 查看会话 / 删除）；
 * - 表单态：新建与编辑共用（任务名 / 内容 / 每天·每周几 / 执行时刻 / 有效期档位）；
 * - 删除走二次确认（okVariant=danger）；「立即测试」与心跳到期触发共用 runNow，
 *   执行都发生在任务绑定会话里，可通过「查看会话」跳回对话视图查看结果。
 */
const store = useScheduleStore();
const notifications = useNotificationsStore();

const emit = defineEmits<{
  /** 返回对话视图 */
  (e: 'back'): void;
  /** 跳转到任务绑定会话（宿主切换视图并选中该会话） */
  (e: 'open-session', sessionId: number): void;
}>();

/* --------------------------------- 表单状态 -------------------------------- */

/** 表单态：closed 列表 / create 新建 / edit 编辑 */
const formMode = ref<'closed' | 'create' | 'edit'>('closed');
/** 编辑中的任务 id（formMode = 'edit' 时非空） */
const editingId = ref<number | null>(null);
/** 提交中（防重复点击） */
const submitting = ref(false);
/** 表单校验 / 保存错误提示 */
const formError = ref('');

/** 执行时刻（`HH:mm`，原生 time input；提交时拆 hour / minute） */
const draftTime = ref('15:00');

/** 周期选项（value 定型为 ScheduleType，避免模板内断言） */
const SCHEDULE_TYPE_OPTIONS: ReadonlyArray<{ value: ScheduleType; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'trading_day', label: '交易日' },
  { value: 'weekly', label: '每周' },
];

/** 表单草稿（hour / minute 由 draftTime 承载；weekday 仅 weekly 时提交） */
const draft = reactive<{
  name: string;
  prompt: string;
  scheduleType: ScheduleType;
  weekday: number;
  durationKey: ScheduleDurationKey;
}>({
  name: '',
  prompt: '',
  scheduleType: 'daily',
  weekday: 1,
  durationKey: SCHEDULE_DEFAULT_DURATION,
});

/** 重置草稿为默认值 */
const resetDraft = (): void => {
  draft.name = '';
  draft.prompt = '';
  draft.scheduleType = 'daily';
  draft.weekday = 1;
  draft.durationKey = SCHEDULE_DEFAULT_DURATION;
  draftTime.value = '15:00';
  formError.value = '';
};

/** 进入新建态 */
const openCreate = (): void => {
  resetDraft();
  editingId.value = null;
  formMode.value = 'create';
};

/**
 * 补零（time input 回填与周期文案都需要两位数字）
 * @param n 0-59 / 0-23 的整数
 * @returns 两位数字符串（如 `07`）
 */
const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * 进入编辑态（回填草稿）
 * @param task 任务
 */
const openEdit = (task: ScheduleTask): void => {
  editingId.value = task.id;
  draft.name = task.name;
  draft.prompt = task.prompt;
  draft.scheduleType = task.scheduleType;
  draft.weekday = task.weekday ?? 1;
  draft.durationKey = task.durationKey;
  draftTime.value = `${pad(task.hour)}:${pad(task.minute)}`;
  formError.value = '';
  formMode.value = 'edit';
};

/** 关闭表单回列表 */
const closeForm = (): void => {
  formMode.value = 'closed';
  editingId.value = null;
};

/**
 * 保存（新建 / 编辑共用）：校验必填 → 拆时间 → 落库 → 回列表
 */
const submitForm = async (): Promise<void> => {
  const name = draft.name.trim();
  const prompt = draft.prompt.trim();
  if (!name || !prompt || !draftTime.value) {
    formError.value = '请填写任务名称、任务内容与执行时间';
    return;
  }
  const [h, m] = draftTime.value.split(':');
  const hour = Number(h);
  const minute = Number(m);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    formError.value = '执行时间格式不正确';
    return;
  }
  const payload: ScheduleFormInput = {
    name,
    prompt,
    scheduleType: draft.scheduleType,
    hour,
    minute,
    weekday: draft.scheduleType === 'weekly' ? draft.weekday : null,
    durationKey: draft.durationKey,
  };
  submitting.value = true;
  try {
    if (formMode.value === 'edit' && editingId.value !== null) {
      await store.updateTask(editingId.value, payload);
    } else {
      await store.createTask(payload);
    }
    closeForm();
  } catch (error) {
    formError.value = '保存失败：' + (error instanceof Error ? error.message : String(error));
  } finally {
    submitting.value = false;
  }
};

/* --------------------------------- 列表展示 -------------------------------- */

/** 上次执行状态的展示元信息（颜色沿用项目语义 token：红=异常、绿=正常） */
const STATUS_META: Record<string, { label: string; class: string }> = {
  running: { label: '执行中', class: 'text-primary' },
  ok: { label: '上次成功', class: 'text-down' },
  error: { label: '上次失败', class: 'text-up' },
  session_missing: { label: '绑定会话已删除（任务已停用）', class: 'text-text-tertiary' },
  no_model: { label: '未配置可用模型', class: 'text-text-tertiary' },
};

/**
 * 周期描述文案
 * @param task 任务
 * @returns 形如 `每天 15:00` / `每个交易日 15:00` / `每周三 15:00`
 */
const scheduleLabel = (task: ScheduleTask): string => {
  const time = `${pad(task.hour)}:${pad(task.minute)}`;
  if (task.scheduleType === 'trading_day') return `每个交易日 ${time}`;
  return task.scheduleType === 'daily'
    ? `每天 ${time}`
    : `每${SCHEDULE_WEEKDAY_LABELS[task.weekday ?? 0]} ${time}`;
};

/**
 * 有效期描述文案
 * @param task 任务
 * @returns 形如 `至 2026-10-24 15:00`；已过期追加「已过期」
 */
const expiryLabel = (task: ScheduleTask): string => {
  if (task.expiresAt === null) return '永久有效';
  const text = `至 ${dayjs(task.expiresAt).format(SCHEDULE_EXPIRY_FORMAT)}`;
  return Date.now() >= task.expiresAt ? `${text}（已过期）` : text;
};

/**
 * 上次执行描述文案
 * @param task 任务
 * @returns 状态文案 + 执行时间
 */
const lastRunLabel = (task: ScheduleTask): string => {
  if (task.lastRunAt === null) return '从未执行';
  const status = STATUS_META[task.lastRunStatus ?? '']?.label ?? (task.lastRunStatus ?? '未知');
  return `${status} · ${dayjs(task.lastRunAt).format(SCHEDULE_EXPIRY_FORMAT)}`;
};

/**
 * 上次执行状态的颜色类
 * @param task 任务
 * @returns Tailwind 文本色类
 */
const lastRunClass = (task: ScheduleTask): string =>
  STATUS_META[task.lastRunStatus ?? '']?.class ?? 'text-text-tertiary';

/* --------------------------------- 操作动作 -------------------------------- */

/**
 * 复制任务 JSON 到剪贴板（跨电脑迁移：只含计划字段，不含会话 / 有效期等本地状态）
 * @param task 任务
 */
const copyTaskJson = async (task: ScheduleTask): Promise<void> => {
  const ok = await copyTextToClipboard(scheduleTaskToJson(task));
  notifications.push({
    title: ok ? '任务 JSON 已复制' : '复制失败，请重试',
    body: ok ? '在另一台电脑的定时任务页点「导入 JSON」即可创建同款任务' : undefined,
    tone: ok ? NOTIFY_TONE.PRIMARY : NOTIFY_TONE.UP,
    timeoutMs: NOTIFY_QUICK_TIMEOUT_MS,
  });
};

/**
 * 从剪贴板导入任务 JSON：读取 → 解析校验 → 回填新建表单，用户确认后保存
 *
 * 与「复制 JSON」配套（电脑1 复制 → 电脑2 导入，剪贴板就是中转站）；
 * 不直接建任务——回填表单让人过目/可改，误贴了别的 JSON 点取消即可。
 */
const importFromClipboard = async (): Promise<void> => {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    notifications.push({
      title: '读取剪贴板失败',
      body: '请检查系统剪贴板权限后重试',
      tone: NOTIFY_TONE.UP,
      timeoutMs: NOTIFY_QUICK_TIMEOUT_MS,
    });
    return;
  }
  const result = parseScheduleTaskJson(text);
  if (!result.ok) {
    notifications.push({
      title: '导入失败',
      body: result.error,
      tone: NOTIFY_TONE.UP,
      timeoutMs: NOTIFY_QUICK_TIMEOUT_MS,
    });
    return;
  }
  const form = result.form;
  draft.name = form.name;
  draft.prompt = form.prompt;
  draft.scheduleType = form.scheduleType;
  draft.weekday = form.weekday ?? 1;
  draft.durationKey = form.durationKey;
  draftTime.value = `${pad(form.hour)}:${pad(form.minute)}`;
  formError.value = '';
  editingId.value = null;
  formMode.value = 'create';
  notifications.push({
    title: '已导入任务配置',
    body: '有效期自本机重新起算，确认无误后点「保存」',
    tone: NOTIFY_TONE.PRIMARY,
    timeoutMs: NOTIFY_QUICK_TIMEOUT_MS,
  });
};

/**
 * 立即测试（与心跳共用 runNow；执行中按钮禁用）
 * @param task 任务
 */
const runTest = (task: ScheduleTask): void => {
  void store.runNow(task);
};

/**
 * 切换启停
 * @param task 任务
 * @param enabled 目标状态
 */
const onToggle = (task: ScheduleTask, enabled: boolean): void => {
  void store.toggleTask(task.id, enabled);
};

/** 待删除任务（非空 = 确认弹窗打开） */
const pendingDelete = ref<ScheduleTask | null>(null);

/**
 * 请求删除（二次确认）
 * @param task 任务
 */
const askDelete = (task: ScheduleTask): void => {
  pendingDelete.value = task;
};

/** 确认删除（弹窗 @ok；绑定会话保留） */
const confirmDelete = (): void => {
  if (pendingDelete.value === null) return;
  void store.removeTask(pendingDelete.value.id);
  pendingDelete.value = null;
};

/** 删除确认文案（按待删任务现算） */
const deleteConfirmText = computed(() =>
  pendingDelete.value
    ? `确定删除定时任务「${pendingDelete.value.name}」吗？绑定会话会保留，其中的历史执行记录不会丢失。`
    : '',
);
</script>

<template>
  <div class="flex h-full min-w-0 flex-1 flex-col">
    <!-- 顶栏：表单态返回列表；列表态返回对话视图 -->
    <div class="flex h-12 shrink-0 items-center gap-2 border-b border-flat-weak px-4">
      <button
        type="button"
        class="pressable rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text"
        :aria-label="formMode === 'closed' ? '返回对话' : '返回任务列表'"
        @click="formMode === 'closed' ? emit('back') : closeForm()"
      >
        <MenuIcon name="arrowLeft" :size="16" />
      </button>
      <h2 class="text-sm font-semibold text-text">定时任务</h2>
      <div class="flex-1" />
      <template v-if="formMode === 'closed'">
        <BaseButton variant="ghost" @click="void importFromClipboard()">
          <MenuIcon name="clipboardPaste" :size="14" />
          导入 JSON
        </BaseButton>
        <BaseButton variant="primary" @click="openCreate">
          <MenuIcon name="plus" :size="14" />
          新建任务
        </BaseButton>
      </template>
    </div>

    <!-- 表单态：新建 / 编辑共用 -->
    <div v-if="formMode !== 'closed'" class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div class="mx-auto max-w-xl space-y-4">
        <div>
          <label class="mb-1 block text-xs text-text-tertiary" for="schedule-name">任务名称</label>
          <BaseInput
            id="schedule-name"
            v-model="draft.name"
            placeholder="例如：每日收盘复盘"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-text-tertiary" for="schedule-prompt">任务内容</label>
          <textarea
            id="schedule-prompt"
            v-model="draft.prompt"
            rows="5"
            placeholder="到期自动发送给 Agent 的分析指令，例如：汇总今日涨停板块与连板梯队，判断情绪周期位置，给出明日关注方向"
            class="w-full resize-y rounded-lg bg-flat-weak px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-text-tertiary focus:ring-1 focus:ring-primary"
          />
        </div>
        <div class="flex gap-4">
          <div>
            <span class="mb-1 block text-xs text-text-tertiary">执行周期</span>
            <div class="flex gap-1.5">
              <button
                v-for="option in SCHEDULE_TYPE_OPTIONS"
                :key="option.value"
                type="button"
                class="rounded-lg px-3 py-1.5 text-sm transition-colors"
                :class="
                  draft.scheduleType === option.value
                    ? 'bg-primary text-on-primary'
                    : 'bg-flat-weak text-text-secondary hover:text-text'
                "
                @click="draft.scheduleType = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <div>
            <span class="mb-1 block text-xs text-text-tertiary">执行时间</span>
            <input
              v-model="draftTime"
              type="time"
              class="rounded-lg bg-flat-weak px-3 py-1.5 text-sm text-text outline-none transition-colors focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <div v-if="draft.scheduleType === 'weekly'">
          <span class="mb-1 block text-xs text-text-tertiary">每周执行日</span>
          <div class="flex gap-1.5">
            <button
              v-for="(label, day) in SCHEDULE_WEEKDAY_LABELS"
              :key="day"
              type="button"
              class="rounded-lg px-2.5 py-1.5 text-sm transition-colors"
              :class="
                draft.weekday === day
                  ? 'bg-primary text-on-primary'
                  : 'bg-flat-weak text-text-secondary hover:text-text'
              "
              @click="draft.weekday = day"
            >
              {{ label }}
            </button>
          </div>
        </div>
        <div>
          <span class="mb-1 block text-xs text-text-tertiary">有效期</span>
          <div class="flex gap-1.5">
            <button
              v-for="key in SCHEDULE_DURATION_KEYS"
              :key="key"
              type="button"
              class="rounded-lg px-3 py-1.5 text-sm transition-colors"
              :class="
                draft.durationKey === key
                  ? 'bg-primary text-on-primary'
                  : 'bg-flat-weak text-text-secondary hover:text-text'
              "
              @click="draft.durationKey = key"
            >
              {{ SCHEDULE_DURATIONS[key].label }}
            </button>
          </div>
        </div>
        <p v-if="formError" class="text-sm text-up">{{ formError }}</p>
        <div class="flex justify-end gap-2 pt-1">
          <BaseButton variant="ghost" @click="closeForm">取消</BaseButton>
          <BaseButton variant="primary" :disabled="submitting" @click="submitForm">
            {{ submitting ? '保存中…' : '保存' }}
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- 列表态 -->
    <div v-else class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <BaseEmpty
        v-if="store.tasks.length === 0"
        text="还没有定时任务，点击右上角「新建任务」创建一个"
      />
      <div v-else class="mx-auto max-w-2xl space-y-3">
        <div
          v-for="task in store.tasks"
          :key="task.id"
          class="rounded-xl border border-flat-weak bg-surface p-4"
        >
          <!-- 行 1：名称 + 启停开关 + 操作 -->
          <div class="flex items-center gap-2">
            <h3 class="min-w-0 flex-1 truncate text-sm font-medium text-text">{{ task.name }}</h3>
            <BaseSwitch
              :model-value="task.enabled"
              :aria-label="`启用或停用任务 ${task.name}`"
              @update:model-value="(value) => onToggle(task, value)"
            />
            <button
              type="button"
              class="pressable rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text"
              title="编辑"
              aria-label="编辑任务"
              @click="openEdit(task)"
            >
              <MenuIcon name="pencil" :size="15" />
            </button>
            <button
              type="button"
              class="pressable rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text"
              title="复制 JSON"
              aria-label="复制任务 JSON"
              @click="void copyTaskJson(task)"
            >
              <MenuIcon name="copy" :size="15" />
            </button>
            <button
              type="button"
              class="pressable rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text"
              title="查看绑定会话"
              aria-label="查看绑定会话"
              @click="emit('open-session', task.sessionId)"
            >
              <MenuIcon name="eye" :size="15" />
            </button>
            <button
              type="button"
              class="pressable rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-up"
              title="删除"
              aria-label="删除任务"
              @click="askDelete(task)"
            >
              <MenuIcon name="trash" :size="15" />
            </button>
          </div>
          <!-- 行 2：任务内容摘要 -->
          <p class="mt-1.5 line-clamp-2 text-xs text-text-tertiary">{{ task.prompt }}</p>
          <!-- 行 3：元信息 + 立即测试 -->
          <div class="mt-2.5 flex items-center gap-3 text-xs text-text-tertiary">
            <span>{{ scheduleLabel(task) }}</span>
            <span>{{ expiryLabel(task) }}</span>
            <span :class="lastRunClass(task)">{{ lastRunLabel(task) }}</span>
            <div class="flex-1" />
            <BaseButton
              variant="ghost"
              :disabled="store.runningIds.has(task.id) || !task.enabled"
              @click="runTest(task)"
            >
              {{ store.runningIds.has(task.id) ? '执行中…' : '立即测试' }}
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除二次确认（open 是布尔；待删任务单独记在 pendingDelete） -->
    <BaseConfirmModal
      :open="pendingDelete !== null"
      title="删除定时任务"
      :content="deleteConfirmText"
      ok-text="删除"
      ok-variant="danger"
      @update:open="(value: boolean) => { if (!value) pendingDelete = null; }"
      @ok="confirmDelete"
    />
  </div>
</template>
