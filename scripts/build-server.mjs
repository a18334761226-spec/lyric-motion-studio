/**
 * 服务端打包：输出可直接 `node dist-server/server.js` 运行的 ESM 产物。
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
const bin = candidates.find((p) => fs.existsSync(p));
if (!bin) {
  console.error('未找到 esbuild 可执行文件，请先运行 pnpm install');
  process.exit(1);
}

const args = [
  'src/server/index.ts',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--target=node22',
  '--packages=external',
  '--outfile=dist-server/server.js',
  '--log-limit=10',
];
const result = spawnSync(bin, args, { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 1);
