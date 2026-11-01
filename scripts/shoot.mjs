/**
 * 基于 Chrome DevTools Protocol 的批量截图脚本（复用同一个 headless 实例，稳定且支持整页）。
 * 用法：node scripts/shoot.mjs [baseUrl] [projectId]
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:5099';
const PROJECT_ID = process.argv[3] || '';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const CDP_PORT = 9222;

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('无法连接 Chrome 调试端口');
}

const wsUrl = await getTarget();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let counter = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(new Error(data.error.message));
    else resolve(data.result);
  }
});

function send(method, params = {}) {
  counter += 1;
  const id = counter;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result?.value;
}

async function waitReady() {
  for (let i = 0; i < 80; i++) {
    const ready = await evaluate(
      `(() => { const r = document.getElementById('root'); return document.readyState === 'complete' && r && r.childElementCount > 0 ? document.body.scrollHeight : 0; })()`,
    );
    if (ready) {
      await new Promise((r) => setTimeout(r, 1600));
      return Number(ready);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return 0;
}

await send('Network.enable', {});
await send('Network.clearBrowserCache', {});

async function shoot(name, url, width = 1500, height = 1100) {
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${BASE}${url}` });
  const fullHeight = await waitReady();
  await evaluate('window.scrollTo(0, 0)');
  const clipHeight = Math.min(Math.max(fullHeight, height), 2600);
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: clipHeight, scale: 1 },
  });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`✓ ${name}.png  ${width}x${clipHeight}`);
}

const pages = [
  ['dashboard', '/'],
  ['new-lyrics', '/new?type=lyrics'],
  ['new-history', '/new?type=history'],
  ['library', '/library'],
  ['prompt', '/prompt'],
  ['settings', '/settings'],
];
const PREFIX = process.argv[4] || '';
const TAB_LIST = (process.argv[5] || 'overview,storyboard,voice,music,output,research,analysis').split(',');
if (PROJECT_ID) {
  for (const tab of TAB_LIST) {
    pages.push([`${PREFIX ? `${PREFIX}-` : 'project-'}${tab}`, `/projects/${PROJECT_ID}?tab=${tab}`]);
  }
}

for (const [name, url] of pages) {
  try {
    await shoot(name, url);
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`);
  }
}

ws.close();
process.exit(0);
