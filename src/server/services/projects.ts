import type {
  CreateProjectBody,
  DashboardStats,
  LyricSection,
  Project,
  ProjectStatus,
  ProjectSummary,
  Requirements,
  ScriptSegment,
  Song,
  SourceDoc,
  StageKey,
  StageState,
} from '../../shared/types';
import { STAGE_META, STAGE_ORDER } from '../../shared/types';
import {
  DEFAULT_MUSIC_CONFIG,
  DEFAULT_RENDER,
  DEFAULT_REQUIREMENTS,
  DEFAULT_STYLE_PRESET_ID,
  DEFAULT_VOICE_CONFIG,
  DEFAULT_VOICE_ID,
  STYLE_PRESETS,
  VOICE_OPTIONS,
} from '../../shared/presets';
import { addActivity, getProject, listActivity, listProjects, saveProject, songCount } from '../db';
import { buildLyricSegments, buildNarrationSegments, newId, parseLrc, parsePlainText } from './text';
import { getSettings, imageProvider, llmProvider } from './settings';
import { getSong } from '../db';
import { loadSong } from './lyrics';

export function stagesForSource(sourceType: SourceDoc['type']): StageState[] {
  return STAGE_ORDER.map((key) => ({
    key,
    status: key === 'research' && sourceType !== 'history' ? 'skipped' : 'pending',
    progress: key === 'research' && sourceType !== 'history' ? 100 : 0,
  }));
}

export function stylePresetOf(id: string) {
  return STYLE_PRESETS.find((s) => s.id === id) ?? STYLE_PRESETS[0];
}

export function normalizeRequirements(input: Partial<Requirements> | undefined, sourceType: SourceDoc['type']): Requirements {
  const base: Requirements = {
    ...DEFAULT_REQUIREMENTS,
    ...(input ?? {}),
    mustInclude: Array.isArray(input?.mustInclude) ? input!.mustInclude.filter(Boolean).slice(0, 12) : [],
    avoid: Array.isArray(input?.avoid) ? input!.avoid.filter(Boolean).slice(0, 12) : [],
    targetDurationSec: Math.max(0, Math.min(600, Number(input?.targetDurationSec) || 0)),
    sceneDensity: input?.sceneDensity ?? 'auto',
    language: input?.language ?? 'zh',
    bgmMode: input?.bgmMode ?? 'ai',
  };
  if (sourceType === 'lyrics') {
    base.language = 'zh';
    if (!base.narrationTone) base.narrationTone = '温柔、克制，像在耳边说话';
  }
  if (sourceType === 'history' && !base.narrationTone) {
    base.narrationTone = '沉稳的纪录片旁白，克制而有画面感';
  }
  if (sourceType === 'idea' && !base.narrationTone) {
    base.narrationTone = '自然的第一人称口吻，带一点呼吸感';
  }
  return base;
}

export interface CreateProjectResult {
  project?: Project;
  error?: string;
}

export async function createProject(body: CreateProjectBody): Promise<CreateProjectResult> {
  const settings = getSettings();
  const sourceType = body.sourceType;
  if (!['lyrics', 'history', 'idea'].includes(sourceType)) return { error: '不支持的素材类型' };

  let song: Song | undefined;
  let source: SourceDoc;
  let segments: ScriptSegment[] = [];
  let section: LyricSection = { startLine: 0, endLine: 0 };

  if (sourceType === 'lyrics') {
    if (body.songId) {
      const loaded = await loadSong(body.songId);
      if (!loaded.song) return { error: loaded.error || '歌词加载失败' };
      song = loaded.song;
    }
    if (song) {
      source = {
        type: 'lyrics',
        title: song.title,
        author: song.artist,
        raw: song.lrc,
        language: song.language,
        songId: song.id,
        sourceLabel: song.sourceLabel,
      };
    } else if (body.lyricsRaw?.trim()) {
      source = {
        type: 'lyrics',
        title: body.title?.trim() || body.lyricsTitle?.trim() || '未命名歌词',
        author: body.lyricsArtist?.trim() || '未知歌手',
        raw: body.lyricsRaw.trim(),
        language: 'zh',
        sourceLabel: '粘贴歌词',
      };
    } else {
      return { error: '请选择曲库中的歌词，或粘贴歌词文本' };
    }
    const parsed = parseLrc(source.raw);
    let lines = parsed.lines.length
      ? parsed.lines
      : parsePlainText(source.raw).map((l, i) => ({ ...l, index: i, start: i * 4 }));
    // 过滤 LRC 头部的歌名/歌手/制作信息行
    const metaNoise = new Set(
      [source.title, source.author, song?.artist, song?.title]
        .filter(Boolean)
        .map((s) => String(s).trim().toLowerCase()),
    );
    const filtered = lines.filter((line) => {
      const text = line.text.trim();
      if (!text) return false;
      if (metaNoise.has(text.toLowerCase())) return false;
      if (/^(作词|作曲|编曲|制作|混音|录音|出品|演唱|原唱|studio demo)[:：\s]/i.test(text)) return false;
      return true;
    });
    if (filtered.length >= 2) lines = filtered;
    if (!lines.length) return { error: '歌词解析失败，内容为空' };
    const start = Math.max(0, Math.min(lines.length - 1, body.section?.startLine ?? 0));
    const end = Math.max(start, Math.min(lines.length - 1, body.section?.endLine ?? lines.length - 1));
    section = { startLine: start, endLine: end, label: body.section?.label };
    segments = buildLyricSegments(lines.slice(start, end + 1)).map((s, i) => ({ ...s, index: i }));
    // 保留 LRC 时间戳，后续字幕/画面严格按原曲时间轴同步
    source.raw = lines
      .map((line, i) => {
        const start = typeof line.start === 'number' ? line.start : i * 4;
        const mm = String(Math.floor(start / 60)).padStart(2, '0');
        const ss = (start % 60).toFixed(2).padStart(5, '0');
        return `[${mm}:${ss}]${line.text}`;
      })
      .join('\n');
  } else if (sourceType === 'history') {
    const topic = (body.topic || body.title || '').trim();
    if (!topic) return { error: '请输入历史主题' };
    source = {
      type: 'history',
      title: body.title?.trim() || topic,
      author: body.era?.trim() || '历史资料',
      raw: body.raw?.trim() || topic,
      language: 'zh',
      topic,
      era: body.era?.trim(),
      research: body.research,
      sourceLabel: body.research ? '联网检索 + AI 提炼' : undefined,
    };
  } else {
    const idea = (body.raw || body.requirements?.brief || '').trim();
    if (!idea) return { error: '请写下你的创意需求' };
    source = {
      type: 'idea',
      title: body.title?.trim() || idea.slice(0, 18),
      author: '创意想法',
      raw: idea,
      language: body.requirements?.language ?? 'zh',
      sourceLabel: 'AI 原创脚本',
    };
  }

  const requirements = normalizeRequirements(body.requirements, sourceType);
  const stylePresetId =
    body.stylePresetId ||
    (sourceType === 'lyrics' ? 'flat-illustration' : settings.defaultStylePresetId) ||
    DEFAULT_STYLE_PRESET_ID;
  const preset = stylePresetOf(stylePresetId);
  const voiceId = body.voiceId || settings.defaultVoiceId || DEFAULT_VOICE_ID;
  const voiceExists = VOICE_OPTIONS.some((v) => v.id === voiceId);
  const now = Date.now();
  const project: Project = {
    id: newId('proj'),
    title:
      body.title?.trim() ||
      (sourceType === 'lyrics' ? source.title : sourceType === 'history' ? source.topic || source.title : source.title),
    requirements: {
      ...requirements,
      bgmMode: requirements.bgmMode,
      bgmPrompt: requirements.bgmPrompt || (sourceType === 'history' ? '沉稳、克制的历史纪录片配乐，低音鼓与弦乐铺底' : ''),
    },
    status: 'draft',
    stage: sourceType === 'history' ? 'research' : 'analysis',
    stages: stagesForSource(sourceType),
    source,
    segments,
    stylePresetId,
    voice: { ...DEFAULT_VOICE_CONFIG, voiceId: voiceExists ? voiceId : DEFAULT_VOICE_ID, singMode: sourceType === 'lyrics' ? 'melodic' : 'speak' },
    render: {
      ...DEFAULT_RENDER,
      aspect: body.aspect || settings.defaultAspect || '9:16',
      resolution: body.resolution || settings.defaultResolution || '1080p',
      subtitle: { ...preset.subtitle, fontSize: 44, marginV: 0.055, outlineWidth: 1.5, letterSpacing: 2 },
    },
    music: {
      ...DEFAULT_MUSIC_CONFIG,
      mode: requirements.bgmMode,
      prompt: requirements.bgmPrompt,
    },
    assets: {},
    createdAt: now,
    updatedAt: now,
  };
  // 歌词项目：source 阶段已经由段落解析完成
  if (sourceType === 'lyrics') {
    project.stages = project.stages.map((s) => (s.key === 'source' ? { ...s, status: 'done', progress: 100 } : s));
    project.stage = 'analysis';
  }
  saveProject(project);
  addActivity(project.id, 'info', `创建项目「${project.title}」`);
  return { project };
}

export function patchProject(id: string, patch: (project: Project) => Project | void): Project | undefined {
  const current = getProject(id);
  if (!current) return undefined;
  const next = patch(current) || current;
  next.updatedAt = Date.now();
  saveProject(next);
  return next;
}

export function recomputeStatus(project: Project): ProjectStatus {
  if (project.status === 'running') return 'running';
  if (project.assets.videoUrl) return 'ready';
  if (project.stages.some((s) => s.status === 'failed')) return 'error';
  return 'draft';
}

export function currentStage(project: Project): StageKey {
  const running = project.stages.find((s) => s.status === 'running');
  if (running) return running.key;
  const pending = project.stages.find((s) => s.status === 'pending');
  if (pending) return pending.key;
  return 'render';
}

export function toSummary(project: Project): ProjectSummary {
  const stage = currentStage(project);
  const stageState = project.stages.find((s) => s.key === stage);
  return {
    id: project.id,
    title: project.title,
    brief:
      project.requirements.brief ||
      project.analysis?.theme ||
      (project.source.type === 'history' ? project.source.topic || '' : project.source.title) ||
      '',
    sourceType: project.source.type,
    status: project.status,
    stage,
    stageProgress: stageState?.progress ?? 0,
    stylePresetId: project.stylePresetId,
    aspect: project.render.aspect,
    coverUrl: project.assets.coverUrl,
    videoUrl: project.assets.videoUrl,
    segmentCount: project.segments.length,
    shotCount: project.storyboard?.shots.length ?? 0,
    duration: project.assets.videoDuration,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function projectStats(): DashboardStats {
  const projects = listProjects(200);
  const ready = projects.filter((p) => p.status === 'ready');
  const running = projects.filter((p) => p.status === 'running');
  return {
    projectCount: projects.length,
    readyCount: ready.length,
    runningCount: running.length,
    totalVideoSec: Math.round(ready.reduce((sum, p) => sum + (p.assets.videoDuration ?? 0), 0)),
    songCount: songCount(),
    voiceCount: VOICE_OPTIONS.length,
    llmProvider: llmProvider(),
    imageProvider: imageProvider(),
    researchProvider: 'Wikipedia + DuckDuckGo + Bing',
    ffmpegReady: false,
    recentProjects: projects.slice(0, 6).map(toSummary),
    activity: listActivity(12),
  };
}

/** 给 UI 用的阶段中文标签 */
export function stageLabel(key: StageKey): string {
  return STAGE_META[key]?.label ?? key;
}

export function getSongSafe(id: string): Song | undefined {
  return getSong(id);
}

export function segmentTextOf(project: Project): string {
  return project.segments.map((s) => s.text).join('\n');
}

export function ensureSegmentsFromSource(source: SourceDoc): ScriptSegment[] {
  if (source.type === 'lyrics') return [];
  return buildNarrationSegments(source.raw);
}
