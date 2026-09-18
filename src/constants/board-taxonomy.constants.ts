import { SW_LEVEL1_BOARDS } from './board-calendar.constants';

/**
 * 板块风格大类归类（A股全景 · 行业板块）
 *
 * 背景：A股全景的「行业板块」tab 直接展示东财 `clist` 的 `fs=m:90+t:2` 全量，
 * 上游 `total` 为 **496** 条 —— 但它不是 496 个并列行业，而是
 * **申万行业分类的一级 / 二级 / 三级混排**（申万 2021 版一级 31 个名称精确命中 31/31，
 * 其余 463 条为二级 / 三级细分；上游对 BK1435 / BK1476 各重复返回一次，去重后 494 个）。
 *
 * 归类方法（2026-09-18 实测）：上游**不返回**板块父级字段（板块 clist 的
 * f100/f101/f102 全为 `-`），父子关系由本文件固化。归属靠「成分股集合包含度」离线推断：
 * 以 31 个申万一级板块的成分股集合为锚点（2026-09-18 复测并集 5652 只、跨一级重叠 0 组；
 * 早先一轮误记为 5523 只，是 `fid=f3` 涨跌幅排序分页漂移漏数所致，与上游数据无关），
 * 计算每个板块成分股落在各一级集合内的覆盖率并取最大者 —— 496 条全部命中，
 * 最低覆盖率 80%、次选普遍 0%，无一条需要人工裁决。
 *
 * 层级：494 个板块 → 31 个申万一级（`BOARD_TAXONOMY_GROUPS`）→ 8 个风格大类（`BOARD_CATEGORIES`）。
 *
 * ⚠️ 维护：上游新增 / 下线板块时本表会漏，需重跑生成脚本
 * （`scripts/board-taxonomy/`，产出覆盖 100% 后再更新本文件）；未收录的 code 一律返回 null，
 * 由 UI 兜底为「未归类」而不是报错。
 *
 * ⚠️ 概念板块（`fs=m:90+t:3`，504 条）**不适用**本表：其中混有「昨日涨停 / 百元股 /
 * 社保重仓 / 中盘成长」等策略与风格标签，不具备行业归属语义。
 */

/** 风格大类 key（禁 enum：const 对象 + as const + satisfies） */
export const BOARD_CATEGORY = {
  /** 科技 TMT */
  TECH: 'tech',
  /** 医药医疗 */
  HEALTH: 'health',
  /** 消费 */
  CONSUMER: 'consumer',
  /** 大金融 */
  FINANCE: 'finance',
  /** 高端制造 */
  MANUFACTURING: 'manufacturing',
  /** 周期资源 */
  CYCLICAL: 'cyclical',
  /** 公用与基建 */
  UTILITY: 'utility',
  /** 综合 */
  MISC: 'misc',
} as const satisfies Record<string, string>;

/** 风格大类 key 类型 */
export type BoardCategoryKey = (typeof BOARD_CATEGORY)[keyof typeof BOARD_CATEGORY];

/**
 * 风格大类定义：数组顺序即筛选按钮与平铺分区顺序；
 * `industries` 为该大类下辖的申万一级行业名（与 `SW_LEVEL1_BOARDS` 的 name 同源）
 */
export const BOARD_CATEGORIES: readonly {
  key: BoardCategoryKey;
  label: string;
  industries: readonly string[];
}[] = [
  {
    key: BOARD_CATEGORY.TECH,
    label: '科技',
    industries: ['电子', '计算机', '通信', '传媒'],
  },
  {
    key: BOARD_CATEGORY.HEALTH,
    label: '医药',
    industries: ['医药生物', '美容护理'],
  },
  {
    key: BOARD_CATEGORY.CONSUMER,
    label: '消费',
    industries: ['食品饮料', '家用电器', '纺织服饰', '轻工制造', '商贸零售', '社会服务', '农林牧渔'],
  },
  {
    key: BOARD_CATEGORY.FINANCE,
    label: '大金融',
    industries: ['银行', '非银金融', '房地产'],
  },
  {
    key: BOARD_CATEGORY.MANUFACTURING,
    label: '高端制造',
    industries: ['机械设备', '电力设备', '国防军工', '汽车'],
  },
  {
    key: BOARD_CATEGORY.CYCLICAL,
    label: '周期资源',
    industries: ['有色金属', '钢铁', '煤炭', '石油石化', '基础化工', '建筑材料'],
  },
  {
    key: BOARD_CATEGORY.UTILITY,
    label: '公用基建',
    industries: ['公用事业', '交通运输', '建筑装饰', '环保'],
  },
  {
    key: BOARD_CATEGORY.MISC,
    label: '综合',
    industries: ['综合'],
  },
];

/**
 * 申万一级 → 其下细分板块 code 清单（463 条，code 升序）
 *
 * **不含一级板块自身** —— 一级的 code 复用 `SW_LEVEL1_BOARDS`，不在此处重复声明。
 * 两组相加 = 494 个唯一板块。
 */
export const BOARD_TAXONOMY_GROUPS: readonly {
  industry: string;
  codes: readonly string[];
}[] = [
  // AUTO-GENERATED-START（本段由 scripts/board-taxonomy/regenerate.mjs 整体重写，勿手工编辑）
  {
    industry: '农林牧渔',
    codes: [
      'BK1254', 'BK1255', 'BK1256', 'BK1257', 'BK1258', 'BK1259', 'BK1260', 'BK1261',
      'BK1501', 'BK1502', 'BK1503', 'BK1504', 'BK1505', 'BK1506', 'BK1507', 'BK1508',
      'BK1509', 'BK1510', 'BK1511', 'BK1512', 'BK1513', 'BK1514', 'BK1515', 'BK1516',
      'BK1517', 'BK1518',
    ],
  },
  {
    industry: '基础化工',
    codes: [
      'BK0454', 'BK0471', 'BK0538', 'BK0731', 'BK1018', 'BK1019', 'BK1020', 'BK1411',
      'BK1412', 'BK1413', 'BK1414', 'BK1415', 'BK1416', 'BK1417', 'BK1418', 'BK1419',
      'BK1420', 'BK1421', 'BK1422', 'BK1423', 'BK1424', 'BK1425', 'BK1426', 'BK1427',
      'BK1428', 'BK1429', 'BK1430', 'BK1431', 'BK1432', 'BK1433', 'BK1434', 'BK1435',
      'BK1436', 'BK1437', 'BK1438', 'BK1439', 'BK1440', 'BK1441', 'BK1442', 'BK1443',
    ],
  },
  {
    industry: '钢铁',
    codes: [
      'BK1226', 'BK1227', 'BK1228', 'BK1367', 'BK1368', 'BK1369', 'BK1370', 'BK1371',
      'BK1372',
    ],
  },
  {
    industry: '有色金属',
    codes: [
      'BK0732', 'BK1015', 'BK1027', 'BK1287', 'BK1288', 'BK1613', 'BK1614', 'BK1615',
      'BK1616', 'BK1617', 'BK1618', 'BK1619', 'BK1620', 'BK1621', 'BK1622', 'BK1623',
      'BK1624', 'BK1625', 'BK1626',
    ],
  },
  {
    industry: '电子',
    codes: [
      'BK0459', 'BK1036', 'BK1037', 'BK1038', 'BK1039', 'BK1223', 'BK1325', 'BK1326',
      'BK1327', 'BK1328', 'BK1329', 'BK1330', 'BK1331', 'BK1332', 'BK1333', 'BK1334',
      'BK1335', 'BK1336', 'BK1337', 'BK1338', 'BK1339', 'BK1340',
    ],
  },
  {
    industry: '汽车',
    codes: [
      'BK0481', 'BK1016', 'BK1262', 'BK1263', 'BK1264', 'BK1519', 'BK1520', 'BK1521',
      'BK1522', 'BK1523', 'BK1524', 'BK1525', 'BK1526', 'BK1527', 'BK1528', 'BK1529',
      'BK1530', 'BK1531',
    ],
  },
  {
    industry: '家用电器',
    codes: [
      'BK1239', 'BK1240', 'BK1241', 'BK1242', 'BK1243', 'BK1244', 'BK1245', 'BK1449',
      'BK1450', 'BK1451', 'BK1452', 'BK1453', 'BK1454', 'BK1455', 'BK1456', 'BK1457',
      'BK1458', 'BK1459', 'BK1460',
    ],
  },
  {
    industry: '食品饮料',
    codes: [
      'BK1277', 'BK1278', 'BK1279', 'BK1280', 'BK1281', 'BK1282', 'BK1575', 'BK1576',
      'BK1577', 'BK1578', 'BK1579', 'BK1580', 'BK1581', 'BK1582', 'BK1583', 'BK1584',
      'BK1585', 'BK1586',
    ],
  },
  {
    industry: '纺织服饰',
    codes: [
      'BK0734', 'BK1224', 'BK1225', 'BK1347', 'BK1348', 'BK1349', 'BK1350', 'BK1351',
      'BK1352', 'BK1353', 'BK1354', 'BK1355', 'BK1356', 'BK1357',
    ],
  },
  {
    industry: '轻工制造',
    codes: [
      'BK0440', 'BK1265', 'BK1266', 'BK1267', 'BK1532', 'BK1533', 'BK1534', 'BK1535',
      'BK1536', 'BK1537', 'BK1538', 'BK1539', 'BK1540', 'BK1541', 'BK1542', 'BK1543',
      'BK1544', 'BK1545',
    ],
  },
  {
    industry: '医药生物',
    codes: [
      'BK0465', 'BK0727', 'BK1040', 'BK1041', 'BK1042', 'BK1044', 'BK1594', 'BK1595',
      'BK1596', 'BK1597', 'BK1598', 'BK1599', 'BK1600', 'BK1601', 'BK1602', 'BK1603',
      'BK1604', 'BK1605', 'BK1606', 'BK1607', 'BK1608',
    ],
  },
  {
    industry: '公用事业',
    codes: [
      'BK0428', 'BK1028', 'BK1373', 'BK1374', 'BK1375', 'BK1376', 'BK1377', 'BK1378',
      'BK1379', 'BK1380', 'BK1381',
    ],
  },
  {
    industry: '交通运输',
    codes: [
      'BK0420', 'BK0421', 'BK0422', 'BK0450', 'BK1479', 'BK1480', 'BK1481', 'BK1482',
      'BK1483', 'BK1484', 'BK1485', 'BK1486', 'BK1487', 'BK1488', 'BK1489', 'BK1490',
      'BK1491',
    ],
  },
  {
    industry: '房地产',
    codes: [
      'BK0451', 'BK1045', 'BK1341', 'BK1342', 'BK1343', 'BK1344', 'BK1345', 'BK1346',
    ],
  },
  {
    industry: '商贸零售',
    codes: [
      'BK0482', 'BK0484', 'BK1268', 'BK1269', 'BK1270', 'BK1546', 'BK1547', 'BK1548',
      'BK1549', 'BK1550', 'BK1551', 'BK1552', 'BK1553', 'BK1554', 'BK1555',
    ],
  },
  {
    industry: '社会服务',
    codes: [
      'BK0740', 'BK1043', 'BK1271', 'BK1272', 'BK1273', 'BK1556', 'BK1557', 'BK1558',
      'BK1559', 'BK1560', 'BK1561', 'BK1562', 'BK1563', 'BK1564', 'BK1565', 'BK1566',
      'BK1567', 'BK1568',
    ],
  },
  {
    industry: '综合',
    codes: [
      'BK0539', 'BK1627',
    ],
  },
  {
    industry: '建筑材料',
    codes: [
      'BK0424', 'BK0476', 'BK0546', 'BK1461', 'BK1462', 'BK1463', 'BK1464', 'BK1465',
      'BK1466', 'BK1467', 'BK1468', 'BK1469',
    ],
  },
  {
    industry: '建筑装饰',
    codes: [
      'BK0725', 'BK0726', 'BK1246', 'BK1247', 'BK1248', 'BK1470', 'BK1471', 'BK1472',
      'BK1473', 'BK1474', 'BK1475', 'BK1476', 'BK1477', 'BK1478',
    ],
  },
  {
    industry: '电力设备',
    codes: [
      'BK0457', 'BK1030', 'BK1031', 'BK1032', 'BK1033', 'BK1034', 'BK1302', 'BK1303',
      'BK1304', 'BK1305', 'BK1306', 'BK1307', 'BK1308', 'BK1309', 'BK1310', 'BK1311',
      'BK1312', 'BK1313', 'BK1314', 'BK1315', 'BK1316', 'BK1317', 'BK1318', 'BK1319',
      'BK1320', 'BK1321', 'BK1322', 'BK1323',
    ],
  },
  {
    industry: '国防军工',
    codes: [
      'BK1229', 'BK1230', 'BK1231', 'BK1232', 'BK1233', 'BK1382', 'BK1383', 'BK1384',
      'BK1385', 'BK1386',
    ],
  },
  {
    industry: '计算机',
    codes: [
      'BK0735', 'BK0737', 'BK1238', 'BK1444', 'BK1445', 'BK1446', 'BK1447', 'BK1448',
    ],
  },
  {
    industry: '传媒',
    codes: [
      'BK1046', 'BK1218', 'BK1219', 'BK1220', 'BK1221', 'BK1222', 'BK1289', 'BK1290',
      'BK1291', 'BK1292', 'BK1293', 'BK1294', 'BK1295', 'BK1296', 'BK1297', 'BK1298',
      'BK1299', 'BK1300', 'BK1301',
    ],
  },
  {
    industry: '通信',
    codes: [
      'BK0448', 'BK0736', 'BK1587', 'BK1588', 'BK1589', 'BK1590', 'BK1591', 'BK1592',
      'BK1593',
    ],
  },
  {
    industry: '银行',
    codes: [
      'BK0475', 'BK1609', 'BK1610', 'BK1611', 'BK1612',
    ],
  },
  {
    industry: '非银金融',
    codes: [
      'BK0473', 'BK0474', 'BK0738', 'BK1358', 'BK1359', 'BK1360', 'BK1361', 'BK1363',
      'BK1364', 'BK1365', 'BK1366',
    ],
  },
  {
    industry: '美容护理',
    codes: [
      'BK1251', 'BK1252', 'BK1253', 'BK1495', 'BK1496', 'BK1497', 'BK1498', 'BK1499',
      'BK1500',
    ],
  },
  {
    industry: '石油石化',
    codes: [
      'BK1274', 'BK1275', 'BK1276', 'BK1569', 'BK1570', 'BK1571', 'BK1572', 'BK1573',
      'BK1574',
    ],
  },
  {
    industry: '环保',
    codes: [
      'BK1234', 'BK1235', 'BK1387', 'BK1388', 'BK1389', 'BK1390', 'BK1391',
    ],
  },
  {
    industry: '机械设备',
    codes: [
      'BK0458', 'BK0545', 'BK0739', 'BK0910', 'BK1236', 'BK1237', 'BK1392', 'BK1393',
      'BK1394', 'BK1395', 'BK1396', 'BK1397', 'BK1398', 'BK1400', 'BK1401', 'BK1402',
      'BK1403', 'BK1404', 'BK1405', 'BK1406', 'BK1407', 'BK1408', 'BK1409', 'BK1410',
    ],
  },
  {
    industry: '煤炭',
    codes: [
      'BK1249', 'BK1250', 'BK1492', 'BK1493', 'BK1494',
    ],
  },
  // AUTO-GENERATED-END
];

/** 板块 code → 申万一级行业名（一级 31 条 + 细分 463 条 = 494 条） */
const BOARD_INDUSTRY_BY_CODE: ReadonlyMap<string, string> = new Map<string, string>([
  ...SW_LEVEL1_BOARDS.map((board): [string, string] => [board.code, board.name]),
  ...BOARD_TAXONOMY_GROUPS.flatMap((group): [string, string][] =>
    group.codes.map((code): [string, string] => [code, group.industry]),
  ),
]);

/** 申万一级行业名 → 风格大类 key（由 `BOARD_CATEGORIES` 反向构建） */
const BOARD_CATEGORY_BY_INDUSTRY: ReadonlyMap<string, BoardCategoryKey> = new Map<
  string,
  BoardCategoryKey
>(
  BOARD_CATEGORIES.flatMap((category): [string, BoardCategoryKey][] =>
    category.industries.map((industry): [string, BoardCategoryKey] => [industry, category.key]),
  ),
);

/** 已收录的板块总数（自检 / 计数用） */
export const BOARD_TAXONOMY_SIZE = BOARD_INDUSTRY_BY_CODE.size;

/**
 * 取板块所属的申万一级行业名
 * @param code 板块代码（BKxxxx 形态）
 * @returns 申万一级行业名；未收录返回 null
 */
export const getBoardIndustryName = (code: string): string | null =>
  BOARD_INDUSTRY_BY_CODE.get(code) ?? null;

/**
 * 取板块所属的风格大类 key
 * @param code 板块代码（BKxxxx 形态）
 * @returns 风格大类 key；未收录返回 null
 */
export const getBoardCategoryKey = (code: string): BoardCategoryKey | null => {
  const industry = getBoardIndustryName(code);
  return industry === null ? null : (BOARD_CATEGORY_BY_INDUSTRY.get(industry) ?? null);
};

/**
 * 取风格大类展示名
 * @param key 风格大类 key
 * @returns 展示名（如「科技」）
 */
export const getBoardCategoryLabel = (key: BoardCategoryKey): string =>
  BOARD_CATEGORIES.find((category) => category.key === key)?.label ?? key;

/**
 * 取板块所属风格大类的展示名
 * @param code 板块代码（BKxxxx 形态）
 * @returns 展示名（如「科技」）；未收录返回 null
 */
export const getBoardCategoryLabelByCode = (code: string): string | null => {
  const key = getBoardCategoryKey(code);
  return key === null ? null : getBoardCategoryLabel(key);
};

/** 未收录板块（上游新增、映射表未更新）的兜底文案 */
export const BOARD_CATEGORY_UNKNOWN_LABEL = '未归类';

/** 「全部大类」筛选值（没有归属的板块只在它下面可见） */
export const BOARD_CATEGORY_ALL = 'all';

/** 风格大类筛选值（`all` 或具体大类） */
export type BoardCategoryFilterValue = BoardCategoryKey | typeof BOARD_CATEGORY_ALL;

/** 风格大类筛选选项（首页为「全部」，其余按 `BOARD_CATEGORIES` 顺序） */
export const BOARD_CATEGORY_FILTER_OPTIONS: readonly {
  label: string;
  value: BoardCategoryFilterValue;
}[] = [
  { label: '全部', value: BOARD_CATEGORY_ALL },
  ...BOARD_CATEGORIES.map((category) => ({ label: category.label, value: category.key })),
];

/**
 * 判断板块是否命中风格大类筛选
 * @param code 板块代码（BKxxxx 形态）
 * @param filter 大类筛选值
 * @returns 是否命中（未收录板块仅在「全部」下命中）
 */
export const matchBoardCategory = (
  code: string,
  filter: BoardCategoryFilterValue,
): boolean => {
  if (filter === BOARD_CATEGORY_ALL) {
    return true;
  }
  return getBoardCategoryKey(code) === filter;
};
