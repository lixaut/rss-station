import fs from 'fs';
import path from 'path';

// ===== 类型定义 =====

/** 数据库文件路径（运行时状态：去重缓存仍用 SQLite） */
export const dbPath = path.resolve(__dirname, '../data/rss-station.db');

export interface ScrapeRuleConfig {
  listSelector?: string;
  itemSelector: string;
  titleSelector: string;
  linkSelector?: string;
  contentSelector?: string;
}

export interface SubscriptionConfig {
  name: string;
  url: string;
  type: 'rss' | 'scrape';
  scrape_rules?: ScrapeRuleConfig;
  interval_minutes: number;
}

export interface WebhookConfig {
  name: string;
  url: string;
  template: 'text' | 'markdown' | 'json' | 'feishu';
}

export interface StockItemConfig {
  code: string;
  market: 'sh' | 'sz';
  type: 'stock' | 'index';
  alias: string;
}

export interface StockPushConfig {
  interval_seconds: number;
  channel: 'console' | 'lark';
  webhook_url: string;
  /** 行情推送时间窗口（含边界，HH:MM），默认 09:30 开盘后开始推送 */
  start_time: string;
  /** 行情推送时间窗口结束（HH:MM），默认 15:00 收盘后停止 */
  end_time: string;
  /** 生命周期通知开关（启动/午休/下午开盘/收盘/停止），默认 true */
  event_notify: boolean;
}

export interface AppConfig {
  subscriptions: SubscriptionConfig[];
  webhooks: WebhookConfig[];
  stocks: StockItemConfig[];
  stock_push: StockPushConfig;
}

// ===== 常量与默认值 =====

const WEBHOOK_TEMPLATES = ['text', 'markdown', 'json', 'feishu'];
const STOCK_CHANNELS = ['console', 'lark'];
const KINDS = ['stock', 'index'];
const HHMM_RE = /^\d{1,2}:\d{2}$/;

/** "HH:MM" → 当日分钟数，用于时间先后比较 */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../config.json');

const DEFAULT_STOCK_PUSH: StockPushConfig = {
  interval_seconds: 120,
  channel: 'console',
  webhook_url: '',
  start_time: '09:30',
  end_time: '15:00',
  event_notify: true,
};

/** 未显式指定市场时按代码前缀推断（股票：6/9 开头为 sh；指数：399 开头为 sz，其余为 sh） */
export function inferMarket(code: string, kind: string): 'sh' | 'sz' {
  if (kind === 'index') return code.startsWith('399') ? 'sz' : 'sh';
  return code.startsWith('6') || code.startsWith('9') ? 'sh' : 'sz';
}

// ===== 解析与校验 =====

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return value as Record<string, unknown>;
}

function parseSubscriptions(raw: unknown): SubscriptionConfig[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('subscriptions 必须是数组');
  return raw.map((item, i) => {
    const s = asObject(item, `subscriptions[${i}]`);
    const name = String(s.name ?? '').trim();
    const url = String(s.url ?? '').trim();
    if (!name || !url) throw new Error(`subscriptions[${i}] 缺少 name 或 url`);
    const type = s.type === 'scrape' ? 'scrape' : 'rss';
    const interval = Number(s.interval_minutes ?? 30);
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new Error(`subscriptions[${i}] 的 interval_minutes 必须大于 0`);
    }
    let scrape_rules: ScrapeRuleConfig | undefined;
    if (type === 'scrape') {
      const rules = asObject(s.scrape_rules ?? {}, `subscriptions[${i}].scrape_rules`) as unknown as ScrapeRuleConfig;
      if (!rules.itemSelector) {
        throw new Error(`subscriptions[${i}] scrape 类型需要提供 scrape_rules.itemSelector`);
      }
      scrape_rules = rules;
    }
    return { name, url, type, scrape_rules, interval_minutes: interval };
  });
}

function parseWebhooks(raw: unknown): WebhookConfig[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('webhooks 必须是数组');
  return raw.map((item, i) => {
    const w = asObject(item, `webhooks[${i}]`);
    const name = String(w.name ?? '').trim();
    const url = String(w.url ?? '').trim();
    if (!name || !url) throw new Error(`webhooks[${i}] 缺少 name 或 url`);
    const template = (String(w.template ?? 'markdown').trim() as WebhookConfig['template']);
    if (!WEBHOOK_TEMPLATES.includes(template)) {
      throw new Error(`webhooks[${i}] 的 template 仅支持: ${WEBHOOK_TEMPLATES.join(', ')}`);
    }
    return { name, url, template };
  });
}

function parseStocks(raw: unknown): StockItemConfig[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('stocks 必须是数组');
  return raw.map((item, i) => {
    const s = asObject(item, `stocks[${i}]`);
    const code = String(s.code ?? '').trim();
    if (!code) throw new Error(`stocks[${i}] 缺少 code 字段`);
    const kind = String(s.type ?? 'stock').trim().toLowerCase();
    if (!KINDS.includes(kind)) {
      throw new Error(`stocks[${i}] 的 type 仅支持: ${KINDS.join(', ')}`);
    }
    const marketRaw = String(s.market ?? '').trim().toLowerCase();
    const market = (marketRaw || inferMarket(code, kind)) as 'sh' | 'sz';
    if (market !== 'sh' && market !== 'sz') {
      throw new Error(`stocks[${i}] 的 market 必须是 sh 或 sz，当前: ${market}`);
    }
    return {
      code,
      market,
      type: kind as 'stock' | 'index',
      alias: String(s.alias ?? '').trim() || code,
    };
  });
}

function parseStockPush(raw: unknown): StockPushConfig {
  if (raw === undefined) return { ...DEFAULT_STOCK_PUSH };
  const p = asObject(raw, 'stock_push');
  const interval = Number(p.interval_seconds ?? DEFAULT_STOCK_PUSH.interval_seconds);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error('stock_push.interval_seconds 必须是大于 0 的数字');
  }
  const channel = String(p.channel ?? DEFAULT_STOCK_PUSH.channel).trim().toLowerCase();
  if (!STOCK_CHANNELS.includes(channel)) {
    throw new Error(`stock_push.channel 仅支持: ${STOCK_CHANNELS.join(', ')}`);
  }
  const webhookUrl = String(p.webhook_url ?? '').trim();
  if (channel === 'lark' && !webhookUrl.startsWith('https://')) {
    throw new Error('stock_push.channel 为 lark 时必须配置有效的 webhook_url');
  }
  const startTime = String(p.start_time ?? DEFAULT_STOCK_PUSH.start_time).trim();
  if (!HHMM_RE.test(startTime)) {
    throw new Error('stock_push.start_time 格式应为 HH:MM，如 09:30');
  }
  const endTime = String(p.end_time ?? DEFAULT_STOCK_PUSH.end_time).trim();
  if (!HHMM_RE.test(endTime)) {
    throw new Error('stock_push.end_time 格式应为 HH:MM，如 15:00');
  }
  const startMin = toMinutes(startTime);
  const endMin = toMinutes(endTime);
  if (startMin >= endMin) {
    throw new Error('stock_push.start_time 必须早于 end_time');
  }
  const eventNotify = Boolean(p.event_notify ?? true);
  return {
    interval_seconds: interval,
    channel: channel as 'console' | 'lark',
    webhook_url: webhookUrl,
    start_time: startTime,
    end_time: endTime,
    event_notify: eventNotify,
  };
}

/**
 * 从 JSON 文本解析并校验完整配置，失败抛出带明确信息的 Error。
 * 配置文件结构见 config.json 示例。
 */
export function parseConfig(jsonText: string): AppConfig {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`配置文件 JSON 格式错误: ${(err as Error).message}`);
  }
  const cfg = asObject(data, '配置文件顶层');
  return {
    subscriptions: parseSubscriptions(cfg.subscriptions),
    webhooks: parseWebhooks(cfg.webhooks),
    stocks: parseStocks(cfg.stocks),
    stock_push: parseStockPush(cfg.stock_push),
  };
}

/** 从文件加载并解析配置（默认项目根目录 config.json） */
export function loadConfig(filePath: string = DEFAULT_CONFIG_PATH): AppConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`配置文件不存在: ${filePath}（请参照 README 创建 config.json）`);
  }
  return parseConfig(fs.readFileSync(filePath, 'utf-8'));
}
