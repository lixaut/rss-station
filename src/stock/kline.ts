import axios from 'axios';
import type { StockItem } from './quote';

// ===== 类型定义 =====

/** 单根日K线 */
export interface Kline {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 技术指标（最新一根K线的形态 + 各周期均线） */
export interface KlineIndicators {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ma: Record<number, number | null>;
  volume: number;
  volume_ratio: number | null;
  /** 实体占振幅比例：正为阳、负为阴 */
  body: number;
  upper_shadow: number;
  lower_shadow: number;
  is_yang: boolean;
}

// ===== 新浪日K线接口 =====

const KLINE_URL =
  'https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_=/CN_MarketDataService.getKLineData';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) rss-station/0.1',
  Referer: 'https://finance.sina.com.cn',
};
const DEFAULT_DAYS = 70; // 默认拉取数量，至少覆盖 MA60

const JSONP_RE = /\((\[.*\])\)/s;

export class KlineError extends Error {}

function toFloat(value: unknown): number {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : 0.0;
}

/** 拉取指定标的最近 N 个交易日的日K线（按日期升序） */
export async function fetchDailyKlines(
  stock: StockItem,
  days = DEFAULT_DAYS,
  timeout = 6000
): Promise<Kline[]> {
  const symbol = `${stock.market}${stock.code}`;
  let resp;
  try {
    resp = await axios.get(KLINE_URL, {
      params: { symbol, scale: '240', ma: 'no', datalen: String(days) },
      headers: HEADERS,
      timeout,
    });
  } catch (err) {
    throw new KlineError(`拉取K线失败(${symbol}): ${(err as Error).message}`);
  }

  const m = JSONP_RE.exec(resp.data);
  if (!m) {
    throw new KlineError(`拉取K线失败(${symbol}): 接口返回格式异常`);
  }
  let rows: Record<string, unknown>[];
  try {
    rows = JSON.parse(m[1]);
  } catch {
    throw new KlineError(`拉取K线失败(${symbol}): 响应解析失败`);
  }
  if (!rows || rows.length === 0) {
    throw new KlineError(`拉取K线失败(${symbol}): 无K线数据`);
  }

  return rows.map((r) => ({
    date: String(r.day),
    open: toFloat(r.open),
    high: toFloat(r.high),
    low: toFloat(r.low),
    close: toFloat(r.close),
    volume: toFloat(r.volume),
  }));
}

/** 基于日K线计算技术指标（最新一根K线的形态 + 各周期均线 + 量比） */
export function computeIndicators(
  klines: Kline[],
  maPeriods: number[] = [5, 10, 20, 60]
): KlineIndicators {
  const closes = klines.map((k) => k.close);
  const latest = klines[klines.length - 1];

  const ma: Record<number, number | null> = {};
  for (const p of maPeriods) {
    if (closes.length >= p) {
      ma[p] = Math.round((closes.slice(-p).reduce((a, b) => a + b, 0) / p) * 1000) / 1000;
    } else {
      ma[p] = null;
    }
  }

  const { open: o, high: h, low: l, close: c } = latest;
  const span = Math.max(h - l, 1e-9); // 防除零

  // 量比：当日成交量 / 近 5 日（不含当日）平均成交量；历史不足 5 根时用可用历史
  const volumes = klines.map((k) => k.volume);
  const vol = latest.volume;
  const prev = volumes.length > 5 ? volumes.slice(-6, -1) : volumes.slice(0, -1);
  let volumeRatio: number | null = null;
  if (prev.length > 0 && Math.max(...prev) > 0) {
    const avgPrev = prev.reduce((a, b) => a + b, 0) / prev.length;
    volumeRatio = avgPrev > 0 ? Math.round((vol / avgPrev) * 100) / 100 : null;
  }

  return {
    date: latest.date,
    open: o,
    high: h,
    low: l,
    close: c,
    ma,
    volume: vol,
    volume_ratio: volumeRatio,
    body: (c - o) / span,
    upper_shadow: (h - Math.max(o, c)) / span,
    lower_shadow: (Math.min(o, c) - l) / span,
    is_yang: c > o,
  };
}
