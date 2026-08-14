import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { dbPath } from '../config';
import { logInfo } from '../log';

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

    CREATE TABLE IF NOT EXISTS crawl_state (
      subscription_url TEXT PRIMARY KEY,
      last_guids       TEXT,
      last_fetched_at  TEXT
    );
  `);

  // 旧表结构迁移（v0.1 Web 版 → v0.2 去 Web 化）
  migrateLegacyTables(db);

  // 去重索引：必须在迁移之后创建（旧表 articles 无 subscription_url 列，先迁移重建）
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_url_guid
      ON articles(subscription_url, guid);
  `);

  return db;
}

/**
 * 迁移旧版数据库表结构：
 * - articles：subscription_id 列 → subscription_url 列（通过旧 subscriptions 表映射 url）
 * - push_logs：RSS 推送不再存日志，直接删除旧表
 * 新库（已含 subscription_url）直接跳过。
 */
function migrateLegacyTables(db: Database.Database): void {
  // articles：旧版使用 subscription_id 列，新版使用 subscription_url
  const articleCols = db.prepare('PRAGMA table_info(articles)').all() as { name: string }[];
  if (!articleCols.some((c) => c.name === 'subscription_url')) {
    logInfo('system', '迁移 articles 表（subscription_id → subscription_url）...');
    db.exec(`
      CREATE TABLE articles_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_url TEXT   NOT NULL,
        guid             TEXT   NOT NULL,
        title            TEXT   NOT NULL,
        link             TEXT   NOT NULL,
        pub_date         TEXT,
        content          TEXT,
        pushed           INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT   NOT NULL DEFAULT (datetime('now', 'localtime'))
      );

      CREATE UNIQUE INDEX idx_articles_new_url_guid
        ON articles_new(subscription_url, guid);

      INSERT OR IGNORE INTO articles_new (id, subscription_url, guid, title, link, pub_date, content, pushed, created_at)
        SELECT a.id, COALESCE(s.url, 'legacy:' || a.subscription_id), a.guid, a.title, a.link, a.pub_date,
               COALESCE(a.content, a.content_snippet), a.pushed, a.created_at
        FROM articles a
        LEFT JOIN subscriptions s ON s.id = a.subscription_id;

      DROP TABLE articles;
      ALTER TABLE articles_new RENAME TO articles;
    `);
    logInfo('system', 'articles 表迁移完成');
  }

  // push_logs：RSS 推送不再存日志，删除旧表（含旧版带 webhook_id 的结构）
  db.exec('DROP TABLE IF EXISTS push_logs');
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
