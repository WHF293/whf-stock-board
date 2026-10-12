import { LineChart } from 'echarts/charts';
import {
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { use } from 'echarts/core';

/**
 * 移动端 ECharts 按需注册（独立于 PC 的 echarts-setup，互不影响）
 *
 * 资金流向页只用折线：主力净流入（标注每点 + crosshair）与板块资金多曲线；
 * use() 幂等，与 PC 端注册表并存无副作用
 */
use([
  SVGRenderer,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  AxisPointerComponent,
]);
