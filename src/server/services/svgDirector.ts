import fs from 'node:fs';
import path from 'node:path';
import type { Project, Shot } from '../../shared/types';
import { projectDir } from '../config';
import { getSettings } from './settings';
import { detectFfmpeg, runCommand } from '../config';
import { renderSvgToPng } from './svgRender';
import { logLlmUsage } from './llm';

/**
 * 通用图像层：内容 profile → 逐镜 ArtDirection → DeepSeek 直接绘制 SVG。
 * 不依赖任何歌词场景库；歌词/历史/口播/文章走同一条路径。
 */

export interface ContentProfile {
  contentType: string;
  genre: string;
  era: string;
  visualLanguage: string;
  palette: string[];
  accents: string[];
  typography: string;
  narrationTone: string;
  music: string;
  motif: string;
  avoid: string[];
  drawingNotes: string;
}

const KEY_FALLBACK = '';

function apiKey(): string {
  const s = getSettings();
  return s.deepseekApiKey || process.env.DEEPSEEK_API_KEY || KEY_FALLBACK;
}

function baseUrl(): string {
  const s = getSettings();
  return (s.deepseekBaseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
}

function model(): string {
  const s = getSettings();
  return s.deepseekModel || 'deepseek-flash';
}

let activeProjectId = '';

async function chat(system: string, user: string, maxTokens = 12000): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error('未配置 DeepSeek Key');
  const body = {
    model: model(),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.9,
    max_tokens: Math.max(maxTokens, 6000),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240000);
    try {
      const r = await fetch(`${baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const txt = await r.text();
      if (!r.ok) console.warn('[svgDirector] API', r.status, txt.slice(0, 180));
      if (r.ok) {
        const j = JSON.parse(txt);
        if (j.choices?.[0]?.finish_reason === 'length') throw new Error('output truncated');
        logLlmUsage('逐镜画面 SVG', activeProjectId, {
          promptTokens: j.usage?.prompt_tokens,
          completionTokens: j.usage?.completion_tokens,
        });
        return j.choices[0].message.content as string;
      }
    } catch {
      // 超时或网络错误：进入下一次尝试
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('DeepSeek 调用失败');
}

function profilePath(projectId: string): string {
  return path.join(projectDir(projectId), 'artprofile.json');
}

const PROFILE_PROMPT = `你是顶级影视美术总监。读一份视频内容（类型、标题、正文、用户要求），为它建立一套适用于全片的视觉方案。
不要套用任何预设风格模板；所有结论从内容推导，用描述性语言。

输出严格 JSON（不要解释、不要 markdown）：
{
  "contentType": "歌词 / 历史叙事 / 财经口播 / 文章 / 故事 / 广告 / 其他",
  "genre": "体裁与气质（描述性，不要用流派标签当结论）",
  "era": "时代与地域跨度，各段可能涉及的具体年代",
  "visualLanguage": "画面语言：构图倾向、材质、色彩关系、光的逻辑、镜头感",
  "palette": ["#hex ×6，从内容推导的主色"],
  "accents": ["#hex ×2 点缀色"],
  "typography": "标题与字幕的排版气质",
  "narrationTone": "旁白语气",
  "music": "配乐方向",
  "motif": "贯穿母题（具体意象，可重复出现）",
  "avoid": ["必须避免的画面元素"],
  "drawingNotes": "画每一镜时必须遵守的具体要求（时代器物、材质、光线、禁止元素等，120字内）"
}`;

export async function getContentProfile(project: Project): Promise<ContentProfile> {
  const file = profilePath(project.id);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as ContentProfile;
    } catch {
      /* re-derive */
    }
  }
  const req = project.requirements;
  const user = `内容类型：${project.source.type}
标题：${project.source.title}
作者/来源：${project.source.author || ''}
用户要求：${req.brief || ''}；风格关键词：${req.styleKeywords || ''}；避免：${(req.avoid || []).join('、') || '无'}；目标时长：${req.targetDurationSec || '未定'} 秒
正文：
${(project.source.raw || '').slice(0, 6000)}`;
  const raw = await chat(PROFILE_PROMPT, user, 4000);
  const json = raw.replace(/^```json\s*|```$/g, '').trim();
  const profile = JSON.parse(json) as ContentProfile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(profile, null, 2));
  return profile;
}

const DRAW_RULES = `【技术规格（硬性）】
- 只输出一段 <decision>…</decision> 和一段 <svg>…</svg>，不要 markdown、不要解释、不要任何文字元素。
- 根节点：<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
- 只允许原生 SVG：linearGradient、radialGradient、stop、path、circle、ellipse、rect、line、polygon、g、filter（feGaussianBlur/feTurbulence/feColorMatrix/feComponentTransfer）、mask、clipPath、use。
- 禁止：<script>、<foreignObject>、外部图片/字体、<text>。
- 底部 220px 是字幕区，不放主体与关键细节。
- 必须合法 XML、可被浏览器直接渲染。`;

function sanitizeSvg(raw: string): string | undefined {
  const m = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) return undefined;
  let svg = m[0]
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/viewBox=/.test(svg)) svg = svg.replace('<svg', '<svg viewBox="0 0 1080 1920"');
  if (!/<\/svg>\s*$/.test(svg)) svg = svg.trimEnd() + '</svg>';
  return svg;
}

/** 每镜：按内容 profile + 本段文本，让 DeepSeek 画一镜 SVG */
export async function drawShotSvg(project: Project, shot: Shot, text: string): Promise<{
  svg: string;
  focuses?: Shot['focuses'];
}> {
  activeProjectId = project.id;
  const profile = await getContentProfile(project);
  const shots = project.storyboard?.shots ?? [];
  const prev = shots[shot.index - 1]?.subtitle ?? '';
  const next = shots[shot.index + 1]?.subtitle ?? '';

  const system = `你是顶级影像导演 + SVG 创作者。为竖屏视频的一镜画面做决定并画出来。

【唯一硬要求：必须和这句台词对得上】
- 读懂这句在讲什么、提到哪些具体概念；画面里的每个主要元素都必须能对应到台词里的某个词或概念，不允许无关装饰。
- 表现方式由你决定：插画、信息图、时间线、对比表、示意图、文字卡、数据卡——选最能让人一眼看懂这句的形式。
- 允许在画面里写文字（标题、年份、术语、要点），但文字必须清楚、对齐、无重叠、无裁切；左右安全边距 100px；顶部 140px、底部 260px 也不放关键文字或关键图形（抖音播放页左右有头像/点赞按钮、上下有标题操作栏），底部 260px 必须完全留空（不写字、不放图形、只保留背景），字幕会叠在这里。
- 风格由你决定（写实/扁平/水墨/版画/极简/信息图/胶片…）；全片不必统一成一种风格，但色温与信息密度不要跳得太离谱。
- 台词里的数字、年份、名称、事实必须准确出现或对应；不要编造台词之外的信息。

【技术规格】
- 只输出 <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">…</svg>，不要任何其他文字。
- 只允许原生 SVG：rect/circle/ellipse/path/line/polygon/g/text/tspan/defs/linearGradient/radialGradient/pattern/filter/mask/clipPath/use。
- 禁止 script、foreignObject、外部图片或字体。
- 中文字体 font-family="Microsoft YaHei, sans-serif"（或 KaiTi, STKaiti, serif）。
- 合法 XML、标签闭合；背景铺满 1080×1920，不要黑边；信息量与细节要足，不要大面积空白。

画面里要用金色箭头、序号、箭头连线或高亮底纹，**直接画在对应元素上**，清楚指示讲解顺序（例如 ①②③ 指向 繁荣→衰退→萧条→回升）。箭头与高亮必须紧贴对应元素，不要飘在空中。

在 SVG 之后，另起一行输出 <focuses>[{"x":0.1,"y":0.35,"w":0.3,"h":0.18,"label":"繁荣期","start":0.2,"end":1.2}]</focuses>：x/y/w/h 为归一化画面坐标，start/end 为镜头内秒数（0 到镜头时长）。2–4 个焦点，按讲解顺序排列。`;

  const user = `【本镜台词】${text}
【上一镜】${prev || '（开场）'}
【下一镜】${next || '（结尾）'}
【内容类型】${profile.contentType}；${profile.genre}
【本片背景】${profile.visualLanguage}
【可用参考色板】${profile.palette.join(', ')}（可用可不用，形式与风格由你定）

先想清楚：这句在讲什么、画面里每个元素分别对应台词里的什么概念；然后直接输出完整 SVG。`;

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await chat(system, attempt === 0 ? user : `${user}\n\n上一次输出无法渲染：${lastError}。请输出合法 XML、所有标签闭合。`, 6000);
    const svg = sanitizeSvg(content);
    if (!svg) {
      lastError = '没有找到 <svg> 标签';
      continue;
    }
    try {
      const probe = path.join(projectDir(project.id), 'images', '._probe.png');
      await renderSvgToPng(svg, probe, 540, 960);
      fs.rmSync(probe, { force: true });
      const fm = content.match(/<focuses>([\s\S]*?)<\/focuses>/i);
      let focuses: Shot['focuses'];
      if (fm) {
        try { focuses = JSON.parse(fm[1].trim()); } catch { /* ignore */ }
      }
      return { svg, focuses };
    } catch (err) {
      lastError = String(err).slice(0, 120);
    }
  }
  throw new Error(`本镜 SVG 生成失败：${lastError}`);
}

/** 封面：按内容自动生成信息图风格海报（1080×1920） */
export async function drawCoverPng(project: Project, outPath: string): Promise<void> {
  activeProjectId = project.id;
  const profile = await getContentProfile(project);
  const title = (project.source.title || project.source.topic || '视频').slice(0, 14);
  const topic = (project.source.topic || '').slice(0, 20);
  const system = `你是顶级财经信息图设计师。画一张 1080×1920 竖屏视频封面海报，只输出 <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">…</svg>，不要其他文字。
允许原生 SVG：rect/circle/line/path/polygon/text/tspan/g/linearGradient/radialGradient/filter/mask。
文字 font-family="Microsoft YaHei, sans-serif"；中文必须正确；所有文字在 x=100..980 内（左右各 100px 安全区），顶部 140px、底部 260px 不放关键内容，不裁切、不重叠。
风格：深色底、金色标题、信息图、金色细边框；配色参考：${profile.palette.join(', ')}。
内容：顶部小字说明栏目；超大两行主标题「${title}」；副标题一句话概括；中部主视觉（与主题对应的图表/波形/流程，例如多列并排、四阶段色带、箭头与序号）；下部一行大字对比或结论；底部引语条；右下角落款。
不要密集小字，要海报感：大留白、强对比、层次清楚。`;
  const user = `主题：${topic}
内容类型：${profile.contentType}；${profile.genre}
用一句话副标题概括这个主题，并画出主视觉。直接输出 SVG。`;
  const svgRaw = await chat(system, user, 8000);
  const svg = sanitizeSvg(svgRaw);
  if (!svg) throw new Error('封面 SVG 生成失败');
  await renderSvgToPng(svg, outPath, 1080, 1920);
}

/** 兜底画面：纯色渐变 + 母题几何，不使用歌词场景库 */
export async function drawFallbackPng(project: Project, shot: Shot, outPath: string): Promise<void> {
  const profile = await getContentProfile(project).catch(() => undefined);
  const pal = profile?.palette ?? ['#1a2230', '#2c3a48', '#b09a6a'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal[0]}"/><stop offset="0.6" stop-color="${pal[1]}"/><stop offset="1" stop-color="${pal[2] ?? pal[1]}"/></linearGradient>
  <radialGradient id="l"><stop offset="0" stop-color="#f2e2c0" stop-opacity="0.5"/><stop offset="1" stop-color="#f2e2c0" stop-opacity="0"/></radialGradient>
  <filter id="b"><feGaussianBlur stdDeviation="26"/></filter></defs>
  <rect width="1080" height="1920" fill="url(#g)"/>
  <circle cx="760" cy="380" r="220" fill="url(#l)"/>
  <path d="M0 1500 Q 300 1420 560 1480 T 1080 1460 V1920 H0 Z" fill="#0a0e14" opacity="0.9"/>
  <rect x="0" y="0" width="1080" height="1920" fill="#000" opacity="0.12"/>
  </svg>`;
  await renderSvgToPng(svg, outPath, 1080, 1920);
  void shot;
  void runCommand;
  void detectFfmpeg;
}
