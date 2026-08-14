import axios from 'axios';
import {
  getEnabledStockItems,
  getStockSettings,
  StockItem as DbStockItem,
} from '../db/db';
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
  push(quotes: ReturnType<typeof fetchQuotes> extends Promise<infer T> ? T : never): Promise<void>;
  pushReport(report: { console: string; lark: unknown }): Promise<void>;
}

class ConsolePusher implements Pusher {
  async push(quotes: any): Promise<void> {
    console.log(formatConsole(quotes));
  }
  async pushReport(report: { console: string }): Promise<void> {
    console.log(report.console);
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

function getPusher(): Pusher {
  const settings = getStockSettings();
  if (settings.channel === 'lark') return new LarkPusher(settings.webhook_url);
  return new ConsolePusher();
}

// ===== 配置项转换 =====

function toQuoteItems(items: DbStockItem[]): StockItem[] {
  return items.map((i) => ({
    code: i.code,
    market: i.market,
    type: i.type,
    alias: i.alias || undefined,
  }));
}

// ===== 手动触发（对应 --once / --report） =====

/** 立即拉取并推送一次行情，返回标的数量 */
export async function runQuotesNow(): Promise<number> {
  const items = getEnabledStockItems();
  if (items.length === 0) throw new Error('暂无启用的股票标的');
  const quotes = await fetchQuotes(toQuoteItems(items));
  await getPusher().push(quotes);
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

/** 盘后分析结果的可序列化结构，供本地 JSON 存储（数据不依赖 formatter） */
function buildReportStorage(items: ReportItem[], overall: number): Record<string, unknown> {
  const now = new Date();
  const up = items.filter((it) => it.signal === '强多' || it.signal === '偏多').length;
  const down = items.filter((it) => it.signal === '强空' || it.signal === '偏空').length;
  return {
    date: localDateKey(now),
    time: localTimeKey(now),
    overall_position: Math.round(overall * 10000) / 10000,
    summary: { up, down, flat: items.length - up - down },
    items: items.map((it) => {
      const ma: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(it.ind.ma)) ma[k] = v;
      return {
        name: it.name,
        code: it.code,
        type: it.type,
        price: it.price,
        change_pct: it.change_pct,
        ma,
        body: it.ind.body,
        upper_shadow: it.ind.upper_shadow,
        lower_shadow: it.ind.lower_shadow,
        volume_ratio: it.ind.volume_ratio,
        score: Math.round(it.score * 10000) / 10000,
        signal: it.signal,
        position: it.position,
      };
    }),
  };
}

/** 立即执行一次盘后分析（均线/形态 + 仓位建议）并推送，返回标的数量 */
export async function runReportNow(): Promise<number> {
  const items = getEnabledStockItems();
  if (items.length === 0) throw new Error('暂无启用的股票标的');
  const settings = getStockSettings();
  let maPeriods: number[];
  try {
    maPeriods = JSON.parse(settings.ma_periods || '[5,10,20,60]') as number[];
  } catch {
    maPeriods = [5, 10, 20, 60];
  }

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
  await getPusher().pushReport(report);

  try {
    const path = saveReport(localDateKey(new Date()), buildReportStorage(reportItems, overall));
    console.log(`[股票] 盘后分析已存入 ${path}`);
  } catch (err) {
    console.error(`[股票] 盘后分析存储失败: ${(err as Error).message}`);
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
function checkReports(): void {
  const settings = getStockSettings();
  if (!settings.report_enabled) return;
  const now = new Date();
  if (!isTradeDay(now)) return;

  const today = localDateKey(now);
  if (today !== todayKey) {
    todayKey = today;
    reported.clear();
  }

  const schedule: Array<[string, boolean]> = [];
  if (settings.report_time) schedule.push([settings.report_time, false]);
  if (settings.close_time) schedule.push([settings.close_time, true]);

  for (const [t, isClose] of schedule) {
    if (reported.has(t)) continue;
    const [h, m] = parseHHMM(t);
    if (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m)) {
      reported.add(t);
      const label = isClose ? '收盘报告' : '盘中报告';
      runReportNow()
        .then((count) => {
          console.log(`[股票] ${label} 推送成功 ${count} 个标的`);
          if (isClose && settings.auto_exit) {
            // 整合后语义：收盘后停止当日股票调度，不退出整个服务
            console.log('[股票] 收盘报告已推送，今日股票调度停止（服务继续运行）');
            stopStockScheduler();
          }
        })
        .catch((err) => console.error(`[股票] ${label}失败: ${(err as Error).message}`));
    }
  }
}

/** 启动股票调度器（行情间隔推送 + 报告到点触发） */
export function startStockScheduler(): void {
  stopStockScheduler();
  todayKey = '';
  reported.clear();

  const settings = getStockSettings();
  const items = getEnabledStockItems();
  if (items.length === 0) {
    console.log('[股票] 暂无启用的股票标的，调度器待命');
    return;
  }

  console.log(
    `[股票] 调度器启动：${items.length} 个标的，每 ${settings.interval_seconds} 秒推送一次 → ${settings.channel}`
  );

  // 立即推送一次（不阻塞启动）
  runQuotesNow()
    .then((n) => console.log(`[股票] 首次行情推送成功 ${n} 个标的`))
    .catch((err) => console.error(`[股票] 首次行情推送失败: ${(err as Error).message}`));

  // 间隔推送
  quoteTimer = setInterval(() => {
    runQuotesNow().catch((err) => console.error(`[股票] 行情推送失败: ${(err as Error).message}`));
  }, settings.interval_seconds * 1000);

  // 报告到点检查（每秒一次，保证整点触发）
  tickTimer = setInterval(checkReports, 1000);
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

/** 刷新股票调度器（增删改配置后调用） */
export function refreshStockScheduler(): void {
  console.log(`[股票] 刷新调度器...`);
  startStockScheduler();
}
