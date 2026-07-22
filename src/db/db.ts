import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

// ===== 类型定义 =====

export interface Subscription {
  id: number;
  name: string;
  url: string;
  type: 'rss' | 'scrape';
  scrape_rules: string | null; // JSON: { itemSelector, titleSelector, linkSelector, dateSelector?, snippetSelector? }
  interval: number;
  enabled: number; // 0 | 1
  last_fetched_at: string | null;
  last_guids: string | null; // JSON: 最近 5 条 GUID，用于增量比较
  created_at: string;
}

export interface Article {
  id: number;
  subscription_id: number;
  guid: string;
  title: string;
  link: string;
  pub_date: string | null;
  content_snippet: string;
  content: string | null; // 全文（可选，仅 scrape 类型有）
  pushed: number; // 0 | 1
  created_at: string;
}

export interface Webhook {
  id: number;
  name: string;
  url: string;
  template: 'text' | 'markdown' | 'json' | 'feishu';
  enabled: number; // 0 | 1
  created_at: string;
}

export interface PushLog {
  id: number;
  article_id: number;
  webhook_id: number;
  status: 'success' | 'fail';
  response: string;
  created_at: string;
}

// ===== 数据库初始化 =====

let db: Database.Database;

export function initDb(): Database.Database {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(config.dbPath);

  // 开启 WAL 模式，提升并发性能
  db.pragma('journal_mode = WAL');

  // 建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      url           TEXT    NOT NULL UNIQUE,
      type          TEXT    NOT NULL DEFAULT 'rss' CHECK(type IN ('rss','scrape')),
      scrape_rules  TEXT,
      interval      INTEGER NOT NULL DEFAULT 30,
      enabled       INTEGER NOT NULL DEFAULT 1,
      last_fetched_at TEXT,
      last_guids    TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS articles (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      guid            TEXT    NOT NULL,
      title           TEXT    NOT NULL,
      link            TEXT    NOT NULL,
      pub_date        TEXT,
      content_snippet TEXT,
      content         TEXT,
      pushed          INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_sub_guid
      ON articles(subscription_id, guid);

    CREATE TABLE IF NOT EXISTS webhooks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      url        TEXT    NOT NULL,
      template   TEXT    NOT NULL DEFAULT 'markdown' CHECK(template IN ('text','markdown','json','feishu')),
      enabled    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS push_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL,
      webhook_id INTEGER NOT NULL,
      status     TEXT    NOT NULL CHECK(status IN ('success','fail')),
      response   TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
    );
  `);

  // 迁移：如果旧表 webhooks 的 CHECK 约束缺少 'feishu'，则重建表
  try {
    db.prepare("INSERT INTO webhooks (name, url, template) VALUES ('__migrate_test__', '__migrate_test__', 'feishu')").run();
    // 成功说明新约束已生效，删除测试数据
    db.prepare("DELETE FROM webhooks WHERE name = '__migrate_test__'").run();
  } catch (err: any) {
    if (err.code?.startsWith('SQLITE_CONSTRAINT')) {
      // 旧约束不包含 feishu，需要重建表
      console.log('[数据库] 迁移 webhooks 表...');
      db.exec(`
        CREATE TABLE webhooks_new (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT    NOT NULL,
          url        TEXT    NOT NULL,
          template   TEXT    NOT NULL DEFAULT 'markdown' CHECK(template IN ('text','markdown','json','feishu')),
          enabled    INTEGER NOT NULL DEFAULT 1,
          created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        INSERT INTO webhooks_new SELECT * FROM webhooks;
        DROP TABLE webhooks;
        ALTER TABLE webhooks_new RENAME TO webhooks;
      `);
      console.log('[数据库] webhooks 表迁移完成');
    } else {
      throw err;
    }
  }

  // 迁移：检查所有表的时间字段是否使用本地时间，否则重建
  const tablesToMigrate: { name: string; createSql: string }[] = [];
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%datetime(''now'')%'").all() as any[];
  for (const row of rows) {
    const newSql = (row.sql as string).replace(/datetime\('now'\)/g, "datetime('now', 'localtime')");
    tablesToMigrate.push({ name: row.name as string, createSql: newSql });
  }
  for (const t of tablesToMigrate) {
    console.log(`[数据库] 迁移 ${t.name} 表（时间字段改为本地时间）...`);
    db.exec(`
      CREATE TABLE temp_migrate AS SELECT * FROM ${t.name};
      DROP TABLE ${t.name};
      ${t.createSql};
      INSERT INTO ${t.name} SELECT * FROM temp_migrate;
      DROP TABLE temp_migrate;
    `);
    console.log(`[数据库] ${t.name} 表迁移完成`);
  }

  // 迁移：为旧表 subscriptions 添加 last_guids 列（如果不存在）
  try {
    db.prepare("ALTER TABLE subscriptions ADD COLUMN last_guids TEXT").run();
    console.log('[数据库] 添加 last_guids 列完成');
  } catch (err: any) {
    // 列已存在时忽略错误
    if (!err.message?.includes('duplicate column')) {
      throw err;
    }
  }

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    return initDb();
  }
  return db;
}

// ===== 订阅源 CRUD =====

export function getAllSubscriptions(): Subscription[] {
  return getDb().prepare('SELECT * FROM subscriptions ORDER BY created_at DESC').all() as Subscription[];
}

export function getEnabledSubscriptions(): Subscription[] {
  return getDb().prepare('SELECT * FROM subscriptions WHERE enabled = 1').all() as Subscription[];
}

export function getSubscriptionById(id: number): Subscription | undefined {
  return getDb().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as Subscription | undefined;
}

export function addSubscription(name: string, url: string, type: 'rss' | 'scrape' = 'rss', scrapeRules?: string | null, interval: number = 30): Subscription {
  const stmt = getDb().prepare('INSERT INTO subscriptions (name, url, type, scrape_rules, interval) VALUES (?, ?, ?, ?, ?)');
  const result = stmt.run(name, url, type, scrapeRules || null, interval);
  return getSubscriptionById(result.lastInsertRowid as number)!;
}

export function updateSubscription(id: number, fields: Partial<Pick<Subscription, 'name' | 'url' | 'type' | 'scrape_rules' | 'interval' | 'enabled'>>): void {
  const sets: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteSubscription(id: number): void {
  getDb().prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
}

export function updateLastFetched(id: number): void {
  getDb().prepare("UPDATE subscriptions SET last_fetched_at = datetime('now', 'localtime') WHERE id = ?").run(id);
}

/** 更新订阅源的最近 5 条 GUID 缓存 */
export function updateLastGuids(id: number, guids: string[]): void {
  const latest5 = guids.slice(0, 5);
  getDb().prepare('UPDATE subscriptions SET last_guids = ? WHERE id = ?').run(JSON.stringify(latest5), id);
}

/** 获取订阅源的最近 GUID 缓存 */
export function getLastGuids(id: number): string[] {
  const row = getDb().prepare('SELECT last_guids FROM subscriptions WHERE id = ?').get(id) as { last_guids: string | null } | undefined;
  if (!row?.last_guids) return [];
  try {
    return JSON.parse(row.last_guids);
  } catch {
    return [];
  }
}

// ===== 文章 CRUD =====

export function getUnpushedArticles(subscriptionId: number): Article[] {
  return getDb().prepare(
    'SELECT * FROM articles WHERE subscription_id = ? AND pushed = 0 ORDER BY pub_date ASC'
  ).all(subscriptionId) as Article[];
}

export function articleExists(subscriptionId: number, guid: string): boolean {
  const row = getDb().prepare(
    'SELECT 1 FROM articles WHERE subscription_id = ? AND guid = ?'
  ).get(subscriptionId, guid);
  return !!row;
}

export function insertArticle(article: Omit<Article, 'id' | 'pushed' | 'created_at'>): Article {
  const stmt = getDb().prepare(
    'INSERT OR IGNORE INTO articles (subscription_id, guid, title, link, pub_date, content_snippet, content) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  stmt.run(article.subscription_id, article.guid, article.title, article.link, article.pub_date, article.content_snippet, article.content || null);

  // 返回刚插入或已存在的记录
  return getDb().prepare(
    'SELECT * FROM articles WHERE subscription_id = ? AND guid = ?'
  ).get(article.subscription_id, article.guid) as Article;
}

export function markArticlePushed(id: number): void {
  getDb().prepare('UPDATE articles SET pushed = 1 WHERE id = ?').run(id);
}

// ===== Webhook CRUD =====

export function getAllWebhooks(): Webhook[] {
  return getDb().prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all() as Webhook[];
}

export function getEnabledWebhooks(): Webhook[] {
  return getDb().prepare('SELECT * FROM webhooks WHERE enabled = 1').all() as Webhook[];
}

export function getWebhookById(id: number): Webhook | undefined {
  return getDb().prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as Webhook | undefined;
}

export function addWebhook(name: string, url: string, template: Webhook['template'] = 'markdown'): Webhook {
  const stmt = getDb().prepare('INSERT INTO webhooks (name, url, template) VALUES (?, ?, ?)');
  const result = stmt.run(name, url, template);
  return getWebhookById(result.lastInsertRowid as number)!;
}

export function updateWebhook(id: number, fields: Partial<Pick<Webhook, 'name' | 'url' | 'template' | 'enabled'>>): void {
  const sets: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE webhooks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteWebhook(id: number): void {
  getDb().prepare('DELETE FROM webhooks WHERE id = ?').run(id);
}

// ===== 推送日志 =====

export function addPushLog(articleId: number, webhookId: number, status: 'success' | 'fail', response: string): PushLog {
  const stmt = getDb().prepare(
    'INSERT INTO push_logs (article_id, webhook_id, status, response) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(articleId, webhookId, status, response);
  return getDb().prepare('SELECT * FROM push_logs WHERE id = ?').get(result.lastInsertRowid as number) as PushLog;
}

export function getPushLogs(limit: number = 50): (PushLog & { article_title: string; webhook_name: string })[] {
  return getDb().prepare(`
    SELECT
      pl.*,
      a.title  AS article_title,
      w.name   AS webhook_name
    FROM push_logs pl
    LEFT JOIN articles a ON a.id = pl.article_id
    LEFT JOIN webhooks w ON w.id = pl.webhook_id
    ORDER BY pl.created_at DESC
    LIMIT ?
  `).all(limit) as any;
}