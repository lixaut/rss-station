import type { StockItem } from './quote';

// ===== config.json 解析与校验（移植自 stock-monitor/config.py） =====

const SUPPORTED_CHANNELS = ['console', 'lark'];
const KINDS = ['stock', 'index'];
const DEFAULT_INTERVAL_SECONDS = 5;
const DEFAULT_CHANNEL = 'console';

/** 未显式指定市场时按代码前缀推断（股票：6/9 开头为 sh；指数：399 开头为 sz，其余为 sh） */
export function inferMarket(code: string, kind: string): 'sh' | 'sz' {
  if (kind === 'index') return code.startsWith('399') ? 'sz' : 'sh';
  return code.startsWith('6') || code.startsWith('9') ? 'sh' : 'sz';
}

export interface NormalizedStockConfig {
  items: Array<Omit<StockItem, 'market'> & { market: 'sh' | 'sz' }>;
  settings: {
    interval_seconds: number;
    channel: 'console' | 'lark';
    webhook_url: string;
    daily_report: {
      enabled: boolean;
      time: string;
      close_time: string | null;
      auto_exit: boolean;
      ma_periods: number[];
    };
  };
}

const HHMM_RE = /^\d{1,2}:\d{2}$/;

/**
 * 解析并校验 config.json 内容，失败抛出带明确信息的 Error。
 * @param jsonText config.json 的完整文本
 */
export function parseStockConfig(jsonText: string): NormalizedStockConfig {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`配置文件 JSON 格式错误: ${(err as Error).message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('配置文件顶层必须是 JSON 对象');
  }
  const cfg = data as Record<string, unknown>;

  // --- 股票列表 ---
  const stocks = cfg.stocks;
  if (!Array.isArray(stocks) || stocks.length === 0) {
    throw new Error('配置缺少非空的 stocks 列表，示例: [{"code": "600519", "market": "sh"}]');
  }
  const items: NormalizedStockConfig['items'] = [];
  for (let i = 0; i < stocks.length; i++) {
    const s = stocks[i] as Record<string, unknown>;
    if (typeof s !== 'object' || s === null || !String(s.code ?? '').trim()) {
      throw new Error(`stocks[${i}] 缺少 code 字段`);
    }
    const code = String(s.code).trim();
    const kind = String(s.type ?? 'stock').trim().toLowerCase();
    if (!KINDS.includes(kind)) {
      throw new Error(`stocks[${i}] 的 type 仅支持: ${KINDS.join(', ')}（省略表示 stock）`);
    }
    const marketRaw = String(s.market ?? '').trim().toLowerCase();
    const market = (marketRaw || inferMarket(code, kind)) as 'sh' | 'sz';
    if (market !== 'sh' && market !== 'sz') {
      throw new Error(`stocks[${i}] 的 market 必须是 sh 或 sz，当前: ${market}`);
    }
    items.push({
      code,
      market,
      type: kind as 'stock' | 'index',
      alias: String(s.alias ?? '').trim() || code,
    });
  }

  // --- 推送间隔 ---
  const interval = Number(cfg.interval_seconds ?? DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error('interval_seconds 必须是大于 0 的数字');
  }

  // --- 推送通道 ---
  const push = (cfg.push ?? {}) as Record<string, unknown>;
  if (typeof push !== 'object' || push === null) {
    throw new Error('push 必须是 JSON 对象');
  }
  const channel = String(push.channel ?? DEFAULT_CHANNEL).trim().toLowerCase();
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(`push.channel 仅支持: ${SUPPORTED_CHANNELS.join(', ')}`);
  }
  const webhookUrl = String(push.webhook_url ?? '').trim();
  if (channel === 'lark' && !webhookUrl.startsWith('https://')) {
    throw new Error('push.channel 为 lark 时必须配置有效的 webhook_url');
  }

  // --- 盘后分析（可选，默认关闭） ---
  const daily = (cfg.daily_report ?? {}) as Record<string, unknown>;
  if (typeof daily !== 'object' || daily === null) {
    throw new Error('daily_report 必须是 JSON 对象');
  }
  const enabled = Boolean(daily.enabled ?? false);
  const timeStr = String(daily.time ?? '14:45').trim();
  if (!HHMM_RE.test(timeStr)) {
    throw new Error('daily_report.time 格式应为 HH:MM，如 14:45');
  }
  const closeRaw = String(daily.close_time ?? '').trim();
  if (closeRaw && !HHMM_RE.test(closeRaw)) {
    throw new Error('daily_report.close_time 格式应为 HH:MM，如 15:00');
  }
  const autoExit = Boolean(daily.auto_exit ?? true);
  const maPeriods = (daily.ma_periods ?? [5, 10, 20, 60]) as unknown;
  if (
    !Array.isArray(maPeriods) ||
    maPeriods.length === 0 ||
    !maPeriods.every((p) => Number.isInteger(p) && (p as number) > 0)
  ) {
    throw new Error('daily_report.ma_periods 必须是正整数列表');
  }

  return {
    items,
    settings: {
      interval_seconds: interval,
      channel: channel as 'console' | 'lark',
      webhook_url: webhookUrl,
      daily_report: {
        enabled,
        time: timeStr,
        close_time: closeRaw || null,
        auto_exit: autoExit,
        ma_periods: [...(maPeriods as number[])].sort((a, b) => a - b),
      },
    },
  };
}
