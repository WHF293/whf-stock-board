<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { useAgentStore } from '@/stores/agent';
import { MODEL_PRESETS } from '@/constants/agent.constants';
import type { ModelConfig, ModelPresetKey } from '@/types/agent.types';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseSwitch from '@/components/ui/BaseSwitch.vue';
import BaseConfirmModal from '@/components/ui/BaseConfirmModal.vue';
import MenuIcon from '@/components/ui/MenuIcon.vue';

/**
 * 模型管理弹窗（方案 §6.3，对照参考截图）
 *
 * - 列表态：模型卡片（默认 / 使用中徽标 + 预设 + 模型 ID）+ 设默认 / 编辑 / 删除；
 * - 表单态：供应商预设 → 接口地址 → API Key（眼睛 + 测试连接）→ 模型 ID
 *   → 展示名 → 高级配置折叠（能力开关 + 上下文档位）；
 * - ⚠️ 「模型 ID」才是进请求的字段，「展示名」只用于本机显示——两者曾混淆过，
 *   报 400 Unsupported model 时先核对模型 ID；
 * - 协议统一 OpenAI 兼容（ChatOpenAI），预设仅作表单预填。
 */
const store = useAgentStore();

const open = defineModel<boolean>('open', { required: true });

/** 弹窗内视图 */
type ViewMode = 'list' | 'form';
const view = ref<ViewMode>('list');

/** 编辑中的模型 id（undefined = 新建） */
const editingId = ref<number | undefined>(undefined);

/* --------------------------------- 表单状态 -------------------------------- */

const form = reactive({
  presetKey: 'custom' as ModelPresetKey,
  name: '',
  baseUrl: '',
  apiKey: '',
  modelId: '',
  supportsTools: true,
  supportsImage: false,
  supportsThinking: false,
  maxInputTokens: null as number | null,
  maxOutputTokens: null as number | null,
  temperature: null as number | null,
  isDefault: false,
});

/** API Key 明文切换 */
const showKey = ref(false);
/** 高级配置折叠 */
const advancedOpen = ref(false);
/** 表单校验错误 */
const formError = ref('');
/** 保存中（防重复提交） */
const saving = ref(false);
/** 列表态错误提示（写库失败的兜底；不吞异常，避免「以为改了其实没改」） */
const listError = ref('');

/** 测试连接状态：idle / testing / ok / fail */
const testState = ref<'idle' | 'testing' | 'ok' | 'fail'>('idle');
const testMessage = ref('');

/** 输入上下文快捷档位（K） */
const INPUT_TOKEN_CHIPS = [32_768, 65_536, 131_072, 262_144, 1_048_576];
/** 输出上限快捷档位（K） */
const OUTPUT_TOKEN_CHIPS = [4_096, 8_192, 16_192, 32_768, 65_536];

/** 当前预设（含展示名兜底） */
const activePreset = computed(
  () => MODEL_PRESETS.find((p) => p.key === form.presetKey) ?? MODEL_PRESETS[0],
);

/**
 * 切换预设并预填表单
 * @param key 预设 key
 */
const applyPreset = (key: ModelPresetKey): void => {
  form.presetKey = key;
  const preset = MODEL_PRESETS.find((p) => p.key === key);
  if (preset) {
    form.baseUrl = preset.baseUrl;
    form.modelId = preset.suggestedModel;
  }
  if (!form.name.trim()) form.name = preset?.label === '自定义' ? '' : (preset?.label ?? '');
};

/**
 * 打开新建表单
 */
const openCreate = (): void => {
  editingId.value = undefined;
  Object.assign(form, {
    presetKey: 'custom',
    name: '',
    baseUrl: '',
    apiKey: '',
    modelId: '',
    supportsTools: true,
    supportsImage: false,
    supportsThinking: false,
    maxInputTokens: null,
    maxOutputTokens: null,
    temperature: null,
    isDefault: store.models.length === 0,
  });
  resetTransient();
  view.value = 'form';
};

/**
 * 打开编辑表单
 * @param model 模型配置
 */
const openEdit = (model: ModelConfig): void => {
  editingId.value = model.id;
  Object.assign(form, {
    presetKey: model.presetKey ?? 'custom',
    name: model.name,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    modelId: model.modelId,
    supportsTools: model.supportsTools,
    supportsImage: model.supportsImage,
    supportsThinking: model.supportsThinking,
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    temperature: model.temperature,
    isDefault: model.isDefault,
  });
  resetTransient();
  view.value = 'form';
};

/** 重置表单临时状态 */
const resetTransient = (): void => {
  showKey.value = false;
  advancedOpen.value = false;
  formError.value = '';
  testState.value = 'idle';
  testMessage.value = '';
};

/**
 * 测试连接（1 token 请求验证 key/base_url/model）
 */
const testConnection = async (): Promise<void> => {
  if (!form.baseUrl || !form.apiKey || !form.modelId) {
    testState.value = 'fail';
    testMessage.value = '请先填写接口地址、API Key 与模型 ID';
    return;
  }
  testState.value = 'testing';
  testMessage.value = '';
  try {
    const response = await tauriFetch(`${form.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${form.apiKey}` },
      body: JSON.stringify({
        model: form.modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      testState.value = 'ok';
      testMessage.value = `模型 ${form.modelId} 连通可用`;
    } else {
      const text = await response.text();
      testState.value = 'fail';
      testMessage.value = `模型 ${form.modelId} 返回 HTTP ${response.status}${text ? `：${text.slice(0, 120)}` : ''}`;
    }
  } catch (error) {
    testState.value = 'fail';
    testMessage.value = error instanceof Error ? error.message : '网络请求失败';
  }
};

/**
 * 保存模型
 *
 * ⚠️ 必须 await + 捕获异常：写库失败若被 `void` 吞掉，界面会照常回到列表，
 * 用户以为已生效、实际配置没落库（请求仍用旧值，报错也看不出所以然）。
 */
const saveModel = async (): Promise<void> => {
  if (!form.apiKey.trim()) {
    formError.value = 'API Key 不能为空';
    return;
  }
  if (!form.modelId.trim()) {
    formError.value = '模型 ID 不能为空';
    return;
  }
  formError.value = '';
  saving.value = true;
  try {
    await store.upsertModel({
      id: editingId.value,
      name: form.name.trim() || form.modelId.trim(),
      presetKey: form.presetKey,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      modelId: form.modelId.trim(),
      supportsTools: form.supportsTools,
      supportsImage: form.supportsImage,
      supportsThinking: form.supportsThinking,
      maxInputTokens: form.maxInputTokens,
      maxOutputTokens: form.maxOutputTokens,
      temperature: form.temperature,
      isDefault: form.isDefault,
    });
    listError.value = '';
    view.value = 'list';
  } catch (error) {
    formError.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    saving.value = false;
  }
};

/**
 * 设为默认
 * @param model 模型配置
 */
const setDefault = async (model: ModelConfig): Promise<void> => {
  try {
    await store.upsertModel({
      id: model.id,
      name: model.name,
      presetKey: model.presetKey,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      modelId: model.modelId,
      supportsTools: model.supportsTools,
      supportsImage: model.supportsImage,
      supportsThinking: model.supportsThinking,
      maxInputTokens: model.maxInputTokens,
      maxOutputTokens: model.maxOutputTokens,
      temperature: model.temperature,
      isDefault: true,
    });
    listError.value = '';
  } catch (error) {
    listError.value = `设为默认失败：${error instanceof Error ? error.message : String(error)}`;
  }
};

/* --------------------------------- 删除确认 -------------------------------- */

const deleteTarget = ref<ModelConfig | null>(null);
const deleteModalOpen = ref(false);

/**
 * 打开删除确认
 * @param model 模型配置
 */
const openDelete = (model: ModelConfig): void => {
  deleteTarget.value = model;
  deleteModalOpen.value = true;
};

/** 确认删除 */
const confirmDelete = async (): Promise<void> => {
  const target = deleteTarget.value;
  deleteModalOpen.value = false;
  if (!target) return;
  try {
    await store.removeModel(target.id);
    listError.value = '';
  } catch (error) {
    listError.value = `删除失败：${error instanceof Error ? error.message : String(error)}`;
  }
};

/**
 * 档位按钮高亮判定
 * @param value 当前值
 * @param chip 档位值
 * @returns 是否高亮
 */
const isChipActive = (value: number | null, chip: number): boolean => value === chip;

/** 预设展示名 */
const PRESET_LABEL = computed<Record<ModelPresetKey, string>>(
  () => Object.fromEntries(MODEL_PRESETS.map((p) => [p.key, p.label])) as Record<ModelPresetKey, string>,
);

/** 弹窗标题随视图切换 */
const modalTitle = computed(() => (view.value === 'list' ? '模型管理' : editingId.value ? '编辑模型' : '添加模型'));
</script>

<template>
  <BaseModal v-model:open="open" :title="modalTitle" max-width-class="max-w-2xl">
    <!-- 列表态 -->
    <div v-if="view === 'list'" class="space-y-2">
      <div
        v-for="model in store.models"
        :key="model.id"
        class="flex items-center gap-3 rounded-xl border border-flat-weak px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium text-text">{{ model.name }}</span>
            <span
              v-if="model.isDefault"
              class="shrink-0 rounded-full bg-primary-weak px-2 py-0.5 text-xs text-primary"
            >
              默认
            </span>
            <span
              v-if="store.effectiveModel?.id === model.id"
              class="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs text-on-primary"
              title="当前会话/配置实际使用的模型，对话请求发的就是这条"
            >
              使用中
            </span>
          </div>
          <p class="mt-0.5 truncate text-xs text-text-tertiary">
            {{ PRESET_LABEL[model.presetKey ?? 'custom'] }} · {{ model.modelId }}
          </p>
        </div>
        <BaseButton v-if="!model.isDefault" variant="ghost" size="sm" @click="void setDefault(model)">
          设为默认
        </BaseButton>
        <button
          type="button"
          class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text"
          aria-label="编辑模型"
          @click="openEdit(model)"
        >
          <MenuIcon name="pencil" :size="15" />
        </button>
        <button
          type="button"
          class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-up"
          aria-label="删除模型"
          @click="openDelete(model)"
        >
          <MenuIcon name="trash" :size="15" />
        </button>
      </div>

      <p v-if="store.models.length === 0" class="py-8 text-center text-sm text-text-tertiary">
        还没有模型配置，点击下方按钮添加
      </p>

      <p v-else class="px-1 text-xs leading-relaxed text-text-tertiary">
        对话实际使用的模型按「会话绑定 → Agent 配置 → 默认模型」逐级回落，
        标「使用中」的那条才是当前发给接口的模型。
      </p>

      <p
        v-if="listError"
        class="rounded-lg bg-up-weak px-3 py-2 text-xs text-up"
        role="alert"
      >
        {{ listError }}
      </p>

      <button
        type="button"
        class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-flat-weak py-3 text-sm text-text-tertiary transition-colors hover:border-primary hover:text-primary"
        @click="openCreate"
      >
        <MenuIcon name="plus" :size="14" />
        添加模型
      </button>
    </div>

    <!-- 表单态 -->
    <div v-else class="space-y-4">
      <!-- 供应商预设 -->
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">供应商</p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="preset in MODEL_PRESETS"
            :key="preset.key"
            type="button"
            class="rounded-full border px-3 py-1 text-xs transition-colors"
            :class="
              form.presetKey === preset.key
                ? 'border-primary bg-primary-weak text-primary'
                : 'border-flat-weak text-text-secondary hover:border-primary'
            "
            @click="applyPreset(preset.key)"
          >
            {{ preset.label }}
          </button>
        </div>
      </div>

      <!-- 接口地址 -->
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">接口地址</p>
        <input
          v-model="form.baseUrl"
          type="text"
          placeholder="https://api.example.com/v1"
          class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
      </div>

      <!-- API Key + 测试连接 -->
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">API Key</p>
        <div class="flex items-center gap-2">
          <div class="relative flex-1">
            <input
              v-model="form.apiKey"
              :type="showKey ? 'text' : 'password'"
              placeholder="sk-..."
              class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 pr-9 text-sm text-text outline-none focus:border-primary"
            />
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text"
              :aria-label="showKey ? '隐藏密钥' : '显示密钥'"
              @click="showKey = !showKey"
            >
              <MenuIcon :name="showKey ? 'moon' : 'info'" :size="15" />
            </button>
          </div>
          <BaseButton variant="ghost" :disabled="testState === 'testing'" @click="void testConnection()">
            {{ testState === 'testing' ? '测试中…' : '测试连接' }}
          </BaseButton>
        </div>
        <p
          v-if="testMessage"
          class="mt-1.5 text-xs"
          :class="testState === 'ok' ? 'text-primary' : 'text-up'"
        >
          {{ testMessage }}
        </p>
      </div>

      <!-- 模型 ID：真正进请求的字段 -->
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">
          模型 ID
          <span class="ml-1 text-xs font-normal text-text-tertiary">
            接口请求里的 model 参数，必须与提供方文档一致
          </span>
        </p>
        <input
          v-model="form.modelId"
          type="text"
          :placeholder="activePreset.suggestedModel || '例如 gpt-4o / deepseek-chat'"
          class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
        <p class="mt-1.5 text-xs text-text-tertiary">
          报错 400 Unsupported model xxx 时，先核对这里是否等于接口文档的模型名
        </p>
      </div>

      <!-- 展示名：仅本机显示 -->
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">
          展示名
          <span class="ml-1 text-xs font-normal text-text-tertiary">
            仅用于本机列表与徽标显示，不参与请求
          </span>
        </p>
        <input
          v-model="form.name"
          type="text"
          placeholder="例如：小米 MiMo v2.5"
          class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
      </div>

      <!-- 高级配置折叠 -->
      <div class="rounded-xl border border-flat-weak">
        <button
          type="button"
          class="flex w-full items-center gap-1.5 px-3 py-2.5 text-sm text-text-secondary"
          :aria-expanded="advancedOpen"
          @click="advancedOpen = !advancedOpen"
        >
          <MenuIcon
            :name="advancedOpen ? 'chevronDown' : 'chevronRight'"
            :size="14"
            class="text-text-tertiary"
          />
          高级配置
        </button>
        <div v-if="advancedOpen" class="space-y-4 border-t border-flat-weak px-3 py-3">
          <!-- 能力开关 -->
          <div class="space-y-2">
            <label class="flex items-center justify-between text-sm text-text-secondary">
              工具调用
              <BaseSwitch v-model="form.supportsTools" />
            </label>
            <label class="flex items-center justify-between text-sm text-text-secondary">
              图片输入
              <BaseSwitch v-model="form.supportsImage" />
            </label>
            <label class="flex items-center justify-between text-sm text-text-secondary">
              思考模式<span class="text-xs text-text-tertiary">（仅标记）</span>
              <BaseSwitch v-model="form.supportsThinking" />
            </label>
          </div>
          <!-- 输入上下文 -->
          <div>
            <p class="mb-1.5 text-sm text-text-secondary">输入上下文</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="chip in INPUT_TOKEN_CHIPS"
                :key="chip"
                type="button"
                class="rounded-full border px-2.5 py-0.5 text-xs transition-colors"
                :class="
                  isChipActive(form.maxInputTokens, chip)
                    ? 'border-primary bg-primary-weak text-primary'
                    : 'border-flat-weak text-text-tertiary hover:border-primary'
                "
                @click="form.maxInputTokens = chip"
              >
                {{ Math.round(chip / 1024) }}K
              </button>
              <span class="self-center text-xs text-text-tertiary">不选 = 使用提供方默认</span>
            </div>
          </div>
          <!-- 输出上限 -->
          <div>
            <p class="mb-1.5 text-sm text-text-secondary">输出上限</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="chip in OUTPUT_TOKEN_CHIPS"
                :key="chip"
                type="button"
                class="rounded-full border px-2.5 py-0.5 text-xs transition-colors"
                :class="
                  isChipActive(form.maxOutputTokens, chip)
                    ? 'border-primary bg-primary-weak text-primary'
                    : 'border-flat-weak text-text-tertiary hover:border-primary'
                "
                @click="form.maxOutputTokens = chip"
              >
                {{ Math.round(chip / 1024) }}K
              </button>
            </div>
          </div>
          <!-- 默认 -->
          <label class="flex items-center justify-between text-sm text-text-secondary">
            设为默认模型
            <BaseSwitch v-model="form.isDefault" />
          </label>
        </div>
      </div>

      <p v-if="formError" class="text-xs text-up">{{ formError }}</p>
    </div>

    <template #footer>
      <template v-if="view === 'form'">
        <BaseButton variant="ghost" @click="view = 'list'">取消</BaseButton>
        <BaseButton variant="primary" :disabled="saving" @click="void saveModel()">
          {{ saving ? '保存中…' : '保存' }}
        </BaseButton>
      </template>
      <BaseButton v-else variant="primary" @click="open = false">完成</BaseButton>
    </template>
  </BaseModal>

  <!-- 删除确认 -->
  <BaseConfirmModal
    v-model:open="deleteModalOpen"
    title="删除模型"
    :content="`删除模型「${deleteTarget?.name ?? ''}」？引用它的会话与 Agent 配置将回落默认模型。`"
    ok-text="删除"
    ok-variant="danger"
    @ok="confirmDelete"
  />
</template>
