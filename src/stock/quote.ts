import axios from 'axios';

// ===== 类型定义 =====

/** 配置中的单个标的 */
export interface StockItem {
  code: string;
  market: 'sh' | 'sz';
  type: 'stock' | 'index';
  alias?: string;
}

/** 腾讯行情返回的单条行情 */
export interface Quote {
  symbol: string;
  name: string;
  code: string;
  price: string;
  prev_close: string;
  open: string;
  change: string;
  change_pct: string;
  high: string;
  low: string;
  volume: string;
  time: string;
  type: 'stock' | 'index';
  alias?: string;
}

// ===== 腾讯行情接口 =====

const QUOTE_URL = 'http://qt.gtimg.cn/q={codes}';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) rss-station/0.1',
  Referer: 'https://gu.qq.com/',
};

// 腾讯行情返回以 ~ 分隔的字段，以下为常用字段索引
const IDX_NAME = 1;
const IDX_CODE = 2;
const IDX_PRICE = 3;
const IDX_PREV_CLOSE = 4;
const IDX_OPEN = 5;
const IDX_VOLUME = 6;
const IDX_TIME = 30;
const IDX_CHANGE = 31;
const IDX_CHANGE_PCT = 32;
const IDX_HIGH = 33;
const IDX_LOW = 34;

// 无行情时接口常返回空串或 0.00
const MISSING = new Set(['', '-', '0.00', '0']);

const QUOTE_RE = /v_(\w+)="([^"]*)"/g;

export class QuoteError extends Error {}

function clean(value: string): string {
  const v = (value || '').trim();
  return MISSING.has(v) ? '' : v;
}

/**
 * 批量获取股票实时行情。
 * 腾讯接口返回 GBK 编码，需以 arraybuffer 接收后用 TextDecoder('gbk') 解码。
 */
export async function fetchQuotes(stocks: StockItem[], timeout = 5000): Promise<Quote[]> {
  const symbols = stocks.map((s) => `${s.market}${s.code}`);
  let resp;
  try {
    resp = await axios.get(QUOTE_URL.replace('{codes}', symbols.join(',')), {
      headers: HEADERS,
      timeout,
      responseType: 'arraybuffer',
    });
  } catch (err) {
    throw new QuoteError(`拉取行情失败: ${(err as Error).message}`);
  }

  const text = new TextDecoder('gbk').decode(new Uint8Array(resp.data));

  const quotes = new Map<string, Quote>();
  for (const m of text.matchAll(QUOTE_RE)) {
    const sym = m[1];
    const fields = m[2].split('~');
    if (fields.length <= IDX_CHANGE_PCT) continue;
    quotes.set(sym, {
      symbol: sym,
      name: clean(fields[IDX_NAME]),
      code: clean(fields[IDX_CODE]),
      price: clean(fields[IDX_PRICE]),
      prev_close: clean(fields[IDX_PREV_CLOSE]),
      open: clean(fields[IDX_OPEN]),
      change: clean(fields[IDX_CHANGE]),
      change_pct: clean(fields[IDX_CHANGE_PCT]),
      high: clean(fields[IDX_HIGH]),
      low: clean(fields[IDX_LOW]),
      volume: clean(fields[IDX_VOLUME]),
      time: clean(fields[IDX_TIME]),
      type: 'stock',
    });
  }
  if (quotes.size === 0) {
    throw new QuoteError('行情接口返回为空，请检查股票代码是否正确');
  }

  // 按配置顺序返回；缺失的股票保留 symbol 并补默认值，便于定位问题代码
  return stocks.map((s) => {
    const sym = `${s.market}${s.code}`;
    const q = quotes.get(sym);
    if (!q) {
      return {
        symbol: sym,
        name: s.alias || s.code,
        code: s.code,
        price: '',
        prev_close: '',
        open: '',
        change: '',
        change_pct: '',
        high: '',
        low: '',
        volume: '',
        time: '',
        type: s.type,
        alias: s.alias || s.code,
      };
    }
    return { ...q, type: s.type, alias: s.alias || s.code };
  });
}
