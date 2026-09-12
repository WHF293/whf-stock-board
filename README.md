# whf-stock-board

A 股看板 SPA（个人学习用）：行情总览 / 自选股 / 行情全景 / 资金动向 / 涨停异动 / 龙虎榜·大宗 / 选股器（基础筛选 · 信号扫描 · 尾盘选股）。

## 技术栈

Vue 3.5 + TypeScript + Vite + vue-router + Pinia + ECharts + Tailwind CSS 4，数据源 [stock-sdk](https://stock-sdk.linkdiary.cn/)（腾讯 / 东方财富）。

## 开发

```bash
pnpm install
pnpm dev       # 开发（含 /stock-proxy 本地代理中间件，解决东财 CORS）
pnpm build     # 类型检查 + 构建产物
pnpm preview   # 预览构建产物
pnpm lint      # ESLint
```

## 部署

main 分支推送后由 GitHub Actions 自动构建并发布到 GitHub Pages：https://whf293.github.io/whf-stock-board/

## 说明

- 数据仅供个人学习参考，不构成投资建议
- 行情自动刷新仅在交易时段轮询（A 股 09:15–15:00；美股 21:30–24:00 与 00:00–04:00），非交易时段仅进入页面时请求一次
- GitHub Pages 为纯静态托管，本地代理中间件不生效，线上仅腾讯源数据（个股行情 / 分时 / 搜索等）可用，东财源数据（板块 / 资金流 / 全市场快照等）需本地运行
