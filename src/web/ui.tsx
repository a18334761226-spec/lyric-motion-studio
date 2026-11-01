import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X, Play, Pause, Copy, Check, Loader2, Inbox } from 'lucide-react';
import type { ProjectStatus } from '../shared/types';
import { copyText } from './api';

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

type ToastLevel = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  level: ToastLevel;
  message: string;
}
interface ToastApi {
  push: (level: ToastLevel, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (level: ToastLevel, message: string) => {
      counter.current += 1;
      const id = counter.current;
      setItems((prev) => [...prev.slice(-3), { id, level, message }]);
      window.setTimeout(() => remove(id), level === 'error' ? 7000 : 4200);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack">
        {items.map((item) => (
          <div key={item.id} className={`toast ${item.level}`}>
            {item.level === 'success' ? <CheckCircle2 /> : item.level === 'error' ? <AlertCircle /> : <Info />}
            <div className="grow">{item.message}</div>
            <button className="toast-close" onClick={() => remove(item.id)} aria-label="关闭">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

/* ------------------------------------------------------------------ */
/* 基础展示组件                                                        */
/* ------------------------------------------------------------------ */

export function ProgressBar({ value, tone = 'default', thin = false }: { value: number; tone?: 'default' | 'done' | 'failed'; thin?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`progress ${thin ? 'thin' : ''}`}>
      <i className={tone === 'done' ? 'done' : tone === 'failed' ? 'failed' : ''} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const map: Record<ProjectStatus, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'badge-draft' },
    running: { label: '生成中', cls: 'badge-running' },
    ready: { label: '已成片', cls: 'badge-ready' },
    error: { label: '失败', cls: 'badge-error' },
  };
  const item = map[status] ?? map.draft;
  return (
    <span className={`badge ${item.cls}`}>
      <span className={`dot ${status === 'running' ? 'warn' : status === 'ready' ? 'ok' : status === 'error' ? 'off' : 'off'}`} />
      {item.label}
    </span>
  );
}

export function ProviderBadge({ provider, model }: { provider?: 'deepseek' | 'mock' | 'api'; model?: string }) {
  if (!provider) return null;
  if (provider === 'deepseek' || provider === 'api') {
    return <span className="badge badge-live">DeepSeek · {model || 'live'}</span>;
  }
  return <span className="badge badge-mock">本地引擎</span>;
}

export function Field({ label, hint, help, children, className }: { label: string; hint?: string; help?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label>
        {label}
        {hint ? <span className="hint">{hint}</span> : null}
      </label>
      {children}
      {help ? <div className="field-help">{help}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button key={option.value} type="button" className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? '切换'}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      {icon ?? <Inbox />}
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row small muted" style={{ gap: 6 }}>
      <Loader2 size={13} className="spin" />
      {label ?? '加载中…'}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal card ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="grow">
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        {children ? <div className="modal-body">{children}</div> : null}
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 交互小件                                                            */
/* ------------------------------------------------------------------ */

export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        const ok = await copyText(text);
        if (ok) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? '已复制' : label}
    </button>
  );
}

export function AudioButton({ src, label, duration }: { src?: string; label?: string; duration?: number }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  if (!src) return null;
  return (
    <button
      type="button"
      className="audio-chip"
      onClick={() => {
        if (!audioRef.current) {
          audioRef.current = new Audio(src);
          audioRef.current.onended = () => setPlaying(false);
          audioRef.current.onerror = () => setPlaying(false);
        }
        if (playing) {
          audioRef.current.pause();
          setPlaying(false);
        } else {
          void audioRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        }
      }}
      title={label ?? '播放'}
    >
      {playing ? <Pause size={12} /> : <Play size={12} />}
      {label ?? (duration ? `${duration.toFixed(1)}s` : '试听')}
    </button>
  );
}

export function Equalizer({ active }: { active: boolean }) {
  const bars = [7, 12, 17, 11, 16, 9];
  return (
    <span className="eq" aria-hidden>
      {bars.map((height, index) => (
        <i
          key={index}
          style={{
            height,
            animationDelay: `${index * 0.12}s`,
            animationPlayState: active ? 'running' : 'paused',
            opacity: active ? 1 : 0.45,
          }}
        />
      ))}
    </span>
  );
}

export function Tag({ children, brand }: { children: React.ReactNode; brand?: boolean }) {
  return <span className={`tag ${brand ? 'brand' : ''}`}>{children}</span>;
}

export function SectionTitle({ icon, children, count }: { icon: React.ReactNode; children: React.ReactNode; count?: number }) {
  return (
    <div className="section-title">
      {icon}
      {children}
      {typeof count === 'number' ? <span className="count">{count}</span> : null}
    </div>
  );
}
