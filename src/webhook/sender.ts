import axios from 'axios';
import { Article } from '../db/db';
import { WebhookConfig } from '../config';
import { logInfo, logSuccess, logWarn, logError } from '../log';

/**
 * 构建消息 payload
 */
function buildPayload(article: Article, feedTitle: string, template: WebhookConfig['template']): object {
  // 优先使用全文，没有全文则用标题兜底
  const bodyContent = article.content || '';
  const isFullContent = !!article.content;

  const base = {
    title: `📢 ${feedTitle}`,
    content: `## ${article.title}\n\n${bodyContent}\n\n[🔗 阅读原文](${article.link})`,
    link: article.link,
    published_at: article.pub_date,
    source_name: feedTitle,
    has_full_content: isFullContent,
  };

  switch (template) {
    case 'text':
      return {
        msgtype: 'text',
        text: {
          content: `【${feedTitle}】${article.title}\n\n${stripHtml(bodyContent).slice(0, 4000)}\n\n${article.link}`,
        },
      };

    case 'markdown':
      return {
        msgtype: 'markdown',
        markdown: {
          title: `【${feedTitle}】${article.title}`,
          text: `# 【${feedTitle}】\n\n## [${article.title}](${article.link})\n\n${isFullContent ? bodyContent : (bodyContent || '')}\n\n> 发布于: ${article.pub_date || '未知'}`,
        },
      };

    case 'json':
    default:
      return base;

    case 'feishu':
      return {
        msg_type: 'text',
        content: {
          text: `【${feedTitle}】 ${formatDate(article.created_at)}\n\n${article.title}\n\n${stripHtml(bodyContent).slice(0, 4000)}\n\n ${article.link}`,
        },
      };
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr.replace(' ', 'T') + '+08:00');
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 移除 HTML 标签，保留纯文本，简单排版 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * 向单个 Webhook 推送一篇文章
 */
export async function pushToWebhook(
  webhook: WebhookConfig,
  article: Article,
  feedTitle: string
): Promise<{ success: boolean; response: string }> {
  const payload = buildPayload(article, feedTitle, webhook.template);

  try {
    const resp = await axios.post(webhook.url, payload, {
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
    logSuccess('news', `推送成功 -> ${webhook.name} (HTTP ${resp.status})`);
    return { success: true, response: `HTTP ${resp.status}` };
  } catch (err: any) {
    const msg = err.response
      ? `HTTP ${err.response.status}`
      : err.message;
    logError('news', `推送失败 -> ${webhook.name} (${msg})`);
    return { success: false, response: msg };
  }
}

/**
 * 向所有配置的 Webhook 推送一篇文章，并记录日志
 */
export async function pushToAllWebhooks(
  article: Article,
  feedTitle: string,
  webhooks: WebhookConfig[]
): Promise<{ webhookUrl: string; success: boolean }[]> {
  if (webhooks.length === 0) {
    logWarn('news', '没有配置 Webhook，跳过推送');
    return [];
  }

  const results: { webhookUrl: string; success: boolean }[] = [];

  for (const wh of webhooks) {
    const { success } = await pushToWebhook(wh, article, feedTitle);
    results.push({ webhookUrl: wh.url, success });
  }

  const successCount = results.filter((r) => r.success).length;
  if (successCount === webhooks.length) {
    logSuccess('news', `汇总: ${successCount}/${webhooks.length} 个 Webhook 推送成功`);
  } else {
    logWarn('news', `汇总: ${successCount}/${webhooks.length} 个 Webhook 推送成功`);
  }
  return results;
}
