<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseInput from '../ui/BaseInput.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseSwitch from '../ui/BaseSwitch.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { pluginKernel } from '../../plugin';
import type { PluginSettingsEntry } from '../../plugin/kernel';
import type { PluginSettingField } from '../../types/plugin.types';

/**
 * 插件设置弹窗（顶栏齿轮入口）
 *
 * 数据源是内核的 `listSettingsPlugins()`：只列**已挂载且清单里声明了 settings**
 * 的插件 —— 声明式 fields 由这里的通用表单渲染（改动即时生效），复杂 UI 由插件
 * 自带 component 渲染（宿主只注入 settings 存取句柄）。这正是「清单 settings
 * 字段」约定的消费端：插件零宿主改动即可获得设置入口。
 */
const open = defineModel<boolean>('open', { required: true });

/** 可设置的插件（订阅内核版本号，启停插件后列表自动刷新） */
const settingsEntries = computed<readonly PluginSettingsEntry[]>(() => {
  void pluginKernel.revision.value;
  return pluginKernel.listSettingsPlugins();
});

/** 当前查看的插件 id（默认第一个） */
const activeId = ref('');

const activeEntry = computed(
  () => settingsEntries.value.find((entry) => entry.id === activeId.value),
);

// 每次打开都把选中项收敛到列表里（插件被禁用后原选中项可能已消失）
watch([open, settingsEntries], ([isOpen, entries]) => {
  if (!isOpen) return;
  if (!entries.some((entry) => entry.id === activeId.value)) {
    activeId.value = entries[0]?.id ?? '';
  }
});

/** 展示名：声明 title 优先，回落插件名
 * @param entry 插件设置条目
 * @returns 设置区标题
 */
const sectionTitle = (entry: PluginSettingsEntry): string =>
  entry.declaration.title ?? entry.name;

/**
 * number 输入的字符串中转（输入框里允许暂存空串，失焦时收敛回数字）
 */
const numberDraft = ref<Record<string, string>>({});

/** text 输入的字符串中转（失焦才落库，与 number 同一策略） */
const textDraft = ref<Record<string, string>>({});

/**
 * 读一个 text 字段的输入草稿
 * @param field 字段声明
 * @returns 输入框当前应显示的字符串
 */
const textValue = (field: PluginSettingField): string => {
  const draft = textDraft.value[field.key];
  if (draft !== undefined) return draft;
  return String(activeEntry.value?.store.get(field.key, field.default ?? '') ?? '');
};

/**
 * text 字段输入中转
 * @param field 字段声明
 * @param value 输入值
 */
const onTextInput = (field: PluginSettingField, value: string): void => {
  textDraft.value[field.key] = value;
};

/**
 * text 字段失焦：落库并清草稿
 * @param field 字段声明
 * @param event 失焦事件
 */
const onTextBlur = (field: PluginSettingField, event: Event): void => {
  const entry = activeEntry.value;
  if (!entry) return;
  const value = (event.target as HTMLInputElement).value;
  delete textDraft.value[field.key];
  entry.store.set(field.key, value);
};

/**
 * 读一个 number 字段的输入草稿
 * @param field 字段声明
 * @returns 输入框当前应显示的字符串
 */
const numberValue = (field: PluginSettingField): string => {
  const draft = numberDraft.value[field.key];
  if (draft !== undefined) return draft;
  const current = activeEntry.value?.store.get<number>(field.key, 0);
  return current === undefined ? '' : String(current);
};

/**
 * number 字段失焦：收敛为合法数字并落库
 * @param field 字段声明
 * @param event 失焦事件
 * @returns 无
 */
const onNumberBlur = (field: PluginSettingField, event: Event): void => {
  const entry = activeEntry.value;
  if (!entry) return;
  const raw = (event.target as HTMLInputElement).value.trim();
  delete numberDraft.value[field.key];
  const parsed = Number(raw);
  if (raw === '' || Number.isNaN(parsed)) {
    // 非法输入回落默认值
    const fallback = field.default ?? 0;
    entry.store.set(field.key, typeof fallback === 'number' ? fallback : 0);
    return;
  }
  let value = parsed;
  if (field.min !== undefined) value = Math.max(field.min, value);
  if (field.max !== undefined) value = Math.min(field.max, value);
  entry.store.set(field.key, value);
};

/**
 * boolean 字段切换（即时生效）
 * @param field 字段声明
 * @param value 新值
 */
const onBooleanChange = (field: PluginSettingField, value: boolean): void => {
  activeEntry.value?.store.set(field.key, value);
};

/**
 * select 字段切换
 * @param field 字段声明
 * @param event change 事件
 */
const onSelectChange = (field: PluginSettingField, event: Event): void => {
  const raw = (event.target as HTMLSelectElement).value;
  const option = field.options?.find((candidate) => String(candidate.value) === raw);
  activeEntry.value?.store.set(field.key, option ? option.value : raw);
};

/** 恢复当前插件设置到声明默认值 */
const onReset = (): void => {
  activeEntry.value?.store.reset();
};
</script>

<template>
  <BaseModal
    v-model:open="open"
    title="插件设置"
    max-width-class="max-w-lg"
    height-class="h-[70dvh]"
  >
    <BaseEmpty
      v-if="settingsEntries.length === 0"
      text="当前没有可设置的插件——插件在清单里声明 settings 字段后就会出现在这里"
    />

    <template v-else>
      <!-- 插件切换（声明了设置的插件通常只有一两个，用胶囊行不用侧栏） -->
      <div class="mb-4 flex flex-wrap gap-1.5">
        <button
          v-for="entry in settingsEntries"
          :key="entry.id"
          type="button"
          class="rounded-full px-3 py-1 text-xs transition-colors"
          :class="
            entry.id === activeId
              ? 'bg-primary text-on-primary'
              : 'bg-flat-weak text-text-secondary hover:text-text'
          "
          @click="activeId = entry.id"
        >
          {{ entry.name }}
        </button>
      </div>

      <template v-if="activeEntry">
        <h4 class="mb-1 text-sm font-semibold text-text">{{ sectionTitle(activeEntry) }}</h4>
        <p v-if="activeEntry.declaration.description" class="mb-3 text-xs text-text-tertiary">
          {{ activeEntry.declaration.description }}
        </p>

        <!-- 自定义设置组件：插件自带 UI，宿主只注入 settings 存取句柄 -->
        <component
          :is="activeEntry.declaration.component"
          v-if="activeEntry.declaration.component"
          :settings="activeEntry.store"
        />

        <!-- 声明式字段：通用表单渲染 -->
        <div v-else class="space-y-4">
          <div
            v-for="field in activeEntry.declaration.fields ?? []"
            :key="field.key"
            class="flex items-start justify-between gap-4"
          >
            <div class="min-w-0">
              <p class="text-sm text-text">{{ field.label }}</p>
              <p v-if="field.description" class="mt-0.5 text-xs text-text-tertiary">
                {{ field.description }}
              </p>
            </div>

            <div class="w-44 shrink-0">
              <BaseSwitch
                v-if="field.type === 'boolean'"
                :model-value="activeEntry.store.get<boolean>(field.key, field.default === true)"
                :aria-label="field.label"
                @update:model-value="onBooleanChange(field, $event)"
              />
              <BaseInput
                v-else-if="field.type === 'number'"
                type="number"
                :min="field.min"
                :max="field.max"
                :step="field.step"
                :model-value="numberValue(field)"
                :aria-label="field.label"
                @update:model-value="numberDraft[field.key] = $event"
                @blur="onNumberBlur(field, $event)"
              />
              <BaseInput
                v-else-if="field.type === 'text'"
                :model-value="textValue(field)"
                :placeholder="String(field.default ?? '')"
                :aria-label="field.label"
                @update:model-value="onTextInput(field, $event)"
                @blur="onTextBlur(field, $event)"
              />
              <select
                v-else
                class="w-full rounded-lg bg-flat-weak px-3 py-1.5 text-sm text-text outline-none focus:ring-1 focus:ring-primary"
                :value="String(activeEntry.store.get(field.key, field.default ?? ''))"
                :aria-label="field.label"
                @change="onSelectChange(field, $event)"
              >
                <option
                  v-for="option in field.options ?? []"
                  :key="String(option.value)"
                  :value="String(option.value)"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <div class="mt-5 border-t border-flat-weak pt-3">
          <button
            type="button"
            class="pressable inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-95"
            @click="onReset"
          >
            <MenuIcon name="trash" :size="13" />
            恢复此插件默认设置
          </button>
        </div>
      </template>
    </template>
  </BaseModal>
</template>
