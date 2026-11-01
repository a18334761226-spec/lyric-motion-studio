import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * 用 Chrome 无头模式把 SVG 光栅化成 PNG（纯代码绘制 → 1080×1920 位图）。
 * 不依赖 AI 模型，也不需要 ffmpeg 的 SVG 解码器。
 */

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p): p is string => Boolean(p));

function findChrome(): string | undefined {
  return CHROME_CANDIDATES.find((p) => fs.existsSync(p));
}

export async function renderSvgToPng(svg: string, outPath: string, width = 1080, height = 1920): Promise<void> {
  const chrome = findChrome();
  if (!chrome) throw new Error('未找到 Chrome/Edge，无法光栅化 SVG');
  outPath = path.resolve(outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-scene-'));
  const htmlPath = path.join(workDir, 'scene.html');
  const profileDir = path.join(workDir, 'profile');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#000;overflow:hidden;width:${width}px;height:${height}px}svg{display:block}</style></head><body>${svg}</body></html>`;
  fs.writeFileSync(htmlPath, html, 'utf8');
  const before = 0;
  const shotTemp = path.join(workDir, 'shot.png');
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--screenshot=${shotTemp}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ];
  const logPath = path.join(workDir, 'chrome.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(chrome, args, { stdio: ['ignore', logFd, logFd], windowsHide: true });
  let exitCode: number | null = null;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve();
    }, 25000);
    child.on('exit', (code) => {
      exitCode = code;
      clearTimeout(timer);
      resolve();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  fs.closeSync(logFd);
  // 等待文件落盘
  for (let i = 0; i < 60; i++) {
    if (fs.existsSync(shotTemp) && fs.statSync(shotTemp).size > 12000) {
      // 复制到目标：目标可能被旧进程占用，重试
      for (let k = 0; k < 20; k++) {
        try {
          fs.copyFileSync(shotTemp, outPath);
          try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(-500) : '';
  throw new Error(`SVG 光栅化失败（code=${exitCode}）：${log}`);
}
