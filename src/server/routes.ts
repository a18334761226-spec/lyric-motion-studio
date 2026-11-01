import express from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CreateProjectBody,
  OptimizePromptBody,
  PipelineEvent,
  Project,
  ResearchRequestBody,
  SettingsUpdate,
  StartPipelineBody,
} from '../shared/types';
import { ASPECT_META, STAGE_META, STAGE_ORDER } from '../shared/types';
import { AMBIENCE_OPTIONS, DEFAULT_MUSIC_CONFIG, STYLE_PRESETS, VOICE_OPTIONS } from '../shared/presets';
import {
  addActivity,
  deleteProject,
  getProject,
  listActivity,
  listProjects,
  listSongs,
  saveProject,
} from './db';
import { DATA_DIR, PROJECTS_DIR, detectFfmpeg, projectDir, projectSubDir } from './config';
import { buildSettingsView, getSettings, imageCredentials, updateSettings } from './services/settings';
import { createProject, patchProject, projectStats, stylePresetOf, toSummary } from './services/projects';
import { importLyrics, loadSong, searchLyrics } from './services/lyrics';
import { researchTopic, testProviders } from './services/research';
import { synthesizePreview } from './services/tts';
import { generateShotImage } from './services/images';
import { llmJson, llmText, testDeepseek } from './services/llm';
import { optimizePromptMessages } from './services/prompts';
import { mockOptimizedPrompt } from './services/mock';
import { pipelineBus } from './services/events';
import {
  cancelPipeline,
  isPipelineRunning,
  optimizeShotPrompt,
  startPipeline,
} from './services/pipeline';
import { probeDuration } from './services/ffmpeg';
import { ensureSegmentsFromSource } from './services/projects';
import { normalizeShotCoverage } from './services/pipeline';
import { newId, safeFileName } from './services/text';

export const api = express.Router();

export function registerApi(app: express.Express): void {
  app.use('/api', api);
}

/* ------------------------------------------------------------------ */
/* 基础信息                                                            */
/* ------------------------------------------------------------------ */

api.get('/health', async (_req, res) => {
  const ff = await detectFfmpeg();
  res.json({ ok: true, name: 'Lyric Motion Studio', ffmpeg: ff.ok, ffmpegVersion: ff.version, time: Date.now() });
});

/* ------------------------- 每日自动出片 ------------------------- */

api.get('/daily/topics', (_req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/topics.json'), 'utf8')));
  } catch {
    res.json([]);
  }
});

api.get('/daily/exports', (_req, res) => {
  const dir = path.join(process.cwd(), 'data/exports');
  try {
    const items = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const folder = path.join(dir, d.name);
        let meta: unknown = undefined;
        try {
          meta = JSON.parse(fs.readFileSync(path.join(folder, 'meta.json'), 'utf8'));
        } catch {
          /* ignore */
        }
        return {
          name: d.name,
          at: fs.statSync(folder).mtimeMs,
          hasVideo: fs.existsSync(path.join(folder, 'video.mp4')),
          meta,
        };
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 30);
    res.json(items);
  } catch {
    res.json([]);
  }
});

api.post('/daily/run', (req, res) => {
  const body = (req.body ?? {}) as {
    topicIndex?: number;
    customTitle?: string;
    customTopic?: string;
    customAngle?: string;
    customScript?: string;
    dry?: boolean;
  };
  const exportsDir = path.join(process.cwd(), 'data/exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  const logFile = path.join(exportsDir, 'cron.log');
  const out = fs.openSync(logFile, 'a');
  const args = ['--import', './scripts/ts-loader.mjs', 'scripts/daily-video.ts'];
  const customTopic = (body.customTopic ?? '').trim();
  if (customTopic) {
    args.push('--custom', JSON.stringify({
      title: (body.customTitle ?? '').trim() || customTopic.slice(0, 12),
      topic: customTopic,
      angle: (body.customAngle ?? '').trim(),
      script: (body.customScript ?? '').trim(),
    }));
  } else if (typeof body.topicIndex === 'number' && body.topicIndex >= 0) {
    args.push('--topic', String(body.topicIndex));
  }
  if (body.dry) args.push('--dry');
  const child = spawn(process.execPath, args, { cwd: process.cwd(), detached: true, stdio: ['ignore', out, out] });
  child.unref();
  res.json({ started: true, pid: child.pid, log: logFile });
});


api.get('/projects/:id/publish-pack', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const outDir = path.join(process.cwd(), 'data/projects', project.id, 'out');
  const coverPng = path.join(outDir, 'cover.png');
  const coverJpg = path.join(outDir, 'cover.jpg');
  const coverUrl = fs.existsSync(coverPng)
    ? `/media/${project.id}/out/cover.png`
    : fs.existsSync(coverJpg)
      ? `/media/${project.id}/out/cover.jpg`
      : project.assets.coverUrl;
  const assets = project.assets as unknown as { publish?: { title: string; desc: string; tags: string[] } };
  let publish = assets.publish;
  if (!publish?.title) {
    const script = project.segments.map((seg) => seg.text).join('');
    const fallback = {
      title: project.title.slice(0, 20),
      desc: project.requirements.brief || '看懂周期，提前站位。',
      tags: ['财经', '经济周期', '财富'],
    };
    try {
      const result = await llmText({
        system: '你是短视频运营。为这条视频写抖音发布信息，只输出 JSON：{"title":"20字内标题，带数字或反差","desc":"2-3行简介，含1个问题引导互动","tags":["5-8个话题词，不带#"]}',
        user: `主题：${project.title}\n文案：${script.slice(0, 800)}`,
        fallback: () => JSON.stringify(fallback),
        maxTokens: 800,
        label: '发布包文案',
        projectId: project.id,
      });
      const parsed = JSON.parse(result.data.replace(/^\`\`\`json\s*|\`\`\`$/g, '').trim());
      publish = {
        title: String(parsed.title || fallback.title),
        desc: String(parsed.desc || fallback.desc),
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : fallback.tags,
      };
    } catch {
      publish = fallback;
    }
    const next = { ...project, assets: { ...project.assets, publish } } as typeof project;
    saveProject(next);
  }
  res.json({
    publish,
    coverUrl,
    videoUrl: project.assets.videoUrl,
    folder: `data/projects/${project.id}/out`,
    exportHint: '每日出片会额外导出到 data/exports/<日期>-<选题>/（video.mp4 / cover / title.txt / desc.txt / tags.txt）',
  });
});

api.get('/stats', async (_req, res) => {
  const stats = projectStats();
  const ff = await detectFfmpeg();
  stats.ffmpegReady = ff.ok;
  res.json(stats);
});

api.get('/styles', (_req, res) => {
  res.json(STYLE_PRESETS);
});

api.get('/voices', (_req, res) => {
  res.json(VOICE_OPTIONS);
});

api.get('/meta', (_req, res) => {
  res.json({
    stageMeta: STAGE_META,
    stageOrder: STAGE_ORDER,
    aspectMeta: ASPECT_META,
    ambienceOptions: AMBIENCE_OPTIONS,
  });
});

/* ------------------------------------------------------------------ */
/* 项目                                                                */
/* ------------------------------------------------------------------ */

api.get('/projects', (req, res) => {
  const q = String(req.query.q ?? '').toLowerCase().trim();
  const projects = listProjects(200)
    .map(toSummary)
    .filter((p) => !q || p.title.toLowerCase().includes(q) || p.brief.toLowerCase().includes(q));
  res.json(projects);
});

api.post('/projects', async (req, res) => {
  const body = req.body as CreateProjectBody;
  if (!body || !body.sourceType) {
    res.status(400).json({ error: '缺少 sourceType' });
    return;
  }
  const result = await createProject(body);
  if (result.error || !result.project) {
    res.status(400).json({ error: result.error || '创建失败' });
    return;
  }
  res.status(201).json(result.project);
});

api.get('/projects/:id', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json(project);
});

api.patch('/projects/:id', (req, res) => {
  const body = req.body as Partial<Project> & { requirements?: Project['requirements'] };
  const project = patchProject(req.params.id, (current) => {
    if (typeof body.title === 'string' && body.title.trim()) current.title = body.title.trim().slice(0, 60);
    if (body.requirements) current.requirements = { ...current.requirements, ...body.requirements };
    if (body.stylePresetId) {
      current.stylePresetId = body.stylePresetId;
      const preset = stylePresetOf(body.stylePresetId);
      current.render.subtitle = { ...preset.subtitle };
    }
    if (body.voice) current.voice = { ...current.voice, ...body.voice };
    if (body.render) current.render = { ...current.render, ...body.render };
    if (body.music) {
      current.music = { ...current.music, ...body.music };
      current.requirements.bgmMode = current.music.mode;
      current.requirements.bgmPrompt = current.music.prompt;
    }
    return current;
  });
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json(project);
});

api.delete('/projects/:id', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  cancelPipeline(project.id);
  deleteProject(project.id);
  const dir = path.join(PROJECTS_DIR, project.id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  addActivity(null, 'info', `删除项目「${project.title}」`);
  res.json({ ok: true });
});

api.post('/projects/:id/start', (req, res) => {
  const body = (req.body ?? {}) as StartPipelineBody;
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const result = startPipeline(project.id, { from: body.from, force: body.force, until: body.until });
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({ ok: true, running: isPipelineRunning(project.id) });
});

api.post('/projects/:id/cancel', (req, res) => {
  const ok = cancelPipeline(req.params.id);
  res.json({ ok });
});

api.get('/projects/:id/events', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (event: PipelineEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  send({ type: 'snapshot', projectId: project.id, at: Date.now(), project });
  const unsubscribe = pipelineBus.subscribe(project.id, send);
  const heartbeat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 20000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    try {
      res.end();
    } catch {
      /* ignore */
    }
  });
});

api.post('/projects/:id/stages/:stage/retry', (req, res) => {
  const stage = req.params.stage;
  if (!STAGE_ORDER.includes(stage as never)) {
    res.status(400).json({ error: '未知阶段' });
    return;
  }
  const result = startPipeline(req.params.id, { from: stage as never, force: true });
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

api.get('/projects/:id/download', (req, res) => {
  const project = getProject(req.params.id);
  if (!project?.assets.videoUrl) {
    res.status(404).json({ error: '成片尚未生成' });
    return;
  }
  const file = path.join(projectDir(project.id), 'out', 'video.mp4');
  if (!fs.existsSync(file)) {
    res.status(404).json({ error: '成片文件不存在' });
    return;
  }
  res.download(file, `${safeFileName(project.title)}.mp4`);
});

/* --------------------------- 分镜/提示词 --------------------------- */

api.put('/projects/:id/shots', (req, res) => {
  const shots = (req.body?.shots ?? []) as {
    id: string;
    title?: string;
    prompt?: string;
    negativePrompt?: string;
    subtitle?: string;
    motion?: string;
    shotSize?: string;
    searchQuery?: string;
  }[];
  const project = patchProject(req.params.id, (current) => {
    if (!current.storyboard) return current;
    for (const patch of shots) {
      const shot = current.storyboard.shots.find((s) => s.id === patch.id);
      if (!shot) continue;
      if (typeof patch.title === 'string') shot.title = patch.title.slice(0, 24);
      if (typeof patch.prompt === 'string') shot.prompt = patch.prompt;
      if (typeof patch.negativePrompt === 'string') shot.negativePrompt = patch.negativePrompt;
      if (typeof patch.subtitle === 'string') shot.subtitle = patch.subtitle;
      if (typeof patch.motion === 'string' && ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'drift-up', 'static'].includes(patch.motion)) {
        shot.motion = patch.motion as never;
      }
      if (typeof patch.shotSize === 'string') shot.shotSize = patch.shotSize;
      if (typeof patch.searchQuery === 'string') shot.searchQuery = patch.searchQuery.slice(0, 200);
    }
    return current;
  });
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json(project);
});

api.post('/projects/:id/shots/:shotId/optimize', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project?.storyboard) {
    res.status(404).json({ error: '分镜不存在' });
    return;
  }
  const shot = await optimizeShotPrompt(project, req.params.shotId);
  if (!shot) {
    res.status(404).json({ error: '镜头不存在' });
    return;
  }
  res.json({ shot, project: getProject(req.params.id) });
});

api.post('/projects/:id/shots/:shotId/regenerate', async (req, res) => {
  const project = getProject(req.params.id);
  const shot = project?.storyboard?.shots.find((s) => s.id === req.params.shotId);
  if (!project || !shot) {
    res.status(404).json({ error: '镜头不存在' });
    return;
  }
  const preset = stylePresetOf(project.stylePresetId);
  const imagesDir = projectSubDir(project.id, 'images');
  const outPath = path.join(imagesDir, `${shot.id}.png`);
  try {
    const result = await generateShotImage(shot, project, preset, imagesDir);
    shot.imageUrl = `/media/${project.id}/images/${path.basename(result.path)}?t=${Date.now()}`;
    shot.imageStatus = result.status === 'done' ? 'done' : 'mock';
    shot.error = result.warning;
    project.updatedAt = Date.now();
    saveProject(project);
    res.json({ shot, project });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ----------------------------- 配音 ------------------------------- */

api.post('/projects/:id/voice/preview', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const text = String(req.body?.text ?? '').trim();
  if (!text) {
    res.status(400).json({ error: '缺少试听文本' });
    return;
  }
  const voice = { ...project.voice, ...(req.body?.voice ?? {}) };
  const dir = projectSubDir(project.id, 'voice/preview');
  try {
    const result = await synthesizePreview(text.slice(0, 200), voice, dir);
    res.json({
      url: `/media/${project.id}/voice/preview/${path.basename(result.file)}`,
      duration: result.duration,
      warning: result.warning,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ----------------------------- 音乐 ------------------------------- */

api.post('/projects/:id/music/upload', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '60mb' }), async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const buffer = req.body as Buffer;
  if (!buffer?.length) {
    res.status(400).json({ error: '未接收到音频数据' });
    return;
  }
  const musicDir = projectSubDir(project.id, 'music');
  const ext = String(req.query.ext ?? 'mp3').replace(/[^a-z0-9]/gi, '') || 'mp3';
  const fileName = `upload-${Date.now()}.${ext}`;
  const filePath = path.join(musicDir, fileName);
  fs.writeFileSync(filePath, buffer);
  const duration = await probeDuration(filePath);
  project.music.mode = 'upload';
  project.music.uploadPath = `music/${fileName}`;
  project.assets.music = {
    bgmUrl: `/media/${project.id}/music/${fileName}?t=${Date.now()}`,
    bgmDuration: duration,
    generatedAt: Date.now(),
  };
  project.updatedAt = Date.now();
  saveProject(project);
  res.json({ project, duration });
});

/* ------------------------------------------------------------------ */
/* 歌词                                                                */
/* ------------------------------------------------------------------ */

api.get('/lyrics/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const online = req.query.online === undefined ? undefined : req.query.online !== 'false';
  try {
    const result = await searchLyrics(q, online);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

api.get('/lyrics/song/:id', async (req, res) => {
  const result = await loadSong(req.params.id);
  if (!result.song) {
    res.status(404).json({ error: result.error || '未找到歌词' });
    return;
  }
  res.json(result);
});

api.get('/lyrics/library', (_req, res) => {
  res.json(listSongs(100));
});

api.post('/lyrics/import', (req, res) => {
  const { raw, title, artist, language } = req.body ?? {};
  const result = importLyrics({ raw: String(raw ?? ''), title, artist, language });
  if (!result.song) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json(result.song);
});

/* ------------------------------------------------------------------ */
/* 联网研究                                                            */
/* ------------------------------------------------------------------ */

api.post('/research', async (req, res) => {
  const body = req.body as ResearchRequestBody;
  const topic = String(body?.topic ?? '').trim();
  if (!topic) {
    res.status(400).json({ error: '请输入研究主题' });
    return;
  }
  try {
    const bundle = await researchTopic({
      topic,
      era: body.era,
      extraQueries: body.extraQueries,
      maxSources: Math.min(20, Math.max(3, body.maxSources ?? 10)),
    });
    addActivity(null, 'info', `联网研究「${topic}」：${bundle.sources.length} 条资料`);
    res.json(bundle);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ------------------------------------------------------------------ */
/* 提示词实验室                                                        */
/* ------------------------------------------------------------------ */

api.post('/prompt/optimize', async (req, res) => {
  const body = req.body as OptimizePromptBody;
  const idea = String(body?.idea ?? '').trim();
  if (!idea) {
    res.status(400).json({ error: '请输入原始想法' });
    return;
  }
  const preset = stylePresetOf(body.stylePresetId || 'auto');
  const fallback = () => mockOptimizedPrompt(idea, preset);
  const result = await llmJson({
    ...optimizePromptMessages(idea, preset, body.requirements),
    fallback,
    validate: (value) => {
      const v = value as { optimized?: unknown; negative?: unknown; rationale?: unknown; variants?: unknown };
      if (typeof v.optimized !== 'string' || !v.optimized.trim()) return null;
      return {
        original: idea,
        optimized: v.optimized,
        negative: typeof v.negative === 'string' ? v.negative : fallback().negative,
        rationale: Array.isArray(v.rationale) ? v.rationale.filter((x): x is string => typeof x === 'string').slice(0, 6) : fallback().rationale,
        variants: Array.isArray(v.variants)
          ? v.variants
              .filter((x) => (x as { prompt?: unknown })?.prompt)
              .map((x) => ({ name: String((x as { name?: string }).name ?? '变体'), prompt: String((x as { prompt: string }).prompt), note: String((x as { note?: string }).note ?? '') }))
              .slice(0, 4)
          : fallback().variants,
        provider: 'mock' as const,
        model: 'local-mock',
      };
    },
    temperature: 0.85,
    maxTokens: 2000,
    label: '提示词实验室',
  });
  res.json({ ...result.data, provider: result.provider, model: result.model, warning: result.warning });
});

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

api.get('/settings', async (_req, res) => {
  res.json(await buildSettingsView());
});

api.put('/settings', async (req, res) => {
  const patch = req.body as SettingsUpdate;
  updateSettings(patch);
  addActivity(null, 'info', '更新设置');
  res.json(await buildSettingsView());
});

api.post('/settings/test', async (req, res) => {
  const target = String(req.body?.target ?? '');
  const settings = getSettings();
  try {
    switch (target) {
      case 'deepseek': {
        const result = await testDeepseek();
        res.json({ ok: result.ok, latencyMs: result.latencyMs, message: result.message, detail: result.detail });
        return;
      }
      case 'image': {
        const cred = imageCredentials();
        if (!cred.key || !cred.baseUrl || !cred.model) {
          res.json({ ok: false, message: '尚未配置生图接口或模型', detail: '可填 DeepSeek Key + 生图模型名，或任意 OpenAI 兼容生图服务的 Key / Base URL / 模型' });
          return;
        }
        const started = Date.now();
        const url = `${cred.baseUrl.replace(/\/+$/, '')}/models`;
        const resp = await fetch(url, { headers: { authorization: `Bearer ${cred.key}` } });
        res.json({
          ok: resp.ok,
          latencyMs: Date.now() - started,
          message: resp.ok ? `生图服务可达${cred.viaDeepseek ? '（复用 DeepSeek Key）' : ''}` : `生图服务返回 ${resp.status}`,
          detail: resp.ok ? `${cred.baseUrl} · ${cred.model}` : (await resp.text()).slice(0, 200),
        });
        return;
      }
      case 'research': {
        const providers = await testProviders();
        const ok = Object.values(providers).some((p) => p.ok);
        res.json({
          ok,
          message: ok ? '联网检索可用' : '所有检索通道均不可用',
          detail: Object.entries(providers)
            .map(([k, v]) => `${k}: ${v.ok ? '可用' : '失败'} (${v.latencyMs}ms)`)
            .join(' · '),
        });
        return;
      }
      case 'tts': {
        const started = Date.now();
        const testText = String(req.body?.text ?? '配音测试，一、二、三。');
        const result = await synthesizePreview(testText, { ...projectDefaultVoice(), voiceId: settings.defaultVoiceId }, path.join(DATA_DIR, 'tmp'));
        res.json({
          ok: !result.warning,
          latencyMs: Date.now() - started,
          message: result.warning ? 'Edge-TTS 合成失败，已降级静音' : 'Edge-TTS 合成正常',
          detail: `时长 ${result.duration.toFixed(2)}s${result.warning ? ` · ${result.warning}` : ''}`,
        });
        return;
      }
      case 'ffmpeg': {
        const ff = await detectFfmpeg(true);
        res.json({
          ok: ff.ok,
          message: ff.ok ? `ffmpeg 可用（${ff.version}）` : '未找到可用的 ffmpeg',
          detail: ff.bin || '请安装 ffmpeg 并在设置页指定路径',
        });
        return;
      }
      default:
        res.status(400).json({ ok: false, message: '未知测试目标' });
    }
  } catch (err) {
    res.json({ ok: false, message: '测试失败', detail: (err as Error).message.slice(0, 300) });
  }
});

function projectDefaultVoice() {
  return {
    voiceId: getSettings().defaultVoiceId,
    rate: -6,
    pitch: 0,
    volume: 0,
    gapMs: 140,
  };
}

/* ------------------------------------------------------------------ */
/* 声音/音乐预设                                                        */
/* ------------------------------------------------------------------ */

api.get('/music/defaults', (_req, res) => {
  res.json({ music: DEFAULT_MUSIC_CONFIG, ambience: AMBIENCE_OPTIONS });
});

/* 本地歌曲库：assets/music 与 data/music 里的真实歌曲，可直接选作 BGM */
const MUSIC_LIBRARY_DIRS = [path.join(process.cwd(), 'assets', 'music'), path.join(process.cwd(), 'data', 'music')];
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac']);

api.get('/music/library', (_req, res) => {
  const items: { name: string; sizeMB: number }[] = [];
  for (const dir of MUSIC_LIBRARY_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const ext = path.extname(file).toLowerCase();
      if (!AUDIO_EXTS.has(ext)) continue;
      try {
        const stat = fs.statSync(path.join(dir, file));
        items.push({ name: file, sizeMB: Math.round((stat.size / 1024 / 1024) * 10) / 10 });
      } catch {
        /* ignore */
      }
    }
  }
  res.json({ items });
});

api.post('/projects/:id/music/select', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const name = path.basename(String(req.body?.name ?? ''));
  const source = MUSIC_LIBRARY_DIRS.map((dir) => path.join(dir, name)).find((file) => fs.existsSync(file));
  if (!source) {
    res.status(404).json({ error: '曲库里没有这首歌' });
    return;
  }
  const targetDir = projectSubDir(project.id, 'music');
  const fileName = `song-${Date.now()}${path.extname(source)}`;
  const targetPath = path.join(targetDir, fileName);
  fs.copyFileSync(source, targetPath);
  const duration = await probeDuration(targetPath);
  project.music.mode = 'upload';
  project.music.uploadPath = `music/${fileName}`;
  project.requirements.bgmMode = 'upload';
  project.assets.music = {
    bgmUrl: `/media/${project.id}/music/${fileName}?t=${Date.now()}`,
    bgmDuration: duration,
    generatedAt: Date.now(),
  };
  saveProject(project);
  addActivity(project.id, 'info', `背景音乐改为歌曲：${name}`);
  res.json({ project, duration });
});

/* 项目内联刷新（避免前端多次请求） */
api.get('/projects/:id/summary', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json(toSummary(project));
});

/* 让 TS 认为这些导入被使用（部分用于未来扩展） */
void newId;
void ensureSegmentsFromSource;
void normalizeShotCoverage;
void listActivity;
