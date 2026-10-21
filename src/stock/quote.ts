import axios from 'axios';

// ===== 类型定义 =====

/** 配置中的单个标的 */
export interface StockItem {
  code: string;
  market: 'sh' | 'sz' | 'hf';
  type: 'stock' | 'index' | 'gold';
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
  type: 'stock' | 'index' | 'gold';
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

// 外盘（hf_ 前缀，如黄金）以逗号分隔，字段索引：
// [0]最新价 [1]涨跌幅% [4]最高 [5]最低 [6]时间 HH:MM:SS [7]昨结算 [8]今开盘 [12]日期 yyyy-MM-dd [13]名称
const HF_IDX_PRICE = 0;
const HF_IDX_CHANGE_PCT = 1;
const HF_IDX_HIGH = 4;
const HF_IDX_LOW = 5;
const HF_IDX_TIME = 6;
const HF_IDX_PREV_SETTLE = 7;
const HF_IDX_OPEN = 8;
const HF_IDX_DATE = 12;
const HF_IDX_NAME = 13;
const HF_MIN_FIELDS = 14;

export class QuoteError extends Error {}

/** 拼接腾讯行情 symbol：外盘 hf 需带下划线（hf_XAU），国内为 sh/sz 前缀直接拼接 */
export function toSymbol(s: Pick<StockItem, 'market' | 'code'>): string {
  return s.market === 'hf' ? `hf_${s.code}` : `${s.market}${s.code}`;
}

function clean(value: string): string {
  const v = (value || '').trim();
  return MISSING.has(v) ? '' : v;
}

/** 解析外盘（hf_）逗号分隔行情；涨跌额由 最新价 - 昨结算 计算，时间拼成 yyyyMMddHHmmss 与国内格式统一 */
function parseHfQuote(sym: string, body: string): Quote | null {
  const f = body.split(',');
  if (f.length < HF_MIN_FIELDS) return null;
  const price = clean(f[HF_IDX_PRICE]);
  const prevClose = clean(f[HF_IDX_PREV_SETTLE]);
  let change = '';
  const p = parseFloat(price);
  const prev = parseFloat(prevClose);
  if (Number.isFinite(p) && Number.isFinite(prev)) change = (p - prev).toFixed(2);
  const date = f[HF_IDX_DATE].replace(/-/g, '');
  const time = f[HF_IDX_TIME].replace(/:/g, '');
  return {
    symbol: sym,
    name: clean(f[HF_IDX_NAME]),
    code: sym.replace(/^hf_/, ''),
    price,
    prev_close: prevClose,
    open: clean(f[HF_IDX_OPEN]),
    change,
    change_pct: clean(f[HF_IDX_CHANGE_PCT]),
    high: clean(f[HF_IDX_HIGH]),
    low: clean(f[HF_IDX_LOW]),
    volume: '',
    time: /^\d{8}$/.test(date) && /^\d{6}$/.test(time) ? date + time : clean(f[HF_IDX_TIME]),
    type: 'stock',
  };
}

/**
 * 批量获取股票实时行情。
 * 腾讯接口返回 GBK 编码，需以 arraybuffer 接收后用 TextDecoder('gbk') 解码。
 */
export async function fetchQuotes(stocks: StockItem[], timeout = 5000): Promise<Quote[]> {
  const symbols = stocks.map(toSymbol);
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
    if (sym.startsWith('hf_')) {
      const q = parseHfQuote(sym, m[2]);
      if (q) quotes.set(sym, q);
      continue;
    }
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
    const sym = toSymbol(s);
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
