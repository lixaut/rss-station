import type { KlineIndicators } from './kline';

// ===== 打分权重 =====

const WEIGHT_MA_TREND = 1.0; // 收盘 vs MA5
const WEIGHT_MA_ALIGN = 1.0; // 均线多空排列
const WEIGHT_BODY = 1.0; // 阳/阴实体
const WEIGHT_SHADOW = 0.5; // 影线
const WEIGHT_VOLUME = 0.5; // 量价配合

// 量比阈值
const VOLUME_RATIO_HIGH = 1.3; // 放量
const VOLUME_RATIO_LOW = 0.7; // 缩量

// 分数 → 建议仓位映射（按分数从高到低匹配）
const POSITION_MAP: Array<[number, number]> = [
  [1.5, 0.8], // 强多
  [0.5, 0.65], // 偏多
  [-0.5, 0.5], // 中性
  [-1.5, 0.35], // 偏空
  [-Infinity, 0.2], // 强空
];

const SIGNAL_LEVELS: Array<[number, string]> = [
  [1.5, '强多'],
  [0.5, '偏多'],
  [-0.5, '中性'],
  [-1.5, '偏空'],
  [-Infinity, '强空'],
];

export interface ScoreResult {
  score: number;
  position: number;
  signal: string;
  /** 分析过程明细：说明文字 + 分值 */
  reasons: Array<[string, number]>;
}

/** 对单标的技术打分，返回 (score, 建议仓位比例, reasons) */
export function scoreStock(ind: KlineIndicators): ScoreResult {
  const reasons: Array<[string, number]> = [];
  let score = 0.0;
  const ma = ind.ma;
  const close = ind.close;

  if (ma[5] != null) {
    const v = WEIGHT_MA_TREND * (close > ma[5] ? 1 : -1);
    score += v;
    reasons.push([
      `现价 ${close.toFixed(2)} ${close > ma[5] ? '高于' : '低于'} MA5(${ma[5].toFixed(2)})`,
      v,
    ]);
  } else {
    reasons.push(['MA5 数据不足，跳过均线趋势', 0.0]);
  }

  if (ma[10] != null && ma[20] != null) {
    let v: number;
    if (ma[5]! > ma[10]! && ma[10]! > ma[20]!) {
      v = WEIGHT_MA_ALIGN;
      reasons.push([
        `均线多头排列 MA5(${ma[5]!.toFixed(2)})>MA10(${ma[10]!.toFixed(2)})>MA20(${ma[20]!.toFixed(2)})`,
        v,
      ]);
    } else if (ma[5]! < ma[10]! && ma[10]! < ma[20]!) {
      v = -WEIGHT_MA_ALIGN;
      reasons.push([
        `均线空头排列 MA5(${ma[5]!.toFixed(2)})<MA10(${ma[10]!.toFixed(2)})<MA20(${ma[20]!.toFixed(2)})`,
        v,
      ]);
    } else {
      v = 0.0;
      reasons.push(['均线交叉排列（中性）', 0.0]);
    }
    score += v;
  } else {
    reasons.push(['MA10/MA20 数据不足，跳过排列判断', 0.0]);
  }

  const vBody = WEIGHT_BODY * Math.max(-1.0, Math.min(1.0, ind.body * 2));
  score += vBody;
  const kind = ind.is_yang ? '阳线' : '阴线';
  reasons.push([`${kind} 实体占振幅 ${Math.abs(ind.body) * 100}%`, vBody]);

  const vShadow = WEIGHT_SHADOW * (ind.lower_shadow - ind.upper_shadow);
  score += vShadow;
  reasons.push([
    `上影 ${(ind.upper_shadow * 100).toFixed(1)}% / 下影 ${(ind.lower_shadow * 100).toFixed(1)}%`,
    vShadow,
  ]);

  const vratio = ind.volume_ratio;
  if (vratio == null) {
    reasons.push(['成交量数据不足，跳过量能判断', 0.0]);
  } else if (ind.is_yang && vratio > VOLUME_RATIO_HIGH) {
    const v = WEIGHT_VOLUME;
    score += v;
    reasons.push([`放量上涨 量比 ${vratio.toFixed(2)}（>${VOLUME_RATIO_HIGH}，多头确认）`, v]);
  } else if (!ind.is_yang && vratio > VOLUME_RATIO_HIGH) {
    const v = -WEIGHT_VOLUME;
    score += v;
    reasons.push([`放量下跌 量比 ${vratio.toFixed(2)}（>${VOLUME_RATIO_HIGH}，空头确认）`, v]);
  } else if (vratio < VOLUME_RATIO_LOW) {
    reasons.push([`缩量 量比 ${vratio.toFixed(2)}（<${VOLUME_RATIO_LOW}，观望）`, 0.0]);
  } else {
    reasons.push([`量比 ${vratio.toFixed(2)}（正常范围）`, 0.0]);
  }

  let position = 0.5;
  for (const [threshold, pos] of POSITION_MAP) {
    if (score >= threshold) {
      position = pos;
      break;
    }
  }
  return { score, position, signal: signalOf(score), reasons };
}

export function signalOf(score: number): string {
  for (const [threshold, signal] of SIGNAL_LEVELS) {
    if (score >= threshold) return signal;
  }
  return '强空';
}

/** 综合仓位建议：各标的建议仓位的等权平均 */
export function overallPosition(scores: Array<[number, number]>): number {
  if (scores.length === 0) return 0.0;
  return scores.reduce((sum, [, pos]) => sum + pos, 0) / scores.length;
}
