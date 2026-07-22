import { Router, Request, Response } from 'express';
import {
  getAllWebhooks,
  getWebhookById,
  addWebhook,
  updateWebhook,
  deleteWebhook,
} from '../db/db';

const router = Router();

// GET /api/webhooks — 获取所有 Webhook 配置
router.get('/', (_req: Request, res: Response) => {
  const hooks = getAllWebhooks();
  res.json({ success: true, data: hooks });
});

// GET /api/webhooks/:id — 获取单个 Webhook
router.get('/:id', (req: Request, res: Response) => {
  const hook = getWebhookById(Number(req.params.id));
  if (!hook) {
    res.status(404).json({ success: false, message: 'Webhook 不存在' });
    return;
  }
  res.json({ success: true, data: hook });
});

// POST /api/webhooks — 添加 Webhook
router.post('/', (req: Request, res: Response) => {
  const { name, url, template } = req.body;
  if (!name || !url) {
    res.status(400).json({ success: false, message: 'name 和 url 为必填项' });
    return;
  }
  const hook = addWebhook(name, url, template || 'markdown');
  res.status(201).json({ success: true, data: hook });
});

// PUT /api/webhooks/:id — 更新 Webhook
router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = getWebhookById(id);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Webhook 不存在' });
    return;
  }
  const { name, url, template, enabled } = req.body;
  const fields: any = {};
  if (name !== undefined) fields.name = name;
  if (url !== undefined) fields.url = url;
  if (template !== undefined) fields.template = template;
  if (enabled !== undefined) fields.enabled = enabled ? 1 : 0;
  updateWebhook(id, fields);
  res.json({ success: true, data: getWebhookById(id) });
});

// DELETE /api/webhooks/:id — 删除 Webhook
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = getWebhookById(id);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Webhook 不存在' });
    return;
  }
  deleteWebhook(id);
  res.json({ success: true, message: '已删除' });
});

export default router;