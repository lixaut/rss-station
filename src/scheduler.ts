import { AppConfig, SubscriptionConfig, WebhookConfig } from './config';
import {
  updateLastFetched,
  updateLastGuids,
  insertArticle,
  markArticlePushed,
} from './db/db';
import { logInfo, logSuccess, logWarn, logError } from './log';
import { fetchFeed } from './rss/fetcher';
import { scrapePage, fetchArticleContent, ScrapeRule } from './scraper/scraper';
import { detectNewArticles } from './rss/detector';
import { pushToAllWebhooks, stripHtml } from './webhook/sender';
import { isQuietHours } from './quiet_hours';

/** 每个订阅源的定时器 map（key: 订阅 URL） */
const timers = new Map<string, ReturnType<typeof setInterval>>();

/**
 * 轮询单个订阅源
 */
async function pollSubscription(sub: SubscriptionConfig, webhooks: WebhookConfig[], quiet?: AppConfig['quiet_hours']): Promise<void> {
  // 免打扰时段：整轮跳过（不抓取、不入库、不推送），下次轮询到点自然恢复
  if (isQuietHours(new Date(), quiet)) {
    logInfo('news', `免打扰时段（${quiet!.start} ~ ${quiet!.end}），跳过 ${sub.name}`);
    return;
  }

  const { url, name, type, scrape_rules } = sub;

  let feedTitle: string;
  let contentSelector: string | undefined;
  let items: { guid: string; title: string; link: string; content?: string }[];

  try {
    if (type === 'scrape' && scrape_rules) {
      // 网页抓取模式
      const rule: ScrapeRule = scrape_rules;
      contentSelector = rule.contentSelector;
      const result = await scrapePage(url, rule);
      feedTitle = result.title;
      items = result.items.slice(0, 5);
    } else {
      // 标准 RSS 模式
      const feed = await fetchFeed(url);
      feedTitle = feed.title;
      items = feed.items;
    }
  } catch (err) {
    logError('news', `${name} 抓取失败: ${(err as Error).message}`);
    return;
  }

  // 检测新文章，最多取前 5 条推送，防止滥用
  const newItems = detectNewArticles(url, items).slice(0, 5);
  if (newItems.length === 0) {
    logInfo('news', `${name} 无新文章`);
    updateLastFetched(url);
    return;
  }

  logInfo('news', `${name} 发现 ${newItems.length} 篇新文章`);

  // 如果有 contentSelector，并行抓取每篇文章的全文
  if (contentSelector) {
    const contents = await Promise.allSettled(
      newItems.map((item) => fetchArticleContent(item.link, contentSelector!))
    );
    contents.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        newItems[i].content = result.value;
      } else {
        logWarn('news', `${name} 文章 ${i + 1}: 正文抓取失败`);
      }
    });
  }

  // 入库
  for (const item of newItems) {
    const article = insertArticle({
      subscription_url: url,
      guid: item.guid,
      title: item.title,
      link: item.link,
      pub_date: null,
      content: item.content || null,
    });

    // 推送
    if (article) {
      // 标题和内容一样时跳过推送（说明正文抓取失败，内容被标题填充）。
      // 注意：content 是 HTML，需先剥离标签得到纯文本再与标题比较，
      // 否则 `<p>标题</p>` 永远不等于 `标题`，判断会失效。
      const plainContent = stripHtml(article.content || '').trim();
      if (!plainContent) {
        logWarn('news', `${name} 跳过推送: "${article.title}" (正文为空)`);
        markArticlePushed(article.id);
        continue;
      }
      if (plainContent === article.title.trim()) {
        logWarn('news', `${name} 跳过推送: "${article.title}" (标题与内容相同)`);
        markArticlePushed(article.id);
        continue;
      }

      try {
        const results = await pushToAllWebhooks(article, feedTitle, webhooks);
        const successCount = results.filter((r) => r.success).length;
        if (successCount > 0) {
          markArticlePushed(article.id);
          logSuccess('news', `${name} 推送成功: "${article.title}" -> ${successCount} 个 Webhook`);
        } else {
          logWarn('news', `${name} 推送失败: "${article.title}"`);
        }
      } catch (err) {
        logError('news', `${name} 推送异常: ${(err as Error).message}`);
      }
    }
  }

  // 更新缓存：只保留本次抓取的最新 5 条 GUID 用于下次比较
  const allGuids = items.map((item) => item.guid);
  updateLastGuids(url, allGuids);
  updateLastFetched(url);
}

/**
 * 轮询所有启用的订阅源（用于手动触发）
 */
async function pollAll(config: AppConfig): Promise<void> {
  const subs = config.subscriptions;
  if (subs.length === 0) {
    logInfo('news', '暂无订阅源');
    return;
  }

  logInfo('news', `开始轮询 ${subs.length} 个订阅源...`);

  // 并行抓取所有订阅源
  await Promise.allSettled(
    subs.map((sub: SubscriptionConfig) => pollSubscription(sub, config.webhooks, config.quiet_hours))
  );

  logInfo('news', '本轮轮询结束');
}

/**
 * 获取订阅源的轮询间隔（毫秒）
 */
function getIntervalMs(sub: SubscriptionConfig): number {
  const minutes = (sub.interval_minutes && sub.interval_minutes > 0) ? sub.interval_minutes : 30;
  return minutes * 60 * 1000;
}

/**
 * 启动调度器，为每个订阅源创建独立定时器
 */
export function startScheduler(config: AppConfig): void {
  stopScheduler();

  const subs = config.subscriptions;
  if (subs.length === 0) {
    logInfo('system', '暂无订阅源，调度器待命');
    return;
  }

  logInfo('system', `调度器启动，共 ${subs.length} 个订阅源`);

  for (const sub of subs) {
    const intervalMs = getIntervalMs(sub);
    const minutes = intervalMs / 60000;
    logInfo('system', `  - ${sub.name} (${sub.type}) 每 ${minutes} 分钟轮询一次`);

    // 立即执行一次
    pollSubscription(sub, config.webhooks, config.quiet_hours);

    // 创建定时器
    const timer = setInterval(() => pollSubscription(sub, config.webhooks, config.quiet_hours), intervalMs);
    timers.set(sub.url, timer);
  }
}

/**
 * 停止所有定时器
 */
export function stopScheduler(): void {
  for (const timer of timers.values()) {
    clearInterval(timer);
  }
  timers.clear();
}

/**
 * 手动触发一次轮询（用于 --poll / 一次性验证）
 */
export async function triggerPoll(config: AppConfig): Promise<void> {
  await pollAll(config);
}
