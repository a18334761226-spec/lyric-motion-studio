import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Music4,
  Landmark,
  Wand2,
  Search,
  Sparkles,
  Loader2,
  Check,
  Globe2,
  Plus,
  X,
  ArrowRight,
  SlidersHorizontal,
  Mic2,
  Volume2,
  Palette,
  MonitorPlay,
  FileText,
} from 'lucide-react';
import type {
  AspectRatio,
  RenderResolution,
  ResearchBundle,
  SceneDensity,
  Song,
  SongSearchResult,
  SourceType,
  StylePreset,
  VoiceOption,
} from '../../shared/types';
import { ASPECT_META, SCENE_DENSITY_META, SOURCE_TYPE_META } from '../../shared/types';
import { DEFAULT_STYLE_PRESET_ID, DEFAULT_VOICE_ID, VOICE_OPTIONS } from '../../shared/presets';
import { api } from '../api';
import { EmptyState, Field, SectionTitle, Segmented, Tag, useToast } from '../ui';

const DURATIONS = [
  { value: 0, label: '自动' },
  { value: 20, label: '20 秒' },
  { value: 30, label: '30 秒' },
  { value: 45, label: '45 秒' },
  { value: 60, label: '60 秒' },
  { value: 90, label: '90 秒' },
  { value: 120, label: '2 分钟' },
];

const AMBIENCE = [
  { id: 'none', label: '无环境音' },
  { id: 'room', label: '室内' },
  { id: 'wind', label: '旷野风' },
  { id: 'rain', label: '雨声' },
  { id: 'crowd', label: '人群' },
] as const;

interface ParsedLine {
  time: string;
  text: string;
}

function parseLrc(lrc: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const match = raw.match(/^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (!match) continue;
    const text = (match[4] || '').trim();
    if (text) lines.push({ time: `${match[1]}:${match[2]}`, text });
  }
  return lines;
}

export function NewProject() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const initialType = (searchParams.get('type') as SourceType) || 'lyrics';

  const [sourceType, setSourceType] = useState<SourceType>(initialType);
  const [stylePresetId, setStylePresetId] = useState(DEFAULT_STYLE_PRESET_ID);
  const [aspect, setAspect] = useState<AspectRatio>('9:16');
  const [resolution, setResolution] = useState<RenderResolution>('1080p');
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  // 创作需求
  const [brief, setBrief] = useState('');
  const [targetDurationSec, setTargetDuration] = useState(0);
  const [sceneDensity, setSceneDensity] = useState<SceneDensity>('auto');
  const [mustInclude, setMustInclude] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [styleKeywords, setStyleKeywords] = useState('');
  const [narrationTone, setNarrationTone] = useState('');
  const [bgmPrompt, setBgmPrompt] = useState('');
  const [bgmMode, setBgmMode] = useState<'ai' | 'none'>('none');
  const [ambience, setAmbience] = useState<(typeof AMBIENCE)[number]['id']>('none');

  // 歌词
  const [songQuery, setSongQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SongSearchResult | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [songLines, setSongLines] = useState<ParsedLine[]>([]);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [loadingSong, setLoadingSong] = useState(false);
  const [pastedLyrics, setPastedLyrics] = useState('');
  const [pastedTitle, setPastedTitle] = useState('');
  const [pastedArtist, setPastedArtist] = useState('');

  // 历史
  const [topic, setTopic] = useState('');
  const [era, setEra] = useState('');
  const [research, setResearch] = useState<ResearchBundle | null>(null);
  const [researching, setResearching] = useState(false);
  const [pastedSources, setPastedSources] = useState('');

  // 创意
  const [idea, setIdea] = useState(() => searchParams.get('idea') ?? '');

  const { data: styles } = useQuery<StylePreset[]>({ queryKey: ['styles'], queryFn: () => api.get<StylePreset[]>('/styles') });
  const { data: voices } = useQuery<VoiceOption[]>({ queryKey: ['voices'], queryFn: () => api.get<VoiceOption[]>('/voices'), initialData: VOICE_OPTIONS });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(songQuery.trim()), 380);
    return () => window.clearTimeout(timer);
  }, [songQuery]);

  // 首屏预选歌曲
  const preselected = useRef(false);
  useEffect(() => {
    const songId = searchParams.get('songId');
    if (songId && !preselected.current) {
      preselected.current = true;
      setSourceType('lyrics');
      void loadSongById(songId);
    }
  }, [searchParams]);

  useEffect(() => {
    if (sourceType !== 'lyrics' || !debouncedQuery) {
      setSearchResult(null);
      return;
    }
    let alive = true;
    setSearching(true);
    api
      .get<SongSearchResult>(`/lyrics/search?q=${encodeURIComponent(debouncedQuery)}&online=true`)
      .then((result) => {
        if (alive) setSearchResult(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [debouncedQuery, sourceType]);

  async function loadSongById(id: string) {
    setLoadingSong(true);
    try {
      const result = await api.get<{ song?: Song; error?: string }>(`/lyrics/song/${encodeURIComponent(id)}`);
      if (result.song) {
        const lines = parseLrc(result.song.lrc);
        setSong(result.song);
        setSongLines(lines);
        setRangeStart(0);
        setRangeEnd(Math.max(0, lines.length - 1));
        if (!title) setTitle(result.song.title);
      }
      if (result.error) toast.error(result.error);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingSong(false);
    }
  }

  async function runResearch() {
    if (!topic.trim()) {
      toast.error('请先填写历史主题');
      return;
    }
    setResearching(true);
    try {
      const bundle = await api.post<ResearchBundle>('/research', { topic: topic.trim(), era: era.trim() || undefined, maxSources: 10 });
      setResearch(bundle);
      if (!bundle.sources.length) toast.error(bundle.notices.join('；') || '没有检索到有效资料');
      else toast.success(`检索到 ${bundle.sources.length} 条资料，已提炼 ${bundle.facts.length} 条事实`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setResearching(false);
    }
  }

  const selPreset = useMemo(() => styles?.find((s) => s.id === stylePresetId), [styles, stylePresetId]);
  const selectedVoice = voices?.find((v) => v.id === voiceId);

  const payload = useMemo(() => {
    const requirements = {
      brief: brief.trim() || defaultBrief(sourceType),
      targetDurationSec,
      sceneDensity,
      mustInclude,
      avoid,
      styleKeywords,
      narrationTone,
      language: 'zh' as const,
      bgmMode,
      bgmPrompt,
    };
    if (sourceType === 'lyrics') {
      if (song) {
        return {
          sourceType,
          title: title.trim() || song.title,
          songId: song.id,
          section: songLines.length > 1 ? { startLine: rangeStart, endLine: rangeEnd } : undefined,
          requirements,
          stylePresetId,
          aspect,
          resolution,
          voiceId,
        };
      }
      return {
        sourceType,
        title: title.trim() || pastedTitle.trim() || undefined,
        lyricsRaw: pastedLyrics,
        lyricsTitle: pastedTitle,
        lyricsArtist: pastedArtist,
        requirements,
        stylePresetId,
        aspect,
        resolution,
        voiceId,
      };
    }
    if (sourceType === 'history') {
      return {
        sourceType,
        title: title.trim() || topic,
        topic: topic.trim(),
        era: era.trim(),
        raw: pastedSources.trim() || undefined,
        research: research ?? undefined,
        requirements,
        stylePresetId,
        aspect,
        resolution,
        voiceId,
      };
    }
    return {
      sourceType: 'idea',
      title: title.trim() || undefined,
      raw: idea.trim(),
      requirements: { ...requirements, brief: brief.trim() || idea.trim() },
      stylePresetId,
      aspect,
      resolution,
      voiceId,
    };
  }, [
    sourceType,
    song,
    songLines.length,
    rangeStart,
    rangeEnd,
    pastedLyrics,
    pastedTitle,
    pastedArtist,
    topic,
    era,
    research,
    pastedSources,
    idea,
    title,
    requirementsKey(brief, targetDurationSec, sceneDensity, mustInclude, avoid, styleKeywords, narrationTone, bgmMode, bgmPrompt),
    stylePresetId,
    aspect,
    resolution,
    voiceId,
  ]);

  const canCreate =
    sourceType === 'lyrics' ? Boolean(song) || Boolean(pastedLyrics.trim()) : sourceType === 'history' ? Boolean(topic.trim()) : Boolean(idea.trim());

  async function createProject(start: boolean) {
    if (!canCreate) {
      toast.error(sourceType === 'lyrics' ? '请先选择或粘贴歌词' : sourceType === 'history' ? '请填写历史主题' : '请写下你的想法');
      return;
    }
    setCreating(true);
    try {
      const project = await api.post<{ id: string }>('/projects', payload);
      toast.success('项目已创建');
      navigate(`/projects/${project.id}${start ? '?autostart=1' : ''}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>
            <Sparkles size={22} style={{ color: 'var(--brand-400)' }} />
            新建成片
          </h2>
          <p>选择素材来源，补充你的创作需求 —— 镜头数量、画面内容与配乐都会由 AI 依据内容动态生成，不套模板。</p>
        </div>
      </div>

      <div className="option-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 18 }}>
        {(Object.keys(SOURCE_TYPE_META) as SourceType[]).map((type) => {
          const meta = SOURCE_TYPE_META[type];
          const Icon = type === 'lyrics' ? Music4 : type === 'history' ? Landmark : Wand2;
          return (
            <button
              key={type}
              className={`option-card ${sourceType === type ? 'active' : ''}`}
              onClick={() => setSourceType(type)}
              style={{ padding: '14px 16px' }}
            >
              <span className="row" style={{ gap: 9 }}>
                <Icon size={17} style={{ color: type === 'lyrics' ? 'var(--brand-300)' : type === 'history' ? '#fcd34d' : 'var(--aqua-300)' }} />
                <strong>{meta.label}</strong>
              </span>
              <span>{meta.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="split">
        <div className="col" style={{ gap: 16 }}>
          <div className="card card-pad">
            {sourceType === 'lyrics' ? (
              <LyricsSource
                song={song}
                songLines={songLines}
                loadingSong={loadingSong}
                searchQuery={songQuery}
                onSearchQuery={setSongQuery}
                searching={searching}
                searchResult={searchResult}
                onPick={(picked) => void loadSongById(picked.id)}
                onClear={() => {
                  setSong(null);
                  setSongLines([]);
                }}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                onRange={(start, end) => {
                  setRangeStart(Math.max(0, Math.min(start, end)));
                  setRangeEnd(Math.min(songLines.length - 1, Math.max(start, end)));
                }}
                pastedLyrics={pastedLyrics}
                onPastedLyrics={setPastedLyrics}
                pastedTitle={pastedTitle}
                onPastedTitle={setPastedTitle}
                pastedArtist={pastedArtist}
                onPastedArtist={setPastedArtist}
              />
            ) : null}

            {sourceType === 'history' ? (
              <div className="col" style={{ gap: 16 }}>
                <SectionTitle icon={<Landmark size={16} />}>历史 / 资料研究</SectionTitle>
                <div className="form-grid">
                  <Field label="主题" hint="例如：赤壁之战、敦煌莫高窟、北宋汴京">
                    <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="想讲哪一段历史？" />
                  </Field>
                  <Field label="时期 / 范围" hint="可选">
                    <input className="input" value={era} onChange={(e) => setEra(e.target.value)} placeholder="例如：东汉末年 · 208 年" />
                  </Field>
                </div>
                <div className="row wrap">
                  <button className="btn btn-primary" onClick={() => void runResearch()} disabled={researching || !topic.trim()}>
                    {researching ? <Loader2 size={15} className="spin" /> : <Globe2 size={15} />}
                    {researching ? '正在联网检索…' : '联网检索并提炼史料'}
                  </button>
                  <span className="small muted">Wikipedia · DuckDuckGo · Bing 三通道并行</span>
                </div>

                {research ? <ResearchPreview bundle={research} onRefresh={() => void runResearch()} /> : null}

                <Field label="粘贴补充资料" hint="可选，会与检索结果一起交给 AI">
                  <textarea
                    className="textarea"
                    value={pastedSources}
                    onChange={(e) => setPastedSources(e.target.value)}
                    placeholder="可以粘贴史书段落、维基摘要、你自己整理的资料…（不填也可以，创建后会自动联网检索）"
                  />
                </Field>
              </div>
            ) : null}

            {sourceType === 'idea' ? (
              <div className="col" style={{ gap: 16 }}>
                <SectionTitle icon={<Wand2 size={16} />}>口播稿 / 创意描述</SectionTitle>
                <Field label="粘贴口播稿，或描述想要的短片" hint="≥120 字的完整口播稿会保留原文、逐段成镜，并自动补开场白；短创意由 AI 写脚本">
                  <textarea
                    className="textarea"
                    style={{ minHeight: 200 }}
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder={'例如：今天我们来聊一个词，康波周期。它决定了过去 250 年财富怎么重新分配……（整段口播稿直接粘贴，程序会按原文切段、逐段配画面、补开场白、1.3 倍语速配音）'}
                  />
                </Field>
                <p className="small muted">
                  提示：粘贴完整口播稿时，默认「保留原文 + 自动开场白 + 1.3 倍语速」；也可以只写一句创意，让 AI 写脚本。
                </p>
              </div>
            ) : null}
          </div>

          <div className="card card-pad">
            <SectionTitle icon={<SlidersHorizontal size={16} />}>创作需求</SectionTitle>
            <div className="col" style={{ gap: 15 }}>
              <Field label="整体要求" hint="会同时影响理解、分镜、提示词与配乐">
                <textarea
                  className="textarea"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="例如：纪录片口吻，多用兵器、地貌与天空的空镜，避免人物特写；节奏缓慢、克制，结尾留白。"
                />
              </Field>
              <div className="form-grid">
                <Field label="目标时长" hint="留给 AI 决定镜头密度">
                  <select className="select" value={targetDurationSec} onChange={(e) => setTargetDuration(Number(e.target.value))}>
                    {DURATIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="镜头密度">
                  <Segmented
                    value={sceneDensity}
                    onChange={setSceneDensity}
                    options={(Object.keys(SCENE_DENSITY_META) as SceneDensity[]).map((key) => ({ value: key, label: SCENE_DENSITY_META[key].label }))}
                  />
                </Field>
              </div>
              <div className="form-grid" style={{ gap: 14 }}>
                <TagInput label="必须出现" hint="回车添加，逗号分隔" values={mustInclude} onChange={setMustInclude} placeholder="雨夜街道、路灯…" />
                <TagInput label="尽量避免" hint="回车添加" values={avoid} onChange={setAvoid} placeholder="人脸特写、文字水印…" />
              </div>
              <div className="form-grid">
                <Field label="风格自由描述" hint="会覆盖预设中的对应描述">
                  <input className="input" value={styleKeywords} onChange={(e) => setStyleKeywords(e.target.value)} placeholder="水墨留白、低饱和、长焦压缩…" />
                </Field>
                <Field label="旁白 / 配音语气">
                  <input className="input" value={narrationTone} onChange={(e) => setNarrationTone(e.target.value)} placeholder="温柔、克制，像在耳边说话" />
                </Field>
              </div>
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card card-pad">
            <SectionTitle icon={<Palette size={16} />}>风格提示（可选，默认 AI 自由发挥）</SectionTitle>
            <div className="option-grid">
              {(styles ?? []).map((preset) => (
                <button key={preset.id} className={`option-card ${stylePresetId === preset.id ? 'active' : ''}`} onClick={() => setStylePresetId(preset.id)}>
                  <span className="row" style={{ gap: 6, justifyContent: 'space-between' }}>
                    <strong>{preset.name}</strong>
                    {stylePresetId === preset.id ? <Check size={13} style={{ color: 'var(--brand-300)' }} /> : null}
                  </span>
                  <span>{preset.tagline}</span>
                  <span className="palette-preview">
                    {preset.palette.map((color) => (
                      <i key={color} style={{ background: color }} />
                    ))}
                  </span>
                </button>
              ))}
            </div>
            <div className="divider" />
            <div className="col" style={{ gap: 13 }}>
              <Field label="画幅">
                <Segmented
                  value={aspect}
                  onChange={setAspect}
                  options={(Object.keys(ASPECT_META) as AspectRatio[]).map((key) => ({ value: key, label: ASPECT_META[key].label }))}
                />
              </Field>
              <Field label="分辨率" hint={aspect === '9:16' ? `${ASPECT_META[aspect].width}×${ASPECT_META[aspect].height}` : undefined}>
                <Segmented
                  value={resolution}
                  onChange={setResolution}
                  options={[
                    { value: '720p' as RenderResolution, label: '720p 快速' },
                    { value: '1080p' as RenderResolution, label: '1080p 高清' },
                  ]}
                />
              </Field>
            </div>
          </div>

          <div className="card card-pad">
            <SectionTitle icon={<Mic2 size={16} />}>配音</SectionTitle>
            <Field label="音色" hint={selectedVoice ? `${selectedVoice.tags.join(' · ')}` : undefined}>
              <select className="select" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                {(voices ?? []).map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} · {voice.locale} · {voice.tags.slice(0, 2).join('/')}
                  </option>
                ))}
              </select>
            </Field>
            {selectedVoice ? <p className="field-help" style={{ marginTop: 6 }}>{selectedVoice.description}</p> : null}

            <div className="divider" />
            <SectionTitle icon={<Volume2 size={16} />}>背景音乐</SectionTitle>
            <div className="col" style={{ gap: 12 }}>
              <Segmented
                value={bgmMode}
                onChange={setBgmMode}
                options={[
                  { value: 'ai', label: 'AI 生成配乐' },
                  { value: 'none', label: '不加配乐' },
                ]}
              />
              {bgmMode === 'ai' ? (
                <Field label="音乐需求" hint="AI 会据此设计调式、速度与配器，再本地合成">
                  <input className="input" value={bgmPrompt} onChange={(e) => setBgmPrompt(e.target.value)} placeholder="低沉的氛围电子，钢琴与低频脉动，克制" />
                </Field>
              ) : null}
              <Field label="环境音">
                <select className="select" value={ambience} onChange={(e) => setAmbience(e.target.value as typeof ambience)}>
                  {AMBIENCE.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className="card card-pad">
            <SectionTitle icon={<MonitorPlay size={16} />}>成品概览</SectionTitle>
            <div className="col" style={{ gap: 8 }}>
              <div className="row-between small">
                <span className="muted">素材</span>
                <strong>{SOURCE_TYPE_META[sourceType].label}</strong>
              </div>
              <div className="row-between small">
                <span className="muted">画幅</span>
                <strong>
                  {ASPECT_META[aspect].label} · {resolution}
                </strong>
              </div>
              <div className="row-between small">
                <span className="muted">风格</span>
                <strong>{selPreset?.name ?? 'AI 自由发挥'}</strong>
              </div>
              <div className="row-between small">
                <span className="muted">镜头</span>
                <strong>{targetDurationSec ? `约 ${Math.max(4, Math.round(targetDurationSec / 5))} 个` : 'AI 自动规划'}</strong>
              </div>
              <div className="row-between small">
                <span className="muted">配音</span>
                <strong>{selectedVoice?.name ?? '晓晓'}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky-actions">
        <div className="grow small muted">
          {sourceType === 'lyrics'
            ? song
              ? `已选「${song.title}」${songLines.length ? ` · ${rangeEnd - rangeStart + 1}/${songLines.length} 句入片` : ''}`
              : '选择或粘贴歌词后即可创建'
            : sourceType === 'history'
              ? research
                ? `已研究「${research.query}」· ${research.sources.length} 条来源 / ${research.facts.length} 条事实`
                : '创建后会自动联网检索（也可先点「联网检索」预览资料）'
              : idea.trim()
                ? 'AI 将根据你的描述撰写脚本；长口播稿会保留原文'
                : '粘贴完整口播稿（≥120 字会保留原文并自动补开场白）'}
        </div>
        <button className="btn btn-ghost" disabled={!canCreate || creating} onClick={() => void createProject(false)}>
          <FileText size={15} />
          仅创建草稿
        </button>
        <button className="btn btn-primary btn-lg" disabled={!canCreate || creating} onClick={() => void createProject(true)}>
          {creating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
          创建并开始生成
          <ArrowRight size={15} />
        </button>
      </div>

      <div style={{ marginTop: 18 }}>
        <Tag>生成过程可随时在项目页暂停 / 单阶段重跑</Tag>
      </div>
    </div>
  );
}

function requirementsKey(...args: unknown[]): string {
  return JSON.stringify(args);
}

function defaultBrief(type: SourceType): string {
  if (type === 'lyrics') return '把歌词做成一支有呼吸感的歌词 MV，画面克制、有留白。';
  if (type === 'history') return '用纪录片的口吻讲述这段历史，画面强调时代细节与空间感。';
  return '';
}

function TagInput({
  label,
  hint,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  function commit() {
    const items = draft
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return;
    const next = [...values];
    for (const item of items) if (!next.includes(item)) next.push(item);
    onChange(next.slice(0, 12));
    setDraft('');
  }
  return (
    <div className="field">
      <label>
        {label}
        {hint ? <span className="hint">{hint}</span> : null}
      </label>
      <div className="input-row">
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder}
        />
        <button className="btn btn-ghost btn-icon" type="button" onClick={commit} aria-label="添加">
          <Plus size={15} />
        </button>
      </div>
      {values.length ? (
        <div className="chips" style={{ marginTop: 6 }}>
          {values.map((value) => (
            <span className="chip active" key={value}>
              {value}
              <button className="chip-remove" onClick={() => onChange(values.filter((v) => v !== value))} aria-label="移除">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LyricsSource(props: {
  song: Song | null;
  songLines: ParsedLine[];
  loadingSong: boolean;
  searchQuery: string;
  onSearchQuery: (value: string) => void;
  searching: boolean;
  searchResult: SongSearchResult | null;
  onPick: (song: Song) => void;
  onClear: () => void;
  rangeStart: number;
  rangeEnd: number;
  onRange: (start: number, end: number) => void;
  pastedLyrics: string;
  onPastedLyrics: (value: string) => void;
  pastedTitle: string;
  onPastedTitle: (value: string) => void;
  pastedArtist: string;
  onPastedArtist: (value: string) => void;
}) {
  const [mode, setMode] = useState<'search' | 'paste'>('search');
  const {
    song,
    songLines,
    loadingSong,
    searchQuery,
    onSearchQuery,
    searching,
    searchResult,
    onPick,
    onClear,
    rangeStart,
    rangeEnd,
    onRange,
    pastedLyrics,
    onPastedLyrics,
    pastedTitle,
    onPastedTitle,
    pastedArtist,
    onPastedArtist,
  } = props;

  return (
    <div className="col" style={{ gap: 15 }}>
      <div className="row-between">
        <SectionTitle icon={<Music4 size={16} />}>歌词素材</SectionTitle>
        <div className="segmented">
          <button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>
            曲库检索
          </button>
          <button className={mode === 'paste' ? 'active' : ''} onClick={() => setMode('paste')}>
            粘贴歌词
          </button>
        </div>
      </div>

      {mode === 'search' ? (
        <>
          {!song ? (
            <>
              <div className="search-hero" style={{ marginBottom: 4 }}>
                <Search size={16} />
                <input value={searchQuery} onChange={(e) => onSearchQuery(e.target.value)} placeholder="搜索歌名、歌手或歌词片段…" />
                {searching ? <Loader2 size={15} className="spin" style={{ color: 'var(--brand-400)' }} /> : null}
              </div>
              {searchResult?.notice ? <p className="small muted">{searchResult.notice}</p> : null}
              {searchResult?.songs?.length ? (
                <div className="col" style={{ gap: 6 }}>
                  {searchResult.songs.slice(0, 8).map((item) => (
                    <button
                      key={item.id}
                      className="source-card"
                      style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }}
                      onClick={() => onPick(item)}
                    >
                      <span className="song-avatar" style={{ width: 34, height: 34, fontSize: 13 }}>
                        {item.title.slice(0, 1)}
                      </span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="song-title" style={{ fontSize: 13 }}>
                          {item.title}
                        </span>
                        <span className="song-artist">{item.artist}</span>
                      </span>
                      {item.lineCount ? <span className="badge badge-live">{item.lineCount} 句</span> : <span className="badge badge-draft">在线</span>}
                    </button>
                  ))}
                </div>
              ) : searchQuery && !searching ? (
                <p className="small muted">没有匹配结果，试试「粘贴歌词」。</p>
              ) : (
                <p className="small muted">不输入关键词时展示内置原创示例曲库。</p>
              )}
            </>
          ) : (
            <>
              <div className="card card-pad" style={{ background: 'rgba(139,92,246,0.07)', borderColor: 'rgba(167,139,250,0.25)' }}>
                <div className="row" style={{ gap: 10 }}>
                  <span className="song-avatar">{song.title.slice(0, 1)}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="song-title">{song.title}</div>
                    <div className="song-artist">{song.artist}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={onClear}>
                    重选
                  </button>
                </div>
              </div>
              {loadingSong ? (
                <p className="small muted">正在加载歌词…</p>
              ) : songLines.length ? (
                <>
                  <div className="form-grid">
                    <Field label="起始句" hint={`共 ${songLines.length} 句`}>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={rangeEnd}
                        value={rangeStart}
                        onChange={(e) => onRange(Number(e.target.value), rangeEnd)}
                      />
                    </Field>
                    <Field label="结束句">
                      <input
                        className="input"
                        type="number"
                        min={rangeStart}
                        max={songLines.length - 1}
                        value={rangeEnd}
                        onChange={(e) => onRange(rangeStart, Number(e.target.value))}
                      />
                    </Field>
                  </div>
                  <div className="segment-list" style={{ maxHeight: 240 }}>
                    {songLines.map((line, index) =>
                      index >= rangeStart && index <= rangeEnd ? (
                        <div className="segment-row" key={index}>
                          <span className="segment-index">{String(index + 1).padStart(2, '0')}</span>
                          <span className="segment-text">{line.text}</span>
                          <span className="segment-time">{line.time}</span>
                        </div>
                      ) : null,
                    )}
                  </div>
                  <p className="small muted">
                    已选 {rangeEnd - rangeStart + 1} 句 · 约 {Math.round((rangeEnd - rangeStart + 1) * 4.2)} 秒人声（配音语速可调）
                  </p>
                </>
              ) : (
                <p className="small muted">这首歌暂时没有解析到歌词行。</p>
              )}
            </>
          )}
        </>
      ) : (
        <div className="form-grid">
          <Field label="歌名">
            <input className="input" value={pastedTitle} onChange={(e) => onPastedTitle(e.target.value)} placeholder="可选" />
          </Field>
          <Field label="歌手 / 来源">
            <input className="input" value={pastedArtist} onChange={(e) => onPastedArtist(e.target.value)} placeholder="可选" />
          </Field>
          <Field label="歌词内容" className="span-2" hint="支持 LRC 时间轴，也支持纯文本（按 4 秒/行估算）">
            <textarea
              className="textarea"
              style={{ minHeight: 190 }}
              value={pastedLyrics}
              onChange={(e) => onPastedLyrics(e.target.value)}
              placeholder={'[00:12.00]雨在玻璃上写没说完的话\n[00:17.50]路灯把影子拉成一把吉他'}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function ResearchPreview({ bundle, onRefresh }: { bundle: ResearchBundle; onRefresh: () => void }) {
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row-between">
        <span className="row small" style={{ gap: 8 }}>
          <Globe2 size={14} style={{ color: 'var(--aqua-300)' }} />
          已检索 <b>{bundle.sources.length}</b> 条来源 · 提炼 <b>{bundle.facts.length}</b> 条事实
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onRefresh}>
          重新检索
        </button>
      </div>
      {bundle.notices?.length ? <p className="small muted">{bundle.notices.join('；')}</p> : null}
      {bundle.summary ? (
        <div className="prompt-box" style={{ fontSize: 12, fontFamily: 'var(--font)' }}>
          {bundle.summary}
        </div>
      ) : null}
      {bundle.timeline?.length ? (
        <div className="mono-timeline">
          {bundle.timeline.slice(0, 6).map((item, index) => (
            <div className="tl-item" key={`${item.year}-${index}`}>
              <span className="tl-year">{item.year}</span>
              <span className="tl-event">{item.event}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="source-list">
        {bundle.sources.slice(0, 4).map((source) => (
          <a key={source.id} className="source-card" href={source.url} target="_blank" rel="noreferrer">
            <div className="source-head">
              <span className="source-domain">{source.domain}</span>
              <span className="source-title">{source.title}</span>
            </div>
            <div className="source-snippet">{source.snippet}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
