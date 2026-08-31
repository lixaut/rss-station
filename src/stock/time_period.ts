import { AppConfig } from '../config';

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

function isTradeDay(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
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

  if (!isTradeDay(now)) {
    return {
      period: 'non_trading_day',
      title: '📅 今日休市',
      lines: [`今日非交易日，不推送行情。RSS 订阅照常运行。`],
    };
  }

  if (t < startMin) {
    const minutesLeft = startMin - t;
    return {
      period: 'pre_market',
      title: '⏳ 盘前待命',
      lines: [
        `服务已启动，距 ${settings.start_time} 开盘还有 ${minutesLeft} 分钟，到时准时推送行情。RSS 订阅已正常轮询。`,
      ],
    };
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
    return {
      period: 'lunch_break',
      title: '🌤 午间休市',
      lines: [
        `午间休市（${settings.start_time} - ${settings.end_time}），${afternoonStart >= 13 * 60 ? '13:00' : '下午开盘时间'} 前不推送行情，RSS 订阅照常运行。`,
      ],
    };
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

  return {
    period: 'post_market',
    title: '🌙 今日已收盘',
    lines: [
      `已过收盘时间（${settings.end_time}），行情推送结束。RSS 订阅照常运行，如需明日盯盘请重启服务。`,
    ],
  };
}
