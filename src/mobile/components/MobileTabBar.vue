<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { MOBILE_TAB_ITEMS } from '../constants';

/**
 * 底部 TabBar：三个主 Tab（热点新闻 / 今天炒什么 / 我的）
 * 仅在主 Tab 路由显示（二级页隐藏）；激活态由 router-link 的 active-class 按路径匹配
 */
const route = useRoute();
const visible = computed(() => MOBILE_TAB_ITEMS.some((item) => item.path === route.path));
</script>

<template>
  <nav v-if="visible" class="m-tabbar">
    <router-link
      v-for="item in MOBILE_TAB_ITEMS"
      :key="item.path"
      :to="item.path"
      class="m-tabbar__item"
      active-class="m-tabbar__item--active"
    >
      <span class="m-tabbar__icon">{{ item.icon }}</span>
      <span>{{ item.label }}</span>
    </router-link>
  </nav>
</template>
