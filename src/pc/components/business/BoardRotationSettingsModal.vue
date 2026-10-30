<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseConfirmModal from '../ui/BaseConfirmModal.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import BaseTag from '../ui/BaseTag.vue';
import {
  ROTATION_DIRECTION_OPTIONS,
  ROTATION_ESCAPE_SCORE_RATE_DEFAULT,
  ROTATION_MIN_SCORE_RATE_DEFAULT,
  ROTATION_MIN_SCORE_RATE_RANGE,
} from '../../../common/constants/board-rotation.constants.ts';
import { useSettingsStore } from '../../../common/stores/settings';
import { normalizeRotationMinScoreRate } from '../../../common/utils/normalize-rotation-min-score-rate';
import type { RotationDirection } from '../../../common/types/board-rotation.types.ts';

/**
 * 题材轮动设置弹窗（控制行「权重」旁「设置」按钮入口，王总 2026-10-23；
 * 2026-10-30 起涌入 / 逃离方向与两条得分率门槛统一收进本弹窗）
 *
 * 三个配置项：
 * - 上榜方向：涌入（得分高的前 N，主线视角）/ 逃离（得分低的前 N，出逃视角）；
 * - 涌入上榜最低得分率：当日得分率低于该值的板块无涌入榜资格（修复「全军覆没日仍取前三名」）；
 * - 逃离上榜最高得分率：当日得分率高于该值的板块无逃离榜资格（独立于涌入门槛，不再自动取负）。
 * 「恢复默认值」只重填表单，「保存」需经二次确认才写入 settings store 即时生效；
 * 方向随保存一并生效（经 confirm 事件上抛给面板，未保存前不动 bump 图）。
 */

const openModel = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{
  /** 保存成功：回传新方向（由面板更新 v-model:direction，门槛已直接写 settings store） */
  confirm: [direction: RotationDirection];
}>();

const settingsStore = useSettingsStore();

/** 涌入门槛表单（字符串态，range input 的 v-model 原始值；保存时统一解析与钳位） */
const inflowForm = ref('');
/** 逃离门槛表单（同上） */
const escapeForm = ref('');
/** 上榜方向表单（草稿态，BaseTabs 字符串 v-model；保存时收窄为 RotationDirection） */
const directionForm = ref<string>('inflow');

/** 当前生效的上榜方向（由父级经 v-model:direction 下发，保存确认时写回） */
const currentDirection = defineModel<RotationDirection>('direction', { default: 'inflow' });

/** 二次确认弹窗开关 */
const confirmOpen = ref(false);

/** 二次确认弹窗的待保存值（确认时才写 store / 上抛方向） */
const pendingInflow = ref(ROTATION_MIN_SCORE_RATE_DEFAULT);
const pendingEscape = ref(ROTATION_ESCAPE_SCORE_RATE_DEFAULT);
const pendingDirection = ref<RotationDirection>('inflow');

/** 涌入 / 逃离切换选项（BaseTabs 字符串 value） */
const directionTabOptions = [...ROTATION_DIRECTION_OPTIONS];

/** 打开时用当前生效值重填表单（取消后再开不残留半成品输入） */
watch(openModel, (isOpen) => {
  if (!isOpen) return;
  inflowForm.value = String(settingsStore.rotationMinScoreRate);
  escapeForm.value = String(settingsStore.rotationEscapeScoreRate);
  directionForm.value = currentDirection.value;
});

/** 解析涌入门槛表单为合法值（与 store 同一份归一化：非法回落默认，越界钳位）
 * @returns 归一化后的涌入上榜最低得分率 */
const parseInflowForm = (): number => normalizeRotationMinScoreRate(Number(inflowForm.value));

/** 解析逃离门槛表单为合法值（非法回落逃离门槛默认值）
 * @returns 归一化后的逃离上榜最高得分率 */
const parseEscapeForm = (): number =>
  normalizeRotationMinScoreRate(Number(escapeForm.value), ROTATION_ESCAPE_SCORE_RATE_DEFAULT);

/** 保存：解析表单 → 弹二次确认（方向与门槛变化会直接改变每日上榜名单与 bump 线轨迹） */
const onSave = (): void => {
  pendingInflow.value = parseInflowForm();
  pendingEscape.value = parseEscapeForm();
  pendingDirection.value = directionForm.value === 'escape' ? 'escape' : 'inflow';
  confirmOpen.value = true;
};

/** 确认保存：门槛写 store（持久化 + 即时生效）、方向上抛面板，并关闭本弹窗 */
const onConfirmSave = (): void => {
  settingsStore.setRotationMinScoreRate(pendingInflow.value);
  settingsStore.setRotationEscapeScoreRate(pendingEscape.value);
  currentDirection.value = pendingDirection.value;
  emit('confirm', pendingDirection.value);
  openModel.value = false;
};

/** 恢复默认值：只重填表单（仍需点「保存」走二次确认才生效） */
const onReset = (): void => {
  inflowForm.value = String(ROTATION_MIN_SCORE_RATE_DEFAULT);
  escapeForm.value = String(ROTATION_ESCAPE_SCORE_RATE_DEFAULT);
  directionForm.value = 'inflow';
};

/** 表单是否已是默认值（是则「恢复默认值」置灰，与权重管理器同口径） */
const isFormDefault = computed(
  () =>
    Number(inflowForm.value) === ROTATION_MIN_SCORE_RATE_DEFAULT &&
    Number(escapeForm.value) === ROTATION_ESCAPE_SCORE_RATE_DEFAULT &&
    directionForm.value === 'inflow',
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
        上榜方向决定 bump 图画谁：「涌入」取得分高的前 N 名（主线视角），
        「逃离」取得分低的前 N 名（资金出逃视角，逃离方向不做主线判定）。
      </p>
      <!-- self-start：BaseTabs 是 inline-flex，flex-col 父容器的 stretch 会把胶囊容器撑满整行 -->
      <BaseTabs
        v-model="directionForm"
        class="self-start"
        :options="directionTabOptions"
        aria-label="上榜方向（涌入 / 逃离）"
      />
      <div class="flex items-center gap-3">
        <span class="w-28 shrink-0 text-xs leading-tight text-text">
          涌入上榜最低得分率
          <span class="block text-[10px] text-text-tertiary">得分率 = 得分 ÷ 成分股数</span>
        </span>
        <!-- 滑动条（与权重管理器同款：accent-primary 着色） -->
        <input
          v-model="inflowForm"
          type="range"
          :min="ROTATION_MIN_SCORE_RATE_RANGE.MIN"
          :max="ROTATION_MIN_SCORE_RATE_RANGE.MAX"
          :step="1"
          class="min-w-0 flex-1 cursor-pointer accent-primary"
          aria-label="涌入上榜最低得分率"
        >
        <!-- w-10 定宽 tabular-nums：负号/位数变化不推动滑杆（同权重管理器防抖口径） -->
        <BaseTag tone="primary" class="w-10 justify-center tabular-nums">
          {{ inflowForm }}
        </BaseTag>
      </div>
      <div class="flex items-center gap-3">
        <span class="w-28 shrink-0 text-xs leading-tight text-text">
          逃离上榜最高得分率
          <span class="block text-[10px] text-text-tertiary">得分率 ≤ 该值才有逃离榜资格</span>
        </span>
        <input
          v-model="escapeForm"
          type="range"
          :min="ROTATION_MIN_SCORE_RATE_RANGE.MIN"
          :max="ROTATION_MIN_SCORE_RATE_RANGE.MAX"
          :step="1"
          class="min-w-0 flex-1 cursor-pointer accent-primary"
          aria-label="逃离上榜最高得分率"
        >
        <BaseTag tone="primary" class="w-10 justify-center tabular-nums">
          {{ escapeForm }}
        </BaseTag>
      </div>
      <p class="text-[11px] leading-relaxed text-text-tertiary">
        两条门槛取值范围均为 {{ ROTATION_MIN_SCORE_RATE_RANGE.MIN }} ~ {{ ROTATION_MIN_SCORE_RATE_RANGE.MAX }}。
        涌入门槛设为负值表示允许弱板块上榜；调整后历史日期同步重算，bump 线在无合格板块的日子断开。
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
    content="修改上榜方向或门槛会直接改变每日上榜名单与 bump 线轨迹（历史日期同步重算，部分日期可能整日空榜）。确认保存并生效？"
    ok-text="确认保存"
    @ok="onConfirmSave"
  />
</template>
