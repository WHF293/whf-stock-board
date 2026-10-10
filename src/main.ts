// ⚠️ 必须最先导入：补 process/global 垫片，早于 deepagents 依赖链（micromatch →
// picomatch）的模块求值，否则 WebView 下会白屏（详见该模块注释）
import './utils/node-globals-shim';
import './assets/styles/main.css';

// 构建期分流（vite --mode）：
// - mobile（pnpm dev:mobile / build:mobile / tauri android dev|build）→ 只打包 src/mobile/ 移动壳，
//   桌面启动链（App.vue → MainLayout / 插件 / Agent / weblog）整体不进包；
// - 其余（pnpm dev / build / tauri dev|build）→ 桌面原流程，行为与拆分前 main.ts 主体一致。
// import.meta.env.MODE 是构建期常量，vite 会把不可达分支整树剔除，桌面产物不含移动代码、反之亦然
if (import.meta.env.MODE === 'mobile') {
  void import('./mobile/bootstrap').then(({ bootstrapMobile }) => bootstrapMobile());
} else {
  void import('./bootstrap-desktop').then(({ bootstrapDesktop }) => bootstrapDesktop());
}
