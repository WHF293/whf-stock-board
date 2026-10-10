/**
 * 新股次新股条目（同花顺新股频道「新股申购与上市」清单行）
 *
 * 数值字段上游以「-」表示缺失，统一归一化为 null；
 * 日期字段上游只给「MM-DD」（无年份），由解析层按「距今天最近的年份」推断补全为 YYYY-MM-DD
 */
export interface IpoBoardItem {
  /** 股票代码（6 位数字） */
  code: string;
  /** 股票简称 */
  name: string;
  /** 申购代码 */
  applyCode: string;
  /** 发行总数（万股） */
  totalIssueWan: number | null;
  /** 网上发行（万股） */
  onlineIssueWan: number | null;
  /** 申购上限（万股） */
  applyCapWan: number | null;
  /** 顶格申购需配市值（万元） */
  topApplyNeedWan: number | null;
  /** 发行价格（元） */
  issuePrice: number | null;
  /** 发行市盈率 */
  issuePe: number | null;
  /** 行业市盈率 */
  industryPe: number | null;
  /** 申购日期（YYYY-MM-DD） */
  applyDate: string;
  /** 中签率（%） */
  lotteryRate: number | null;
  /** 中签缴款日期（YYYY-MM-DD；未公布为空串） */
  paymentDate: string;
  /** 上市日期（YYYY-MM-DD；未上市为空串） */
  listDate: string;
  /** 打新收益（元） */
  earn: number | null;
  /** 首日最高涨幅（%） */
  firstDayMaxRise: number | null;
  /** 连板天数 */
  limitUpDays: number | null;
}
