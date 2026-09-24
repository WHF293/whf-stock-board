<script setup lang="ts">
import { ref } from 'vue';
import type { ModelConfig } from '@/types/agent.types';
import MenuIcon from '@/components/ui/MenuIcon.vue';

/**
 * 输入框底栏的模型切换下拉
 *
 * 点击当前模型徽标上弹模型列表，当前生效项打勾；选择后经 `select` 交给宿主
 * 处理（有会话 = 绑定会话；无会话 = 设为默认模型，语义见 store.setSessionModel）。
 * 「当前生效」由宿主传入（store.effectiveModel 是唯一事实源），本组件不做判定。
 * 弹层关闭用 fixed 全屏遮罩捕获外点，模式与 SessionTree 的 ⋯ 菜单一致。
 */
const props = defineProps<{
  /** 可选模型列表 */
  models: ModelConfig[];
  /** 当前生效模型（会话绑定 > Agent 配置 > 默认） */
  current: ModelConfig | null;
}>();

const emit = defineEmits<{
  /** 选中某个模型 */
  (e: 'select', model: ModelConfig): void;
}>();

/** 弹层开关 */
const open = ref(false);

/**
 * 选择模型并收起弹层
 * @param model 模型
 */
const choose = (model: ModelConfig): void => {
  open.value = false;
  emit('select', model);
};
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs text-text-tertiary transition-colors hover:bg-flat-weak hover:text-text-secondary"
      :title="
        props.current
          ? `请求参数 model：${props.current.modelId}\n接口地址：${props.current.baseUrl}`
          : '未配置模型'
      "
      aria-label="切换模型"
      @click="open = !open"
    >
      <MenuIcon name="cpu" :size="13" class="shrink-0" />
      <span class="max-w-[9rem] truncate">{{ props.current ? props.current.name : '未配置模型' }}</span>
      <MenuIcon name="chevronDown" :size="12" class="shrink-0" />
    </button>

    <!-- 外点遮罩：全屏透明层，压在触发按钮上方、弹层下方 -->
    <div v-if="open" class="fixed inset-0 z-40" @click="open = false" />

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border border-flat-weak bg-surface py-1 shadow-lg"
    >
      <p class="px-3 pb-1 pt-1.5 text-[11px] text-text-tertiary">切换模型</p>
      <button
        v-for="model in props.models"
        :key="model.id"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-flat-weak"
        @click="choose(model)"
      >
        <MenuIcon
          name="check"
          :size="14"
          class="shrink-0"
          :class="props.current?.id === model.id ? 'text-primary' : 'text-transparent'"
        />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm text-text">{{ model.name }}</span>
          <span class="block truncate text-[11px] text-text-tertiary">{{ model.modelId }}</span>
        </span>
        <span
          v-if="model.isDefault"
          class="shrink-0 rounded bg-flat-weak px-1.5 py-0.5 text-[10px] text-text-tertiary"
        >
          默认
        </span>
      </button>
      <p v-if="props.models.length === 0" class="px-3 py-2 text-xs text-text-tertiary">
        尚未配置模型，请先在 Model 管理中添加
      </p>
    </div>
  </div>
</template>
