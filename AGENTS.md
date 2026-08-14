# AGENTS.md — 智能体工作说明

本文件是 AI 编码助手（智能体）在本仓库工作时的常驻说明，包含项目结构、常用命令、开发约定、日常操作流程与需要记住的事项。修改代码前请先阅读本文件。

## 项目概览

RSS Station — 单服务单进程的 Node.js/TypeScript 应用，包含两大功能模块：

1. **RSS 订阅监控 & Webhook 推送**：定时抓取 RSS/网页，增量检测新文章，推送到钉钉、飞书、Slack、企业微信等平台。
2. **股票行情监控**（原独立项目 stock-monitor 已移植整合）：定时拉取股票/指数行情，推送控制台/飞书；支持盘中与收盘盘后分析（均线/形态 + 仓位建议）。

管理面板（`src/admin/`）为浏览器可视化配置界面，服务启动即提供。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发模式：`tsx watch src/index.ts`，文件变更热加载，**日常使用** |
| `npm run build` | 编译：`tsc` + 复制 `src/admin` 到 `dist/admin` |
| `npm start` | 运行已编译产物 `node dist/index.js` |
| `npm run start:prod` | build + start 一体化 |
| `npx tsc --noEmit` | 快速类型检查（改动后必跑，等价验证） |

- 服务端口 `3000`（可用环境变量 `PORT` 覆盖）
- 数据库/日志首次启动自动初始化，无需手工建库

## 技术栈与目录结构

- 语言：TypeScript（strict 模式，CommonJS，target ES2022）
- 关键依赖：`express`、`better-sqlite3`、`node-cron`、`rss-parser`、`cheerio`、`axios`、`tsx`

```
src/
├── index.ts              # 入口：Express + 数据库 + 双调度器启动
├── config.ts             # 端口 / 数据库路径 / 管理面板路径
├── db/db.ts              # SQLite 初始化、迁移、全部 CRUD
├── scheduler.ts          # RSS 轮询调度器（每订阅源独立定时器）
├── rss/                  # fetcher（抓取解析）、detector（增量检测）
├── webhook/sender.ts     # 多平台 Webhook 发送
├── scraper/scraper.ts    # 网页抓取模式（CSS 选择器）
├── routes/               # subscriptions / webhooks / logs / stock
├── stock/                # 股票监控模块（见下）
└── admin/                # 管理面板（原生 HTML/CSS/JS，无框架）
data/                     # SQLite 数据库 + position_history.json（已 gitignore）
```

### 股票监控模块 `src/stock/`（重要）

| 文件 | 职责 |
|---|---|
| `quote.ts` | 腾讯行情批量拉取（**响应为 GBK 编码**，必须 `responseType:'arraybuffer'` + `new TextDecoder('gbk')` 解码） |
| `kline.ts` | 新浪日K线（JSONP 解析）+ 均线/影线/实体/量比指标 |
| `strategy.ts` | 打分规则引擎 → 信号/仓位建议（权重常量定义在文件顶部） |
| `formatter.ts` | 控制台 ANSI 输出 + 飞书交互卡片 |
| `storage.ts` | 盘后分析历史 `data/position_history.json`，滚动保留最近 5 个交易日 |
| `scheduler.ts` | 调度：按 `interval_seconds` 推送行情；盘中/收盘报告到点触发；`runQuotesNow` / `runReportNow` 供 API 手动调用 |
| `config.ts` | config.json 解析校验（`parseStockConfig`，供一键导入） |

## 数据库约定（SQLite, WAL 模式）

- 路径：`data/rss-station.db`；表：`subscriptions`、`articles`、`webhooks`、`push_logs`、`stock_items`、`stock_settings`
- **时间字段统一用 `datetime('now','localtime')`**，新增表必须遵循；`db.ts` 里有针对旧表的迁移逻辑
- 表结构变更走 `db.ts` 内迁移模式（`ALTER TABLE` 补列 / 重建表），不能删库
- `stock_settings` 是单例行（`id = 1`），建表后执行 `INSERT OR IGNORE` 保证存在
- 股票配置落库字段与接口返回的驼峰结构不同（如 `report_enabled` ↔ `daily_report.enabled`），改路由时注意转换

## 开发约定与规则

1. **改配置后必须刷新调度器**：订阅源 CRUD 后调 `refreshScheduler()`；股票配置/标的变更后调 `refreshStockScheduler()`（不刷新则定时任务不会按新配置运行）。
2. **管理面板是原生 JS**：改 `src/admin/` 后 `npm run build` 会复制到 `dist/admin`，生产环境才需要重新 build；dev 模式直接服务 `src/admin`。
3. **A 股显示习惯：涨红跌绿**（`formatter.ts` 中 `pctColor`），不要改成涨绿跌红。
4. **Git 提交消息用中文**，遵循 Conventional Commits（如 `feat: 集成 stock-monitor 股票行情监控`、`fix: ...`），正文描述改动点；末尾附 `Co-Authored-By: AtomCode (deepseek-v4-flash) <noreply@atomgit.com>` 行。
5. **数据文件绝不入库**：`data/` 下所有文件（含 `*.db*`、`position_history.json`）已在 `.gitignore`。注意 `.gitignore` 中 `#` 注释只在**行首**生效，不要用行内注释（否则模式失效）。
6. **Windows 环境**：shell 是 Git Bash；命令行传中文给 curl 会乱码（GBK），测试接口用 `node -e` + `fetch` 或 UTF-8 文件，不要直接用 curl 内联中文。
7. 不要把敏感信息（webhook URL、token）硬编码进源码或提交；webhook 地址存在数据库/外置配置。
8. 改动后必跑 `npx tsc --noEmit`（或 `npm run build`）确认无类型错误再交付。
9. **功能更新后同步更新说明文件**：新增/修改功能时，若涉及用户可见能力（功能、API、命令、配置）则同步更新 README.md；若涉及结构、约定、流程、坑则同步更新 AGENTS.md。

## 日常操作流程

### 添加/修改 RSS 订阅
- 管理面板「订阅管理」→ 添加订阅（RSS 或网页抓取）；网页抓取需填 CSS 选择器规则
- 或 API：`POST /api/subscriptions` / `PUT /api/subscriptions/:id`
- 操作后调度器自动刷新，无需重启

### 股票监控操作
- 面板「📈 股票监控」页签：设置（间隔/通道/webhook/报告时间）、标的 CRUD、**一键导入原 config.json**、立即推送行情、立即盘后分析
- API：`GET/PUT /api/stock`、`POST /api/stock/items`、`POST /api/stock/import-config`、`POST /api/stock/push-now`、`POST /api/stock/report-now`
- 股票代码常见形式：`600519`(沪市 sh)、`000001`(深市 sz)；指数如 `000300`(sh)、`399265`(sz)；market 可省略由代码推断（股票 6/9 开头为 sh，指数 399 开头为 sz）

### 验证 / 测试
- 类型检查：`npx tsc --noEmit`
- 手动触发 RSS 轮询：面板按钮或 `POST /api/trigger-poll`
- 手动行情推送：`POST /api/stock/push-now`；盘后分析：`POST /api/stock/report-now`
- 行情接口非交易时段返回最近收盘数据；推送失败会记日志并继续下一轮，不会中断服务

## 已知事项 / 坑

- 腾讯行情接口返回 **GBK 编码**，直接按 UTF-8 解析会乱码——`quote.ts` 已处理，新增行情相关代码不要绕过
- 新浪日K线对细分指数（如 399265/980022）也稳定，优先用新浪源（`kline.ts` 已注明）
- 收盘报告推送后按 `auto_exit` **仅停止当日股票调度，不退出整个服务**（原 Python 版是退出进程，移植后语义已适配）
- 盘后分析是技术规则打分输出，**非投资建议**；推送文案保留"⚠ 技术规则输出，非投资建议"提示
