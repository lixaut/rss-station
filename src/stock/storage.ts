import fs from 'fs';
import path from 'path';
import { dbPath } from '../config';

// 仓位历史文件：data/position_history.json，按日期键组织，滚动保留最近 N 个交易日
const DATA_DIR = path.resolve(dbPath, '..');
const DEFAULT_FILE = path.join(DATA_DIR, 'position_history.json');
const RECENT_DAYS = 5;

export class StorageError extends Error {}

/** 读取历史记录；文件不存在或损坏时返回空 dict，不抛异常 */
export function loadHistory(filePath: string = DEFAULT_FILE): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** 写入当日盘后分析并滚动裁剪到最近 N 个交易日 */
export function saveReport(
  reportDate: string,
  report: unknown,
  filePath: string = DEFAULT_FILE,
  recentDays: number = RECENT_DAYS
): string {
  const history = loadHistory(filePath);
  history[reportDate] = report;
  // 滚动：仅保留最近 N 个不同日期（YYYY-MM-DD 字符串排序即时间序）
  const keep = Object.keys(history).sort().reverse().slice(0, recentDays);
  const trimmed: Record<string, unknown> = {};
  for (const d of keep.sort()) trimmed[d] = history[d];
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (err) {
    throw new StorageError(`写入历史文件失败: ${(err as Error).message}`);
  }
  return filePath;
}
