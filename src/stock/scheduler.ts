import axios from 'axios';
import { AppConfig, StockItemConfig, StockPushConfig } from '../config';
import { logInfo, logSuccess, logError, logBlock } from '../log';
import { fetchQuotes, StockItem } from './quote';
import {
  formatConsole,
  formatLarkCard,
  formatNoticeConsole,
  formatNoticeLarkCard,
} from './formatter';

// ===== 推送通道（console / lark） =====

export class PusherError extends Error {}

interface Pusher {
  push(quotes: any): Promise<void>;
  pushNotice(notice: { console: string; lark: unknown }): Promise<void>;
}

class ConsolePusher implements Pusher {
  async push(quotes: any): Promise<void> {
    logBlock('stock', '行情推送', formatConsole(quotes));
  }
  async pushNotice(notice: { console: string }): Promise<void> {
    logBlock('stock', '盯盘通知', notice.console);
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

  async pushNotice(notice: { lark: unknown }): Promise<void> {
    await this.post(notice.lark);
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

// ===== 调度器 =====

let quoteTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let windowStarted = false; // 当天是否已进入推送窗口并完成首次推送

// 生命周期通知状态（每天重置）
let lastConfig: AppConfig | null = null; // 最近一次启动的配置（供进程退出通知使用）
let noticeDayKey = ''; // 通知日期标记
let lunchNotified = false; // 当天是否已发午间休市通知
let afternoonNotified = false; // 当天是否已发下午开盘通知
let closeNotified = false; // 当天是否已发收盘通知

// ===== 生命周期通知（启动/午休/下午开盘/收盘/停止） =====

/** 推送一条生命周期通知（受 event_notify 开关控制），失败仅记日志，不阻塞调用方 */
function pushLifecycleNotice(config: AppConfig, title: string, lines: string[]): void {
  if (!config.stock_push.event_notify) return;
  const notice = {
    console: formatNoticeConsole(title, lines),
    lark: formatNoticeLarkCard(title, lines),
  };
  getPusher(config.stock_push)
    .pushNotice(notice)
    .catch((err) => logError('stock', `通知推送失败(${title}): ${(err as Error).message}`));
}

/** 进程退出前调用：推送停止通知（未启动股票调度或已关闭通知时静默跳过） */
export function pushStockNotice(title: string, lines: string[]): Promise<void> {
  const config = lastConfig;
  if (!config || !config.stock_push.event_notify) return Promise.resolve();
  const notice = {
    console: formatNoticeConsole(title, lines),
    lark: formatNoticeLarkCard(title, lines),
  };
  return getPusher(config.stock_push).pushNotice(notice).catch((err) => {
    logError('stock', `通知推送失败(${title}): ${(err as Error).message}`);
  });
}

/** 组装启动通知正文（含推送时间点信息） */
function buildStartupNoticeLines(config: AppConfig): string[] {
  const settings = config.stock_push;
  const names = config.stocks.map((i) => i.alias || i.code).join('、');
  const lines = [
    `今天为您盯 ${config.stocks.length} 只标的：${names}`,
    `每 ${settings.interval_seconds} 秒为您播报一次行情`,
    `时间安排：上午 ${settings.start_time} 开盘，11:30 午间休市，下午 13:00 开盘，${settings.end_time} 收盘`,
  ];
  return lines;
}

/** 收盘结束通知（当日最后一次通知），防重复 */
function sendCloseNotice(config: AppConfig): void {
  if (closeNotified) return;
  closeNotified = true;
  pushLifecycleNotice(config, '🌙 今日已收盘', ['辛苦啦，今天的盯盘结束，明天开盘见！']);
}

/** 每秒检查：午间休市/下午开盘/收盘等股市时间节点通知（交易日，每天各一次） */
function checkLifecycleEvents(config: AppConfig): void {
  const now = new Date();
  if (!isTradeDay(now)) return;
  const today = localDateKey(now);
  if (today !== noticeDayKey) {
    noticeDayKey = today;
    lunchNotified = false;
    afternoonNotified = false;
    closeNotified = false;
    windowStarted = false; // 跨天重置，保证次日开盘准点首推
  }
  const t = now.getHours() * 60 + now.getMinutes();
  const [eh, em] = parseHHMM(config.stock_push.end_time);
  if (t >= 11 * 60 + 30 && !lunchNotified) {
    lunchNotified = true;
    pushLifecycleNotice(config, '🌤 午间休市', ['股市 11:30-13:00 午休，您也去休息一下吧，下午 13:00 我再回来继续盯']);
  }
  if (t >= 13 * 60 && !afternoonNotified) {
    afternoonNotified = true;
    pushLifecycleNotice(config, '⏰ 下午盘开启', ['13:00 了，我回来继续为您盯盘，今天剩下的行情交给我']);
  }
  if (t >= eh * 60 + em) sendCloseNotice(config);
}

function isTradeDay(d: Date): boolean {
  return d.getDay() >= 1 && d.getDay() <= 5; // 简单档：周一~周五，节假日不排除
}

function parseHHMM(text: string): [number, number] {
  const [h, m] = text.split(':').map(Number);
  return [h, m];
}

/**
 * 当前时刻是否处于行情推送时间窗口（且为交易日）。
 * 按 A 股交易时段：上午 [start_time, 11:30) + 下午 [13:00, end_time)，
 * 午间 11:30–13:00 休市不推送。
 */
function inPushWindow(now: Date, settings: StockPushConfig): boolean {
  if (!isTradeDay(now)) return false;
  const [sh, sm] = parseHHMM(settings.start_time);
  const [eh, em] = parseHHMM(settings.end_time);
  const t = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const morningEnd = 11 * 60 + 30; // 11:30 午间休市
  const afternoonStart = 13 * 60; // 13:00 下午开盘
  return (t >= start && t < Math.min(end, morningEnd)) || (t >= afternoonStart && t < end);
}

/** 每秒检查：到达推送窗口起点（默认 09:30）时准点推送首次行情 */
function checkPushWindowStart(config: AppConfig): void {
  if (windowStarted) return;
  const now = new Date();
  if (!inPushWindow(now, config.stock_push)) return;
  windowStarted = true;
  runQuotesNow(config)
    .then((n) => logSuccess('stock', `进入推送时间窗（${config.stock_push.start_time}），首次行情推送成功 ${n} 个标的`))
    .catch((err) => logError('stock', `窗口起点行情推送失败: ${(err as Error).message}`));
}

/** 启动股票调度器（行情间隔推送 + 股市时间节点通知） */
export function startStockScheduler(config: AppConfig): void {
  stopStockScheduler();
  windowStarted = false;
  noticeDayKey = '';
  lunchNotified = false;
  afternoonNotified = false;
  closeNotified = false;
  lastConfig = config;

  const settings = config.stock_push;
  const items = config.stocks;
  if (items.length === 0) {
    logInfo('stock', '未配置股票标的，调度器待命');
    return;
  }

  logInfo(
    'stock',
    `调度器启动：${items.length} 个标的，每 ${settings.interval_seconds} 秒推送一次 → ${settings.channel}（时间窗 ${settings.start_time} ~ ${settings.end_time}）`
  );

  // 启动时若已在推送窗口内则立即推送一次（不阻塞启动），否则由每秒检查到点触发
  if (inPushWindow(new Date(), settings)) {
    windowStarted = true;
    runQuotesNow(config)
      .then((n) => logSuccess('stock', `首次行情推送成功 ${n} 个标的`))
      .catch((err) => logError('stock', `首次行情推送失败: ${(err as Error).message}`));
  } else {
    logInfo('stock', `当前不在推送时间窗（${settings.start_time} ~ ${settings.end_time}），到点后自动开始推送`);
  }

  // 间隔推送（仅限推送时间窗口内，窗口外跳过）
  quoteTimer = setInterval(() => {
    if (!inPushWindow(new Date(), settings)) return;
    runQuotesNow(config).catch((err) => logError('stock', `行情推送失败: ${(err as Error).message}`));
  }, settings.interval_seconds * 1000);

  // 窗口起点检查 + 股市时间节点通知（每秒一次，保证整点/准点触发）
  tickTimer = setInterval(() => {
    checkPushWindowStart(config);
    checkLifecycleEvents(config);
  }, 1000);

  // 启动通知：每次启动成功都推送（含推送时间点信息）
  pushLifecycleNotice(config, '📊 盯盘服务已开启', buildStartupNoticeLines(config));
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
