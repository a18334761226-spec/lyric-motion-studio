import fs from 'node:fs';
import path from 'node:path';
import type { Project } from '../../shared/types';
import { projectDir } from '../config';
import { getSettings } from './settings';
import { buildShotSvg, type ShotArt } from './artRender';
import { renderSvgToPng } from './svgRender';
import { getContentProfile } from './svgDirector';

/**
 * 紧凑镜头配方：LLM 一次输出全片每镜 6–10 个图元（单字母键），
 * 本地渲染器展开成完整 SVG（渐变/辉光/雾/颗粒由代码补）。
 * 目的：把 LLM 输出压到整片 2–4KB，保证 20+ 镜稳定生成。
 */

type Recipe = { i: number; f?: string; h?: number; p?: string[]; l?: string; e: (string | number)[][] };

const KINDS = [
  'sky', 'stars', 'moon', 'sun', 'clouds', 'mountains', 'mist', 'water', 'ground',
  'reeds', 'birds', 'tree', 'figure', 'boat', 'pavilion', 'wall', 'lanterns', 'rain',
  'embers', 'particles', 'candle', 'wineJar', 'scroll', 'sword', 'banner', 'horse',
  'window', 'table', 'interiorWall',
  'factory', 'chimney', 'smoke', 'rails', 'train', 'powerGrid', 'city', 'crowd',
  'desk', 'port', 'dataCenter', 'chip', 'steam', 'spotlight', 'stairs',
];

const PROMPT = `你是视频分镜美术。为下面每段文字设计一镜画面，只输出紧凑 JSON 配方，不要解释、不要 SVG。

可用图元 kind（只能用这些）：
${KINDS.join(', ')}

字段（全部用短键，元素用数组，减少输出）：
{"shots":[{"i":1,"f":"wide|medium|close","h":0.58,"p":["#hex","#hex","#hex"],"l":"warm|cold|moon|fire|window|none","e":[["kind",x,y,scale,"#color"]]}]}
- x,y 为 0-1 归一化坐标；scale 0.5-2.5；color 可省略。
- 每镜 6–10 个图元；远景（sky/mountains/city/mist）+ 中景（factory/rails/powerGrid/water/ground/port/dataCenter）+ 近景（figure/crowd/desk/candle/reeds）三层都要有。
- 内容对应的年代与主题要准确：工业革命用 factory/chimney/steam/rails/train；电气时代用 powerGrid/city；信息时代用 dataCenter/chip/city；金融/交易所可用 crowd/desk/window；不要出现与内容无关的图元。
- 构图：主体不要压在底部 12%（字幕区）；每镜主体位置不同。
- 全片共享同一色板与光线逻辑，但每镜景别/地平线/主体要变化。

只输出 JSON。`;

async function chat(system: string, user: string, maxTokens = 4000): Promise<string> {
  const s = getSettings();
  const key = s.deepseekApiKey;
  if (!key) throw new Error('未配置 DeepSeek Key');
  const body = {
    model: s.deepseekModel || 'deepseek-flash',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.8,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const r = await fetch(`${(s.deepseekBaseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const txt = await r.text();
      if (r.ok) return JSON.parse(txt).choices[0].message.content as string;
    } catch {
      /* retry */
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('配方生成失败');
}

function recipePath(id: string): string {
  return path.join(projectDir(id), 'recipe.json');
}

const DEPTH: Record<string, 'far' | 'mid' | 'near'> = {
  sky: 'far', stars: 'far', moon: 'far', sun: 'far', clouds: 'far', mountains: 'far', mist: 'far', city: 'far',
  water: 'mid', ground: 'mid', factory: 'mid', rails: 'mid', train: 'mid', powerGrid: 'mid', port: 'mid',
  dataCenter: 'mid', chip: 'mid', chimney: 'mid', smoke: 'mid', steam: 'mid', wall: 'mid', table: 'mid', interiorWall: 'far',
  figure: 'near', crowd: 'near', tree: 'near', reeds: 'near', boat: 'near', pavilion: 'near', lanterns: 'near',
  candle: 'near', wineJar: 'near', scroll: 'near', sword: 'near', banner: 'near', horse: 'near', window: 'near',
  desk: 'near', stairs: 'near', rain: 'far', embers: 'near', particles: 'near', birds: 'far', spotlight: 'near',
};

const inflight = new Map<string, Promise<Recipe[]>>();

export async function getRecipes(project: Project): Promise<Recipe[]> {
  const running = inflight.get(project.id);
  if (running) return running;
  const p = buildRecipes(project).finally(() => inflight.delete(project.id));
  inflight.set(project.id, p);
  return p;
}

async function buildRecipes(project: Project): Promise<Recipe[]> {
  const file = recipePath(project.id);
  if (fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as { shots: Recipe[] };
      if (cached.shots?.length === project.storyboard?.shots.length) return cached.shots;
    } catch {
      /* regenerate */
    }
  }
  const profile = await getContentProfile(project);
  const segs = project.segments.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
  const user = `内容类型：${profile.contentType}
体裁气质：${profile.genre}
时代：${profile.era}
画面语言：${profile.visualLanguage}
色板：${profile.palette.join(', ')}；点缀：${profile.accents.join(', ')}
必须避免：${(profile.avoid ?? []).join('、')}

为下面 ${project.segments.length} 段文字各设计一镜，输出配方：
${segs}`;
  const raw = await chat(PROMPT, user, 6000);
  const json = JSON.parse(raw.replace(/^```json\s*|```$/g, '').trim()) as { shots: Recipe[] };
  const shots = (json.shots ?? []).slice(0, project.segments.length);
  if (!shots.length) throw new Error('配方为空');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ shots }, null, 2));
  return shots;
}

const LIGHT_STYLE: Record<string, string> = {
  warm: 'warm', cold: 'night', moon: 'night', fire: 'ember', window: 'warm', none: 'dusk',
};

/** 配方 → ShotArt → SVG */
export function recipeToSvg(project: Project, shotIndex: number, recipe: Recipe): string {
  const shot = project.storyboard?.shots[shotIndex];
  const layers: ShotArt['layers'] = [
    { depth: 'far', elements: [] },
    { depth: 'mid', elements: [] },
    { depth: 'near', elements: [] },
  ];
  for (const item of recipe.e ?? []) {
    const [kind, x, y, scale, color] = item as [string, number, number, number, string];
    if (!KINDS.includes(kind)) continue;
    const depth = DEPTH[kind] ?? 'mid';
    layers.find((l) => l.depth === depth)?.elements.push({
      kind,
      x: Number(x) || 0.5,
      y: Number(y) || 0.5,
      scale: Number(scale) || 1,
      color: typeof color === 'string' && color.startsWith('#') ? color : undefined,
    });
  }
  const styleKey = LIGHT_STYLE[recipe.l ?? 'cold'] ?? 'night';
  const art: ShotArt = {
    line: project.segments[shotIndex]?.text ?? '',
    style: styleKey,
    composition: {
      framing: (recipe.f as 'wide' | 'medium' | 'close') ?? 'wide',
      horizon: recipe.h ?? 0.58,
    },
    layers,
    typography: {
      chapter: `CH.${String(shotIndex + 1).padStart(2, '0')} · ${(shot?.title ?? '').slice(0, 8)}`,
    },
  };
  // 色板覆盖：用配方主色微调风格
  if (recipe.p?.[0]) art.style = styleKey;
  return buildShotSvg(art, { id: `shot_${shotIndex + 1}` });
}

/** 生成某镜画面（本地渲染，秒级） */
export async function generateRecipeImage(project: Project, shotIndex: number, outPath: string): Promise<void> {
  const recipes = await getRecipes(project);
  const recipe = recipes[shotIndex] ?? { i: shotIndex, e: [['sky', 0.5, 0.5, 1], ['ground', 0.5, 0.86, 1]] };
  const svg = recipeToSvg(project, shotIndex, recipe);
  await renderSvgToPng(svg, outPath, 1080, 1920);
}
