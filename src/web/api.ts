import type { PipelineEvent } from '../shared/types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof Blob ? {} : { 'content-type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload && String((payload as { error: unknown }).error)) ||
      `请求失败 (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, blob: Blob) =>
    request<T>(path, { method: 'POST', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream' } }),
};

/** 订阅项目流水线 SSE，返回取消函数 */
export function subscribeProject(projectId: string, onEvent: (event: PipelineEvent) => void): () => void {
  const source = new EventSource(`/api/projects/${projectId}/events`);
  const handler = (raw: MessageEvent) => {
    try {
      const event = JSON.parse(raw.data) as PipelineEvent;
      onEvent(event);
    } catch {
      /* ignore malformed */
    }
  };
  ['snapshot', 'stage', 'progress', 'log', 'shot', 'done', 'error', 'cancelled'].forEach((name) => {
    source.addEventListener(name, handler as EventListener);
  });
  source.onerror = () => {
    // 浏览器会自动重连，这里不关闭
  };
  return () => source.close();
}

/* --------------------------- 小工具 --------------------------- */

export function formatDuration(sec?: number | null): string {
  if (sec === undefined || sec === null || !Number.isFinite(sec) || sec < 0) return '—';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
