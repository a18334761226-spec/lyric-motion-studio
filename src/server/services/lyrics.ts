import type { LyricSource, Song, SongSearchResult } from '../../shared/types';
import { getSettings } from './settings';
import { getSong, insertSong, searchSongsLocal, songCount } from '../db';
import { cleanLineText, newId, parseLrc } from './text';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function neteaseFetch(url: string, timeoutMs = 15000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': UA,
        referer: 'https://music.163.com/',
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

interface NeteaseSong {
  id: number;
  name: string;
  artists?: { name: string }[];
  album?: { name?: string };
  duration?: number;
}

/** 在线：网易云公开检索接口（非官方，若失效会自动降级为本地曲库） */
async function searchNetease(q: string, limit = 8): Promise<Song[]> {
  const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(q)}&type=1&limit=${limit}&offset=0`;
  const json = (await neteaseFetch(url)) as { result?: { songs?: NeteaseSong[] } };
  const songs = json.result?.songs ?? [];
  return songs.map((s) => {
    const id = `netease-${s.id}`;
    return {
      id,
      title: s.name || '未知歌曲',
      artist: s.artists?.map((a) => a.name).filter(Boolean).join(' / ') || '未知歌手',
      album: s.album?.name,
      language: 'zh',
      tags: ['在线'],
      lrc: '',
      source: 'netease' as const,
      sourceLabel: '网易云音乐（公开接口）',
      durationSec: s.duration ? Math.round(s.duration / 1000) : undefined,
      lineCount: 0,
      excerpt: '点击「加载歌词」获取 LRC 时间轴',
      createdAt: Date.now(),
    };
  });
}

async function fetchNeteaseLyric(neteaseId: string): Promise<{ lrc: string; translated?: string } | null> {
  const id = neteaseId.replace(/^netease-/, '');
  const url = `https://music.163.com/api/song/lyric?os=pc&id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`;
  const json = (await neteaseFetch(url)) as {
    lrc?: { lyric?: string };
    tlyric?: { lyric?: string };
    nolyric?: boolean;
    uncollected?: boolean;
  };
  if (json.nolyric || json.uncollected) return null;
  const lrc = json.lrc?.lyric?.trim();
  if (!lrc) return null;
  return { lrc, translated: json.tlyric?.lyric };
}

export function songToLyricSource(song: Song): LyricSource {
  return {
    type: 'library',
    songId: song.id,
    title: song.title,
    artist: song.artist,
    raw: song.lrc,
    language: song.language,
    sourceLabel: song.sourceLabel,
  };
}

/** 统一检索入口：本地曲库 + 在线（可选） */
export async function searchLyrics(query: string, online?: boolean): Promise<SongSearchResult> {
  const settings = getSettings();
  const useOnline = online ?? settings.onlineLyricsEnabled;
  const local = searchSongsLocal(query, 30);
  const notices: string[] = [];
  let onlineSongs: Song[] = [];
  let source = `本地曲库（${songCount()} 首原创示例）`;

  if (useOnline && query.trim()) {
    try {
      onlineSongs = await searchNetease(query.trim(), 8);
      if (onlineSongs.length) {
        source = '本地曲库 + 网易云音乐';
        // 在线结果缓存到本地曲库（不含歌词，加载时补全）
        for (const s of onlineSongs) {
          try {
            insertSong(s);
          } catch {
            /* 忽略重复写入 */
          }
        }
      } else {
        notices.push('网易云未返回结果，可尝试更换关键词或检查代理设置');
      }
    } catch (err) {
      notices.push(`在线歌词检索失败：${(err as Error).message.slice(0, 100)}`);
    }
  }

  const merged: Song[] = [];
  const seen = new Set<string>();
  for (const s of [...local, ...onlineSongs]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    merged.push(s);
  }

  return { songs: merged.slice(0, 40), source, notice: notices.length ? notices.join('；') : undefined };
}

/** 加载（或补全）某首歌的 LRC；在线歌曲会实时抓取并入库 */
export async function loadSong(songId: string): Promise<{ song?: Song; error?: string }> {
  const existing = getSong(songId);
  if (existing && existing.lrc && existing.lrc.trim()) {
    return { song: withDerivedFields(existing) };
  }
  if (!songId.startsWith('netease-')) {
    return { song: existing ? withDerivedFields(existing) : undefined, error: existing ? '该歌曲没有歌词文本' : '歌曲不存在' };
  }
  try {
    const lyric = await fetchNeteaseLyric(songId);
    if (!lyric) {
      return { song: existing, error: '这首歌暂无公开歌词（可能是纯音乐或未收录）' };
    }
    const base: Song =
      existing ??
      ({
        id: songId,
        title: '未知歌曲',
        artist: '未知歌手',
        language: 'zh',
        tags: ['在线'],
        lrc: '',
        source: 'netease',
        sourceLabel: '网易云音乐（公开接口）',
        lineCount: 0,
        createdAt: Date.now(),
      } as Song);
    const updated: Song = withDerivedFields({ ...base, lrc: lyric.lrc, sourceLabel: base.sourceLabel || '网易云音乐（公开接口）' });
    insertSong(updated);
    return { song: updated };
  } catch (err) {
    return { song: existing, error: `歌词抓取失败：${(err as Error).message.slice(0, 120)}` };
  }
}

function withDerivedFields(song: Song): Song {
  const { lines } = parseLrc(song.lrc);
  if (!lines.length) return song;
  const last = lines[lines.length - 1];
  return {
    ...song,
    lineCount: lines.length,
    durationSec:
      last.start !== undefined ? Math.round(last.start + Math.max(8, (last.text.length / 4.2) * 1.2)) : song.durationSec,
    excerpt: lines.slice(0, 2).map((l) => l.text).join(' / '),
  };
}

/** 导入粘贴/上传的歌词，解析并入库 */
export function importLyrics(input: {
  raw: string;
  title?: string;
  artist?: string;
  language?: string;
}): { song?: Song; error?: string } {
  const raw = input.raw.trim();
  if (!raw) return { error: '歌词内容为空' };
  const { lines, meta } = parseLrc(raw);
  const hasTimestamps = lines.length > 0;
  const plainLines = raw
    .split(/\r?\n/)
    .map((l) => cleanLineText(l))
    .filter((l) => l && !/^\[(ti|ar|al|by|offset):/i.test(l));
  const title = input.title?.trim() || meta.ti || plainLines[0]?.slice(0, 30) || '未命名歌词';
  const artist = input.artist?.trim() || meta.ar || '未知歌手';
  const lrc = hasTimestamps
    ? raw
    : plainLines.map((text, i) => `[00:${String(Math.floor((i * 4) / 60)).padStart(2, '0')}:${String((i * 4) % 60).padStart(2, '0')}.00]${text}`).join('\n');
  const song: Song = withDerivedFields({
    id: `import-${newId()}`,
    title,
    artist,
    album: meta.al,
    language: input.language || (containsChinese(title) ? 'zh' : 'en'),
    tags: ['导入'],
    lrc,
    source: 'imported',
    sourceLabel: hasTimestamps ? '粘贴 LRC' : '粘贴文本（已按 4 秒/行估算时间轴）',
    lineCount: 0,
    createdAt: Date.now(),
  });
  insertSong(song);
  return { song };
}

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text);
}
