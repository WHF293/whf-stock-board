<script setup lang="ts">
import { useRouter } from 'vue-router';
import { APP_VERSION } from '../../constants/app-info.constants';
import { MOBILE_DISCLAIMER } from '../constants';

/**
 * 我的（移动端 v1）：应用信息卡 + 设置 / 主题设置两个入口 + 底部数据声明。
 * 无账号体系；后续版本的个股详情、自选同步等个人能力挂在本 Tab 下扩展。
 */

const router = useRouter();

const goSettings = (): void => {
  void router.push('/settings');
};
const goTheme = (): void => {
  void router.push('/theme');
};
</script>

<template>
  <div class="m-tab-safe">
    <van-nav-bar title="我的" class="m-nav" safe-area-inset-top />

    <div class="m-mine-hero">
      <div class="m-app-icon">股</div>
      <div>
        <div class="m-mine-hero__t">A股看板</div>
        <div class="m-mine-hero__d">
          v{{ APP_VERSION }} <span class="m-mini-tag">APK 直装版</span>
        </div>
      </div>
    </div>

    <div class="m-set-group" style="margin-top: 12px">
      <button class="m-set-row" @click="goSettings">
        <div class="m-set-row__ic">⚙</div>
        <div class="m-set-row__t">
          设置
          <span class="d">检查更新 · 轮询与缓存 · 免责声明</span>
        </div>
        <span class="m-set-row__arr">›</span>
      </button>
      <button class="m-set-row" @click="goTheme">
        <div class="m-set-row__ic">◐</div>
        <div class="m-set-row__t">
          主题设置
          <span class="d">明暗模式 · 主题色 · 涨跌配色</span>
        </div>
        <span class="m-set-row__arr">›</span>
      </button>
    </div>

    <div class="m-foot-note">{{ MOBILE_DISCLAIMER }}</div>
  </div>
</template>

<style scoped>
.m-mine-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
  padding: 20px 16px;
  background: var(--color-surface);
  border-radius: 12px;
  margin-inline: 16px;
}
.m-app-icon {
  width: 54px;
  height: 54px;
  border-radius: 14px;
  background: var(--color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 800;
  flex-shrink: 0;
}
.m-mine-hero__t { font-size: 17px; font-weight: 800; line-height: 1.3; }
.m-mine-hero__d {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--color-text-3);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.m-mini-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--color-primary-weak);
  color: var(--color-primary);
}
</style>
