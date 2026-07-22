import { Router, Request, Response } from 'express';
import {
  getAllSubscriptions,
  getSubscriptionById,
  addSubscription,
  updateSubscription,
  deleteSubscription,
} from '../db/db';
import { refreshScheduler } from '../scheduler';

const router = Router();

// GET /api/subscriptions — 获取所有订阅源
router.get('/', (_req: Request, res: Response) => {
  const subs = getAllSubscriptions();
  res.json({ success: true, data: subs });
});

// GET /api/subscriptions/:id — 获取单个订阅源
router.get('/:id', (req: Request, res: Response) => {
  const sub = getSubscriptionById(Number(req.params.id));
  if (!sub) {
    res.status(404).json({ success: false, message: '订阅源不存在' });
    return;
  }
  res.json({ success: true, data: sub });
});

// POST /api/subscriptions — 添加订阅源
router.post('/', (req: Request, res: Response) => {
  const { name, url, type, scrape_rules, interval } = req.body;
  if (!name || !url) {
    res.status(400).json({ success: false, message: 'name 和 url 为必填项' });
    return;
  }
  const subType: 'rss' | 'scrape' = type === 'scrape' ? 'scrape' : 'rss';
  if (subType === 'scrape' && !scrape_rules?.itemSelector) {
    res.status(400).json({ success: false, message: 'scrape 类型需要提供 itemSelector 选择器' });
    return;
  }
  try {
    const sub = addSubscription(
      name, url, subType,
      scrape_rules ? JSON.stringify(scrape_rules) : null,
      interval || 30
    );
    refreshScheduler();
    res.status(201).json({ success: true, data: sub });
  } catch (err: any) {
    if (err.code?.startsWith('SQLITE_CONSTRAINT')) {
      res.status(409).json({ success: false, message: '该地址已存在' });
      return;
    }
    throw err;
  }
});

// PUT /api/subscriptions/:id — 更新订阅源
router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = getSubscriptionById(id);
  if (!existing) {
    res.status(404).json({ success: false, message: '订阅源不存在' });
    return;
  }
  const { name, url, type, scrape_rules, interval, enabled } = req.body;
  const fields: any = {};
  if (name !== undefined) fields.name = name;
  if (url !== undefined) fields.url = url;
  if (type !== undefined) fields.type = type === 'scrape' ? 'scrape' : 'rss';
  if (scrape_rules !== undefined) fields.scrape_rules = JSON.stringify(scrape_rules);
  if (interval !== undefined) fields.interval = interval;
  if (enabled !== undefined) fields.enabled = enabled ? 1 : 0;
  updateSubscription(id, fields);
  refreshScheduler();
  res.json({ success: true, data: getSubscriptionById(id) });
});

// DELETE /api/subscriptions/:id — 删除订阅源
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = getSubscriptionById(id);
  if (!existing) {
    res.status(404).json({ success: false, message: '订阅源不存在' });
    return;
  }
  deleteSubscription(id);
  refreshScheduler();
  res.json({ success: true, message: '已删除' });
});

export default router;