import fs from 'node:fs';
import path from 'node:path';
import type { Project, Shot, StylePreset } from '../../shared/types';
import { ASPECT_META } from '../../shared/types';
import { detectFfmpeg, runCommand } from '../config';
import { getSettings, imageCredentials, imageProvider } from './settings';
import { hashString } from './text';
import { pickPixelScene } from './pixelScene';
import { buildSceneSvg, type SvgSceneType } from './svgScene';
import { renderSvgToPng } from './svgRender';
import { directStyle } from './artDirector';
import { drawFallbackPng, drawShotSvg } from './svgDirector';

/** 逐句场景 → SVG 插画类型 */
const SVG_SCENE_MAP: Record<string, SvgSceneType> = {
  'autumn-leaves': 'autumn-leaves',
  'tear-rain': 'tear-rain',
  'eyes-meet': 'eyes-meet',
  swordsman: 'swordsman',
  'scroll-memory': 'scroll-memory',
  'old-tree': 'old-tree',
  'stone-alley': 'stone-alley',
  'horse-rider': 'horse-rider',
  'wine-jar': 'wine-jar',
  'sword-wound': 'sword-wound',
  'red-thread': 'red-thread',
  'ghost-light': 'ghost-light',
  heartbeat: 'ghost-light',
  candle: 'candle',
  'winding-road': 'stone-alley',
  'fire-battle': 'fire-battle',
  'battlefield-close': 'fire-battle',
  'city-gate': 'swordsman',
  palace: 'candle',
  tavern: 'wine-jar',
  'lantern-river': 'stone-alley',
};

const SVG_SCENE_LABEL: Record<string, string> = {
  'autumn-leaves': '落叶',
  'tear-rain': '泪雨',
  'eyes-meet': '对视',
  swordsman: '挥剑',
  'scroll-memory': '前朝记忆',
  'old-tree': '老树根',
  'stone-alley': '青石月光',
  'horse-rider': '策马',
  'wine-jar': '醇酒',
  'sword-wound': '伤痕',
  'red-thread': '红线',
  'ghost-light': '转世魂光',
  candle: '一灯',
  'fire-battle': '赤壁火战',
};

const QUALITY_SUFFIX = 'cinematic lighting, film grain, dramatic composition, ultra detailed, 8k, masterpiece';

function outputSize(project: Project): { width: number; height: number } {
  const dims = ASPECT_META[project.render.aspect];
  const scale = project.render.resolution === '1080p' ? 1 : 0.667;
  return { width: Math.round(dims.width * scale), height: Math.round(dims.height * scale) };
}

/**
 * 纯代码 SVG 插画：按句选场景 → 生成矢量插画 → Chrome 光栅化 1080×1920。
 * 不依赖任何 AI 图像模型。
 */
export async function generateMockImage(
  shot: Shot,
  preset: StylePreset,
  width: number,
  height: number,
  outPath: string,
  sceneText?: string,
): Promise<void> {
  void preset;
  const seed = hashString(`${shot.id}|${shot.subtitle || shot.title}`) % 1_000_000;
  const sceneLine = (sceneText || shot.subtitle || shot.title).split('\n')[0] || shot.title;
  const pick = pickPixelScene(sceneLine, shot.index ?? 0);
  const svgType = SVG_SCENE_MAP[pick.type] ?? 'scroll-memory';
  const dir = directStyle(sceneLine, shot.index ?? 0, shot.prompt, svgType);
  const chapter = `CH.${String((shot.index ?? 0) + 1).padStart(2, '0')} · ${SVG_SCENE_LABEL[svgType] ?? '画面'} · ${dir.mood}`;
  const svg = buildSceneSvg({ type: svgType, seed, variant: (shot.index ?? 0) % 4, style: dir.style, chapter }, shot.id);
  await renderSvgToPng(svg, outPath, width, height);
  shot.pixelScene = undefined;
  shot.imageStatus = 'done';
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 12000) throw new Error('插画生成失败：输出文件为空');
}

/** 调用 OpenAI 兼容的图像生成接口（可用 DeepSeek Key + 生图模型，也支持 SiliconFlow 等） */
export async function generateApiImage(shot: Shot, project: Project, outPath: string): Promise<void> {
  const cred = imageCredentials();
  if (!cred.key || !cred.baseUrl || !cred.model) throw new Error('未配置生图接口或模型');
  const aspect = project.render.aspect;
  const size = aspect === '9:16' ? '1024x1792' : aspect === '16:9' ? '1792x1024' : '1024x1024';
  const prompt = `${shot.prompt}. Style: ${project.storyboard?.visualStyle ?? ''}. Avoid: ${shot.negativePrompt}. ${QUALITY_SUFFIX}`;
  const url = `${cred.baseUrl.replace(/\/+$/, '')}/images/generations`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cred.key}` },
      body: JSON.stringify({
        model: cred.model,
        prompt,
        negative_prompt: shot.negativePrompt,
        n: 1,
        size,
        response_format: 'b64_json',
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`生图接口 ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text) as { data?: { b64_json?: string; url?: string }[] };
    const item = json.data?.[0];
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (item?.b64_json) {
      fs.writeFileSync(outPath, Buffer.from(item.b64_json, 'base64'));
      return;
    }
    if (item?.url) {
      const imgRes = await fetch(item.url, { signal: controller.signal });
      if (!imgRes.ok) throw new Error(`下载生成图失败 ${imgRes.status}`);
      fs.writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
      return;
    }
    throw new Error('生图接口未返回图片数据');
  } finally {
    clearTimeout(timer);
  }
}

export interface ImageResult {
  path: string;
  status: 'mock' | 'done';
  warning?: string;
}

/**
 * 生成单个镜头画面：配置了生图 API（DeepSeek Key 或任意 OpenAI 兼容生图服务）就用 API；
 * 未配置时用程序化画面兜底，保证流水线不中断。
 */
export async function generateShotImage(
  shot: Shot,
  project: Project,
  preset: StylePreset,
  outDir: string,
): Promise<ImageResult> {
  const { width, height } = outputSize(project);
  const jpgPath = path.join(outDir, `${shot.id}.jpg`);
  const pngPath = path.join(outDir, `${shot.id}.png`);
  fs.mkdirSync(outDir, { recursive: true });

  if (imageProvider() === 'api') {
    try {
      await generateApiImage(shot, project, jpgPath);
      return { path: jpgPath, status: 'done' };
    } catch (err) {
      const warning = `生图失败，已降级：${(err as Error).message.slice(0, 120)}`;
      await generateDirectorImage(shot, project, width, height, pngPath, project.segments[shot.segStart]?.text ?? shot.subtitle);
      return { path: pngPath, status: 'mock', warning };
    }
  }
  await generateDirectorImage(shot, project, width, height, pngPath, project.segments[shot.segStart]?.text ?? shot.subtitle);
  return { path: pngPath, status: 'mock' };
}

/** 通用图像层：内容 profile → 逐镜 ArtDirection → DeepSeek 直接绘制 SVG（不依赖歌词场景库） */
export async function generateDirectorImage(
  shot: Shot,
  project: Project,
  width: number,
  height: number,
  outPath: string,
  sceneText?: string,
): Promise<void> {
  const text = (sceneText || shot.subtitle || shot.title).split('\n')[0] || shot.title;
  try {
    const { svg, focuses } = await drawShotSvg(project, shot, text);
    shot.focuses = focuses;
    await renderSvgToPng(svg, outPath, width, height);
  } catch (err) {
    // 兜底：不使用歌词场景库，只给中性渐变色板
    await drawFallbackPng(project, shot, outPath);
    console.warn('[image] 本镜 SVG 失败，已用兜底画面：', (err as Error).message.slice(0, 160));
  }
  shot.pixelScene = undefined;
  shot.imageStatus = 'done';
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 8000) throw new Error('插画生成失败：输出文件为空');
}

/** 生成封面（首帧 + 标题文字） */
export async function generateCover(imagePath: string, title: string, outPath: string, width: number, height: number): Promise<void> {
  const ff = await detectFfmpeg();
  if (!ff.ok) throw new Error('ffmpeg 不可用');
  const font = 'C\\:/Windows/Fonts/msyhbd.ttc';
  const safeTitle = title.replace(/[\\':%]/g, ' ').slice(0, 18);
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.32:t=fill`,
    `drawtext=fontfile='${font}':text='${safeTitle}':fontsize=${Math.round(width / 11)}:fontcolor=white@0.95:x=(w-tw)/2:y=h*0.44`,
    `drawtext=fontfile='${font}':text='LYRIC MOTION STUDIO':fontsize=${Math.round(width / 40)}:fontcolor=white@0.6:x=(w-tw)/2:y=h*0.56`,
  ].join(',');
  const res = await runCommand(ff.bin, ['-y', '-hide_banner', '-i', imagePath, '-vf', vf, '-frames:v', '1', '-update', '1', outPath]);
  if (res.code !== 0) throw new Error(`封面生成失败：${res.log.slice(-300)}`);
}
