import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { dbPath } from '../config';

// ===== 类型定义 =====

export interface Article {
  id: number;
  subscription_url: string;
  guid: string;
  title: string;
  link: string;
  pub_date: string | null;
  content: string | null; // 全文（可选，仅 scrape 类型有）
  pushed: number; // 0 | 1
  created_at: string;
}

export interface PushLog {
  id: number;
  article_id: number | null;
  status: 'success' | 'fail';
  response: string;
  created_at: string;
}

export interface CrawlState {
  subscription_url: string; // 订阅源 URL 作为唯一键
  last_guids: string | null; // JSON: 最近 5 条 GUID，用于增量比较
  last_fetched_at: string | null;
}

// ===== 数据库初始化 =====

let db: Database.Database;

export function initDb(): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // 开启 WAL 模式，提升并发性能
  db.pragma('journal_mode = WAL');

  // 建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_url TEXT   NOT NULL,
      guid            TEXT    NOT NULL,
      title           TEXT    NOT NULL,
      link            TEXT    NOT NULL,
      pub_date        TEXT,
      content         TEXT,
      pushed          INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_url_guid
      ON articles(subscription_url, guid);

    CREATE TABLE IF NOT EXISTS push_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER,
      status     TEXT    NOT NULL CHECK(status IN ('success','fail')),
      response   TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS crawl_state (
      subscription_url TEXT PRIMARY KEY,
      last_guids       TEXT,
      last_fetched_at  TEXT
    );
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    return initDb();
  }
  return db;
}

// ===== 文章 CRUD =====

export function articleExists(subscriptionUrl: string, guid: string): boolean {
  const row = getDb().prepare(
    'SELECT 1 FROM articles WHERE subscription_url = ? AND guid = ?'
  ).get(subscriptionUrl, guid);
  return !!row;
}

export function insertArticle(article: Omit<Article, 'id' | 'pushed' | 'created_at'>): Article {
  const stmt = getDb().prepare(
    'INSERT OR IGNORE INTO articles (subscription_url, guid, title, link, pub_date, content) VALUES (?, ?, ?, ?, ?, ?)'
  );
  stmt.run(article.subscription_url, article.guid, article.title, article.link, article.pub_date, article.content || null);

  // 返回刚插入或已存在的记录
  return getDb().prepare(
    'SELECT * FROM articles WHERE subscription_url = ? AND guid = ?'
  ).get(article.subscription_url, article.guid) as Article;
}

export function markArticlePushed(id: number): void {
  getDb().prepare('UPDATE articles SET pushed = 1 WHERE id = ?').run(id);
}

export function getArticleById(id: number): Article | undefined {
  return getDb().prepare('SELECT * FROM articles WHERE id = ?').get(id) as Article | undefined;
}

// ===== 爬取状态（去重缓存） =====

export function getCrawlState(subscriptionUrl: string): CrawlState | undefined {
  return getDb().prepare('SELECT * FROM crawl_state WHERE subscription_url = ?').get(subscriptionUrl) as CrawlState | undefined;
}

/** 获取订阅源的最近 GUID 缓存 */
export function getLastGuids(subscriptionUrl: string): string[] {
  const row = getCrawlState(subscriptionUrl);
  if (!row?.last_guids) return [];
  try {
    return JSON.parse(row.last_guids);
  } catch {
    return [];
  }
}

/** 更新订阅源的最近 5 条 GUID 缓存 */
export function updateLastGuids(subscriptionUrl: string, guids: string[]): void {
  const latest5 = guids.slice(0, 5);
  getDb().prepare(
    `INSERT INTO crawl_state (subscription_url, last_guids, last_fetched_at)
     VALUES (?, ?, datetime('now', 'localtime'))
     ON CONFLICT(subscription_url) DO UPDATE SET
       last_guids = excluded.last_guids,
       last_fetched_at = excluded.last_fetched_at`
  ).run(subscriptionUrl, JSON.stringify(latest5));
}

export function updateLastFetched(subscriptionUrl: string): void {
  getDb().prepare(
    `INSERT INTO crawl_state (subscription_url, last_fetched_at)
     VALUES (?, datetime('now', 'localtime'))
     ON CONFLICT(subscription_url) DO UPDATE SET
       last_fetched_at = excluded.last_fetched_at`
  ).run(subscriptionUrl);
}

// ===== 推送日志 =====

export function addPushLog(articleId: number | null, status: 'success' | 'fail', response: string): PushLog {
  const stmt = getDb().prepare(
    'INSERT INTO push_logs (article_id, status, response) VALUES (?, ?, ?)'
  );
  const result = stmt.run(articleId, status, response);
  return getDb().prepare('SELECT * FROM push_logs WHERE id = ?').get(result.lastInsertRowid) as PushLog;
}

export function getPushLogs(limit: number = 50): (PushLog & { article_title: string | null })[] {
  return getDb().prepare(`
    SELECT
      pl.*,
      a.title AS article_title
    FROM push_logs pl
    LEFT JOIN articles a ON a.id = pl.article_id
    ORDER BY pl.created_at DESC
    LIMIT ?
  `).all(limit) as any;
}
