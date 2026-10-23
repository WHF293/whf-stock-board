<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseConfirmModal from '../ui/BaseConfirmModal.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseTag from '../ui/BaseTag.vue';
import {
  ROTATION_MIN_SCORE_RATE_DEFAULT,
  ROTATION_MIN_SCORE_RATE_RANGE,
} from '../../../common/constants/board-rotation.constants.ts';
import { useSettingsStore } from '../../../common/stores/settings';
import { normalizeRotationMinScoreRate } from '../../../common/utils/normalize-rotation-min-score-rate';

/**
 * 题材轮动设置弹窗（控制行「权重」旁「设置」按钮入口，王总 2026-10-23）
 *
 * 唯一配置项：上榜最低得分率（当日得分率低于该值的板块无 bump 图上榜资格，
 * 修复「全军覆没日仍取前三名」——如 2026-10-22 前三名得分率全负仍画线）。
 * 「恢复默认值」只重填表单，「保存」需经二次确认才写入 settings store 即时生效。
 */

const openModel = defineModel<boolean>('open', { required: true });

const settingsStore = useSettingsStore();

/** 表单（字符串态，number input 的 v-model 原始值；保存时统一解析与钳位） */
const form = ref('');

/** 二次确认弹窗开关 */
const confirmOpen = ref(false);

/** 二次确认弹窗的待保存值（确认时才写 store） */
const pendingValue = ref(ROTATION_MIN_SCORE_RATE_DEFAULT);

/** 打开时用当前生效值重填表单（取消后再开不残留半成品输入） */
watch(openModel, (isOpen) => {
  if (!isOpen) return;
  form.value = String(settingsStore.rotationMinScoreRate);
});

/** 解析表单为合法值：Number 后交给与 store 同一份归一化（非法回落默认，越界钳位）
 * @returns 归一化后的上榜最低得分率 */
const parseForm = (): number => normalizeRotationMinScoreRate(Number(form.value));

/** 保存：解析表单 → 弹二次确认（门槛变化会直接改变每日上榜名单与 bump 线轨迹） */
const onSave = (): void => {
  pendingValue.value = parseForm();
  confirmOpen.value = true;
};

/** 确认保存：写 store（持久化 + 即时生效）并关闭本弹窗 */
const onConfirmSave = (): void => {
  settingsStore.setRotationMinScoreRate(pendingValue.value);
  openModel.value = false;
};

/** 恢复默认值：只重填表单（仍需点「保存」走二次确认才生效） */
const onReset = (): void => {
  form.value = String(ROTATION_MIN_SCORE_RATE_DEFAULT);
};

/** 表单是否已是默认值（是则「恢复默认值」置灰，与权重管理器同口径） */
const isFormDefault = computed(
  () => Number(form.value) === ROTATION_MIN_SCORE_RATE_DEFAULT,
);
</script>

<template>
  <BaseModal
    v-model:open="openModel"
    title="题材轮动设置"
    max-width-class="max-w-sm"
  >
    <div class="flex flex-col gap-3">
      <p class="text-xs leading-relaxed text-text-tertiary">
        上榜最低得分率：当日得分率低于该值的板块无上榜资格。
        全市场情绪冰点的日子（如各板块得分率全负）bump 图不再强行取前三名，
        而是整体空榜——榜单只反映真正的主线板块。
      </p>
      <div class="flex items-center gap-3">
        <span class="w-28 shrink-0 text-xs leading-tight text-text">
          上榜最低得分率
          <span class="block text-[10px] text-text-tertiary">得分率 = 得分 ÷ 成分股数</span>
        </span>
        <!-- 滑动条（与权重管理器同款：accent-primary 着色） -->
        <input
          v-model="form"
          type="range"
          :min="ROTATION_MIN_SCORE_RATE_RANGE.MIN"
          :max="ROTATION_MIN_SCORE_RATE_RANGE.MAX"
          :step="1"
          class="min-w-0 flex-1 cursor-pointer accent-primary"
          aria-label="上榜最低得分率"
        >
        <!-- w-10 定宽 tabular-nums：负号/位数变化不推动滑杆（同权重管理器防抖口径） -->
        <BaseTag tone="primary" class="w-10 justify-center tabular-nums">
          {{ form }}
        </BaseTag>
      </div>
      <p class="text-[11px] leading-relaxed text-text-tertiary">
        取值范围 {{ ROTATION_MIN_SCORE_RATE_RANGE.MIN }} ~ {{ ROTATION_MIN_SCORE_RATE_RANGE.MAX }}，
        设为负值表示允许弱板块上榜。调整后历史日期同步重算，bump 线在无合格板块的日子断开。
      </p>
    </div>
    <template #footer>
      <BaseButton variant="ghost" :disabled="isFormDefault" @click="onReset">恢复默认值</BaseButton>
      <div class="flex-1" />
      <BaseButton variant="ghost" @click="openModel = false">取消</BaseButton>
      <BaseButton variant="primary" @click="onSave">保存</BaseButton>
    </template>
  </BaseModal>

  <BaseConfirmModal
    v-model:open="confirmOpen"
    title="确认保存"
    content="修改上榜门槛会直接改变每日上榜名单与 bump 线轨迹（历史日期同步重算，部分日期可能整日空榜）。确认保存并生效？"
    ok-text="确认保存"
    @ok="onConfirmSave"
  />
</template>
