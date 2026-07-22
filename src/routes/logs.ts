import { Router, Request, Response } from 'express';
import { getPushLogs } from '../db/db';

const router = Router();

// GET /api/logs — 获取推送日志
router.get('/', (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const logs = getPushLogs(limit);
  res.json({ success: true, data: logs });
});

export default router;