<script setup lang="ts">
/**
 * 基础开关：滑动切换，按压动效
 */
const model = defineModel<boolean>({ required: true });
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="model"
    class="pressable relative h-6 w-11 shrink-0 rounded-full active:scale-95"
    :class="model ? 'bg-primary' : 'bg-flat'"
    @click="model = !model"
  >
    <span
      class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
      :class="model ? 'left-[22px]' : 'left-0.5'"
    />
  </button>
</template>
