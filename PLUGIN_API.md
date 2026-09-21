# PLUGIN_API.md — 插件开放接口清单

> 本文件盘点**宿主开放给插件的全部能力**（`ctx.*` 九个贡献点、数据持久化、宿主服务、事件、配额与红线）。
> 类型契约的唯一事实源是 `src/types/plugin.types.ts`，宿主侧接线（注册顺序、 `recoverVanishedRoute`）见 `src/plugin/setup.ts`；
> 两者冲突时以代码为准，并回来修本文档。
>
> 适用版本：v2.6.1（含「插件工坊转正为宿主页面」的改动）。

## 0. 稳定性分层（先读这一节，它决定你能依赖什么）

插件作者实际能碰到的东西分三层，**只有第一层有兼容承诺**：

| 层 | 内容 | 谁能用 | 兼容承诺 |
| --- | --- | --- | --- |
| **① 契约层** | `ctx.*` 全部成员、`AppServiceMap` 六个宿主服务、`AppEventMap` 六个内置事件、`types/plugin.types.ts` 全部导出类型 | 源码级插件 + 应用内安装的用户插件 | **主版本号内保证向后兼容**；要改形态须同步本文档 |
| **② 服务扩展层** | 插件之间经 `ctx.provide` / `ctx.consume` 互相暴露的自定义服务与事件（如 `note:repo` / `note:saved`） | 任何插件 | 由「提供方插件」负责；消费方必须允许 `consume` 返回 `undefined` 并降级 |
| **③ 宿主内部模块** | `@/api/*`、`@/utils/*`、`@/composables/*`、`@/components/ui/*`、`@/stores/*` 等源码模块 | **仅源码级插件**（跟宿主一起构建） | 无承诺；改名 / 搬文件不另行通知 |

### 为什么第三层对第三方插件不可用（2026-09-20 实测）

用户插件是运行时把代码包成 Blob URL 再动态 `import()` 的（`src/plugin/user-plugin-loader.ts`），
它不经过 Vite 的依赖解析，因此：

| 尝试 | 实测结果 |
| --- | --- |
| `import { defineComponent, h } from 'vue'`（裸包名） | ❌ `Failed to resolve module specifier "vue"`（页面无 import map） |
| `import '/node_modules/.vite/deps/vue.js'`（绝对路径） | ❌ `Invalid relative url or base scheme isn't hierarchical`（blob: 不是层级 base） |
| `import(new URL('/src/utils/format-percent.ts', location.href))`（完整 URL） | ⚠️ dev 下可用、响应式实测通（拿到的是宿主同一份 Vue 实例）；生产构建里该路径不存在（产物是带 hash 的 chunk）→ **不可作为契约** |
| `component: { template: '<div>…</div>' }` | ❌ Vue 运行时不含模板编译器 → 控制台 `[Vue warn] Component provided template option but runtime compilation is not supported` 且渲染为空 |
| Tailwind class | ⚠️ 只有**宿主源码里出现过的类**才被生成到 CSS（`px-2` 实测生效 `padding-left: 8px`）；插件独有的类（`ps-[13px]`、`outline-dashed outline-fuchsia-500`）实测**无样式** |
| `window.whf*` 之类的全局 SDK | ❌ 宿主当前没有任何全局暴露（扫描 `window` 无命中） |

✅ **好消息**：不 import 任何东西的插件完全可以挂载——实测注册侧栏面板并渲染成功，
且 `ctx` 全套、六个宿主服务、`ctx.storage` / `ctx.db`（`ensureTable`→`insert`→`select`→`remove`→`count`）、`ctx.on` 全部可用。
**第三方插件请把自己限制在第 ① 层。**（补齐第三方可依赖的 UI/工具通道见 §13「已知缺口」）

---

## 1. 插件定义与生命周期

### 1.1 最小定义

```ts
import type { PluginDefinition } from '@/types/plugin.types';

export const myPlugin: PluginDefinition = {
  id: 'my-plugin',            // 全局唯一，kebab-case，规则 PLUGIN_ID_PATTERN
  name: '我的插件',
  version: '1.0.0',
  description: '一句话说明（插件管理弹窗展示）',
  author: '作者名',            // 缺省：内置插件显示「内置」，用户插件显示「用户安装」
  inject: ['other-plugin'],    // 可选：依赖的插件 id
  config: {},                  // 可选：只读配置（ctx.config）
  settings: { /* §4.3 */ },    // 可选：设置声明 → 设置弹窗自动出现表单
  apply: (ctx) => { /* 所有注册都在这里 */ },   // 可同步，也可 async（异步时状态先进 mounting）
};
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | ✅ | `/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+)*$/`；内置插件约定 `dsh-` 前缀；重复 id 后注册覆盖先注册 |
| `name` / `version` / `description` | `string` | ✅ | 展示用 |
| `author` | `string` | — | 缺省按来源兜底 |
| `inject` | `readonly string[]` | — | 依赖未挂载 → 本插件停在 `pending`；依赖被禁用 → 级联回 `pending`；**环形依赖不死循环**（都停在 pending） |
| `config` | `Record<string, unknown>` | — | 只读，随定义下发 |
| `settings` | `PluginSettingsDeclaration` | — | 见 §4.3 |
| `apply` | `(ctx) => void \| Promise<void>` | ✅ | 抛错 → 状态 `failed` + **已产生的贡献点全量回滚**，不自动重试（用户在管理弹窗点重试） |

### 1.2 状态机（`PLUGIN_STATUS`）

| 状态 | 含义 | 谁来推进 |
| --- | --- | --- |
| `mounted` | 已挂载，贡献点全部生效 | 内核 `settle()` |
| `mounting` | `apply` 返回 Promise，尚未 resolve | 插件自己 |
| `pending` | 等待依赖（或依赖被禁用导致的级联等待） | 依赖就绪后自动挂载 |
| `disabled` | 用户关闭（持久化黑名单） | `pluginKernel.setEnabled(id, false)` |
| `failed` | `apply` 抛错，贡献点已回滚 | `pluginKernel.retry(id)` 或重新启用 |

插件列表变化对外的信号是 `pluginKernel.revision`（`ref<number>`）——宿主 UI 响应式依赖它，插件一般不需要读。

---

## 2. `ctx` 速查

| 成员 | 形态 | 用途 |
| --- | --- | --- |
| `ctx.pluginId` | `string` | 本插件 id |
| `ctx.config` | `Record<string, unknown>` | 只读配置 |
| `ctx.logger` | `{ info, warn, error }` | 日志，前缀固定 `[plugin] <id> [级别]` |
| `ctx.storage` | `PluginStorage` | KV 持久化（§4.1） |
| `ctx.settings` | `PluginSettingsStore` | 清单式设置的运行时存取（§4.3） |
| `ctx.db` | `PluginDatabase` | 结构化表（§4.2） |
| `ctx.sidebar` / `ctx.header` / `ctx.menu` / `ctx.router` / `ctx.dock` / `ctx.command` / `ctx.stockRow` / `ctx.stockDetail` / `ctx.agent` | 贡献点 | 九个 UI / 能力扩展点（见 §3） |
| `ctx.effect(fn)` | `(fn: () => void \| (() => void)) => Disposable` | 立即执行一次 + 登记清理 |
| `ctx.onDispose(fn)` | `(fn: () => void) => void` | 只登记「卸载时回调」，不立即执行 |
| `ctx.provide(name, impl)` | 依赖 AppServiceMap | 贡献服务（§7） |
| `ctx.consume(name)` | 返回 `T \| undefined` | 注入服务（§5） |
| `ctx.on(name, handler)` | 返回 `Disposable` | 订阅事件（§6），卸载自动退订 |
| `ctx.emit(name, ...args)` | `void` | 广播事件，自动带上来源 pluginId |

> **可逆副作用是这套体系的地基**：所有 `add` 返回的 `Disposable` 都由内核收进本次挂载的副作用袋，
> 插件卸载 = 把袋子里的句柄逆序 dispose 一遍。**插件不需要写反向逻辑**。

---

## 3. 九个贡献点

通用规则（全部贡献点适用）：

- 全局键统一是 `<pluginId>#<id>`（`<id>` 只需插件内唯一）；
- **同 key 后注册者覆盖先注册者**（热替换友好），被覆盖者随本次挂载撤销而恢复；
- 带 `order` 的贡献点一律「升序排列、同 order 保持注册先后」；
- 表里的默认值取自 `src/constants/plugin.constants.ts`。

### 3.1 `ctx.sidebar.add()` — 左侧栏面板

```ts
ctx.sidebar.add({
  id: 'main',
  title: '盯盘',
  icon: 'bell',                       // MenuIcon 的 icon key，未知 key 渲染为空（不报错）
  mode: 'inline',                     // 'inline'（默认）直接渲染在侧栏 | 'drawer' 侧栏只放入口按钮，内容走右侧抽屉
  position: 'nav',                    // 'nav'（默认）菜单区 | 'footer' 侧栏底部（设置入口之上）
  order: 100,                         // 默认 100，越小越靠上
  component: PanelVue,                // 组件（宿主 <component :is> 渲染）
  props: {},                          // 默认 {}
  visibleWhenCollapsed: false,        // 侧栏收起为 64px 图标栏时是否仍渲染（仅 inline 有效，默认 false）
});
```

每次注册宿主都会广播 `sidebar:changed` 事件。面板组件内可用 `usePluginPanelHost()` 拿 `{ key, mode, close }`（`src/plugin/panel-host.ts`）。

⚠️ **面板会被卸载**：① 面板标题条折叠（`SidebarPanelHost` 的 `v-if`）② 侧栏收起且 `visibleWhenCollapsed` 为假。
**轮询 / 告警 / 定时任务必须写在插件层**，详见 §8.3。

### 3.2 `ctx.menu.add()` — 左侧导航菜单（带 component 自动产出路由）

```ts
ctx.menu.add({
  path: '/my-page',        // 须以 / 开头，不得与宿主菜单冲突
  title: '我的页',
  icon: 'star',
  component: PageVue,      // 传了 → 自动注册该路径的布局子路由，无需再 ctx.router.add
  props: {},
  order: 500,              // 默认 500（宿主页在前，插件页在后）
  fallbackLanding: true,   // 声明本页为「插件页随插件撤销时的兜底落点」，同值取 order 最小者
});
```

菜单项注册本身不广播专用事件（`sidebar:changed` / `header:changed` 除外）；菜单的**顺序与显隐**由用户在设置页「路由顺序编排」调整（`settings.menuOrder` / `hiddenMenus`）。

> `fallbackLanding` 的解析顺序（宿主 `recoverVanishedRoute`）：
> ① 声明了 `fallbackLanding` 的页面（**宿主自带页优先**，再是插件声明的）→ ② 侧栏第一个菜单 → ③ 宿主首页 `/dashboard`；
> 跳转用 `replace`（原页面已不存在）+ 右下角浮窗说明原因。

### 3.3 `ctx.router.add()` — 隐藏路由（不进菜单）

```ts
ctx.router.add({
  path: '/my-detail/:id',
  name: 'my-detail',       // 可选，供 router.push({ name }) 使用
  component: DetailVue,
  props: {},
  meta: { title: '明细' }, // title 用于顶栏与浏览器标题
  underLayout: true,       // 默认 true；独立窗口页传 false → 注册为顶层路由
});
```

路由增删由 `router-bridge` 按注册表版本号同步；用户直刷插件路由时，启动路径会在用户插件挂载完成后被还原（`setup.ts` 的 `mountUserPluginsLater`）。

### 3.4 `ctx.header.add()` — 顶栏条目（图标 + 单条轮播，点开下拉面板）

```ts
ctx.header.add({
  id: 'watch',
  title: '自选盯盘',
  icon: 'bell',
  order: 100,                 // 默认 100，越小越靠左
  component: HeaderPanelVue,  // 下拉面板内容
  props: {},
  marquee: () => lines,       // 收起态轮播数据源（响应式作用域内求值，直接读自己的 ref）
  marqueeIntervalMs: 4000,    // 默认 4000，低于 1500 会被夹到 1500
});
```

`marquee` 返回 `HeaderMarqueeLine[]`：

| 字段 | 说明 |
| --- | --- |
| `text` | 整行文本（同时作为无障碍朗读内容）；只给 `text` 时整行单行截断 |
| `label` / `price` / `percent` | **成对给出**时按「名称定宽可截断 + 数值定宽不截断」渲染（顶栏只有一行位置，宁可截名称也不能挤掉价格/涨跌幅） |
| `tone` | `'default' \| 'up' \| 'down' \| 'flat' \| 'primary'`（涨跌色跟随主题，插件不碰色值） |

返回空数组 → 收起态回落为条目名；返回单行 → 常显不轮播。宿主广播 `header:changed`。

### 3.5 `ctx.dock.add()` — 右侧停靠面板

```ts
ctx.dock.add({ id: 'my-dock', title: '我的面板', component: DockVue, props: {} });
```

打开方式：**自力更生** —— `useDockPanelStore().openPluginPanel('<pluginId>#<id>')`。
（`panel:open` 服务目前只覆盖侧栏 inline/drawer 与顶栏条目，不含 dock。）

### 3.6 `ctx.command.add()` — 命令（可挂全局快捷键）

```ts
ctx.command.add({ id: 'open', title: '打开我的面板', keys: 'Ctrl+Alt+N', run: () => {} });
```

- 快捷键由宿主在 capture 阶段统一匹配，插件**不要自己挂 `keydown`**（避免多插件抢事件与卸载后泄漏）；
- 修饰键：`Ctrl` / `Control`、`Shift`、`Alt`、`Meta` / `Cmd` / `Win` / `Command`；
- 具名键：`Tab Esc Escape Enter Space Up Down Left Right`；字母 `KeyX`、数字 `Digit0` 写 `X` / `0`；
- `keys` 可省略 → 只可编程调用（出现在命令面板 / 插件详情）。

### 3.7 `ctx.stockRow.add()` — 股票行操作（自选股等表格的「操作」列注入按钮）

```ts
ctx.stockRow.add({
  id: 'watch',
  title: '盯盘',
  activeTitle: '取消盯盘',              // 缺省沿用 title
  icon: 'bell',
  order: 100,                          // 默认 100；宿主自带的删除按钮恒在最后
  isActive: (row) => row.symbol === 'x',  // 缺省恒 false
  run: (row) => { /* row: { symbol, name } */ },
});
```

宿主只交出 `{ symbol, name }`，**不暴露行对象 / 表格实例**——插件无法改宿主数据。

### 3.8 `ctx.stockDetail.add()` — 个股详情扩展区

```ts
ctx.stockDetail.add({ id: 'notes', title: '速记', order: 100, component: SectionVue, props: {} });
```

组件会收到 `props.symbol`（归一化完整符号）与声明的 `props` 合并。
这是「跟着个股走」的功能（速记 / 标签 / 备注）统一入口，宿主不硬编码任何插件。

### 3.9 `ctx.agent.addServer()` — 内置 MCP 服务器（把能力交给 Agent）

```ts
ctx.agent.addServer({ id: -100, key: 'my-tools', name: '我的工具', description: '', tools: [...] });
```

工具类服务器会并入 `listBuiltinMcpServers()`，在「Agent 分析 → MCP 管理」里按归属插件展示。
`id` 沿用内置服务器的**负数 id 约定**（与远端服务器的正数 id 区分，共用授权表）。

---

## 4. 数据持久化（插件永不直接碰 SQL）

### 4.1 `ctx.storage` — KV（小体量偏好）

```ts
ctx.storage.get<T>(key, fallback);  // 键不存在 → fallback
ctx.storage.set(key, value);        // JSON 序列化
ctx.storage.remove(key);
```

- 命名空间 `plugin:<pluginId>`，落在 `whf:app` 整包 localStorage；**插件之间天然隔离**；
- Tauri 端额外异步镜像进 SQLite `plugin_storage` 表，启动时以库覆盖水合；
- 数据损坏时重置为空对象并记一条 `console.error`（不会抛给插件）；
- 卸载插件**不清理** storage（重装后数据还在）。

### 4.2 `ctx.db` — 结构化表（每插件独立）

```ts
await ctx.db.ensureTable('watch_candidates', [
  { name: 'symbol', type: 'text', indexed: true },
  { name: 'note',   type: 'text' },
  { name: 'score',  type: 'real' },
  { name: 'meta',   type: 'json' },
]);
const id = await ctx.db.insert('watch_candidates', { symbol: 'sh600519', score: 1 });
const rows = await ctx.db.select<{ symbol: string }>('watch_candidates', {
  where: { symbol: 'sh600519' }, orderBy: { column: 'score', desc: true }, limit: 20, offset: 0,
});
await ctx.db.update('watch_candidates', id, { score: 2 });
await ctx.db.remove('watch_candidates', id);
await ctx.db.count('watch_candidates', { symbol: 'sh600519' });
await ctx.db.clear('watch_candidates');
```

| 约定 | 内容 |
| --- | --- |
| 物理表名 | `plugin_<插件id>_<表名>`；标识符白名单在宿主侧校验，插件拼不进任何 SQL |
| 列类型 | `text` / `integer` / `real` / `json`（`json` 写入 stringify、读出 parse） |
| 保留列 | `id` / `createdAt` / `updatedAt` 由宿主固定追加并自动维护，**插件不得声明同名列**（宿主会明确报错） |
| 建表幂等 | `ensureTable` 可重复调用；**缺列会自动 `ALTER TABLE ADD COLUMN` 补上**（一律补成可空列）→ 加列只改声明，不写迁移 |
| 不可变部分 | 改列类型 / 删列宿主不感知（SQLite 也不支持）→ 需要动类型时**换新列名** |
| 读出形态 | `PluginDbRow<T> = T & { id: number; createdAt: number; updatedAt: number }` |
| 双端一致 | Tauri 落 SQLite，浏览器端降级为本地 JSON 表仿真，语义一致 |
| 卸载 | 若插件建过表，卸载用户插件时弹窗询问「保留数据 / 一并删除」 |

### 4.3 `ctx.settings` — 清单式设置

在定义里声明，宿主自动渲染设置表单：**顶栏齿轮 → 「插件设置」弹窗**（只列「已挂载且清单里声明了 `settings`」的插件，随内核 revision 自动刷新）：

```ts
settings: {
  title: '我的插件',
  description: '一句话说明',
  fields: [
    { key: 'enabledPool', label: '启用', type: 'boolean', default: true },
    { key: 'topN', label: '展示条数', type: 'number', default: 10, min: 1, max: 50, step: 1 },
    { key: 'source', label: '数据源', type: 'select', default: 'ths',
      options: [{ value: 'ths', label: '同花顺' }, { value: 'em', label: '东方财富' }] },
    { key: 'note', label: '备注', type: 'text' },
  ],
  // 复杂交互改用自定义组件（宿主注入 settings prop）：
  // component: MySettingsVue,
},
```

运行时：

```ts
ctx.settings.values.enabledPool;      // 响应式对象（已并入默认值），computed 可直接依赖
ctx.settings.get<number>('topN', 10);
ctx.settings.set('topN', 20);         // 即时持久化 + 即时生效（无需重启）
ctx.settings.reset();                 // 回到声明默认值
```

值存在插件 storage 的 `settings` 键下（即插件 JSON 里的 `settings` 字段）。

---

## 5. 宿主服务（`ctx.consume`，宿主在启动第一步就注册好，插件 `apply` 里必拿得到）

| 服务名 | 签名 | 说明 |
| --- | --- | --- |
| `app:version` | `string` | 应用版本号（来源 `APP_VERSION`） |
| `app:navigate` | `(path: string) => void` | 跳路由（`router.push`）；插件不直接依赖 router 实例 |
| `panel:open` | `(panelKey: string) => void` | 按全局键打开面板：drawer → 开右侧抽屉；inline → 取消折叠并滚动到可视区；顶栏条目 → 展开下拉。键不存在只 `console.warn` |
| `app:notify` | `NotifyService` | 右下角应用级浮窗（宿主渲染，**跨路由常驻、与发起它的组件是否挂载无关**） |
| `app:stock-search` | `StockSearchService` | 标的搜索（代码 / 名称 / 拼音，腾讯源） |
| `kernel:runtime` | `PluginRuntimeReader` | 内核只读自省：`list()` / `get(id)` / `listServices()` / `recentEvents()` |

### 5.1 `app:notify`

```ts
const notify = ctx.consume('app:notify');
const id = notify?.notify({
  title: '贵州茅台 涨到 1700.00',
  body: '现价 1702.30（+3.21%）',
  tone: 'up',                 // 'flat'（默认）| 'up' | 'down' | 'primary'
  timeoutMs: 8000,            // 0 = 常驻直到手动关闭（默认 8000）
  source: '盯盘提醒',
  dedupeKey: 'sh600519',      // 同键只保留最新一条（旧的被替换并重置倒计时）
  onClick: () => {},          // 点击浮窗执行，执行后自动关闭
});
notify?.dismiss(id);
notify?.dismissBySource('盯盘提醒');   // 卸载时清掉自己的提醒
```

同屏最多 4 条（`NOTIFY_MAX_ITEMS`），超出挤掉最旧的一条。

### 5.2 `app:stock-search`

```ts
const search = ctx.consume('app:stock-search');
const results = await search?.search('茅台');   // SearchResult[]（code 为 sh600519 完整形态）
```

- **调用方自己防抖**（建议关键词 ≥ 2 字符），宿主不代劳；
- 返回含指数 / 港美股等非 A 股结果，插件按自己的口径过滤。

### 5.3 `kernel:runtime`

```ts
const runtime = ctx.consume('kernel:runtime');
runtime?.list();          // 全部插件运行时信息（含 status / contributions / error）
runtime?.get('my-plugin');
runtime?.listServices();  // 当前生效的服务名（排障用）
runtime?.recentEvents();  // 最近事件（由新到旧，缓冲 200 条；**环形缓冲不是响应式**，页面需自行定时刷新）
```

---

## 6. 内置事件（`ctx.on` / `ctx.emit`）

| 事件名 | 参数 | 何时触发 |
| --- | --- | --- |
| `plugin:mounted` | `[info: PluginRuntimeInfo]` | 某插件挂载完成（贡献点已全部生效） |
| `plugin:unmounted` | `[info: PluginRuntimeInfo]` | 某插件卸载完成（贡献点已全部撤销） |
| `plugin:failed` | `[info: PluginRuntimeInfo, error: unknown]` | 某插件挂载失败 |
| `sidebar:changed` | `[panels: readonly RegisteredSidebarPanel[]]` | 侧栏面板注册表变化 |
| `header:changed` | `[items: readonly RegisteredHeaderItem[]]` | 顶栏条目注册表变化 |
| `route:changed` | `[to: string, from: string]` | 路由切换（`router.afterEach`） |

用法与约定：

```ts
ctx.on('route:changed', (to, from) => { /* 离开页面时保存草稿之类 */ });
ctx.emit('note:saved', id);   // 插件自定义事件：名字走宽松分支
```

- 事件名约定 `namespace:action`；
- 单个订阅者抛错**不影响其他订阅者**（宿主逐个 try/catch）；
- 订阅随插件卸载**自动退订**，不需要手动 off。

---

## 7. 插件之间怎么协作

**不要互相 import**（第三方插件也 import 不了）。统一走服务 + 事件：

```ts
// 提供方（速记插件）
declare module '../../types/plugin.types' {   // 相对路径跟着自己的文件走
  interface AppServiceMap { 'note:repo': NoteRepo }
  interface AppEventMap { 'note:saved': [id: string] }
}
ctx.provide('note:repo', repo);

// 消费方（别的插件）：允许缺席
const repo = ctx.consume('note:repo');   // undefined = 速记插件没启用 → 自行降级
ctx.on('note:saved', (id) => { /* … */ });
```

规则：

- 同名服务**后注册者覆盖先注册者**，后者撤销时恢复前者（可逆）；
- 依赖顺序写在 `inject: ['提供方的插件 id']` 里，未就绪时本插件停在 `pending`，就绪后自动挂载；
- 消费方必须处理 `consume` 返回 `undefined` —— 插件可被用户停用，依赖它的东西不能崩。

---

## 8. 副作用与生命周期治理（写插件最容易翻车的地方）

### 8.1 `ctx.effect` 与 `ctx.onDispose`

```ts
ctx.effect(() => {
  const timer = window.setInterval(tick, 1000);
  return () => window.clearInterval(timer);   // 卸载时自动执行
});
ctx.onDispose(() => cleanup());               // 只登记清理，不立即执行
```

### 8.2 贡献点不用手动清理

所有 `ctx.*.add()` 的返回值都已被登记；需要提前撤销时手动 `disposable.dispose()`（幂等）。

### 8.3 「用户不看也在跑」的逻辑放哪

| 需求 | 放哪 | 原因 |
| --- | --- | --- |
| 轮询 / 到价告警 / 定时任务 | **插件层**：`createPollingScheduler({ task, intervalMs, tradingAware })` + `ctx.effect(() => () => scheduler.stop())` | 侧栏面板有**两层折叠**都会卸载组件，写在面板里会随折叠停摆 |
| 弹提醒 | `app:notify` | 宿主承载、跨路由常驻；浮窗是唯一的「长期生效提醒」通道 |
| 跳页面 | `app:navigate` | 插件不持有 router 实例 |
| 唤醒自己的面板 | `panel:open('<id>#<key>')` | 命令 / 事件回调里都能用 |

`createPollingScheduler`（`src/composables/polling-scheduler.ts`）自带交易窗口感知、失败指数退避、页面可见性感知与轮询总开关，与宿主的 `usePolling` 共用同一份策略——**不要自己写 `setInterval` 退避策略**。

### 8.4 页面被撤销时的收尾

插件被停用 / 卸载 / 挂载失败回滚时，它的路由会被从 router 上摘掉；用户正好停在该页的话，宿主按 §3.2 的 `fallbackLanding` 三级递退把他接走并浮窗说明。**插件不必自己处理这件事**，但建议把主页面声明 `fallbackLanding: true`。

---

## 9. 宿主内部模块（③ 层，仅源码级插件可用）

下列模块今天的形态如下，**改名 / 换签名不另行通知**（按需 `grep` 源码确认）：

| 类别 | 代表模块 |
| --- | --- |
| UI 组件 | `components/ui/`（BaseButton / BaseCard / BaseTable / BaseTabs / BaseTag / BaseInput / BaseModal / BaseEmpty / BaseSkeleton / MenuIcon）、`components/business/StockSearchModal.vue` |
| API 层 | `api/proxy-fetch`（**所有网络请求必须走它**，见 SERVER_API.md）、`api/quotes.api`、`api/turnover.api`、`api/event.api`（涨停池）、`api/search.api` |
| 工具 | `utils/format-percent`、`format-price`、`format-relative-time`、`find-quote-by-symbol`（**按符号取报价必须走它**：上游返回裸代码、本地用完整符号）、`to-full-symbol`、`to-bare-code`、`normalize-a-share-code`、`delay` |
| composables | `composables/polling-scheduler`、`use-stock-open`、`use-polling`（组件内） |
| stores | `stores/watchlist`、`dock-panel`、`data-cache`、`plugin-panels`、`notifications`、`settings`、`market-status` |
| 常量 | `constants/notify.constants`（`NOTIFY_TONE`）、`plugin.constants`（`HEADER_MARQUEE_TONE` 等）、`router-meta.constants`（`ROUTE_PATH`）、`trend.constants`（`getTrendByChangePercent`）、`stock-colors.constants`（`TREND_TEXT_CLASS`）、`polling.constants`（`POLLING_INTERVAL`） |

MenuIcon 可用 icon key（未知 key 渲染为空、不报错）：
`dashboard star boards funds rank news flame trophy filter settings sun moon plus trash search close menu globe grip arrowLeft info chevronLeft chevronRight chevronDown panelLeft panelRight agent account tradeImport book plug cpu dots pin pencil eye eyeOff folder calendar expand sliders log whitepaper bell`

---

## 10. 配额与红线

| 项 | 限制 | 出处 |
| --- | --- | --- |
| 用户插件条目数 | 50 条 | `USER_PLUGIN_RECORD_MAX` |
| 单份插件代码 | 512 KB | `USER_PLUGIN_CODE_MAX_LENGTH` |
| 事件环形缓冲 | 200 条（仅供观测） | `PLUGIN_EVENT_HISTORY_MAX` |
| 同屏浮窗 | 4 条 | `NOTIFY_MAX_ITEMS` |
| 浮窗默认存活 | 8 s（`0` = 常驻） | `NOTIFY_DEFAULT_TIMEOUT_MS` |
| 顶栏轮播间隔 | 默认 4000 ms，下限 1500 ms | `HEADER_ITEM_MARQUEE_INTERVAL_*` |
| 网络请求 | 必须经 `proxyFetch`；域名白名单见 SERVER_API.md §0 | 数据通道红线 |
| 东财高频 | 会封 IP；全市场快照并发 ≤ 3，同上游连续请求 `delay(500)`，重接口一律点击触发不轮询 | 频率红线 |
| 列表刷新 | 不许翻 `loading`（会把整表卸载重建导致闪屏）；只在「一条数据都还没有」时进骨架屏 | UI 红线 |

---

## 11. 完整示例

### 11.1 源码级插件（Vue SFC + 设置 + 数据表）

```ts
// src/plugins/example/plugin.ts
import type { PluginDefinition } from '@/types/plugin.types';
import ExamplePanel from './ExamplePanel.vue';

export const examplePlugin: PluginDefinition = {
  id: 'dsh-example',
  name: '示例插件',
  version: '1.0.0',
  description: '演示贡献点与数据存取',
  settings: {
    fields: [{ key: 'topN', label: '展示条数', type: 'number', default: 10, min: 1, max: 50 }],
  },
  async apply(ctx) {
    await ctx.db.ensureTable('items', [{ name: 'symbol', type: 'text', indexed: true }]);

    ctx.sidebar.add({ id: 'main', title: '示例', icon: 'star', position: 'nav', order: 300, component: ExamplePanel });

    // 后台轮询放插件层，别放面板里
    const { createPollingScheduler } = await import('@/composables/polling-scheduler');
    const scheduler = createPollingScheduler({
      task: async () => { /* ctx.db.insert(...) */ },
      intervalMs: 30_000,
      tradingAware: true,
      market: 'A',
    });
    ctx.effect(() => () => scheduler.stop());

    ctx.command.add({ id: 'refresh', title: '刷新示例', keys: 'Ctrl+Alt+E', run: () => void scheduler.runNow() });
    ctx.onDispose(() => ctx.consume('app:notify')?.dismissBySource('示例插件'));
  },
};
```

登记到 `src/plugins/index.ts` 的 `BUILTIN_PLUGINS`（改前先按 AGENTS.md「源码级安装/卸载的备份与恢复」备份），然后跑：

```bash
pnpm lint && pnpm build
node .ai/tmp/plugin-kernel-smoke.mjs
```

### 11.2 第三方用户插件（不 import 任何东西）

```js
export default {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  description: '示例：往左侧栏加一个面板',
  apply(ctx) {
    ctx.sidebar.add({
      id: 'main',
      title: '我的插件',
      position: 'nav',
      order: 300,
      // 不能用 template（无运行时编译器）；render 返回字符串会被宿主渲染成文本节点
      component: { render: () => 'Hello 插件' },
    });
    ctx.command.add({ id: 'ping', title: '打个招呼', run: () => ctx.consume('app:notify')?.notify({ title: '你好' }) });
  },
};
```

保存成 `.js` → 设置 → 插件 → 安装插件 → 粘贴 / 选文件 → 解析预览 → 确认安装。
⚠️ 见 §0：不要写 `import`，不要指望自定义 Tailwind class（用宿主已用的类或内联 `style`）。

---

## 12. 改这套 API 时必须同步的东西

| 改了什么 | 必须同步 |
| --- | --- |
| `AppServiceMap` / `AppEventMap` / 贡献点类型 | 本文档 + `AGENTS.md`「插件体系」+ `README.md`「插件体系」 |
| `ctx.db` 的表 / 列 | Agent MCP 工具描述（`src/agent/mcp/app-tools.ts` 的 `db_query` / `db_execute`） |
| 新增 / 删除的 API | `SERVER_API.md`（若是网络接口） |
| 白皮书里出现的功能 | `src/views/WhitepaperView.vue` 的对应章节（硬性同步规范） |
| 内核本身 | 跑 `.ai/tmp/plugin-kernel-smoke.mjs`（自带转译器，**直接 node 跑**，不要经 ts-smoke-harness） |

---

## 13. 已知缺口（给想写第三方插件的人先看）

按 §0 的实测，第三方插件目前**只有 `ctx` 这一层可用**，UI 与工具能力存在缺口：

1. **拿不到 `h` / Vue 响应式**：官方模板里的 `import { defineComponent, h } from 'vue'` 实际跑不通（安装解析阶段就失败）。要么自行 bundle 一份运行时，要么宿主提供 SDK。
2. **无模板编译器**：只能用渲染函数或纯字符串。
3. **Tailwind 类受限**：只有宿主源码里用到的类有样式。
4. **无类型提示**：第三方只能用 JS 硬写，且本文档就是唯一的接口说明。

可选的补齐路线（改宿主，均为新增能力、不破坏现有契约）：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| A. 暴露 SDK 服务（推荐） | 新增 `app:sdk` 服务：`{ h, ref, reactive, computed, watch, defineComponent }` + 常用 UI 组件 + 常用格式化工具，插件在 `apply` 里 `ctx.consume('app:sdk')` 后闭包使用 | 新增一个服务 + 一份类型声明；不碰 window、不改加载机制 |
| B. 暴露全局对象 | `window.whf = { h, ref, BaseButton, … }` | 简单直白，但全局命名空间无类型约束、易冲突 |
| C. 加 import map | `index.html` 写 `<script type="importmap">` 映射 `vue` 到 CDN / 本地产物 | 浏览器端可行，Tauri 生产环境需同步；多份 Vue 实例风险要看映射目标是否为宿主同一份 |

在方案落地前，**第三方插件请把自己限制在第 ① 层**（§11.2 的写法是实测可用的最小形态）。
