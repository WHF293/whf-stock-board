/**
 * 内置 MCP Apps（MCP Apps 规范的 `text/html;profile=mcp-app` 单文件 HTML）
 *
 * 这些 HTML 在**沙箱 iframe** 内运行（`sandbox="allow-scripts"`，不给
 * allow-same-origin），与宿主之间只经 `postMessage` 通道通信，实现 MCP Apps
 * 规范的以下子集（宿主侧见 `components/agent/McpAppHost.vue`）：
 *
 * App → 宿主：`ui/initialize`（请求）、`ui/notifications/initialized`、
 *             `ui/notifications/size-changed`、`tools/call`、`ui/open-link`、
 *             `ui/message`
 * 宿主 → App：`ui/initialize` 响应、`ui/notifications/tool-input`、
 *             `ui/notifications/tool-result`、`ui/notifications/host-context-changed`
 *
 * 硬约束（沙箱与可移植性）：
 * - 单文件、零外部依赖（不引 CDN/字体/图片），否则离线与 CSP 下会白屏；
 * - 源码里**不能出现反引号与 `${`**（本文件整体是 TS 模板字符串）；
 * - 主题 / 涨跌配色由宿主经 hostContext 下发，App 不自己读 localStorage
 *   （iframes 是无来源沙箱，读不到也不该读）。
 */
import type { TrendTheme } from '../../constants/trend-theme.constants';

/**
 * MCP Apps 协议版本（宿主侧为**宽容策略**：第三方 App 声明什么就回显什么，
 * 仅用于握手记录，不因版本不同拒绝渲染）
 */
export const MCP_APP_PROTOCOL_VERSION = '2026-01-26';

/** 宿主上下文（主题与涨跌配色，随 initialize 响应 / host-context-changed 下发） */
export interface McpHostContext {
  /** 明暗：dark / light */
  theme: 'dark' | 'light';
  /** 涨跌配色（与本应用 settings.trendTheme 同枚举，App 直接用 data-trend 选择器取色） */
  trend: TrendTheme;
}

/** 全部 App 共用的协议桥（含 hostContext 应用、尺寸上报、反向调用） */
const BRIDGE_JS = `
(function () {
  var pending = {};
  var seq = 0;
  var hostContext = { theme: 'dark', trend: 'red_up' };
  var initialized = false;
  function post(message) { parent.postMessage(message, '*'); }
  function request(method, params) {
    var id = 'app-' + (++seq);
    post({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    return new Promise(function (resolve) { pending[id] = resolve; });
  }
  function notify(method, params) { post({ jsonrpc: '2.0', method: method, params: params || {} }); }
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', hostContext.theme);
    document.documentElement.setAttribute('data-trend', hostContext.trend);
  }
  function reportSize() {
    var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    notify('ui/notifications/size-changed', { width: document.body.clientWidth, height: h });
  }
  function setContext(next) {
    if (!next) return;
    if (next.theme) hostContext.theme = next.theme;
    if (next.trend) hostContext.trend = next.trend;
    applyTheme();
  }
  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      var resolver = pending[message.id];
      if (resolver) {
        delete pending[message.id];
        resolver(message.error ? { error: message.error } : (message.result || {}));
      }
      return;
    }
    var params = message.params || {};
    if (message.method === 'ui/notifications/host-context-changed') { setContext(params.hostContext); return; }
    if (message.method === 'ui/notifications/tool-input') { setContext(params.hostContext); return; }
    if (message.method === 'ui/notifications/tool-result') {
      setContext(params.hostContext);
      var payload = params.structuredContent;
      if (payload && window.__render) window.__render(payload, params.isError === true);
      reportSize();
    }
  });
  window.addEventListener('resize', reportSize);
  window.__mcpApp = {
    request: request,
    notify: notify,
    reportSize: reportSize,
    callTool: function (name, args) { return request('tools/call', { name: name, arguments: args || {} }); },
    openLink: function (url) { return request('ui/open-link', { url: url }); },
    sendMessage: function (text) { return request('ui/message', { role: 'user', content: [{ type: 'text', text: text }] }); }
  };
  applyTheme();
  request('ui/initialize', {
    protocolVersion: '${MCP_APP_PROTOCOL_VERSION}',
    appInfo: { name: 'whf-stock-board-app', version: '1.0.0' },
    appCapabilities: { tools: { listChanged: false } }
  }).then(function (result) {
    initialized = true;
    setContext(result && result.hostContext);
    notify('ui/notifications/initialized', {});
    reportSize();
  });
})();
`;

/** 共用样式：主题变量 + 涨跌配色变量 + 基础排版（跟随宿主主题） */
const APP_CSS = `
:root {
  --bg: #ffffff; --panel: #f7f8fa; --text: #1f2328; --muted: #6b7280; --line: #e5e7eb;
  --up: #ef4444; --down: #22c55e; --accent: #3b82f6;
}
:root[data-theme='dark'] {
  --bg: #16181d; --panel: #1d2027; --text: #e6e8eb; --muted: #9aa1ab; --line: #2c3038;
}
:root[data-trend='green_up'] { --up: #22c55e; --down: #ef4444; }
:root[data-trend='blue_down'] { --up: #ef4444; --down: #3b82f6; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
body {
  padding: 10px 12px; color: var(--text); background: transparent;
  font: 12px/1.5 -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
.head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.head .title { font-size: 13px; font-weight: 500; }
.head .sub { color: var(--muted); font-size: 11px; }
.head .spacer { flex: 1; }
.readout { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 5px 8px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 400; font-size: 11px; text-align: right; }
th:first-child, td:first-child { text-align: left; }
tbody tr:hover { background: var(--panel); }
.code { cursor: pointer; color: var(--accent); }
.mini {
  border: 1px solid var(--line); background: transparent; color: var(--muted);
  border-radius: 5px; padding: 1px 6px; font-size: 11px; cursor: pointer; margin-left: 6px;
}
.mini:hover { color: var(--accent); border-color: var(--accent); }
.up { color: var(--up); }
.down { color: var(--down); }
.flat { color: var(--muted); }
.empty { color: var(--muted); padding: 12px 0; }
svg { display: block; width: 100%; }
.grid { stroke: var(--line); stroke-width: 0.5; }
.axis { fill: var(--muted); font-size: 10px; }
.foot { margin-top: 6px; color: var(--muted); font-size: 10px; }
`;

/**
 * 组装单文件 HTML（App 的 render 实现与样式由调用方给出）
 * @param config 组装配置
 * @param config.body 静态骨架 HTML
 * @param config.renderJs App 渲染脚本（须定义 window.__render）
 * @returns 完整 HTML 文档
 */
const buildAppHtml = (config: { body: string; renderJs: string }): string =>
  '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
  APP_CSS +
  '</style></head><body>' +
  config.body +
  '<script>' +
  BRIDGE_JS +
  config.renderJs +
  '</scr' +
  'ipt></body></html>';

/** 行情表 App：批量行情快照（get_quotes 的 UI） */
export const QUOTE_TABLE_APP: { uri: string; name: string; html: string } = {
  uri: 'ui://stock-sdk/quote-table',
  name: '行情快照表',
  html: buildAppHtml({
    body:
      '<div class="head"><span class="title">行情快照</span>' +
      '<span class="sub" id="sub"></span><span class="spacer"></span>' +
      '<span class="readout" id="readout"></span></div>' +
      '<div id="table"></div>' +
      '<div class="foot" id="foot"></div>',
    renderJs: `
function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function cls(change) { return change > 0 ? 'up' : change < 0 ? 'down' : 'flat'; }
function num(value, digits) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return Number(value).toFixed(digits === undefined ? 2 : digits);
}
window.__render = function (payload) {
  var rows = (payload && payload.rows) || [];
  document.getElementById('sub').textContent = rows.length ? rows.length + ' 只' : '';
  document.getElementById('readout').textContent = (payload && payload.asOf) || '';
  document.getElementById('foot').textContent = '点击代码可与 Agent 对话 · 数据仅作信息参考，不构成投资建议';
  if (!rows.length) { document.getElementById('table').innerHTML = '<div class="empty">无行情数据</div>'; return; }
  var head = '<thead><tr><th>名称</th><th>现价</th><th>涨跌幅</th><th>今开</th><th>最高</th><th>最低</th>' +
    '<th>昨收</th><th>成交额(万)</th><th>换手率</th></tr></thead>';
  var body = rows.map(function (row) {
    var change = Number(row.changePercent) || 0;
    var tone = cls(change);
    var sign = change > 0 ? '+' : '';
    return '<tr>' +
      '<td><span class="code" data-code="' + esc(row.code) + '" data-name="' + esc(row.name) + '">' +
      esc(row.name) + '</span> ' + esc(row.code) +
      '<button class="mini" data-kline="' + esc(row.code) + '">K线</button></td>' +
      '<td class="' + tone + '">' + num(row.price) + '</td>' +
      '<td class="' + tone + '">' + sign + num(change) + '%</td>' +
      '<td>' + num(row.open) + '</td><td>' + num(row.high) + '</td><td>' + num(row.low) + '</td>' +
      '<td>' + num(row.prevClose) + '</td><td>' + num(row.amount, 0) + '</td>' +
      '<td>' + (row.turnoverRate === null || row.turnoverRate === undefined ? '-' : num(row.turnoverRate) + '%') + '</td>' +
      '</tr>';
  }).join('');
  document.getElementById('table').innerHTML = '<table>' + head + '<tbody>' + body + '</tbody></table>';
  Array.prototype.forEach.call(document.querySelectorAll('[data-code]'), function (cell) {
    cell.addEventListener('click', function () {
      var name = cell.getAttribute('data-name');
      var code = cell.getAttribute('data-code');
      window.__mcpApp.sendMessage('分析 ' + name + '(' + code + ') 的最新走势与资金面');
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-kline]'), function (button) {
    button.addEventListener('click', function () {
      window.__mcpApp.sendMessage('画出 ' + button.getAttribute('data-kline') + ' 最近 60 个交易日的 K 线');
    });
  });
  window.__mcpApp.reportSize();
};
`,
  }),
};

/** 序列图 App：K 线蜡烛图 + 技术指标线（get_kline / calc_indicator 的 UI） */
export const SERIES_CHART_APP: { uri: string; name: string; html: string } = {
  uri: 'ui://stock-sdk/series-chart',
  name: '行情图',
  html: buildAppHtml({
    body:
      '<div class="head"><span class="title" id="title">行情图</span>' +
      '<span class="sub" id="sub"></span><span class="spacer"></span>' +
      '<span class="readout" id="readout"></span></div>' +
      '<div id="chart"></div>' +
      '<div class="foot" id="foot">不复权数据 · 仅作信息参考，不构成投资建议</div>',
    renderJs: `
var CHART_W = 620;
var view = { series: [], bars: [], rows: [], mode: 'kline', hover: -1 };
function escHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function colorOf(key, index) {
  var palette = ['var(--accent)', '#e6a23c', '#a855f7', '#0ea5e9', '#f472b6'];
  return palette[index % palette.length];
}
function toneClass(delta) { return delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'; }
function fmt(value, digits) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return Number(value).toFixed(digits === undefined ? 2 : digits);
}
function buildKline() {
  var bars = view.bars;
  if (!bars.length) return '<div class="empty">无 K 线数据</div>';
  var padL = 42, padR = 8, padT = 8, gap = 14, priceH = 190, volH = 52;
  var height = padT + priceH + gap + volH + 20;
  var plotW = CHART_W - padL - padR;
  var step = plotW / bars.length;
  var highs = bars.map(function (b) { return b.high; });
  var lows = bars.map(function (b) { return b.low; });
  var top = Math.max.apply(null, highs), bottom = Math.min.apply(null, lows);
  var span = top - bottom || 1;
  var maxVol = Math.max.apply(null, bars.map(function (b) { return b.volume || 0; })) || 1;
  function y(value) { return padT + priceH - ((value - bottom) / span) * priceH; }
  var parts = [];
  for (var g = 0; g <= 4; g += 1) {
    var gy = padT + (priceH / 4) * g;
    var gv = top - (span / 4) * g;
    parts.push('<line class="grid" x1="' + padL + '" y1="' + gy + '" x2="' + (CHART_W - padR) + '" y2="' + gy + '"/>');
    parts.push('<text class="axis" x="' + (padL - 6) + '" y="' + (gy + 3) + '" text-anchor="end">' + fmt(gv) + '</text>');
  }
  var upColor = 'var(--up)';
  var downColor = 'var(--down)';
  bars.forEach(function (bar, index) {
    var cx = padL + step * (index + 0.5);
    var rising = bar.close >= bar.open;
    var color = rising ? upColor : downColor;
    var bodyTop = y(Math.max(bar.open, bar.close));
    var bodyBottom = y(Math.min(bar.open, bar.close));
    var bodyH = Math.max(1, bodyBottom - bodyTop);
    var w = Math.max(1.5, Math.min(step * 0.62, 12));
    parts.push('<line x1="' + cx + '" y1="' + y(bar.high) + '" x2="' + cx + '" y2="' + y(bar.low) + '" stroke="' + color + '" stroke-width="1"/>');
    parts.push('<rect x="' + (cx - w / 2) + '" y="' + bodyTop + '" width="' + w + '" height="' + bodyH + '" fill="' + color + '" opacity="0.9"/>');
    var vh = ((bar.volume || 0) / maxVol) * volH;
    parts.push('<rect x="' + (cx - w / 2) + '" y="' + (padT + priceH + gap + volH - vh) + '" width="' + w + '" height="' + vh + '" fill="' + color + '" opacity="0.45"/>');
  });
  [0, Math.floor(bars.length / 2), bars.length - 1].forEach(function (index) {
    var bar = bars[index];
    if (!bar) return;
    parts.push('<text class="axis" x="' + (padL + step * (index + 0.5)) + '" y="' + (height - 4) + '" text-anchor="middle">' + escHtml(bar.date) + '</text>');
  });
  parts.push('<line class="grid" x1="' + padL + '" y1="' + (padT + priceH + gap + volH) + '" x2="' + (CHART_W - padR) + '" y2="' + (padT + priceH + gap + volH) + '"/>');
  return '<svg viewBox="0 0 ' + CHART_W + ' ' + height + '" height="' + height + '">' + parts.join('') + '</svg>';
}
function buildIndicator() {
  var rows = view.rows;
  if (!rows.length) return '<div class="empty">无指标数据</div>';
  var series = view.series || [];
  var padL = 42, padR = 8, padT = 8, padB = 18;
  var height = 200;
  var plotW = CHART_W - padL - padR;
  var plotH = height - padT - padB;
  var values = [];
  rows.forEach(function (row) {
    series.forEach(function (item) {
      var value = row[item.key];
      if (typeof value === 'number' && !isNaN(value)) values.push(value);
    });
  });
  if (!values.length) return '<div class="empty">无指标数据</div>';
  var top = Math.max.apply(null, values);
  var bottom = Math.min.apply(null, values);
  var span = top - bottom || 1;
  var step = plotW / rows.length;
  function y(value) { return padT + plotH - ((value - bottom) / span) * plotH; }
  var parts = [];
  for (var g = 0; g <= 4; g += 1) {
    var gy = padT + (plotH / 4) * g;
    var gv = top - (span / 4) * g;
    parts.push('<line class="grid" x1="' + padL + '" y1="' + gy + '" x2="' + (CHART_W - padR) + '" y2="' + gy + '"/>');
    parts.push('<text class="axis" x="' + (padL - 6) + '" y="' + (gy + 3) + '" text-anchor="end">' + fmt(gv, 1) + '</text>');
  }
  series.forEach(function (item, sindex) {
    var color = item.color || colorOf(item.key, sindex);
    if (item.kind === 'bar') {
      var zero = y(0);
      rows.forEach(function (row, index) {
        var value = row[item.key];
        if (typeof value !== 'number' || isNaN(value)) return;
        var cx = padL + step * (index + 0.5);
        var barTop = value >= 0 ? y(value) : zero;
        var barH = Math.max(0.5, Math.abs(y(value) - zero));
        parts.push('<rect x="' + (cx - Math.max(1, step * 0.3)) + '" y="' + barTop + '" width="' + Math.max(2, step * 0.6) + '" height="' + barH + '" fill="' + color + '" opacity="0.7"/>');
      });
      return;
    }
    var path = [];
    rows.forEach(function (row, index) {
      var value = row[item.key];
      if (typeof value !== 'number' || isNaN(value)) return;
      var cx = padL + step * (index + 0.5);
      path.push((path.length ? 'L' : 'M') + cx.toFixed(1) + ' ' + y(value).toFixed(1));
    });
    if (path.length) parts.push('<path d="' + path.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.2"/>');
  });
  [0, rows.length - 1].forEach(function (index) {
    var row = rows[index];
    if (!row) return;
    parts.push('<text class="axis" x="' + (padL + step * (index + 0.5)) + '" y="' + (height - 4) + '" text-anchor="' + (index === 0 ? 'start' : 'end') + '">' + escHtml(row.date) + '</text>');
  });
  return '<svg viewBox="0 0 ' + CHART_W + ' ' + height + '" height="' + height + '">' + parts.join('') + '</svg>';
}
function legend() {
  var items = view.mode === 'kline'
    ? [{ label: '开/收/高/低', color: 'var(--text)' }, { label: '成交量', color: 'var(--muted)' }]
    : (view.series || []).map(function (item, index) {
      return { label: item.label || item.key, color: item.color || colorOf(item.key, index) };
    });
  return items.map(function (item) {
    return '<span style="margin-right:10px"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' +
      item.color + ';margin-right:4px"></span>' + escHtml(item.label) + '</span>';
  }).join('');
}
function readoutAt(index) {
  if (view.mode === 'kline') {
    var bar = view.bars[index];
    if (!bar) return '';
    var delta = bar.close - bar.open;
    return escHtml(bar.date) + ' 开' + fmt(bar.open) + ' 高' + fmt(bar.high) + ' 低' + fmt(bar.low) +
      ' 收<span class="' + toneClass(delta) + '">' + fmt(bar.close) + '</span>';
  }
  var row = view.rows[index];
  if (!row) return '';
  return escHtml(row.date) + ' ' + (view.series || []).map(function (item) {
    return escHtml(item.label || item.key) + ' ' + fmt(row[item.key]);
  }).join(' ');
}
window.__render = function (payload) {
  if (!payload || payload.kind !== 'series-chart') return;
  view.mode = payload.mode === 'kline' ? 'kline' : 'indicator';
  view.bars = payload.bars || [];
  view.rows = payload.rows || [];
  view.series = payload.series || [];
  document.getElementById('title').textContent = payload.title || '行情图';
  document.getElementById('sub').textContent = payload.subtitle || '';
  document.getElementById('foot').textContent = (payload.note || '不复权数据') + ' · 仅作信息参考，不构成投资建议';
  var count = view.mode === 'kline' ? view.bars.length : view.rows.length;
  var last = count - 1;
  var output = view.mode === 'kline' ? buildKline() : buildIndicator();
  document.getElementById('chart').innerHTML =
    '<div class="readout" style="margin-bottom:4px">' + legend() + '</div>' + output;
  document.getElementById('readout').innerHTML = readoutAt(last);
  var svg = document.querySelector('#chart svg');
  if (svg) {
    svg.addEventListener('mousemove', function (event) {
      var rect = svg.getBoundingClientRect();
      var ratio = (event.clientX - rect.left) / rect.width;
      var index = Math.min(count - 1, Math.max(0, Math.floor(ratio * count)));
      if (index === view.hover) return;
      view.hover = index;
      document.getElementById('readout').innerHTML = readoutAt(index);
    });
    svg.addEventListener('mouseleave', function () {
      view.hover = -1;
      document.getElementById('readout').innerHTML = readoutAt(last);
    });
  }
  window.__mcpApp.reportSize();
};
`,
  }),
};
