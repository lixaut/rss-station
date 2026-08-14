import { FeedItem } from './fetcher';
import { getLastGuids } from '../db/db';

/**
 * 对比订阅源最近 5 条缓存，返回新增的条目
 * @param subscriptionUrl 订阅源 URL（唯一键）
 * @param items 本次抓取到的所有文章
 * @returns 新增的文章列表
 */
export function detectNewArticles(
  subscriptionUrl: string,
  items: FeedItem[]
): FeedItem[] {
  const lastGuids = getLastGuids(subscriptionUrl);
  const lastSet = new Set(lastGuids);

  const newItems: FeedItem[] = [];

  for (const item of items) {
    if (!lastSet.has(item.guid)) {
      newItems.push(item);
    }
  }

  return newItems;
}
