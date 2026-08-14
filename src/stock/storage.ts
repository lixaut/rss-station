import fs from 'fs';
import path from 'path';
import { dbPath } from '../config';

// 仓位历史文件：项目根目录 position_history.md
// 格式：Markdown 表格，按 `## YYYY-MM-DD` 标题行分节（每天一个表格块），滚动保留最近 N 个交易日。
// 浏览器/VS Code 预览即渲染彩色表格（内嵌 HTML span 颜色，涨红跌绿）；放在项目根目录（不在 data/ 忽略范围内），便于提交 git 追踪每日复盘。
const PROJECT_ROOT = path.resolve(dbPath, '../..');
const DEFAULT_FILE = path.join(PROJECT_ROOT, 'position_history.md');
const RECENT_DAYS = 5;

const HEADER = '# 📋 盘后分析历史（最近 5 个交易日）\n\n';

export class StorageError extends Error {}

/** 解析 Markdown 文件中的日期分节，返回 { 日期: 完整分节文本 }；文件不存在/损坏返回空 Map */
function parseSections(filePath: string): Map<string, string> {
  const sections = new Map<string, string>();
  if (!fs.existsSync(filePath)) return sections;

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return sections;
  }

  // 按 `## YYYY-MM-DD` 标题行切分：该行开启新分节，后续行追加到当前分节，直到下一个分节或文件末尾
  const lines = content.split('\n');
  let currentDate: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentDate !== null) {
      sections.set(currentDate, currentLines.join('\n').trimEnd() + '\n');
    }
    currentLines = [];
  };

  for (const line of lines) {
    const m = /^##\s+(\d{4}-\d{2}-\d{2})/.exec(line);
    if (m) {
      flush();
      currentDate = m[1];
      currentLines = [line];
    } else if (currentDate !== null) {
      currentLines.push(line);
    }
  }
  flush();

  return sections;
}

/** 读取历史分节；文件不存在或损坏时返回空对象，不抛异常 */
export function loadHistory(filePath: string = DEFAULT_FILE): Record<string, string> {
  const sections = parseSections(filePath);
  return Object.fromEntries(sections);
}

/**
 * 写入当日盘后分析（Markdown 分节）并滚动裁剪到最近 N 个交易日。
 * @param reportDate 'YYYY-MM-DD'
 * @param reportBlock 以 `## YYYY-MM-DD ...` 开头的完整 Markdown 分节文本
 */
export function saveReport(
  reportDate: string,
  reportBlock: string,
  filePath: string = DEFAULT_FILE,
  recentDays: number = RECENT_DAYS
): string {
  const sections = parseSections(filePath);
  sections.set(reportDate, reportBlock.trimEnd() + '\n');

  // 滚动：仅保留最近 N 个不同日期（YYYY-MM-DD 字符串排序即时间序）
  const keep = [...sections.keys()].sort().reverse().slice(0, recentDays).sort();

  let content = HEADER;
  for (const d of keep) {
    content += sections.get(d) + '\n';
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err) {
    throw new StorageError(`写入历史文件失败: ${(err as Error).message}`);
  }
  return filePath;
}
