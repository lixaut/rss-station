import { config } from './config';
import {
  getEnabledSubscriptions,
  getSubscriptionById,
  getLastGuids,
  updateLastFetched,
  updateLastGuids,
  insertArticle,
  markArticlePushed,
  Subscription,
} from './db/db';
import { fetchFeed } from './rss/fetcher';
import { scrapePage, fetchArticleContent, ScrapeRule } from './scraper/scraper';
import { detectNewArticles } from './rss/detector';
import { pushToAllWebhooks } from './webhook/sender';

/** 每个订阅源的定时器 map */
const timers = new Map<number, ReturnType<typeof setInterval>>();

/**
 * 轮询单个订阅源
 */
async function pollSubscription(sub: Subscription): Promise<void> {
  const { id: subId, url, name, type, scrape_rules } = sub;
  console.log(`[${new Date().toLocaleString()}] 正在抓取: ${name} (${url}) [${type}]`);

  let feedTitle: string;
  let contentSelector: string | undefined;
  let items: { guid: string; title: string; link: string; content?: string }[];

  try {
    if (type === 'scrape' && scrape_rules) {
      // 网页抓取模式
      const rule: ScrapeRule = JSON.parse(scrape_rules);
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
    console.error(`[${name}] 抓取失败:`, (err as Error).message);
    return;
  }

  // 检测新文章，最多取前 3 条推送，防止滥用
  console.log(`[${name}] 列表页抓取到 ${items.length} 条`);
  const newItems = detectNewArticles(subId, items).slice(0, 3);
  if (newItems.length === 0) {
    console.log(`[${name}] 无新文章 (缓存 ${getLastGuids(subId).length} 条)`);
    updateLastFetched(subId);
    return;
  }

  console.log(`[${name}] 发现 ${newItems.length} 篇新文章`);

  // 如果有 contentSelector，并行抓取每篇文章的全文
  if (contentSelector) {
    console.log(`[${name}] 正在抓取 ${newItems.length} 篇文章的全文...`);
    const contents = await Promise.allSettled(
      newItems.map((item) => fetchArticleContent(item.link, contentSelector!))
    );
    contents.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        newItems[i].content = result.value;
        console.log(`[${name}] 文章 ${i + 1}: "${newItems[i].title.slice(0, 40)}..." 正文长度 ${result.value.length} 字符`);
      } else {
        console.warn(`[${name}] 文章 ${i + 1}: 正文抓取失败`);
      }
    });
  }

  // 入库
  for (const item of newItems) {
    const article = insertArticle({
      subscription_id: subId,
      guid: item.guid,
      title: item.title,
      link: item.link,
      pub_date: null,
      content_snippet: '',
      content: item.content || null,
    });

    // 推送
    if (article) {
      // 标题和内容一样时跳过推送（说明正文抓取失败，内容被标题填充）
      const content = article.content || article.content_snippet || '';
      if (!content) {
        console.log(`[${name}] 跳过推送: "${article.title}" (正文为空)`);
        markArticlePushed(article.id);
        continue;
      }
      if (content.trim() === article.title.trim()) {
        console.log(`[${name}] 跳过推送: "${article.title}" (标题与内容相同)`);
        markArticlePushed(article.id);
        continue;
      }

      try {
        const results = await pushToAllWebhooks(article, feedTitle);
        const successCount = results.filter((r) => r.success).length;
        if (successCount > 0) {
          markArticlePushed(article.id);
          console.log(`[${name}] 推送成功: "${article.title}" -> ${successCount} 个 Webhook`);
        } else {
          console.warn(`[${name}] 推送失败: "${article.title}"`);
        }
      } catch (err) {
        console.error(`[${name}] 推送异常:`, (err as Error).message);
      }
    }
  }

  // 更新缓存：只保留本次抓取的最新 5 条 GUID 用于下次比较
  const allGuids = items.map((item) => item.guid);
  updateLastGuids(subId, allGuids);
  updateLastFetched(subId);
}

/**
 * 轮询所有启用的订阅源（用于手动触发）
 */
async function pollAll(): Promise<void> {
  const subs = getEnabledSubscriptions();
  if (subs.length === 0) {
    console.log(`[${new Date().toLocaleString()}] 暂无启用的订阅源`);
    return;
  }

  console.log(`[${new Date().toLocaleString()}] 开始轮询 ${subs.length} 个订阅源...`);

  // 并行抓取所有订阅源
  await Promise.allSettled(
    subs.map((sub: Subscription) => pollSubscription(sub))
  );

  console.log(`[${new Date().toLocaleString()}] 本轮轮询结束`);
}

/**
 * 获取订阅源的轮询间隔（毫秒）
 */
function getIntervalMs(sub: Subscription): number {
  const minutes = (sub.interval && sub.interval > 0) ? sub.interval : config.defaultInterval;
  return minutes * 60 * 1000;
}

/**
 * 启动调度器，为每个启用的订阅源创建独立定时器
 */
export function startScheduler(): void {
  stopScheduler();

  const subs = getEnabledSubscriptions();
  if (subs.length === 0) {
    console.log(`[${new Date().toLocaleString()}] 暂无启用的订阅源，调度器待命`);
    return;
  }

  console.log(`[${new Date().toLocaleString()}] 调度器启动，共 ${subs.length} 个订阅源`);

  for (const sub of subs) {
    const intervalMs = getIntervalMs(sub);
    const minutes = intervalMs / 60000;
    console.log(`  - ${sub.name} (${sub.type}) 每 ${minutes} 分钟轮询一次`);

    // 立即执行一次
    pollSubscription(sub);

    // 创建定时器
    const timer = setInterval(() => pollSubscription(sub), intervalMs);
    timers.set(sub.id, timer);
  }
}

/**
 * 停止所有定时器
 */
export function stopScheduler(): void {
  for (const [id, timer] of timers.entries()) {
    clearInterval(timer);
  }
  timers.clear();
}

/**
 * 刷新调度器（增删改订阅源后调用）
 */
export function refreshScheduler(): void {
  console.log(`[${new Date().toLocaleString()}] 刷新调度器...`);
  startScheduler();
}

/**
 * 手动触发一次轮询（用于测试接口）
 */
export async function triggerPoll(): Promise<void> {
  await pollAll();
}