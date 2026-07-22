import Parser from 'rss-parser';
import axios from 'axios';

const parser = new Parser();

export interface FeedItem {
  guid: string;
  title: string;
  link: string;
  pubDate?: string | null;
  contentSnippet?: string;
  content?: string; // 全文（由 scrape 填充）
}

export interface FeedResult {
  title: string;
  link: string;
  items: FeedItem[];
}

/**
 * 抓取并解析 RSS 地址
 */
export async function fetchFeed(url: string): Promise<FeedResult> {
  const resp = await axios.get(url, {
    timeout: 15_000,
    headers: {
      'User-Agent': 'RSS-Station/0.1.0',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
  });

  const feed = await parser.parseString(resp.data);

  const items: FeedItem[] = (feed.items || []).map((item) => ({
    guid: item.guid || item.link || item.title || '',
    title: item.title || '(无标题)',
    link: item.link || '',
    pubDate: item.pubDate || item.isoDate || null,
    contentSnippet: (item.contentSnippet || item.content || '')
      .replace(/<[^>]*>/g, '')
      .slice(0, 500),
  }));

  return {
    title: feed.title || '未知来源',
    link: feed.link || '',
    items,
  };
}