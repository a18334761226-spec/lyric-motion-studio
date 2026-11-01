import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Cloud, Upload, Music4, Sparkles, ArrowRight, Loader2, Wand2, FileText } from 'lucide-react';
import type { Song, SongSearchResult } from '../../shared/types';
import { api, timeAgo } from '../api';
import { EmptyState, Field, Modal, SectionTitle, Spinner, Tag, useToast } from '../ui';

interface ParsedLine {
  time: string;
  text: string;
}

function parseLrcPreview(lrc: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const match = raw.match(/^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (match) {
      const text = (match[4] || '').trim();
      if (text) lines.push({ time: `${match[1]}:${match[2]}`, text });
    }
  }
  return lines;
}

export function Library() {
  const navigate = useNavigate();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [online, setOnline] = useState(true);
  const [selected, setSelected] = useState<Song | null>(null);
  const [songLines, setSongLines] = useState<ParsedLine[]>([]);
  const [loadingSong, setLoadingSong] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importForm, setImportForm] = useState({ title: '', artist: '', raw: '' });
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 380);
    return () => window.clearTimeout(timer);
  }, [query]);

  const { data, isFetching, refetch } = useQuery<SongSearchResult>({
    queryKey: ['lyrics-search', debounced, online],
    queryFn: () => api.get<SongSearchResult>(`/lyrics/search?q=${encodeURIComponent(debounced)}&online=${online}`),
    staleTime: 20000,
  });

  const songs = useMemo(() => data?.songs ?? [], [data]);

  async function openSong(song: Song) {
    setSelected(song);
    setSongLines(parseLrcPreview(song.lrc));
    if (!song.lrc) {
      setLoadingSong(true);
      try {
        const result = await api.get<{ song?: Song; error?: string }>(`/lyrics/song/${encodeURIComponent(song.id)}`);
        if (result.song) {
          setSelected(result.song);
          setSongLines(parseLrcPreview(result.song.lrc));
        }
        if (result.error) toast.error(result.error);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setLoadingSong(false);
      }
    }
  }

  async function importLyrics() {
    if (!importForm.raw.trim()) {
      toast.error('请粘贴歌词文本或 LRC');
      return;
    }
    setImporting(true);
    try {
      const song = await api.post<Song>('/lyrics/import', importForm);
      toast.success(`已导入「${song.title}」，共 ${song.lineCount} 句`);
      setImportOpen(false);
      setImportForm({ title: '', artist: '', raw: '' });
      await refetch();
      void openSong(song);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>
            <Music4 size={22} style={{ color: 'var(--brand-400)' }} />
            歌词库
          </h2>
          <p>内置 8 首原创示例曲目，支持在线检索与 LRC 导入。选中歌词后可以裁切段落，直接进入成片流水线。</p>
        </div>
        <button className="btn btn-ghost" onClick={() => setImportOpen(true)}>
          <Upload size={15} />
          粘贴 / 导入歌词
        </button>
      </div>

      <div className="search-hero">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索歌名、歌手、标签，或任何歌词片段…"
          autoFocus
        />
        {isFetching ? <Loader2 size={15} className="spin" style={{ color: 'var(--brand-400)' }} /> : null}
        <button className={`chip ${online ? 'active' : ''}`} onClick={() => setOnline((v) => !v)} title="在线检索来自网易云公开接口，失败会自动降级">
          <Cloud size={13} />
          在线检索 {online ? '开' : '关'}
        </button>
      </div>

      {data?.notice ? (
        <div className="status-line" style={{ marginBottom: 14 }}>
          <Cloud size={14} style={{ color: 'var(--amber-400)' }} />
          {data.notice}
        </div>
      ) : null}

      <div className="row-between" style={{ marginBottom: 12 }}>
        <SectionTitle icon={<FileText size={16} />} count={songs.length}>
          {debounced ? `“${debounced}” 的结果` : '全部歌词'}
        </SectionTitle>
        <span className="small muted">{data?.source ?? '本地曲库'}</span>
      </div>

      {isFetching && !songs.length ? (
        <div className="song-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card skeleton" style={{ height: 168 }} />
          ))}
        </div>
      ) : songs.length ? (
        <div className="song-grid stagger">
          {songs.map((song) => (
            <button
              key={song.id}
              className="card card-hover song-card"
              onClick={() => void openSong(song)}
              style={{ textAlign: 'left' }}
            >
              <div className="song-head">
                <span className="song-avatar">{song.title.slice(0, 1)}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="song-title">{song.title}</div>
                  <div className="song-artist">
                    {song.artist}
                    {song.album ? ` · ${song.album}` : ''}
                  </div>
                </div>
                {song.lineCount ? <span className="badge badge-live">{song.lineCount} 句</span> : <span className="badge badge-mock">未加载</span>}
              </div>
              <div className="song-excerpt">{song.excerpt || '暂无歌词预览'}</div>
              <div className="song-foot">
                {song.tags.slice(0, 3).map((tag) => (
                  <Tag key={tag} brand={tag === '在线'}>
                    {tag}
                  </Tag>
                ))}
                <span className="small muted" style={{ marginLeft: 'auto' }}>
                  {song.sourceLabel ?? '本地'}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Search />}
          title="没有找到匹配的歌词"
          description="换个关键词，或者直接粘贴一段 LRC 歌词导入曲库。"
          action={
            <button className="btn btn-primary" onClick={() => setImportOpen(true)}>
              <Upload size={15} />
              导入歌词
            </button>
          }
        />
      )}

      <Modal
        open={Boolean(selected)}
        title={selected?.title ?? ''}
        description={selected ? `${selected.artist} · ${selected.sourceLabel ?? '本地曲库'} · 共 ${songLines.length} 句` : ''}
        onClose={() => setSelected(null)}
        wide
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setSelected(null)}>
              关闭
            </button>
            <button
              className="btn btn-primary"
              disabled={!selected || !songLines.length}
              onClick={() => {
                if (selected) navigate(`/new?type=lyrics&songId=${encodeURIComponent(selected.id)}`);
              }}
            >
              <Sparkles size={15} />
              用它创建成片
              <ArrowRight size={14} />
            </button>
          </>
        }
      >
        {loadingSong ? <Spinner label="正在从在线曲库加载歌词…" /> : null}
        {songLines.length ? (
          <div className="segment-list" style={{ maxHeight: 460 }}>
            {songLines.map((line, index) => (
              <div className="segment-row" key={`${line.time}-${index}`}>
                <span className="segment-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="segment-text">{line.text}</span>
                <span className="segment-time">{line.time}</span>
              </div>
            ))}
          </div>
        ) : (
          !loadingSong && <div className="empty">这首歌暂时没有可用歌词</div>
        )}
      </Modal>

      <Modal
        open={importOpen}
        title="导入歌词"
        description="支持标准 LRC（带时间轴）或纯文本；纯文本会按每行约 4 秒估算时间轴。"
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setImportOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void importLyrics()} disabled={importing}>
              {importing ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />}
              解析并导入
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="歌名" hint="可留空，自动取首行">
            <input className="input" value={importForm.title} onChange={(e) => setImportForm({ ...importForm, title: e.target.value })} />
          </Field>
          <Field label="歌手 / 来源">
            <input className="input" value={importForm.artist} onChange={(e) => setImportForm({ ...importForm, artist: e.target.value })} />
          </Field>
          <Field label="歌词内容" className="span-2" hint="LRC 或纯文本">
            <textarea
              className="textarea"
              style={{ minHeight: 240 }}
              value={importForm.raw}
              onChange={(e) => setImportForm({ ...importForm, raw: e.target.value })}
              placeholder={'[00:12.00]雨在玻璃上写没说完的话\n[00:17.50]路灯把影子拉成一把吉他\n…'}
            />
          </Field>
        </div>
      </Modal>

      <p className="small muted" style={{ marginTop: 18 }}>
        曲库中的示例歌词均为本项目原创，可自由使用；在线检索走网易云音乐公开接口，仅用于个人学习与创作，若失效请使用导入功能。
      </p>
      <span className="hidden">{timeAgo(Date.now())}</span>
    </div>
  );
}
