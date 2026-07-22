import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ScrapeRule {
  /** 列表容器选择器（如 ul.news-list），为空时直接使用 itemSelector */
  listSelector?: string;
  /** 列表项选择器，每条新闻对应一个 */
  itemSelector: string;
  /** 标题选择器（相对于 itemSelector），取 text 内容 */
  titleSelector: string;
  /** 链接选择器（相对于 itemSelector），取 href 属性。为空时从 item 自身取 href */
  linkSelector?: string;
  /** 全文内容选择器（文章详情页），会逐个请求每条文章的详情页提取正文 */
  contentSelector?: string;
}

export interface ScrapeItem {
  guid: string;       // 用链接作为唯一标识
  title: string;
  link: string;
  content?: string;   // 全文（由 fetchArticleContent 填充）
}

export interface ScrapeResult {
  title: string;
  link: string;
  items: ScrapeItem[];
}

/**
 * 抓取网页并按规则提取文章列表
 * 每个 itemSelector 匹配一个独立条目，分别提取标题和链接
 */
export async function scrapePage(url: string, rule: ScrapeRule): Promise<ScrapeResult> {
  const resp = await axios.get(url, {
    timeout: 15_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  const $ = cheerio.load(resp.data);

  const pageTitle = $('title').text().trim() || url;
  const items: ScrapeItem[] = [];

  // 两级定位：listSelector 找容器 → itemSelector 找条目
  // 没设 listSelector 时直接在全页中找 itemSelector
  const $root = rule.listSelector ? $(rule.listSelector) : $('body');

  $root.each((_, rootEl) => {
    const $rootEl = $(rootEl);
    $rootEl.find(rule.itemSelector).each((_, el) => {
      const $el = $(el);

      // 标题取第一个匹配的元素，避免拼接多个
      const title = $el.find(rule.titleSelector).first().text().trim() || '(无标题)';
      // 链接：优先取 linkSelector，没设时从 item 自身取 href，再不行取内部第一个 a 的 href
      let link = '';
      if (rule.linkSelector) {
        link = resolveUrl(url, $el.find(rule.linkSelector).first().attr('href') || '');
      } else {
        link = resolveUrl(url, $el.attr('href') || $el.find('a').first().attr('href') || '');
      }
      if (!link) return;

      items.push({
        guid: link,
        title,
        link,
      });
    });
  });

  return { title: pageTitle, link: url, items };
}

/**
 * 将相对地址解析为绝对地址
 */
function resolveUrl(base: string, href: string): string {
  if (!href) return '';
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/**
 * 抓取文章详情页，提取全文内容
 */
export async function fetchArticleContent(url: string, contentSelector: string): Promise<string> {
  const resp = await axios.get(url, {
    timeout: 15_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  const $ = cheerio.load(resp.data);
  const $content = $(contentSelector);

  if ($content.length === 0) return '';

  // 移除脚本、样式、隐藏元素等干扰
  $content.find('script, style, noscript, iframe, .hidden, [style*="display:none"], [style*="display: none"]').remove();

  // 取 HTML 内容，保留格式
  return $content.html() || $content.text().trim() || '';
}

/**
 * 自动检测页面中是否包含 RSS/Atom 链接
 */
export function detectFeedLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const feeds: string[] = [];

  $('link[type="application/rss+xml"], link[type="application/atom+xml"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) feeds.push(href);
  });

  return feeds;
}