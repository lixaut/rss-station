# RSS Station 📡

> 基于前端技术栈的 RSS 订阅监控 & 股票行情监控 & Webhook 推送服务

监控 RSS 订阅源与股票/指数行情，通过 Webhook 自动推送到钉钉、飞书、Slack、企业微信等平台，让你不再错过任何重要内容。

---

## ✨ 功能特性

- **📡 RSS 订阅管理** — 通过 `config.json` 配置订阅源（RSS 或网页抓取）
- **🔄 自动轮询检测** — 定时抓取，增量检测新文章（SQLite 去重缓存）
- **📈 股票行情监控** — 实时行情推送（控制台 / 飞书卡片），支持盘中与收盘盘后分析（均线/形态 + 仓位建议）
- **🔔 Webhook 推送** — 新文章自动通过 Webhook 推送到多个平台
- **📦 零安装数据库** — 使用 SQLite 嵌入式数据库（仅存去重缓存，无需安装数据库服务，日志走控制台）
- **⚙️ 纯 JSON 配置** — 无 Web 端，所有配置集中在 `config.json`，改配置即可，无需改代码

---

## 🧱 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | TypeScript |
| 运行时 | Node.js |
| RSS 解析 | rss-parser |
| 网页抓取 | cheerio |
| 定时任务 | 内置 setInterval 调度 |
| 数据存储 | SQLite (better-sqlite3) |
| HTTP | axios |

---

## 📁 项目结构

```
rss-station/
├── config.json            # 唯一配置文件（订阅 / Webhook / 股票 / 报告）
├── src/
│   ├── index.ts           # CLI 入口：常驻 / --once / --poll / --report
│   ├── config.ts          # config.json 解析与校验
│   ├── db/
│   │   └── db.ts          # SQLite：去重缓存（crawl_state）、文章
│   ├── rss/
│   │   ├── fetcher.ts     # 抓取 & 解析 RSS
│   │   └── detector.ts    # 变更检测（对比新文章）
│   ├── scraper/
│   │   └── scraper.ts     # 网页抓取模式（CSS 选择器）
│   ├── webhook/
│   │   └── sender.ts      # 发送 HTTP POST 到各平台
│   ├── scheduler.ts       # RSS 轮询调度器
│   └── stock/             # 股票行情监控模块
│       ├── quote.ts       # 腾讯行情拉取（GBK 解码）
│       ├── kline.ts       # 新浪日K线 + 技术指标
│       ├── strategy.ts    # 打分规则引擎 → 仓位建议
│       ├── formatter.ts   # 控制台 / 飞书卡片格式化
│       ├── storage.ts     # 盘后分析历史存储
│       └── scheduler.ts   # 行情推送 + 报告调度
├── data/                  # SQLite 数据库（自动生成，已 gitignore）
├── position_history.md   # 盘后分析历史（Markdown 彩色表格，最近 5 个交易日，可提交 git）
└── package.json
```

---

## 🚀 快速开始

### 前置要求

- Node.js >= 18
- npm >= 9

### 安装 & 运行

```bash
# 1. 安装依赖
npm install

# 2. 创建配置文件（参照 config.json 示例）
cp config.json.example config.json   # 或直接编辑已有的 config.json

# 3. 编译
npm run build

# 4. 常驻运行（RSS 轮询 + 股票推送 + 报告调度）
npm start
```

### CLI 命令

| 命令 | 说明 |
|------|------|
| `npm start` / `npm run monitor` | 常驻运行（Ctrl+C 退出） |
| `npm run poll` | 仅触发一次 RSS 轮询后退出（可配合计划任务） |
| `npm run once` | 跑一轮 RSS 轮询 + 一次行情推送后退出（验证用） |
| `npm run report` | 立即执行一次盘后分析后退出 |
| `node dist/index.js -c 路径.json` | 指定配置文件（默认项目根目录 config.json） |

> 💡 常驻模式下，收盘报告（`daily_report.close_time`）推送完成后按 `auto_exit` 自动停止当日股票调度，但服务继续运行；次日重启即可（如配置了 Windows 计划任务可定时拉起 `--poll`）。

---

## ⚙️ 配置文件（config.json）

```json
{
  "subscriptions": [
    {
      "name": "yicai",
      "url": "https://www.yicai.com/",
      "type": "scrape",
      "scrape_rules": {
        "listSelector": "#latest",
        "itemSelector": "a.f-db",
        "titleSelector": "h2",
        "contentSelector": "#multi-text"
      },
      "interval_minutes": 2
    }
  ],
  "webhooks": [
    { "name": "飞书", "url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx", "template": "feishu" }
  ],
  "stocks": [
    { "code": "000300", "market": "sh", "type": "index", "alias": "沪深300" },
    { "code": "600519", "market": "sh", "type": "stock", "alias": "贵州茅台" }
  ],
  "stock_push": {
    "interval_seconds": 120,
    "channel": "lark",
    "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
  },
  "daily_report": {
    "enabled": true,
    "time": "14:45",
    "close_time": "15:00",
    "auto_exit": true,
    "ma_periods": [5, 10, 20, 60]
  }
}
```

| 字段 | 说明 |
|---|---|
| `subscriptions[]` | RSS 订阅源列表：`name`（名称）、`url`（RSS 或网页地址）、`type`（`rss`/`scrape`）、`scrape_rules`（scrape 类型的 CSS 选择器）、`interval_minutes`（轮询间隔分钟） |
| `webhooks[]` | 推送 Webhook 列表：`name`、`url`、`template`（`text`/`markdown`/`json`/`feishu`） |
| `stocks[]` | 股票/指数列表：`code`（如 `600519`、`000300`）、`market`（`sh`/`sz`，省略时按代码推断）、`type`（`stock`/`index`）、`alias`（展示名） |
| `stock_push.interval_seconds` | 行情推送间隔（秒），必须大于 0 |
| `stock_push.channel` | 推送通道：`console` / `lark`（飞书机器人 Webhook） |
| `stock_push.webhook_url` | `lark` 通道必填 |
| `daily_report.enabled` | 是否启用盘后分析（默认 `false`） |
| `daily_report.time` | 盘中报告时间 `HH:MM`（默认 `14:45`） |
| `daily_report.close_time` | 收盘报告时间（如 `15:00`），省略则不推送 |
| `daily_report.auto_exit` | 收盘报告推送后是否停止当日股票调度（默认 `true`） |
| `daily_report.ma_periods` | 均线周期列表 |

常见指数代码：上证指数 `000001`(sh)、深证成指 `399001`(sz)、创业板指 `399006`(sz)、沪深300 `000300`(sh)、上证50 `000016`(sh)、中证500 `000905`(sh)、有色金属 `000819`(sh)、创新药械 `399265`(sz)、机器人产业 `980022`(sz)、半导体 `980017`(sz)。

---

## 🔌 支持的 Webhook 平台

| 平台 | 消息格式 | 文档 |
|------|---------|------|
| 钉钉 | Markdown | [钉钉机器人文档](https://open.dingtalk.com/document/robots/custom-robot-access) |
| 飞书 | Markdown / 文本 | [飞书机器人文档](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/custom-bot) |
| Slack | JSON | [Slack Webhook 文档](https://api.slack.com/messaging/webhooks) |
| 企业微信 | Markdown | [企业微信机器人文档](https://developer.work.weixin.qq.com/document/path/91770) |
| 通用 | JSON / 纯文本 | 任意支持 POST 的 Webhook |

---

## 📄 许可证

MIT
