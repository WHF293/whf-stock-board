<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseConfirmModal from '../ui/BaseConfirmModal.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseTag from '../ui/BaseTag.vue';
import {
  BOARD_SCORE_WEIGHTS_DEFAULT,
  BOARD_SCORE_WEIGHT_RANGE,
  BOARD_SCORE_WEIGHT_STEP,
} from '../../../common/constants/board-calendar.constants.ts';
import { ROTATION_WEIGHT_FIELDS } from '../../../common/constants/board-rotation.constants.ts';
import { useSettingsStore } from '../../../common/stores/settings';
import type { BoardScoreWeights } from '../../../common/types/board-calendar.types.ts';
import { normalizeBoardScoreWeights } from '../../../common/utils/normalize-board-score-weights';

/**
 * 板块得分权重管理器（题材轮动页控制行入口，王总 2026-10-22）
 *
 * 六个互斥分桶各配一个滑动条权重（-10 ~ 10，整数步进），保存后经 settings store
 * 持久化并即时生效（板块日历矩阵 / 赚钱效应 / 板块Top / 题材轮动四路消费同一份加权行）。
 * 「恢复默认值」只重填表单，与「保存」同样需经二次确认才生效。
 *
 * 口径提示：库内 score 列永远按默认权重落库，自定义得分由分桶 × 权重在前端现算；
 * 无分桶数据的行（旧数据 / 回补日 / 盘中未覆盖板块）继续使用默认口径得分。
 */

const openModel = defineModel<boolean>('open', { required: true });

const settingsStore = useSettingsStore();

/** 表单（字符串态，number input 的 v-model 原始值；保存时统一解析与钳位） */
const form = ref<Record<keyof BoardScoreWeights, string>>({
  limitUp: '',
  gt5: '',
  up05: '',
  down05: '',
  lt5: '',
  limitDown: '',
});

/** 二次确认弹窗开关 */
const confirmOpen = ref(false);

/** 二次确认弹窗的待保存权重（确认时才写 store） */
const pendingWeights = ref<BoardScoreWeights>({ ...BOARD_SCORE_WEIGHTS_DEFAULT });

/** 打开时用当前生效权重重填表单（取消后再开不残留半成品输入） */
watch(openModel, (isOpen) => {
  if (!isOpen) return;
  for (const field of ROTATION_WEIGHT_FIELDS) {
    form.value[field.key] = String(settingsStore.boardScoreWeights[field.key]);
  }
});

/**
 * 解析表单为合法权重：Number 后交给与 store 同一份归一化
 * （非法 / 缺键回落默认值，越界钳位到 [-10, 10]）
 * @returns 归一化后的权重
 */
const parseForm = (): BoardScoreWeights =>
  normalizeBoardScoreWeights(
    Object.fromEntries(
      ROTATION_WEIGHT_FIELDS.map((field) => [field.key, Number(form.value[field.key])]),
    ),
  );

/** 保存：解析表单 → 弹二次确认（变更可能导致板块得分与排名变化） */
const onSave = (): void => {
  pendingWeights.value = parseForm();
  confirmOpen.value = true;
};

/** 确认保存：写 store（持久化 + 即时生效）并关闭本弹窗 */
const onConfirmSave = (): void => {
  settingsStore.setBoardScoreWeights(pendingWeights.value);
  openModel.value = false;
};

/** 恢复默认值：只重填表单（仍需点「保存」走二次确认才生效） */
const onReset = (): void => {
  for (const field of ROTATION_WEIGHT_FIELDS) {
    form.value[field.key] = String(BOARD_SCORE_WEIGHTS_DEFAULT[field.key]);
  }
};

/** 表单是否已全是默认值（是则「恢复默认值」置灰，与设置页玻璃透明度的「默认」同口径） */
const isFormDefault = computed(() =>
  ROTATION_WEIGHT_FIELDS.every(
    (field) => Number(form.value[field.key]) === BOARD_SCORE_WEIGHTS_DEFAULT[field.key],
  ),
);
</script>

<template>
  <BaseModal
    v-model:open="openModel"
    title="权重管理器"
    max-width-class="max-w-md"
  >
    <div class="flex flex-col gap-3">
      <p class="text-xs leading-relaxed text-text-tertiary">
        板块得分 = 各分桶家数 × 对应权重之和。分桶互斥：涨停 / 跌停按涨跌停池口径单独成桶，
        其余个股按当日涨跌幅落入 5% 两侧的温和 / 强势桶。取值范围 {{ BOARD_SCORE_WEIGHT_RANGE.MIN }} ~
        {{ BOARD_SCORE_WEIGHT_RANGE.MAX }}。
      </p>
      <div class="flex flex-col gap-2.5">
        <div
          v-for="field in ROTATION_WEIGHT_FIELDS"
          :key="field.key"
          class="flex items-center gap-3"
        >
          <span class="w-28 shrink-0 text-xs leading-tight text-text">
            {{ field.label }}
            <span v-if="field.hint" class="block text-[10px] text-text-tertiary">{{ field.hint }}</span>
          </span>
          <!-- 滑动条（与设置页玻璃透明度同款：accent-primary 着色） -->
          <input
            v-model="form[field.key]"
            type="range"
            :min="BOARD_SCORE_WEIGHT_RANGE.MIN"
            :max="BOARD_SCORE_WEIGHT_RANGE.MAX"
            :step="BOARD_SCORE_WEIGHT_STEP"
            class="min-w-0 flex-1 cursor-pointer accent-primary"
            :aria-label="`权重：${field.label}`"
          >
          <!-- w-10 定宽 tabular-nums：负号/位数变化不推动滑杆（同设置页防抖口径） -->
          <BaseTag tone="primary" class="w-10 justify-center tabular-nums">
            {{ form[field.key] }}
          </BaseTag>
        </div>
      </div>
      <p class="text-[11px] leading-relaxed text-text-tertiary">
        无分桶数据的日子（历史旧数据 / 回补日）继续使用默认口径得分；
        新采集与手动刷新会自动补齐分桶。
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
    content="修改权重会改变板块得分的计算口径，可能导致板块日历、赚钱效应与题材轮动的排序和色阶发生变化。确认保存并生效？"
    ok-text="确认保存"
    @ok="onConfirmSave"
  />
</template>
