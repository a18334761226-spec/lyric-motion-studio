import fs from 'node:fs';
import path from 'node:path';
import type { Project, Shot } from '../../shared/types';
import { ASPECT_META } from '../../shared/types';
import { detectFfmpeg, projectDir, projectSubDir, runCommand } from '../config';
import { buildAss, buildShotClip, probeDuration, renderVideo, type SubtitleItem } from './ffmpeg';
import { generateCover } from './images';
import { drawCoverPng } from './svgDirector';
import { getSettings } from './settings';
import { stylePresetOf } from './projects';
import { wrapSubtitle } from './text';
import { buildSceneSvg } from './svgScene';
import { renderSvgToPng } from './svgRender';

/** 像素镜头的取景框运动：整幅构图已满屏，只做很轻的平移 */
function pixelPan(type: string, index: number): { x: string; y: string } {
  void type;
  const span = 96; // 最大位移（源比画面大 15%）
  return index % 4 === 0
    ? { x: `min(${span},t*26)`, y: '20' }
    : index % 4 === 1
      ? { x: `max(${span}-t*26,0)`, y: '20' }
      : index % 4 === 2
        ? { x: '40', y: `min(${span},t*28)` }
        : { x: '40', y: `max(${span}-t*28,0)` };
}

export interface ComposeOptions {
  onProgress: (pct: number, message: string, shotId?: string) => void;
  isCancelled: () => boolean;
}

export class CancelledError extends Error {
  constructor() {
    super('任务已取消');
    this.name = 'CancelledError';
  }
}

export interface ShotTiming {
  shot: Shot;
  /** 音轨上的开始/结束 */
  audioStart: number;
  audioEnd: number;
  audioDuration: number;
  clipDuration: number;
}

/** 依据逐句配音时间轴，计算每个镜头在音轨上的精确起止与片段长度 */
export function computeShotTimings(project: Project, width: number, height: number): { timings: ShotTiming[]; transition: number; total: number } {
  const timeline = project.assets.timeline ?? [];
  const shots = project.storyboard?.shots ?? [];
  if (!timeline.length) throw new Error('缺少配音时间轴，无法合成');
  if (!shots.length) throw new Error('缺少分镜，无法合成');

  const lastSegIndex = timeline.length - 1;
  const timings: ShotTiming[] = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const segStart = Math.max(0, Math.min(lastSegIndex, shot.segStart));
    const segEnd = Math.max(segStart, Math.min(lastSegIndex, shot.segEnd));
    const audioStart = timeline[segStart].start;
    const isLast = i === shots.length - 1;
    let audioEnd: number;
    if (isLast) {
      audioEnd = timeline[lastSegIndex].end + project.render.outroSec;
    } else {
      const nextShot = shots[i + 1];
      const nextStart = Math.max(0, Math.min(lastSegIndex, nextShot.segStart));
      audioEnd = timeline[nextStart].start;
    }
    if (audioEnd - audioStart < 0.6) audioEnd = audioStart + 0.6;
    const audioDuration = audioEnd - audioStart;
    const transition = project.render.xfade
      ? Math.max(0.15, Math.min(project.render.transitionSec, audioDuration * 0.45))
      : 0;
    timings.push({
      shot,
      audioStart,
      audioEnd,
      audioDuration,
      clipDuration: audioDuration + (isLast ? 0 : transition),
    });
  }
  const transition = project.render.xfade
    ? Math.max(0.15, Math.min(project.render.transitionSec, Math.min(...timings.map((t) => t.audioDuration)) * 0.45))
    : 0;
  // 统一转场时长后重算片段长度，确保与 ffmpeg 的转场计算一致
  for (let i = 0; i < timings.length; i++) {
    timings[i].clipDuration = timings[i].audioDuration + (i === timings.length - 1 ? 0 : transition);
  }
  const total = timings[timings.length - 1].audioEnd;
  void width;
  void height;
  return { timings, transition, total };
}

export async function composeProject(project: Project, opts: ComposeOptions): Promise<Project> {
  const preset = stylePresetOf(project.stylePresetId);
  const dims = ASPECT_META[project.render.aspect];
  const width = project.render.resolution === '1080p' ? dims.width : Math.round(dims.width * 0.667 / 2) * 2;
  const height = project.render.resolution === '1080p' ? dims.height : Math.round(dims.height * 0.667 / 2) * 2;
  const fps = project.render.fps;
  const dir = projectDir(project.id);
  const imagesDir = projectSubDir(project.id, 'images');
  const clipsDir = projectSubDir(project.id, 'clips');
  const outDir = projectSubDir(project.id, 'out');
  const voiceDir = projectSubDir(project.id, 'voice');

  const { timings, total } = computeShotTimings(project, width, height);
  // LRC 歌曲通常有前奏：用标题镜头占住 0 → 第一句 的时间，避免画面/字幕错位
  const firstLineStart = project.assets.timeline?.[0]?.start ?? 0;
  const transition = project.render.xfade
    ? Math.max(0.15, Math.min(project.render.transitionSec, Math.min(...timings.map((t) => t.audioDuration)) * 0.45))
    : 0;
  if (firstLineStart > 0.6) {
    const introShot: Shot = {
      ...timings[0].shot,
      id: 'intro',
      index: -1,
      title: project.title,
      subtitle: project.title,
      prompt: '',
      negativePrompt: '',
      motion: 'zoom-in',
      palette: timings[0].shot.palette,
      pixelScene: { type: 'title-desert', variant: 0, seed: 20261030 },
    };
    timings.unshift({
      shot: introShot,
      audioStart: 0,
      audioEnd: firstLineStart,
      audioDuration: firstLineStart,
      clipDuration: firstLineStart + transition,
    });
  }
  const realShots = timings.filter((t) => t.shot.id !== 'intro');
  opts.onProgress(5, `时间轴就绪：${realShots.length} 个镜头 + 前奏 ${firstLineStart.toFixed(1)}s`);

  // 1. 生成每个镜头的运镜片段（受限并发）
  const concurrency = Math.max(1, Math.min(4, getSettings().renderConcurrency));
  let doneCount = 0;
  const queue = [...timings];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      if (opts.isCancelled()) throw new CancelledError();
      const job = queue.shift();
      if (!job) break;
      const pngPath = path.join(imagesDir, `${job.shot.id}.png`);
      const jpgPath = path.join(imagesDir, `${job.shot.id}.jpg`);
      let realImage = fs.existsSync(pngPath) ? pngPath : jpgPath;
      if (!fs.existsSync(realImage)) {
        if (job.shot.id !== 'intro') throw new Error(`缺少镜头画面：${job.shot.id}`);
        // 前奏标题卡（纯代码 SVG 插画）
        const svg = buildSceneSvg(
          {
            type: 'title',
            seed: 20261030,
            variant: 0,
            title: project.source.title,
            artist: project.source.author,
            subtitle: '代码绘制 · 原曲同步',
          },
          'intro',
        );
        await renderSvgToPng(svg, pngPath, width, height);
        realImage = pngPath;
      }
      const clipPath = path.join(clipsDir, `${job.shot.id}.mp4`);
      await buildShotClip({
        imagePath: realImage,
        durationSec: job.clipDuration,
        motion: 'static',
        width,
        height,
        fps,
        outPath: clipPath,
      });
      job.shot.clipUrl = `/media/${project.id}/clips/${job.shot.id}.mp4`;
      doneCount += 1;
      opts.onProgress(5 + Math.round((doneCount / timings.length) * 55), `镜头片段 ${doneCount}/${timings.length} 完成`, job.shot.id);
    }
  });
  await Promise.all(workers);
  if (opts.isCancelled()) throw new CancelledError();

  // 2. 字幕
  const timeline = project.assets.timeline ?? [];
  const maxLen = project.render.aspect === '16:9' ? 26 : 18;
  const items: SubtitleItem[] = timeline.map((item) => ({
    text: wrapSubtitle(item.text, maxLen),
    start: item.start,
    end: Math.max(item.start + 0.4, item.end),
    kind: 'subtitle',
  }));
  const assPath = path.join(dir, 'subtitles.ass');
  const ass = buildAss({
    items,
    style: project.render.subtitle,
    width,
    height,
    title: project.source.type === 'lyrics' ? project.source.title : undefined,
    subtitle: project.source.type === 'lyrics' ? project.source.author : undefined,
  });
  fs.writeFileSync(assPath, ass, 'utf8');

  // 3. 音轨（人声朗读可关闭：只保留 BGM）
  const voicePath = path.join(voiceDir, 'voiceover.mp3');
  const voiceEnabled = project.voice.enabled !== false;
  const useVoice = voiceEnabled && fs.existsSync(voicePath);
  if (voiceEnabled && !useVoice) throw new Error('缺少旁白音轨');
  const bgmFile = project.assets.music?.bgmUrl ? project.assets.music.bgmUrl.split('?')[0].split('/').pop() : undefined;
  const ambienceFile = project.assets.music?.ambienceUrl
    ? project.assets.music.ambienceUrl.split('?')[0].split('/').pop()
    : undefined;
  const bgmPath = bgmFile ? path.join(dir, 'music', bgmFile) : undefined;
  const ambiencePath = ambienceFile ? path.join(dir, 'music', ambienceFile) : undefined;
  const volume = Math.max(0.02, Math.min(0.28, project.music.volume));
  opts.onProgress(66, '混音与成片编码…');

  // 4. 成片
  const outPath = path.join(outDir, 'video.mp4');
  const result = await renderVideo({
    clips: timings.map((t) => ({
      file: path.join(clipsDir, `${t.shot.id}.mp4`),
      audioDuration: t.audioDuration,
      clipDuration: t.clipDuration,
    })),
    audio: {
      voicePath: useVoice ? voicePath : undefined,
      bgmPath: bgmPath && fs.existsSync(bgmPath) ? bgmPath : undefined,
      bgmVolume: volume,
      ambiencePath: ambiencePath && fs.existsSync(ambiencePath) ? ambiencePath : undefined,
      ambienceVolume: 0.4,
    },
    assPath,
    outPath,
    width,
    height,
    fps,
    transitionSec: project.render.transitionSec,
    xfade: project.render.xfade,
    totalDuration: total,
  });
  opts.onProgress(92, '生成封面…');

  // 5. 封面
  const firstShot = realShots[0].shot;
  const coverSourcePng = path.join(imagesDir, `${firstShot.id}.png`);
  const coverSourceJpg = path.join(imagesDir, `${firstShot.id}.jpg`);
  const coverSource = fs.existsSync(coverSourcePng) ? coverSourcePng : coverSourceJpg;
  const coverJpgPath = path.join(outDir, 'cover.jpg');
  const coverPngPath = path.join(outDir, 'cover.png');
  try {
    if (fs.existsSync(coverSource)) {
      try {
        await drawCoverPng(project, coverPngPath);
      } catch {
        await generateCover(coverSource, project.title, coverJpgPath, Math.round(width * 0.5), Math.round(height * 0.5));
      }
    }
  } catch {
    /* 封面失败不影响成片 */
  }
  // 兜底：直接从成片抽一帧当封面
  if (!fs.existsSync(coverPngPath) && !fs.existsSync(coverJpgPath)) {
    try {
      const ff = await detectFfmpeg();
      if (ff.ok) {
        await runCommand(ff.bin, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', outPath, '-frames:v', '1', '-q:v', '3', coverJpgPath]);
      }
    } catch {
      /* 忽略 */
    }
  }
  const coverUrl = fs.existsSync(coverPngPath)
    ? `/media/${project.id}/out/cover.png`
    : fs.existsSync(coverJpgPath)
      ? `/media/${project.id}/out/cover.jpg`
      : project.assets.coverUrl;

  const updated: Project = {
    ...project,
    status: 'ready',
    assets: {
      ...project.assets,
      videoUrl: `/media/${project.id}/out/video.mp4`,
      coverUrl,
      videoDuration: result.duration,
      videoSize: result.size,
      voiceoverDuration:
        project.assets.voiceoverDuration ?? (useVoice ? await probeDuration(voicePath) : (timeline.at(-1)?.end ?? result.duration)),
    },
  };
  opts.onProgress(100, `成片完成：${result.duration.toFixed(1)}s · ${(result.size / 1024 / 1024).toFixed(1)}MB`);
  return updated;
}
