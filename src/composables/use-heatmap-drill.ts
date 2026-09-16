import { ref } from 'vue';
import { fetchIndustryConstituents } from '../api/board.api';
import { HEATMAP_DRILL_STOCK_COUNT } from '../constants/heatmap.constants';
import type { HeatmapBoard } from '../types/board.types';
import type { HeatmapDrillView } from '../types/heatmap.types';

/**
 * 板块下钻状态机：板块层 ⇄ 成分股层，供热力图 / 列表两种展示形式共用
 *
 * 成分股为重接口（东财系），一律由用户点击触发、不做轮询；
 * 拉取结果统一过滤无效值、按成交额降序截取 Top N，热力图与列表消费同一份数据
 * @returns drillView 下钻视图状态；drillTarget 本次下钻目标（拉取中即有值）；isDrillLoading 拉取中；drillError 失败板块名；drillInto 下钻；backToBoards 返回板块层
 */
export const useHeatmapDrill = () => {
  /** 当前下钻视图（null 表示板块总览层） */
  const drillView = ref<HeatmapDrillView | null>(null);

  /** 本次下钻目标板块（点击即赋值，供拉取中/失败时展示板块名） */
  const drillTarget = ref<Pick<HeatmapBoard, 'code' | 'name'> | null>(null);

  /** 成分股拉取中 */
  const isDrillLoading = ref(false);

  /** 成分股拉取失败的板块名（展示重试提示） */
  const drillError = ref<string | null>(null);

  /**
   * 下钻拉取成分股（loading 互斥，防重复触发）
   * @param board 下钻目标板块（仅需 code + name 标识）
   */
  const drillInto = async (board: Pick<HeatmapBoard, 'code' | 'name'>): Promise<void> => {
    if (isDrillLoading.value) {
      return;
    }
    isDrillLoading.value = true;
    drillError.value = null;
    drillTarget.value = board;
    try {
      const constituents = await fetchIndustryConstituents(board.code);
      drillView.value = {
        board,
        constituents: constituents
          .filter((item) => item.changePercent !== null && (item.amount ?? 0) > 0)
          .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
          .slice(0, HEATMAP_DRILL_STOCK_COUNT),
      };
    } catch (error) {
      console.error('[heatmap-drill]', error);
      drillError.value = board.name;
    } finally {
      isDrillLoading.value = false;
    }
  };

  /** 返回板块总览层 */
  const backToBoards = (): void => {
    drillView.value = null;
    drillError.value = null;
    drillTarget.value = null;
  };

  return { drillView, drillTarget, isDrillLoading, drillError, drillInto, backToBoards };
};
