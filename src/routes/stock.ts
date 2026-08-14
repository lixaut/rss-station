import { Router, Request, Response } from 'express';
import {
  getStockItems,
  getStockSettings,
  addStockItem,
  updateStockItem,
  deleteStockItem,
  updateStockSettings,
  replaceStockItems,
} from '../db/db';
import { parseStockConfig } from '../stock/config';
import { runQuotesNow, runReportNow, refreshStockScheduler } from '../stock/scheduler';
import { loadHistory } from '../stock/storage';

const router = Router();

// GET /api/stock — 获取股票监控配置（设置 + 标的列表 + 历史）
router.get('/', (_req: Request, res: Response) => {
  const settings = getStockSettings();
  const items = getStockItems();
  const history = loadHistory();
  res.json({
    success: true,
    data: {
      settings: {
        interval_seconds: settings.interval_seconds,
        channel: settings.channel,
        webhook_url: settings.webhook_url,
        daily_report: {
          enabled: !!settings.report_enabled,
          time: settings.report_time,
          close_time: settings.close_time,
          auto_exit: !!settings.auto_exit,
          ma_periods: safeParseMaPeriods(settings.ma_periods),
        },
      },
      items,
      history,
    },
  });
});

function safeParseMaPeriods(raw: string): number[] {
  try {
    const arr = JSON.parse(raw || '[5,10,20,60]') as unknown;
    if (Array.isArray(arr) && arr.every((p) => Number.isInteger(p) && (p as number) > 0)) {
      return arr as number[];
    }
  } catch {
    // 忽略解析失败
  }
  return [5, 10, 20, 60];
}

// PUT /api/stock/settings — 更新全局设置
router.put('/settings', (req: Request, res: Response) => {
  const {
    interval_seconds,
    channel,
    webhook_url,
    daily_report,
  } = req.body as {
    interval_seconds?: number;
    channel?: string;
    webhook_url?: string;
    daily_report?: {
      enabled?: boolean;
      time?: string;
      close_time?: string | null;
      auto_exit?: boolean;
      ma_periods?: number[];
    };
  };

  const fields: Parameters<typeof updateStockSettings>[0] = {};
  if (interval_seconds !== undefined) {
    if (!Number.isFinite(interval_seconds) || interval_seconds <= 0) {
      res.status(400).json({ success: false, message: 'interval_seconds 必须大于 0' });
      return;
    }
    fields.interval_seconds = interval_seconds;
  }
  if (channel !== undefined) {
    if (channel !== 'console' && channel !== 'lark') {
      res.status(400).json({ success: false, message: 'channel 仅支持 console / lark' });
      return;
    }
    fields.channel = channel;
  }
  if (webhook_url !== undefined) {
    if (channel === 'lark' && !webhook_url.startsWith('https://')) {
      res.status(400).json({ success: false, message: 'lark 通道必须配置有效的 webhook_url' });
      return;
    }
    fields.webhook_url = webhook_url;
  }
  if (daily_report !== undefined) {
    if (typeof daily_report !== 'object' || daily_report === null) {
      res.status(400).json({ success: false, message: 'daily_report 必须是 JSON 对象' });
      return;
    }
    if (daily_report.enabled !== undefined) fields.report_enabled = daily_report.enabled ? 1 : 0;
    if (daily_report.time !== undefined) {
      if (!/^\d{1,2}:\d{2}$/.test(daily_report.time)) {
        res.status(400).json({ success: false, message: 'daily_report.time 格式应为 HH:MM' });
        return;
      }
      fields.report_time = daily_report.time;
    }
    if (daily_report.close_time !== undefined) {
      const ct = daily_report.close_time;
      if (ct && !/^\d{1,2}:\d{2}$/.test(ct)) {
        res.status(400).json({ success: false, message: 'daily_report.close_time 格式应为 HH:MM' });
        return;
      }
      fields.close_time = ct || null;
    }
    if (daily_report.auto_exit !== undefined) fields.auto_exit = daily_report.auto_exit ? 1 : 0;
    if (daily_report.ma_periods !== undefined) {
      const mp = daily_report.ma_periods;
      if (!Array.isArray(mp) || mp.length === 0 || !mp.every((p) => Number.isInteger(p) && p > 0)) {
        res.status(400).json({ success: false, message: 'ma_periods 必须是正整数列表' });
        return;
      }
      fields.ma_periods = JSON.stringify([...mp].sort((a, b) => a - b));
    }
  }

  updateStockSettings(fields);
  refreshStockScheduler();
  res.json({ success: true, data: getStockSettings() });
});

// POST /api/stock/items — 添加标的
router.post('/items', (req: Request, res: Response) => {
  const { code, market, type, alias } = req.body as {
    code?: string;
    market?: string;
    type?: string;
    alias?: string;
  };
  if (!code || !String(code).trim()) {
    res.status(400).json({ success: false, message: 'code 为必填项' });
    return;
  }
  const m = (market || '').toLowerCase();
  if (m !== 'sh' && m !== 'sz') {
    res.status(400).json({ success: false, message: 'market 必须是 sh 或 sz' });
    return;
  }
  const t = type === 'index' ? 'index' : 'stock';
  try {
    const item = addStockItem(String(code).trim(), m, t, alias || null);
    refreshStockScheduler();
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// PUT /api/stock/items/:id — 更新标的
router.put('/items/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { code, market, type, alias, enabled } = req.body as {
    code?: string;
    market?: string;
    type?: string;
    alias?: string;
    enabled?: boolean;
  };
  const fields: Parameters<typeof updateStockItem>[1] = {};
  if (code !== undefined) fields.code = String(code).trim();
  if (market !== undefined) {
    const m = String(market).toLowerCase();
    if (m !== 'sh' && m !== 'sz') {
      res.status(400).json({ success: false, message: 'market 必须是 sh 或 sz' });
      return;
    }
    fields.market = m;
  }
  if (type !== undefined) fields.type = type === 'index' ? 'index' : 'stock';
  if (alias !== undefined) fields.alias = alias || null;
  if (enabled !== undefined) fields.enabled = enabled ? 1 : 0;
  try {
    updateStockItem(id, fields);
    refreshStockScheduler();
    res.json({ success: true, data: getStockItems().find((i) => i.id === id) });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// DELETE /api/stock/items/:id — 删除标的
router.delete('/items/:id', (req: Request, res: Response) => {
  deleteStockItem(Number(req.params.id));
  refreshStockScheduler();
  res.json({ success: true, message: '已删除' });
});

// POST /api/stock/import-config — 从 config.json 内容一键导入
router.post('/import-config', (req: Request, res: Response) => {
  const { json } = req.body as { json?: string };
  if (!json || typeof json !== 'string') {
    res.status(400).json({ success: false, message: '缺少 config.json 内容（json 字段）' });
    return;
  }
  try {
    const parsed = parseStockConfig(json);
    replaceStockItems(
      parsed.items.map((it) => ({ ...it, alias: it.alias || null }))
    );
    updateStockSettings({
      interval_seconds: parsed.settings.interval_seconds,
      channel: parsed.settings.channel,
      webhook_url: parsed.settings.webhook_url,
      report_enabled: parsed.settings.daily_report.enabled ? 1 : 0,
      report_time: parsed.settings.daily_report.time,
      close_time: parsed.settings.daily_report.close_time,
      auto_exit: parsed.settings.daily_report.auto_exit ? 1 : 0,
      ma_periods: JSON.stringify(parsed.settings.daily_report.ma_periods),
    });
    refreshStockScheduler();
    res.json({ success: true, data: getStockItems(), message: '导入成功' });
  } catch (err) {
    res.status(400).json({ success: false, message: (err as Error).message });
  }
});

// POST /api/stock/push-now — 立即推送一次行情
router.post('/push-now', async (_req: Request, res: Response) => {
  try {
    const count = await runQuotesNow();
    res.json({ success: true, message: `已推送 ${count} 个标的`, data: { count } });
  } catch (err) {
    res.status(400).json({ success: false, message: (err as Error).message });
  }
});

// POST /api/stock/report-now — 立即执行一次盘后分析
router.post('/report-now', async (_req: Request, res: Response) => {
  try {
    const count = await runReportNow();
    res.json({ success: true, message: `盘后分析已推送 ${count} 个标的`, data: { count } });
  } catch (err) {
    res.status(400).json({ success: false, message: (err as Error).message });
  }
});

export default router;
