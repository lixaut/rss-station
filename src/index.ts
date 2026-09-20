import path from 'path';
import { loadConfig, AppConfig } from './config';
import { initDb, cleanupOldArticles } from './db/db';
import { logInfo, logSuccess, logError } from './log';
import { startScheduler, triggerPoll } from './scheduler';
import { startStockScheduler, runQuotesNow, pushStockNotice } from './stock/scheduler';

// ===== CLI 参数解析 =====

interface CliArgs {
  configPath: string;
  once: boolean; // 跑一轮 RSS 轮询 + 一次行情推送后退出
  poll: boolean; // 仅触发一次 RSS 轮询后退出
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    configPath: path.resolve(__dirname, '../config.json'),
    once: false,
    poll: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-c' || arg === '--config') {
      args.configPath = path.resolve(argv[++i] || '');
    } else if (arg === '--once') {
      args.once = true;
    } else if (arg === '--poll') {
      args.poll = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`用法: node dist/index.js [选项]

选项:
  -c, --config <路径>  指定配置文件（默认: 项目根目录 config.json）
  --once               跑一轮 RSS 轮询 + 一次行情推送后退出（验证用）
  --poll               仅触发一次 RSS 轮询后退出（配合计划任务）
  -h, --help           显示帮助

不带参数时：常驻运行（RSS 轮询 + 股票行情推送）。`);
      process.exit(0);
    }
  }
  return args;
}

// ===== 一次性模式 =====

async function runOnceMode(args: CliArgs): Promise<number> {
  const config = loadConfig(args.configPath);
  await triggerPoll(config);
  if (config.stocks.length > 0) {
    await runQuotesNow(config);
  }
  return 0;
}

async function runPollMode(args: CliArgs): Promise<number> {
  const config = loadConfig(args.configPath);
  await triggerPoll(config);
  return 0;
}

// ===== 常驻模式 =====

/** 每日 03:00 清理过期文章：计算距下一次 3 点的毫秒数 */
function msUntilNext3am(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function startDailyCleanup(config: AppConfig): void {
  const keepCount = config.cleanup?.keep_count ?? 50;
  const run = () => {
    try {
      const removed = cleanupOldArticles(keepCount);
      if (removed > 0) {
        logInfo('system', `每日清理完成: 删除 ${removed} 篇旧文章（每源保留最新 ${keepCount} 条）`);
      }
    } catch (err) {
      logError('system', `每日清理失败: ${(err as Error).message}`);
    }
  };
  setTimeout(() => {
    run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, msUntilNext3am()).unref();
}

function runDaemon(args: CliArgs): void {
  const config = loadConfig(args.configPath);
  logInfo('system', `已加载 ${config.subscriptions.length} 个订阅源、${config.webhooks.length} 个 Webhook、${config.stocks.length} 个股票标的`);

  // 启动 RSS 轮询调度
  startScheduler(config);

  // 启动股票监控调度
  startStockScheduler(config);

  // 每日 03:00 清理过期文章
  startDailyCleanup(config);

  logSuccess('system', 'RSS Station 常驻运行中（Ctrl+C 退出）');
}

// ===== 启动 =====

// 进程退出前推送股票停止通知（限时，避免阻塞退出；未启动股票调度时静默跳过）
let exiting = false;
function handleExitSignal(signal: NodeJS.Signals): void {
  if (exiting) return;
  exiting = true;
  logInfo('system', `收到 ${signal}，正在退出…`);
  const bounded = new Promise<void>((resolve) => setTimeout(resolve, 2000));
  Promise.race([
    pushStockNotice('👋 本次盯盘到此结束', ['期待下次继续为您服务！']),
    bounded,
  ])
    .then(() => process.exit(0))
    .catch(() => process.exit(0));
}
process.on('SIGINT', () => handleExitSignal('SIGINT'));
process.on('SIGTERM', () => handleExitSignal('SIGTERM'));

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    // 所有模式都需要数据库（去重缓存），统一在此初始化（含旧表迁移）
    initDb();
    logInfo('system', '数据库初始化完成');

    if (args.once) return await runOnceMode(args);
    if (args.poll) return await runPollMode(args);
    runDaemon(args);
    return 0;
  } catch (err) {
    logError('system', (err as Error).message);
    return 1;
  }
}

main().then((code) => {
  if (process.argv.includes('--once') || process.argv.includes('--poll')) {
    process.exit(code);
  }
});
