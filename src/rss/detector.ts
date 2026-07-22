import { FeedItem } from './fetcher';
import { getLastGuids } from '../db/db';

/**
 * 对比订阅源最近 5 条缓存，返回新增的条目
 * @param subscriptionId 订阅源 ID
 * @param items 本次抓取到的所有文章
 * @returns 新增的文章列表
 */
export function detectNewArticles(
  subscriptionId: number,
  items: FeedItem[]
): FeedItem[] {
  const lastGuids = getLastGuids(subscriptionId);
  const lastSet = new Set(lastGuids);

  const newItems: FeedItem[] = [];

  for (const item of items) {
    if (!lastSet.has(item.guid)) {
      newItems.push(item);
    }
  }

  return newItems;
}