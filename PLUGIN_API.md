# PLUGIN_API.md — 插件开放接口清单

> 本文件盘点**宿主开放给插件的全部能力**（`ctx.*` 九个贡献点、数据持久化、十六个宿主服务、事件、配额与红线）。
> **第三方（应用内安装）插件作者请优先看 [PLUGIN_WIKI.md](./PLUGIN_WIKI.md)** —— 那份是面向你的独立 wiki；
> 本文件面向宿主仓库贡献者（含第三层「宿主内部模块」清单）。
> 类型契约的唯一事实源是 `src/types/plugin.types.ts`，宿主侧接线（注册顺序、 `recoverVanishedRoute`）见 `src/plugin/setup.ts`；
> 两者冲突时以代码为准，并回来修本文档。
>
> 适用版本：v2.6.2（含「官方插件改为 zip 产物包分发」与十六个宿主服务的改动）。

## 0. 稳定性分层（先读这一节，它决定你能依赖什么）

插件作者实际能碰到的东西分三层，**只有第一层有兼容承诺**：

| 层 | 内容 | 谁能用 | 兼容承诺 |
| --- | --- | --- | --- |
| **① 契约层** | `ctx.*` 全部成员、`AppServiceMap` 十五个宿主服务、`AppEventMap` 六个内置事件、`types/plugin.types.ts` 全部导出类型 | 源码级插件 + 应用内安装的用户插件 | **主版本号内保证向后兼容**；要改形态须同步本文档 |
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

> ⚠️ **这三条现在是安装前的静态预检项**（2026-09-21 起，`src/plugin/user-plugin-lint.ts`）。
> 带上它们的插件在「解析预览」阶段就会被拦下，报错会指出**第几行 + 为什么 + 该怎么改**，
> 而不是丢一句浏览器的底层 `Failed to fetch dynamically imported module`。
> Tailwind 类不拦（能装），只在预览区给出「可能没有样式」的提醒。

✅ **好消息**：不 import 任何东西的插件完全可以挂载——实测注册侧栏面板并渲染成功，
且 `ctx` 全套、十六个宿主服务、`ctx.storage` / `ctx.db`（`ensureTable`→`insert`→`select`→`remove`→`count`）、`ctx.on` 全部可用。
**第三方插件请把自己限制在第 ① 层。**

第一条红线的替代方案已经补齐了，写第三方插件不再需要 import：

| 以前只能靠 ③ 层 | 现在第 ① 层就有 |
| --- | --- |
| `import { h, ref } from 'vue'` 写渲染函数 | `ctx.vue.h` / `ctx.vue.ref` / `ctx.vue.computed` …（§2） |
| `import BaseButton from '@/components/ui/BaseButton.vue'` | `ctx.consume('app:ui').Button`（§5.4） |
| 自定义 Tailwind 类调样式 | 用 `app:ui` 的组件，样式天然跟着宿主主题走（§5.4） |
| 自己 `fetch` 上游数据（跨域 / 白名单无从着手） | `app:http`（受白名单约束，§5.5）、`app:quotes`（批量报价，§5.6） |

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
| `ctx.vue` | `PluginVueRuntime` | **Vue 运行时句柄**：`h` / `ref` / `reactive` / `computed` / `watch` / `onMounted` / `onUnmounted` / `nextTick`。第三方插件写渲染函数全靠它（见下方） |
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
| 升级 / 接管 | 同 id 再装不会报「已被占用」：已装过 = 升级（数据保留）；与内置插件同 id = 接管内置版本，卸载后恢复内置实现 |

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
| `app:stock-picker` | `StockPickerService` | **选股弹窗**：宿主渲染全站统一的标的搜索，Promise 回传 `SearchResult \| null`（§5.12） |
| `kernel:runtime` | `PluginRuntimeReader` | 内核只读自省：`list()` / `get(id)` / `listServices()` / `recentEvents()` |
| `panel:close` | `(panelKey: string) => void` | 关闭自己的面板（`panel:open` 的反向动作）：drawer 关抽屉、顶栏条目收起下拉、inline 折叠。键不存在只 `console.warn` |
| `app:stock-open` | `StockOpenService` | **全站统一的个股打开交互**：`openSidebar` 开右侧详情侧栏 / `openPage` 进详情整页（§5.7） |
| `app:watchlist` | `WatchlistService` | **自选股只读视图**：`symbols()` / `groups()` / `nameOf()`（§5.8） |
| `app:polling` | `PollingService` | **轮询调度器工厂**：`create()` 与宿主同一份交易窗口 / 退避 / 可见性策略（§5.9） |
| `app:ui` | `UiKitService` | **UI Kit**：宿主的 Button / Input / Switch / Tag / Card / Empty / Tabs / Table / Modal / Drawer / Skeleton / Icon 十二个组件句柄 + `confirm()` 确认弹窗（§5.4） |
| `app:http` | `HttpService` | **受控网络请求**：走宿主上游通道，仅允许白名单域名（§5.5） |
| `app:quotes` | `QuotesService` | **行情报价**：按代码批量取实时快照（§5.6） |
| `app:market` | `MarketService` | **市场剖面**：沪深逐日成交额 / 指定交易日涨停池（重接口，只能点击触发，§5.10） |
| `app:format` | `FormatService` | **格式化与涨跌语义**：红涨绿跌、百分比 / 价格 / 相对时间、符号三形态互转、`delay` / `debounce`、按符号查报价（§5.11） |

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

### 5.4 `app:ui` — UI Kit（第三方插件做界面的唯一来源）

第三方插件有两个先天短板：**import 不了宿主组件**，**自己写的 Tailwind 类可能没有 CSS**。
UI Kit 一次解决两件事：宿主把自己正在用的组件原样交给插件，拼出来的界面天然与原生页面同风格、
跟着主题走（暗色 / 主色切换自动跟随）。

```ts
const ui = ctx.consume('app:ui');
const { h } = ctx.vue;

// 在渲染函数里用它们（props 与各 Base* 组件一致，第三参数是默认插槽）
ctx.sidebar.add({
  id: 'main',
  title: '我的插件',
  component: {
    render: () => h(ui.Card, { title: '我的插件' }, {
      default: () => [
        h(ui.Input, {
          modelValue: keyword.value,
          'onUpdate:modelValue': (value) => { keyword.value = value; },
          placeholder: '输入代码',
        }),
        h(ui.Button, { variant: 'ghost', onClick: onClick }, () => '查询'),
      ],
    }),
  },
});
```

| 句柄 | 对应组件 | 关键 props |
| --- | --- | --- |
| `ui.Button` | `BaseButton` | `variant: 'primary' \| 'ghost' \| 'danger'`、`disabled`、`type` |
| `ui.Input` | `BaseInput` | `modelValue`（`onUpdate:modelValue`）、`placeholder`、`type` |
| `ui.Switch` | `BaseSwitch` | `modelValue`（`onUpdate:modelValue`） |
| `ui.Tag` | `BaseTag` | `tone: 'primary' \| 'up' \| 'down' \| 'flat'` |
| `ui.Card` | `BaseCard` | `title`、`fill`、`clickableTitle` + `extra` / 默认插槽 |
| `ui.Empty` | `BaseEmpty` | `text` |
| `ui.Tabs` | `BaseTabs` | `options: { label, value }[]`、`modelValue`、`variant: 'segmented' \| 'underline'` |
| `ui.Table` | `BaseTable` | `columns`、`rows`、`rowKey`、`minWidth`、`rowClickable`、`expandable` + 列 key 同名插槽（见下） |
| `ui.Modal` | `BaseModal` | `title`、`open`（`onUpdate:open`）、`maxWidthClass`、`heightClass` + 默认 / `filters` / `footer` 插槽 |
| `ui.Drawer` | `BaseDrawer` | `title`、`open`（`onUpdate:open`）、`width`（默认 `66vw`） |
| `ui.Skeleton` | `BaseSkeleton` | 无 props，默认三行文本形状，默认插槽可自定形状。**只在一条数据都没有时用** —— 列表刷新不许翻 loading（会整表卸载重建闪屏），见 §10 |
| `ui.Icon` | `MenuIcon` | `name`（key 清单见 §9）、`size` |

三个「重」组件的用法要点：

```ts
// Table：列配置驱动，自定义单元格用「与列 key 同名」的作用域插槽
h(ui.Table, {
  columns: [
    { key: 'code', label: '代码', sortable: true, sortValue: (row) => row.code },
    { key: 'price', label: '现价', align: 'right' },
  ],
  rows: rows.value,
  rowKey: (row) => row.code,
  minWidth: '320px',
  onRowClick: (row) => { /* 行点击 */ },
}, {
  // 插槽名 = 列 key，参数是 { row }；不提供则展示 row[key] 原值
  price: ({ row }) => h('span', { class: 'tabular-nums' }, row.price.toFixed(2)),
})
```

```ts
// Modal / Drawer：open 由插件自己持有，插槽填内容
const open = ref(false);
h(ui.Modal, {
  open: open.value,
  title: '新增条目',
  'onUpdate:open': (value) => { open.value = value; },
  onCancel: () => { open.value = false; },
}, {
  default: () => h(ui.Input, { /* … */ }),
  footer: () => h(ui.Button, { variant: 'primary', onClick: onSubmit }, () => '保存'),
})
```

- `ui.Table` 的排序是**点击表头**触发的内置行为，作用于传入的 `rows`（不是全量数据）；
- `ui.Modal` / `ui.Drawer` 自带遮罩点击关闭、ESC 关闭、打开时锁 body 滚动，插件只需维护 `open`；
- 两者与 `confirm()` 的分工：`confirm()` 是宿主渲染的一次性确认，`Modal` / `Drawer` 是插件自己持有的界面。

`confirm()` — 删除确认这类「必须问一句」的场景：

```ts
const ok = await ui.confirm({
  title: '删除这条记录？',
  content: '删除后不可恢复。',
  okText: '删除',
  okVariant: 'danger',
});
if (!ok) return;
```

- 弹窗**由宿主渲染**（`PluginConfirmHost` 挂在 MainLayout），因此发起它的插件组件被折叠 / 卸载都不会丢答复；
- 同时来了第二个 `confirm`，前一个立刻结算为 `false`（UI 上无法分辨两个弹窗，宁可给明确结果也不要悬死）。

### 5.5 `app:http` — 受控网络请求

```ts
const http = ctx.consume('app:http');
if (!http.isAllowed('https://push2.eastmoney.com/api/qt/clist/get')) return;   // 先自检
const response = await http.fetch('https://push2.eastmoney.com/api/qt/clist/get?…');
const text = await response.text();     // 腾讯源仍是 GBK：需要原字节转码时自行处理
http.allowedHosts;                       // 当前白名单（['eastmoney.com', 'gtimg.cn', 'sina.com.cn', …]）
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `fetch` | `typeof fetch` | 与标准 fetch 同签名。Tauri 端由 Rust 直连（无 CORS），浏览器端走 `/stock-proxy` |
| `allowedHosts` | `readonly string[]` | 允许访问的域名（后缀匹配，子域自动覆盖） |
| `isAllowed(url)` | `(url: string) => boolean` | 发起前自检，非法 / 相对 URL 一律 false |

红线：

- **白名单之外的域名一律不可达**（`STOCK_PROXY_ALLOWED_HOSTS`，与宿主完全同源）。这不是限制插件，
  是为了不把应用变成开放代理 —— 需要新源请提 issue，由宿主把它加进白名单后再用；
- 代理有 3 秒短缓存与 12 秒超时，别的红线见 §10；
- 别用它打应用自身的接口 —— 应用能力一律走 `ctx.storage` / `ctx.db` 与各项服务。

### 5.6 `app:quotes` — 行情报价

```ts
const quotes = ctx.consume('app:quotes');
const list = await quotes.fetchFullQuotes(['300339', 'sh600519']);   // FullQuote[]
```

- 裸代码（`300339`）与完整符号（`sh600519`）都能传；上游拿不到的代码不出结果，**按 code 取值务必用地图查找**；
- 返回值结构是 `FullQuote`（见 `types/stock-quote.types.ts`），宿主已处理好行情源与转码；
- **不要轮询**：这是一个展示级的批量接口，长期后台刷新请走低频（≥30s）并受 §10 的频率红线约束。

### 5.7 `app:stock-open` — 打开个股（全站两条交互的唯一入口）

```ts
const stockOpen = ctx.consume('app:stock-open');

stockOpen?.openSidebar('sh600519');                    // 单击语义：展开右侧详情侧栏
stockOpen?.openPage('600519');                         // 双击语义：进详情整页（裸码也认）

// 带上来源列表：详情页左侧可一键切换同批股票（symbol 由宿主归一化，高亮才匹配得上）
const list = rows.value.map((row) => ({ symbol: row.code, name: row.name, changePercent: row.pct }));
stockOpen?.openPage('600519', list);
```

| 成员 | 说明 |
| --- | --- |
| `openSidebar(symbol, list?)` | 展开右侧个股详情侧栏；给了 `list` 才写入详情页左侧来源列表 |
| `openPage(symbol, list?)` | 收起侧栏 + 跳详情页；不给 `list` 时写入「只有当前一只」（避免残留上一批） |

> 这两条与宿主页面右上角的搜索、自选股表格用的是**同一个实现**（`createStockOpenService`）：
> 插件自己拼 `router.push` 也能跳过去，但会丢掉详情页左侧的来源列表。

### 5.8 `app:watchlist` — 自选股只读视图

```ts
const watchlist = ctx.consume('app:watchlist');
watchlist?.symbols();            // 全部自选股完整符号（跨分组去重）
watchlist?.groups();             // 分组结构：[{ id, name, stocks: [{ symbol, name }] }]
watchlist?.nameOf('sh600519');   // 查名称；不在自选股里返回 undefined

// 三个成员都是 getter：在插件自己的 computed / watch 里调用会跟随自选股变化
const monitored = computed(() => candidates.value.filter((item) => watchlist.symbols().includes(item.symbol)));
```

**只给读，不给写** —— 增删自选股仍归宿主页面。插件一旦能改用户自选股，
「谁加的」「卸载后要不要撤销」都说不清。

### 5.9 `app:polling` — 轮询调度（务必用它，别自己写 `setInterval`）

```ts
const polling = ctx.consume('app:polling');
const scheduler = polling.create({
  task: async () => { /* 取数（务必批量，不要逐只循环） */ },
  intervalMs: 30_000,
  tradingAware: true,      // 仅 A 股交易窗口内轮询，窗口外自动暂停（挂载时仍跑一次）
});
ctx.effect(() => () => scheduler.stop());   // 卸载必须 stop：交易窗口 / 可见性监听随它释放

await scheduler.runNow();    // 立即补一轮（受互斥保护，执行中调用被忽略）
scheduler.isEligible();      // 当前是否允许轮询（总开关打开且处于交易窗口内）
```

自带四份策略，与宿主 `usePolling` 共用同一份实现：**交易窗口感知 / 失败指数退避
（`BACKOFF_BASE * 2^n` 封顶）/ 页面可见性感知 / 轮询总开关**。自己写一份迟早岔开，
而岔一次的代价是顶到上游频率红线（东财会封 IP）。

### 5.10 `app:market` — 市场剖面（重接口，别轮询）

```ts
const market = ctx.consume('app:market');

// 沪深两市逐日成交额（腾讯指数日 K 源，按日期升序且日期轴连续）
const series = await market.fetchMarketTurnover();
// → [{ date: '2026-09-18', shanghaiAmount: …, shenzhenAmount: …, totalAmount: … }]

// 指定交易日涨停池（缺省当日）
const pool = await market.fetchLimitUpPool('2026-09-18');
// → [{ code, name, price, changePercent, continuousBoardCount, boardAmount, industry }]
```

两个取数口径都固定在宿主一侧，且都是重量级网络请求 —— **只能由用户点击触发**。
涨停池成员是从上游约 18 个字段里**挑出来映射**的，插件拿到的结构因此长期稳定。

### 5.11 `app:format` — 格式化与涨跌语义

```ts
const format = ctx.consume('app:format');
format.placeholder;                    // '--'（全站数值占位口径）
format.trend(2.35);                    // Trend.UP（红涨绿跌的唯一入口）
format.trendClass(format.trend(-1));   // 文本色类名（主题 token）
format.trendPillClass(trend);          // 胶囊类名（弱色底 + 语义文字色）
format.percent(2.35);                  // '+2.35%'
format.percentUnsigned(1.71);          // '1.71%'
format.price(1702.3);                  // '1702.30'
format.relativeTime(Date.now() - 3e5); // '5分钟前'
await format.delay(500);               // 错开对同一上游的连续请求
const onInput = format.debounce(doSearch, 300);   // 搜索防抖
format.toFullSymbol('600519');         // 'sh600519'
format.toBareCode('sz300339');         // '300339'
format.normalizeCode('600519');        // 'sh600519'（A 股三形态统一）
format.findQuote(quotesMap, 'sh600519');  // 按本地符号查上游返回的裸代码键
```

这一组看着「只是几个小函数」，实际每条都是宿主口径：涨跌配色是中国市场约定
（第三方自己写大概率写反）；`delay` / `debounce` 是上游限速节拍的一部分；
符号三形态互转踩过两次坑，失灵表现为整列 `--`。**不要各写一份。**

### 5.12 `app:stock-picker` — 让用户挑一只股票（宿主渲染，Promise 回传）

插件要「让用户挑一只票」时用这个，**不要自己搭一个搜索框**：自己写的那份没有搜索历史、
样式不统一，宿主搜索改版后也不会跟着更新，而且弹窗的生命周期还得自己管。

```ts
const picker = ctx.consume('app:stock-picker');
const picked = await picker?.pick();      // 取消 / 关闭 = null
if (picked) {
  // picked: SearchResult —— code 是 sh600519 完整形态，name 是股票名
  save({ symbol: picked.code, name: picked.name });
}
```

与 `app:ui` 的 `confirm()` 同一范式：**插件发起、宿主渲染**（承载组件 `PluginStockPickerHost`
挂在 `MainLayout`），因此发起方组件被卸载（面板折叠、路由切走）也照样拿得到结果。

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
| 网络请求 | 必须经 `app:http.fetch`（内部就是宿主 `proxyFetch`）；域名限于 `app:http.allowedHosts`，越界请求会被 Rust 侧 scope / 代理中间件拒掉 | 数据通道红线 |
| 东财高频 | 会封 IP；全市场快照并发 ≤ 3，同上游连续请求 `delay(500)`，重接口一律点击触发不轮询 | 频率红线 |
| 第三方插件语言 | 代码里不允许出现 `import` / `export … from` / `import()` / `template:` —— 安装前静态预检直接拦下（`user-plugin-lint.ts`） | 加载机制红线 |
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
（本仓库当前 `src/plugins/` 是空的 —— 四个官方插件的源码都已迁到独立仓库 `../whf-stock-board-plugin`，在那边改源码、出 zip 包。）

```bash
pnpm lint && pnpm build
node .ai/tmp/plugin-kernel-smoke.mjs
```

### 11.2 第三方用户插件（不 import 任何东西）

一个「有状态 + 有数据 + 用宿主组件」的完整形态（2026-09-21 起的能力，实测可用）：

```js
export default {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  description: '示例：查一笔报价，用完可以删掉记录',
  apply(ctx) {
    const ui = ctx.consume('app:ui');
    const quotes = ctx.consume('app:quotes');
    const { h, ref } = ctx.vue;                 // Vue 运行时句柄，不用 import

    const keyword = ref('');
    const result = ref('');
    const busy = ref(false);

    const onQuery = async () => {
      busy.value = true;
      const list = await quotes.fetchFullQuotes([keyword.value]);
      result.value = list.length > 0 ? `${list[0].name} ${list[0].price}` : '没查到';
      busy.value = false;
    };

    const onRemove = async () => {
      const ok = await ui.confirm({ title: '清空结果？', okVariant: 'danger' });
      if (ok) result.value = '';
    };

    ctx.sidebar.add({
      id: 'main',
      title: '我的插件',
      position: 'nav',
      order: 300,
      // 渲染函数组件：render 里用 h 搭结构，样式由宿主组件负责（别写新 Tailwind 类）
      component: {
        render: () => h('div', { class: 'flex flex-col gap-2' }, [
          h(ui.Input, {
            modelValue: keyword.value,
            'onUpdate:modelValue': (value) => { keyword.value = value; },
            placeholder: '输入股票代码',
          }),
          h(ui.Button, { variant: 'primary', disabled: busy.value, onClick: onQuery }, () => '查询'),
          h(ui.Tag, { tone: 'primary' }, () => result.value || '暂无结果'),
          h(ui.Button, { variant: 'ghost', onClick: onRemove }, () => '清空'),
        ]),
      },
    });

    ctx.command.add({
      id: 'ping',
      title: '打个招呼',
      run: () => ctx.consume('app:notify')?.notify({ title: '你好' }),
    });
  },
};
```

最小形态（只要一个静态面板）依然简单：`component: { render: () => 'Hello 插件' }`。

保存成 `.js`（推荐连同 `manifest.json` / `README.md` 打成 `.zip` 产物包）→ 设置 → 插件（或插件工坊）→ 安装插件 → 选 zip 包 / 粘贴 / 选文件 → 解析预览 → 确认安装。包格式见 `PLUGIN_WIKI.md` §8.2。

⚠️ 三条红线（写下来会被安装前的静态预检拦住 / 提醒）：

- 不要写 `import` / `export … from` / 动态 `import()` —— 拿不到任何模块；
- 不要写 `template: '…'` —— 生产构建没有运行时编译器，只会渲染为空；
- 少写新的 Tailwind 类 —— 只有宿主源码里出现过的类才有 CSS（会给出提醒，但能装）。

---

## 12. 改这套 API 时必须同步的东西

| 改了什么 | 必须同步 |
| --- | --- |
| `AppServiceMap` / `AppEventMap` / 贡献点类型 | 本文档 + `AGENTS.md`「插件体系」+ `README.md`「插件体系」 |
| `ctx.db` 的表 / 列 | Agent MCP 工具描述（`src/agent/mcp/app-tools.ts` 的 `db_query` / `db_execute`） |
| 新增 / 删除的 API | `SERVER_API.md`（若是网络接口） |
| 预检规则（允许 / 禁止哪些写法） | 本文档 §0 + §13，以及安装弹窗的说明文案（两者是同一套认知） |
| 用户插件 zip 包格式（清单字段 / 入口解析规则） | `src/utils/plugin-package.ts` + `PLUGIN_WIKI.md` §8.2 + 安装弹窗「插件包格式」折叠说明 |
| 白皮书里出现的功能 | `src/views/WhitepaperView.vue` 的对应章节（硬性同步规范） |
| 内核本身 | 跑 `.ai/tmp/plugin-kernel-smoke.mjs`（自带转译器，**直接 node 跑**，不要经 ts-smoke-harness） |

---

## 13. 已知缺口（2026-09-21 更新：四个缺口已补齐三条）

| 原缺口 | 现在 |
| --- | --- |
| ① 拿不到 `h` / Vue 响应式 | ✅ **`ctx.vue`** 下发 `h` / `ref` / `reactive` / `computed` / `watch` / `onMounted` / `onUnmounted` / `nextTick`（§2） |
| ② 拿不到宿主组件、Tailwind 类受限 | ✅ **`app:ui`** 把宿主正在用的组件原样交给插件，样式天然随主题（§5.4） |
| ③ 没有取数通道 | ✅ **`app:http`（白名单内）+ `app:quotes`（批量报价）**（§5.5 / §5.6） |
| ④ 没有模板编译器 | ⚠️ 仍需渲染函数（见下） |
| ⑤ 写坏了要给什么样的报错 | ✅ **安装前静态预检**：行号 + 原因 + 该怎么改（`src/plugin/user-plugin-lint.ts`） |

仍未补齐的：

1. **模板编译器**：`component.template` 仍不可用，请一律用渲染函数。
   JSX 同理（也要编译，且 Vue JSX 插件的默认产物会 `import "vue/jsx-runtime"`）——
   第三方想要 JSX 的写法，正确姿势是**本地预编译成 `h()` 产物**再安装，宿主不用改（见 `PLUGIN_WIKI.md` §8.1）。
   （若将来真要在运行时支持模板：把 `vue` 换到含编译器的 esm-bundler，代价是 +约 100KB 主包体积，
   收益与 `app:ui` 重叠，**当前不划算**。）
2. **无类型提示**：第三方只能用 JS 硬写。要 TS 提示，只能自行维护一份 `AppServiceMap` / `PluginContext` 的 d.ts 副本。
3. **`app:ui` 覆盖面有限**：目前十二个组件（Button / Input / Switch / Tag / Card / Empty / Tabs /
   Table / Modal / Drawer / Skeleton / Icon）。Select / DatePicker / 图表这类还没开放 ——
   真有插件需要时再补（补的是复用，不是凭想象先造）。

如果第三条里的某一项正好卡住你的插件，宿主侧补它的成本很低（一个组件句柄 + 一行 provide），欢迎提需求。
