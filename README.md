# RSS Station 📡

> 基于前端技术栈的 RSS 订阅监控 & 股票行情监控 & Webhook 推送服务

监控 RSS 订阅源与股票/指数行情，通过 Webhook 自动推送到钉钉、飞书、Slack、企业微信等平台，让你不再错过任何重要内容。

---

## ✨ 功能特性

- **📡 RSS 订阅管理** — 通过 `config.json` 配置订阅源（RSS 或网页抓取）
- **🔄 自动轮询检测** — 定时抓取，增量检测新文章（SQLite 去重缓存）
- **📈 股票行情监控** — 实时行情推送（控制台 / 飞书卡片），并按股市时间发送启动 / 午间休市 / 下午开盘 / 收盘 / 退出温馨提醒
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
├── config.json            # 唯一配置文件（订阅 / Webhook / 股票）
├── src/
│   ├── index.ts           # CLI 入口：常驻 / --once / --poll
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
│       ├── formatter.ts   # 控制台 / 飞书卡片格式化
│       ├── scheduler.ts   # 行情推送 + 生命周期通知
│       └── time_period.ts # 时段判断（盘前/早盘/午间/午盘/盘后/休市）
├── data/                  # SQLite 数据库（自动生成，已 gitignore）
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

# 4. 常驻运行（RSS 轮询 + 股票推送）
npm start
```

### CLI 命令

| 命令 | 说明 |
|------|------|
| `npm start` / `npm run monitor` | 常驻运行（Ctrl+C 退出） |
| `npm run poll` | 仅触发一次 RSS 轮询后退出（可配合计划任务） |
| `npm run once` | 跑一轮 RSS 轮询 + 一次行情推送后退出（验证用） |
| `node dist/index.js -c 路径.json` | 指定配置文件（默认项目根目录 config.json） |

> 💡 常驻模式下，行情按时间窗推送（上午 `start_time`～11:30 + 下午 13:00～`end_time`），收盘后自动停止当日推送，服务继续运行等待次日；`stock_push.event_notify` 开启时还会根据当前时段推送差异化启动提示，并在午间休市 / 下午开盘 / 收盘 / 退出时推送温馨提醒。

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
    "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
    "start_time": "09:30",
    "end_time": "15:00",
    "event_notify": true
  },
  "cleanup": {
    "keep_count": 50
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
| `stock_push.start_time` | 行情推送开始时间 `HH:MM`（默认 `09:30`，到达后准点推送首次；窗口外不推送） |
| `stock_push.end_time` | 行情推送结束时间 `HH:MM`（默认 `15:00`，收盘后停止推送） |
| `stock_push.event_notify` | 生命周期通知开关（默认 `true`）：启动时按当前时段推送差异化提示（盘前/早盘/午间休市/午盘/盘后/休市）/ 午间休市(11:30) / 下午开盘(13:00) / 收盘(15:00) / 退出前各推送一条温馨提示 |
| `stock_push` 时间窗 | 按 A 股交易时段推送：上午 `start_time`～`11:30` + 下午 `13:00`～`end_time`，午间 11:30–13:00 休市不推送 |
| `cleanup.keep_count` | 每个订阅源保留的最新文章条数（默认 `50`）。常驻模式每天 03:00 自动清理各源超出的旧文章并回收 SQLite 空间；省略 `cleanup` 时用默认值 |

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
