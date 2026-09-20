/**
 * pm2 部署配置 — RSS Station
 *
 * 使用方式（在项目根目录）：
 *   pm2 start deploy/ecosystem.config.js
 *   pm2 save && pm2 startup        # 开机自启（按提示执行输出的命令）
 *
 * 常用运维：
 *   pm2 status / pm2 logs rss-station / pm2 restart rss-station / pm2 stop rss-station
 */
module.exports = {
  apps: [
    {
      name: 'rss-station',
      script: 'dist/index.js',
      cwd: __dirname + '/..',

      // 实例与模式：单实例即可（SQLite 不适合多进程并发写）
      instances: 1,
      exec_mode: 'fork',

      // 异常自动重启
      autorestart: true,
      watch: false,

      // 防止配置错误等原因无限重启：最多重启 10 次，每次间隔 10s
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 10000,

      // 内存超限自动重启（进程正常占用很小，超 300MB 视为异常）
      max_memory_restart: '300M',

      // 日志：输出到项目 logs/ 目录，out 与 error 分开，带时间戳
      out_file: __dirname + '/../logs/out.log',
      error_file: __dirname + '/../logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // 环境变量（如需可在此扩展，例如 NODE_ENV）
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
