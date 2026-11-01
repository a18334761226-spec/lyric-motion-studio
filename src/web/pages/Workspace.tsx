import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Play,
  Square,
  Download,
  Trash2,
  RefreshCw,
  Sparkles,
  Film,
  Clock3,
  Layers,
  Music4,
  Mic2,
  Palette,
  Landmark,
  Lightbulb,
  ListMusic,
  Wand2,
  Image as ImageIcon,
  Settings2,
  Volume2,
  Upload,
  Globe2,
  Loader2,
  Check,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileAudio,
  RotateCcw,
  Pause,
  Sparkle,
  Save,
  Copy,
  Mountain,
  Activity,
} from 'lucide-react';
import type {
  PipelineEvent,
  Project,
  Shot,
  StageKey,
  StageState,
  VoiceOption,
} from '../../shared/types';
import { ASPECT_META, STAGE_META, STAGE_ORDER } from '../../shared/types';
import { VOICE_OPTIONS } from '../../shared/presets';
import { api, formatBytes, formatDuration, subscribeProject, timeAgo } from '../api';
import {
  AudioButton,
  CopyButton,
  EmptyState,
  Field,
  Modal,
  ProgressBar,
  SectionTitle,
  Segmented,
  Spinner,
  StatusBadge,
  Tag,
  useToast,
} from '../ui';

type TabKey = 'overview' | 'source' | 'research' | 'analysis' | 'storyboard' | 'voice' | 'music' | 'output';

interface LogItem {
  id: number;
  at: number;
  message: string;
  level: 'info' | 'success' | 'warn' | 'error';
}

const TAB_OF_STAGE: Record<StageKey, TabKey> = {
  source: 'source',
  research: 'research',
  analysis: 'analysis',
  storyboard: 'storyboard',
  prompts: 'storyboard',
  images: 'storyboard',
  voice: 'voice',
  music: 'music',
  render: 'output',
};

export function Workspace() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTabState] = useState<TabKey>(() => {
    const initial = searchParams.get('tab') as TabKey | null;
    const allowed: TabKey[] = ['overview', 'source', 'research', 'analysis', 'storyboard', 'voice', 'music', 'output'];
    return initial && allowed.includes(initial) ? initial : 'overview';
  });
  const setTab = useCallback(
    (next: TabKey) => {
      setTabState(next);
      const params = new URLSearchParams(searchParams);
      if (next === 'overview') params.delete('tab');
      else params.set('tab', next);
      navigate(`/projects/${id}?${params.toString()}`, { replace: true });
    },
    [id, navigate, searchParams],
  );
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const logId = useRef(0);
  const autostarted = useRef(false);

  const { data: project, isLoading, error } = useQuery<Project>({
    queryKey: ['project', id],
    queryFn: () => api.get<Project>(`/projects/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 5000 : false),
    enabled: Boolean(id),
  });

  const { data: voices } = useQuery<VoiceOption[]>({
    queryKey: ['voices'],
    queryFn: () => api.get<VoiceOption[]>('/voices'),
    initialData: VOICE_OPTIONS,
  });

  const pushLog = useCallback((message: string, level: LogItem['level'] = 'info') => {
    logId.current += 1;
    setLogs((prev) => [...prev.slice(-199), { id: logId.current, at: Date.now(), message, level }]);
  }, []);

  // SSE
  useEffect(() => {
    if (!id) return;
    const unsubscribe = subscribeProject(id, (event: PipelineEvent) => {
      if (event.project) {
        queryClient.setQueryData(['project', id], event.project);
      } else if (event.stage && event.type === 'progress') {
        queryClient.setQueryData<Project>(['project', id], (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            stages: prev.stages.map((stage) =>
              stage.key === event.stage ? { ...stage, progress: event.progress ?? stage.progress, message: event.message ?? stage.message, status: 'running' } : stage,
            ),
          };
        });
      }
      if (event.type === 'progress' && event.message) pushLog(`[${event.stage ? STAGE_META[event.stage].short : '任务'}] ${event.message}`);
      if (event.type === 'stage' && event.message) pushLog(event.message, event.progress === 100 ? 'success' : 'info');
      if (event.type === 'shot' && event.message) pushLog(event.message);
      if (event.type === 'done') {
        toast.success('成片已生成');
        pushLog('生成完成', 'success');
      }
      if (event.type === 'cancelled') {
        toast.info('已取消生成');
        pushLog('已取消生成', 'warn');
      }
      if (event.type === 'error') {
        toast.error(event.message ?? '生成失败');
        pushLog(event.message ?? '生成失败', 'error');
      }
    });
    return unsubscribe;
  }, [id, pushLog, queryClient, toast]);

  // autostart
  useEffect(() => {
    if (!project || autostarted.current) return;
    if (searchParams.get('autostart') === '1') {
      autostarted.current = true;
      if (project.status !== 'running') {
        void startRun();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const running = project?.status === 'running';
  const stages = project?.stages ?? [];
  const completedStages = stages.filter((s) => s.status === 'done').length;
  const visibleStages = stages.filter((s) => s.status !== 'skipped');
  const progress = visibleStages.length ? Math.round((completedStages / visibleStages.length) * 100) : 0;

  async function startRun(from?: StageKey, force?: boolean) {
    if (!project) return;
    setBusy('start');
    try {
      await api.post(`/projects/${project.id}/start`, { from, force });
      pushLog(from ? `从「${STAGE_META[from].label}」重新开始` : '开始生成', 'info');
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function cancelRun() {
    if (!project) return;
    setBusy('cancel');
    try {
      await api.post(`/projects/${project.id}/cancel`, {});
      pushLog('已请求取消', 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function deleteProject() {
    if (!project) return;
    if (!window.confirm(`确定删除「${project.title}」及其全部素材？此操作不可恢复。`)) return;
    await api.del(`/projects/${project.id}`);
    toast.success('项目已删除');
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    navigate('/');
  }

  if (isLoading) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <div className="skeleton" style={{ height: 60 }} />
        <div className="skeleton" style={{ height: 420 }} />
      </div>
    );
  }
  if (error || !project) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="项目不存在"
        description={(error as Error)?.message ?? '可能已被删除'}
        action={
          <Link className="btn btn-primary" to="/">
            返回控制台
          </Link>
        }
      />
    );
  }

  const isNarrow = project.render.aspect === '9:16';

  return (
    <div>
      <div className="ws-header">
        <div className="ws-title">
          <div className="row wrap" style={{ gap: 9 }}>
            <Link to="/" className="btn btn-ghost btn-icon btn-sm" aria-label="返回">
              <ArrowLeft size={15} />
            </Link>
            <h2>{project.title}</h2>
            <StatusBadge status={project.status} />
            <Tag brand>{project.source.type === 'lyrics' ? '歌词' : project.source.type === 'history' ? '历史·资料' : '口播稿 / 想法'}</Tag>
            {project.analysis?.provider === 'deepseek' ? <span className="badge badge-live">DeepSeek</span> : null}
          </div>
          <p>
            {project.source.type === 'lyrics'
              ? `${project.source.title} · ${project.source.author}`
              : project.source.type === 'history'
                ? `${project.source.topic ?? project.source.title}${project.source.era ? ` · ${project.source.era}` : ''}`
                : project.requirements.brief.slice(0, 80)}
            <span className="sep" style={{ margin: '0 8px', color: 'var(--mist-600)' }}>·</span>
            {project.render.aspect} · {project.render.resolution} · 更新于 {timeAgo(project.updatedAt)}
          </p>
        </div>
        <div className="ws-actions">
          {running ? (
            <button className="btn btn-danger" onClick={() => void cancelRun()} disabled={busy === 'cancel'}>
              <Square size={14} />
              取消生成
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void startRun()} disabled={busy === 'start'}>
              {busy === 'start' ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
              {project.assets.videoUrl ? '继续 / 重新生成' : '开始生成'}
            </button>
          )}
          {project.assets.videoUrl ? (
            <a className="btn btn-ghost" href={`/api/projects/${project.id}/download`}>
              <Download size={14} />
              下载 MP4
            </a>
          ) : null}
          <button className="btn btn-ghost btn-icon" onClick={() => void deleteProject()} aria-label="删除项目">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="workspace">
        <aside className="card stage-rail">
          <div className="row-between" style={{ padding: '0 8px 10px' }}>
            <span className="small muted">生成流水线</span>
            <span className="small mono" style={{ color: 'var(--mist-300)' }}>
              {progress}%
            </span>
          </div>
          <ProgressBar value={progress} thin />
          <div style={{ marginTop: 10 }}>
            {stages.map((stage) => (
              <StageItem
                key={stage.key}
                stage={stage}
                active={project.stage === stage.key}
                onClick={() => setTab(TAB_OF_STAGE[stage.key])}
                onRetry={() => void startRun(stage.key, true)}
              />
            ))}
          </div>
        </aside>

        <div className="col" style={{ gap: 16, minWidth: 0 }}>
          {project.error ? (
            <div className="status-line" style={{ borderColor: 'rgba(251,113,133,0.35)', background: 'rgba(251,113,133,0.08)' }}>
              <AlertTriangle size={15} style={{ color: 'var(--rose-400)' }} />
              <span className="grow">{project.error}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => void startRun()}>
                重试
              </button>
            </div>
          ) : null}

          <div className="tabs">
            <TabButton current={tab} value="overview" onChange={setTab} icon={<Activity size={14} />} label="总览" />
            <TabButton current={tab} value="source" onChange={setTab} icon={<ListMusic size={14} />} label="素材" count={project.segments.length} />
            {project.source.type === 'history' ? (
              <TabButton
                current={tab}
                value="research"
                onChange={setTab}
                icon={<Globe2 size={14} />}
                label="研究资料"
                count={project.source.research?.sources.length}
              />
            ) : null}
            <TabButton current={tab} value="analysis" onChange={setTab} icon={<Lightbulb size={14} />} label="内容理解" />
            <TabButton current={tab} value="storyboard" onChange={setTab} icon={<Layers size={14} />} label="分镜" count={project.storyboard?.shots.length} />
            <TabButton current={tab} value="voice" onChange={setTab} icon={<Mic2 size={14} />} label="配音" />
            <TabButton current={tab} value="music" onChange={setTab} icon={<Music4 size={14} />} label="音乐" />
            <TabButton current={tab} value="output" onChange={setTab} icon={<Film size={14} />} label="成片" />
          </div>

          {tab === 'overview' ? (
            <OverviewTab
              project={project}
              logs={logs}
              narrow={isNarrow}
              onGoto={setTab}
              onStart={() => void startRun()}
              running={running}
            />
          ) : null}
          {tab === 'source' ? <SourceTab project={project} onRestart={() => void startRun('source', true)} /> : null}
          {tab === 'research' ? <ResearchTab project={project} onResearch={() => void startRun('research', true)} running={running} /> : null}
          {tab === 'analysis' ? <AnalysisTab project={project} onRestart={() => void startRun('analysis', true)} /> : null}
          {tab === 'storyboard' ? (
            <StoryboardTab project={project} onProject={setProjectCache} onRestart={(from) => void startRun(from, true)} />
          ) : null}
          {tab === 'voice' ? <VoiceTab project={project} voices={voices ?? VOICE_OPTIONS} onProject={setProjectCache} onRestart={() => void startRun('voice', true)} /> : null}
          {tab === 'music' ? <MusicTab project={project} onProject={setProjectCache} onRestart={() => void startRun('music', true)} /> : null}
          {tab === 'output' ? <OutputTabV2 project={project} narrow={isNarrow} onRestart={() => void startRun('render', true)} /> : null}
        </div>
      </div>
    </div>
  );

  function setProjectCache(next: Project | ((prev: Project) => Project)) {
    queryClient.setQueryData<Project>(['project', id], (prev) => {
      if (!prev) return prev;
      return typeof next === 'function' ? next(prev) : next;
    });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  }
}

function StageItem({ stage, active, onClick, onRetry }: { stage: StageState; active: boolean; onClick: () => void; onRetry: () => void }) {
  const meta = STAGE_META[stage.key];
  return (
    <div className={`stage-item ${stage.status} ${active ? 'active' : ''}`} style={active ? { background: 'rgba(139,92,246,0.08)' } : undefined}>
      <span className="stage-dot">
        {stage.status === 'done' ? (
          <Check size={12} />
        ) : stage.status === 'failed' ? (
          <AlertTriangle size={12} />
        ) : stage.status === 'running' ? (
          <Loader2 size={12} className="spin" />
        ) : (
          STAGE_ORDER.indexOf(stage.key) + 1
        )}
      </span>
      <button className="stage-info" style={{ textAlign: 'left' }} onClick={onClick} title={meta.description}>
        <strong>{meta.short}</strong>
        <span>{stage.status === 'running' ? stage.message || '进行中…' : stage.status === 'done' ? '完成' : stage.status === 'failed' ? stage.error?.slice(0, 22) ?? '失败' : stage.status === 'skipped' ? '已跳过' : meta.description}</span>
        {stage.status === 'running' ? (
          <span className="stage-progress-inline">
            <ProgressBar value={stage.progress} thin />
          </span>
        ) : null}
      </button>
      {stage.status === 'failed' ? (
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onRetry} title="重试该阶段">
          <RotateCcw size={12} />
        </button>
      ) : stage.status === 'running' ? (
        <span className="stage-pct">{stage.progress}%</span>
      ) : null}
    </div>
  );
}

function TabButton({
  current,
  value,
  onChange,
  icon,
  label,
  count,
}: {
  current: TabKey;
  value: TabKey;
  onChange: (tab: TabKey) => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button className={`tab ${current === value ? 'active' : ''}`} onClick={() => onChange(value)}>
      {icon}
      {label}
      {typeof count === 'number' && count > 0 ? <span className="tab-count">{count}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* 总览                                                                */
/* ------------------------------------------------------------------ */

function OverviewTab({
  project,
  logs,
  narrow,
  onGoto,
  onStart,
  running,
}: {
  project: Project;
  logs: LogItem[];
  narrow: boolean;
  onGoto: (tab: TabKey) => void;
  onStart: () => void;
  running: boolean;
}) {
  const shots = project.storyboard?.shots ?? [];
  const timeline = project.assets.timeline ?? [];
  const [activeSeg, setActiveSeg] = useState<number | null>(null);

  return (
    <div className="overview-grid">
      <div className="col" style={{ gap: 16 }}>
        <div className="card">
          <div className={`video-stage ${narrow ? '' : 'wide'}`}>
            {project.assets.videoUrl ? (
              <video src={project.assets.videoUrl} controls poster={project.assets.coverUrl} playsInline />
            ) : (
              <div className="video-placeholder">
                {running ? <Loader2 size={42} className="spin" /> : <Film size={44} />}
                <strong>{running ? '正在生成成片…' : '还没有成片'}</strong>
                <p>
                  {running
                    ? project.stages.find((s) => s.status === 'running')?.message ?? '流水线运行中'
                    : '点击「开始生成」，AI 会依次完成理解、分镜、画面、配音、配乐与合成。'}
                </p>
                {!running ? (
                  <button className="btn btn-primary" onClick={onStart}>
                    <Sparkles size={15} />
                    开始生成
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <div className="video-meta-bar">
            <span className="row" style={{ gap: 6 }}>
              <Clock3 size={13} />
              {formatDuration(project.assets.videoDuration)}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <Layers size={13} />
              {shots.length} 镜
            </span>
            <span className="row" style={{ gap: 6 }}>
              <FileAudio size={13} />
              {VOICE_OPTIONS.find((voice) => voice.id === project.voice.voiceId)?.name ?? project.voice.voiceId}
            </span>
            <span className="row" style={{ marginLeft: 'auto', gap: 8 }}>
              {project.assets.videoUrl ? (
                <a className="btn btn-ghost btn-sm" href={`/api/projects/${project.id}/download`}>
                  <Download size={13} />
                  下载
                </a>
              ) : null}
              <button className="btn btn-soft btn-sm" onClick={() => onGoto('storyboard')}>
                查看分镜
                <ChevronRight size={13} />
              </button>
            </span>
          </div>
        </div>

        <div className="card card-pad">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <SectionTitle icon={<FileAudio size={16} />} count={timeline.length}>
              配音时间轴
            </SectionTitle>
            {project.assets.voiceoverUrl ? <AudioButton src={project.assets.voiceoverUrl} label="听整条旁白" /> : null}
          </div>
          {timeline.length ? (
            <div className="timeline-list">
              {timeline.map((item, index) => (
                <div className={`timeline-row ${activeSeg === index ? 'active' : ''}`} key={item.segId} onClick={() => setActiveSeg(index)}>
                  <span className="timeline-time">{formatDuration(item.start)}</span>
                  <span className="timeline-text">{item.text}</span>
                  {item.audioUrl ? <AudioButton src={item.audioUrl} label="" /> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">完成「配音」阶段后，这里会显示逐句时间轴。</p>
          )}
        </div>
      </div>

      <div className="col" style={{ gap: 16 }}>
        <div className="card card-pad">
          <SectionTitle icon={<Lightbulb size={16} />}>内容理解</SectionTitle>
          {project.analysis ? (
            <div className="col" style={{ gap: 10 }}>
              <div>
                <div className="small muted">主题</div>
                <div style={{ fontWeight: 600 }}>{project.analysis.theme}</div>
              </div>
              <div>
                <div className="small muted">故事线</div>
                <div className="small" style={{ color: 'var(--mist-300)' }}>
                  {project.analysis.logline}
                </div>
              </div>
              <div className="chips">
                {project.analysis.emotions.slice(0, 5).map((emotion) => (
                  <Tag key={emotion} brand>
                    {emotion}
                  </Tag>
                ))}
              </div>
              {project.analysis.timeline?.length ? (
                <div>
                  <div className="small muted" style={{ marginBottom: 6 }}>
                    时间线
                  </div>
                  <div className="mono-timeline">
                    {project.analysis.timeline.slice(0, 4).map((item, index) => (
                      <div className="tl-item" key={index}>
                        <span className="tl-year">{item.year}</span>
                        <span className="tl-event">{item.event}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="small muted">尚未完成内容理解。</p>
          )}
        </div>

        <div className="card card-pad">
          <SectionTitle icon={<Music4 size={16} />}>声音设计</SectionTitle>
          {project.assets.music?.spec ? (
            <div className="col" style={{ gap: 8 }}>
              <div className="row-between small">
                <span className="muted">配乐</span>
                <strong>{project.assets.music.spec.title}</strong>
              </div>
              <div className="row-between small">
                <span className="muted">情绪 / 风格</span>
                <strong>
                  {project.assets.music.spec.mood} · {project.assets.music.spec.genre}
                </strong>
              </div>
              <div className="row-between small">
                <span className="muted">速度 / 调式</span>
                <strong>
                  {project.assets.music.spec.tempoBpm} BPM · {project.assets.music.spec.key} {project.assets.music.spec.scale}
                </strong>
              </div>
              {project.assets.music.bgmUrl ? <AudioButton src={project.assets.music.bgmUrl} label="试听 BGM" /> : null}
            </div>
          ) : (
            <p className="small muted">尚未设计配乐。</p>
          )}
        </div>

        <div className="card card-pad">
          <SectionTitle icon={<Activity size={16} />}>实时日志</SectionTitle>
          <div className="log-list">
            {logs.length ? (
              [...logs].reverse().map((log) => (
                <div className={`log-row ${log.level}`} key={log.id}>
                  <time>{new Date(log.at).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                  <span className="grow">{log.message}</span>
                </div>
              ))
            ) : (
              <p className="small muted">开始生成后，这里会滚动显示每一步进度。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 素材                                                                */
/* ------------------------------------------------------------------ */

function SourceTab({ project, onRestart }: { project: Project; onRestart: () => void }) {
  const timeline = project.assets.timeline ?? [];
  const timelineByIndex = new Map(timeline.map((item) => [item.segIndex, item]));
  return (
    <div className="card card-pad">
      <div className="row-between" style={{ marginBottom: 14 }}>
        <SectionTitle icon={<ListMusic size={16} />} count={project.segments.length}>
          {project.source.type === 'lyrics' ? '歌词分段' : '旁白脚本'}
        </SectionTitle>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={onRestart}>
            <RotateCcw size={13} />
            重新解析
          </button>
        </div>
      </div>

      <div className="status-line" style={{ marginBottom: 12 }}>
        <FileAudio size={13} />
        {project.source.type === 'lyrics' ? `${project.source.title} · ${project.source.author}` : project.source.title}
        <strong style={{ marginLeft: 'auto' }}>
          {project.segments.length} 段 · 共 {project.segments.reduce((sum, s) => sum + s.text.length, 0)} 字
        </strong>
      </div>

      <div className="segment-list">
        {project.segments.map((segment, index) => {
          const timing = timelineByIndex.get(index);
          return (
            <div className="segment-row" key={segment.id}>
              <span className="segment-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="segment-text">{segment.text}</span>
              {timing?.audioUrl ? <AudioButton src={timing.audioUrl} label="" duration={timing.end - timing.start} /> : null}
              <span className="segment-time">{timing ? formatDuration(timing.start) : '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 研究                                                                */
/* ------------------------------------------------------------------ */

function ResearchTab({ project, onResearch, running }: { project: Project; onResearch: () => void; running: boolean }) {
  const bundle = project.source.research;
  if (!bundle || !bundle.sources.length) {
    return (
      <EmptyState
        icon={<Globe2 />}
        title="还没有联网研究结果"
        description="点击下方按钮，用 Wikipedia / DuckDuckGo / Bing 检索相关资料，并由 DeepSeek 提炼成时间线与可引用事实。"
        action={
          <button className="btn btn-primary" onClick={onResearch} disabled={running}>
            {running ? <Loader2 size={15} className="spin" /> : <Globe2 size={15} />}
            立即联网研究
          </button>
        }
      />
    );
  }
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <SectionTitle icon={<Globe2 size={16} />}>资料综述</SectionTitle>
          <div className="row" style={{ gap: 8 }}>
            <span className="pill">
              {bundle.provider} · {bundle.sources.length} 条来源
            </span>
            <button className="btn btn-ghost btn-sm" onClick={onResearch} disabled={running}>
              <RotateCcw size={13} />
              重新检索
            </button>
          </div>
        </div>
        {bundle.summary ? <div className="prompt-box" style={{ fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1.75 }}>{bundle.summary}</div> : null}
        {bundle.notices?.length ? <p className="small muted" style={{ marginTop: 10 }}>{bundle.notices.join('；')}</p> : null}
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <SectionTitle icon={<Clock3 size={16} />} count={bundle.timeline.length}>
            时间线
          </SectionTitle>
          {bundle.timeline.length ? (
            <div className="mono-timeline">
              {bundle.timeline.map((item, index) => (
                <div className="tl-item" key={index}>
                  <span className="tl-year">{item.year}</span>
                  <span className="tl-event">{item.event}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">未提取到明确时间线。</p>
          )}
        </div>
        <div className="card card-pad">
          <SectionTitle icon={<Sparkle size={16} />} count={bundle.facts.length}>
            可引用事实
          </SectionTitle>
          <div className="fact-list">
            {bundle.facts.map((fact, index) => (
              <div className="fact-item" key={index}>
                <span className="fact-num">{String(index + 1).padStart(2, '0')}</span>
                <span>
                  {fact.claim}
                  {fact.detail ? <span className="muted"> · {fact.detail}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <SectionTitle icon={<Landmark size={16} />} count={bundle.sources.length}>
          检索来源
        </SectionTitle>
        <div className="source-list">
          {bundle.sources.map((source) => (
            <a className="source-card" key={source.id} href={source.url} target="_blank" rel="noreferrer">
              <div className="source-head">
                <span className="source-domain">{source.domain}</span>
                <span className="source-title">{source.title}</span>
                <span className="pill" style={{ padding: '1px 7px', fontSize: 10 }}>
                  {source.provider}
                </span>
              </div>
              <div className="source-snippet">{source.snippet}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 内容理解                                                            */
/* ------------------------------------------------------------------ */

function AnalysisTab({ project, onRestart }: { project: Project; onRestart: () => void }) {
  const analysis = project.analysis;
  if (!analysis) {
    return (
      <EmptyState
        icon={<Lightbulb />}
        title="尚未完成内容理解"
        description="AI 会提炼主题、故事线、情绪、意象、色彩与导演建议，并据此规划分镜。"
        action={
          <button className="btn btn-primary" onClick={onRestart}>
            <Sparkles size={15} />
            运行内容理解
          </button>
        }
      />
    );
  }
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <SectionTitle icon={<Lightbulb size={16} />}>主题与故事线</SectionTitle>
          <button className="btn btn-ghost btn-sm" onClick={onRestart}>
            <RotateCcw size={13} />
            重新分析
          </button>
        </div>
        <h3 style={{ fontSize: 19, fontWeight: 650, marginBottom: 8 }}>{analysis.theme}</h3>
        <p style={{ color: 'var(--mist-300)', fontSize: 13, lineHeight: 1.7 }}>{analysis.logline}</p>
        <div className="chips" style={{ marginTop: 12 }}>
          <Tag brand>{analysis.mood}</Tag>
          {analysis.emotions.map((emotion) => (
            <Tag key={emotion}>{emotion}</Tag>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <SectionTitle icon={<Sparkle size={16} />}>关键词与意象</SectionTitle>
          <div className="small muted" style={{ marginBottom: 6 }}>
            关键词
          </div>
          <div className="chips" style={{ marginBottom: 12 }}>
            {analysis.keywords.map((keyword) => (
              <Tag key={keyword} brand>
                {keyword}
              </Tag>
            ))}
          </div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            视觉意象
          </div>
          <div className="chips">
            {analysis.imagery.map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
          </div>
          <div className="small muted" style={{ margin: '14px 0 6px' }}>
            色彩故事
          </div>
          <div className="chips">
            {analysis.colorStory.map((color) => (
              <Tag key={color}>{color}</Tag>
            ))}
          </div>
        </div>

        <div className="card card-pad">
          <SectionTitle icon={<Palette size={16} />}>导演建议</SectionTitle>
          <div className="col" style={{ gap: 8 }}>
            {analysis.directorNotes.map((note, index) => (
              <div className="fact-item" key={index}>
                <span className="fact-num">{String(index + 1).padStart(2, '0')}</span>
                <span>{note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <SectionTitle icon={<Layers size={16} />} count={analysis.sections.length}>
          情感曲线 / 段落结构
        </SectionTitle>
        <div className="col" style={{ gap: 8 }}>
          {analysis.sections.map((section, index) => (
            <div className="row" key={index} style={{ gap: 12 }}>
              <span className="mono small" style={{ width: 28, color: 'var(--mist-600)' }}>
                {index + 1}
              </span>
              <span className="badge badge-brand">{section.label}</span>
              <span className="small muted">
                第 {section.segStart}–{section.segEnd} 段
              </span>
              <div className="grow">
                <ProgressBar value={((index + 1) / analysis.sections.length) * 100} thin />
              </div>
              <span className="small" style={{ color: 'var(--mist-300)', width: 80, textAlign: 'right' }}>
                {section.mood}
              </span>
            </div>
          ))}
        </div>
      </div>

      {analysis.timeline?.length ? (
        <div className="card card-pad">
          <SectionTitle icon={<Clock3 size={16} />}>历史时间线</SectionTitle>
          <div className="mono-timeline">
            {analysis.timeline.map((item, index) => (
              <div className="tl-item" key={index}>
                <span className="tl-year">{item.year}</span>
                <span className="tl-event">{item.event}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 分镜                                                                */
/* ------------------------------------------------------------------ */

function StoryboardTab({
  project,
  onProject,
  onRestart,
}: {
  project: Project;
  onProject: (next: Project | ((prev: Project) => Project)) => void;
  onRestart: (from: StageKey) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<Shot | null>(null);
  const [draft, setDraft] = useState({ title: '', subtitle: '', prompt: '', negativePrompt: '', motion: 'zoom-in', shotSize: '中景', searchQuery: '' });
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const shots = project.storyboard?.shots ?? [];
  const timeline = project.assets.timeline ?? [];
  const durationOf = (shot: Shot) => {
    const start = timeline[shot.segStart]?.start ?? 0;
    const end = timeline[shot.segEnd]?.end ?? 0;
    return Math.max(0, end - start);
  };

  function openEdit(shot: Shot) {
    setEditing(shot);
    setDraft({
      title: shot.title,
      subtitle: shot.subtitle,
      prompt: shot.prompt,
      negativePrompt: shot.negativePrompt,
      motion: shot.motion,
      shotSize: shot.shotSize,
      searchQuery: shot.searchQuery ?? '',
    });
  }

  async function saveShot() {
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await api.put<Project>(`/projects/${project.id}/shots`, {
        shots: [{ id: editing.id, ...draft }],
      });
      onProject(updated);
      setEditing(null);
      toast.success('镜头已保存');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function optimize() {
    if (!editing) return;
    setOptimizing(true);
    try {
      const result = await api.post<{ shot: Shot; project: Project }>(`/projects/${project.id}/shots/${editing.id}/optimize`, {});
      setDraft((prev) => ({ ...prev, prompt: result.shot.prompt, negativePrompt: result.shot.negativePrompt }));
      onProject(result.project);
      toast.success('提示词已优化');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOptimizing(false);
    }
  }

  async function regenerate() {
    if (!editing) return;
    setRegenerating(true);
    try {
      const result = await api.post<{ shot: Shot; project: Project }>(`/projects/${project.id}/shots/${editing.id}/regenerate`, {});
      onProject(result.project);
      setEditing(result.shot);
      toast.success(result.shot.error ? '已降级为兜底画面' : '画面已重新生成');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  if (!shots.length) {
    return (
      <EmptyState
        icon={<Layers />}
        title="还没有分镜"
        description="音分镜会依据内容长度与你的创作需求动态生成镜头，不套固定模板。"
        action={
          <button className="btn btn-primary" onClick={() => onRestart('storyboard')}>
            <Sparkles size={15} />
            生成分镜
          </button>
        }
      />
    );
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card card-pad">
        <div className="row-between wrap" style={{ gap: 12 }}>
          <div>
            <div className="small muted">整片视觉风格</div>
            <div style={{ fontSize: 13, color: 'var(--mist-200)', maxWidth: 700 }}>{project.storyboard?.visualStyle}</div>
            <div className="small muted" style={{ marginTop: 6 }}>
              每个镜头的画面由它对应的原句提炼（雨窗 / 街灯 / 电梯 / 车流…），卡片上的「画面依据」就是关联证据。
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => onRestart('prompts')}>
              <Wand2 size={13} />
              重新优化提示词
            </button>
            <button className="btn btn-soft btn-sm" onClick={() => onRestart('images')}>
              <ImageIcon size={13} />
              重新生成画面
            </button>
          </div>
        </div>
      </div>

      <div className="shot-grid">
        {shots.map((shot) => (
          <div className="card card-hover shot-card" key={shot.id}>
            <div className="shot-thumb">
              {shot.imageUrl ? <img src={shot.imageUrl} alt={shot.title} loading="lazy" /> : <div className="skeleton" style={{ height: '100%' }} />}
              <span className="shot-index">#{String(shot.index + 1).padStart(2, '0')}</span>
              <span className="shot-duration">{durationOf(shot) ? `${durationOf(shot).toFixed(1)}s` : '待配音'}</span>
              <span className="shot-state">
                {shot.imageStatus === 'mock' ? (
                  <span className="badge badge-mock">LLM 画面</span>
                ) : shot.imageStatus === 'done' ? (
                  <span className="badge badge-live">AI</span>
                ) : shot.imageStatus === 'running' ? (
                  <span className="badge badge-running">
                    <Loader2 size={10} className="spin" /> 生成中
                  </span>
                ) : shot.imageStatus === 'failed' ? (
                  <span className="badge badge-error">失败</span>
                ) : null}
              </span>
            </div>
            <div className="shot-body">
              <div className="shot-title">
                {shot.title}
                <Tag>{shot.shotSize}</Tag>
              </div>
              <div className="shot-sub">{shot.subtitle}</div>
              {shot.visualAnchors?.length ? (
                <div className="shot-anchors">
                  <span>画面依据</span>
                  {shot.visualAnchors.map((anchor) => (
                    <Tag key={anchor} brand>
                      {anchor}
                    </Tag>
                  ))}
                </div>
              ) : null}
              <div className="shot-prompt">{shot.prompt}</div>
              <div className="shot-actions">
                <button className="btn btn-ghost btn-sm grow" onClick={() => openEdit(shot)}>
                  <Settings2 size={13} />
                  编辑
                </button>
                <span className="small muted">{shot.motion}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={Boolean(editing)}
        title={editing ? `镜头 #${editing.index + 1} · ${editing.title}` : ''}
        description="画面提示词决定生成质量；负面提示词用于排除不想要的元素。"
        onClose={() => setEditing(null)}
        wide
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button className="btn btn-ghost" onClick={() => void optimize()} disabled={optimizing}>
              {optimizing ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
              AI 优化提示词
            </button>
            <button className="btn btn-ghost" onClick={() => void regenerate()} disabled={regenerating}>
              {regenerating ? <Loader2 size={14} className="spin" /> : <ImageIcon size={14} />}
              重新生成画面
            </button>
            <button className="btn btn-primary" onClick={() => void saveShot()} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              保存
            </button>
          </>
        }
      >
        {editing ? (
          <div className="col" style={{ gap: 14 }}>
            <div className="grid-2" style={{ gap: 12 }}>
              <div className="shot-thumb" style={{ borderRadius: 12, overflow: 'hidden' }}>
                {editing.imageUrl ? <img src={editing.imageUrl} alt="" /> : <div className="skeleton" style={{ height: '100%' }} />}
              </div>
              <div className="col" style={{ gap: 10 }}>
                <Field label="标题">
                  <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </Field>
                <Field label="景别">
                  <select className="select" value={draft.shotSize} onChange={(e) => setDraft({ ...draft, shotSize: e.target.value })}>
                    {['远景', '全景', '中景', '近景', '特写', '大特写'].map((size) => (
                      <option key={size}>{size}</option>
                    ))}
                  </select>
                </Field>
                <Field label="运镜">
                  <select className="select" value={draft.motion} onChange={(e) => setDraft({ ...draft, motion: e.target.value })}>
                    <option value="zoom-in">缓慢推近</option>
                    <option value="zoom-out">缓慢拉远</option>
                    <option value="pan-left">向左横移</option>
                    <option value="pan-right">向右横移</option>
                    <option value="drift-up">向上漂移</option>
                    <option value="static">固定机位</option>
                  </select>
                </Field>
              </div>
            </div>
            <Field label="字幕文本" hint="对应素材段落">
              <textarea className="textarea" style={{ minHeight: 70 }} value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
            </Field>
            <Field label="画面提示词" hint="英文效果通常更好，可包含主体/环境/光线/镜头/风格">
              <textarea className="textarea" style={{ minHeight: 140, fontFamily: 'var(--mono)', fontSize: 12 }} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
            </Field>
            <Field label="负面提示词">
              <textarea className="textarea" style={{ minHeight: 60, fontFamily: 'var(--mono)', fontSize: 12 }} value={draft.negativePrompt} onChange={(e) => setDraft({ ...draft, negativePrompt: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 配音                                                                */
/* ------------------------------------------------------------------ */

function VoiceTab({
  project,
  voices,
  onProject,
  onRestart,
}: {
  project: Project;
  voices: VoiceOption[];
  onProject: (next: Project | ((prev: Project) => Project)) => void;
  onRestart: () => void;
}) {
  const toast = useToast();
  const [voice, setVoice] = useState(project.voice);
  const [previewText, setPreviewText] = useState(project.segments[0]?.text ?? '这是配音试听。');
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const timeline = project.assets.timeline ?? [];

  async function saveVoice() {
    setSaving(true);
    try {
      const updated = await api.patch<Project>(`/projects/${project.id}`, { voice });
      onProject(updated);
      toast.success('音色设置已保存');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function preview() {
    if (!previewText.trim()) return;
    setPreviewing(true);
    try {
      const result = await api.post<{ url: string; duration: number; warning?: string }>(`/projects/${project.id}/voice/preview`, {
        text: previewText,
        voice,
      });
      setPreviewUrl(result.url);
      if (result.warning) toast.error(result.warning);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="col" style={{ gap: 16 }}>
        <div className="card card-pad">
          <div className="row-between wrap">
            <div>
              <SectionTitle icon={<Mic2 size={16} />}>人声朗读</SectionTitle>
              <p className="small muted" style={{ marginTop: 4 }}>
                关闭后不生成任何朗读/半唱，只保留歌曲 BGM + 歌词字幕，更像正式 MV。
              </p>
            </div>
            <button
              className={`btn ${voice.enabled === false ? 'btn-ghost' : 'btn-soft'} btn-sm`}
              onClick={async () => {
                const patch = { ...project.voice, enabled: project.voice.enabled === false };
                try {
                  const updated = await api.patch<Project>(`/projects/${project.id}`, { voice: patch });
                  setVoice(patch);
                  onProject(updated);
                  toast.success(patch.enabled ? '人声朗读已开启' : '人声朗读已关闭');
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              {voice.enabled === false ? '已关闭 · 点击开启' : '已开启 · 点击关闭'}
            </button>
          </div>
        </div>
        <div className="card card-pad">
          <SectionTitle icon={<Mic2 size={16} />}>音色与语速</SectionTitle>
          <div className="col" style={{ gap: 14 }}>
            <Field label="音色">
              <select className="select" value={voice.voiceId} onChange={(e) => setVoice({ ...voice, voiceId: e.target.value })}>
                {voices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.locale} · {item.tags.slice(0, 2).join('/')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="人声模式" hint="半唱会按情绪给每个词做旋律变调">
              <Segmented
                value={voice.singMode ?? 'speak'}
                onChange={(value) => setVoice({ ...voice, singMode: value })}
                options={[
                  { value: 'melodic', label: '半唱 · 有调' },
                  { value: 'speak', label: '自然朗读' },
                ]}
              />
              <div className="field-help" style={{ marginTop: 6 }}>
                半唱：借助 Edge-TTS 的逐词时间戳 + 保共振峰变调，让歌词朗读带旋律起伏；音色与语速仍可调。
              </div>
            </Field>
            <Field label={`语速 ${voice.rate > 0 ? '+' : ''}${voice.rate}%`}>
              <input className="range" type="range" min={-40} max={60} value={voice.rate} onChange={(e) => setVoice({ ...voice, rate: Number(e.target.value) })} />
            </Field>
            <Field label={`音调 ${voice.pitch > 0 ? '+' : ''}${voice.pitch}Hz`}>
              <input className="range" type="range" min={-20} max={20} value={voice.pitch} onChange={(e) => setVoice({ ...voice, pitch: Number(e.target.value) })} />
            </Field>
            <Field label={`句间停顿 ${voice.gapMs}ms`}>
              <input className="range" type="range" min={0} max={800} step={20} value={voice.gapMs} onChange={(e) => setVoice({ ...voice, gapMs: Number(e.target.value) })} />
            </Field>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => void saveVoice()} disabled={saving}>
                <Save size={13} />
                保存设置
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onRestart}>
                <RotateCcw size={13} />
                按新设置重新配音
              </button>
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <SectionTitle icon={<FileAudio size={16} />}>试听</SectionTitle>
          <div className="col" style={{ gap: 10 }}>
            <textarea className="textarea" value={previewText} onChange={(e) => setPreviewText(e.target.value)} placeholder="输入一段试听文本" />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-soft btn-sm" onClick={() => void preview()} disabled={previewing}>
                {previewing ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
                生成试听
              </button>
              {previewUrl ? <AudioButton src={previewUrl} label="播放试听" /> : null}
            </div>
            <p className="field-help">Edge-TTS 在线合成，免费无需 Key；失败时会自动用静音占位保证流水线继续。</p>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <SectionTitle icon={<Clock3 size={16} />} count={timeline.length}>
            逐句时间轴
          </SectionTitle>
          {project.assets.voiceoverUrl ? <AudioButton src={project.assets.voiceoverUrl} label="听完整旁白" /> : null}
        </div>
        {timeline.length ? (
          <div className="timeline-list" style={{ maxHeight: 620 }}>
            {timeline.map((item, index) => (
              <div className="timeline-row" key={item.segId}>
                <span className="timeline-time">{formatDuration(item.start)}</span>
                <span className="timeline-text">{item.text}</span>
                {item.audioUrl ? <AudioButton src={item.audioUrl} label="" /> : null}
                <span className="small muted" style={{ width: 42, textAlign: 'right' }}>
                  {(item.end - item.start).toFixed(1)}s
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">尚未生成配音，运行「配音」阶段后显示。</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 音乐                                                                */
/* ------------------------------------------------------------------ */

function MusicTab({
  project,
  onProject,
  onRestart,
}: {
  project: Project;
  onProject: (next: Project | ((prev: Project) => Project)) => void;
  onRestart: () => void;
}) {
  const toast = useToast();
  const [volume, setVolume] = useState(project.music.volume);
  const [ambience, setAmbience] = useState(project.music.ambience);
  const [prompt, setPrompt] = useState(project.music.prompt);
  const [uploading, setUploading] = useState(false);
  const [library, setLibrary] = useState<{ name: string; sizeMB: number }[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const spec = project.assets.music?.spec;

  useEffect(() => {
    api
      .get<{ items: { name: string; sizeMB: number }[] }>('/music/library')
      .then((res) => setLibrary(res.items))
      .catch(() => setLibrary([]));
  }, [project.id]);

  async function selectSong(name: string) {
    try {
      const res = await api.post<{ project: Project }>(`/projects/${project.id}/music/select`, { name });
      onProject(res.project);
      toast.success(`已使用歌曲：${name}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function saveConfig() {
    try {
      const updated = await api.patch<Project>(`/projects/${project.id}`, {
        music: { ...project.music, volume, ambience, prompt },
      });
      onProject(updated);
      toast.success('声音设置已保存');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function uploadBgm(file: File) {
    setUploading(true);
    try {
      const result = await api.upload<{ project: Project; duration: number }>(`/projects/${project.id}/music/upload?ext=${file.name.split('.').pop() ?? 'mp3'}`, file);
      onProject(result.project);
      toast.success('BGM 已上传');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card card-pad">
        <SectionTitle icon={<Music4 size={16} />}>歌曲背景音乐</SectionTitle>
        <p className="small muted" style={{ marginTop: 4 }}>
          直接把一首歌当 BGM：自动循环到成片长度、淡入淡出，人声出现时自动压低。上传你自己的歌，或从本地曲库选择（把 mp3 放进
          <code> assets/music/</code>）。
        </p>
        <div className="chips" style={{ marginTop: 10 }}>
          {library.map((item) => (
            <button className="chip chip-button" key={item.name} onClick={() => void selectSong(item.name)} title="选作背景音乐">
              <Music4 size={12} /> {item.name} · {item.sizeMB}MB
            </button>
          ))}
          {!library.length ? <span className="small muted">曲库为空：上传歌曲或把文件放进 assets/music/</span> : null}
        </div>
      </div>

      <div className="card card-pad">
        <div className="row-between wrap" style={{ marginBottom: 14 }}>
          <SectionTitle icon={<Music4 size={16} />}>AI 声音设计</SectionTitle>
          <div className="row" style={{ gap: 8 }}>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadBgm(file);
                e.target.value = '';
              }}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}
              上传自定义 BGM
            </button>
            <button className="btn btn-soft btn-sm" onClick={onRestart}>
              <RotateCcw size={13} />
              重新生成配乐
            </button>
          </div>
        </div>

        {spec ? (
          <div className="col" style={{ gap: 16 }}>
            <div className="music-spec">
              <div className="spec-cell">
                <span>曲名</span>
                <strong>{spec.title}</strong>
              </div>
              <div className="spec-cell">
                <span>情绪 / 风格</span>
                <strong style={{ fontSize: 13 }}>
                  {spec.mood} · {spec.genre}
                </strong>
              </div>
              <div className="spec-cell">
                <span>速度 / 调式</span>
                <strong style={{ fontSize: 13 }}>
                  {spec.tempoBpm} BPM · {spec.key} {spec.scale}
                </strong>
              </div>
              <div className="spec-cell">
                <span>能量</span>
                <strong>
                  {'●'.repeat(spec.energy)}
                  <span style={{ color: 'var(--mist-600)' }}>{'●'.repeat(5 - spec.energy)}</span>
                </strong>
              </div>
            </div>

            <div className="grid-2" style={{ gap: 18 }}>
              <div>
                <div className="small muted" style={{ marginBottom: 8 }}>
                  配器
                </div>
                {spec.instruments.map((instrument) => (
                  <div className="instrument-row" key={`${instrument.role}-${instrument.name}`}>
                    <span className="instrument-name">{instrument.name}</span>
                    <span className="instrument-bar">
                      <i style={{ width: `${Math.min(100, instrument.gain * 160)}%` }} />
                    </span>
                    <span className="instrument-gain">{(instrument.gain * 100).toFixed(0)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="small muted" style={{ marginBottom: 8 }}>
                  和弦进行
                </div>
                <div className="chips" style={{ marginBottom: 12 }}>
                  {spec.chordProgression.map((chord, index) => (
                    <Tag key={`${chord}-${index}`} brand>
                      {chord}
                    </Tag>
                  ))}
                </div>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  编曲说明
                </div>
                <div className="col" style={{ gap: 5 }}>
                  {spec.notes.map((note, index) => (
                    <span className="small" key={index} style={{ color: 'var(--mist-400)' }}>
                      · {note}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="row" style={{ gap: 10 }}>
              {project.assets.music?.bgmUrl ? <AudioButton src={project.assets.music.bgmUrl} label="试听配乐" /> : null}
              {project.assets.music?.ambienceUrl ? <AudioButton src={project.assets.music.ambienceUrl} label="试听环境音" /> : null}
              <span className="small muted">由本地合成器渲染，可随需求重新生成</span>
            </div>
          </div>
        ) : (
          <p className="small muted">尚未生成配乐。点击「重新生成配乐」让 AI 依据内容设计并合成。</p>
        )}
      </div>

      <div className="grid-2" style={{ gap: 16 }}>
        <div className="card card-pad">
          <SectionTitle icon={<Volume2 size={16} />}>混音</SectionTitle>
          <div className="col" style={{ gap: 14 }}>
            <Field label={`BGM 音量 ${(volume * 100).toFixed(0)}%`}>
              <input className="range" type="range" min={0.05} max={0.8} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
            </Field>
            <Field label="环境音">
              <select className="select" value={ambience} onChange={(e) => setAmbience(e.target.value as typeof ambience)}>
                <option value="none">无</option>
                <option value="room">室内空间</option>
                <option value="wind">旷野风</option>
                <option value="rain">雨声</option>
                <option value="crowd">人声远景</option>
              </select>
            </Field>
            <button className="btn btn-primary btn-sm" onClick={() => void saveConfig()}>
              <Save size={13} />
              保存混音设置
            </button>
          </div>
        </div>

        <div className="card card-pad">
          <SectionTitle icon={<Wand2 size={16} />}>音乐需求</SectionTitle>
          <Field label="下次生成配乐时遵循" hint="会交给 DeepSeek 设计配乐规格">
            <textarea className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：古琴 + 低音鼓，克制、苍凉，中段加入弦乐" />
          </Field>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => void saveConfig()}>
              保存需求
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 成片                                                                */
/* ------------------------------------------------------------------ */

function OutputTab({ project, narrow, onRestart }: { project: Project; narrow: boolean; onRestart: () => void }) {
  if (!project.assets.videoUrl) {
    return (
      <EmptyState
        icon={<Film />}
        title="成片尚未生成"
        description="完成前面的阶段后运行「成片渲染」，会在这里播放并支持下载。"
        action={
          <button className="btn btn-primary" onClick={onRestart}>
            <Sparkles size={15} />
            运行成片渲染
          </button>
        }
      />
    );
  }
  const timeline = project.assets.timeline ?? [];
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div
          className="video-stage"
          style={{
            aspectRatio: project.render.aspect === '9:16' ? '9 / 16' : project.render.aspect === '16:9' ? '16 / 9' : '1 / 1',
            maxHeight: narrow ? 520 : 640,
          }}
        >
          <video src={project.assets.videoUrl} controls poster={project.assets.coverUrl} playsInline />
        </div>
        <div className="video-meta-bar">
          <span className="badge badge-ready">
            <CheckCircle2 size={11} />
            已渲染
          </span>
          <span>{formatDuration(project.assets.videoDuration)}</span>
          <span>{formatBytes(project.assets.videoSize)}</span>
          <span>{project.render.aspect}</span>
          <span style={{ marginLeft: 'auto' }}>
            <a className="btn btn-primary btn-sm" href={`/api/projects/${project.id}/download`}>
              <Download size={13} />
              下载 MP4
            </a>
          </span>
        </div>
      </div>

      <div className="col" style={{ gap: 16 }}>
        <div className="card card-pad">
          <SectionTitle icon={<Film size={16} />}>成片信息</SectionTitle>          <div className="col" style={{ gap: 8 }}>
            <InfoRow label="标题" value={project.title} />
            <InfoRow label="素材来源" value={project.source.type === 'lyrics' ? '歌词' : project.source.type === 'history' ? '历史·资料' : '口播稿 / 想法'} />
            <InfoRow label="镜头 / 段落" value={`${project.storyboard?.shots.length ?? 0} / ${project.segments.length}`} />
            <InfoRow label="配音音色" value={VOICE_OPTIONS.find((voice) => voice.id === project.voice.voiceId)?.name ?? project.voice.voiceId} />
            <InfoRow label="配乐" value={project.assets.music?.spec ? `${project.assets.music.spec.title}（${project.assets.music.spec.provider === 'deepseek' ? 'DeepSeek' : '本地'}设计）` : '无'} />
            <InfoRow label="分辨率" value={`${project.render.resolution} · ${project.render.fps}fps`} />
            <InfoRow label="生成时间" value={new Date(project.updatedAt).toLocaleString('zh-CN')} />
          </div>
          <div className="divider" />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={onRestart}>
              <RotateCcw size={13} />
              重新渲染
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => window.open(`/media/${project.id}/out/video.mp4`, '_blank')}>
              <Play size={13} />
              新窗口播放
            </button>
          </div>
        </div>

        <OutputSettingsCard project={project} onRestart={onRestart} />

        <div className="card card-pad">
          <SectionTitle icon={<Clock3 size={16} />} count={timeline.length}>
            字幕对照
          </SectionTitle>
          <div className="timeline-list" style={{ maxHeight: 320 }}>
            {timeline.map((item) => (
              <div className="timeline-row" key={item.segId}>
                <span className="timeline-time">{formatDuration(item.start)}</span>
                <span className="timeline-text">{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between small">
      <span className="muted">{label}</span>
      <strong style={{ maxWidth: '68%', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</strong>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 成片设置：时长 / 画幅 / 语速                                          */
/* ------------------------------------------------------------------ */

function OutputSettingsCard({ project, onRestart }: { project: Project; onRestart: () => void }) {
  const toast = useToast();
  const [duration, setDuration] = useState<number>(project.requirements.targetDurationSec || 0);
  const [aspect, setAspect] = useState<Project['render']['aspect']>(project.render.aspect);
  const [rate, setRate] = useState<number>(project.voice.rate);
  const [applying, setApplying] = useState(false);

  const apply = async () => {
    setApplying(true);
    try {
      await api.patch(`/projects/${project.id}`, {
        requirements: { ...project.requirements, targetDurationSec: duration },
        render: { ...project.render, aspect },
        voice: { ...project.voice, rate },
      });
      await api.post(`/projects/${project.id}/start`, { from: 'analysis', force: true });
      toast.success('已应用：时长/画幅/语速已保存，正在重新生成（约 3–8 分钟）');
      onRestart();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="card card-pad">
      <SectionTitle icon={<Settings2 size={16} />}>成片设置（时长 / 画幅 / 语速）</SectionTitle>
      <div className="col" style={{ gap: 12 }}>
        <Field label="目标时长" hint="0 = 由文案长度自动决定；修改后按目标时长扩写/精简文稿（保留事实与开场白），不改变语速">
          <select className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            <option value={0}>自动（按文案长度）</option>
            <option value={30}>30 秒</option>
            <option value={60}>1 分钟</option>
            <option value={90}>1 分 30 秒</option>
            <option value={120}>2 分钟</option>
            <option value={180}>3 分钟</option>
            <option value={240}>4 分钟</option>
          </select>
        </Field>
        <Field label="画面比例" hint="竖屏 9:16（抖音） / 横屏 16:9 / 方形 1:1">
          <div className="segmented">
            {(['9:16', '16:9', '1:1'] as const).map((item) => (
              <button key={item} className={`seg ${aspect === item ? 'active' : ''}`} onClick={() => setAspect(item)}>
                {item}
              </button>
            ))}
          </div>
        </Field>
        <Field label={`配音语速 ${rate > 0 ? '+' : ''}${rate}%`} hint="默认 +30%（1.3 倍语速）">
          <input className="range" type="range" min={-40} max={60} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
        </Field>
        <button className="btn btn-primary" onClick={() => void apply()} disabled={applying}>
          <RotateCcw size={14} />
          {applying ? '提交中…' : '应用设置并重新生成'}
        </button>
        <p className="small muted" style={{ margin: 0 }}>
          画幅或时长变化会重新切段、重绘画面与配音；只改语速可只重跑配音和合成。
        </p>
      </div>
    </div>
  );
}

/* ---------------------- 成片页 V2：预览 + 设置分区 ---------------------- */

function OutputTabV2({ project, narrow, onRestart }: { project: Project; narrow: boolean; onRestart: () => void }) {
  if (!project.assets.videoUrl) {
    return (
      <EmptyState
        icon={<Film />}
        title="成片尚未生成"
        description="完成前面的阶段后运行「成片渲染」，会在这里播放并支持下载。"
        action={
          <button className="btn btn-primary" onClick={onRestart}>
            <Sparkles size={15} />
            运行成片渲染
          </button>
        }
      />
    );
  }
  const timeline = project.assets.timeline ?? [];
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card card-pad">
        <div
          className="video-stage"
          style={{
            aspectRatio: project.render.aspect === '9:16' ? '9 / 16' : project.render.aspect === '16:9' ? '16 / 9' : '1 / 1',
            maxHeight: narrow ? 420 : 560,
            maxWidth: 400,
            margin: '0 auto',
          }}
        >
          <video src={project.assets.videoUrl} controls poster={project.assets.coverUrl} playsInline />
        </div>
        <div className="video-meta-bar">
          <span className="badge badge-ready">
            <CheckCircle2 size={11} />
            已渲染
          </span>
          <span>{formatDuration(project.assets.videoDuration)}</span>
          <span>{formatBytes(project.assets.videoSize)}</span>
          <span>{project.render.aspect}</span>
          <span style={{ marginLeft: 'auto' }}>
            <a className="btn btn-primary btn-sm" href={`/api/projects/${project.id}/download`}>
              <Download size={13} />
              下载 MP4
            </a>
          </span>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <OutputSettingsCard project={project} onRestart={onRestart} />
        <div className="card card-pad">
          <SectionTitle icon={<Film size={16} />}>成片信息</SectionTitle>
          <div className="col" style={{ gap: 8 }}>
            <InfoRow label="标题" value={project.title} />
            <InfoRow label="素材来源" value={project.source.type === 'lyrics' ? '歌词' : project.source.type === 'history' ? '历史·资料' : '口播稿 / 想法'} />
            <InfoRow label="镜头 / 段落" value={`${project.storyboard?.shots.length ?? 0} / ${project.segments.length}`} />
            <InfoRow label="配音音色" value={VOICE_OPTIONS.find((voice) => voice.id === project.voice.voiceId)?.name ?? project.voice.voiceId} />
            <InfoRow label="配乐" value={project.assets.music?.spec ? `${project.assets.music.spec.title}（${project.assets.music.spec.provider === 'deepseek' ? 'DeepSeek' : '本地'}设计）` : '无'} />
            <InfoRow label="分辨率" value={`${project.render.resolution} · ${project.render.fps}fps`} />
            <InfoRow label="生成时间" value={new Date(project.updatedAt).toLocaleString('zh-CN')} />
          </div>
          <div className="divider" />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={onRestart}>
              <RotateCcw size={13} />
              重新渲染
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => window.open(`/media/${project.id}/out/video.mp4`, '_blank')}>
              <Play size={13} />
              新窗口播放
            </button>
          </div>
        </div>
      </div>

      <PublishPackCard project={project} />

      <div className="card card-pad">
        <SectionTitle icon={<Clock3 size={16} />} count={timeline.length}>
          字幕对照
        </SectionTitle>
        <div className="timeline-list" style={{ maxHeight: 360 }}>
          {timeline.map((item) => (
            <div className="timeline-row" key={item.segId}>
              <span className="timeline-time">{formatDuration(item.start)}</span>
              <span className="timeline-text">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- 抖音发布包 ---------------------------- */

function PublishPackCard({ project }: { project: Project }) {
  const toast = useToast();
  const { data } = useQuery<{
    publish: { title: string; desc: string; tags: string[] };
    coverUrl?: string;
    videoUrl?: string;
    folder: string;
    exportHint: string;
  }>({
    queryKey: ['publish-pack', project.id],
    queryFn: () => api.get(`/projects/${project.id}/publish-pack`),
  });

  const copy = async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label + '已复制');
    } catch {
      toast.error('复制失败，请手动选中复制');
    }
  };

  return (
    <div className="card card-pad">
      <SectionTitle icon={<Download size={16} />}>抖音发布包（封面 / 标题 / 文案 / 话题）</SectionTitle>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 8 }}>
        {data?.coverUrl ? (
          <div className="col" style={{ gap: 6, width: 170 }}>
            <img src={data.coverUrl} alt="封面" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--line)' }} />
            <a className="btn btn-ghost btn-sm" href={data.coverUrl} target="_blank" rel="noreferrer">
              <Download size={12} /> 下载封面
            </a>
          </div>
        ) : null}
        <div className="col" style={{ gap: 10, flex: 1, minWidth: 300 }}>
          <Field label="抖音标题">
            <div className="row" style={{ gap: 8 }}>
              <input className="input" readOnly value={data?.publish?.title ?? ''} />
              <button className="btn btn-ghost btn-sm" onClick={() => void copy(data?.publish?.title ?? '', '标题')}>
                <Copy size={12} /> 复制
              </button>
            </div>
          </Field>
          <Field label="简介 / 文案">
            <textarea className="textarea" readOnly style={{ minHeight: 76 }} value={data?.publish?.desc ?? ''} />
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => void copy(data?.publish?.desc ?? '', '简介')}>
              <Copy size={12} /> 复制简介
            </button>
          </Field>
          <Field label="话题">
            <div className="row" style={{ gap: 8 }}>
              <input className="input" readOnly value={(data?.publish?.tags ?? []).map((t) => '#' + t).join(' ')} />
              <button className="btn btn-ghost btn-sm" onClick={() => void copy((data?.publish?.tags ?? []).map((t) => '#' + t).join(' '), '话题')}>
                <Copy size={12} /> 复制
              </button>
            </div>
          </Field>
          <p className="small muted" style={{ margin: 0 }}>
            文件位置：<code>{data?.folder}</code>（video.mp4 / cover.png）
            {data?.exportHint ? <><br />{data.exportHint}</> : null}
          </p>
        </div>
      </div>
    </div>
  );
}
