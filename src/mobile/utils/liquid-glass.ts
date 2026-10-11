/**
 * TabBar 液态玻璃折射（SVG feDisplacementMap + backdrop-filter 引用滤镜）
 *
 * 算法与参数移植自 shuding/liquid-glass（掘金《HTML + CSS 实现 Liquid Glass 液态玻璃效果》方案三）：
 * Canvas 按「圆角矩形 SDF」逐像素计算折射位移并编码为置换图（R = dx、G = dy，0.5 灰为零点），
 * 经 feImage + feDisplacementMap 组成 SVG 滤镜；元素以 `backdrop-filter: url(#id)` 引用后，
 * 背景在边缘环带产生折射变形、中间区域零位移（这正是「液态玻璃」区别于普通磨砂的关键）。
 *
 * 兼容：`backdrop-filter` 引用 SVG 滤镜仅 Chromium 系支持（Android WebView ✓，iOS Safari ✗）；
 * 用 CSS.supports 探测，不支持时 attach 返回 null，调用方保持现有磨砂玻璃回退，视觉不劣化。
 */
import {
  MOBILE_TAB_GLASS_RESIZE_DEBOUNCE_MS,
  MOBILE_TAB_GLASS_STRENGTH,
  MOBILE_TAB_GLASS_RIM,
} from '../constants';

/** 液态玻璃挂载句柄：销毁滤镜与事件监听 */
export interface LiquidGlassHandle {
  destroy: () => void;
}

/* ---- SDF 与位移的算法常数（口径与 shuding/liquid-glass 对齐，勿单独改动其一） ---- */

/** 胶囊半宽占比（元素中心坐标系） */
const SDF_HALF_WIDTH = 0.42;

/** 胶囊半高占比 */
const SDF_HALF_HEIGHT = 0.38;

/** 圆角半径占比（≥ 0.5 会被 clamp 成全胶囊，与 TabBar 的 999px 圆角一致） */
const SDF_RADIUS = 0.5;

/** smoothStep 边界上界（原版口径） */
const SMOOTH_STEP_EDGE = 0.8;

/** 元素 CSS class：挂载成功后标记，CSS 侧据此切换到折射档玻璃 */
const LIQUID_CLASS = 'm-tabbar--liquid';

/**
 * smoothStep：a、b 之间的平滑 0→1 过渡（原版口径）
 * @param a 下边界
 * @param b 上边界
 * @param t 输入值
 * @returns 0~1 的平滑权重
 */
function smoothStep(a: number, b: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * 圆角矩形有向距离函数（到边缘的带符号距离，负值在内部）
 * @param x 点 x（相对中心，-0.5~0.5）
 * @param y 点 y（相对中心）
 * @param halfWidth 半宽
 * @param halfHeight 半高
 * @param radius 圆角半径
 * @returns 带符号距离
 */
function roundedRectSdf(x: number, y: number, halfWidth: number, halfHeight: number, radius: number): number {
  const qx = Math.abs(x) - halfWidth + radius;
  const qy = Math.abs(y) - halfHeight + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

/**
 * 为元素生成并挂载液态玻璃折射滤镜
 * @param target 目标元素（TabBar 胶囊容器）
 * @returns 挂载句柄；环境不支持（非 Chromium 系 backdrop-filter）或元素尺寸为 0 时返回 null
 */
export function attachLiquidGlass(target: HTMLElement): LiquidGlassHandle | null {
  // backdrop-filter 引用 SVG 滤镜的语法接受度探测：Safari / Firefox 不认，回退磨砂
  if (!CSS.supports('backdrop-filter', 'url(#liquid-glass-probe)')) return null;

  const rect = target.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;

  const filterId = `liquid-glass-${Math.random().toString(36).slice(2, 10)}`;
  const svg = buildFilterSvg(filterId, Math.ceil(rect.width), Math.ceil(rect.height));
  document.body.append(svg);

  target.classList.add(LIQUID_CLASS);
  target.style.setProperty('--liquid-glass-filter', `url(#${filterId})`);

  // 旋转 / 分屏等尺寸变化时重建置换图（防抖；置换图与元素尺寸 1:1）
  let debounceTimer = 0;
  const onResize = (): void => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      const next = target.getBoundingClientRect();
      if (next.width < 1 || next.height < 1) return;
      svg.remove();
      const rebuilt = buildFilterSvg(filterId, Math.ceil(next.width), Math.ceil(next.height));
      document.body.append(rebuilt);
      svg.replaceWith(rebuilt);
    }, MOBILE_TAB_GLASS_RESIZE_DEBOUNCE_MS);
  };
  window.addEventListener('resize', onResize);

  return {
    destroy: () => {
      window.clearTimeout(debounceTimer);
      window.removeEventListener('resize', onResize);
      svg.remove();
      target.classList.remove(LIQUID_CLASS);
      target.style.removeProperty('--liquid-glass-filter');
    },
  };
}

/**
 * 构建滤镜 SVG（feImage 置换图 + feDisplacementMap）并返回挂载节点
 * @param filterId 滤镜 id（也是置换图 feImage 的 id）
 * @param width 元素像素宽
 * @param height 元素像素高
 * @returns svg 节点（0×0，仅承载 defs）
 */
function buildFilterSvg(filterId: string, width: number, height: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', filterId);
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('colorInterpolationFilters', 'sRGB');
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  filter.setAttribute('width', String(width));
  filter.setAttribute('height', String(height));

  const feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
  feImage.setAttribute('id', `${filterId}-map`);
  feImage.setAttribute('width', String(width));
  feImage.setAttribute('height', String(height));
  feImage.setAttribute('href', buildDisplacementMapDataUrl(width, height));

  const feDisplacementMap = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
  feDisplacementMap.setAttribute('in', 'SourceGraphic');
  feDisplacementMap.setAttribute('in2', `${filterId}-map`);
  feDisplacementMap.setAttribute('scale', String(MOBILE_TAB_GLASS_STRENGTH * width * 0.12));
  feDisplacementMap.setAttribute('xChannelSelector', 'R');
  feDisplacementMap.setAttribute('yChannelSelector', 'G');

  filter.append(feImage, feDisplacementMap);
  defs.append(filter);
  svg.append(defs);
  return svg;
}

/**
 * 生成边缘折射置换图（data URL）
 *
 * 逐像素：按圆角矩形 SDF 求「到边缘的距离」，边缘环带内位移向中心收缩（smoothStep 衰减），
 * 位移向量编码为 R/G 通道（0.5 灰 = 零位移）；中间区域恒为 0.5 灰（不变形）。
 * @param width 置换图宽（= 元素宽）
 * @param height 置换图高（= 元素高）
 * @returns `data:image/png;base64,...`
 */
function buildDisplacementMapDataUrl(width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';

  const data = new Uint8ClampedArray(width * height * 4);
  let maxAbsDelta = 0;
  const deltas: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ix = x / width - 0.5;
      const iy = y / height - 0.5;
      const distanceToEdge = roundedRectSdf(ix, iy, SDF_HALF_WIDTH, SDF_HALF_HEIGHT, SDF_RADIUS);
      // 原版口径：从环带外缘（RIM + 0.8 档）平滑衰减到边缘，得到 0→1 的收缩权重
      const displacement = smoothStep(SMOOTH_STEP_EDGE, 0, distanceToEdge - MOBILE_TAB_GLASS_RIM);
      const scaled = smoothStep(0, 1, displacement);
      const dx = (ix * scaled + 0.5) * width - x;
      const dy = (iy * scaled + 0.5) * height - y;
      maxAbsDelta = Math.max(maxAbsDelta, Math.abs(dx), Math.abs(dy));
      deltas.push(dx, dy);
    }
  }

  maxAbsDelta = Math.max(maxAbsDelta * 0.5, 1);
  let index = 0;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = ((deltas[index] ?? 0) / maxAbsDelta + 0.5) * 255;
    data[i + 1] = ((deltas[index + 1] ?? 0) / maxAbsDelta + 0.5) * 255;
    data[i + 2] = 0;
    data[i + 3] = 255;
    index += 2;
  }

  context.putImageData(new ImageData(data, width, height), 0, 0);
  return canvas.toDataURL();
}
