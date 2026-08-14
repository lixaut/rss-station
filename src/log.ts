// ===== 统一日志工具：类型标签 + 时间戳 + 颜色 + 状态图标 =====

export type LogType = 'news' | 'stock' | 'system';

const TYPE_TAG: Record<LogType, string> = {
  news: '新闻',
  stock: '股票',
  system: '系统',
};

const TYPE_COLOR: Record<LogType, string> = {
  news: '\x1b[36m', // 青色
  stock: '\x1b[35m', // 品红
  system: '\x1b[33m', // 黄色
};

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m', // 时间戳
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 统一行头：时间戳 + 类型标签 */
function header(type: LogType): string {
  return `${COLORS.dim}[${timestamp()}]${COLORS.reset} ${TYPE_COLOR[type]}${COLORS.bold}[${TYPE_TAG[type]}]${COLORS.reset}`;
}

/** 普通信息 */
export function logInfo(type: LogType, message: string): void {
  console.log(`${header(type)} ${message}`);
}

/** 成功 */
export function logSuccess(type: LogType, message: string): void {
  console.log(`${header(type)} ${COLORS.green}✅ ${message}${COLORS.reset}`);
}

/** 警告 */
export function logWarn(type: LogType, message: string): void {
  console.warn(`${header(type)} ${COLORS.yellow}⚠️ ${message}${COLORS.reset}`);
}

/** 错误 */
export function logError(type: LogType, message: string): void {
  console.error(`${header(type)} ${COLORS.red}❌ ${message}${COLORS.reset}`);
}

/**
 * 多行内容块（如行情表格、盘后报告）：首行带类型标题，内容原样输出
 */
export function logBlock(type: LogType, title: string, text: string): void {
  console.log(`${header(type)} ${title}\n${text}`);
}
