/**
 * 个股 F10 抽屉数据类型（上游：东方财富 emh5.eastmoney.com F10 服务端直出页）
 *
 * 四个新增页签（基本资料 / 发行相关 / 高管简介 / 参股控股）的数据均从
 * 对应静态 HTML 页解析而来，见 utils/parse-f10-*.ts
 */

/** F10 键值对条目（基本资料 dl/dt/dd 与发行相关 ul/li>span 两种结构统一后的形态） */
export interface F10KeyValue {
  /** 字段名（如 公司名称 / 上市日期） */
  label: string;
  /** 字段值（原文，长文本如公司简介按换行保留） */
  value: string;
}

/** F10 高管简介条目（一位高管一条） */
export interface F10Executive {
  /** 姓名 */
  name: string;
  /** 任职时间（yyyy-MM-dd 或描述性文本） */
  appointDate: string;
  /** 性别 */
  gender: string;
  /** 学历 */
  education: string;
  /** 年龄（原文文本） */
  age: string;
  /** 职务（逗号分隔，可多项） */
  position: string;
  /** 简介正文（履历描述，可能为空） */
  intro: string;
}

/** F10 参股控股行（被参股企业一条） */
export interface F10HoldRow {
  /** 被参股企业名称 */
  companyName: string;
  /** 被参股企业注册资本（原文，如 `50.00亿元` / `--`） */
  registeredCapital: string;
  /** 集团持股比例（%，原文文本） */
  holdingRatio: string;
}
