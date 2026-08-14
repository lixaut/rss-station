import axios from 'axios';
import { AppConfig, StockItemConfig, StockPushConfig, DailyReportConfig } from '../config';
import { logInfo, logSuccess, logError, logBlock } from '../log';
import { fetchQuotes, StockItem } from './quote';
import { fetchDailyKlines, computeIndicators } from './kline';
import { scoreStock, overallPosition } from './strategy';
import {
  formatConsole,
  formatLarkCard,
  formatReportConsole,
  formatReportLarkCard,
  ReportItem,
} from './formatter';
import { saveReport } from './storage';

// ===== 推送通道（console / lark） =====

export class PusherError extends Error {}

interface Pusher {
  push(quotes: any): Promise<void>;
  pushReport(report: { console: string; lark: unknown }): Promise<void>;
}

class ConsolePusher implements Pusher {
  async push(quotes: any): Promise<void> {
    logBlock('stock', '行情推送', formatConsole(quotes));
  }
  async pushReport(report: { console: string }): Promise<void> {
    logBlock('stock', '盘后分析报告', report.console);
  }
}

class LarkPusher implements Pusher {
  constructor(private webhookUrl: string, private timeout = 5000) {}

  private async post(payload: unknown): Promise<void> {
    let result: any;
    try {
      const resp = await axios.post(this.webhookUrl, payload, { timeout: this.timeout });
      result = resp.data;
    } catch (err) {
      throw new PusherError(`飞书推送失败: ${(err as Error).message}`);
    }
    if (result && typeof result === 'object' && result.code !== undefined && result.code !== 0) {
      throw new PusherError(`飞书推送失败: ${result.msg || JSON.stringify(result)}`);
    }
  }

  async push(quotes: any): Promise<void> {
    await this.post(formatLarkCard(quotes));
  }

  async pushReport(report: { lark: unknown }): Promise<void> {
    await this.post(report.lark);
  }
}

function getPusher(push: StockPushConfig): Pusher {
  if (push.channel === 'lark') return new LarkPusher(push.webhook_url);
  return new ConsolePusher();
}

// ===== 配置项转换 =====

function toQuoteItems(items: StockItemConfig[]): StockItem[] {
  return items.map((i) => ({
    code: i.code,
    market: i.market,
    type: i.type,
    alias: i.alias || undefined,
  }));
}

// ===== 手动触发（对应 --once / --report） =====

/** 立即拉取并推送一次行情，返回标的数量 */
export async function runQuotesNow(config: AppConfig): Promise<number> {
  const items = config.stocks;
  if (items.length === 0) throw new Error('暂无配置股票标的');
  const quotes = await fetchQuotes(toQuoteItems(items));
  await getPusher(config.stock_push).push(quotes);
  return quotes.length;
}

function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTimeKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 带符号涨跌幅，如 +0.09% / -1.29%；缺失显示 -- */
function signedPct(pct: string): string {
  const t = String(pct ?? '').trim();
  if (!t || t === '--') return '--';
  return t.startsWith('-') ? `${t}%` : `+${t}%`;
}

/** 涨跌幅颜色（A股习惯涨红跌绿）：红 #d33 / 绿 #0a8 / 平黄 #e6a700 */
function pctColor(pct: string): string {
  const v = parseFloat(pct);
  if (v > 0) return '#d33';
  if (v < 0) return '#0a8';
  return '#e6a700';
}

/** 信号颜色：强多/偏多看涨红，强空/偏空看跌绿，中性黄 */
function signalColor(signal: string): string {
  if (signal === '强多' || signal === '偏多') return '#d33';
  if (signal === '强空' || signal === '偏空') return '#0a8';
  return '#e6a700';
}

/** 生成带颜色的 HTML span（Markdown 内嵌，GitHub/VS Code 预览渲染） */
function colorSpan(text: string, color: string): string {
  return `<span style="color:${color}">${text}</span>`;
}

/**
 * 盘后分析结果的 Markdown 分节（以 `## YYYY-MM-DD` 标题行开头，便于 storage.ts 按日期分节滚动存储）。
 * 浏览器/VS Code 预览即渲染彩色表格（涨红跌绿），每个标的一行（名称/现价/涨跌幅/信号/建议仓位），简洁明了便于复盘。
 */
function buildReportMarkdown(items: ReportItem[], overall: number): string {
  const now = new Date();
  const date = localDateKey(now);
  const time = localTimeKey(now);
  const up = items.filter((it) => it.signal === '强多' || it.signal === '偏多').length;
  const down = items.filter((it) => it.signal === '强空' || it.signal === '偏空').length;
  const flat = items.length - up - down;

  const title = `## ${date} ${time} · 综合仓位 **${(overall * 100).toFixed(0)}%** · 多 ${up} · 空 ${down} · 平 ${flat}`;

  const rows = [
    '| 标的 | 现价 | 涨跌幅 | 信号 | 建议仓位 |',
    '|------|------|--------|------|----------|',
    ...items.map((it) =>
      `| ${it.name} | ${it.price || '--'} | ${colorSpan(signedPct(it.change_pct), pctColor(it.change_pct))} | ${colorSpan(it.signal, signalColor(it.signal))} | ${(it.position * 100).toFixed(0)}% |`
    ),
  ];

  return `${title}\n\n${rows.join('\n')}\n`;
}

/** 立即执行一次盘后分析（均线/形态 + 仓位建议）并推送，返回标的数量 */
export async function runReportNow(config: AppConfig): Promise<number> {
  const items = config.stocks;
  if (items.length === 0) throw new Error('暂无配置股票标的');
  const maPeriods = config.daily_report.ma_periods;

  const quoteItems = toQuoteItems(items);
  const quotes = await fetchQuotes(quoteItems);
  const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

  const reportItems: ReportItem[] = [];
  for (const s of items) {
    const sym = `${s.market}${s.code}`;
    const q = quoteMap.get(sym);
    const klines = await fetchDailyKlines({
      code: s.code,
      market: s.market,
      type: s.type,
      alias: s.alias || undefined,
    });
    const ind = computeIndicators(klines, maPeriods);
    const { score, position, signal, reasons } = scoreStock(ind);
    reportItems.push({
      name: s.alias || q?.name || s.code,
      code: s.code,
      type: s.type,
      price: q?.price || '--',
      change: q?.change || '',
      change_pct: q?.change_pct || '',
      ind,
      score,
      signal,
      position,
      reasons,
    });
  }

  const overall = overallPosition(reportItems.map((it) => [it.score, it.position] as [number, number]));
  const report = {
    console: formatReportConsole(reportItems, overall),
    lark: formatReportLarkCard(reportItems, overall),
  };
  await getPusher(config.stock_push).pushReport(report);

  try {
    const path = saveReport(localDateKey(new Date()), buildReportMarkdown(reportItems, overall));
    logInfo('stock', `盘后分析已存入 ${path}`);
  } catch (err) {
    logError('stock', `盘后分析存储失败: ${(err as Error).message}`);
  }
  return reportItems.length;
}

// ===== 调度器 =====

let quoteTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let todayKey = '';
const reported = new Set<string>(); // 当天已推送的报告时刻

function isTradeDay(d: Date): boolean {
  return d.getDay() >= 1 && d.getDay() <= 5; // 简单档：周一~周五，节假日不排除
}

function parseHHMM(text: string): [number, number] {
  const [h, m] = text.split(':').map(Number);
  return [h, m];
}

/** 到点推送：盘中/收盘报告各一次（交易日） */
function checkReports(config: AppConfig): void {
  const daily: DailyReportConfig = config.daily_report;
  if (!daily.enabled) return;
  const now = new Date();
  if (!isTradeDay(now)) return;

  const today = localDateKey(now);
  if (today !== todayKey) {
    todayKey = today;
    reported.clear();
  }

  const schedule: Array<[string, boolean]> = [];
  if (daily.time) schedule.push([daily.time, false]);
  if (daily.close_time) schedule.push([daily.close_time, true]);

  for (const [t, isClose] of schedule) {
    if (reported.has(t)) continue;
    const [h, m] = parseHHMM(t);
    if (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m)) {
      reported.add(t);
      const label = isClose ? '收盘报告' : '盘中报告';
      runReportNow(config)
        .then((count) => {
          logSuccess('stock', `${label} 推送成功 ${count} 个标的`);
          if (isClose && daily.auto_exit) {
            // 整合后语义：收盘后停止当日股票调度，不退出整个服务
            logInfo('stock', '收盘报告已推送，今日股票调度停止（服务继续运行）');
            stopStockScheduler();
          }
        })
        .catch((err) => logError('stock', `${label}失败: ${(err as Error).message}`));
    }
  }
}

/** 启动股票调度器（行情间隔推送 + 报告到点触发） */
export function startStockScheduler(config: AppConfig): void {
  stopStockScheduler();
  todayKey = '';
  reported.clear();

  const settings = config.stock_push;
  const items = config.stocks;
  if (items.length === 0) {
    logInfo('stock', '未配置股票标的，调度器待命');
    return;
  }

  logInfo(
    'stock',
    `调度器启动：${items.length} 个标的，每 ${settings.interval_seconds} 秒推送一次 → ${settings.channel}`
  );

  // 立即推送一次（不阻塞启动）
  runQuotesNow(config)
    .then((n) => logSuccess('stock', `首次行情推送成功 ${n} 个标的`))
    .catch((err) => logError('stock', `首次行情推送失败: ${(err as Error).message}`));

  // 间隔推送
  quoteTimer = setInterval(() => {
    runQuotesNow(config).catch((err) => logError('stock', `行情推送失败: ${(err as Error).message}`));
  }, settings.interval_seconds * 1000);

  // 报告到点检查（每秒一次，保证整点触发）
  tickTimer = setInterval(() => checkReports(config), 1000);
}

/** 停止股票调度器 */
export function stopStockScheduler(): void {
  if (quoteTimer) {
    clearInterval(quoteTimer);
    quoteTimer = null;
  }
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}
