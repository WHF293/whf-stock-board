import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { stockProxyPlugin } from './server/stock-proxy-middleware.ts'

// https://vite.dev/config/
export default defineConfig({
  // 根路径：Tauri 客户端与常规托管均部署在域名根下
  // （GitHub Pages 子路径托管已关闭；如重启用请改回 '/whf-stock-board/'）
  base: '/',
  plugins: [tailwindcss(), vue(), stockProxyPlugin()],
  resolve: {
    alias: [
      /**
       * 浏览器端把 Node 内置 `path` 换成 POSIX 垫片：
       * deepagents（浏览器入口）→ micromatch → picomatch 会在模块顶层读
       * `path.sep`，否则 Vite 会按 node 内置外部化并报控制台错误、取到 undefined。
       * 正则精确匹配，避免误伤 `path-browserify` 之类的裸模块名。
       */
      {
        find: /^path$/,
        replacement: fileURLToPath(new URL('./src/utils/path-shim.ts', import.meta.url)),
      },
      /** @ 指向 src 目录，业务代码统一用 @/xxx 导入 */
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * echarts 体积大且多页共用，单独分包避免打进行情总览主 chunk
         */
        manualChunks: (id) => {
          if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) {
            return 'echarts';
          }
          return undefined;
        },
      },
    },
  },
})
