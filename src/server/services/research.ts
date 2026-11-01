import type { ResearchBundle, ResearchFact, ResearchSource, ResearchTimelineItem } from '../../shared/types';
import { getSettings } from './settings';
import { llmJson } from './llm';
import { mockResearchSummary } from './mock';
import { researchSummaryMessages, researchQueryMessages } from './prompts';
import { extractJson } from './llm';
import { cleanExtractedText, normalizeSourceTitle, traditionalRatio } from './text';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type ResearchProvider = 'wikipedia' | 'duckduckgo' | 'bing';

const PROVIDER_LABEL: Record<ResearchProvider, string> = {
  wikipedia: '维基百科',
  duckduckgo: 'DuckDuckGo',
  bing: 'Bing',
};

async function fetchText(url: string, timeoutMs = 15000, extraHeaders: Record<string, string> = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': UA,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        ...extraHeaders,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function makeSource(partial: Omit<ResearchSource, 'id' | 'fetchedAt' | 'domain'> & { domain?: string }): ResearchSource {
  return {
    id: `src_${Math.random().toString(36).slice(2, 8)}`,
    domain: partial.domain || domainOf(partial.url),
    fetchedAt: Date.now(),
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* 各检索通道                                                          */
/* ------------------------------------------------------------------ */

async function searchWikipedia(query: string, limit = 4): Promise<ResearchSource[]> {
  const base = 'https://zh.wikipedia.org/w/api.php';
  const searchUrl = `${base}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&utf8=1&srprop=snippet`;
  const raw = await fetchText(searchUrl, 15000, { accept: 'application/json' });
  const json = JSON.parse(raw) as {
    query?: { search?: { pageid: number; title: string; snippet?: string }[] };
  };
  const hits = json.query?.search ?? [];
  if (!hits.length) return [];
  const pageIds = hits.slice(0, 3).map((h) => h.pageid).join('|');
  let extracts: Record<string, string> = {};
  try {
    const extractUrl = `${base}?action=query&prop=extracts&explaintext=1&exintro=1&pageids=${pageIds}&format=json&utf8=1`;
    const extractRaw = await fetchText(extractUrl, 15000, { accept: 'application/json' });
    const extractJson = JSON.parse(extractRaw) as { query?: { pages?: Record<string, { extract?: string }> } };
    extracts = Object.fromEntries(
      Object.entries(extractJson.query?.pages ?? {}).map(([id, page]) => [id, page.extract ?? '']),
    );
  } catch {
    /* 摘要接口失败时用搜索片段 */
  }
  return hits.map((h) =>
    makeSource({
      title: h.title,
      url: `https://zh.wikipedia.org/?curid=${h.pageid}`,
      snippet: (extracts[String(h.pageid)] || stripTags(h.snippet || '')).slice(0, 900),
      provider: 'wikipedia',
      domain: 'zh.wikipedia.org',
    }),
  );
}

async function searchDuckDuckGo(query: string, limit = 5): Promise<ResearchSource[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=cn-zh`;
  const html = await fetchText(url);
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const links: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && links.length < limit) {
    let href = decodeEntities(m[1]);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith('//')) href = `https:${href}`;
    if (!/^https?:\/\//.test(href)) continue;
    links.push({ url: href, title: stripTags(m[2]) });
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < limit) {
    snippets.push(stripTags(m[1]));
  }
  return links.map((l, i) =>
    makeSource({
      title: l.title || l.url,
      url: l.url,
      snippet: snippets[i] || l.title,
      provider: 'duckduckgo',
    }),
  );
}

async function searchBing(query: string, limit = 5): Promise<ResearchSource[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&cc=CN`;
  const html = await fetchText(url, 18000, { 'accept-language': 'zh-CN,zh;q=0.9' });
  const blockRe = /<li class="b_algo"[\s\S]*?<\/li>/g;
  const out: ResearchSource[] = [];
  const blocks = html.match(blockRe) || [];
  for (const block of blocks.slice(0, limit)) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const href = decodeEntities(link[1]);
    if (!/^https?:\/\//.test(href)) continue;
    const title = stripTags(link[2]);
    const para = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = para ? stripTags(para[1]) : title;
    out.push(makeSource({ title, url: href, snippet, provider: 'bing' }));
  }
  return out;
}

const PROVIDER_FN: Record<ResearchProvider, (q: string) => Promise<ResearchSource[]>> = {
  wikipedia: searchWikipedia,
  duckduckgo: searchDuckDuckGo,
  bing: searchBing,
};

/* ------------------------------------------------------------------ */
/* 检索编排                                                            */
/* ------------------------------------------------------------------ */

export interface ResearchOptions {
  topic: string;
  era?: string;
  extraQueries?: string[];
  maxSources?: number;
  providers?: ResearchProvider[];
}

export async function testProviders(): Promise<Record<string, { ok: boolean; latencyMs: number; message: string; count: number }>> {
  const result: Record<string, { ok: boolean; latencyMs: number; message: string; count: number }> = {};
  await Promise.all(
    (Object.keys(PROVIDER_FN) as ResearchProvider[]).map(async (provider) => {
      const started = Date.now();
      try {
        const sources = await PROVIDER_FN[provider]('长江 历史');
        result[provider] = {
          ok: sources.length > 0,
          latencyMs: Date.now() - started,
          message: sources.length ? `${PROVIDER_LABEL[provider]} 可用（${sources.length} 条）` : '返回空结果',
          count: sources.length,
        };
      } catch (err) {
        result[provider] = {
          ok: false,
          latencyMs: Date.now() - started,
          message: `${PROVIDER_LABEL[provider]} 不可用：${(err as Error).message.slice(0, 80)}`,
          count: 0,
        };
      }
    }),
  );
  return result;
}

export async function researchTopic(opts: ResearchOptions): Promise<ResearchBundle> {
  const settings = getSettings();
  const topic = opts.topic.trim();
  const providers = (opts.providers?.length ? opts.providers : settings.researchProviders).filter(Boolean) as ResearchProvider[];
  const notices: string[] = [];
  if (!providers.length) {
    return {
      query: topic,
      queries: [],
      provider: 'none',
      sources: [],
      summary: '',
      facts: [],
      timeline: [],
      notices: ['未启用任何联网检索通道，可在设置页开启。你也可以直接粘贴史料文本。'],
      searchedAt: Date.now(),
    };
  }

  // 1. 生成检索词
  const queryTask = await llmJson<{ queries: string[] }>({
    ...researchQueryMessages(topic, opts.era || ''),
    label: '检索词生成',
    fallback: () => ({
      queries: [topic, `${topic} 历史背景`, `${topic} 时间线 年表`, `${topic} 关键人物 影响`],
    }),
    validate: (value) => {
      const v = value as { queries?: unknown };
      if (!Array.isArray(v.queries)) return null;
      const queries = v.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
      return queries.length ? { queries: queries.slice(0, 5) } : null;
    },
    temperature: 0.3,
    maxTokens: 400,
  });

  const queries = [...new Set([...queryTask.data.queries, ...(opts.extraQueries ?? [])])].slice(0, 5);

  // 2. 多通道并行检索
  const tasks: { provider: ResearchProvider; query: string; promise: Promise<ResearchSource[]> }[] = [];
  for (const provider of providers) {
    for (const query of queries) {
      tasks.push({ provider, query, promise: PROVIDER_FN[provider](query).catch((err: Error) => {
        notices.push(`${PROVIDER_LABEL[provider]} 检索失败：${err.message.slice(0, 80)}`);
        return [] as ResearchSource[];
      }) });
    }
  }
  const results = await Promise.all(tasks.map((t) => t.promise));
  const all: ResearchSource[] = [];
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  for (const list of results) {
    for (const src of list) {
      const key = src.url.replace(/[#?].*$/, '');
      if (seenUrl.has(key)) continue;
      const titleKey = `${src.domain}|${normalizeSourceTitle(src.title)}`;
      if (seenTitle.has(titleKey)) continue;
      const snippet = cleanExtractedText(src.snippet);
      if (snippet.replace(/\s/g, '').length < 20) continue;
      // 简繁混排时优先简体来源，避免同一事件重复出现
      if (traditionalRatio(snippet) > 0.12) continue;
      seenUrl.add(key);
      seenTitle.add(titleKey);
      all.push({ ...src, snippet });
    }
  }
  // 维基百科优先（更权威），其次按摘要长度
  all.sort((a, b) => {
    const score = (s: ResearchSource) => (s.provider === 'wikipedia' ? 1000 : 0) + Math.min(600, s.snippet.length);
    return score(b) - score(a);
  });
  const sources = all.slice(0, opts.maxSources ?? 10);

  if (!sources.length) {
    notices.push('所有检索通道均未返回有效结果，请更换关键词，或直接粘贴史料文本。');
    return {
      query: topic,
      queries,
      provider: providers.join('+'),
      sources: [],
      summary: '',
      facts: [],
      timeline: [],
      notices,
      searchedAt: Date.now(),
    };
  }

  // 3. 事实提炼
  const indexed = sources.map((s, i) => ({ id: `s${i + 1}`, title: s.title, url: s.url, snippet: s.snippet }));
  const idMap = new Map(indexed.map((s) => [s.id, s]));
  const summaryTask = await llmJson<{ summary: string; timeline: ResearchTimelineItem[]; facts: ResearchFact[] }>({
    ...researchSummaryMessages(topic, opts.era || '', indexed),
    label: '史料提炼',
    fallback: () => mockResearchSummary(topic, indexed),
    validate: (value) => {
      const v = value as { summary?: unknown; timeline?: unknown; facts?: unknown };
      if (typeof v.summary !== 'string' || !v.summary.trim()) return null;
      const timeline = Array.isArray(v.timeline)
        ? v.timeline.filter(
            (t): t is ResearchTimelineItem =>
              Boolean(t) && typeof (t as ResearchTimelineItem).year === 'string' && typeof (t as ResearchTimelineItem).event === 'string',
          )
        : [];
      const facts = Array.isArray(v.facts)
        ? v.facts.filter((f): f is ResearchFact => Boolean(f) && typeof (f as ResearchFact).claim === 'string')
        : [];
      return {
        summary: v.summary,
        timeline: timeline.slice(0, 10).map((t) => ({ ...t, sourceIds: (t.sourceIds ?? []).filter((id) => idMap.has(id)) })),
        facts: facts.slice(0, 12).map((f) => ({ ...f, sourceIds: (f.sourceIds ?? []).filter((id) => idMap.has(id)) })),
      };
    },
    temperature: 0.4,
    maxTokens: 2600,
  });

  const bundle: ResearchBundle = {
    query: topic,
    queries,
    provider: providers.join('+'),
    sources,
    summary: summaryTask.data.summary,
    facts: summaryTask.data.facts,
    timeline: summaryTask.data.timeline,
    notices,
    searchedAt: Date.now(),
    model: summaryTask.provider === 'deepseek' ? summaryTask.model : 'local-mock',
  };
  return bundle;
}

/** 供设置页使用：单通道连通性测试 */
export async function quickProviderProbe(): Promise<{ ok: boolean; message: string; detail?: string }> {
  try {
    const sources = await searchWikipedia('中国历史');
    if (sources.length) return { ok: true, message: `联网检索可用（${sources.length} 条）`, detail: sources[0].title };
    return { ok: false, message: '检索返回空结果' };
  } catch (err) {
    return { ok: false, message: '联网检索不可用', detail: (err as Error).message.slice(0, 200) };
  }
}

export { extractJson };
