import type { Quote } from './quote';

// ===== 控制台 ANSI 颜色 =====
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// 飞书卡片头部模板颜色（随整体涨跌方向）
const CARD_HEADER_RISE = 'red';
const CARD_HEADER_FALL = 'green';
const CARD_HEADER_FLAT = 'blue';

const CONSOLE_NAME_W = 10; // 控制台名称列宽（按显示宽度）
const CONSOLE_PRICE_W = 10; // 控制台价格列宽

// ===== 工具函数 =====

function timeStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 行情接口返回 yyyyMMddHHmmss，转换为 HH:MM:SS */
function quoteTime(q: Quote): string {
  const raw = q.time || '';
  if (raw.length >= 14 && /^\d+$/.test(raw)) {
    return `${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`;
  }
  return raw || '--';
}

function asFloat(value: unknown): number {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : 0.0;
}

/** 按终端显示宽度计数：中文等宽字符占 2 列 */
function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
  }
  return w;
}

function padLeft(text: string, width: number): string {
  const s = String(text ?? '');
  return ' '.repeat(Math.max(0, width - displayWidth(s))) + s;
}

function padRight(text: string, width: number): string {
  const s = String(text ?? '');
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

/** 强制补 + 号；缺失值显示 -- */
function signed(value: string, suffix = ''): string {
  const text = String(value ?? '').trim();
  if (!text || text === '--') return '--';
  if (text.startsWith('-')) return text + suffix;
  return '+' + text + suffix;
}

function trendIcon(pct: string): string {
  const v = asFloat(pct);
  if (v > 0) return '▲';
  if (v < 0) return '▼';
  return '―';
}

/** A 股习惯：涨红跌绿 */
function pctColor(pct: string): string {
  const v = asFloat(pct);
  if (v > 0) return RED;
  if (v < 0) return GREEN;
  return YELLOW;
}

/** 优先使用配置的展示名（alias），其次行情接口名称 */
function nameOf(q: Quote): string {
  return q.alias || q.name || q.code;
}

function priceOf(q: Quote): string {
  return q.price || '--';
}

function priceLabel(q: Quote): string {
  return q.type === 'index' ? '点位' : '现价';
}

function changePct(q: Quote): string {
  return signed(q.change_pct, '%');
}

/** 按 股票/指数 分组（组内保持配置顺序） */
function groupQuotes(quotes: Quote[]): Record<string, Quote[]> {
  const groups: Record<string, Quote[]> = { 股票: [], 指数: [] };
  for (const q of quotes) {
    const key = q.type === 'index' ? '指数' : '股票';
    groups[key].push(q);
  }
  return groups;
}

function upDownCount(quotes: Quote[]): [number, number] {
  let up = 0;
  let down = 0;
  for (const q of quotes) {
    const v = asFloat(q.change_pct);
    if (v > 0) up++;
    else if (v < 0) down++;
  }
  return [up, down];
}

// ===== 控制台 =====

export function formatConsole(quotes: Quote[]): string {
  const lines: string[] = [];
  for (const [label, items] of Object.entries(groupQuotes(quotes))) {
    if (items.length === 0) continue;
    lines.push(`═══ ${label} ═══`);
    for (const q of items) {
      const color = pctColor(q.change_pct);
      lines.push(
        `${padRight(nameOf(q), CONSOLE_NAME_W)} ${q.code}  ${priceLabel(q)} ${padLeft(
          priceOf(q),
          CONSOLE_PRICE_W
        )}  ${color}${trendIcon(q.change_pct)} ${changePct(q).padStart(8)}  (${signed(
          q.change
        )})${RESET}`
      );
    }
  }
  const [up, down] = upDownCount(quotes);
  lines.push('═'.repeat(46));
  lines.push(`共 ${quotes.length} 个标的 · 上涨 ${up} · 下跌 ${down} · ${timeStr()}`);
  return lines.join('\n');
}

// ===== 飞书交互卡片 =====

/** 卡片头部颜色随整体涨跌：涨多红底、跌多绿底、持平蓝底 */
function cardHeader(quotes: Quote[]) {
  const [up, down] = upDownCount(quotes);
  let template = CARD_HEADER_FLAT;
  if (up > down) template = CARD_HEADER_RISE;
  else if (down > up) template = CARD_HEADER_FALL;
  return {
    template,
    title: { tag: 'plain_text', content: `📈 行情播报 ${timeStr()}` },
  };
}

function cardLine(q: Quote) {
  const v = asFloat(q.change_pct);
  const color = v > 0 ? 'red' : v < 0 ? 'green' : 'grey';
  return {
    tag: 'div',
    fields: [
      {
        is_short: true,
        text: {
          tag: 'lark_md',
          content: `**${nameOf(q)}** ${q.code}\n${priceLabel(q)} **${priceOf(q)}**`,
        },
      },
      {
        is_short: true,
        text: {
          tag: 'lark_md',
          content: `<font color='${color}'>${trendIcon(q.change_pct)} ${changePct(q)}  (${signed(
            q.change
          )})</font>`,
        },
      },
    ],
  };
}

/** 生成飞书 interactive 卡片消息 dict（msg_type + card） */
export function formatLarkCard(quotes: Quote[]) {
  const elements: any[] = [];
  let first = true;
  for (const [label, items] of Object.entries(groupQuotes(quotes))) {
    if (items.length === 0) continue;
    if (!first) elements.push({ tag: 'hr' });
    first = false;
    elements.push({
      tag: 'div',
      fields: [{ is_short: false, text: { tag: 'lark_md', content: `**${label}**` } }],
    });
    for (const q of items) elements.push(cardLine(q));
  }
  const [up, down] = upDownCount(quotes);
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: `更新时间 ${timeStr()} · 共 ${quotes.length} 个标的 · 上涨 ${up} · 下跌 ${down}`,
      },
    ],
  });
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: cardHeader(quotes),
      elements,
    },
  };
}

// ===== 生命周期通知（启动/午间休市/下午开盘/收盘/停止） =====

/** 通知时间戳 yyyy-MM-dd HH:MM */
function noticeTimeStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 控制台生命周期通知：标题 + 正文行 */
export function formatNoticeConsole(title: string, lines: string[]): string {
  return [`${title}  ${noticeTimeStr()}`, ...lines].join('\n');
}

/** 飞书生命周期通知卡片（简单文本卡片，蓝色头） */
export function formatNoticeLarkCard(title: string, lines: string[]): unknown {
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: 'blue',
        title: { tag: 'plain_text', content: title },
      },
      elements: [
        {
          tag: 'div',
          fields: [{ is_short: false, text: { tag: 'lark_md', content: lines.join('\n') } }],
        },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: noticeTimeStr() }],
        },
      ],
    },
  };
}
