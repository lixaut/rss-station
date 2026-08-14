import express from 'express';
import path from 'path';
import { config } from './config';
import { initDb } from './db/db';
import { startScheduler } from './scheduler';
import subscriptionRoutes from './routes/subscriptions';
import webhookRoutes from './routes/webhooks';
import logRoutes from './routes/logs';
import stockRoutes from './routes/stock';
import { triggerPoll } from './scheduler';
import { getAllSubscriptions, getAllWebhooks, getPushLogs } from './db/db';
import { startStockScheduler } from './stock/scheduler';

const app = express();

// ===== 中间件 =====
app.use(express.json());

// ===== API 路由 =====
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/stock', stockRoutes);

// POST /api/test-push — 手动测试推送
app.post('/api/test-push', async (_req, res) => {
  // 找到第一条未推送的文章，如果没有则用最新文章
  const { getUnpushedArticles } = await import('./db/db');
  const subs = getAllSubscriptions();
  let article;

  for (const sub of subs) {
    const articles = getUnpushedArticles(sub.id);
    if (articles.length > 0) {
      article = articles[0];
      break;
    }
  }

  if (!article) {
    res.status(400).json({ success: false, message: '没有可推送的文章，请先添加 RSS 订阅' });
    return;
  }

  const { pushToAllWebhooks } = await import('./webhook/sender');
  const { markArticlePushed } = await import('./db/db');
  const results = await pushToAllWebhooks(article, '测试推送');
  markArticlePushed(article.id);

  res.json({ success: true, data: results });
});

// POST /api/trigger-poll — 手动触发一次轮询
app.post('/api/trigger-poll', async (_req, res) => {
  try {
    await triggerPoll();
    res.json({ success: true, message: '轮询已触发' });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// GET /api/stats — 概览统计
app.get('/api/stats', (_req, res) => {
  const subs = getAllSubscriptions();
  const hooks = getAllWebhooks();
  const logs = getPushLogs(10);
  res.json({
    success: true,
    data: {
      subscriptionCount: subs.length,
      webhookCount: hooks.length,
      recentLogs: logs,
    },
  });
});

// ===== 管理面板静态文件 =====
app.use(express.static(config.adminDir));

// SPA 兜底，未匹配的路由返回 index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(config.adminDir, 'index.html'));
});

// ===== 启动 =====
function main() {
  // 初始化数据库
  initDb();
  console.log('[数据库] 初始化完成');

  // 启动 HTTP 服务
  app.listen(config.port, () => {
    console.log(`[服务] RSS Station 已启动: http://localhost:${config.port}`);

    // 启动定时轮询（每个订阅源按自己的 interval 独立调度）
    startScheduler();

    // 启动股票监控调度（行情间隔推送 + 盘中/收盘报告）
    startStockScheduler();
  });
}

main();