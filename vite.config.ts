import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { stockProxyPlugin } from './server/stock-proxy-middleware.ts'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages 项目页托管在 /whf-stock-board/ 子路径下，仅构建时启用
  base: command === 'build' ? '/whf-stock-board/' : '/',
  plugins: [tailwindcss(), vue(), stockProxyPlugin()],
  resolve: {
    alias: {
      /** @ 指向 src 目录，业务代码统一用 @/xxx 导入 */
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
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
}))
