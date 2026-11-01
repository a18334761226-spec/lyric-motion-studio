/**
 * 开发模式：同时启动服务端（Node 原生 TS 运行 + watch）与前端打包 watch。
 */
import { spawn } from 'node:child_process';

const node = process.execPath;
const children = [];

function run(label, args) {
  const child = spawn(node, args, { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });
  child.on('exit', (code) => {
    console.log(`[${label}] exited with ${code}`);
    shutdown();
  });
  children.push(child);
  return child;
}

function shutdown() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('server', ['--import', './scripts/ts-loader.mjs', '--watch', 'src/server/index.ts']);
run('web', ['scripts/build-web.mjs', '--watch']);

console.log('\n开发模式已启动：');
console.log('  控制台  http://127.0.0.1:5099');
console.log('  API     http://127.0.0.1:5099/api');
