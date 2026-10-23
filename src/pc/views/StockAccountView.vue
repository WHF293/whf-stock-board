<script setup lang="ts">
import TzzbDashboard from '../components/account/tzzb/TzzbDashboard.vue';

/**
 * 股票账户 · 投资账本数据中心
 *
 * 数据由同花顺投资账本官方 MCP 同步（当前开发阶段走 mock 传输，见
 * common/api/tzzb.api.ts 与 .ai/项目资源/投资账本MCP同步-开发方案.md）。
 * 六大模块：账户选择器 / 指标行 + 资产曲线 / 盈亏日历（三级下钻）/
 * 建清仓记录 / 品种总盈亏 / 交易记录（股票 + 基金 + 历史导入存量）。
 * 旧的手工交割单 / 对账单导入已于 2026-10-23 下线，存量流水在
 * 「交易记录 → 历史导入」页签只读展示。
 */
</script>

<template>
  <TzzbDashboard />
</template>
