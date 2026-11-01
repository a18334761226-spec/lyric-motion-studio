import { Link, NavLink, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  PlusCircle,
  Library,
  FlaskConical,
  Settings2,
  Music4,
  Sparkles,
  Clapperboard,
  Cpu,
  FileAudio,
} from 'lucide-react';
import type { DashboardStats, ProjectSummary } from '../shared/types';
import { api } from './api';
import { Equalizer } from './ui';

const NAV = [
  { to: '/', label: '控制台', icon: LayoutDashboard, end: true },
  { to: '/new', label: '新建成片', icon: PlusCircle },
  { to: '/library', label: '歌词库', icon: Library },
  { to: '/prompt', label: '提示词实验室', icon: FlaskConical },
  { to: '/settings', label: '设置', icon: Settings2 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['stats'],
    queryFn: () => api.get<DashboardStats>('/stats'),
    refetchInterval: 15000,
  });
  const { data: projects } = useQuery<ProjectSummary[]>({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectSummary[]>('/projects'),
    refetchInterval: 8000,
  });
  const runningProjects = (projects ?? []).filter((p) => p.status === 'running');
  const runningCount = runningProjects.length || stats?.runningCount || 0;
  const [showTasks, setShowTasks] = useState(false);
  const activeProject = location.pathname.startsWith('/projects/');
  const lastProject = (projects ?? [])[0];
  const workspaceTarget = activeProject ? location.pathname : lastProject ? `/projects/${lastProject.id}` : '/new';

  return (
    <div className="app">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">
            <Music4 size={21} />
          </span>
          <span className="brand-text">
            <strong>Lyric Motion</strong>
            <span>Studio</span>
          </span>
        </NavLink>

        <nav className="nav">
          <div className="nav-label">工作台</div>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <item.icon />
              <span>{item.label}</span>
            </NavLink>
          ))}
          {lastProject || activeProject ? (
            <NavLink to={workspaceTarget} className={() => `nav-item ${activeProject ? 'active' : ''}`}>
              <Clapperboard />
              <span>项目工作区</span>
            </NavLink>
          ) : null}
        </nav>

        <div className="sidebar-footer">
          <div className="provider-card">
            <div className="provider-row">
              <span className={`dot ${stats?.llmProvider === 'deepseek' ? 'ok' : 'warn'}`} />
              文本模型
              <strong>{stats?.llmProvider === 'deepseek' ? 'DeepSeek' : '本地引擎'}</strong>
            </div>
            <div className="provider-row">
              <span className={`dot ${stats?.imageProvider === 'api' ? 'ok' : 'warn'}`} />
              画面生成
              <strong>{stats?.imageProvider === 'api' ? '生图 API' : 'LLM 逐镜'}</strong>
            </div>
            <div className="provider-row">
              <span className={`dot ${stats?.ffmpegReady ? 'ok' : 'off'}`} />
              渲染引擎
              <strong>{stats?.ffmpegReady ? 'ffmpeg' : '不可用'}</strong>
            </div>
            <div className="provider-row">
              <FileAudio size={12} />
              配音引擎
              <strong>Edge-TTS</strong>
            </div>
          </div>
          <div className="sidebar-tip">
            <b>提示</b>：不填 Key 也能跑通全流程 —— 会用本地引擎生成文案与画面，随时可在设置页接入真实模型。
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>
              {titleOf(location.pathname)}
              {runningCount ? (
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <button
                    className="badge badge-running"
                    style={{ border: 'none', cursor: 'pointer' }}
                    onClick={() => setShowTasks((v) => !v)}
                    title="查看全部运行中任务"
                  >
                    <Equalizer active />
                    {runningCount} 个任务运行中 · 查看
                  </button>
                  {showTasks ? (
                    <div
                      className="card card-pad"
                      style={{ position: 'absolute', top: '140%', left: 0, zIndex: 50, width: 340, gap: 8, display: 'flex', flexDirection: 'column' }}
                    >
                      <strong style={{ fontSize: 13 }}>运行中的任务</strong>
                      {runningProjects.map((p) => (
                        <Link
                          key={p.id}
                          to={`/projects/${p.id}`}
                          className="row-between"
                          style={{ textDecoration: 'none', color: 'inherit', padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.04)' }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{p.title}</span>
                          <span className="small muted">{p.stageProgress ?? 0}%</span>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </span>
              ) : null}
            </h1>
            <p>{subtitleOf(location.pathname)}</p>
          </div>
          <div className="topbar-actions">
            <span className="pill">
              <Sparkles size={13} />
              {stats?.llmProvider === 'deepseek' ? 'DeepSeek 驱动' : '本地引擎兜底'}
            </span>
            <span className="pill">
              <Cpu size={13} />
              本地渲染
            </span>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function titleOf(pathname: string): string {
  if (pathname.startsWith('/projects/')) return '项目工作区';
  if (pathname.startsWith('/new')) return '新建成片';
  if (pathname.startsWith('/library')) return '歌词库';
  if (pathname.startsWith('/prompt')) return '提示词实验室';
  if (pathname.startsWith('/settings')) return '设置';
  return '控制台';
}

function subtitleOf(pathname: string): string {
  if (pathname.startsWith('/projects/')) return '素材 · 研究 · 分镜 · 配音 · 音乐 · 成片';
  if (pathname.startsWith('/new')) return '歌词、史料或一个想法，都可以变成一支短片';
  if (pathname.startsWith('/library')) return '检索、导入并解析歌词，直接开成片';
  if (pathname.startsWith('/prompt')) return '把粗略想法扩写成专业级生图提示词';
  if (pathname.startsWith('/settings')) return '模型密钥、联网检索与渲染参数';
  return 'AI 成片工作台';
}
