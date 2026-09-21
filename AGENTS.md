# AGENTS.md — 智能体工作说明

本文件是 AI 编码助手（智能体）在本仓库工作时的工作说明，包含项目结构、常用命令、开发约定、日常操作流程与需要记住的事项。修改代码前请先阅读本文件。

## 项目概览

RSS Station — 纯 CLI（无 Web 端）的 Node.js/TypeScript 应用，通过外置 `config.json` 驱动，包含两大功能模块：

1. **RSS 订阅监控 & Webhook 推送**：定时抓取 RSS/网页，增量检测新文章，推送到钉钉、飞书、Slack、企业微信等平台。
2. **股票行情监控**：定时拉取股票/指数行情，推送控制台/飞书；按股市时间发送启动/午休/开盘/收盘/退出温馨提醒。

**无 Web 端**：没有 Express、没有管理面板、没有 HTTP 服务，所有配置都在 `config.json`。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run build` | 编译：`tsc`（输出到 dist/） |
| `npm start` / `npm run monitor` | **常驻运行**：RSS 轮询 + 股票推送 |
| `npm run poll` | 仅触发一次 RSS 轮询后退出（配合 Windows 计划任务） |
| `npm run once` | 跑一轮 RSS 轮询 + 一次行情推送后退出（验证用） |
| `node dist/index.js -c 路径.json` | 指定配置文件（默认项目根目录 `config.json`） |
| `npx tsc --noEmit` | 快速类型检查（改动后必跑，等价验证） |

- `npm run dev`（tsx watch）仅用于开发调试，日常运行用编译后的 `npm start`
- **配置修改后需重启**：调度器启动时读取 config.json，运行中不监听文件变更

## 技术栈与目录结构

- 语言：TypeScript（strict 模式，CommonJS，target ES2022）
- 关键依赖：`axios`、`better-sqlite3`、`rss-parser`、`cheerio`、`tsx`（dev）

```
config.json               # 唯一配置文件（订阅 / Webhook / 股票）
src/
├── index.ts              # CLI 入口：解析参数 → 一次性模式或常驻双调度
├── config.ts             # config.json 解析校验（parseConfig / loadConfig）+ dbPath
├── db/db.ts              # SQLite：articles（文章）、crawl_state（去重缓存）
├── scheduler.ts          # RSS 轮询调度器（每订阅源独立定时器，key=订阅 URL）
├── quiet_hours.ts        # 免打扰时段判断（isQuietHours，支持跨午夜区间）
├── rss/                  # fetcher（抓取解析）、detector（增量检测）
├── scraper/scraper.ts    # 网页抓取模式（CSS 选择器）
├── webhook/sender.ts     # 多平台 Webhook 发送（webhooks 由 config 传入）
└── stock/                # 股票监控模块（见下）
data/                     # SQLite 数据库（已 gitignore）
market_claims.md         # 市场观点验证台账（第三方观点/预测按日期记录，后续用实际行情核对，可提交 git）
```

### 股票监控模块 `src/stock/`（重要）

| 文件 | 职责 |
|---|---|
| `quote.ts` | 腾讯行情批量拉取（**响应为 GBK 编码**，必须 `responseType:'arraybuffer'` + `new TextDecoder('gbk')` 解码） |
| `formatter.ts` | 控制台 ANSI 输出 + 飞书交互卡片 + 生命周期通知文案 |
| `scheduler.ts` | 调度：按 `interval_seconds` 推送行情；`runQuotesNow` 供 CLI 调用；生命周期通知（启动/午间休市/下午开盘/收盘/停止） |
| `time_period.ts` | 时段判断：`detectTimePeriod(config)` 返回当前时段（盘前/早盘/午间/午盘/盘后/休市），供启动通知使用 |

## 数据库约定（SQLite, WAL 模式）

- 路径：`data/rss-station.db`（由 `src/config.ts` 导出的 `dbPath` 决定）
- 表：`articles`、`crawl_state`
- **时间字段统一用 `datetime('now','localtime')`**，新增表必须遵循
- `articles` 去重唯一索引：`(subscription_url, guid)`；`crawl_state` 以 `subscription_url` 为主键存最近 5 条 GUID 缓存
- **articles 表自动清理**：常驻模式每天 03:00 清理旧文章，每个订阅源仅保留最新 `cleanup.keep_count`（config.json 可选，默认 50）条，并执行 WAL checkpoint 归还磁盘；一次性模式（`--poll`/`--once`）不触发清理。推送完成后的行不再被读取，保留少量仅作去重兜底
- **配置不存数据库**：所有配置（订阅/Webhook/股票）都从 config.json 读取，数据库只存运行时状态
- **免打扰时段**（`config.json` 可选 `quiet_hours: {start, end}`，HH:MM，支持跨午夜如 22:00~08:00）：时段内 RSS 轮询整轮跳过（不抓取不入库不推送），股票生命周期通知静默；行情推送只在交易时段，天然不受影响。判断函数在 `src/quiet_hours.ts`
- 表结构变更走 `db.ts` 内迁移模式（`CREATE TABLE IF NOT EXISTS`），不能删库

## 开发约定与规则

1. **配置从 config 传入，模块不直接读文件**：`startScheduler(config)` / `startStockScheduler(config)` / `pushToAllWebhooks(article, feedTitle, webhooks)` 都接收配置对象；新增功能遵循同样的注入方式，不要在业务模块里自行 `loadConfig()`。
2. **订阅源唯一键是 URL**：去重缓存、定时器 map 均以 `subscription.url` 为 key，不要用自增 id（配置里没有 id）。
3. **A 股显示习惯：涨红跌绿**（`formatter.ts` 中 `pctColor`），不要改成涨绿跌红。
4. **Git 提交消息用中文**，遵循 Conventional Commits（如 `feat: 集成 stock-monitor 股票行情监控`、`refactor: 去 Web 化改为 JSON 配置`），正文描述改动点；末尾附 `Co-Authored-By: AtomCode (deepseek-v4-flash) <noreply@atomgit.com>` 行。
5. **数据文件绝不入库**：`data/` 下所有文件（含 `*.db*`）已在 `.gitignore`；例外是项目根目录的 `market_claims.md`（市场观点验证台账，**有意提交**用于追踪观点应验）。注意 `.gitignore` 中 `#` 注释只在**行首**生效，不要用行内注释（否则模式失效）。
6. **Windows 环境**：shell 是 Git Bash；命令行传中文给 curl 会乱码（GBK），测试接口用 `node -e` + `fetch` 或 UTF-8 文件，不要直接用 curl 内联中文。
7. 不要把敏感信息（webhook URL、token）硬编码进源码或提交；`config.json` 含真实 webhook 地址，**不要提交真实配置**（提交前替换为示例值或使用 `.env` 思路）。
8. 改动后必跑 `npx tsc --noEmit`（或 `npm run build`）确认无类型错误再交付。
9. **功能更新后同步更新说明文件**：新增/修改功能时，若涉及用户可见能力（功能、命令、配置）则同步更新 README.md；若涉及结构、约定、流程、坑则同步更新 AGENTS.md。

## 日常操作流程

### 修改配置（无 Web 面板，直接改 config.json）
- 加/改 RSS 订阅：编辑 `config.json` 的 `subscriptions` 数组（scrape 类型需填 CSS 选择器）
- 加/改 Webhook：编辑 `webhooks` 数组（`template` 支持 `text`/`markdown`/`json`/`feishu`）
- 改股票标的/推送间隔/时间窗：编辑 `stocks` 与 `stock_push`
- **改完重启服务**（`npm start`）；或先 `npm run poll` / `npm run once` 验证再常驻

### 记录市场观点（验证台账）
- 读到含可验证观点（价格点位 / 时间窗口 / 政策判断）的文章时，录入 `market_claims.md`：按 `## YYYY-MM-DD 来源` 分节，每条观点带唯一 ID（C001 起）、可验证观点、验证标准、建议验证时间，状态初始为「待验证」
- 观点尽量拆成单条可检验的陈述，避免模糊表述；来源注明媒体 / 作者 / 文章标题
- 到验证时间后按「验证标准」核对实际行情 / 事实，更新状态（符合 / 部分符合 / 不符 / 无法验证），并追加验证记录（验证日期 + 实际数据 + 结论）
- 该文件**有意提交 git**，用于长期追踪

### 验证 / 测试
- 类型检查：`npx tsc --noEmit`
- 单次 RSS 轮询：`npm run poll`（或 `--once` 同时验证行情推送）
- **验证配置不要用真实飞书 webhook**：测试时可把 `webhooks` 置空、`stock_push.channel` 改为 `console`，避免打扰真实群聊
- 行情接口非交易时段返回最近收盘数据；推送失败会记日志并继续下一轮，不会中断服务

## 已知事项 / 坑

- 腾讯行情接口返回 **GBK 编码**，直接按 UTF-8 解析会乱码——`quote.ts` 已处理，新增行情相关代码不要绕过
- 常驻模式下，`--poll`/`--once` 手动命令仍可独立运行
- 股票生命周期通知由 `stock_push.event_notify` 控制（默认开启）：启动/午间休市(11:30)/下午开盘(13:00)/收盘(15:00)/进程退出前各推一条，文案按股市时间叙事、不含技术词；`pushStockNotice` 供 `index.ts` 信号处理调用，退出推送限时 2s 不阻塞
