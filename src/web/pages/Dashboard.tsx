import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Sparkles,
  Music4,
  Landmark,
  Wand2,
  ArrowRight,
  Play,
  Clock3,
  Film,
  Library as LibraryIcon,
  PlusCircle,
  Activity,
  Clapperboard,
  Flame,
  Zap,
} from 'lucide-react';
import type { DashboardStats, ProjectSummary } from '../../shared/types';
import { api, formatDuration, timeAgo } from '../api';
import { ProgressBar, SectionTitle, StatusBadge, EmptyState, Tag } from '../ui';

export function Dashboard() {
  const navigate = useNavigate();
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['stats'],
    queryFn: () => api.get<DashboardStats>('/stats'),
    refetchInterval: 8000,
  });
  const { data: projects } = useQuery<ProjectSummary[]>({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectSummary[]>('/projects'),
    refetchInterval: 12000,
  });

  const recent = useMemo(() => (projects?.length ? projects.slice(0, 6) : stats?.recentProjects ?? []), [projects, stats]);
  const runningProjects = useMemo(() => (projects ?? []).filter((p) => p.status === 'running'), [projects]);

  return (
    <div className="stagger">
      <section className="hero">
        <span className="hero-eyebrow">
          <Sparkles size={12} />
          DeepSeek × Edge-TTS × ffmpeg
        </span>
        <h2>
          把歌词、史料或一个想法，
          <br />
          变成一支<em>会呼吸的短片</em>。
        </h2>
        <p>
          AI 读懂内容与你的创作需求：歌词、口播稿、历史、主题都能做。自动补开场白、保留原文逐段成镜、LLM 逐镜绘制信息图画面、1.3 倍语速配音、自动生成海报封面与发布包，
          最后在本地用 ffmpeg 合成成片 —— 不需要任何剪辑基础。
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/new?type=lyrics')}>
            <PlusCircle size={17} />
            开始创作
          </button>
          <button className="btn btn-ghost btn-lg" onClick={() => navigate('/library')}>
            <LibraryIcon size={16} />
            逛逛歌词库
          </button>
        </div>

        <div className="hero-modes">
          <button className="mode-card" onClick={() => navigate('/new?type=lyrics')}>
            <span className="mode-icon lyrics">
              <Music4 size={18} />
            </span>
            <span>
              <strong>歌词成片</strong>
              <span>检索或粘贴 LRC 歌词，逐句配音、字幕与运镜</span>
            </span>
          </button>
          <button className="mode-card" onClick={() => navigate('/new?type=history')}>
            <span className="mode-icon history">
              <Landmark size={18} />
            </span>
            <span>
              <strong>历史 · 资料</strong>
              <span>联网检索史料，自动提炼时间线并拍成纪录片</span>
            </span>
          </button>
          <button className="mode-card" onClick={() => navigate('/new?type=idea')}>
            <span className="mode-icon idea">
              <Wand2 size={18} />
            </span>
            <span>
              <strong>口播稿 / 想法</strong>
              <span>一句话需求，AI 写脚本、配旁白、出画面</span>
            </span>
          </button>
        </div>
      </section>

      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <span className="stat-label">
            <Clapperboard size={13} /> 项目总数
          </span>
          <span className="stat-value">{stats?.projectCount ?? '—'}</span>
          <span className="stat-sub">含草稿与进行中</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Film size={13} /> 已成片
          </span>
          <span className="stat-value">{stats?.readyCount ?? '—'}</span>
          <span className="stat-sub">本地 MP4 可直接下载</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Clock3 size={13} /> 成片总时长
          </span>
          <span className="stat-value">
            {formatDuration(stats?.totalVideoSec)}
            <small>共</small>
          </span>
          <span className="stat-sub">已渲染视频累计</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Music4 size={13} /> 曲库 / 音色
          </span>
          <span className="stat-value">
            {stats?.songCount ?? '—'}
            <small>/ {stats?.voiceCount ?? '—'}</small>
          </span>
          <span className="stat-sub">内置原创示例 + Edge 音色</span>
        </div>
      </div>

      <div className="split">
        <div>
          {runningProjects.length ? (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <SectionTitle icon={<Activity size={16} />} count={runningProjects.length}>
                运行中的任务（全部）
              </SectionTitle>
              <div className="col" style={{ gap: 8 }}>
                {runningProjects.map((p) => (
                  <Link
                    key={p.id}
                    to={`/projects/${p.id}`}
                    className="row-between"
                    style={{ textDecoration: 'none', color: 'inherit', padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.04)' }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                    <span className="small muted">{p.stageProgress ?? 0}% →</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          <DailyPanel />

          <div className="row-between" style={{ marginBottom: 12 }}>
            <SectionTitle icon={<Clapperboard size={16} />} count={recent.length}>
              最近项目
            </SectionTitle>
            <Link to="/new" className="btn btn-ghost btn-sm">
              <PlusCircle size={13} />
              新建成片
            </Link>
          </div>

          {isLoading ? (
            <div className="project-grid">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="skeleton" style={{ aspectRatio: '16 / 9' }} />
                  <div style={{ padding: 14 }}>
                    <div className="skeleton" style={{ height: 14, width: '60%', marginBottom: 8 }} />
                    <div className="skeleton" style={{ height: 10, width: '40%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : recent.length ? (
            <div className="project-grid">
              {recent.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Clapperboard />}
              title="还没有项目"
              description="选一首歌词、一段历史，或者只写一句想法，AI 就能帮你把它拍成短片。"
              action={
                <button className="btn btn-primary" onClick={() => navigate('/new')}>
                  <Sparkles size={15} />
                  创建第一个成片
                </button>
              }
            />
          )}
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card card-pad">
            <SectionTitle icon={<Activity size={16} />}>运行状态</SectionTitle>
            <div className="col" style={{ gap: 8 }}>
              <div className="status-line">
                <span className={`dot ${stats?.llmProvider === 'deepseek' ? 'ok' : 'warn'}`} />
                文本模型
                <strong style={{ marginLeft: 'auto' }}>{stats?.llmProvider === 'deepseek' ? 'DeepSeek 在线' : '本地引擎（未配置 Key）'}</strong>
              </div>
              <div className="status-line">
                <span className={`dot ${stats?.imageProvider === 'api' ? 'ok' : 'warn'}`} />
                画面生成
                <strong style={{ marginLeft: 'auto' }}>{stats?.imageProvider === 'api' ? '生图 API' : 'LLM 逐镜绘制'}</strong>
              </div>
              <div className="status-line">
                <span className={`dot ${stats?.ffmpegReady ? 'ok' : 'off'}`} />
                渲染引擎
                <strong style={{ marginLeft: 'auto' }}>{stats?.ffmpegReady ? 'ffmpeg 就绪' : '未检测到 ffmpeg'}</strong>
              </div>
              <div className="status-line">
                <span className="dot ok" />
                联网检索
                <strong style={{ marginLeft: 'auto' }}>{stats?.researchProvider ?? 'Wikipedia / DDG / Bing'}</strong>
              </div>
            </div>
            <div className="divider" />
            <button className="btn btn-ghost btn-block" onClick={() => navigate('/settings')}>
              <Zap size={14} />
              接入真实模型与参数
            </button>
          </div>

          <div className="card card-pad">
            <SectionTitle icon={<Flame size={16} />}>动态</SectionTitle>
            {stats?.activity?.length ? (
              <div className="activity-list">
                {stats.activity.map((item) => (
                  <div className="activity-item" key={item.id}>
                    <span className={`activity-dot ${item.level}`} />
                    <span className="grow line-clamp-2">{item.message}</span>
                    <span className="activity-time">{timeAgo(item.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">还没有动态，创建一个项目试试。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DailyPanel() {
  const { data: topics } = useQuery<{ id: string; title: string; topic: string; angle: string }[]>({
    queryKey: ['daily-topics'],
    queryFn: () => api.get('/daily/topics'),
  });
  const { data: exports } = useQuery<{ name: string; hasVideo: boolean; at: number }[]>({
    queryKey: ['daily-exports'],
    queryFn: () => api.get('/daily/exports'),
    refetchInterval: 15000,
  });
  const [idx, setIdx] = useState(0);
  const [customTopic, setCustomTopic] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customScript, setCustomScript] = useState('');
  const [msg, setMsg] = useState('');
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setMsg('已启动，正在写文案并渲染…（约 6–10 分钟）');
    try {
      await api.post('/daily/run', {
        customTopic: customTopic.trim() || undefined,
        customTitle: customTitle.trim() || undefined,
        customScript: customScript.trim() || undefined,
        topicIndex: customTopic.trim() ? undefined : idx,
      });
    } catch {
      setMsg('启动失败，请检查服务端日志');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <SectionTitle icon={<Clapperboard size={16} />}>每日自动出片（抖音发布包）</SectionTitle>
      <p className="small muted" style={{ marginTop: 4 }}>
        选题可下拉选，也可以自己输入；还能直接粘贴整段口播稿（≥80 字就用你的稿，不再自动写）。
        程序自动建项目 → 渲染 → 导出发布包（成片 / 封面 / 标题 / 简介 / 话题）。
      </p>
      <div className="col" style={{ gap: 10, marginTop: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <select className="input" value={idx} onChange={(e) => setIdx(Number(e.target.value))} style={{ minWidth: 300, flex: 1 }} disabled={Boolean(customTopic.trim())}>
            {(topics ?? []).map((t, i) => (
              <option key={t.id} value={i}>
                {t.title} — {t.topic}
              </option>
            ))}
          </select>
          <input
            className="input"
            style={{ minWidth: 260, flex: 1 }}
            placeholder="或自定义选题，例如：康波周期第六轮"
            value={customTopic}
            onChange={(e) => setCustomTopic(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ minWidth: 220, flex: 1 }}
            placeholder="标题（可选，留空自动生成）"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
          />
          <button className="btn btn-primary" onClick={run} disabled={running}>
            <Flame size={14} />
            {running ? '启动中…' : '生成这条'}
          </button>
        </div>
        <textarea
          className="textarea"
          style={{ minHeight: 92 }}
          placeholder="（可选）直接粘贴完整口播稿：≥80 字就按你的稿出片；留空则按上面选题自动写稿"
          value={customScript}
          onChange={(e) => setCustomScript(e.target.value)}
        />
        {msg ? <span className="small muted">{msg}</span> : null}
      </div>
      {exports?.length ? (
        <div className="small muted" style={{ marginTop: 12 }}>
          最近发布包：
          {exports.slice(0, 5).map((e) => (
            <span key={e.name} style={{ marginLeft: 10 }}>
              {e.name}
              {e.hasVideo ? ' ✓' : ' ⏳'}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const sourceLabel = project.sourceType === 'lyrics' ? '歌词' : project.sourceType === 'history' ? '历史' : '创意';
  return (
    <Link to={`/projects/${project.id}`} className="card card-hover project-card">
      <div className="project-thumb">
        {project.coverUrl ? <img src={project.coverUrl} alt={project.title} loading="lazy" /> : null}
        <div className="project-thumb-top">
          <Tag brand>{sourceLabel}</Tag>
          <StatusBadge status={project.status} />
        </div>
        {project.videoUrl ? (
          <div className="project-thumb-play">
            <span className="play-orb">
              <Play size={20} />
            </span>
          </div>
        ) : null}
      </div>
      <div className="project-body">
        <h3>{project.title}</h3>
        <div className="project-meta">
          <span>{project.shotCount || project.segmentCount} 个镜头/段</span>
          <span className="sep" />
          <span>{formatDuration(project.duration)}</span>
          <span className="sep" />
          <span>{project.aspect}</span>
          <span style={{ marginLeft: 'auto' }}>{timeAgo(project.updatedAt)}</span>
        </div>
        <div className="project-foot">
          {project.status === 'running' ? (
            <>
              <div className="mini-progress">
                <ProgressBar value={project.stageProgress} thin />
              </div>
              <span className="small muted">{project.stageProgress}%</span>
            </>
          ) : (
            <>
              <span className="small muted grow line-clamp-2">{project.brief || '—'}</span>
              <ArrowRight size={14} style={{ color: 'var(--mist-600)' }} />
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
