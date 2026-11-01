/**
 * 一键演示：不需要任何 API Key。
 * 用仓库内置的演示画面（demo/images）+ Edge-TTS 配音 + ffmpeg 渲染出一支约 35 秒的成片。
 *
 *   npm run demo
 *
 * 产物：data/projects/<新项目 id>/out/video.mp4
 * 说明：演示只跑「配音 → 配乐 → 合成」，跳过需要模型的文案/分镜/画面阶段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createProject, patchProject } from '../src/server/services/projects';
import { getProject } from '../src/server/db';
import { startPipeline } from '../src/server/services/pipeline';

const ROOT = process.cwd();
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'meta.json'), 'utf8')) as {
  title: string;
  topic: string;
  segments: string[];
};

if (!meta.segments?.length) {
  console.error('demo/meta.json 缺少 segments');
  process.exit(1);
}

const created = await createProject({
  sourceType: 'idea',
  topic: meta.topic,
  raw: meta.segments.join(''),
  requirements: {
    brief: '口播稿：保留原文',
    targetDurationSec: 40,
    language: 'zh',
    bgmMode: 'none',
  },
});
if (!created.project) {
  console.error('创建演示项目失败：', created.error);
  process.exit(1);
}
const id = created.project.id;
console.log('① 创建演示项目', id);

const imageDir = path.join(ROOT, 'data', 'projects', id, 'images');
fs.mkdirSync(imageDir, { recursive: true });
meta.segments.forEach((_, i) => {
  fs.copyFileSync(path.join(ROOT, 'demo', 'images', `shot_${i + 1}.png`), path.join(imageDir, `shot_${i + 1}.png`));
});

const segments = meta.segments.map((text, i) => ({ id: `seg_${i + 1}`, index: i, text, kind: 'narration' as const }));
const shots = meta.segments.map((text, i) => ({
  id: `shot_${i + 1}`,
  index: i,
  title: `${i + 1}. ${text.slice(0, 12)}`,
  subtitle: text,
  prompt: '',
  negativePrompt: '',
  motion: 'static' as const,
  shotSize: 'medium' as const,
  duration: Math.max(3, Math.min(12, text.length / 5.8)),
  segStart: i,
  segEnd: i,
  imageStatus: 'done' as const,
  palette: ['#0d1b2a', '#e8c86a'],
  visualAnchors: [],
}));

patchProject(id, (project) => {
  const next = project as unknown as Record<string, unknown>;
  next.segments = segments;
  next.storyboard = {
    ...(project.storyboard as unknown as Record<string, unknown>),
    provider: 'mock',
    model: 'demo',
    updatedAt: Date.now(),
    shots,
  };
  next.title = meta.title;
  return project;
});

console.log('② 配音 + 字幕 + 合成（约 30–60 秒）…');
const started = startPipeline(id, { from: 'voice', force: true });
if (!started.ok) {
  console.error('启动演示失败：', started.error);
  process.exit(1);
}
const deadline = Date.now() + 5 * 60 * 1000;
for (;;) {
  await new Promise((r) => setTimeout(r, 2000));
  const current = getProject(id);
  if (!current) break;
  if (current.status !== 'running') {
    if (current.status === 'error') console.error('渲染失败：', current.error);
    break;
  }
  if (Date.now() > deadline) {
    console.error('渲染超时');
    break;
  }
}

const done = getProject(id);
const video = path.join('data', 'projects', id, 'out', 'video.mp4');
if (!done || !fs.existsSync(video)) {
  console.error('渲染失败，请查看日志');
  process.exit(1);
}
console.log('✓ 演示成片：', video);
console.log('  时长：', Math.round(done.assets.videoDuration ?? 0), '秒');
console.log('  打开方式：浏览器访问 http://127.0.0.1:5099/projects/' + id);
