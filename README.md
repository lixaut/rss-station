# RSS Station 📡

> 基于前端技术栈的 RSS 订阅监控 & Webhook 推送服务

监控 RSS 订阅源更新，通过 Webhook 自动推送到钉钉、飞书、Slack、企业微信等平台，让你不再错过任何重要内容。

---

## ✨ 功能特性

- **📡 RSS 订阅管理** — 添加、编辑、删除、启用/禁用订阅源
- **🔄 自动轮询检测** — 定时抓取 RSS，增量检测新文章
- **🔔 Webhook 推送** — 新文章自动通过 Webhook 推送到多个平台
- **📜 推送历史** — 记录每次推送状态，失败可追溯
- **🌐 管理面板** — 浏览器可视化管理所有配置
- **📦 零安装数据库** — 使用 SQLite 嵌入式数据库，无需安装任何数据库服务

---

## 🧱 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | TypeScript |
| 运行时 | Node.js |
| Web 框架 | Express.js |
| RSS 解析 | rss-parser |
| 定时任务 | node-cron |
| 数据存储 | SQLite (better-sqlite3) |
| 管理面板 | Vanilla HTML + CSS + JS |

---

## 📁 项目结构

```
rss-station/
├── src/
│   ├── index.ts              # 入口：启动 Express + 定时任务
│   ├── config.ts             # 配置（端口、轮询间隔等）
│   ├── db/
│   │   └── db.ts             # SQLite 数据库初始化 & 操作
│   ├── rss/
│   │   ├── fetcher.ts        # 抓取 & 解析 RSS
│   │   └── detector.ts       # 变更检测（对比新文章）
│   ├── webhook/
│   │   └── sender.ts         # 发送 HTTP POST 到各平台
│   ├── scheduler.ts          # 定时任务调度器
│   ├── routes/
│   │   ├── subscriptions.ts  # 订阅源 CRUD API
│   │   ├── webhooks.ts       # Webhook 配置 API
│   │   └── logs.ts           # 推送日志 API
│   └── admin/                # 管理面板前端
│       ├── index.html
│       ├── app.js
│       └── style.css
├── data/                     # SQLite 数据库文件（自动生成，已 gitignore）
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🚀 快速开始

### 前置要求

- Node.js >= 18
- npm >= 9

### 安装 & 运行

```bash
# 1. 克隆项目
git clone https://github.com/your/rss-station.git
cd rss-station

# 2. 安装依赖
npm install

# 3. 启动服务（数据库自动初始化）
npm run dev
```

### 访问管理面板

打开浏览器访问 `http://localhost:3000`

---

## 🔧 API 接口

### 订阅源管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/subscriptions` | 获取所有订阅源 |
| POST | `/api/subscriptions` | 添加订阅源 |
| PUT | `/api/subscriptions/:id` | 更新订阅源 |
| DELETE | `/api/subscriptions/:id` | 删除订阅源 |

### Webhook 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/webhooks` | 获取所有 Webhook 配置 |
| POST | `/api/webhooks` | 添加 Webhook |
| PUT | `/api/webhooks/:id` | 更新 Webhook |
| DELETE | `/api/webhooks/:id` | 删除 Webhook |

### 推送日志

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logs` | 获取推送历史 |
| POST | `/api/test-push` | 手动测试推送 |

---

## 🔌 支持的 Webhook 平台

| 平台 | 消息格式 | 文档 |
|------|---------|------|
| 钉钉 | Markdown | [钉钉机器人文档](https://open.dingtalk.com/document/robots/custom-robot-access) |
| 飞书 | Markdown | [飞书机器人文档](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/custom-bot) |
| Slack | JSON | [Slack Webhook 文档](https://api.slack.com/messaging/webhooks) |
| 企业微信 | Markdown | [企业微信机器人文档](https://developer.work.weixin.qq.com/document/path/91770) |
| 通用 | JSON / 纯文本 | 任意支持 POST 的 Webhook |

---

## 🗺️ 路线图

- [x] 项目初始化
- [ ] 核心：RSS 抓取 & 解析
- [ ] 核心：变更检测 & 增量推送
- [ ] 核心：Webhook 多平台发送
- [ ] 管理面板：订阅源管理
- [ ] 管理面板：Webhook 配置
- [ ] 管理面板：推送历史查看
- [ ] 功能：OPML 导入/导出
- [ ] 功能：AI 摘要推送
- [ ] 部署：Docker 支持

---

## 📄 许可证

MIT