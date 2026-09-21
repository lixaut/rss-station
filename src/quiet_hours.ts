/** 免打扰时段配置（HH:MM，支持跨午夜，如 22:00 ~ 08:00） */
export interface QuietHoursConfig {
  start: string;
  end: string;
}

/** "HH:MM" → 当日分钟数 */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 当前时刻是否处于免打扰时段（区间含 start、不含 end）。
 * 支持跨午夜区间（start > end，如 22:00 ~ 08:00）；未配置返回 false。
 */
export function isQuietHours(now: Date, quiet?: QuietHoursConfig): boolean {
  if (!quiet) return false;
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  const t = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end; // 跨午夜
}
