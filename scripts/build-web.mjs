/**
 * 前端打包：直接调用 esbuild 平台二进制（stdio 继承，沙箱环境也能跑）。
 * 用法：node scripts/build-web.mjs [--watch]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const platform = process.platform;
const arch = process.arch;
const exe = platform === 'win32' ? 'esbuild.exe' : 'esbuild';

const candidates = [
  path.join(root, 'node_modules', `@esbuild/${platform}-${arch}`, exe),
  path.join(root, 'node_modules', `@esbuild/${platform}-${arch}`, 'bin', exe),
];

let bin = candidates.find((p) => fs.existsSync(p));
if (!bin) {
  // 回退：包根目录下的 esbuild 可执行文件
  const fallback = path.join(root, 'node_modules', 'esbuild', 'bin', exe);
  if (fs.existsSync(fallback)) bin = fallback;
}
if (!bin) {
  console.error('未找到 esbuild 可执行文件，请先运行 pnpm install');
  process.exit(1);
}

const args = [
  'src/web/main.tsx',
  '--bundle',
  '--outdir=public/build',
  '--entry-names=app',
  '--loader:.tsx=tsx',
  '--loader:.ts=ts',
  '--loader:.css=css',
  '--jsx=automatic',
  '--target=es2020',
  '--format=esm',
  '--sourcemap',
  '--define:process.env.NODE_ENV="production"',
  '--log-limit=10',
];
if (process.argv.includes('--watch')) args.push('--watch');
else args.push('--minify');

const result = spawnSync(bin, args, { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 1);
