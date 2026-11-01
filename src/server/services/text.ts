import { nanoid } from 'nanoid';
import type { LyricLine, ScriptSegment, SourceType } from '../../shared/types';

export function newId(prefix = ''): string {
  return prefix ? `${prefix}_${nanoid(10)}` : nanoid(10);
}

/** 稳定的短哈希，用于 Mock 生成的确定性随机 */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/* ------------------------------------------------------------------ */
/* LRC 解析                                                            */
/* ------------------------------------------------------------------ */

const LRC_LINE = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*(.*)$/;
const META_TAG = /^\[(ti|ar|al|by|offset|length|re|ve):(.*)\]$/i;

export function parseLrc(raw: string): { lines: LyricLine[]; offsetMs: number; meta: Record<string, string> } {
  const meta: Record<string, string> = {};
  let offsetMs = 0;
  const collected: { start: number; text: string }[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const metaMatch = line.match(META_TAG);
    if (metaMatch) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      if (metaMatch[1].toLowerCase() === 'offset') offsetMs = Number(metaMatch[2].trim()) || 0;
      continue;
    }
    // 一行可能有多个时间戳 [00:12.00][00:45.00]歌词
    let rest = line;
    const stamps: number[] = [];
    let m: RegExpMatchArray | null;
    while ((m = rest.match(LRC_LINE))) {
      const ms = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
      stamps.push(Number(m[1]) * 60 + Number(m[2]) + ms);
      rest = m[4] || '';
      if (m[4] === undefined) break;
      rest = rest.trimStart();
      if (!/^\[\d{1,3}:\d{1,2}/.test(rest)) break;
    }
    const text = rest.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim();
    if (!text || !stamps.length) continue;
    for (const s of stamps) collected.push({ start: s, text });
  }

  collected.sort((a, b) => a.start - b.start);
  const lines = collected.map((c, i) => ({
    id: `L${i + 1}`,
    index: i,
    start: Math.max(0, c.start + offsetMs / 1000),
    text: cleanLineText(c.text),
  }));
  return { lines, offsetMs, meta };
}

/** 去掉歌词里的合唱歌手标注、多余空格 */
export function cleanLineText(text: string): string {
  return text
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/（[^）]{0,6}）/g, (s) => (s.length <= 8 ? '' : s))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 纯文本（无时间轴）按行/句切分 */
export function parsePlainText(raw: string): LyricLine[] {
  const parts = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const lines: LyricLine[] = [];
  for (const p of parts) {
    if (/^\[(ti|ar|al|by|offset):/i.test(p)) continue;
    if (p.length > 26) {
      for (const s of splitSentences(p)) {
        lines.push({ id: `L${lines.length + 1}`, index: lines.length, text: s });
      }
    } else {
      lines.push({ id: `L${lines.length + 1}`, index: lines.length, text: p });
    }
  }
  return lines;
}

/** 中英文分句（保留标点） */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return out;
  // 以中文句末标点、英文句末标点、换行、分号切分
  const regex = /[^。！？!?；;\n]+[。！？!?；;]?/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(normalized))) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out.length ? out : [normalized];
}

/** 把长句再切成适合字幕的短句（按逗号 / 空格，超过 maxLen 时） */
export function splitForSubtitle(text: string, maxLen = 18): string[] {
  const clauses = text
    .split(/(?<=[，,、])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buffer = '';
  for (const clause of clauses) {
    if ((buffer + clause).length > maxLen && buffer) {
      out.push(buffer);
      buffer = clause;
    } else {
      buffer += clause;
    }
  }
  if (buffer) out.push(buffer);
  return out.length ? out : [text];
}

/* ------------------------------------------------------------------ */
/* 文本段构建                                                          */
/* ------------------------------------------------------------------ */

export function buildLyricSegments(lines: LyricLine[]): ScriptSegment[] {
  return lines.map((l, i) => ({
    id: `seg_${i + 1}`,
    index: i,
    text: l.text,
    kind: 'lyric' as const,
    startSec: l.start,
  }));
}

export function buildNarrationSegments(text: string): ScriptSegment[] {
  const sentences = splitSentences(text);
  const merged: string[] = [];
  for (const s of sentences) {
    const last = merged[merged.length - 1];
    // 太短的句子合并，避免一行字幕只有一个词
    if (last && (last.length < 12 || s.length < 6) && last.length + s.length < 46) {
      merged[merged.length - 1] = last + s;
    } else {
      merged.push(s);
    }
  }
  return merged.map((t, i) => ({ id: `seg_${i + 1}`, index: i, text: t, kind: 'narration' as const }));
}

export function buildIdeaSegments(text: string): ScriptSegment[] {
  return buildNarrationSegments(text);
}

export function rebuildSegments(sourceType: SourceType, raw: string): ScriptSegment[] {
  if (sourceType === 'lyrics') {
    return buildLyricSegments(parsePlainText(raw));
  }
  return buildNarrationSegments(raw);
}

/* ------------------------------------------------------------------ */
/* 关键词提取（Mock 引擎用）                                            */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set(
  '的 了 我 你 他 她 它 我们 你们 他们 是 在 有 和 与 就 都 也 还 又 很 太 把 被 让 给 对 从 到 向 于 为 以 而 但 或 如果 因为 所以 这个 那个 一个 什么 怎么 为什么 没有 不是 可以 已经 自己 这样 那样 时候 还是 就是 这 那 里 上 下 中 会 要 能 想 说 看 走 来 去 一下 一点 一些 有些 其实 然后 之后 之前 一样 一直 一定 只是 demo studio lyric motion song sample test unknown'.split(
    ' ',
  ),
);

const NOISE_WORDS = new Set(['demo', 'studio', 'lyric', 'motion', 'music', 'song', 'sample', 'test', 'unknown', '作词', '作曲', '编曲', '歌手', '在线']);

export function extractKeywords(text: string, limit = 8): string[] {
  const cleaned = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ').toLowerCase();
  const freq = new Map<string, number>();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (/^[a-z]{3,}$/.test(token)) {
      if (NOISE_WORDS.has(token)) continue;
      freq.set(token, (freq.get(token) || 0) + 1);
      continue;
    }
    const chars = Array.from(token);
    if (chars.length < 2) continue;
    // 中文：2~4 字滑窗
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= chars.length; i++) {
        const gram = chars.slice(i, i + n).join('');
        if (STOPWORDS.has(gram) || NOISE_WORDS.has(gram)) continue;
        freq.set(gram, (freq.get(gram) || 0) + 1);
      }
    }
  }
  // 去重：如果一个长词包含更短的高频词，只保留更长的
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const out: string[] = [];
  for (const [word, count] of sorted) {
    if (count < 2 && out.length >= 4) break;
    if (out.some((w) => w.includes(word) || word.includes(w))) continue;
    out.push(word);
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 文件 / 时间格式                                                      */
/* ------------------------------------------------------------------ */

export function safeFileName(name: string, fallback = 'file'): string {
  const cleaned = name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').slice(0, 60);
  return cleaned || fallback;
}

/** 秒 → ASS 时间 H:MM:SS.cc */
export function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(Math.min(99, cs)).padStart(2, '0')}`;
}

/** 秒 → SRT 时间 00:00:00,000 */
export function srtTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function formatSec(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** 十六进制颜色 → ASS 的 &HAABBGGRR& */
export function hexToAssColor(hex: string, alpha = 0): string {
  const clean = hex.replace('#', '');
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  const a = alpha.toString(16).padStart(2, '0');
  return `&H${a}${b}${g}${r}&`.toUpperCase();
}

/** 反解 ffmpeg 滤镜参数里的特殊字符 */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** ASS 文本转义 */
export function escapeAss(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\r?\n/g, '\\N');
}

/** 智能换行：中文每行最多 maxLen 字，最多两行 */
export function wrapSubtitle(text: string, maxLen = 16): string {
  const clean = text.trim();
  if (clean.length <= maxLen) return clean;
  const lines: string[] = [];
  let remaining = clean;
  while (remaining.length && lines.length < 2) {
    if (remaining.length <= maxLen) {
      lines.push(remaining);
      remaining = '';
      break;
    }
    let cut = maxLen;
    // 尽量在标点处断行
    const window = remaining.slice(0, maxLen + 4);
    const idx = Math.max(
      window.lastIndexOf('，'),
      window.lastIndexOf('。'),
      window.lastIndexOf('、'),
      window.lastIndexOf(' '),
      window.lastIndexOf('；'),
    );
    if (idx >= Math.floor(maxLen * 0.5)) cut = idx + 1;
    lines.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining) lines[lines.length - 1] += remaining;
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 联网抓取文本清洗                                                    */
/* ------------------------------------------------------------------ */

const TRADITIONAL_HINTS =
  /[這個們時東軍劉孫權戰國歷農曆荊會與為於說過還麼樣點發現開關門問間際實學應該對將來後裡邊讓給沒進遠選據無]|[\uFA00-\uFAFF]/g;

/** 繁体字占比（用于在简繁混排时优先保留简体来源） */
export function traditionalRatio(text: string): number {
  if (!text) return 0;
  const matches = text.match(TRADITIONAL_HINTS);
  return matches ? matches.length / text.length : 0;
}

/** 清理维基/网页抓取残留：脚注、空括号、多余空白、转义符 */
export function cleanExtractedText(text: string): string {
  return text
    .replace(/\[\d{1,3}\]/g, '')
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/\\+/g, ' ')
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
    .replace(/([，。！？；：、])\1+/g, '$1')
    .trim();
}

/** 去掉网页标题里的站点后缀，便于来源去重 */
export function normalizeSourceTitle(title: string): string {
  return title
    .replace(/\s*[-|_—]\s*(维基百科|百度百科|知乎|豆瓣|YouTube|Bilibili|哔哩哔哩).*$/i, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}
