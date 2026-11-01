import fs from 'node:fs';
import path from 'node:path';
import type {
  ContentAnalysis,
  MusicSpec,
  Project,
  PromptOptimizeResult,
  ResearchBundle,
  Shot,
  StageKey,
  StageState,
  Storyboard,
} from '../../shared/types';
import { STAGE_META, STAGE_ORDER } from '../../shared/types';
import { addActivity, getProject, saveProject } from '../db';
import { projectDir, projectSubDir } from '../config';
import { pipelineBus } from './events';
import { CancelledError, composeProject } from './composer';
import { getSettings } from './settings';
import { llmJson, llmText } from './llm';
import {
  analysisMessages,
  musicMessages,
  optimizePromptMessages,
  promptStageMessages,
  storyboardMessages,
} from './prompts';
import { mockAnalysis, mockMusicSpec, mockOptimizedPrompt, mockStoryboard } from './mock';
import { buildShotVisual } from './visualLexicon';
import { resolveResearch } from './research-runner';
import { createTtsSession, melodyPlanFor } from './tts';
import { generateShotImage } from './images';
import { concatVoiceParts } from './ffmpeg';
import { synthesizeAmbience, synthesizeMusic, writeWav } from './music';
import { stylePresetOf, toSummary } from './projects';
import { buildLyricSegments, buildNarrationSegments, clamp, hashString, parseLrc, parsePlainText } from './text';

interface RunState {
  cancelled: boolean;
}

const running = new Map<string, RunState>();

export function isPipelineRunning(projectId: string): boolean {
  return running.has(projectId);
}

export function cancelPipeline(projectId: string): boolean {
  const state = running.get(projectId);
  if (!state) return false;
  state.cancelled = true;
  return true;
}

function emit(project: Project, type: 'stage' | 'progress' | 'log' | 'done' | 'error' | 'cancelled' | 'shot' | 'snapshot', extra: {
  stage?: StageKey;
  progress?: number;
  message?: string;
  level?: 'info' | 'success' | 'warn' | 'error';
  shotId?: string;
  includeProject?: boolean;
} = {}) {
  pipelineBus.publish({
    type,
    projectId: project.id,
    at: Date.now(),
    stage: extra.stage,
    progress: extra.progress,
    message: extra.message,
    level: extra.level,
    shotId: extra.shotId,
    project: extra.includeProject ? project : undefined,
  });
}

function saveAndEmit(project: Project, type: 'stage' | 'snapshot' = 'stage') {
  project.updatedAt = Date.now();
  saveProject(project);
  emit(project, type, { includeProject: true });
}

function resetStages(project: Project, from: StageKey, force: boolean): number {
  const startIndex = STAGE_ORDER.indexOf(from);
  project.stages = project.stages.map((stage, idx) => {
    const isSkipped = stage.key === 'research' && project.source.type !== 'history';
    if (idx < startIndex) return stage;
    if (isSkipped) return { ...stage, status: 'skipped', progress: 100 };
    if (!force && idx === startIndex && stage.status === 'done') return stage;
    return { key: stage.key, status: 'pending', progress: 0 };
  });
  return startIndex;
}

function firstPendingStage(project: Project): StageKey {
  const pending = project.stages.find((s) => s.status !== 'done' && s.status !== 'skipped');
  return pending?.key ?? 'render';
}

async function updateStage(
  project: Project,
  key: StageKey,
  patch: Partial<StageState>,
): Promise<void> {
  const stage = project.stages.find((s) => s.key === key);
  if (!stage) return;
  Object.assign(stage, patch);
  project.stage = key;
  project.updatedAt = Date.now();
  saveProject(project);
}

function stageProgress(project: Project, key: StageKey, pct: number, message?: string) {
  const stage = project.stages.find((s) => s.key === key);
  if (stage) {
    stage.progress = clamp(Math.round(pct), 0, 100);
    stage.message = message;
  }
  project.stage = key;
  saveProject(project);
  emit(project, 'progress', { stage: key, progress: stage?.progress, message });
}

export interface RunOptions {
  from?: StageKey;
  force?: boolean;
  until?: StageKey;
}

/**
 * 异步启动流水线。立即返回，进度通过 SSE 推送。
 */
export function startPipeline(projectId: string, opts: RunOptions = {}): { ok: boolean; error?: string } {
  const project = getProject(projectId);
  if (!project) return { ok: false, error: '项目不存在' };
  if (running.has(projectId)) return { ok: false, error: '该项目正在生成中' };
  running.set(projectId, { cancelled: false });
  void runPipeline(projectId, opts).finally(() => running.delete(projectId));
  return { ok: true };
}

export async function runPipeline(projectId: string, opts: RunOptions): Promise<void> {  const state = running.get(projectId)!;
  let project = getProject(projectId);
  if (!project) {
    running.delete(projectId);
    return;
  }
  const from = opts.from ?? firstPendingStage(project);
  const startIndex = resetStages(project, from, Boolean(opts.force));
  project.status = 'running';
  project.error = undefined;
  saveProject(project);
  emit(project, 'snapshot', { includeProject: true });
  addActivity(project.id, 'info', `开始生成「${project.title}」· 从${STAGE_META[from]?.label ?? from}开始`);

  const isCancelled = () => {
    const current = running.get(projectId);
    return !current || current.cancelled;
  };
  const assertAlive = () => {
    if (!state || state.cancelled) throw new CancelledError();
  };

  const preset = stylePresetOf(project.stylePresetId);

  try {
    for (let index = startIndex; index < STAGE_ORDER.length; index++) {
      const key = STAGE_ORDER[index];
      const stage = project.stages.find((s) => s.key === key)!;
      if (stage.status === 'skipped') continue;
      if (stage.status === 'done' && !opts.force) continue;
      assertAlive();

      await updateStage(project, key, {
        status: 'running',
        progress: 0,
        startedAt: Date.now(),
        finishedAt: undefined,
        error: undefined,
        message: undefined,
      });
      emit(project, 'stage', { stage: key, progress: 0, message: `${STAGE_META[key].label}开始` });

      try {
        // 强制重跑研究阶段时，丢弃旧资料，重新联网检索
        if (key === 'research' && opts.force) {
          project.source.research = undefined;
          saveProject(project);
        }
        switch (key) {
          case 'source':
            await runSourceStage(project);
            break;
          case 'research':
            await runResearchStage(project);
            break;
          case 'analysis':
            await runAnalysisStage(project, preset);
            break;
          case 'storyboard':
            await runStoryboardStage(project, preset);
            break;
          case 'prompts':
            await runPromptsStage(project, preset);
            break;
          case 'images':
            await runImagesStage(project, preset, isCancelled);
            break;
          case 'voice':
            await runVoiceStage(project, isCancelled);
            break;
          case 'music':
            await runMusicStage(project, isCancelled);
            break;
          case 'render':
            await runRenderStage(project, isCancelled);
            break;
        }
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        const message = (err as Error).message || String(err);
        await updateStage(project, key, {
          status: 'failed',
          progress: Math.min(99, stage.progress),
          error: message,
          finishedAt: Date.now(),
          durationMs: Date.now() - (stage.startedAt ?? Date.now()),
        });
        project.status = 'error';
        project.error = message;
        saveProject(project);
        emit(project, 'error', { stage: key, message, includeProject: true });
        addActivity(project.id, 'error', `「${project.title}」${STAGE_META[key].label}失败：${message.slice(0, 120)}`);
        return;
      }

      await updateStage(project, key, {
        status: 'done',
        progress: 100,
        finishedAt: Date.now(),
        durationMs: Date.now() - (stage.startedAt ?? Date.now()),
        message: `${STAGE_META[key].label}完成`,
      });
      emit(project, 'stage', { stage: key, progress: 100, message: `${STAGE_META[key].label}完成`, includeProject: true });

      if (opts.until === key) {
        project = getProject(projectId) ?? project;
        project.status = 'draft';
        project.stage = key;
        saveProject(project);
        emit(project, 'done', { message: `已停在「${STAGE_META[key].label}」阶段`, includeProject: true });
        addActivity(project.id, 'info', `「${project.title}」已停在${STAGE_META[key].label}，可先审阅`);
        return;
      }

      // 每个阶段后重新读取，保持内存对象与落盘一致（其他接口可能修改）
      const fresh = getProject(projectId);
      if (fresh) project = fresh;
      project.status = 'running';
      saveProject(project);
    }

    project = getProject(projectId) ?? project;
    project.status = project.assets.videoUrl ? 'ready' : 'draft';
    project.error = undefined;
    project.stage = 'render';
    saveProject(project);
    emit(project, 'done', { message: '生成完成', includeProject: true });
    addActivity(project.id, 'success', `「${project.title}」生成完成`);
  } catch (err) {
    if (err instanceof CancelledError) {
      const fresh = getProject(projectId) ?? project;
      const activeStage = fresh.stages.find((s) => s.status === 'running');
      if (activeStage) {
        activeStage.status = 'pending';
        activeStage.progress = 0;
        activeStage.message = '已取消';
      }
      fresh.status = fresh.assets.videoUrl ? 'ready' : 'draft';
      saveProject(fresh);
      emit(fresh, 'cancelled', { message: '已取消生成' });
      addActivity(fresh.id, 'warn', `已取消「${fresh.title}」的生成`);
      return;
    }
    const message = (err as Error).message || String(err);
    const fresh = getProject(projectId) ?? project;
    fresh.status = 'error';
    fresh.error = message;
    saveProject(fresh);
    emit(fresh, 'error', { message, includeProject: true });
  }
}

/* ------------------------------------------------------------------ */
/* 各阶段实现                                                          */
/* ------------------------------------------------------------------ */

async function runSourceStage(project: Project): Promise<void> {
  if (project.source.type === 'lyrics') {
    const parsed = parseLrc(project.source.raw);
    const lines = parsed.lines.length ? parsed.lines : parsePlainText(project.source.raw);
    if (!lines.length) throw new Error('歌词内容为空，无法解析');
    project.segments = buildLyricSegments(lines);
    addActivity(project.id, 'info', `解析歌词 ${lines.length} 句`);
  }
  // history / idea 的文本段由「内容理解」阶段撰写旁白时生成
  await new Promise((r) => setTimeout(r, 120));
}

async function runResearchStage(project: Project): Promise<void> {
  if (!project.source.topic) throw new Error('缺少研究主题');
  if (project.source.research && project.source.research.sources.length > 0) {
    stageProgress(project, 'research', 100, '使用已有检索结果');
    return;
  }
  stageProgress(project, 'research', 10, '生成检索词并联网检索…');
  const bundle: ResearchBundle = await resolveResearch(project, undefined, (pct, msg) =>
    stageProgress(project, 'research', pct, msg),
  );
  project.source.research = bundle;
  if (bundle.sources.length) {
    project.source.sourceLabel = `${bundle.provider} · ${bundle.sources.length} 条资料`;
    addActivity(project.id, 'info', `检索到 ${bundle.sources.length} 条资料：${bundle.query}`);
  } else {
    addActivity(project.id, 'warn', `未检索到有效资料，将依据主题生成：${bundle.query}`);
  }
  saveProject(project);
}

/** 按目标时长扩写/精简文稿（迭代到 ±15% 以内，保留事实、观点顺序与开场白） */
async function fitScriptToTarget(project: Project, text: string, targetSec: number): Promise<string> {
  const desired = Math.round(targetSec * 5.8);
  let current = text.replace(/\s+/g, '').trim();
  if (!desired || !current) return current;
  for (let attempt = 0; attempt < 3; attempt++) {
    const diff = (current.length - desired) / desired;
    if (Math.abs(diff) <= 0.15) return current;
    const action = diff < 0 ? '扩写' : '精简';
    const need = Math.abs(desired - current.length);
    const result = await llmText({
      system: `你是财经短视频口播稿编辑。现在有一篇 ${current.length} 字的口播稿，需要${action}到 ${desired} 字左右（误差不超过 10%）。
必须遵守：
- 保留全部事实、数字、观点及其顺序，不要编造新的具体数字；
- 保留第一段的开场白（以“今天我们来聊”开头）；
- 纯口播文本：不要分点、标题、emoji、括号说明；
- 短句、有节奏、可直接朗读；
- 这次至少要${action === '扩写' ? '增加' : '压缩'}${need} 字，输出必须接近 ${desired} 字。
只输出正文。`,
      user: current,
      fallback: () => current,
      maxTokens: 5000,
      label: `文稿${action}（第${attempt + 1}轮）`,
      projectId: project.id,
    });
    const next = result.data.replace(/\s+/g, '').trim();
    if (!next || next === current) break;
    current = next;
  }
  // 最后一刀：超长时在句号处裁到目标附近，保证时长贴近
  if (current.length > desired * 1.08) {
    const cut = current.slice(0, Math.round(desired * 1.02));
    const lastPunc = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
    current = lastPunc > 40 ? cut.slice(0, lastPunc + 1) : cut;
  }
  return current;
}

/** 旁白开场白：原文没有问候/主题引入时，自动补一句，避免上来就讲 */
function ensureOpening(raw: string, project: Project): string {
  const topic = (project.source.topic || project.source.title || '').trim();
  const clean = raw.trim();
  if (/^(今天|大家好|这期|我们|这集|本期|这一期)/.test(clean)) return clean;
  const shortTopic = topic.replace(/[。！？；，,].*$/, '').replace(/[的了呢吧啊]$/, '').slice(0, 12);
  const label = shortTopic ? `「${shortTopic}」` : '这个话题';
  return `今天我们来聊${label}。${clean}`;
}

/** 把旁白原文按句子切成约 targetChars 字的段，保持原顺序与原文 */
function splitNarration(text: string, targetChars = 60): string[] {
  const parts = text
    .split(/(?<=[。！？；!?;])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const p of parts) {
    if (buf.length + p.length > targetChars && buf.length >= 20) {
      out.push(buf);
      buf = p;
    } else {
      buf += p;
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [text];
}

async function runAnalysisStage(project: Project, preset: ReturnType<typeof stylePresetOf>): Promise<void> {
  stageProgress(project, 'analysis', 10, 'DeepSeek 正在理解内容…');
  const messages = analysisMessages(project, preset);
  const fallback = () => mockAnalysis(project, preset);
  const result = await llmJson<ContentAnalysis>({
    ...messages,
    fallback,
    validate: (value) => normalizeAnalysis(value, fallback()),
    temperature: 0.6,
    maxTokens: 3200,
    label: '内容理解',
    projectId: project.id,
  });
  const analysis = result.data;
  analysis.provider = result.provider === 'deepseek' ? 'deepseek' : 'mock';
  analysis.model = result.model;
  project.analysis = analysis;

  if (project.source.type !== 'lyrics') {
    // 口播稿/旁白稿：原文足够长时保留原文，不交给模型重写（避免压缩/改写）
    const raw = (project.source.raw || '').replace(/\s+/g, ' ').trim();
    const preserve =
      raw.length >= 120 || /口播|旁白|保留原文|原文|解说/.test(project.requirements.brief ?? '');
    if (preserve) {
      const withIntro = ensureOpening(raw, project);
      project.segments = splitNarration(withIntro, 60).map((text, i) => ({ id: `seg_${i + 1}`, index: i, text, kind: 'narration' as const }));
      (analysis as unknown as { preserveScript?: boolean }).preserveScript = true;
      addActivity(project.id, 'info', `保留原文旁白，切成 ${project.segments.length} 段（含开场白）`);
    } else {
      const script = (analysis.script ?? []).filter((s) => typeof s === 'string' && s.trim().length > 0);
      const base = (script.length >= 2 ? script.join('') : (fallback().script ?? []).join('')).trim();
      const withIntro = ensureOpening(base, project);
      project.segments = splitNarration(withIntro, 60).map((text, i) => ({ id: `seg_${i + 1}`, index: i, text, kind: 'narration' as const }));
      (analysis as unknown as { preserveScript?: boolean }).preserveScript = true;
      addActivity(project.id, 'info', `AI 撰写旁白（含开场白），切成 ${project.segments.length} 段`);
    }
  }
  // 目标时长 → 扩写/精简文稿（不靠拖慢或加快语速）
  const targetSec = project.requirements.targetDurationSec || 0;
  if (project.source.type !== 'lyrics' && targetSec > 0 && project.segments.length) {
    const joined = project.segments.map((seg) => seg.text).join('');
    const fitted = await fitScriptToTarget(project, joined, targetSec);
    if (fitted !== joined) {
      project.segments = splitNarration(fitted, 60).map((text, i) => ({ id: `seg_${i + 1}`, index: i, text, kind: 'narration' as const }));
      (analysis as unknown as { preserveScript?: boolean }).preserveScript = true;
      addActivity(project.id, 'info', `按目标 ${targetSec} 秒调整文稿：${joined.length} → ${fitted.length} 字（语速不变）`);
    }
  }

  stageProgress(project, 'analysis', 70, '整理分镜结构…');
  if (result.warning) {
    stageProgress(project, 'analysis', 80, `DeepSeek 不可用，已使用本地引擎（${result.warning.slice(0, 60)}）`);
  }
  project.updatedAt = Date.now();
  saveProject(project);
}

async function runStoryboardStage(project: Project, preset: ReturnType<typeof stylePresetOf>): Promise<void> {
  stageProgress(project, 'storyboard', 10, '规划镜头序列…');
  // 口播稿保留原文时：一段一镜，静态画面，时长按字速估算（1.3 倍语速约 5.8 字/秒）
  const preserve =
    project.source.type !== 'lyrics' &&
    Boolean((project.analysis as unknown as { preserveScript?: boolean } | undefined)?.preserveScript) &&
    project.segments.length > 0;
  if (preserve) {
    const base = mockStoryboard(project, preset);
    base.shots = project.segments.map((segment, i) => ({
      ...(base.shots[i] ?? base.shots[0]),
      id: `shot_${i + 1}`,
      index: i,
      title: `${i + 1}. ${segment.text.slice(0, 12)}`,
      subtitle: segment.text,
      segStart: i,
      segEnd: i,
      motion: 'static' as const,
      duration: Math.max(4, Math.min(16, segment.text.length / 5.8)),
      imageStatus: 'pending' as const,
    }));
    base.provider = 'mock';
    base.model = 'narration-preserve';
    base.updatedAt = Date.now();
    project.storyboard = base;
    saveProject(project);
    return;
  }
  const messages = storyboardMessages(project, preset);
  const fallback = () => mockStoryboard(project, preset);
  const result = await llmJson<Storyboard>({
    ...messages,
    fallback,
    validate: (value) => normalizeStoryboard(value, project, preset),
    temperature: 0.75,
    maxTokens: 4000,
    label: '分镜脚本',
    projectId: project.id,
  });
  const board = result.data;
  board.provider = result.provider === 'deepseek' ? 'deepseek' : 'mock';
  board.model = result.model;
  board.updatedAt = Date.now();
  board.shots = normalizeShotCoverage(board.shots, project.segments.length, preset);
  // 分镜忠实度：每个镜头的画面必须由它对应的原句提炼
  const isHistory = project.source.type === 'history';
  const mood = project.analysis?.mood ?? '';

  // 歌词项目：一句一镜，保证每句都有自己的画面
  if (project.source.type === 'lyrics' && project.segments.length > 1 && project.segments.length <= 60) {
    const motions = preset.motion;
    board.shots = project.segments.map((segment, i) => {
      const motion = motions[i % motions.length];
      const plan = buildShotVisual({
        subtitle: segment.text,
        preset,
        shotSize: '中景',
        motion,
        mood,
        index: i,
        isHistory: false,
        avoid: project.requirements.avoid,
      });
      return {
        id: `shot_${i + 1}`,
        index: i,
        title: segment.text.slice(0, 18),
        subtitle: segment.text,
        prompt: plan.prompt,
        negativePrompt: plan.negativePrompt,
        motion,
        shotSize: '中景',
        segStart: i,
        segEnd: i,
        duration: 0,
        palette: plan.palette,
        visualAnchors: plan.anchors,
        imageStatus: 'pending' as const,
      };
    });
  }

  for (const shot of board.shots) {
    const plan = buildShotVisual({
      subtitle: shot.subtitle,
      preset,
      shotSize: shot.shotSize,
      motion: shot.motion,
      mood,
      index: shot.index,
      isHistory,
      avoid: project.requirements.avoid,
    });
    shot.visualAnchors = plan.anchors;
    if (!shot.searchQuery) shot.searchQuery = plan.searchTerms.join(' | ');
    if (board.provider === 'mock') {
      shot.prompt = plan.prompt;
      shot.negativePrompt = plan.negativePrompt;
      shot.palette = plan.palette;
    } else {
      // DeepSeek 返回的分镜也要校验：prompt 里若没有任何原句提炼出的场景，就补上
      const sceneSnippet = plan.prompt.split(', ').slice(0, 5).join(', ');
      const firstSceneWords = (plan.prompt.split(/[,.]/)[0] || '').trim().toLowerCase().slice(0, 24);
      const grounded =
        plan.anchors.some((anchor) => shot.prompt.includes(anchor)) ||
        (firstSceneWords.length > 8 && shot.prompt.toLowerCase().includes(firstSceneWords));
      if (!grounded) shot.prompt = `${shot.prompt.replace(/[。.]$/, '')}, ${sceneSnippet}`;
      if (!shot.palette || shot.palette.length !== 3) shot.palette = plan.palette;
    }
  }
  project.storyboard = board;
  stageProgress(project, 'storyboard', 90, `${board.shots.length} 个镜头已规划`);
  project.updatedAt = Date.now();
  saveProject(project);
}

async function runPromptsStage(project: Project, preset: ReturnType<typeof stylePresetOf>): Promise<void> {
  const board = project.storyboard;
  if (!board) throw new Error('缺少分镜，无法优化提示词');
  stageProgress(project, 'prompts', 10, '扩写生图提示词…');
  const messages = promptStageMessages(project, preset);
  const result = await llmJson<{ shots: { id: string; prompt: string; negativePrompt: string; title?: string; shotSize?: string }[] }>({
    ...messages,
    fallback: () => ({
      shots: board.shots.map((shot) => ({
        id: shot.id,
        prompt: shot.prompt,
        negativePrompt: shot.negativePrompt,
        title: shot.title,
        shotSize: shot.shotSize,
      })),
    }),
    validate: (value) => {
      const v = value as { shots?: unknown };
      if (!Array.isArray(v.shots) || !v.shots.length) return null;
      const shots = v.shots.filter(
        (s): s is { id: string; prompt: string; negativePrompt: string; title?: string; shotSize?: string } =>
          Boolean(s) && typeof (s as { id?: unknown }).id === 'string' && typeof (s as { prompt?: unknown }).prompt === 'string',
      );
      return shots.length ? { shots } : null;
    },
    temperature: 0.8,
    maxTokens: 4000,
    label: '提示词优化',
    projectId: project.id,
  });
  const byId = new Map(result.data.shots.map((s) => [s.id, s]));
  board.shots = board.shots.map((shot) => {
    const optimized = byId.get(shot.id);
    if (!optimized) return shot;
    return {
      ...shot,
      prompt: optimized.prompt || shot.prompt,
      negativePrompt: optimized.negativePrompt || shot.negativePrompt,
      title: optimized.title?.slice(0, 16) || shot.title,
      shotSize: optimized.shotSize || shot.shotSize,
    };
  });
  project.updatedAt = Date.now();
  stageProgress(project, 'prompts', 90, '提示词已优化');
  saveProject(project);
}

async function runImagesStage(
  project: Project,
  preset: ReturnType<typeof stylePresetOf>,
  isCancelled: () => boolean,
): Promise<void> {
  const board = project.storyboard;
  if (!board) throw new Error('缺少分镜，无法生成画面');
  const imagesDir = projectSubDir(project.id, 'images');
  const shots = board.shots;
  let done = 0;
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(3, getSettings().renderConcurrency || 3));
  const workers = Array.from({ length: Math.min(concurrency, shots.length) }, async () => {
    for (;;) {
      if (isCancelled()) throw new CancelledError();
      const i = cursor++;
      if (i >= shots.length) break;
      const shot = shots[i];
      const result = await generateShotImage(shot, project, preset, imagesDir);
      shot.imageUrl = `/media/${project.id}/images/${path.basename(result.path)}?t=${Date.now()}`;
      shot.imageStatus = result.status === 'done' ? 'done' : 'mock';
      shot.error = result.warning;
      done += 1;
      stageProgress(project, 'images', (done / shots.length) * 100, `画面 ${done}/${shots.length}`);
    }
  });
  await Promise.all(workers);
  saveProject(project);
}

async function runVoiceStage(project: Project, isCancelled: () => boolean): Promise<void> {
  const segments = project.segments;
  if (!segments.length) throw new Error('没有可配音的文本段落，请先完成内容理解');

  // 关闭人声朗读：只保留歌曲 BGM + 字幕；有 LRC 时间戳时严格按原曲时间轴
  if (project.voice.enabled === false) {
    const timeline: NonNullable<Project['assets']['timeline']> = [];
    let lrcStarts: number[] = [];
    if (segments.every((segment) => typeof segment.startSec === 'number')) {
      lrcStarts = segments.map((segment) => segment.startSec as number);
    } else {
      // 分析阶段可能重写 segments：从项目原始 LRC 恢复时间轴
      const parsed = parseLrc(project.source.raw).lines;
      if (parsed.length === segments.length) {
        lrcStarts = parsed.map((line) => line.start ?? 0);
      } else if (parsed.length) {
        for (const segment of segments) {
          const hit = parsed.find((line) => line.text.trim() === segment.text.trim());
          lrcStarts.push(hit?.start ?? NaN);
        }
      }
    }
    const hasLrc = lrcStarts.length === segments.length && lrcStarts.every((value) => Number.isFinite(value));
    if (hasLrc) {
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const start = lrcStarts[i];
        const nextStart = lrcStarts[i + 1];
        const estimated = Math.max(1.4, Math.min(8, segment.text.length * 0.2 + 0.4));
        const end = Number.isFinite(nextStart) && nextStart > start ? Math.max(start + 1.2, nextStart - 0.1) : start + estimated;
        timeline.push({ segId: segment.id, segIndex: i, text: segment.text, start, end });
      }
      const lastEnd = timeline[timeline.length - 1]?.end ?? 0;
      project.assets = {
        ...project.assets,
        voiceoverUrl: undefined,
        voiceoverDuration: lastEnd + project.render.outroSec,
        timeline,
      };
      addActivity(project.id, 'info', '人声朗读已关闭；字幕按原曲 LRC 时间轴同步');
      stageProgress(project, 'voice', 100, '已关闭人声（字幕按 LRC 时间轴）');
      saveProject(project);
      return;
    }
    let cursor = 0;
    const gap = 0.12;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const duration = Math.max(1.6, Math.min(7, segment.text.length * 0.22 + 0.5));
      timeline.push({
        segId: segment.id,
        segIndex: i,
        text: segment.text,
        start: cursor,
        end: cursor + duration,
      });
      cursor += duration + (i < segments.length - 1 ? gap : 0);
    }
    project.assets = {
      ...project.assets,
      voiceoverUrl: undefined,
      voiceoverDuration: cursor,
      timeline,
    };
    addActivity(project.id, 'info', '人声朗读已关闭：仅保留歌曲 BGM 与歌词字幕（无 LRC，时间按句长估算）');
    stageProgress(project, 'voice', 100, '已关闭人声朗读（仅字幕 + BGM）');
    saveProject(project);
    return;
  }

  const voiceDir = projectSubDir(project.id, 'voice');
  const gap = Math.max(0, Math.min(1200, project.voice.gapMs)) / 1000;
  const parts: { file: string; gapAfter: number }[] = [];
  const timeline: NonNullable<Project['assets']['timeline']> = [];
  let cursor = 0;
  const warnings: string[] = [];

  const session = await createTtsSession(project.voice);
  let melodicCount = 0;
  try {
    for (let i = 0; i < segments.length; i++) {
      if (isCancelled()) throw new CancelledError();
      const segment = segments[i];
      const fileName = `seg_${String(i + 1).padStart(3, '0')}.mp3`;
      const outPath = path.join(voiceDir, fileName);
      const pitchPlan = session.melodic ? melodyPlanFor(project.analysis?.mood ?? '', i) : undefined;
      const { duration, warning, melodic } = await session.synthesize(segment.text, outPath, { pitchPlan });
      if (melodic) melodicCount += 1;
      if (warning) warnings.push(warning);
      const start = cursor;
      const end = start + duration;
      timeline.push({
        segId: segment.id,
        segIndex: i,
        text: segment.text,
        start,
        end,
        audioUrl: `/media/${project.id}/voice/${fileName}`,
      });
      parts.push({ file: outPath, gapAfter: i < segments.length - 1 ? gap : 0 });
      cursor = end + (i < segments.length - 1 ? gap : 0);
      stageProgress(project, 'voice', ((i + 1) / segments.length) * 90, `配音 ${i + 1}/${segments.length}`);
    }
  } finally {
    session.close();
  }

  stageProgress(project, 'voice', 94, '拼接旁白音轨…');
  const voiceoverPath = path.join(voiceDir, 'voiceover.mp3');
  const { duration: voiceDuration } = await concatVoiceParts(parts, voiceoverPath, gap);
  project.assets = {
    ...project.assets,
    voiceoverUrl: `/media/${project.id}/voice/voiceover.mp3?t=${Date.now()}`,
    voiceoverDuration: voiceDuration,
    timeline,
  };
  if (warnings.length) {
    addActivity(project.id, 'warn', `${warnings.length} 句配音降级为静音占位：${warnings[0]}`);
  }
  if (project.voice.singMode === 'melodic') {
    addActivity(project.id, 'info', `半唱模式：${melodicCount}/${segments.length} 句已按旋律变调`);
  }
  saveProject(project);
}

async function runMusicStage(project: Project, isCancelled: () => boolean): Promise<void> {
  const musicDir = projectSubDir(project.id, 'music');
  const voiceDuration = project.assets.voiceoverDuration ?? 0;
  const targetDuration = Math.max(8, voiceDuration + project.render.outroSec + 1.2);

  if (project.music.mode === 'none') {
    project.assets.music = { generatedAt: Date.now() };
    stageProgress(project, 'music', 100, '已关闭背景音乐');
    saveProject(project);
    return;
  }

  if (project.music.mode === 'upload') {
    const uploadPath = project.music.uploadPath;
    if (!uploadPath || !fs.existsSync(path.join(projectDir(project.id), uploadPath))) {
      project.music.mode = 'ai';
      addActivity(project.id, 'warn', '未找到上传的 BGM，已自动改为 AI 生成');
    } else {
      project.assets.music = {
        bgmUrl: `/media/${project.id}/${uploadPath}`,
        bgmDuration: voiceDuration,
        generatedAt: Date.now(),
      };
      stageProgress(project, 'music', 100, '使用上传的 BGM');
      saveProject(project);
      return;
    }
  }

  stageProgress(project, 'music', 10, 'AI 设计配乐规格…');
  const messages = musicMessages(project);
  const fallback = () => mockMusicSpec(project);
  const result = await llmJson<MusicSpec>({
    ...messages,
    fallback,
    validate: (value) => normalizeMusicSpec(value, fallback()),
    temperature: 0.7,
    maxTokens: 1200,
    label: '配乐设计',
    projectId: project.id,
  });
  if (isCancelled()) throw new CancelledError();
  const spec = result.data;
  spec.provider = result.provider === 'deepseek' ? 'deepseek' : 'mock';
  spec.model = result.model;
  spec.durationSec = Math.round(targetDuration);
  stageProgress(project, 'music', 40, `合成配乐（${spec.tempoBpm} BPM · ${spec.mood}）…`);
  const synth = synthesizeMusic(spec, targetDuration, hashString(project.id + spec.title));
  const bgmPath = path.join(musicDir, 'bgm.wav');
  writeWav(bgmPath, synth);
  project.assets.music = {
    spec,
    bgmUrl: `/media/${project.id}/music/bgm.wav?t=${Date.now()}`,
    bgmDuration: synth.duration,
    generatedAt: Date.now(),
  };
  if (isCancelled()) throw new CancelledError();

  if (project.music.ambience !== 'none') {
    stageProgress(project, 'music', 80, `生成环境音（${project.music.ambience}）…`);
    const ambience = synthesizeAmbience(project.music.ambience, targetDuration);
    const ambiencePath = path.join(musicDir, 'ambience.wav');
    writeWav(ambiencePath, ambience);
    project.assets.music.ambienceUrl = `/media/${project.id}/music/ambience.wav?t=${Date.now()}`;
  }
  stageProgress(project, 'music', 100, '声音设计完成');
  saveProject(project);
}

async function runRenderStage(project: Project, isCancelled: () => boolean): Promise<void> {
  const updated = await composeProject(project, {
    onProgress: (pct, message, shotId) => {
      stageProgress(project, 'render', pct, message);
      if (shotId) emit(project, 'shot', { shotId, stage: 'render', message });
    },
    isCancelled,
  });
  Object.assign(project, updated);
  project.status = 'ready';
  project.stage = 'render';
  saveProject(project);
}

/* ------------------------------------------------------------------ */
/* JSON 归一化                                                         */
/* ------------------------------------------------------------------ */

function strArray(value: unknown, fallback: string[], limit = 12): string[] {
  if (!Array.isArray(value)) return fallback;
  const arr = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
  return arr.length ? arr.slice(0, limit) : fallback;
}

function normalizeAnalysis(value: unknown, fallback: ContentAnalysis): ContentAnalysis | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ContentAnalysis>;
  const sections = Array.isArray(v.sections)
    ? v.sections
        .filter((s) => s && typeof s.label === 'string' && Number.isFinite(Number(s.segStart)))
        .map((s) => ({
          label: String(s.label).slice(0, 20),
          segStart: Math.max(1, Math.round(Number(s.segStart))),
          segEnd: Math.max(1, Math.round(Number(s.segEnd))),
          mood: String(s.mood ?? ''),
        }))
    : [];
  const timeline = Array.isArray(v.timeline)
    ? v.timeline
        .filter((t) => t && typeof t.year === 'string' && typeof t.event === 'string')
        .map((t) => ({ year: t.year, event: t.event, sourceIds: t.sourceIds ?? [] }))
    : fallback.timeline;
  const facts = Array.isArray(v.keyFacts)
    ? v.keyFacts
        .filter((f) => f && typeof f.claim === 'string')
        .map((f) => ({ claim: f.claim, detail: f.detail, sourceIds: f.sourceIds ?? [] }))
    : fallback.keyFacts;
  const script = Array.isArray(v.script)
    ? v.script.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
    : undefined;
  return {
    theme: typeof v.theme === 'string' && v.theme.trim() ? v.theme.trim().slice(0, 40) : fallback.theme,
    logline: typeof v.logline === 'string' && v.logline.trim() ? v.logline.trim().slice(0, 120) : fallback.logline,
    mood: typeof v.mood === 'string' && v.mood.trim() ? v.mood.trim().slice(0, 30) : fallback.mood,
    emotions: strArray(v.emotions, fallback.emotions, 8),
    keywords: strArray(v.keywords, fallback.keywords, 10),
    imagery: strArray(v.imagery, fallback.imagery, 10),
    colorStory: strArray(v.colorStory, fallback.colorStory, 8),
    sections: sections.length ? sections : fallback.sections,
    timeline,
    keyFacts: facts,
    script,
    directorNotes: strArray(v.directorNotes, fallback.directorNotes, 6),
    provider: 'mock',
    model: 'local-mock',
  };
}

function normalizeStoryboard(value: unknown, project: Project, preset: ReturnType<typeof stylePresetOf>): Storyboard | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<Storyboard>;
  if (!Array.isArray(v.shots) || !v.shots.length) return null;
  const shots: Shot[] = v.shots
    .filter((s): s is Shot => Boolean(s) && typeof (s as Shot).subtitle === 'string' && typeof (s as Shot).prompt === 'string')
    .map((s, i) => ({
      id: typeof s.id === 'string' && s.id ? s.id : `shot_${i + 1}`,
      index: i,
      title: String(s.title ?? `镜头 ${i + 1}`).slice(0, 16),
      subtitle: String(s.subtitle).slice(0, 120),
      prompt: String(s.prompt),
      negativePrompt: String(s.negativePrompt ?? preset.negative.join(', ')),
      motion: (['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'drift-up', 'static'] as const).includes(
        s.motion as Shot['motion'],
      )
        ? (s.motion as Shot['motion'])
        : 'zoom-in',
      shotSize: String(s.shotSize ?? '中景'),
      segStart: Math.max(0, Math.round(Number(s.segStart ?? 1)) - 1),
      segEnd: Math.max(0, Math.round(Number(s.segEnd ?? 1)) - 1),
      duration: 0,
      palette: Array.isArray(s.palette) && s.palette.length === 3 ? (s.palette as [string, string, string]) : preset.palette,
      imageStatus: 'pending' as const,
    }));
  const fallback = mockStoryboard(project, preset);
  return {
    logline: typeof v.logline === 'string' ? v.logline.slice(0, 120) : fallback.logline,
    visualStyle: typeof v.visualStyle === 'string' ? v.visualStyle.slice(0, 160) : fallback.visualStyle,
    shots: shots.length ? shots : fallback.shots,
    provider: 'mock',
    model: 'local-mock',
    updatedAt: Date.now(),
  };
}

/** 保证镜头覆盖全部文本段、且首尾连续 */
export function normalizeShotCoverage(shots: Shot[], segmentCount: number, preset: ReturnType<typeof stylePresetOf>): Shot[] {
  if (!shots.length || segmentCount <= 0) return shots;
  const sorted = [...shots].sort((a, b) => a.segStart - b.segStart);
  const used = new Set<number>();
  let cursor = 0;
  for (const shot of sorted) {
    let start = Math.max(cursor, Math.min(segmentCount - 1, Math.round(shot.segStart)));
    let end = Math.max(start, Math.min(segmentCount - 1, Math.round(shot.segEnd)));
    if (used.has(start) && start < segmentCount - 1) start += 1;
    end = Math.max(start, end);
    shot.segStart = start;
    shot.segEnd = end;
    for (let i = start; i <= end; i++) used.add(i);
    cursor = end + 1;
    if (!shot.id) shot.id = `shot_${shot.index + 1}`;
    if (!shot.palette || shot.palette.length !== 3) shot.palette = preset.palette;
  }
  // 补上未被覆盖的段落
  const covered = new Set<number>();
  for (const shot of sorted) for (let i = shot.segStart; i <= shot.segEnd; i++) covered.add(i);
  for (let i = 0; i < segmentCount; i++) {
    if (covered.has(i)) continue;
    const near = sorted.find((s) => s.segEnd >= i - 1) ?? sorted[sorted.length - 1];
    if (near) near.segEnd = Math.max(near.segEnd, i);
  }
  return sorted.map((s, i) => ({ ...s, index: i }));
}

function normalizeMusicSpec(value: unknown, fallback: MusicSpec): MusicSpec | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<MusicSpec>;
  const allowedScale = ['major', 'minor', 'dorian', 'pentatonic'] as const;
  const instruments = Array.isArray(v.instruments)
    ? v.instruments
        .filter((i) => i && typeof i.role === 'string' && typeof i.waveform === 'string')
        .map((i) => ({
          name: String(i.name ?? i.role),
          role: (['pad', 'bass', 'arp', 'perc', 'texture'] as const).includes(i.role as never) ? i.role : 'pad',
          waveform: ['sine', 'triangle', 'saw', 'square', 'noise'].includes(i.waveform) ? i.waveform : 'sine',
          gain: clamp(Number(i.gain ?? 0.2), 0.02, 0.7),
          octave: clamp(Math.round(Number(i.octave ?? 0)), -3, 3),
        }))
    : fallback.instruments;
  return {
    title: typeof v.title === 'string' ? v.title.slice(0, 20) : fallback.title,
    mood: typeof v.mood === 'string' ? v.mood.slice(0, 20) : fallback.mood,
    genre: typeof v.genre === 'string' ? v.genre.slice(0, 24) : fallback.genre,
    tempoBpm: clamp(Math.round(Number(v.tempoBpm ?? fallback.tempoBpm)), 45, 150),
    key: typeof v.key === 'string' ? v.key.slice(0, 4) : fallback.key,
    scale: allowedScale.includes(v.scale as never) ? (v.scale as MusicSpec['scale']) : fallback.scale,
    energy: clamp(Math.round(Number(v.energy ?? fallback.energy)), 1, 5),
    instruments: instruments.length ? instruments.slice(0, 6) : fallback.instruments,
    chordProgression:
      Array.isArray(v.chordProgression) && v.chordProgression.length
        ? v.chordProgression.filter((c): c is string => typeof c === 'string').slice(0, 6)
        : fallback.chordProgression,
    durationSec: 0,
    notes: strArray(v.notes, fallback.notes, 5),
    provider: 'mock',
    model: 'local-mock',
  };
}

/** 单镜头提示词优化（供 /api/prompt/optimize 与分镜编辑使用） */
export async function optimizeShotPrompt(project: Project, shotId: string): Promise<Shot | undefined> {
  const board = project.storyboard;
  if (!board) return undefined;
  const shot = board.shots.find((s) => s.id === shotId);
  if (!shot) return undefined;
  const preset = stylePresetOf(project.stylePresetId);
  const fallback = () => mockOptimizedPrompt(shot.prompt, preset);
  const result = await llmJson<PromptOptimizeResult>({
    ...optimizePromptMessages(shot.prompt, preset, project.requirements),
    fallback,
    validate: (value) => {
      const v = value as Partial<PromptOptimizeResult>;
      if (typeof v.optimized !== 'string' || !v.optimized.trim()) return null;
      return {
        original: shot.prompt,
        optimized: v.optimized,
        negative: typeof v.negative === 'string' ? v.negative : shot.negativePrompt,
        rationale: strArray(v.rationale, fallback().rationale, 5),
        variants: Array.isArray(v.variants)
          ? v.variants
              .filter((x) => x && typeof x.prompt === 'string')
              .map((x) => ({ name: String(x.name ?? '变体'), prompt: x.prompt, note: String(x.note ?? '') }))
              .slice(0, 4)
          : fallback().variants,
        provider: 'mock',
        model: 'local-mock',
      };
    },
    temperature: 0.8,
    maxTokens: 1800,
    label: '镜头提示词优化',
    projectId: project.id,
  });
  shot.prompt = result.data.optimized;
  shot.negativePrompt = result.data.negative;
  project.updatedAt = Date.now();
  saveProject(project);
  return shot;
}

/** 供 SSE 首屏使用 */
export function projectSummaryOf(project: Project) {
  return toSummary(project);
}
