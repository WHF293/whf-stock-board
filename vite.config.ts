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
  /**
   * dev server 显式绑定 **IPv4 回环**
   *
   * Vite 默认绑的是 `localhost`，而本机的 `localhost` 解析到 `[::1]` —— 于是它只在 IPv6 上监听，
   * IPv4 的 `127.0.0.1:5173` 是拒绝连接的（实测 `curl http://127.0.0.1:5173/` → 000，
   * `curl http://[::1]:5173/` → 200）。Windows 上 WebView2 解析 `devUrl` 里的 `localhost`
   * 走的是 IPv4 优先，于是 Tauri 客户端起来后窗口里加载不到页面 —— 表现为「窗口没打开」
   * （其实是开了一个白窗）。这里钉死 IPv4，`tauri.conf.json` 的 `devUrl` 同步改成显式地址。
   *
   * `strictPort`：端口被占就直接报错，别静默挪到 5174 —— 那会让 devUrl 和真实端口对不上。
   */
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
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
      /**
       * 多页入口：主应用 + 任务栏盯盘小组件（独立轻量窗口，不装插件内核，
       * 数据经 Tauri 事件来自主窗口既有盯盘引擎；见 src/widget/watch-widget-main.ts）
       */
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'watch-widget': fileURLToPath(new URL('./watch-widget.html', import.meta.url)),
      },
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
