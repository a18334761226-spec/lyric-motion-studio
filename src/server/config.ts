import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * 项目根目录：默认取启动时的工作目录（在仓库根执行 `pnpm start` / `node dist-server/server.js`）。
 * 可用 APP_ROOT 覆盖。
 */
export const ROOT = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : process.cwd();
export const DATA_DIR = path.join(ROOT, 'data');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const DB_PATH = path.join(DATA_DIR, 'studio.db');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const DIST_DIR = path.join(ROOT, 'dist-server');
export const PUBLIC_DIR = path.join(ROOT, 'public');

export const PORT = Number(process.env.PORT || 5099);
export const IS_PROD = process.env.NODE_ENV === 'production';

for (const dir of [DATA_DIR, PROJECTS_DIR, LOGS_DIR, TMP_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export function projectDir(projectId: string): string {
  const dir = path.join(PROJECTS_DIR, safeId(projectId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function projectSubDir(projectId: string, sub: string): string {
  const dir = path.join(projectDir(projectId), sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function safeId(id: string): string {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}

/* ------------------------------------------------------------------ */
/* ffmpeg / ffprobe 探测                                                */
/* ------------------------------------------------------------------ */

const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe'),
  'C:/ffmpeg/bin/ffmpeg.exe',
  'ffmpeg',
].filter(Boolean) as string[];

const FFPROBE_CANDIDATES = [
  process.env.FFPROBE_PATH,
  FFMPEG_CANDIDATES[0] ? path.join(path.dirname(FFMPEG_CANDIDATES[0]), 'ffprobe.exe') : '',
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffprobe.exe'),
  'C:/ffmpeg/bin/ffprobe.exe',
  'ffprobe',
].filter(Boolean) as string[];

export interface CommandResult {
  code: number;
  log: string;
  timedOut: boolean;
}

/**
 * 在 Windows 沙箱环境下，Node 的管道 stdio 会 EPERM；
 * 因此统一把 stdout/stderr 重定向到文件（文件句柄 stdio 可用），再读取内容。
 */
export function runCommand(
  bin: string,
  args: string[],
  opts: { logPath?: string; timeoutMs?: number; cwd?: string } = {},
): Promise<CommandResult> {
  const logPath = opts.logPath || path.join(LOGS_DIR, `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'w');
  return new Promise((resolve) => {
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let child;
    try {
      child = spawn(bin, args, {
        cwd: opts.cwd || ROOT,
        stdio: ['ignore', fd, fd],
        windowsHide: true,
      });
    } catch (err) {
      fs.closeSync(fd);
      resolve({ code: -1, log: `spawn failed: ${(err as Error).message}`, timedOut: false });
      return;
    }
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, opts.timeoutMs);
    }
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
      resolve({ code: -1, log: `spawn failed: ${err.message}`, timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
      let log = '';
      try {
        log = fs.readFileSync(logPath, 'utf8');
      } catch {
        /* ignore */
      }
      resolve({ code: code ?? -1, log, timedOut });
    });
  });
}

let ffmpegCache: { bin: string; probe: string; version: string; ok: boolean } | null = null;

export async function detectFfmpeg(force = false): Promise<{ bin: string; probe: string; version: string; ok: boolean }> {
  if (ffmpegCache && !force) return ffmpegCache;
  for (const cand of FFMPEG_CANDIDATES) {
    if (!cand) continue;
    if (cand.includes(path.sep) && !fs.existsSync(cand)) continue;
    const res = await runCommand(cand, ['-hide_banner', '-version'], { timeoutMs: 15000 });
    if (res.code === 0 && /ffmpeg version/i.test(res.log)) {
      const version = (res.log.match(/ffmpeg version\s+([^\s]+)/i)?.[1] || 'unknown');
      let probe = '';
      for (const p of FFPROBE_CANDIDATES) {
        if (!p) continue;
        if (p.includes(path.sep) && !fs.existsSync(p)) continue;
        const r = await runCommand(p, ['-hide_banner', '-version'], { timeoutMs: 10000 });
        if (r.code === 0 && /ffprobe version/i.test(r.log)) {
          probe = p;
          break;
        }
      }
      if (!probe) {
        const sibling = path.join(path.dirname(cand), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
        if (fs.existsSync(sibling)) probe = sibling;
      }
      ffmpegCache = { bin: cand, probe, version, ok: true };
      return ffmpegCache;
    }
  }
  ffmpegCache = { bin: '', probe: '', version: '', ok: false };
  return ffmpegCache;
}

export function invalidateFfmpegCache(): void {
  ffmpegCache = null;
}
