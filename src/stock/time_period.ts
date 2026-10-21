import { AppConfig } from '../config';
import { isStockTradeDay } from './trading_calendar';

export type TimePeriod =
  | 'pre_market'
  | 'morning_session'
  | 'lunch_break'
  | 'afternoon_session'
  | 'post_market'
  | 'non_trading_day';

interface TimePeriodResult {
  period: TimePeriod;
  title: string;
  lines: string[];
}

function parseHHMM(text: string): [number, number] {
  const [h, m] = text.split(':').map(Number);
  return [h, m];
}

function toMinutes(h: number, m: number): number {
  return h * 60 + m;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function nowTimeStr(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 根据当前时间和配置，判断处于哪个时段，返回对应的标题与文案行。
 */
export function detectTimePeriod(config: AppConfig): TimePeriodResult {
  const settings = config.stock_push;
  const now = new Date();
  const [sh, sm] = parseHHMM(settings.start_time);
  const [eh, em] = parseHHMM(settings.end_time);
  const t = toMinutes(now.getHours(), now.getMinutes());
  const morningEnd = toMinutes(11, 30);
  const afternoonStart = toMinutes(13, 0);
  const startMin = toMinutes(sh, sm);
  const endMin = toMinutes(eh, em);

  if (!isStockTradeDay(now)) {
    return withGoldNote(config, {
      period: 'non_trading_day',
      title: '📅 今日休市',
      lines: [`今日 A 股非交易日，不推送股票行情。RSS 订阅照常运行。`],
    });
  }

  if (t < startMin) {
    const minutesLeft = startMin - t;
    return withGoldNote(config, {
      period: 'pre_market',
      title: '⏳ 盘前待命',
      lines: [
        `服务已启动，距 ${settings.start_time} 开盘还有 ${minutesLeft} 分钟，到时准时推送行情。RSS 订阅已正常轮询。`,
      ],
    });
  }

  if (t < morningEnd) {
    return {
      period: 'morning_session',
      title: `☀️ 早盘盯盘中  ${nowTimeStr()}`,
      lines: [
        `当前处于早盘时段，盯盘服务正常，每 ${settings.interval_seconds} 秒推送一次行情。`,
      ],
    };
  }

  if (t < afternoonStart) {
    return withGoldNote(config, {
      period: 'lunch_break',
      title: '🌤 午间休市',
      lines: [
        `午间休市（${settings.start_time} - ${settings.end_time}），${afternoonStart >= 13 * 60 ? '13:00' : '下午开盘时间'} 前不推送股票行情，RSS 订阅照常运行。`,
      ],
    });
  }

  if (t < endMin) {
    return {
      period: 'afternoon_session',
      title: `🌇 午盘盯盘中  ${nowTimeStr()}`,
      lines: [
        `当前处于午盘时段，盯盘服务正常，每 ${settings.interval_seconds} 秒推送一次行情。`,
      ],
    };
  }

  return withGoldNote(config, {
    period: 'post_market',
    title: '🌙 今日已收盘',
    lines: [
      `已过收盘时间（${settings.end_time}），股票行情推送结束。RSS 订阅照常运行，如需明日盯盘请重启服务。`,
    ],
  });
}

/** 配置了黄金标的时，在股票不推送的时段补充黄金推送安排说明 */
function withGoldNote(config: AppConfig, result: TimePeriodResult): TimePeriodResult {
  const hasGold = config.stocks.some((i) => i.type === 'gold');
  if (!hasGold) return result;
  const quiet = config.quiet_hours ? `${config.quiet_hours.start}~${config.quiet_hours.end}` : '未配置';
  return {
    ...result,
    lines: [...result.lines, `黄金每小时整点推送一次（免打扰时段 ${quiet} 不推），不受 A 股休市影响（周末除外）。`],
  };
}
