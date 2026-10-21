#!/usr/bin/env node
/**
 * 构建脚本：清理 dist → 编译 TypeScript → 汇总结果
 * 用法：npm run build（tsc 出错时打印错误并以非 0 退出，不产出残缺 dist）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

// ===== 颜色（非 TTY 或 NO_COLOR 时自动降级为纯文本） =====
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const green = (s) => c('32', s);
const red = (s) => c('31', s);
const cyan = (s) => c('36', s);
const yellow = (s) => c('33', s);

const OK = green('✔');
const FAIL = red('✖');
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const started = performance.now();
const elapsed = () => ((performance.now() - started) / 1000).toFixed(1) + 's';

function step(msg) {
  process.stdout.write(` ${OK} ${msg}\n`);
}

function spinnerStart(text) {
  if (!useColor) {
    process.stdout.write(`   ${text}...\n`);
    return () => {};
  }
  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r \x1b[36m${SPINNER[i++ % SPINNER.length]}\x1b[0m ${text}   `);
  }, 80);
  return () => {
    clearInterval(timer);
    process.stdout.write('\r\x1b[2K');
  };
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return n;
}

function countSources(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countSources(path.join(dir, entry.name));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) n += 1;
  }
  return n;
}

function runTsc() {
  const tscPkg = require.resolve('typescript/package.json');
  const tscBin = path.join(path.dirname(tscPkg), 'bin', 'tsc');
  return new Promise((resolve) => {
    // --noEmitOnError：有类型错误时不产出文件（注意 dist 已在编译前清理，失败即为空，修复后需重新 build）
    const child = spawn(process.execPath, [tscBin, '--noEmitOnError'], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function main() {
  process.stdout.write(
    `\n ${cyan(bold('rss-station'))} ${dim('v' + pkg.version)} ${dim('· 生产打包')}\n\n`
  );

  // 1. 配置检查
  const tsconfigPath = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    process.stdout.write(` ${FAIL} ${red('未找到 tsconfig.json')}\n\n`);
    process.exit(1);
  }
  step(`配置检查 ${dim('tsconfig.json')}`);

  // 2. 清理 dist
  const distDir = path.join(root, 'dist');
  const oldCount = countFiles(distDir);
  if (oldCount > 0) {
    fs.rmSync(distDir, { recursive: true, force: true });
    step(`清理 ${dim('dist/')}（移除 ${oldCount} 个旧文件）`);
  } else {
    step(`清理 ${dim('dist/')}（无旧产物，首次构建）`);
  }

  // 3. 编译（tsc 为同步重活，用子进程运行以便渲染进度动画）
  const srcCount = countSources(path.join(root, 'src'));
  const stop = spinnerStart(`编译 TypeScript（${srcCount} 个源文件）`);
  const code = await runTsc();
  stop();

  if (code !== 0) {
    process.stdout.write(
      ` ${FAIL} ${red(bold('编译失败'))}（tsc 退出码 ${code}，错误详情见上方输出，${dim('修复后重新 build 生成产物')}） 用时 ${elapsed()}\n\n`
    );
    process.exit(code);
  }
  step(`编译通过 ${dim('0 个类型错误')}`);

  // 4. 产物汇总
  const outCount = countFiles(distDir);
  step(`产物输出 ${dim('dist/')} 共 ${outCount} 个文件（js / d.ts / sourcemap）`);
  process.stdout.write(
    ` ${green(bold('打包成功'))}  ${dim(`${srcCount} 个源文件 → ${outCount} 个产物`)}  用时 ${elapsed()}\n`
  );
  process.stdout.write(` ${dim(`运行：${yellow('npm start')}`)}\n\n`);
}

main().catch((err) => {
  process.stdout.write(` ${FAIL} ${red('构建脚本异常')}：${err?.message || err}\n\n`);
  process.exit(1);
});
