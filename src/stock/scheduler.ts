import axios from 'axios';
import { AppConfig, StockItemConfig, StockPushConfig } from '../config';
import { logInfo, logSuccess, logError, logWarn, logBlock } from '../log';
import { fetchQuotes, StockItem } from './quote';
import {
  formatConsole,
  formatLarkCard,
  formatNoticeConsole,
  formatNoticeLarkCard,
} from './formatter';
import { detectTimePeriod } from './time_period';
import { isQuietHours } from '../quiet_hours';
import { isStockTradeDay, isGoldTradeDay } from './trading_calendar';

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

/** 可重试的瞬时错误：飞书整点/半点限流（11232 frequency limited）、内部错误、HTTP 429/5xx、网络超时 */
const TRANSIENT_ERROR = /frequency limited|internal error|HTTP (429|5\d\d)|ETIMEDOUT|ECONNRESET|ECONNREFUSED|timeout/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class LarkPusher implements Pusher {
  constructor(private webhookUrl: string, private timeout = 5000) {}

  private async post(payload: unknown): Promise<void> {
    const maxAttempts = 3;
    let lastError = new PusherError('飞书推送失败');
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let transient = false;
      try {
        const resp = await axios.post(this.webhookUrl, payload, { timeout: this.timeout });
        const result: any = resp.data;
        if (result && typeof result === 'object' && result.code !== undefined && result.code !== 0) {
          lastError = new PusherError(`飞书推送失败: ${result.msg || JSON.stringify(result)}`);
          transient = TRANSIENT_ERROR.test(lastError.message);
        } else {
          return;
        }
      } catch (err: any) {
        const msg = err.response ? `HTTP ${err.response.status}` : (err as Error).message;
        lastError = new PusherError(`飞书推送失败: ${msg}`);
        transient = TRANSIENT_ERROR.test(msg);
      }
      if (!transient || attempt === maxAttempts) throw lastError;
      const delay = 3000 * attempt + Math.floor(Math.random() * 4000);
      logWarn('stock', `飞书瞬时限流，${Math.round(delay / 1000)}s 后重试 (${attempt}/${maxAttempts}): ${lastError.message}`);
      await sleep(delay);
    }
    throw lastError;
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

function stockItems(config: AppConfig): StockItemConfig[] {
  return config.stocks.filter((i) => i.type !== 'gold');
}

function goldItems(config: AppConfig): StockItemConfig[] {
  return config.stocks.filter((i) => i.type === 'gold');
}

/** 拉取并推送一批标的，返回标的数量 */
async function pushQuoteItems(config: AppConfig, items: StockItemConfig[]): Promise<number> {
  if (items.length === 0) return 0;
  const quotes = await fetchQuotes(toQuoteItems(items));
  await getPusher(config.stock_push).push(quotes);
  return quotes.length;
}

/** 立即拉取并推送一次股票/指数行情（不含黄金），返回标的数量 */
async function runStockQuotesNow(config: AppConfig): Promise<number> {
  const items = stockItems(config);
  if (items.length === 0) throw new Error('暂无配置股票标的');
  return pushQuoteItems(config, items);
}

/** 立即拉取并推送一次黄金行情（仅 gold 标的），返回标的数量（无黄金标的时为 0） */
export async function runGoldQuotesNow(config: AppConfig): Promise<number> {
  return pushQuoteItems(config, goldItems(config));
}

/** 立即推送完整行情（股票/指数 + 黄金各推一卡），返回标的总数。手动 --once 用 */
export async function runQuotesNow(config: AppConfig): Promise<number> {
  const stocks = stockItems(config);
  const golds = goldItems(config);
  if (stocks.length === 0 && golds.length === 0) throw new Error('暂无配置行情标的');
  let total = 0;
  if (stocks.length > 0) total += await pushQuoteItems(config, stocks);
  if (golds.length > 0) total += await pushQuoteItems(config, golds);
  return total;
}

function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ===== 调度器 =====

let quoteTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let windowStarted = false; // 当天是否已进入推送窗口并完成首次推送
let lastGoldPushKey = ''; // 最近一次黄金整点推送的标记（日期-小时），防止同一小时重复推

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
  // 免打扰时段不推通知（行情推送本身只发生在交易时段，不在此列）
  if (isQuietHours(new Date(), config.quiet_hours)) return;
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
  if (isQuietHours(new Date(), config.quiet_hours)) return Promise.resolve();
  const notice = {
    console: formatNoticeConsole(title, lines),
    lark: formatNoticeLarkCard(title, lines),
  };
  return getPusher(config.stock_push).pushNotice(notice).catch((err) => {
    logError('stock', `通知推送失败(${title}): ${(err as Error).message}`);
  });
}

/** 收盘结束通知（当日最后一次通知），防重复 */
function sendCloseNotice(config: AppConfig): void {
  if (closeNotified) return;
  closeNotified = true;
  pushLifecycleNotice(config, '🌙 今日已收盘', ['辛苦啦，今天的盯盘结束，明天开盘见！']);
}

/** 每秒检查：午间休市/下午开盘/收盘等股市时间节点通知（交易日，每天各一次，不补发） */
function checkLifecycleEvents(config: AppConfig): void {
  const now = new Date();
  if (!isStockTradeDay(now)) return;
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

function parseHHMM(text: string): [number, number] {
  const [h, m] = text.split(':').map(Number);
  return [h, m];
}

/**
 * 当前时刻是否处于股票行情推送时间窗口（A 股交易日）。
 * 按 A 股交易时段：上午 [start_time, 11:30) + 下午 [13:00, end_time)，
 * 午间 11:30–13:00 休市不推送；交易日 = 周一~周五且非法定节假日。
 */
function inPushWindow(now: Date, settings: StockPushConfig): boolean {
  if (!isStockTradeDay(now)) return false;
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
  runStockQuotesNow(config)
    .then((n) => logSuccess('stock', `进入推送时间窗（${config.stock_push.start_time}），首次行情推送成功 ${n} 个标的`))
    .catch((err) => logError('stock', `窗口起点行情推送失败: ${(err as Error).message}`));
}

/**
 * 黄金是否可推送：周一~周五（国际金周末休市，法定节假日照常交易不排除），
 * 且不在免打扰时段（即"睡觉时间"不推）。
 */
function canPushGold(now: Date, config: AppConfig): boolean {
  if (!isGoldTradeDay(now)) return false;
  return !isQuietHours(now, config.quiet_hours);
}

/** 每秒检查：整点推送一次黄金行情（可推送时段内，每小时最多一次） */
function checkGoldQuotePush(config: AppConfig): void {
  if (goldItems(config).length === 0) return;
  const now = new Date();
  if (now.getMinutes() !== 0) return;
  if (!canPushGold(now, config)) return;
  const key = `${localDateKey(now)}-${now.getHours()}`;
  if (key === lastGoldPushKey) return;
  lastGoldPushKey = key;
  // 避开整点：飞书在整点是全员发送高峰，延后随机 5~25 秒再发，显著降低 11232 限流概率
  const delay = 5000 + Math.floor(Math.random() * 20000);
  setTimeout(() => {
    if (!canPushGold(new Date(), config)) return;
    runGoldQuotesNow(config)
      .then((n) => {
        if (n > 0) logSuccess('stock', `黄金整点行情推送成功 ${n} 个标的`);
      })
      .catch((err) => logError('stock', `黄金行情推送失败: ${(err as Error).message}`));
  }, delay);
}

/** 启动股票调度器（股票按 A 股时间窗推送；黄金每小时整点推送，免打扰时段除外） */
export function startStockScheduler(config: AppConfig): void {
  stopStockScheduler();
  windowStarted = false;
  lastGoldPushKey = '';
  const today = localDateKey(new Date());
  noticeDayKey = today;
  lastConfig = config;

  const settings = config.stock_push;
  const stocks = stockItems(config);
  const golds = goldItems(config);
  if (stocks.length === 0 && golds.length === 0) {
    logInfo('stock', '未配置行情标的，调度器待命');
    return;
  }

  const parts: string[] = [];
  if (stocks.length > 0) {
    parts.push(
      `股票/指数 ${stocks.length} 个标的，每 ${settings.interval_seconds} 秒推送一次（时间窗 ${settings.start_time} ~ ${settings.end_time}，节假日休市）`
    );
  }
  if (golds.length > 0) {
    parts.push(
      `黄金 ${golds.length} 个标的，每小时整点推送一次（免打扰时段${config.quiet_hours ? ` ${config.quiet_hours.start}~${config.quiet_hours.end}` : '未配置'}不推，节假日照常）`
    );
  }
  logInfo('stock', `调度器启动：${parts.join('；')} → ${settings.channel}`);

  // 根据启动时当前时间预判当日已错过哪些生命周期节点（不补发）
  const now = new Date();
  if (isStockTradeDay(now)) {
    const t = now.getHours() * 60 + now.getMinutes();
    if (t >= 11 * 60 + 30) lunchNotified = true;
    if (t >= 13 * 60) afternoonNotified = true;
    const [eh, em] = parseHHMM(settings.end_time);
    if (t >= eh * 60 + em) closeNotified = true;
  }

  // 启动时若已在推送窗口内则立即推送一次股票行情（不阻塞启动），否则由每秒检查到点触发
  if (stocks.length > 0) {
    if (inPushWindow(new Date(), settings)) {
      windowStarted = true;
      runStockQuotesNow(config)
        .then((n) => logSuccess('stock', `首次行情推送成功 ${n} 个标的`))
        .catch((err) => logError('stock', `首次行情推送失败: ${(err as Error).message}`));
    } else {
      logInfo('stock', `当前不在股票推送时间窗（${settings.start_time} ~ ${settings.end_time}），到点后自动开始推送`);
    }
  }

  // 间隔推送（仅限推送时间窗口内，窗口外跳过；黄金走独立整点推送）
  if (stocks.length > 0) {
    quoteTimer = setInterval(() => {
      if (!inPushWindow(new Date(), settings)) return;
      runStockQuotesNow(config).catch((err) => logError('stock', `行情推送失败: ${(err as Error).message}`));
    }, settings.interval_seconds * 1000);
  }

  // 窗口起点检查 + 股市时间节点通知 + 黄金整点推送（每秒一次，保证整点/准点触发）
  tickTimer = setInterval(() => {
    checkPushWindowStart(config);
    checkLifecycleEvents(config);
    checkGoldQuotePush(config);
  }, 1000);

  // 启动通知：根据当前时段推送差异化提示
  const timeInfo = detectTimePeriod(config);
  pushLifecycleNotice(config, timeInfo.title, timeInfo.lines);
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
