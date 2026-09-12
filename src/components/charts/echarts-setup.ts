import { BarChart, CandlestickChart, LineChart, ScatterChart, TreemapChart } from 'echarts/charts';
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { use } from 'echarts/core';

/**
 * ECharts 按需注册（tree-shaking 收敛体积）
 *
 * 全站图表组件统一从本模块引入，保证只注册一次；
 * K 线三区联动依赖 AxisPointer（axisPointer.link），
 * 分时均价线 / 筹码现价线依赖 MarkLine，均已显式注册
 */
use([
  SVGRenderer,
  BarChart,
  LineChart,
  ScatterChart,
  TreemapChart,
  CandlestickChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkPointComponent,
  MarkLineComponent,
  AxisPointerComponent,
]);
