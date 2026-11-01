import type {
  ContentAnalysis,
  MusicInstrument,
  MusicSpec,
  Project,
  PromptOptimizeResult,
  ResearchBundle,
  ResearchFact,
  ResearchTimelineItem,
  Shot,
  Storyboard,
  StylePreset,
} from '../../shared/types';
import { DENSITY_SHOT_SEC } from '../../shared/presets';
import { buildShotVisual, summarizeVisuals } from './visualLexicon';
import { clamp, cleanExtractedText, extractKeywords, hashString, mulberry32, pick, splitForSubtitle, splitSentences } from './text';

const QUALITY_TOKENS =
  'cinematic lighting, ultra detailed, 35mm film grain, shallow depth of field, high dynamic range, award winning photography, 8k, masterpiece';
const DEFAULT_NEGATIVE =
  'text, watermark, logo, signature, lowres, blurry, jpeg artifacts, oversaturated, deformed, extra limbs, bad anatomy, cluttered composition, flat lighting';

const DEFAULT_IMAGERY = [
  '空旷的地平线',
  '逆光剪影',
  '斑驳的墙面与浮尘',
  '缓慢流动的云层',
  '一盏孤灯',
  '被风吹动的衣角',
  '倒映在积水里的城市',
  '握紧的手',
];

export function mockAnalysis(project: Project, preset: StylePreset): ContentAnalysis {
  const text = project.segments.map((s) => s.text).join('\n');
  const keywords = extractKeywords(text, 8);
  if (!keywords.length) keywords.push(project.source.title);
  const rand = mulberry32(hashString(project.id + project.source.title));
  const visuals = summarizeVisuals(
    project.segments.map((s) => s.text),
    preset,
  );
  const imagery = visuals.imagery.length
    ? visuals.imagery
    : [...preset.descriptors.slice(0, 3), ...DEFAULT_IMAGERY.slice(0, 5)].slice(0, 7);
  const segments = project.segments.length;
  const sectionCount = clamp(Math.ceil(segments / 4), 2, 4);
  const labels = ['开篇', '展开', '转折', '收束'].slice(0, sectionCount);
  const per = Math.ceil(segments / sectionCount);
  const sections = labels.map((label, i) => ({
    label,
    segStart: i * per + 1,
    segEnd: Math.min(segments, (i + 1) * per),
    mood: label === '转折' ? '张力上升' : label === '收束' ? '余韵' : preset.moodWords[i % preset.moodWords.length] || '平稳',
  }));
  const research = project.source.research;
  const script = project.source.type === 'lyrics' ? undefined : buildMockScript(project, keywords, research);
  return {
    theme: `关于${keywords.slice(0, 2).join('与')}的${project.source.type === 'history' ? '历史叙事' : project.source.type === 'lyrics' ? '情绪切片' : '影像短片'}`,
    logline: project.source.type === 'history'
      ? `用${sections.length}个段落重述${project.source.topic || project.source.title}的关键时刻。`
      : `跟随${keywords[0] || '主角'}，在${keywords[1] || '夜色'}里走完一段${preset.moodWords[0] || '克制'}的旅程。`,
    mood: (preset.moodWords[0] || '克制') + ' · ' + (preset.moodWords[1] || '流动'),
    emotions: [...preset.moodWords, '留白', '呼吸感'].slice(0, 5),
    keywords,
    imagery,
    colorStory: visuals.colorStory.length ? visuals.colorStory : preset.palette.map((hex, i) => `${['冷', '中', '暖'][i] || '中'}调 ${hex}`),
    sections,
    timeline: research?.timeline,
    keyFacts: research?.facts,
    script,
    directorNotes: [
      `镜头语言以${preset.motion.slice(0, 2).join(' / ')}为主，保持整片运镜克制。`,
      project.requirements.brief
        ? `优先满足用户需求：${project.requirements.brief.slice(0, 60)}`
        : '以画面叙事为主，字幕只保留必要信息。',
      `色彩围绕主色 ${preset.palette[1]} 展开，避免高饱和冲突。`,
      project.requirements.avoid.length ? `需规避：${project.requirements.avoid.join('、')}` : '避免出现文字、水印与现代物件（历史题材）。',
    ],
    provider: 'mock',
    model: 'local-mock',
  };
}

export function mockStoryboard(project: Project, preset: StylePreset): Storyboard {
  const analysis = project.analysis ?? mockAnalysis(project, preset);
  const rand = mulberry32(hashString(project.id + 'storyboard'));
  const segments = project.segments;
  const total = segments.length || 1;
  const density = project.requirements.sceneDensity;
  const [minShotSec, maxShotSec] = DENSITY_SHOT_SEC[density] ?? DENSITY_SHOT_SEC.auto;

  let shotCount: number;
  if (project.requirements.targetDurationSec > 0) {
    const avg = (minShotSec + maxShotSec) / 2;
    shotCount = Math.round(project.requirements.targetDurationSec / avg);
  } else if (project.source.type === 'lyrics') {
    shotCount = Math.round(total / 1.7);
  } else {
    const avgSegChar = segments.reduce((a, s) => a + s.text.length, 0) / total;
    // 旁白语速约 4.2 字/秒，镜头时长略长于朗读时间
    const estDuration = (total * avgSegChar) / 4.2;
    shotCount = Math.round(estDuration / ((minShotSec + maxShotSec) / 2));
  }
  shotCount = clamp(shotCount, 4, 24);

  const segsPerShot = Math.max(1, Math.ceil(total / shotCount));
  const groups: { start: number; end: number }[] = [];
  for (let i = 0; i < total; i += segsPerShot) {
    groups.push({ start: i, end: Math.min(total - 1, i + segsPerShot - 1) });
  }
  // 如果分组过多（例如最后只剩 1 段），合并到上一组
  while (groups.length > shotCount) {
    const last = groups.pop()!;
    groups[groups.length - 1].end = last.end;
  }
  // 歌词项目：一句一镜，保证每句歌词都有独立、可对应的画面
  if (project.source.type === 'lyrics') {
    groups.length = 0;
    const cap = Math.min(total, 24);
    for (let i = 0; i < cap; i++) groups.push({ start: i, end: i });
    if (total > cap) groups[cap - 1].end = total - 1;
  }

  const shotSizes = ['远景', '全景', '中景', '近景', '特写'];
  const shots: Shot[] = groups.map((g, i) => {
    const segText = segments
      .slice(g.start, g.end + 1)
      .map((s) => s.text)
      .join(project.source.type === 'lyrics' ? '\n' : '');
    const subtitle = project.source.type === 'lyrics' ? segText : splitForSubtitle(segText, 22).slice(0, 2).join('\n');
    const shotSize = shotSizes[Math.floor(rand() * shotSizes.length)];
    const motion = preset.motion[Math.floor(rand() * preset.motion.length)];
    const keyword = analysis.keywords[i % Math.max(1, analysis.keywords.length)] || project.source.title;
    // 关键：画面方案由这个镜头对应的原句提炼，而不是从全局关键词里轮播
    const plan = buildShotVisual({
      subtitle,
      preset,
      shotSize,
      motion,
      mood: analysis.mood,
      index: i,
      isHistory: project.source.type === 'history',
      avoid: project.requirements.avoid,
    });
    return {
      id: `shot_${i + 1}`,
      index: i,
      title: shotTitleFromSubtitle(subtitle, keyword, i),
      subtitle,
      prompt: plan.prompt,
      negativePrompt: plan.negativePrompt,
      motion,
      shotSize,
      segStart: g.start,
      segEnd: g.end,
      duration: 0,
      palette: plan.palette,
      visualAnchors: plan.anchors,
      searchQuery: plan.searchTerms.join(' | '),
      imageStatus: 'pending',
    };
  });

  return {
    logline: analysis.logline,
    visualStyle: `${preset.name}：${preset.tagline}。${preset.descriptors.slice(0, 3).join('；') || '自然光、克制的色彩与缓慢运镜。'}`,
    shots,
    provider: 'mock',
    model: 'local-mock',
    updatedAt: Date.now(),
  };
}

/** 用镜头字幕的首句做标题，比关键词拼贴更自然 */
function shotTitleFromSubtitle(subtitle: string, keyword: string, index: number): string {
  const firstLine = subtitle.split('\n')[0]?.trim() ?? '';
  const cleaned = firstLine.replace(/[\s，。！？、,.!?：:；;“”"'（）()【】\[\]]/g, '');
  if (cleaned.length >= 3) {
    return cleaned.length > 9 ? `${cleaned.slice(0, 9)}` : cleaned;
  }
  if (keyword && !/demo|studio|unknown/i.test(keyword)) return keyword.slice(0, 9);
  return `画面 ${index + 1}`;
}

/** 历史 / 创意模式：本地兜底旁白脚本（无 DeepSeek Key 时也能出片） */
function buildMockScript(project: Project, keywords: string[], research?: Project['source']['research']): string[] {
  const title = project.source.topic || project.source.title;
  const lines: string[] = [];
  const avoid = project.requirements.avoid.join('、');
  if (project.source.type === 'history') {
    lines.push(`关于${title}，故事要从它发生的年代说起。`);
    const timeline = research?.timeline ?? [];
    if (timeline.length) {
      for (const t of timeline.slice(0, 8)) {
        const event = cleanExtractedText(t.event.replace(/[。；;]$/, '')).slice(0, 46);
        if (!event) continue;
        const hasEra = /年|代|朝|世纪/.test(event);
        lines.push(hasEra ? `${event}。` : `${t.year}，${event}。`);
      }
    } else {
      const facts = research?.facts ?? [];
      for (const f of facts.slice(0, 6)) {
        const claim = cleanExtractedText(f.claim.replace(/[。；;]$/, '')).slice(0, 44);
        if (claim) lines.push(claim.endsWith('。') ? claim : `${claim}。`);
      }
      if (lines.length === 1) {
        lines.push(`现存的记载与器物，拼出了${title}最初的轮廓。`);
        lines.push('人群、土地与时间，在这里留下了彼此纠缠的痕迹。');
        lines.push('当我们回望那段历史，看到的不只是胜败，还有普通人的呼吸。');
      }
    }
    if (research?.summary) {
      const summaryLine = splitSentences(research.summary)[0];
      if (summaryLine && summaryLine.length > 10) lines.push(summaryLine.slice(0, 60));
    }
    lines.push(`这就是${title}，一段仍在被讲述的往事。`);
  } else {
    const brief = project.requirements.brief || project.source.raw;
    const sentences = splitSentences(brief);
    lines.push(`这是一个关于${keywords.slice(0, 2).join('与') || title}的故事。`);
    for (const s of sentences.slice(0, 6)) {
      lines.push(s.length > 34 ? s.slice(0, 34) + '。' : s);
    }
    if (lines.length < 4) {
      lines.push(`镜头跟随${keywords[0] || '主角'}，走进它最安静的时刻。`);
      lines.push('光落在细节上，也落在说不出口的心事里。');
      lines.push('故事没有答案，只留下一个可以被记住的画面。');
    }
    if (project.requirements.mustInclude.length) {
      lines.push(`画面里必须出现${project.requirements.mustInclude.join('与')}，它们是这段叙事的锚点。`);
    }
    if (avoid) lines.push(`但我们会避开${avoid}，让画面保持克制。`);
  }
  return lines.filter((l) => l.trim().length > 0).slice(0, 18);
}

export function mockOptimizedPrompt(idea: string, preset: StylePreset): PromptOptimizeResult {
  const keywords = extractKeywords(idea, 5);
  const subject = keywords[0] || idea.slice(0, 20);
  const base = preset.descriptors.length ? preset.descriptors.join(', ') : 'cinematic still, natural light, muted palette';
  const optimized = `${subject}, ${base}, ${idea.slice(0, 80)}, medium shot with leading lines, soft volumetric light, balanced negative space, ${QUALITY_TOKENS}`;
  return {
    original: idea,
    optimized,
    negative: [...preset.negative, ...DEFAULT_NEGATIVE.split(', ').slice(0, 6)].join(', '),
    rationale: [
      '补全了主体、环境、光线与镜头语言，避免模型自由发挥导致画面跑偏。',
      '追加质感与画质词（胶片颗粒 / 高动态范围），提升成片电影感。',
      '把抽象情绪转化为可执行的视觉元素与构图约束。',
    ],
    variants: [
      {
        name: '电影感',
        prompt: `${optimized}, anamorphic lens, dramatic rim light, atmospheric haze, film still from a feature movie`,
        note: '更强的明暗对比与镜头光晕，适合叙事高潮。',
      },
      {
        name: '写实纪实',
        prompt: `${subject}, documentary photography, natural available light, candid moment, 35mm lens, authentic texture`,
        note: '降低戏剧化程度，强调真实与现场感。',
      },
      {
        name: '风格化',
        prompt: `${subject}, ${base}, stylized illustration, graphic composition, bold color blocking, subtle paper texture`,
        note: '更适合封面与高记忆点的单张画面。',
      },
    ],
    provider: 'mock',
    model: 'local-mock',
  };
}

export function mockMusicSpec(project: Project): MusicSpec {
  const analysis = project.analysis;
  const rand = mulberry32(hashString(project.id + 'music'));
  const mood = analysis?.mood ?? '克制';
  const isMelancholy = /孤独|克制|怅然|清冷|荒凉|遗憾|悲伤|夜/.test(mood + (analysis?.keywords ?? []).join(''));
  const isEpic = /史诗|辽阔|热血|厚重|张力|速度/.test(mood + (analysis?.keywords ?? []).join(''));
  const energy = isEpic ? 3 : isMelancholy ? 1 : 2;
  const scale: MusicSpec['scale'] = isMelancholy ? 'minor' : isEpic ? 'minor' : 'major';
  const key = pick(rand, ['A', 'C', 'D', 'E', 'F', 'G']);
  const chords = scale === 'minor'
    ? [`${key}m`, pick(rand, ['F', 'G', 'C', 'Am']), pick(rand, ['C', 'Dm', 'Em', 'G']), pick(rand, ['G', 'F', 'Am', 'Em'])]
    : [key, pick(rand, ['F#m', 'Am', 'Dm', 'Em']), pick(rand, ['G', 'C', 'Bm', 'D']), pick(rand, ['C', 'G', 'F', 'D'])];
  const instruments: MusicInstrument[] = [
    { name: '暖垫', role: 'pad', waveform: 'sine', gain: 0.34, octave: 0 },
    { name: '低音', role: 'bass', waveform: 'triangle', gain: 0.28, octave: -2 },
    { name: '粒状琶音', role: 'arp', waveform: 'triangle', gain: 0.16, octave: 1 },
  ];
  if (isEpic) instruments.push({ name: '低音鼓', role: 'perc', waveform: 'sine', gain: 0.24, octave: -3 });
  instruments.push({ name: '空气质感', role: 'texture', waveform: 'noise', gain: 0.1, octave: 0 });
  return {
    title: analysis?.theme?.slice(0, 12) || '无声之诗',
    mood,
    genre: isEpic ? 'epic ambient' : isMelancholy ? 'melancholic ambient' : 'warm ambient',
    tempoBpm: isEpic ? 96 : isMelancholy ? 62 : 72,
    key,
    scale,
    energy,
    instruments,
    chordProgression: chords,
    durationSec: 0,
    notes: [
      '以氛围铺底为主，避免旋律抢戏。',
      '副歌/高潮处加入低频脉动与更亮的琶音。',
      '整体音量压在旁白之下，保留呼吸空间。',
    ],
    provider: 'mock',
    model: 'local-mock',
  };
}

export function mockResearchSummary(topic: string, sources: { id: string; title: string; snippet: string; url: string }[]): {
  summary: string;
  timeline: ResearchTimelineItem[];
  facts: ResearchFact[];
} {
  const clean = (s: string) => cleanExtractedText(s.replace(/\s+/g, ' '));
  const snippets = sources.map((s) => ({ ...s, snippet: clean(s.snippet) })).filter((s) => s.snippet.length > 24);
  const summaryParts = snippets.slice(0, 4).map((s) => s.snippet);
  const summary = (summaryParts.join(' ') || `关于${topic}的公开资料较少，建议补充检索词或直接粘贴史料原文。`).slice(0, 520);

  const yearRegex = /((?:公元前)?\s*\d{1,4}\s*年(?:\s*\d{1,2}\s*月)?|(?:公元)?\d{3,4}年代)/;
  const timeline: ResearchTimelineItem[] = [];
  const seenYear = new Set<string>();
  const seenEvent = new Set<string>();
  for (const s of snippets) {
    for (const sentence of splitSentences(s.snippet)) {
      const m = sentence.match(yearRegex);
      if (!m || sentence.length <= 8) continue;
      const year = m[1].replace(/\s+/g, '');
      // 每年只保留一条最清晰的事件，避免同一事件简繁重复
      if (seenYear.has(year)) continue;
      const event = cleanExtractedText(sentence.replace(m[1], '').replace(/^[，,、。\s:：]+/, '')).slice(0, 60);
      if (event.length < 6) continue;
      const eventKey = event.slice(0, 10);
      if (seenEvent.has(eventKey)) continue;
      seenYear.add(year);
      seenEvent.add(eventKey);
      timeline.push({ year, event, sourceIds: [s.id] });
      if (timeline.length >= 8) break;
    }
    if (timeline.length >= 8) break;
  }
  const facts: ResearchFact[] = snippets.slice(0, 8).map((s, i) => ({
    claim: splitSentences(s.snippet)[0]?.slice(0, 120) || s.snippet.slice(0, 120),
    detail: `来源：${s.title}`,
    sourceIds: [s.id],
    year: i === 0 ? timeline[0]?.year : undefined,
  }));
  return { summary, timeline, facts };
}

export function emptyResearch(topic: string, notices: string[]): ResearchBundle {
  return {
    query: topic,
    queries: [],
    provider: 'none',
    sources: [],
    summary: '',
    facts: [],
    timeline: [],
    notices,
    searchedAt: Date.now(),
  };
}
