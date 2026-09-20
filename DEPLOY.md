# RSS Station 部署说明（pm2）

纯 CLI 常驻进程（RSS 轮询 + 股票推送），无 Web 端口。本文说明如何在 Linux 服务器上用 pm2 部署运行。

## 一、环境要求

| 项 | 要求 |
|---|---|
| Node.js | v20 / v22 LTS（建议与开发环境大版本一致，避免 better-sqlite3 原生模块 ABI 不匹配） |
| pm2 | 全局安装：`npm i -g pm2` |
| 磁盘 | 项目本体很小；`data/*.db` 会随时间增长，预留几百 MB 足够 |

> ⚠️ **不要在 Windows 本地 build 后把产物拷到 Linux**：`better-sqlite3` 是原生模块，二进制绑定与平台/Node 版本相关。必须在服务器上执行 `npm install` 重新安装编译。

## 二、部署步骤

```bash
# 1. 拉代码
git clone <仓库地址> && cd rss-station

# 2. 安装依赖（务必在服务器上执行，触发原生模块本机编译）
npm install

# 3. 编译
npm run build

# 4. 准备配置文件
#    在项目根目录放置 config.json（结构见 README / 示例配置）
#    注意：真实 webhook 地址不要提交 git，手动放置即可
chmod 600 config.json   # 含 webhook 地址，收紧权限

# 5.（可选但推荐）先跑一轮验证配置是否正确，再常驻
npm run once

# 6. 用 pm2 启动
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup   # 按提示执行输出的那条命令，实现开机自启
```

## 三、常用运维命令

```bash
pm2 status                 # 进程状态
pm2 logs rss-station       # 查看日志（也可直接看 logs/out.log / logs/error.log）
pm2 restart rss-station    # 重启（改完 config.json 后需要重启生效）
pm2 stop rss-station       # 停止
pm2 monit                  # 实时资源监控
```

## 四、注意事项

- **改配置需重启**：调度器启动时读取 config.json，运行中不监听文件变更。改完执行 `pm2 restart rss-station`。
- **日志落盘**：pm2 配置已将 stdout/stderr 写入项目下 `logs/out.log` 与 `logs/error.log`（带时间戳）。日志会持续增长，可用 logrotate 或定期 `pm2 flush` 清理。
- **数据目录**：`data/rss-station.db`（SQLite WAL 模式）是唯一运行时状态，建议纳入备份（如每日 crontab 拷贝）；备份前建议先 `pm2 stop` 保证一致性，或直接拷贝 WAL 模式下的三个文件（`*.db`、`*.db-wal`、`*.db-shm`）。
- **验证配置不要用真实 webhook**：测试时把 `webhooks` 置空、`stock_push.channel` 改为 `console`，避免打扰真实群聊。
- **推送失败不中断**：单次推送失败只记日志，服务继续运行。
- **磁盘占用**：`articles`/`crawl_state` 表暂无自动清理逻辑，长期运行关注 `data/` 体积。

## 五、更新版本

```bash
cd rss-station
git pull
npm install               # 依赖有变化时需要；better-sqlite3 版本变更时会在服务器重新编译
npm run build
pm2 restart rss-station
```
