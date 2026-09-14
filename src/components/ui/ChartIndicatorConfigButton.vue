<script setup lang="ts">
import { ref } from 'vue';
import BaseButton from './BaseButton.vue';
import BaseModal from './BaseModal.vue';
import MenuIcon from './MenuIcon.vue';
import { useSettingsStore } from '../../stores/settings';
import {
  CHART_MAIN_INDICATOR_OPTIONS,
  CHART_SUB_INDICATOR_OPTIONS,
  CHART_MAIN_INDICATORS_DEFAULT,
  CHART_SUB_INDICATORS_DEFAULT,
} from '../../constants/stock-indicator.constants';

/**
 * 图表指标配置按钮（股票详情页周期按钮组后）：点击弹出指标勾选弹窗
 *
 * 与 TabConfigButton 的草稿模式不同：无排序需求，**勾选即写 settings store 即生效**
 * （KlineChart watch 指标清单增量重建，无闪烁）。分时/五日指标固定，按钮置灰。
 */
defineProps<{
  /** 是否禁用（分时/五日模式下指标固定） */
  disabled?: boolean;
}>();

const open = ref(false);
const settingsStore = useSettingsStore();

/**
 * 切换指标勾选（勾选即生效；按选项声明顺序存储，保证副图面板顺序稳定）
 * @param kind 主图 / 副图
 * @param value 指标名
 * @param event 复选框 change 事件
 */
const onToggle = (kind: 'main' | 'sub', value: string, event: Event): void => {
  const checked = (event.target as HTMLInputElement).checked;
  const current = [...(kind === 'main'
    ? settingsStore.chartMainIndicators
    : settingsStore.chartSubIndicators)];
  const next = checked ? [...current, value] : current.filter((item) => item !== value);
  const order: readonly string[] = (kind === 'main'
    ? CHART_MAIN_INDICATOR_OPTIONS
    : CHART_SUB_INDICATOR_OPTIONS).map((option) => option.value);
  next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  settingsStore.setChartIndicators(
    kind === 'main' ? next : [...settingsStore.chartMainIndicators],
    kind === 'sub' ? next : [...settingsStore.chartSubIndicators],
  );
};

/** 恢复默认勾选（MA / VOL + MACD&KDJ） */
const onResetDefault = (): void => {
  settingsStore.setChartIndicators([...CHART_MAIN_INDICATORS_DEFAULT], [...CHART_SUB_INDICATORS_DEFAULT]);
};
</script>

<template>
  <button
    type="button"
    class="pressable shrink-0 rounded-lg p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    :disabled="disabled"
    :title="disabled ? '分时/五日指标固定' : '配置主图/副图指标'"
    aria-label="配置指标"
    @click="open = true"
  >
    <MenuIcon name="sliders" :size="15" />
  </button>

  <BaseModal v-model:open="open" title="指标配置" max-width-class="max-w-sm">
    <p class="mb-3 text-xs text-text-tertiary">
      勾选后立即生效并记住（分时/五日指标固定，不在此配置范围）。
    </p>

    <div class="space-y-4">
      <!-- 主图指标 -->
      <div>
        <p class="mb-1.5 text-xs font-semibold text-text-secondary">主图指标</p>
        <div class="space-y-1">
          <label
            v-for="option in CHART_MAIN_INDICATOR_OPTIONS"
            :key="option.value"
            class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-flat-weak"
          >
            <input
              type="checkbox"
              class="h-4 w-4 cursor-pointer rounded border-flat-weak accent-primary"
              :checked="settingsStore.chartMainIndicators.includes(option.value)"
              @change="onToggle('main', option.value, $event)"
            />
            <span class="text-text">{{ option.label }}</span>
          </label>
        </div>
      </div>

      <!-- 副图指标 -->
      <div>
        <p class="mb-1.5 text-xs font-semibold text-text-secondary">副图指标</p>
        <div class="space-y-1">
          <label
            v-for="option in CHART_SUB_INDICATOR_OPTIONS"
            :key="option.value"
            class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-flat-weak"
          >
            <input
              type="checkbox"
              class="h-4 w-4 cursor-pointer rounded border-flat-weak accent-primary"
              :checked="settingsStore.chartSubIndicators.includes(option.value)"
              @change="onToggle('sub', option.value, $event)"
            />
            <span class="text-text">{{ option.label }}</span>
          </label>
        </div>
      </div>
    </div>

    <template #footer>
      <BaseButton variant="ghost" class="mr-auto" @click="onResetDefault">恢复默认</BaseButton>
      <BaseButton @click="open = false">关闭</BaseButton>
    </template>
  </BaseModal>
</template>
