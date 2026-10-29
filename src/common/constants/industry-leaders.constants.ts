/**
 * 行业龙头（板块 / 细分赛道前五）静态清单
 *
 * 内容单源：`.ai/项目资源/板块龙头.md`（王总 2026-10-29 提供），前端硬编码维护；
 * 只收录给出代码的标的（未上市或未给代码的不入清单），港股以 `hk01801` 形态参与报价
 * （经 `sdk.quotes.hk` 单独补齐）。分组不可被用户修改（需求明确：不可改个股分组）。
 */

/** 龙头分组维度 */
export const LEADER_KIND = {
  /** 申万口径大板块龙头 */
  BOARD: 'board',
  /** 细分赛道龙头 */
  SEGMENT: 'segment',
} as const satisfies Record<string, string>;

/** 龙头分组维度类型 */
export type LeaderKind = (typeof LEADER_KIND)[keyof typeof LEADER_KIND];

/** 维度切换选项（BaseTabs） */
export const LEADER_KIND_OPTIONS: readonly { label: string; value: LeaderKind }[] = [
  { label: '板块', value: LEADER_KIND.BOARD },
  { label: '细分赛道', value: LEADER_KIND.SEGMENT },
];

/** 龙头标的条目 */
export interface LeaderStock {
  /** 完整符号（sh600519 / sz300274 / bj872808 / hk01801） */
  symbol: string;
  /** 股票名称（上游报价成功后以报价名为准） */
  name: string;
}

/** 龙头分组 */
export interface LeaderGroup {
  /** 分组名（板块名 / 赛道名） */
  name: string;
  /** 组内标的（按需求稿排序，前五） */
  stocks: LeaderStock[];
}

/** 板块维度龙头分组（22 组） */
export const LEADER_BOARD_GROUPS: readonly LeaderGroup[] = [
  {
    name: '食品饮料',
    stocks: [
      { symbol: 'sh600519', name: '贵州茅台' },
      { symbol: 'sz000858', name: '五粮液' },
      { symbol: 'sz000568', name: '泸州老窖' },
      { symbol: 'sh600809', name: '山西汾酒' },
      { symbol: 'sh600887', name: '伊利股份' },
    ],
  },
  {
    name: '电力设备',
    stocks: [
      { symbol: 'sz300750', name: '宁德时代' },
      { symbol: 'sz300274', name: '阳光电源' },
      { symbol: 'sh601012', name: '隆基绿能' },
      { symbol: 'sz300014', name: '亿纬锂能' },
      { symbol: 'sh600438', name: '通威股份' },
    ],
  },
  {
    name: '汽车',
    stocks: [
      { symbol: 'sz002594', name: '比亚迪' },
      { symbol: 'sz000625', name: '长安汽车' },
      { symbol: 'sh600104', name: '上汽集团' },
      { symbol: 'sh601127', name: '赛力斯' },
      { symbol: 'hk00175', name: '吉利汽车' },
    ],
  },
  {
    name: '医药生物',
    stocks: [
      { symbol: 'sz300760', name: '迈瑞医疗' },
      { symbol: 'sh600276', name: '恒瑞医药' },
      { symbol: 'sh603259', name: '药明康德' },
      { symbol: 'sz300015', name: '爱尔眼科' },
      { symbol: 'sh600436', name: '片仔癀' },
    ],
  },
  {
    name: '电子',
    stocks: [
      { symbol: 'sh601138', name: '工业富联' },
      { symbol: 'sz002475', name: '立讯精密' },
      { symbol: 'sh688041', name: '海光信息' },
      { symbol: 'sh603986', name: '兆易创新' },
      { symbol: 'sz002241', name: '歌尔股份' },
    ],
  },
  {
    name: '半导体',
    stocks: [
      { symbol: 'sh688981', name: '中芯国际' },
      { symbol: 'sz002371', name: '北方华创' },
      { symbol: 'sh688012', name: '中微公司' },
      { symbol: 'sh600584', name: '长电科技' },
      { symbol: 'sh688126', name: '沪硅产业' },
    ],
  },
  {
    name: '通信',
    stocks: [
      { symbol: 'sh600941', name: '中国移动' },
      { symbol: 'sh601728', name: '中国电信' },
      { symbol: 'sz300308', name: '中际旭创' },
      { symbol: 'sz300502', name: '新易盛' },
      { symbol: 'sz300394', name: '天孚通信' },
    ],
  },
  {
    name: '计算机/AI',
    stocks: [
      { symbol: 'sz002415', name: '海康威视' },
      { symbol: 'sz002230', name: '科大讯飞' },
      { symbol: 'sz000977', name: '浪潮信息' },
      { symbol: 'sh600588', name: '用友网络' },
      { symbol: 'sh688111', name: '金山办公' },
    ],
  },
  {
    name: '有色金属',
    stocks: [
      { symbol: 'sh601899', name: '紫金矿业' },
      { symbol: 'sh603993', name: '洛阳钼业' },
      { symbol: 'sh601600', name: '中国铝业' },
      { symbol: 'sz002460', name: '赣锋锂业' },
      { symbol: 'sz002466', name: '天齐锂业' },
    ],
  },
  {
    name: '煤炭',
    stocks: [
      { symbol: 'sh601088', name: '中国神华' },
      { symbol: 'sh601225', name: '陕西煤业' },
      { symbol: 'sh601898', name: '中煤能源' },
      { symbol: 'sh601001', name: '晋控煤业' },
      { symbol: 'sh601699', name: '潞安环能' },
    ],
  },
  {
    name: '石油石化',
    stocks: [
      { symbol: 'sh601857', name: '中国石油' },
      { symbol: 'sh600938', name: '中国海油' },
      { symbol: 'sh600028', name: '中国石化' },
      { symbol: 'sh600346', name: '恒力石化' },
      { symbol: 'sz002493', name: '荣盛石化' },
    ],
  },
  {
    name: '银行',
    stocks: [
      { symbol: 'sh601398', name: '工商银行' },
      { symbol: 'sh601939', name: '建设银行' },
      { symbol: 'sh601288', name: '农业银行' },
      { symbol: 'sh600036', name: '招商银行' },
      { symbol: 'sh601988', name: '中国银行' },
    ],
  },
  {
    name: '非银金融',
    stocks: [
      { symbol: 'sh601318', name: '中国平安' },
      { symbol: 'sh601628', name: '中国人寿' },
      { symbol: 'sh600030', name: '中信证券' },
      { symbol: 'sz300059', name: '东方财富' },
      { symbol: 'sh601601', name: '中国太保' },
    ],
  },
  {
    name: '家电',
    stocks: [
      { symbol: 'sz000333', name: '美的集团' },
      { symbol: 'sz000651', name: '格力电器' },
      { symbol: 'sh600690', name: '海尔智家' },
      { symbol: 'sz002508', name: '老板电器' },
      { symbol: 'sh603486', name: '科沃斯' },
    ],
  },
  {
    name: '农林牧渔',
    stocks: [
      { symbol: 'sz002714', name: '牧原股份' },
      { symbol: 'sz300498', name: '温氏股份' },
      { symbol: 'sz002311', name: '海大集团' },
      { symbol: 'sz000876', name: '新希望' },
      { symbol: 'sz000998', name: '隆平高科' },
    ],
  },
  {
    name: '国防军工',
    stocks: [
      { symbol: 'sh600760', name: '中航沈飞' },
      { symbol: 'sz000768', name: '中航西飞' },
      { symbol: 'sh600893', name: '航发动力' },
      { symbol: 'sh600150', name: '中国船舶' },
      { symbol: 'sz000519', name: '中兵红箭' },
    ],
  },
  {
    name: '基建建筑',
    stocks: [
      { symbol: 'sh601668', name: '中国建筑' },
      { symbol: 'sh601390', name: '中国中铁' },
      { symbol: 'sh601186', name: '中国铁建' },
      { symbol: 'sh601800', name: '中国交建' },
      { symbol: 'sh601669', name: '中国电建' },
    ],
  },
  {
    name: '公用事业',
    stocks: [
      { symbol: 'sh600900', name: '长江电力' },
      { symbol: 'sz003816', name: '中国广核' },
      { symbol: 'sh600011', name: '华能国际' },
      { symbol: 'sh600795', name: '国电电力' },
      { symbol: 'sh600674', name: '川投能源' },
    ],
  },
  {
    name: '基础化工',
    stocks: [
      { symbol: 'sh600309', name: '万华化学' },
      { symbol: 'sz000792', name: '盐湖股份' },
      { symbol: 'sh600426', name: '华鲁恒升' },
      { symbol: 'sh600486', name: '扬农化工' },
      { symbol: 'sh600500', name: '中化国际' },
    ],
  },
  {
    name: '房地产',
    stocks: [
      { symbol: 'sh600048', name: '保利发展' },
      { symbol: 'sz001979', name: '招商蛇口' },
      { symbol: 'sz000002', name: '万科A' },
      { symbol: 'sh601155', name: '新城控股' },
      { symbol: 'sh600383', name: '金地集团' },
    ],
  },
  {
    name: '交通运输',
    stocks: [
      { symbol: 'sh601919', name: '中远海控' },
      { symbol: 'sz002352', name: '顺丰控股' },
      { symbol: 'sh601816', name: '京沪高铁' },
      { symbol: 'sh601006', name: '大秦铁路' },
      { symbol: 'sh600009', name: '上海机场' },
    ],
  },
];

/** 细分赛道维度龙头分组（21 组；未上市标的未收录） */
export const LEADER_SEGMENT_GROUPS: readonly LeaderGroup[] = [
  {
    name: '储能',
    stocks: [
      { symbol: 'sz300274', name: '阳光电源' },
      { symbol: 'sh688063', name: '派能科技' },
      { symbol: 'sz002518', name: '科士达' },
      { symbol: 'sh688390', name: '固德威' },
      { symbol: 'sz300763', name: '锦浪科技' },
    ],
  },
  {
    name: '机器人',
    stocks: [
      { symbol: 'sz300124', name: '汇川技术' },
      { symbol: 'sh688017', name: '绿的谐波' },
      { symbol: 'sz002747', name: '埃斯顿' },
      { symbol: 'sz002527', name: '新时达' },
      { symbol: 'sz002882', name: '中大力德' },
    ],
  },
  {
    name: 'PCB',
    stocks: [
      { symbol: 'sz002463', name: '沪电股份' },
      { symbol: 'sz002916', name: '深南电路' },
      { symbol: 'sh600183', name: '生益科技' },
      { symbol: 'sz002938', name: '鹏鼎控股' },
      { symbol: 'sz300476', name: '胜宏科技' },
    ],
  },
  {
    name: '存储芯片',
    stocks: [
      { symbol: 'sh603986', name: '兆易创新' },
      { symbol: 'sz300223', name: '北京君正' },
      { symbol: 'sz301308', name: '江波龙' },
      { symbol: 'sh688525', name: '佰维存储' },
    ],
  },
  {
    name: 'CXO',
    stocks: [
      { symbol: 'sh603259', name: '药明康德' },
      { symbol: 'sz300759', name: '康龙化成' },
      { symbol: 'sz300347', name: '泰格医药' },
      { symbol: 'sz002821', name: '凯莱英' },
      { symbol: 'sz300363', name: '博腾股份' },
    ],
  },
  {
    name: '算力/AI芯片',
    stocks: [
      { symbol: 'sh688041', name: '海光信息' },
      { symbol: 'sh688256', name: '寒武纪' },
      { symbol: 'sz300474', name: '景嘉微' },
      { symbol: 'sh688047', name: '龙芯中科' },
    ],
  },
  {
    name: '算力光模块',
    stocks: [
      { symbol: 'sz300308', name: '中际旭创' },
      { symbol: 'sz300502', name: '新易盛' },
      { symbol: 'sz300394', name: '天孚通信' },
      { symbol: 'sz000988', name: '华工科技' },
      { symbol: 'sz002281', name: '光迅科技' },
    ],
  },
  {
    name: '风电',
    stocks: [
      { symbol: 'sz002202', name: '金风科技' },
      { symbol: 'sh601615', name: '明阳智能' },
      { symbol: 'sh603606', name: '东方电缆' },
      { symbol: 'sh600458', name: '时代新材' },
      { symbol: 'sz002531', name: '天顺风能' },
    ],
  },
  {
    name: '锂电材料',
    stocks: [
      { symbol: 'sh603659', name: '璞泰来' },
      { symbol: 'sh600884', name: '杉杉股份' },
      { symbol: 'sz300035', name: '中科电气' },
      { symbol: 'sh688005', name: '容百科技' },
      { symbol: 'sz300073', name: '当升科技' },
      { symbol: 'sz300769', name: '德方纳米' },
      { symbol: 'sz002812', name: '恩捷股份' },
      { symbol: 'sz300568', name: '星源材质' },
      { symbol: 'sz002709', name: '天赐材料' },
      { symbol: 'sz300037', name: '新宙邦' },
    ],
  },
  {
    name: '消费电子零部件',
    stocks: [
      { symbol: 'sz002475', name: '立讯精密' },
      { symbol: 'sz002241', name: '歌尔股份' },
      { symbol: 'sz300433', name: '蓝思科技' },
      { symbol: 'sz002600', name: '领益智造' },
      { symbol: 'sh601231', name: '环旭电子' },
    ],
  },
  {
    name: '创新药',
    stocks: [
      { symbol: 'sh600276', name: '恒瑞医药' },
      { symbol: 'sh688235', name: '百济神州' },
      { symbol: 'hk01801', name: '信达生物' },
      { symbol: 'sh688180', name: '君实生物' },
      { symbol: 'sh688331', name: '荣昌生物' },
    ],
  },
  {
    name: '医疗器械',
    stocks: [
      { symbol: 'sh688271', name: '联影医疗' },
      { symbol: 'sz300003', name: '乐普医疗' },
      { symbol: 'sz002223', name: '鱼跃医疗' },
      { symbol: 'sz301033', name: '迈普医学' },
      { symbol: 'sz300633', name: '开立医疗' },
    ],
  },
  {
    name: '医美',
    stocks: [
      { symbol: 'sz300896', name: '爱美客' },
      { symbol: 'sh688363', name: '华熙生物' },
      { symbol: 'sh688366', name: '昊海生科' },
      { symbol: 'sz000963', name: '华东医药' },
      { symbol: 'sz002612', name: '朗姿股份' },
    ],
  },
  {
    name: '养殖配套/动保',
    stocks: [
      { symbol: 'sh600201', name: '生物股份' },
      { symbol: 'sh603718', name: '海利生物' },
      { symbol: 'sz300119', name: '瑞普生物' },
      { symbol: 'sz300871', name: '回盛生物' },
      { symbol: 'sh603566', name: '普莱柯' },
    ],
  },
  {
    name: '纸包装',
    stocks: [
      { symbol: 'hk02689', name: '玖龙纸业' },
      { symbol: 'sh600567', name: '山鹰国际' },
      { symbol: 'sz002078', name: '太阳纸业' },
      { symbol: 'sz002831', name: '裕同科技' },
      { symbol: 'sz000488', name: '晨鸣纸业' },
    ],
  },
  {
    name: '航空零部件',
    stocks: [
      { symbol: 'sh600760', name: '中航沈飞' },
      { symbol: 'sh600893', name: '航发动力' },
      { symbol: 'sz002179', name: '中航光电' },
      { symbol: 'sh600765', name: '中航重机' },
      { symbol: 'sz300775', name: '三角防务' },
    ],
  },
  {
    name: '特高压',
    stocks: [
      { symbol: 'sh600406', name: '国电南瑞' },
      { symbol: 'sz000400', name: '许继电气' },
      { symbol: 'sh600312', name: '平高电气' },
      { symbol: 'sh600089', name: '特变电工' },
      { symbol: 'sz002028', name: '思源电气' },
    ],
  },
  {
    name: '培育钻石',
    stocks: [
      { symbol: 'sz000519', name: '中兵红箭' },
      { symbol: 'sz301071', name: '力量钻石' },
      { symbol: 'sh600172', name: '黄河旋风' },
      { symbol: 'sz300179', name: '四方达' },
      { symbol: 'sh688028', name: '沃尔德' },
    ],
  },
  {
    name: '航运细分',
    stocks: [
      { symbol: 'sh600026', name: '中远海能' },
      { symbol: 'sh601872', name: '招商轮船' },
      { symbol: 'sh601919', name: '中远海控' },
      { symbol: 'sh601866', name: '中远海发' },
    ],
  },
  {
    name: '算力液冷',
    stocks: [
      { symbol: 'sz002837', name: '英维克' },
      { symbol: 'bj872808', name: '曙光数创' },
      { symbol: 'sz300499', name: '高澜股份' },
      { symbol: 'sz300990', name: '同飞股份' },
      { symbol: 'sh603912', name: '佳力图' },
    ],
  },
  {
    name: '算力服务器结构件',
    stocks: [
      { symbol: 'sh601138', name: '工业富联' },
      { symbol: 'hk06088', name: '鸿腾精密' },
      { symbol: 'sz300115', name: '长盈精密' },
      { symbol: 'sh603855', name: '科森科技' },
      { symbol: 'sz301398', name: '铭利达' },
    ],
  },
];

/**
 * 取指定维度的龙头分组列表
 * @param kind 分组维度
 * @returns 分组列表
 */
export const getLeaderGroups = (kind: LeaderKind): readonly LeaderGroup[] =>
  kind === LEADER_KIND.BOARD ? LEADER_BOARD_GROUPS : LEADER_SEGMENT_GROUPS;
