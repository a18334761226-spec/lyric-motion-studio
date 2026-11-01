import { getSettings, llmProvider } from './settings';
import { addActivity } from '../db';

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface LlmResult<T> {
  data: T;
  provider: 'deepseek' | 'mock';
  model: string;
  /** DeepSeek 调用失败时的原因（此时 data 来自 mock） */
  warning?: string;
  usage?: LlmUsage;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepseekResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  const trimmed = text.trim();
  const candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(trimmed);
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      // 尝试修复常见问题：尾逗号
      try {
        const repaired = c.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(repaired) as T;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

async function chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number; json?: boolean; timeoutMs?: number } = {}): Promise<{
  content: string;
  usage?: LlmUsage;
}> {
  const s = getSettings();
  if (!s.deepseekApiKey) throw new Error('未配置 DeepSeek API Key');
  const url = `${s.deepseekBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${s.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: s.deepseekModel,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 4096,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: DeepseekResponse | null = null;
    try {
      body = JSON.parse(text) as DeepseekResponse;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const msg = body?.error?.message || text.slice(0, 300) || `HTTP ${res.status}`;
      throw new Error(`DeepSeek 请求失败 (${res.status}): ${msg}`);
    }
    const content = body?.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) throw new Error('DeepSeek 返回内容为空');
    return {
      content,
      usage: {
        promptTokens: body?.usage?.prompt_tokens,
        completionTokens: body?.usage?.completion_tokens,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface JsonTaskOptions<T> {
  system: string;
  user: string;
  fallback: () => T;
  validate?: (value: unknown) => T | null;
  temperature?: number;
  maxTokens?: number;
  /** 用于日志的可读名称 */
  label: string;
  projectId?: string;
}

/**
 * 调用 DeepSeek 并解析 JSON；未配置 Key、网络失败、JSON 非法时自动降级到本地 Mock。
 */
export async function llmJson<T>(opts: JsonTaskOptions<T>): Promise<LlmResult<T>> {
  const s = getSettings();
  const provider = llmProvider();
  if (provider === 'mock') {
    return { data: opts.fallback(), provider: 'mock', model: 'local-mock' };
  }
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { content, usage } = await chat(
        [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        { temperature: opts.temperature ?? 0.7, maxTokens: opts.maxTokens ?? 4096, json: true },
      );
      const parsed = extractJson(content);
      if (parsed === null) throw new Error('返回的 JSON 无法解析');
      const validated = opts.validate ? opts.validate(parsed) : (parsed as T);
      if (validated === null) throw new Error('返回 JSON 结构不符合预期');
      return { data: validated, provider: 'deepseek', model: s.deepseekModel, usage };
    } catch (err) {
      lastError = (err as Error).message || String(err);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  addActivity(opts.projectId ?? null, 'warn', `${opts.label} 调用 DeepSeek 失败，已降级本地引擎：${lastError.slice(0, 120)}`);
  return {
    data: opts.fallback(),
    provider: 'mock',
    model: 'local-mock',
    warning: lastError,
  };
}

export interface TextTaskOptions {
  system: string;
  user: string;
  fallback: () => string;
  temperature?: number;
  maxTokens?: number;
  label: string;
  projectId?: string;
}

export async function llmText(opts: TextTaskOptions): Promise<LlmResult<string>> {
  const s = getSettings();
  if (llmProvider() === 'mock') {
    return { data: opts.fallback(), provider: 'mock', model: 'local-mock' };
  }
  try {
    const { content, usage } = await chat(
      [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      { temperature: opts.temperature ?? 0.7, maxTokens: opts.maxTokens ?? 2000, json: false },
    );
    return { data: content.trim(), provider: 'deepseek', model: s.deepseekModel, usage };
  } catch (err) {
    const message = (err as Error).message || String(err);
    addActivity(opts.projectId ?? null, 'warn', `${opts.label} 调用 DeepSeek 失败，已降级本地引擎：${message.slice(0, 120)}`);
    return { data: opts.fallback(), provider: 'mock', model: 'local-mock', warning: message };
  }
}

/* ------------------------------------------------------------------ */
/* Function Calling：让模型直接调用画图函数                              */
/* ------------------------------------------------------------------ */

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolChatResult {
  content: string;
  toolCalls: ToolCallRequest[];
  model: string;
  provider: 'deepseek' | 'mock';
}

interface ToolCallMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/**
 * 调用 DeepSeek 的 chat/completions（带 tools）。
 * 模型会返回 tool_calls，由调用方执行真正的画图函数，再把结果回填给模型。
 */
export async function chatWithTools(
  messages: ToolCallMessage[],
  tools: ToolDefinition[],
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<ToolChatResult> {
  const s = getSettings();
  if (!s.deepseekApiKey) throw new Error('未配置 DeepSeek API Key');
  const url = `${s.deepseekBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.deepseekApiKey}` },
      body: JSON.stringify({
        model: s.deepseekModel,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 4096,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`DeepSeek tools 请求失败 ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: { id?: string; type?: 'function'; function?: { name?: string; arguments?: string } }[];
        };
      }[];
      error?: { message?: string };
    };
    const message = json.choices?.[0]?.message;
    if (!message) throw new Error(json.error?.message || 'DeepSeek 返回为空');
    const toolCalls: ToolCallRequest[] = [];
    for (const call of message.tool_calls ?? []) {
      const name = call.function?.name;
      if (!name) continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}') as Record<string, unknown>;
      } catch {
        args = {};
      }
      toolCalls.push({ id: call.id || `call_${toolCalls.length}`, name, arguments: args });
    }
    return { content: message.content ?? '', toolCalls, model: s.deepseekModel, provider: 'deepseek' };
  } finally {
    clearTimeout(timer);
  }
}

/** 连通性测试 */
export async function testDeepseek(): Promise<{ ok: boolean; latencyMs: number; message: string; detail?: string }> {  const s = getSettings();
  if (!s.deepseekApiKey) {
    return { ok: false, latencyMs: 0, message: '未配置 DeepSeek API Key', detail: '在设置页填入 Key 后即可启用真实模型' };
  }
  const started = Date.now();
  try {
    const { content } = await chat(
      [
        { role: 'system', content: '你是联通性测试助手，只输出 JSON。' },
        { role: 'user', content: '请只返回 {"ok":true} 这个 JSON，不要任何多余文字。' },
      ],
      { temperature: 0, maxTokens: 32, json: true, timeoutMs: 30000 },
    );
    const parsed = extractJson<{ ok?: boolean }>(content);
    return {
      ok: Boolean(parsed?.ok),
      latencyMs: Date.now() - started,
      message: parsed?.ok ? `连接成功 · ${s.deepseekModel}` : '返回内容异常',
      detail: content.slice(0, 160),
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, message: '连接失败', detail: (err as Error).message.slice(0, 300) };
  }
}
