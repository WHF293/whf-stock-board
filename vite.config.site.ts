import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * 官网独立构建配置（入口 site.html，源码 src/docs/）
 *
 * 与主应用（vite.config.ts）完全隔离：产物输出 dist-site/，部署到 GitHub Pages
 * 项目子路径 /whf-stock-board/。主应用 pnpm build 只走 index.html 入口，
 * 不会包含官网任何产物；官网代码仍受同一套 vue-tsc / ESLint 检查。
 */
export default defineConfig({
  // 官网构建根 = src/docs（入口 index.html 就在这里，产物根才是 Pages 子路径的 /）
  root: fileURLToPath(new URL('./src/docs', import.meta.url)),
  // GitHub Pages 项目站固定子路径（https://whf293.github.io/whf-stock-board/）
  base: '/whf-stock-board/',
  plugins: [tailwindcss(), vue()],
  // 官网不共享主应用 public/（图标集、榜单 logo 等都是客户端专属），favicon 由 src/docs 提供
  publicDir: false,
  // dev 端口固定 5174：主应用 devUrl 是 localhost:5173（客户端 dev 服务器），
  // 这里不锁端口的话 vite 默认也落 5173，先启动官网 dev 会抢占客户端 devUrl，
  // 导致 `pnpm dev:pc`（tauri dev）窗口加载成官网（localhost 在 WebView2 里解析到 ::1）
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    // root 改后 outDir 相对 root 解析，这里锚回项目根的 dist-site/
    outDir: fileURLToPath(new URL('./dist-site', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        site: fileURLToPath(new URL('./src/docs/index.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
})
