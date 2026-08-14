import type { Quote } from './quote';
import type { KlineIndicators } from './kline';
import type { ScoreResult } from './strategy';

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

function reportTimeStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// ===== 盘后分析（14:45 均线/形态 + 仓位建议） =====

/** 盘后分析中单个标的的展示项 */
export interface ReportItem {
  name: string;
  code: string;
  type: 'stock' | 'index';
  price: string;
  change: string;
  change_pct: string;
  ind: KlineIndicators;
  score: number;
  signal: string;
  position: number;
  reasons: Array<[string, number]>;
}

function maText(ma: Record<number, number | null>): string {
  const parts: string[] = [];
  for (const p of Object.keys(ma).map(Number).sort((a, b) => a - b)) {
    const v = ma[p];
    parts.push(v != null ? `MA${p} ${v.toFixed(2)}` : `MA${p} --`);
  }
  return parts.join(' ');
}

function candleText(ind: KlineIndicators): string {
  const body = `${(ind.body * 100).toFixed(1)}%`;
  const upper = `${(ind.upper_shadow * 100).toFixed(1)}%`;
  const lower = `${(ind.lower_shadow * 100).toFixed(1)}%`;
  const kind = ind.is_yang ? '阳线' : '阴线';
  return `${kind} 实体 ${body} 上影 ${upper} 下影 ${lower}`;
}

function signalCounts(items: ReportItem[]): { up: number; down: number; flat: number } {
  const up = items.filter((it) => it.signal === '强多' || it.signal === '偏多').length;
  const down = items.filter((it) => it.signal === '强空' || it.signal === '偏空').length;
  return { up, down, flat: items.length - up - down };
}

export function formatReportConsole(items: ReportItem[], overall: number): string {
  const lines: string[] = [`📋 盘后分析 ${reportTimeStr()}`];
  for (const it of items) {
    const ind = it.ind;
    const color = pctColor(it.change_pct);
    lines.push(`═══ ${it.name}(${it.code}) ═══`);
    lines.push(
      `现价 ${it.price} ${color}${trendIcon(it.change_pct)} ${changePct(it as unknown as Quote)} (${signed(
        it.change
      )})${RESET}`
    );
    lines.push(maText(ind.ma));
    lines.push(candleText(ind));
    lines.push(`信号 ${it.signal} (${it.score >= 0 ? '+' : ''}${it.score.toFixed(2)}) → 建议仓位 ${(it.position * 100).toFixed(0)}%`);
    for (const [text, value] of it.reasons) {
      lines.push(`   ${text}  ${value >= 0 ? '+' : ''}${value.toFixed(2)}`);
    }
    lines.push(`   合计 ${it.score >= 0 ? '+' : ''}${it.score.toFixed(2)}`);
  }
  const counts = signalCounts(items);
  lines.push('═'.repeat(46));
  lines.push(
    `综合建议仓位 ${(overall * 100).toFixed(0)}% · 多 ${counts.up} · 空 ${counts.down} · 中性 ${counts.flat}`
  );
  lines.push('⚠ 技术规则输出，非投资建议');
  return lines.join('\n');
}

export function formatReportLarkCard(items: ReportItem[], overall: number) {
  const elements: any[] = [];
  for (const it of items) {
    const ind = it.ind;
    const pct = asFloat(it.change_pct);
    const color = pct > 0 ? 'red' : pct < 0 ? 'green' : 'grey';
    elements.push({
      tag: 'div',
      fields: [
        {
          is_short: true,
          text: {
            tag: 'lark_md',
            content: `**${it.name}** ${it.code}\n现价 **${it.price}** ${trendIcon(it.change_pct)} <font color='${color}'>${changePct(it as unknown as Quote)}</font>`,
          },
        },
        {
          is_short: true,
          text: {
            tag: 'lark_md',
            content: `信号 **${it.signal}** (${it.score >= 0 ? '+' : ''}${it.score.toFixed(2)})\n建议仓位 **${(it.position * 100).toFixed(0)}%**`,
          },
        },
      ],
    });
    const detail = it.reasons.map(([t, v]) => `${t} ${v >= 0 ? '+' : ''}${v.toFixed(2)}`).join(' ｜ ');
    elements.push({
      tag: 'note',
      elements: [
        {
          tag: 'plain_text',
          content: `${maText(ind.ma)} ｜ ${candleText(ind)}\n分析: ${detail} ＝ ${it.score >= 0 ? '+' : ''}${it.score.toFixed(2)} → ${it.signal} → 建议 ${(it.position * 100).toFixed(0)}%`,
        },
      ],
    });
  }
  const counts = signalCounts(items);
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: `综合建议仓位 ${(overall * 100).toFixed(0)}% · 多 ${counts.up} · 空 ${counts.down} · 中性 ${counts.flat} ｜ ⚠ 技术规则输出，非投资建议`,
      },
    ],
  });
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: 'blue',
        title: { tag: 'plain_text', content: `📋 盘后分析 ${reportTimeStr()}` },
      },
      elements,
    },
  };
}
