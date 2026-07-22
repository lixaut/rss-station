import path from 'path';

export const config = {
  /** 服务端口 */
  port: parseInt(process.env.PORT || '3000', 10),

  /** 默认轮询间隔（分钟） */
  defaultInterval: 30,

  /** 数据库文件路径 */
  dbPath: path.resolve(__dirname, '../data/rss-station.db'),

  /** 管理面板静态文件路径 */
  adminDir: path.resolve(__dirname, 'admin'),
};