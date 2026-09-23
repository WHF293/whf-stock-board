# 第三方插件开发 wiki

> 面向**应用内安装**的插件作者：你不跟宿主一起构建，交出去的是**构建产物** —— 打成一个 `.zip` 包（推荐，见 §8.2）或单份 `.js`，用户选文件就能装上。
> 要给宿主仓库提 PR 的「源码级插件」作者请另看 `PLUGIN_API.md`（那份更全，含宿主内部模块清单）。
>
> 适用版本：**v2.6.2+**。契约的唯一事实源是 `src/types/plugin.types.ts`，
> 与本文冲突时以代码为准，并欢迎提 issue 回来修文档。

---

## 0. 三分钟上手

### 0.1 一个能装上的最小插件

```js
export default {
  id: 'hello-plugin',
  name: '你好插件',
  version: '1.0.0',
  description: '在左侧栏放一块面板',
  apply(ctx) {
    const { h } = ctx.vue;                 // Vue 运行时句柄，不需要 import
    ctx.sidebar.add({
      id: 'main',
      title: '你好',
      icon: 'star',
      order: 300,
      component: { render: () => h('div', { class: 'px-3 py-2' }, '你好，插件') },
    });
  },
};
```

存成 `hello.js` → 应用里 **设置 → 插件（或插件工坊）→ 安装** → 选 `.zip` 产物包（可多选 / 拖拽，选中即自动解析），或粘贴代码 / 选本地 `.js` → 安装。
装完立刻生效，不用重启；在插件管理里可以停用 / 卸载（卸载建过表时会问「保留数据 / 一并删除」）。

一次传多个 zip 包时，每个包各占一张卡片**并行**解析（先传了 A、B 再传 C，C 不用排队），卡片上会显示它走到
六步中的哪一步：`解包 → 静态预检 → 加载产物 → 结构校验 → 清单一致性 → 包间冲突`。
卡在哪一步，那一步就是红字，后面的步骤置灰，整张卡片包红框并原样贴出报错。**包间冲突**指的是同一批里两个包解析出同一个插件 id ——
按上传顺序先到先得，后到的那个会写明和谁撞了；想换成它就先把前面那个移除，别指望它被静默覆盖。

同 id 再装一次不会撞车：见 §8.3（升级 / 接管 / 卸载）。

### 0.2 三条不能碰的红线（装之前就会被拦下）

| 不能写 | 为什么 | 该怎么写 |
| --- | --- | --- |
| `import … from '…'`、`export … from '…'`、`import('…')` | 插件是运行时被包成 Blob URL 动态加载的一段字符串，解析它的那一刻**没有打包器在场**，浏览器只认 URL、不认包管理器 | 所有能力都从 `ctx` 上取（第 3、5 章） |
| `component: { template: '<div>…' }` | 生产构建用的是**不含模板编译器**的 Vue 运行时，写了只会多一行 `[Vue warn]`，组件**渲染成空白**——最坑的那种失败 | 用渲染函数 `render: () => h(…)`（第 8 章） |
| 自己发明 Tailwind 类调样式 | Tailwind 在**构建期**只扫描宿主源码，插件独有的类（如 `ps-[13px]`、`outline-dashed`）在产物 CSS 里根本没有 | 用 `app:ui` 的组件，或内联 `style` |

前三条是**安装前的静态预检项**：命中前两条直接拦下，报错写清「第几行 + 为什么 + 该怎么改」；
第三条不拦（能装），但会拿**宿主真实样式表**逐个类名比对，缺样式的会按「第几行 + 类名」列出来
（不是靠猜——早期版本按「长得像 Tailwind 类」猜，在官方插件上 3 条全是误报）。

### 0.3 一句话理解这套机制

宿主把能力**以句柄的形式发给你**：`ctx.vue` 给你渲染运行时，`app:ui` 给你现成的组件，
`app:http` / `app:quotes` 给你取数通道，`ctx.storage` / `ctx.db` / `ctx.settings` 给你存数据的地方。
你唯一要记住的是：**任何东西都从 `ctx` 上拿，不要 import。**

---

## 1. 插件长什么样

```js
export default {
  id: 'my-plugin',              // 全局唯一，小写 + 连字符
  name: '我的插件',
  version: '1.0.0',
  description: '一句话说明（插件管理里展示）',
  author: '作者名',              // 可省略，缺省显示「用户安装」
  inject: [],                   // 可选：依赖别的插件 id
  config: {},                   // 可选：只读配置，ctx.config 取
  settings: { /* 第 4.3 节 */ },// 可选：声明后宿主自动生成设置表单
  apply(ctx) { /* 所有注册都写在这里 */ },   // 可以写成 async
};
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | `/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+)*$/`，全局唯一；重复 id 后装覆盖先装 |
| `name` / `version` / `description` | ✅ | 展示用 |
| `author` | — | 缺省按来源兜底 |
| `inject` | — | 依赖没挂载 → 本插件停在 `pending`；依赖被停用 → 级联回 `pending`；**环形依赖不会死循环** |
| `config` | — | 只读，随定义下发（`ctx.config`） |
| `settings` | — | 设置声明，见第 4.3 节 |
| `apply` | ✅ | 抛错 → 状态 `failed`，**已产生的贡献点全量回滚**；不自动重试，用户在管理弹窗点重试 |

### 1.1 状态机

| 状态 | 含义 | 谁推进 |
| --- | --- | --- |
| `mounted` | 已挂载，贡献点全部生效 | 内核 |
| `mounting` | `apply` 返回 Promise 还没 resolve | 插件自己 |
| `pending` | 等依赖（或依赖被停用级联等待） | 依赖就绪后自动挂载 |
| `disabled` | 用户关掉了（持久化黑名单） | 用户在插件管理里操作 |
| `failed` | `apply` 抛错，贡献点已回滚 | 用户点重试 / 重新启用 |

### 1.2 卸载时你不用写反向逻辑

所有 `ctx.*.add()` 的返回值、所有 `ctx.on()` 的订阅，都被内核收进本次挂载的「副作用袋」，
卸载时逆序 dispose 一遍。**轮询、定时器、全局监听请用 `ctx.effect` / `ctx.onDispose` 登记**（第 7 章），
不要指望组件里的 `onUnmounted`——面板会被折叠卸载。

---

## 2. `ctx` 速查

| 成员 | 用途 |
| --- | --- |
| `ctx.pluginId` | 本插件 id |
| `ctx.config` | 只读配置 |
| `ctx.logger` | `{ info, warn, error }`，前缀固定 `[plugin] <id> [级别]` |
| `ctx.vue` | **Vue 运行时句柄**：`h` / `ref` / `reactive` / `computed` / `watch` / `onMounted` / `onUnmounted` / `nextTick` |
| `ctx.storage` | KV 持久化（第 4.1 节） |
| `ctx.db` | 结构化表（第 4.2 节） |
| `ctx.settings` | 清单式设置的运行时存取（第 4.3 节） |
| `ctx.sidebar` / `header` / `menu` / `router` / `dock` / `command` / `stockRow` / `stockDetail` / `agent` | 九个贡献点（第 3 章） |
| `ctx.effect(fn)` | 立即执行一次 + 登记清理函数 |
| `ctx.onDispose(fn)` | 只登记「卸载时回调」，不立即执行 |
| `ctx.provide(name, impl)` | 给别的插件贡献服务 |
| `ctx.consume(name)` | 取服务，**可能返回 `undefined`**（提供方插件被停用时），必须判空降级 |
| `ctx.on(name, handler)` | 订阅事件，卸载自动退订 |
| `ctx.emit(name, ...args)` | 广播事件，自动带上来源 pluginId |

---

## 3. 九个贡献点（你能往宿主里塞什么）

通用规则：

- 全局键统一是 `<pluginId>#<id>`，`<id>` 只需插件内唯一；
- **同 key 后注册覆盖先注册**，被覆盖者随本次挂载撤销而恢复；
- 带 `order` 的一律升序排列、同 order 保持注册先后。

### 3.1 `ctx.sidebar.add()` — 左侧栏面板

```js
ctx.sidebar.add({
  id: 'main',
  title: '盯盘',
  icon: 'bell',                  // MenuIcon 的 icon key，未知 key 渲染为空（不报错）
  mode: 'inline',                // 'inline' 直接渲染在侧栏 | 'drawer' 侧栏只放入口，内容走右侧抽屉
  position: 'nav',               // 'nav' 菜单区 | 'footer' 侧栏底部
  order: 100,                    // 默认 100，越小越靠上
  component: PanelComponent,
  props: {},
  visibleWhenCollapsed: false,   // 侧栏收成 64px 图标栏时是否还渲染
});
```

⚠️ **面板会被卸载**：① 面板标题条折叠；② 侧栏收起且 `visibleWhenCollapsed` 为假。
所以**轮询 / 告警 / 定时任务必须写在插件层**（第 7 章），写在面板组件里会随折叠停摆。

### 3.2 `ctx.menu.add()` — 左侧导航菜单（带 component 自动产出路由）

```js
ctx.menu.add({
  path: '/my-page',        // 须以 / 开头，不要和宿主页冲突
  title: '我的页',
  icon: 'star',
  component: PageComponent, // 传了就自动注册路由，不用再 ctx.router.add
  order: 500,               // 默认 500（宿主页在前、插件页在后）
  fallbackLanding: true,    // 声明为「插件页被撤销时的兜底落点」
});
```

菜单的顺序与显隐由用户在设置页「路由顺序编排」调整。
`fallbackLanding` 的作用：插件被停用 / 卸载时，正停在你页面上的用户会被接走到兜底页（宿主页优先 → 侧栏第一个 → 首页），并浮窗说明原因。

### 3.3 `ctx.router.add()` — 隐藏路由（不进菜单）

```js
ctx.router.add({
  path: '/my-detail/:id',
  name: 'my-detail',        // 可选，供 router.push({ name }) 用
  component: DetailComponent,
  meta: { title: '明细' },  // 顶栏与浏览器标题
  underLayout: true,        // 默认 true；独立窗口页传 false
});
```

### 3.4 `ctx.header.add()` — 顶栏条目（图标 + 收起态轮播，点开下拉面板）

```js
ctx.header.add({
  id: 'watch',
  title: '自选盯盘',
  icon: 'bell',
  order: 100,
  component: HeaderPanelComponent,
  marquee: () => lines,       // 收起态轮播数据源（在响应式作用域内求值，直接读自己的 ref）
  marqueeIntervalMs: 4000,    // 默认 4000，低于 1500 会被夹到 1500
});
```

`marquee` 返回数组，每项：

| 字段 | 说明 |
| --- | --- |
| `text` | 整行文本（同时作为无障碍朗读内容）；只给 `text` 时整行单行截断 |
| `label` / `price` / `percent` | **成对给出**时按「名称定宽可截断 + 数值定宽不截断」渲染 |
| `tone` | `'default' \| 'up' \| 'down' \| 'flat' \| 'primary'`（涨跌色跟随主题，插件不碰色值） |

返回空数组 → 回落为条目名；返回单行 → 常显不轮播。

### 3.5 `ctx.dock.add()` — 右侧停靠面板

```js
ctx.dock.add({ id: 'my-dock', title: '我的面板', component: DockComponent, props: {} });
```

打开方式需要自己触发（`panel:open` 服务目前只覆盖侧栏 inline/drawer 与顶栏条目，不含 dock）。

### 3.6 `ctx.command.add()` — 命令（可挂全局快捷键）

```js
ctx.command.add({ id: 'open', title: '打开我的面板', keys: 'Ctrl+Alt+N', run: () => {} });
```

- 快捷键由宿主在 capture 阶段统一匹配，**插件不要自己挂 `keydown`**（会抢事件、卸载后泄漏）；
- 修饰键 `Ctrl` / `Shift` / `Alt` / `Meta`；具名键 `Tab Esc Enter Space Up Down Left Right`；字母写 `X`、数字写 `0`；
- 省略 `keys` → 只可编程调用（出现在命令面板 / 插件详情）。

### 3.7 `ctx.stockRow.add()` — 股票行操作（自选股等表格「操作」列注入按钮）

```js
ctx.stockRow.add({
  id: 'watch',
  title: '盯盘',
  activeTitle: '取消盯盘',
  icon: 'bell',
  order: 100,
  isActive: (row) => row.symbol === 'x',
  run: (row) => { /* row = { symbol, name } */ },
});
```

宿主只交出 `{ symbol, name }`，**不暴露行对象 / 表格实例**——你改不了宿主的数据。

### 3.8 `ctx.stockDetail.add()` — 个股详情扩展区

```js
ctx.stockDetail.add({ id: 'notes', title: '速记', order: 100, component: SectionComponent });
```

组件会收到 `props.symbol`（归一化完整符号）。这是「跟着个股走」的功能（速记 / 标签 / 备注）的统一入口。

### 3.9 `ctx.agent.addServer()` — 内置 MCP 服务器（把能力交给 Agent）

```js
ctx.agent.addServer({ id: -100, key: 'my-tools', name: '我的工具', description: '', tools: [...] });
```

`id` 沿用内置服务器的**负数 id 约定**（与远端服务器的正数 id 区分）。

---

## 4. 数据持久化（插件永远不直接碰 SQL）

三条通道，按体量选：

| 通道 | 适合 | 卸载后 |
| --- | --- | --- |
| `ctx.storage` | 小体量偏好、开关、上次输入 | **保留**（重装还在） |
| `ctx.db` | 结构化记录、要查询排序的列表 | 弹窗询问「保留 / 一并删除」 |
| `ctx.settings` | 用户要改的配置项（宿主自动生成表单） | 随 storage 保留 |

### 4.1 `ctx.storage` — KV

```js
ctx.storage.get('key', fallback);   // 键不存在返回 fallback
ctx.storage.set('key', value);      // JSON 序列化
ctx.storage.remove('key');
```

- 命名空间 `plugin:<pluginId>`，**插件之间天然隔离**；
- 桌面端额外异步镜像进 SQLite `plugin_storage` 表，启动时以库覆盖水合；
- 数据损坏时重置为空对象并记一条 `console.error`，不会抛给你。

### 4.2 `ctx.db` — 结构化表（每插件独立）

```js
await ctx.db.ensureTable('watch_candidates', [
  { name: 'symbol', type: 'text', indexed: true },
  { name: 'note',   type: 'text' },
  { name: 'score',  type: 'real' },
  { name: 'meta',   type: 'json' },
]);
const id = await ctx.db.insert('watch_candidates', { symbol: 'sh600519', score: 1 });
const rows = await ctx.db.select('watch_candidates', {
  where: { symbol: 'sh600519' }, orderBy: { column: 'score', desc: true }, limit: 20, offset: 0,
});
await ctx.db.update('watch_candidates', id, { score: 2 });
await ctx.db.remove('watch_candidates', id);
await ctx.db.count('watch_candidates', { symbol: 'sh600519' });
await ctx.db.clear('watch_candidates');
```

| 约定 | 内容 |
| --- | --- |
| 物理表名 | `plugin_<插件id>_<表名>`；标识符白名单由宿主校验，插件拼不进任何 SQL |
| 列类型 | `text` / `integer` / `real` / `json`（`json` 写入 stringify、读出 parse） |
| 保留列 | `id` / `createdAt` / `updatedAt` 由宿主固定追加并维护，**插件不得声明同名列**（会明确报错） |
| 建表幂等 | `ensureTable` 可重复调用；**缺列会自动 `ALTER TABLE ADD COLUMN` 补上**（补成可空列）→ 加列只改声明，不用写迁移 |
| 不可变部分 | 改列类型 / 删列宿主不感知（SQLite 也不支持）→ 要改类型就**换个新列名** |
| 读出形态 | 每行额外带 `id` / `createdAt` / `updatedAt` |
| 双端一致 | 桌面端落 SQLite，浏览器端降级为本地 JSON 表仿真，语义一致 |

### 4.3 `ctx.settings` — 清单式设置

在定义里声明，宿主自动生成表单，入口是 **顶栏齿轮 → 插件设置**：

```js
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
},
```

运行时读写（响应式，即时持久化、即时生效）：

```js
ctx.settings.values.topN;          // 响应式对象，已并入默认值，computed 可直接依赖
ctx.settings.get('topN', 10);
ctx.settings.set('topN', 20);
ctx.settings.reset();
```

---

## 5. 十六个宿主服务（`ctx.consume` 取）

宿主启动时就注册好了，`apply` 里必拿得到。**一律判空**：插件之间互相提供的服务在提供方被停用时会消失。

| 服务名 | 说明 |
| --- | --- |
| `app:version` | 应用版本号字符串 |
| `app:navigate` | `(path) => void` 跳路由（插件不持有 router 实例） |
| `panel:open` | `(panelKey) => void` 按全局键 `<id>#<key>` 打开面板；键不存在只 `console.warn` |
| `panel:close` | `(panelKey) => void` 关掉自己的面板（drawer 关抽屉 / 顶栏收起下拉 / inline 折叠） |
| `app:notify` | 右下角应用级浮窗（宿主渲染，**跨路由常驻**） |
| `app:stock-search` | 标的搜索（代码 / 名称 / 拼音） |
| `app:stock-picker` | **选股弹窗**：宿主渲染全站统一的搜索，Promise 回传结果（第 5.12 节） |
| `app:stock-open` | **打开个股**：`openSidebar` 开右侧详情侧栏 / `openPage` 进详情整页（第 5.7 节） |
| `app:watchlist` | **自选股只读视图**：`symbols()` / `groups()` / `nameOf()`（第 5.8 节） |
| `app:polling` | **轮询调度器工厂**：`create()`，自带交易窗口 / 退避 / 可见性策略（第 5.9 节） |
| `kernel:runtime` | 内核只读自省：`list()` / `get(id)` / `listServices()` / `recentEvents()` |
| `app:ui` | **UI Kit**：十二个宿主组件句柄 + `confirm()`（第 5.4 节） |
| `app:http` | **受控网络请求**：走宿主上游通道，仅白名单域名（第 5.5 节） |
| `app:quotes` | **行情报价**：按代码批量取实时快照（第 5.6 节） |
| `app:market` | **市场剖面**：沪深逐日成交额 / 指定交易日涨停池（重接口，别轮询；第 5.10 节） |
| `app:format` | **格式化与涨跌语义**：红涨绿跌、百分比 / 价格 / 相对时间、符号互转、`delay` / `debounce`（第 5.11 节） |

### 5.1 `app:notify`

```js
const notify = ctx.consume('app:notify');
const id = notify.notify({
  title: '贵州茅台 涨到 1700.00',
  body: '现价 1702.30（+3.21%）',
  tone: 'up',               // 'flat'（默认）| 'up' | 'down' | 'primary'
  timeoutMs: 8000,          // 0 = 常驻直到手动关闭
  source: '盯盘提醒',
  dedupeKey: 'sh600519',    // 同键只保留最新一条
  onClick: () => {},        // 点击浮窗执行，执行后自动关闭
});
notify.dismiss(id);
notify.dismissBySource('盯盘提醒');    // 卸载时清掉自己的提醒
```

同屏最多 4 条，超出挤掉最旧的一条。

### 5.2 `app:stock-search`

```js
const results = await ctx.consume('app:stock-search').search('茅台');   // code 是 sh600519 完整形态
```

**调用方自己防抖**（建议关键词 ≥ 2 字符）；返回含指数 / 港美股等非 A 股结果，按你自己的口径过滤。

### 5.3 `kernel:runtime`

```js
const runtime = ctx.consume('kernel:runtime');
runtime.list();          // 全部插件运行时信息（status / contributions / error）
runtime.listServices();  // 当前生效的服务名，排障很好用
runtime.recentEvents();  // 最近事件（环形缓冲 200 条，不是响应式）
```

### 5.4 `app:ui` — UI Kit（你做界面的唯一来源）

第三方插件既 import 不了宿主组件，自己写的 Tailwind 类又可能没 CSS。
UI Kit 一次解决两件事：宿主把自己正在用的组件原样交给你，拼出来的界面天然与原生页面同风格、跟着主题走。

```js
const ui = ctx.consume('app:ui');
const { h } = ctx.vue;

h(ui.Button, { variant: 'primary', onClick }, () => '查询');     // 第三参数 = 默认插槽
```

| 句柄 | 关键 props |
| --- | --- |
| `ui.Button` | `variant: 'primary' \| 'ghost' \| 'danger'`、`disabled`、`type` |
| `ui.Input` | `modelValue`（配 `'onUpdate:modelValue'`）、`placeholder`、`type` |
| `ui.Switch` | `modelValue`（配 `'onUpdate:modelValue'`） |
| `ui.Tag` | `tone: 'primary' \| 'up' \| 'down' \| 'flat'` |
| `ui.Card` | `title`、`fill` + `extra` / 默认插槽 |
| `ui.Empty` | `text` |
| `ui.Tabs` | `options: { label, value }[]`、`modelValue`、`variant: 'segmented' \| 'underline'` |
| `ui.Table` | `columns`（`{ key, label, align, sortable, sortValue }`，**表头文案是 `label` 不是 `title`**）、`rows`、`rowKey`、`minWidth`、`rowClickable`、`expandable` + 列 key 同名插槽 |
| `ui.Modal` | `title`、`open`（配 `'onUpdate:open'`）、`maxWidthClass`、`heightClass` + 默认 / `filters` / `footer` 插槽 |
| `ui.Drawer` | `title`、`open`（配 `'onUpdate:open'`）、`width`（默认 `66vw`） |
| `ui.Skeleton` | 骨架占位，无 props（默认三行形状，默认插槽可自定）。**只在一条数据都没有时用** |
| `ui.Icon` | `name`（icon key 见第 10 章）、`size` |

`ui.Table` 自定义单元格用**与列 key 同名**的作用域插槽：

```js
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
  price: ({ row }) => h('span', { class: 'tabular-nums' }, row.price.toFixed(2)),
});
```

`ui.Modal` / `ui.Drawer` 由你自己持有 `open`：

```js
const open = ref(false);
h(ui.Modal, {
  open: open.value,
  title: '新增条目',
  'onUpdate:open': (value) => { open.value = value; },
  onCancel: () => { open.value = false; },
}, {
  default: () => h(ui.Input, { /* … */ }),
  footer: () => h(ui.Button, { variant: 'primary', onClick: onSubmit }, () => '保存'),
});
```

两者自带遮罩点击关闭、ESC 关闭、打开时锁 body 滚动。
与 `confirm()` 的分工：**`confirm()` 是宿主渲染的一次性确认，`Modal` / `Drawer` 是你自己持有的界面**。

`confirm()` 用法：

```js
const ok = await ui.confirm({
  title: '删除这条记录？',
  content: '删除后不可恢复。',
  okText: '删除',
  okVariant: 'danger',
});
if (!ok) return;
```

- 弹窗由宿主渲染，所以你的面板被折叠 / 卸载**都不会丢答复**；
- 同时来了第二个 `confirm`，前一个立刻结算为 `false`（UI 上无法分辨两个弹窗，宁可给明确结果也不悬死）。

### 5.5 `app:http` — 受控网络请求

```js
const http = ctx.consume('app:http');
if (!http.isAllowed('https://push2.eastmoney.com/api/qt/clist/get')) return;   // 先自检
const response = await http.fetch('https://push2.eastmoney.com/api/qt/clist/get?...');
const text = await response.text();     // 腾讯源仍是 GBK，要原字节转码时自己处理
http.allowedHosts;                      // 当前白名单
```

| 成员 | 说明 |
| --- | --- |
| `fetch` | 与标准 fetch 同签名。桌面端由 Rust 直连（无 CORS），浏览器端走 `/stock-proxy` |
| `allowedHosts` | 允许访问的域名（后缀匹配，子域自动覆盖） |
| `isAllowed(url)` | 发起前自检，非法 / 相对 URL 一律 false |

红线：

- **白名单之外的域名一律不可达**。这不是限制你，是为了不把应用变成开放代理 —— 需要新源请提 issue，由宿主加进白名单后再用；
- 代理有 3 秒短缓存与 12 秒超时；
- 别用它打应用自身的接口 —— 应用能力一律走 `ctx.storage` / `ctx.db` 与各项服务。

### 5.6 `app:quotes` — 行情报价

```js
const list = await ctx.consume('app:quotes').fetchFullQuotes(['300339', 'sh600519']);
```

- 裸代码（`300339`）与完整符号（`sh600519`）都能传；
- 上游拿不到的代码不出结果，**按 code 取值务必做地图查找**，不要假设下标；
- **不要轮询**：这是展示级的批量接口，长期后台刷新请走低频（≥30s）。

### 5.7 `app:stock-open` — 打开个股

```js
const stockOpen = ctx.consume('app:stock-open');
stockOpen.openSidebar('sh600519');   // 单击语义：展开右侧详情侧栏
stockOpen.openPage('600519');        // 双击语义：进详情整页（裸码也认）

// 带上来源列表 → 详情页左侧可一键切换同批股票（symbol 由宿主归一化）
stockOpen.openPage('600519', rows.map((r) => ({ symbol: r.code, name: r.name })));
```

与宿主页面的搜索、自选股表格是**同一个实现**。你自己 `app:navigate` 也能跳过去，
但会丢掉详情页左侧的来源列表。

### 5.8 `app:watchlist` — 自选股（只读）

```js
const watchlist = ctx.consume('app:watchlist');
watchlist.symbols();            // 全部自选股完整符号（跨分组去重）
watchlist.groups();             // [{ id, name, stocks: [{ symbol, name }] }]
watchlist.nameOf('sh600519');   // 查名称；不在自选股里返回 undefined
```

三个成员都是 getter，**在你自己的 computed / watch 里调用会跟随自选股变化**：

```js
const monitored = computed(() => rows.value.filter((r) => watchlist.symbols().includes(r.symbol)));
```

**只给读不给写** —— 增删自选归宿主页面。

### 5.9 `app:polling` — 轮询（别自己写 `setInterval`）

```js
const scheduler = ctx.consume('app:polling').create({
  task: async () => { /* 取数（务必批量） */ },
  intervalMs: 30_000,
  tradingAware: true,        // 只有交易窗口内轮询，窗口外自动暂停
});
ctx.effect(() => () => scheduler.stop());   // 卸载必须 stop，否则监听泄漏

await scheduler.runNow();     // 立即补一轮（受互斥保护）
scheduler.isEligible();       // 当前是否允许轮询
```

自带四份策略：**交易窗口感知 / 失败指数退避 / 页面可见性感知 / 轮询总开关**。
自己写一份大概率岔开，而岔一次的代价是顶到上游频率红线（东财会封 IP）。

### 5.10 `app:market` — 市场剖面（重接口）

```js
const market = ctx.consume('app:market');
const series = await market.fetchMarketTurnover();        // [{ date, shanghaiAmount, shenzhenAmount, totalAmount }]
const pool = await market.fetchLimitUpPool('2026-09-18'); // 涨停池 [{ code, name, price, changePercent, continuousBoardCount, boardAmount, industry }]
```

两者都是重量级请求 —— **只能由用户点击触发，不要轮询**。

### 5.11 `app:format` — 格式化与涨跌语义

```js
const f = ctx.consume('app:format');
f.percent(2.35);              // '+2.35%'
f.percentUnsigned(1.71);      // '1.71%'
f.price(1702.3);              // '1702.30'
f.relativeTime(Date.now() - 3e5);   // '5分钟前'
f.trend(2.35);                // trend 枚举
f.trendClass(f.trend(-1));    // 文本色类名（红涨绿跌是宿主口径，别自己写）
f.trendPillClass(trend);      // 胶囊类名
f.toFullSymbol('600519');     // 'sh600519'
f.toBareCode('sz300339');     // '300339'
f.normalizeCode('600519');    // 'sh600519'
f.findQuote(quotesMap, 'sh600519');   // 上游返回裸代码键时也能查到
await f.delay(500);           // 错开对同一上游的连续请求
const onInput = f.debounce(doSearch, 300);
f.placeholder;                // '--'
```

红涨绿跌、`delay` / `debounce`（上游限速节拍的一部分）、符号三形态互转 ——
这些**不要各写一份**，写反或写岔的代价分别是配色反了 / 触发封 IP / 整列变 `--`。

### 5.12 `app:stock-picker` — 让用户挑一只股票

要「让用户挑一只票」时用这个，**别自己搭搜索框**：你那份没有搜索历史、样式不统一，
宿主搜索改版了也不会跟着更新，弹窗的生命周期还得自己管。

```js
const picked = await ctx.consume('app:stock-picker').pick();   // 取消 / 关闭 = null
if (picked) {
  // picked.code 是 sh600519 完整形态，picked.name 是股票名
  save({ symbol: picked.code, name: picked.name });
}
```

弹窗**由宿主渲染**（和 `app:ui` 的 `confirm()` 同一套路），所以你的面板被折叠、
路由被切走，结果照样回得来。

---

## 6. 内置事件

```js
ctx.on('route:changed', (to, from) => { /* 离开页面时保存草稿之类 */ });
ctx.emit('note:saved', id);       // 自定义事件：名字随便起，约定 namespace:action
```

| 事件名 | 参数 | 何时触发 |
| --- | --- | --- |
| `plugin:mounted` | `[info]` | 某插件挂载完成（贡献点已全部生效） |
| `plugin:unmounted` | `[info]` | 某插件卸载完成 |
| `plugin:failed` | `[info, error]` | 某插件挂载失败 |
| `sidebar:changed` | `[panels]` | 侧栏面板注册表变化 |
| `header:changed` | `[items]` | 顶栏条目注册表变化 |
| `route:changed` | `[to, from]` | 路由切换 |

- 单个订阅者抛错**不影响其他订阅者**（宿主逐个 try/catch）；
- 订阅随插件卸载**自动退订**，不用手动 off。

### 6.1 插件之间怎么协作

**不要互相 import**（你也 import 不了）。统一走服务 + 事件：

```js
// 提供方
ctx.provide('note:repo', { list: async () => [], add: async () => {} });
ctx.emit('note:saved', id);

// 消费方：允许缺席
const repo = ctx.consume('note:repo');   // undefined = 提供方插件没启用 → 自行降级
ctx.on('note:saved', (id) => { /* … */ });
```

依赖顺序写在 `inject: ['提供方的插件 id']` 里，未就绪时本插件停在 `pending`，就绪后自动挂载。

---

## 7. 后台任务与生命周期（最容易翻车的地方）

### 7.1 三件事放对位置

| 需求 | 放哪 | 原因 |
| --- | --- | --- |
| 轮询 / 到价告警 / 定时任务 | **插件层**：`app:polling` 的 `create()` + `ctx.effect(() => () => scheduler.stop())` | 侧栏面板有**两层折叠**都会卸载组件，写在组件里会随折叠停摆 |
| 弹提醒 | `app:notify` | 宿主承载、跨路由常驻 |
| 跳页面 / 唤醒面板 | `app:navigate` / `panel:open('<id>#<key>')` | 插件不持有 router 实例 |
| 关掉自己的面板 | `panel:close('<id>#<key>')` | 「保存并关闭」这类动作不必 inject 宿主内部上下文 |

```js
apply(ctx) {
  const scheduler = ctx.consume('app:polling').create({ task: tick, intervalMs: 30_000, tradingAware: true });
  ctx.effect(() => () => scheduler.stop());   // 卸载时收干净
  ctx.onDispose(() => ctx.consume('app:notify')?.dismissBySource('我的插件'));
}
```

> **别自己写 `setInterval` 去重/退避逻辑**：`app:polling` 的 `create()` 已经带了
> 交易窗口感知、失败指数退避（`BACKOFF_BASE * 2^n` 封顶）、页面可见性感知与轮询总开关，
> 和宿主 `usePolling` 是同一份实现。自己写一份迟早岔开，岔一次的代价是顶到上游频率红线。
>
> 窗口外的场景（比如只想每天 09:00 跑一次）才回到 `ctx.effect` + 自己算时间。

### 7.2 页面被撤销时用户会被接走

插件被停用 / 卸载 / 挂载失败回滚时，它的路由会被摘掉；用户正停在该页的话，宿主按
`fallbackLanding` 三级递退把他接走并浮窗说明。**你不用处理这件事**，但主页面建议声明 `fallbackLanding: true`。

---

## 8. 界面怎么搭（渲染函数速成）

不能用 `template`，所有界面都用 `h()` 搭。`h` 从 `ctx.vue` 上取。

```js
const { h } = ctx.vue;

h('div', { class: 'px-3 py-2' }, '文本子节点')
h('div', { class: 'flex flex-col gap-2' }, [子节点1, 子节点2])
h(ui.Button, { variant: 'primary', onClick: onQuery }, () => '查询')   // 第三参数 = 默认插槽
h(ui.Table, { columns, rows, rowKey }, { price: ({ row }) => ... })    // 命名插槽 = 对象
```

| 模板写法 | 渲染函数写法 |
| --- | --- |
| `@click="fn"` | `onClick: fn` |
| `v-model="x"` | `modelValue: x.value` + `'onUpdate:modelValue': (v) => { x.value = v; }` |
| `:disabled="b"` | `disabled: b` |
| `v-if` | 用三元：`cond ? h(...) : null` |
| `v-for` | `list.map((item) => h(...))` |
| `<slot name="x">` | 第三参数对象里的 `x: 函数` |

样式怎么办：

- **首选 `app:ui` 的组件** —— 样式天然存在、跟着主题走；
- 需要排布时用**宿主源码里已有的通用类**（`flex` / `flex-col` / `items-center` / `gap-2` / `px-3` / `py-2` / `text-xs` / `tabular-nums` 这些基本都在产物 CSS 里）；
- 拿不准就**内联 `style`**（`{ style: { paddingLeft: '13px' } }`）—— 一定生效，不依赖扫描；
- 别写任意值 / 任意属性类（`ps-[13px]`、`[padding-left:13px]`）—— 安装时会被提醒「可能没有样式」。

### 8.1 想用 JSX 写？（可以，但要本地预编译）

**JSX 和 template 一样，都需要编译。** 浏览器不认识 `<div>{x}</div>` 这种语法，
宿主的运行时里既没有模板编译器也没有 JSX 编译器，所以**直接把 JSX 粘进去一定是语法错误**。

`@vue/babel-plugin-jsx` 也不能直接解决这个问题：它的默认模式（automatic runtime）编译产物第一行就是
`import { jsxs } from "vue/jsx-runtime"` —— 正好撞在「不许 import」的红线上，装不上。

**可行的路：你在本地把 JSX 预编译成 `h()` 调用，产物再拿去安装。** 宿主不用改任何东西。
实测（TypeScript 6.0.3 与 esbuild 的 JSX 转换规则一致）：

| 编译配置 | 产物 | 能不能装 |
| --- | --- | --- |
| `jsx: preserve`（不转换） | 原样保留 JSX | ❌ 浏览器语法错误 |
| `jsx: react-jsx`（automatic，Vue JSX 插件默认） | `import { jsx } from "vue/jsx-runtime"` | ❌ 被预检拦下 |
| `jsx: react` + `jsxFactory: h`（classic） | `h("div", { class: "..." }, ...)`，**零 import** | ✅ |

esbuild 一行（推荐）：

```bash
npx esbuild plugin.jsx --loader=jsx --jsx=transform --jsx-factory=h --outfile=plugin.js
```

Babel 等价配置：`@babel/plugin-transform-react-jsx` 设 `pragma: "h"`、`pragmaFrag: "Fragment"`
（**不要**用 `runtime: "automatic"`）。

前提与注意：

- 插件代码里要有 `const { h } = ctx.vue;` —— 产物里的 `h` 是自由变量，靠这一行进作用域；
- 成员表达式组件写法是支持的：`<ui.Button variant="primary" onClick={fn}>查询</ui.Button>` → `h(ui.Button, { variant: "primary", onClick: fn }, "查询")`；
- JSX 里写 `class`（Vue 风格），产物原样保留；
- **JSX 没有 `v-model`**：双向绑定照旧写成 `modelValue={x.value}` + `onUpdate:modelValue={(v) => { x.value = v; }}`；
- 预编译产物是普通 JS，粘贴或选文件安装都行，预检不会再拦（产物里没有 import 也没有 template）。

### 8.2 打包成 zip 分发（推荐）

交给别人的是**产物包**，不是源码：宿主运行时没有打包器也没有编译器，装的时候读包 → 取入口产物 →
走和单文件 JS 完全相同的预检链路。

```
my-plugin.zip
├── manifest.json     清单：这是谁、入口在哪
├── main.js           入口产物（单文件 ESM，export default { … }）
└── README.md         可选说明（安装弹窗里可展开预览）
```

`manifest.json` 字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 必须与产物导出的 `id` **完全一致**，不一致直接报「清单 id 与产物不一致」 |
| `version` | 推荐 | 与产物导出的 `version` 必须一致（改了代码忘了同步清单是常见错） |
| `name` / `description` / `author` | 否 | 展示用；缺失时取产物导出的值 |
| `entry` | 否 | 入口产物路径，默认 `main.js` |
| `readme` | 否 | 说明文件路径，默认 `README.md` |

**产物必须打成单文件**（宿主一次只加载一份代码，包内多个互相 import 的 chunk 装不起来 ——
相对路径在 Blob URL 里解析不了）：

```bash
npx esbuild src/main.js --bundle --format=esm --outfile=main.js
```

打包四条：

1. **不要把 vue 打进产物**：插件里的 `h` / `ref` 必须来自 `ctx.vue`（与宿主同一个 Vue 实例，
   响应式才互通）。源码里就别写 `import`，写了预检也会拦；
2. **顶层目录随意**：包成 `my-plugin/…` 也能认（宿主会自动剥掉唯一的顶层目录）；
3. **路径里别带 `..` 或绝对路径**，会被当成非法包拒收；
4. 体积：入口产物 ≤ 512KB，整个 zip ≤ 8MB。

压包（任选）：

```bash
zip -r my-plugin.zip manifest.json main.js README.md        # macOS / Linux
tar -a -c -f my-plugin.zip manifest.json main.js README.md  # Windows
```

也可在 `package.json` 里挂个脚本用 fflate 打（`npm i -D fflate`）：

```js
// scripts/pack.mjs
import { zipSync } from 'fflate';
import { readFileSync, writeFileSync } from 'node:fs';
const read = (p) => readFileSync(p);
writeFileSync('my-plugin.zip', zipSync({
  'manifest.json': read('manifest.json'),
  'main.js': read('dist/main.js'),
  'README.md': read('README.md'),
}));
```

### 8.3 再装一次：升级、接管与卸载

**同 id 不会被「已被占用」挡下**——宿主按高层政策处理三种情形，安装弹窗会把「这次到底会发生什么」写在预览里：

| 情形 | 弹窗提示 | 按钮 | 结果 |
| --- | --- | --- | --- |
| 首次安装 | 无 | 确认安装 | 挂载新插件 |
| 已装过同 id（不同 version） | `已安装 v1.0.0，本次将升级到 v1.1.0` | 确认升级 | 旧版本整体撤销，新版本接管，**数据表保留** |
| 已装过同 id（相同 version） | `已安装 v1.0.0，本次将覆盖重装` | 确认升级 | 同上（重装一份干净的实现） |
| 与某个**内置插件**同 id | `内置版 vX 将被本版本接管；卸载本插件即刻恢复内置实现` | 确认接管安装 | 内置实现让位（下次启动也不再注册），卸载后立刻恢复 |

要点：

- **发新版不用让用户先卸载**：用户直接装新包即可；内置能力改 zip 分发后，这一装就是「升级」。
- **数据跟着 id 走**：`ctx.db` 表名 `plugin_<id>_*`、`ctx.storage` 命名空间 `plugin:<id>` 都由 id 派生，
  升级 / 接管 / 卸载重装都不丢数据；要彻底清，卸载时选「一并删除」。
- **卸载入口**：插件工坊或设置 → 插件管理，卡片底部「卸载」需点两次（第二次变「确认卸载」），
  防手滑；卸完 plugin 的代码、面板、菜单、路由、命令立即消失，无需重启。

---

## 9. 配额与红线

| 项 | 限制 |
| --- | --- |
| 用户插件条目数 | 50 条 |
| 单份插件代码 | 512 KB |
| zip 包体积 | 8 MB（入口产物仍受上面的 512 KB 约束） |
| 同屏浮窗 | 4 条 |
| 浮窗默认存活 | 8 s（`0` = 常驻） |
| 顶栏轮播间隔 | 默认 4000 ms，下限 1500 ms |
| 网络请求 | 必须经 `app:http.fetch`，域名限于 `app:http.allowedHosts` |
| 东财高频 | 会封 IP；并发 ≤ 3，同上游连续请求留 500 ms，重接口一律点击触发不轮询 |
| 插件代码语言 | 不允许 `import` / `export … from` / `import()` / `template:`（安装前预检拦下） |
| 列表刷新 | 不许翻 `loading`（会把整表卸载重建导致闪屏）；只在「一条数据都还没有」时进骨架屏 |

---

## 10. MenuIcon 可用 icon key

`ui.Icon` 的 `name` 与所有贡献点的 `icon` 都取这里的值，**未知 key 渲染为空、不报错**：

`dashboard star boards funds rank news flame trophy filter settings sun moon plus trash search close menu globe grip arrowLeft info chevronLeft chevronRight chevronDown panelLeft panelRight agent account tradeImport book plug cpu dots pin pencil eye eyeOff folder calendar expand sliders log whitepaper bell`

---

## 11. 五个可以直接抄的示例

### 11.1 侧栏面板 + 设置 + 持久化偏好

```js
export default {
  id: 'note-panel',
  name: '随手记',
  version: '1.0.0',
  description: '一个带开关与输入框的侧栏面板',
  settings: {
    title: '随手记',
    fields: [
      { key: 'showTime', label: '显示时间', type: 'boolean', default: true },
      { key: 'prefix', label: '前缀', type: 'text', default: '· ' },
    ],
  },
  apply(ctx) {
    const ui = ctx.consume('app:ui');
    const { h, ref } = ctx.vue;
    const text = ref(ctx.storage.get('draft', ''));

    ctx.sidebar.add({
      id: 'main',
      title: '随手记',
      icon: 'pencil',
      order: 320,
      component: {
        render: () => h('div', { class: 'flex flex-col gap-2' }, [
          h(ui.Input, {
            modelValue: text.value,
            'onUpdate:modelValue': (v) => { text.value = v; ctx.storage.set('draft', v); },
            placeholder: '记一笔',
          }),
          h(ui.Button, {
            variant: 'primary',
            onClick: () => ctx.consume('app:notify').notify({ title: '已记录', body: text.value, timeoutMs: 4000 }),
          }, () => '保存'),
          ctx.settings.values.showTime
            ? h('div', { class: 'text-xs text-text-secondary' }, ctx.settings.values.prefix + new Date().toLocaleTimeString())
            : null,
        ]),
      },
    });
  },
};
```

### 11.2 查报价 + 表格展示

```js
export default {
  id: 'quote-table',
  name: '报价小表',
  version: '1.0.0',
  description: '查一批代码，用宿主表格展示',
  apply(ctx) {
    const ui = ctx.consume('app:ui');
    const quotes = ctx.consume('app:quotes');
    const { h, ref } = ctx.vue;
    const keyword = ref('sh600519,300339');
    const rows = ref([]);

    const onQuery = async () => {
      const codes = keyword.value.split(/[,，\s]+/).filter(Boolean);
      rows.value = await quotes.fetchFullQuotes(codes);
    };

    ctx.sidebar.add({
      id: 'main',
      title: '报价小表',
      icon: 'search',
      order: 330,
      component: {
        render: () => h('div', { class: 'flex flex-col gap-2' }, [
          h(ui.Input, {
            modelValue: keyword.value,
            'onUpdate:modelValue': (v) => { keyword.value = v; },
            placeholder: '逗号分隔的代码',
          }),
          h(ui.Button, { variant: 'primary', onClick: onQuery }, () => '查询'),
          rows.value.length === 0
            ? h(ui.Empty, { text: '还没有数据' })
            : h(ui.Table, {
                columns: [
                  { key: 'name', label: '名称' },
                  { key: 'price', label: '现价', align: 'right', sortable: true, sortValue: (row) => row.price },
                ],
                rows: rows.value,
                rowKey: (row) => row.code,
                minWidth: '260px',
              }, {
                price: ({ row }) => h('span', { class: 'tabular-nums' }, String(row.price)),
              }),
        ]),
      },
    });
  },
};
```

### 11.3 本地清单 CRUD（表 + 确认删除 + 浮窗）

```js
export default {
  id: 'todo-list',
  name: '代码清单',
  version: '1.0.0',
  description: '用插件表存一份自己的清单',
  async apply(ctx) {
    const ui = ctx.consume('app:ui');
    const notify = ctx.consume('app:notify');
    const { h, ref } = ctx.vue;

    await ctx.db.ensureTable('items', [
      { name: 'symbol', type: 'text', indexed: true },
      { name: 'note', type: 'text' },
    ]);
    const rows = ref(await ctx.db.select('items', { orderBy: { column: 'createdAt', desc: true } }));
    const reload = async () => { rows.value = await ctx.db.select('items', { orderBy: { column: 'createdAt', desc: true } }); };

    const onAdd = async () => {
      await ctx.db.insert('items', { symbol: 'sh600519', note: '示例' });
      await reload();
      notify.notify({ title: '已添加', timeoutMs: 3000 });
    };
    const onRemove = async (row) => {
      const ok = await ui.confirm({ title: '删除这一条？', content: row.symbol, okVariant: 'danger' });
      if (!ok) return;
      await ctx.db.remove('items', row.id);
      await reload();
    };

    ctx.sidebar.add({
      id: 'main',
      title: '代码清单',
      icon: 'star',
      order: 340,
      component: {
        render: () => h('div', { class: 'flex flex-col gap-2' }, [
          h(ui.Button, { variant: 'primary', onClick: onAdd }, () => '添加示例'),
          rows.value.length === 0
            ? h(ui.Empty, { text: '清单是空的' })
            : h(ui.Table, {
                columns: [
                  { key: 'symbol', label: '代码' },
                  { key: 'op', label: '操作', align: 'right' },
                ],
                rows: rows.value,
                rowKey: (row) => String(row.id),
              }, {
                op: ({ row }) => h(ui.Button, { variant: 'ghost', onClick: () => onRemove(row) }, () => '删除'),
              }),
        ]),
      },
    });
  },
};
```

### 11.4 独立页面 + 命令 + 顶栏轮播

```js
export default {
  id: 'my-page-plugin',
  name: '我的页面',
  version: '1.0.0',
  description: '菜单页 + 快捷键 + 顶栏轮播',
  apply(ctx) {
    const ui = ctx.consume('app:ui');
    const quotes = ctx.consume('app:quotes');
    const { h, ref, onMounted } = ctx.vue;

    const lines = ref([]);
    ctx.menu.add({
      path: '/my-page',
      title: '我的页',
      icon: 'star',
      order: 520,
      fallbackLanding: true,
      component: {
        render: () => h(ui.Card, { title: '我的页' }, { default: () => h('div', { class: 'p-3' }, '这是插件自己的页面') }),
      },
    });

    ctx.command.add({
      id: 'open',
      title: '打开我的页',
      keys: 'Ctrl+Alt+N',
      run: () => ctx.consume('app:navigate')('/my-page'),
    });

    ctx.header.add({
      id: 'marquee',
      title: '我的页',
      icon: 'star',
      order: 300,
      component: { render: () => h(ui.Empty, { text: '点按钮刷新' }) },
      marquee: () => lines.value,
      marqueeIntervalMs: 4000,
    });

    // 顶栏轮播的数据也放插件层刷新，面板被收起照样在跑
    const timer = setInterval(async () => {
      const list = await quotes.fetchFullQuotes(['sh600519', '300339']);
      lines.value = list.map((q) => ({ label: q.name ?? q.code, price: String(q.price), percent: q.changePercent + '%' }));
    }, 30_000);
    ctx.effect(() => () => clearInterval(timer));
  },
};
```

### 11.5 两个插件协作（服务 + 事件）

```js
// 插件 A（提供方）
export default {
  id: 'note-provider',
  name: '速记服务',
  version: '1.0.0',
  description: '对外提供 note:repo',
  async apply(ctx) {
    await ctx.db.ensureTable('notes', [{ name: 'text', type: 'text' }]);
    ctx.provide('note:repo', {
      list: () => ctx.db.select('notes', { limit: 50 }),
      add: async (text) => {
        const id = await ctx.db.insert('notes', { text });
        ctx.emit('note:saved', String(id));
        return id;
      },
    });
  },
};

// 插件 B（消费方）—— 声明依赖，并允许服务缺席
export default {
  id: 'note-counter',
  name: '速记计数',
  version: '1.0.0',
  description: '消费 note:repo',
  inject: ['note-provider'],
  apply(ctx) {
    const ui = ctx.consume('app:ui');
    const { h, ref } = ctx.vue;
    const count = ref(0);
    const repo = ctx.consume('note:repo');       // 可能是 undefined
    if (!repo) {
      ctx.logger.warn('速记插件没启用，功能降级');
      return;
    }
    ctx.on('note:saved', () => { count.value += 1; });
    ctx.sidebar.add({
      id: 'main',
      title: '速记计数',
      icon: 'book',
      order: 350,
      component: { render: () => h(ui.Tag, { tone: 'primary' }, () => '新增 ' + count.value + ' 条') },
    });
  },
};
```

---

## 12. 类型提示（可选）

第三方插件只能用 JS 写，宿主不会给你一份运行时 d.ts。想要编辑器提示，把下面这段存成
`plugin-api.d.ts` 放在你的插件旁边（**它只用于提示，不会被加载**），然后在插件文件里加一行 JSDoc：

```js
/** @type {import('./plugin-api').PluginDefinition} */
export default { /* … */ };
```

```ts
// plugin-api.d.ts —— 提示用的最小契约（与宿主 src/types/plugin.types.ts 对齐，非完整版）
export interface PluginDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  inject?: readonly string[];
  config?: Record<string, unknown>;
  settings?: {
    title?: string;
    description?: string;
    fields?: Array<{
      key: string;
      label: string;
      type: 'boolean' | 'number' | 'select' | 'text';
      default?: unknown;
      min?: number;
      max?: number;
      step?: number;
      options?: Array<{ value: string; label: string }>;
    }>;
  };
  apply: (ctx: PluginContext) => void | Promise<void>;
}

export interface PluginContext {
  pluginId: string;
  config: Record<string, unknown>;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  vue: {
    h: (type: unknown, props?: unknown, children?: unknown) => unknown;
    ref: <T>(value: T) => { value: T };
    reactive: <T extends object>(target: T) => T;
    computed: <T>(getter: () => T) => { value: T };
    watch: (source: unknown, cb: (value: unknown, old: unknown) => void) => unknown;
    onMounted: (fn: () => void) => void;
    onUnmounted: (fn: () => void) => void;
    nextTick: (fn?: () => void) => Promise<void>;
  };
  storage: {
    get: <T>(key: string, fallback: T) => T;
    set: (key: string, value: unknown) => void;
    remove: (key: string) => void;
  };
  db: {
    ensureTable: (table: string, columns: Array<{ name: string; type: 'text' | 'integer' | 'real' | 'json'; indexed?: boolean }>) => Promise<void>;
    insert: (table: string, row: Record<string, unknown>) => Promise<number>;
    select: <T>(table: string, options?: { where?: Record<string, unknown>; orderBy?: { column: string; desc?: boolean }; limit?: number; offset?: number }) => Promise<Array<T & { id: number; createdAt: number; updatedAt: number }>>;
    update: (table: string, id: number, patch: Record<string, unknown>) => Promise<void>;
    remove: (table: string, id: number) => Promise<void>;
    count: (table: string, where?: Record<string, unknown>) => Promise<number>;
    clear: (table: string) => Promise<void>;
  };
  settings: {
    values: Record<string, unknown>;
    get: <T>(key: string, fallback: T) => T;
    set: (key: string, value: unknown) => void;
    reset: () => void;
  };
  sidebar: { add: (options: Record<string, unknown>) => unknown };
  header: { add: (options: Record<string, unknown>) => unknown };
  menu: { add: (options: Record<string, unknown>) => unknown };
  router: { add: (options: Record<string, unknown>) => unknown };
  dock: { add: (options: Record<string, unknown>) => unknown };
  command: { add: (options: Record<string, unknown>) => unknown };
  stockRow: { add: (options: Record<string, unknown>) => unknown };
  stockDetail: { add: (options: Record<string, unknown>) => unknown };
  agent: { addServer: (options: Record<string, unknown>) => unknown };
  effect: (fn: () => void | (() => void)) => unknown;
  onDispose: (fn: () => void) => void;
  provide: (name: string, impl: unknown) => void;
  consume: <T>(name: string) => T | undefined;
  on: (name: string, handler: (...args: never[]) => void) => unknown;
  emit: (name: string, ...args: unknown[]) => void;
}
```

---

## 13. 排障对照表

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 安装时报「第 N 行：不能写 import」 | 预检拦下了 | 删掉 import，能力从 `ctx` / `app:*` 服务上取 |
| 安装时报「不能用 template 字符串」 | 生产构建没有模板编译器 | 改成 `render: () => h(...)` |
| 粘贴 JSX 后报语法错误 / 报「不能写 import」 | JSX 也要编译，而且 Vue JSX 插件默认产物带 import | 本地预编译成 `h()` 产物再装（第 8.1 节） |
| 选 zip 包报「无法解压」 / 「zip 包内没有可用文件」 | 不是 zip 或包里只有系统噪音文件（`.DS_Store`、`__MACOSX`） | 重新打包：只放 manifest / 产物 / README |
| 报「包内没有 .js 产物」 / 「包内有多个 js 文件」 | 入口不叫 `main.js`，且清单没写 `entry` | `manifest.json` 里加 `"entry": "dist/index.js"` |
| 报「清单 id / 版本与产物不一致」 | 改了代码没同步 `manifest.json` | 两边对齐后重新打包（宿主不会静默取一边） |
| 装上了但面板一片空白 | `render` 返回了 `undefined` / 抛错 | 看控制台 `[plugin] <id>` 开头的日志；先返回一个纯文本 `h('div', 'hi')` 二分定位 |
| 样式全没了 / 布局是散的 | 自定义 Tailwind 类产物 CSS 里没有 | 改用 `app:ui` 组件或内联 `style` |
| 按钮点了没反应 | 事件名写成了 `@click` | 渲染函数里是 `onClick` |
| 输入框打字没反应 | 只传了 `modelValue` | 必须同时传 `'onUpdate:modelValue'` |
| 面板折叠后定时任务停了 | 任务写在面板组件里 | 移到 `apply` 里，用 `ctx.effect` 登记清理 |
| 重启后数据没了 | 用了组件内的 ref（内存） | 持久化走 `ctx.storage` / `ctx.db` |
| `consume` 返回 undefined | 提供方插件被停用 | 判空降级，或用 `inject` 声明依赖 |
| 请求被拒 | 域名不在白名单 | 先 `app:http.isAllowed(url)` 自检；需要新源提 issue |
| 上游突然 403 / 连不上 | 东财高频会封 IP | 并发 ≤ 3、同上游留 500 ms、重接口点击触发不轮询 |

---

## 14. 兼容承诺与反馈

- **契约层（`ctx.*` 全部成员、十六个宿主服务、六个内置事件）在主版本号内保证向后兼容**；
  要改形态宿主会同步本文件与 `PLUGIN_API.md`；
- 插件之间互相提供的服务（如 `note:repo`）由提供方插件负责，**消费方必须允许缺席**；
- 宿主内部模块（`@/api/*`、`@/utils/*`、`@/components/ui/*`…）对第三方不可用，改名不另行通知；
- 发现文档与实现不一致、或者某个能力卡住了你的插件（例如需要更重的 UI 组件、需要带退避的调度器），
  直接提 issue 说明「我要做什么 + 卡在哪」。宿主补一个服务 / 一个组件句柄的成本很低。

