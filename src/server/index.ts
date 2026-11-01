import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR, PORT, PROJECTS_DIR, LOGS_DIR, detectFfmpeg } from './config';
import { registerApi } from './routes';
import { addActivity, seedDatabase } from './db';
import { getProject, listProjects, saveProject } from './db';
import { loadSong } from './services/lyrics';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));

// 开发期允许 Vite 直连（默认通过代理，这里兜底）
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
  }
  next();
});

app.use(
  '/media',
  express.static(PROJECTS_DIR, {
    fallthrough: true,
    index: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('cache-control', 'no-cache');
    },
  }),
);

registerApi(app);

app.get('/api', (_req, res) => {
  res.json({ name: 'Lyric Motion Studio API', status: 'ok' });
});

// 静态前端（public/index.html + public/build/*，由 esbuild 构建）
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: 0, etag: true }));
}
app.get('/', (_req, res, next) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    res
      .status(503)
      .send('前端尚未构建：请先运行 `pnpm build:web`（或 `pnpm dev`）。API 已就绪：/api/health');
    return;
  }
  try {
    const appJs = path.join(PUBLIC_DIR, 'build', 'app.js');
    const version = fs.existsSync(appJs) ? String(Math.round(fs.statSync(appJs).mtimeMs)) : '0';
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html
      .replace('/build/app.js', `/build/app.js?v=${version}`)
      .replace('/build/app.css', `/build/app.css?v=${version}`);
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.type('html').send(html);
  } catch {
    res.sendFile(indexPath);
  }
});

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/media')) {
    next();
    return;
  }
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    try {
      const appJs = path.join(PUBLIC_DIR, 'build', 'app.js');
      const version = fs.existsSync(appJs) ? String(Math.round(fs.statSync(appJs).mtimeMs)) : '0';
      let html = fs.readFileSync(indexPath, 'utf8');
      html = html
        .replace('/build/app.js', `/build/app.js?v=${version}`)
        .replace('/build/app.css', `/build/app.css?v=${version}`);
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.type('html').send(html);
    } catch {
      res.sendFile(indexPath);
    }
    return;
  }
  next();
});

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server error]', err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  seedDatabase();
  recoverInterruptedProjects();
  addActivity(null, 'info', '工作台启动');
  console.log(`\n  Lyric Motion Studio`);
  console.log(`  → 控制台: http://127.0.0.1:${PORT}`);
  console.log(`  → 数据目录: ${PROJECTS_DIR}`);
  detectFfmpeg().then((ff) => {
    console.log(ff.ok ? `  → ffmpeg: ${ff.version} (${ff.bin})` : '  → ffmpeg: 未找到，渲染不可用');
  });
  // 预热在线歌词能力（非阻塞）
  void loadSong('seed-01').catch(() => undefined);
});

/** 服务重启后，把“运行中”的残留项目标为中断，避免 UI 永远显示生成中 */
function recoverInterruptedProjects(): void {
  try {
    for (const summary of listProjects(200)) {
      const project = getProject(summary.id);
      if (!project) continue;
      const stale = project.status === 'running' || project.stages.some((stage) => stage.status === 'running');
      if (!stale) continue;
      if (project.status === 'running') project.status = project.assets?.videoUrl ? 'ready' : 'error';
      project.stages = project.stages.map((stage) =>
        stage.status === 'running' ? { ...stage, status: 'failed', message: '已中断，可重新运行' } : stage,
      );
      (project as unknown as { error?: string }).error = project.assets?.videoUrl
        ? undefined
        : '服务重启，流水线已中断，可重新运行';
      project.updatedAt = Date.now();
      saveProject(project);
      addActivity(project.id, 'warn', '服务重启：已中断的流水线已恢复为可重跑状态');
    }
  } catch (err) {
    console.warn('[recover] failed', err);
  }
}

function shutdown() {  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

fs.mkdirSync(LOGS_DIR, { recursive: true });
export { app, server };
