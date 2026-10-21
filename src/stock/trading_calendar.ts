import { logWarn } from '../log';

/**
 * A 股交易日历：周一~周五且非法定节假日（调休上班的周末 A 股仍休市，无需处理）。
 * 节假日数据按国务院办公厅年度通知维护：每年 11~12 月发布次年安排，
 * 届时在 HOLIDAYS 中补充下一年日期即可（格式 MM-DD）。
 * 未收录年份回退为"仅排除周末"并提示一次，避免推送逻辑中断。
 */
const HOLIDAYS: Record<string, string[]> = {
  // 国务院办公厅关于2026年部分节假日安排的通知（国办发明电〔2025〕7号）
  2026: [
    // 元旦：1月1日~3日
    '01-01', '01-02', '01-03',
    // 春节：2月15日~23日
    '02-15', '02-16', '02-17', '02-18', '02-19', '02-20', '02-21', '02-22', '02-23',
    // 清明节：4月4日~6日
    '04-04', '04-05', '04-06',
    // 劳动节：5月1日~5日
    '05-01', '05-02', '05-03', '05-04', '05-05',
    // 端午节：6月19日~21日
    '06-19', '06-20', '06-21',
    // 中秋节：9月25日~27日
    '09-25', '09-26', '09-27',
    // 国庆节：10月1日~7日
    '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07',
  ],
};

const warnedYears = new Set<string>();

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** A 股交易日：周一~周五且非法定节假日 */
export function isStockTradeDay(d: Date): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const year = String(d.getFullYear());
  const holidays = HOLIDAYS[year];
  if (!holidays) {
    if (!warnedYears.has(year)) {
      warnedYears.add(year);
      logWarn(
        'stock',
        `${year} 年节假日数据未收录，请按国务院通知更新 src/stock/trading_calendar.ts；当前仅按周一~周五判断交易日`
      );
    }
    return true;
  }
  const mmdd = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return !holidays.includes(mmdd);
}

/**
 * 国际黄金可推送日：周一~周五。
 * 伦敦金/纽约金周末休市（北京时间周六凌晨收盘、周一早间开盘），
 * 且国际金在中国法定节假日照常交易，故不按 A 股节假日排除。
 */
export function isGoldTradeDay(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}
