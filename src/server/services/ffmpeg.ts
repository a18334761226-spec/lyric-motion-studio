import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, TMP_DIR, detectFfmpeg, runCommand } from '../config';
import type { RenderConfig, ShotMotion, SubtitleStyle } from '../../shared/types';
import { assTime, escapeAss, escapeFilterPath } from './text';

export interface FfmpegRunResult {
  code: number;
  log: string;
  elapsedMs: number;
}

export async function runFFmpeg(args: string[], label = 'ffmpeg'): Promise<FfmpegRunResult> {
  const ff = await detectFfmpeg();
  if (!ff.ok) throw new Error('未找到可用的 ffmpeg，请在设置页指定 ffmpeg 路径');
  const started = Date.now();
  const res = await runCommand(ff.bin, ['-hide_banner', ...args], { logPath: path.join(DATA_DIR, 'logs', `${label}-${Date.now()}.log`) });
  return { code: res.code, log: res.log, elapsedMs: Date.now() - started };
}

export async function probeDuration(file: string): Promise<number> {
  const ff = await detectFfmpeg();
  if (!ff.ok) return 0;
  const outFile = path.join(TMP_DIR, `probe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.txt`);
  try {
    const res = await runCommand(ff.probe || ff.bin, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      file,
    ], { logPath: outFile });
    if (res.code !== 0) return 0;
    const text = fs.readFileSync(outFile, 'utf8');
    const match = text.match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : 0;
  } finally {
    try {
      fs.unlinkSync(outFile);
    } catch {
      /* ignore */
    }
  }
}

export async function makeSilenceMp3(outPath: string, durationSec: number): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const res = await runFFmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=24000:cl=mono',
    '-t',
    Math.max(0.05, durationSec).toFixed(3),
    '-q:a',
    '9',
    '-acodec',
    'libmp3lame',
    outPath,
  ]);
  if (res.code !== 0) throw new Error(`生成静音失败：${res.log.slice(-300)}`);
}

export interface AudioPart {
  file: string;
  /** 该段之后插入的静音（秒） */
  gapAfter?: number;
}

/**
 * 用 concat demuxer 把逐句配音拼成一条完整旁白音轨。
 * 统一重采样，避免不同片段的编码参数差异导致拼接异常。
 */
export async function concatVoiceParts(parts: AudioPart[], outPath: string, gapSec = 0.14): Promise<{ duration: number }> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const listDir = path.join(TMP_DIR, `concat-${Date.now()}`);
  fs.mkdirSync(listDir, { recursive: true });
  const silencePath = path.join(listDir, 'silence.mp3');
  if (gapSec > 0.01) await makeSilenceMp3(silencePath, gapSec);
  const lines: string[] = [];
  for (const part of parts) {
    lines.push(`file '${part.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
    const gap = part.gapAfter ?? gapSec;
    if (gap > 0.01) lines.push(`file '${silencePath.replace(/\\/g, '/')}'`);
  }
  const listFile = path.join(listDir, 'list.txt');
  fs.writeFileSync(listFile, lines.join('\n'), 'utf8');
  const res = await runFFmpeg(
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFile,
      '-ar',
      '24000',
      '-ac',
      '1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '96k',
      outPath,
    ],
    'concat-voice',
  );
  if (res.code !== 0) throw new Error(`旁白拼接失败：${res.log.slice(-500)}`);
  const duration = await probeDuration(outPath);
  return { duration };
}

/* ------------------------------------------------------------------ */
/* 字幕（ASS）                                                         */
/* ------------------------------------------------------------------ */

export interface SubtitleItem {
  text: string;
  start: number;
  end: number;
  /** title 使用居中的标题样式 */
  kind?: 'subtitle' | 'title' | 'chapter';
}

/** 按画幅和字号把中文台词折成多行（返回行数组，交给 ASS 用 \\N 拼接） */
function wrapCjkLines(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, '').replace(/^[-—·]+/, '').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const parts = clean.split(/(?<=[，。！？；、,.!?;：:])/).filter(Boolean);
  const lines: string[] = [];
  let buf = '';
  for (const part of parts) {
    if (buf.length + part.length <= maxChars) {
      buf += part;
      continue;
    }
    if (buf) lines.push(buf);
    if (part.length <= maxChars) {
      buf = part;
    } else {
      for (let i = 0; i < part.length; i += maxChars) lines.push(part.slice(i, i + maxChars));
      buf = '';
    }
  }
  if (buf) lines.push(buf);
  return lines;
}

export function buildAss(options: {
  items: SubtitleItem[];
  style: SubtitleStyle;
  width: number;
  height: number;
  title?: string;
  subtitle?: string;
  /** 歌词主视觉模式：更大的字、更强的描边与阴影 */
  emphasis?: boolean;
}): string {
  const { items, style, width, height, title, subtitle, emphasis } = options;
  const fontScale = width / 1080;
  const mainSize = Math.round(style.fontSize * fontScale);
  const titleSize = Math.round(mainSize * (emphasis ? 1.35 : 1.65));
  const subSize = Math.round(mainSize * 0.72);
  const marginV = Math.round(height * style.marginV);
  const bold = style.bold ? -1 : 0;
  const primary = toAssColor(style.color);
  const outline = toAssColor(style.outlineColor);
  const spacing = Number((style.letterSpacing * fontScale).toFixed(1));
  const usableWidth = width * 0.84;
  const perChar = Math.max(1, mainSize * 1.04 + spacing);
  const maxChars = Math.max(10, Math.floor(usableWidth / perChar));
  const outlineW = Number((style.outlineWidth + (emphasis ? 0.8 : 0)).toFixed(1));
  const shadowW = emphasis ? 3.2 : 1.2;

  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Main,${style.fontFamily},${mainSize},${primary},&H000000FF,${outline},&H50000000,${bold},0,0,0,100,100,${spacing},0,3,${Math.max(6, outlineW + 4)},0,2,${Math.round(width * 0.08)},${Math.round(width * 0.08)},${marginV},1`,
    `Style: Title,${style.fontFamily},${titleSize},${primary},&H000000FF,${outline},&H78000000,-1,0,0,0,100,100,${spacing + 2},0,1,${style.outlineWidth + 1},2,5,60,60,60,1`,
    `Style: Sub,${style.fontFamily},${subSize},${primary},&H000000FF,${outline},&H78000000,0,0,0,0,100,100,${spacing + 4},0,1,${Math.max(1, style.outlineWidth - 0.6)},1,5,60,60,60,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  if (title) {
    lines.push(
      `Dialogue: 0,${assTime(0)},${assTime(2.6)},Title,,0,0,0,,{\\fad(260,420)}${escapeAss(title)}`,
    );
  }
  if (subtitle) {
    lines.push(
      `Dialogue: 0,${assTime(0.4)},${assTime(2.6)},Sub,,0,0,0,,{\\fad(300,420)}${escapeAss(subtitle)}`,
    );
  }
  let lastEnd = 0;
  for (const item of items) {
    if (item.end - item.start < 0.2) continue;
    const effect = style.fade && item.kind !== 'title' ? '{\\fad(160,180)}' : '';
    const styleName = item.kind === 'title' ? 'Title' : 'Main';
    const start = Math.max(item.start, lastEnd + 0.04);
    const end = Math.max(item.end, start + 0.5);
    lastEnd = end;
    // 长台词拆成多条短字幕，按时间轮播（每条最多 2 行）
    const allLines = wrapCjkLines(item.text.replace(/\n/g, ''), maxChars);
    const chunks: string[] = [];
    for (let i = 0; i < allLines.length; i += 2) chunks.push(allLines.slice(i, i + 2).join('\\N'));
    const totalChars = chunks.reduce((n, c) => n + c.replace(/\\N/g, '').length, 0) || 1;
    let cursor = start;
    for (const chunk of chunks) {
      const share = ((chunk.replace(/\\N/g, '').length || 1) / totalChars) * (end - start);
      const chunkEnd = Math.min(end, cursor + Math.max(0.8, share));
      lines.push(
        `Dialogue: 0,${assTime(cursor)},${assTime(chunkEnd)},${styleName},,0,0,0,,${effect}${chunk}`,
      );
      cursor = chunkEnd;
    }
  }
  return lines.join('\n');
}

function toAssColor(hex: string): string {
  const clean = hex.replace('#', '').padEnd(6, '0');
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

/* ------------------------------------------------------------------ */
/* 镜头片段（Ken Burns）                                                */
/* ------------------------------------------------------------------ */

/** 用逐帧像素画构建动态镜头：12fps 逐帧绘制 → 最近邻放大 → 取景框平移 → 目标 fps */
export async function buildPixelShotClip(options: {
  framesDir: string;
  durationSec: number;
  pan: { x: string; y: string };
  width: number;
  height: number;
  fps: number;
  outPath: string;
  focuses?: { x: number; y: number; w: number; h: number; label?: string; start: number; end: number }[];
}): Promise<void> {
  // 整幅放大到 1.15 倍，再轻微裁切做镜头运动（保留完整构图）
  const sourceW = Math.round(options.width * 1.15);
  const sourceH = Math.round(options.height * 1.15);
  const vf = [
    `scale=${sourceW}:${sourceH}:flags=neighbor`,
    `crop=${options.width}:${options.height}:x='${options.pan.x}':y='${options.pan.y}'`,
    `fps=${options.fps}`,
    'format=yuv420p',
  ].join(',');
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-framerate',
    '12',
    '-i',
    path.join(options.framesDir, '%03d.png'),
    '-t',
    options.durationSec.toFixed(3),
    '-vf',
    vf,
    '-r',
    String(options.fps),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '19',
    '-pix_fmt',
    'yuv420p',
    options.outPath,
  ];
  const res = await runFFmpeg(args, 'pixel-clip');
  if (res.code !== 0) throw new Error(`像素镜头生成失败：${res.log.slice(-600)}`);
}

export async function buildShotClip(options: {
  imagePath: string;
  durationSec: number;
  motion: ShotMotion;
  width: number;
  height: number;
  fps: number;
  outPath: string;
  focuses?: { x: number; y: number; w: number; h: number; label?: string; start: number; end: number }[];
}): Promise<void> {
  const { imagePath, durationSec, motion, width, height, fps, outPath, focuses } = options;
  const dur = Math.max(0.4, durationSec);
  const frames = Math.max(2, Math.round(dur * fps));
  const overW = Math.round(width * 1.28);
  const overH = Math.round(height * 1.28);
  const cx = '(iw-iw/zoom)/2';
  const cy = '(ih-ih/zoom)/2';
  let z = '1.08';
  let x = cx;
  let y = cy;
  const span = Math.max(1, frames - 1);
  switch (motion) {
    case 'zoom-in':
      z = `1.04+0.14*on/${span}`;
      break;
    case 'zoom-out':
      z = `1.18-0.14*on/${span}`;
      break;
    case 'pan-left':
      z = '1.16';
      x = `(iw-iw/zoom)*(1-on/${span})`;
      break;
    case 'pan-right':
      z = '1.16';
      x = `(iw-iw/zoom)*(on/${span})`;
      break;
    case 'drift-up':
      z = '1.12';
      y = `(ih-ih/zoom)*(1-on/${span})`;
      break;
    default:
      z = '1.06';
      break;
  }
  const still = motion === 'static';
  const parts: string[] = still
    ? [`loop=loop=${Math.max(0, frames - 1)}:size=1:start=0`, `scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`]
    : [
        `scale=${overW}:${overH}:force_original_aspect_ratio=increase`,
        `crop=${overW}:${overH}`,
        `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${width}x${height}:fps=${fps}`,
      ];
  parts.push('format=yuv420p');
  const filter = parts.join(',');

  const res = await runFFmpeg(
    [
      '-y',
      '-i',
      imagePath,
      '-frames:v',
      String(frames),
      '-vf',
      filter,
      '-r',
      String(fps),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      outPath,
    ],
    'clip',
  );
  if (res.code !== 0) throw new Error(`镜头片段渲染失败：${res.log.slice(-500)}`);
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) throw new Error('镜头片段渲染失败：输出为空');
}

/* ------------------------------------------------------------------ */
/* 最终合成                                                            */
/* ------------------------------------------------------------------ */

export interface RenderAudioOptions {
  /** 旁白音轨；关闭人声朗读时为空，只混 BGM */
  voicePath?: string;
  bgmPath?: string;
  bgmVolume?: number;
  ambiencePath?: string;
  ambienceVolume?: number;
}

export interface RenderClip {
  file: string;
  /** 该镜头在音轨上的实际时长 */
  audioDuration: number;
  /** 片段文件时长（含转场重叠补偿） */
  clipDuration: number;
}

export interface RenderVideoOptions {
  clips: RenderClip[];
  audio: RenderAudioOptions;
  assPath: string;
  outPath: string;
  width: number;
  height: number;
  fps: number;
  transitionSec: number;
  xfade: boolean;
  totalDuration: number;
}

/**
 * 一次编码完成：交叉淡化拼接 + 字幕烧录 + 音轨混音 + 淡入淡出。
 * 关键：转场重叠的时间由「片段额外加长」补偿，保证画面时间轴与音频/字幕严格对齐。
 */
export async function renderVideo(opts: RenderVideoOptions): Promise<{ duration: number; size: number }> {
  const { clips, audio, assPath, outPath, width, height, fps, transitionSec, xfade, totalDuration } = opts;
  if (!clips.length) throw new Error('没有可合成的镜头');

  const inputs: string[] = [];
  for (const clip of clips) inputs.push('-i', clip.file);
  const voiceIndex = audio.voicePath ? clips.length : -1;
  if (audio.voicePath) inputs.push('-i', audio.voicePath);
  let bgmIndex = -1;
  let ambienceIndex = -1;
  if (audio.bgmPath) {
    bgmIndex = clips.length + (audio.voicePath ? 1 : 0);
    inputs.push('-i', audio.bgmPath);
  }
  if (audio.ambiencePath) {
    ambienceIndex = clips.length + (audio.voicePath ? 1 : 0) + (audio.bgmPath ? 1 : 0);
    inputs.push('-i', audio.ambiencePath);
  }
  if (!audio.voicePath && bgmIndex < 0) {
    inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  }

  const filters: string[] = [];
  clips.forEach((_, i) => {
    filters.push(`[${i}:v]setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
  });

  const useXfade = xfade && clips.length > 1;
  let lastVideo = 'v0';
  let audioCursor = clips[0].audioDuration;
  if (useXfade) {
    // 转场时长不能超过任一相邻镜头的一半
    const transition = Math.max(0.15, Math.min(transitionSec, Math.min(...clips.map((c) => c.audioDuration)) * 0.45));
    for (let i = 1; i < clips.length; i++) {
      const offset = Math.max(0.05, audioCursor - transition);
      const outName = i === clips.length - 1 ? 'vx' : `vx${i}`;
      filters.push(
        `[${lastVideo}][v${i}]xfade=transition=fade:duration=${transition.toFixed(3)}:offset=${offset.toFixed(3)}[${outName}]`,
      );
      lastVideo = outName;
      audioCursor += clips[i].audioDuration;
    }
  } else if (clips.length > 1) {
    filters.push(`${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[vx]`);
    lastVideo = 'vx';
  } else {
    filters.push(`[v0]null[vx]`);
    lastVideo = 'vx';
  }

  const fadeOutStart = Math.max(0, totalDuration - 0.9);
  filters.push(
    `[${lastVideo}]subtitles=filename='${escapeFilterPath(assPath)}':fontsdir='C\\:/Windows/Fonts',` +
      `fade=t=in:st=0:d=0.7,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.9,format=yuv420p[vout]`,
  );

  // 音频链路：有人声时人声优先并做侧链闪避；关闭人声时只混 BGM
  const voiceChain =
    'highpass=f=85,acompressor=threshold=0.05:ratio=3:attack=5:release=120,volume=1.9,aresample=48000';
  let audioOut: string;
  if (voiceIndex >= 0 && bgmIndex >= 0) {
    filters.push(`[${voiceIndex}:a]${voiceChain},asplit=2[voiceMain][voiceKey]`);
    filters.push(`[${bgmIndex}:a]volume=${(audio.bgmVolume ?? 0.16).toFixed(3)},aresample=48000[bgm]`);
    filters.push(`[bgm][voiceKey]sidechaincompress=threshold=0.02:ratio=8:attack=10:release=350:makeup=1[bgmDuck]`);
    filters.push(`[voiceMain][bgmDuck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amix1]`);
    audioOut = 'amix1';
  } else if (voiceIndex >= 0) {
    filters.push(`[${voiceIndex}:a]${voiceChain}[voiceMain]`);
    audioOut = 'voiceMain';
  } else if (bgmIndex >= 0) {
    filters.push(`[${bgmIndex}:a]volume=${(audio.bgmVolume ?? 0.4).toFixed(3)},aresample=48000[bgmOnly]`);
    audioOut = 'bgmOnly';
  } else {
    const silenceIndex = clips.length;
    filters.push(`[${silenceIndex}:a]aresample=48000[silence]`);
    audioOut = 'silence';
  }
  if (ambienceIndex >= 0) {
    filters.push(`[${ambienceIndex}:a]volume=${(audio.ambienceVolume ?? 0.12).toFixed(3)},aresample=48000[amb]`);
    filters.push(`[${audioOut}][amb]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amix2]`);
    audioOut = 'amix2';
  }
  filters.push(
    `[${audioOut}]alimiter=limit=0.95,afade=t=out:st=${Math.max(0, totalDuration - 1.4).toFixed(3)}:d=1.4,apad=whole_dur=${totalDuration.toFixed(3)},loudnorm=I=-15:TP=-1.5:LRA=11[aout]`,
  );

  const args = [
    '-y',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '19',
    '-profile:v',
    'high',
    '-level',
    '4.2',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-t',
    totalDuration.toFixed(3),
    '-movflags',
    '+faststart',
    outPath,
  ];
  const res = await runFFmpeg(args, 'render');
  if (res.code !== 0) throw new Error(`成片合成失败：${res.log.slice(-800)}`);
  const stats = fs.statSync(outPath);
  const duration = await probeDuration(outPath);
  return { duration, size: stats.size };
}

/** Windows 路径转 filter_complex 可用格式（盘符冒号需转义） */
export { escapeFilterPath };
