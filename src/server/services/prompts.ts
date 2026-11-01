import type { Project, Requirements, StylePreset } from '../../shared/types';
import { STAGE_META } from '../../shared/types';

const JSON_RULE = `你只输出一个合法的 JSON 对象，不要输出 markdown 代码块、注释或任何解释性文字。所有字段必须存在，不能缺省。`;

function reqText(req: Requirements): string {
  const lines: string[] = [];
  if (req.brief) lines.push(`用户创作需求：${req.brief}`);
  if (req.targetDurationSec > 0) lines.push(`目标成片时长：约 ${req.targetDurationSec} 秒`);
  if (req.sceneDensity !== 'auto') {
    const map = { sparse: '镜头更少更长', medium: '常规节奏', dense: '短镜头快切' } as const;
    lines.push(`镜头密度：${map[req.sceneDensity]}`);
  }
  if (req.mustInclude.length) lines.push(`必须出现：${req.mustInclude.join('、')}`);
  if (req.avoid.length) lines.push(`避免出现：${req.avoid.join('、')}`);
  if (req.styleKeywords) lines.push(`风格描述（优先遵循）：${req.styleKeywords}`);
  if (req.narrationTone) lines.push(`旁白/配音语气：${req.narrationTone}`);
  if (req.bgmPrompt) lines.push(`背景音乐需求：${req.bgmPrompt}`);
  lines.push(`输出语言：${req.language === 'en' ? 'English' : '简体中文'}`);
  return lines.join('\n');
}

function styleText(preset: StylePreset): string {
  if (!preset.descriptors.length) return '未指定视觉预设：请根据内容自主决定最合适的视觉语言，并保持整片统一。';
  return `视觉预设「${preset.name}」：${preset.descriptors.join('; ')}。负面倾向：${preset.negative.join(', ')}。`;
}

function segmentsText(project: Project): string {
  const max = 120;
  return project.segments
    .slice(0, max)
    .map((s) => `${s.index + 1}. ${s.text}`)
    .join('\n');
}

export function analysisMessages(project: Project, preset: StylePreset) {
  const sourceKind = project.source.type === 'lyrics' ? '歌词' : project.source.type === 'history' ? '历史/资料' : '创意需求';
  const research = project.source.research;
  const researchText = research
    ? `\n【联网检索摘要】\n${research.summary}\n【时间线】\n${research.timeline.map((t) => `${t.year} ${t.event}`).join('\n')}\n【可引用事实】\n${research.facts.map((f) => `- ${f.claim}${f.detail ? `：${f.detail}` : ''}`).join('\n')}`
    : '';
  return {
    system: `你是一位顶级 MV / 纪录片导演。你的任务是把${sourceKind}文本提炼成可执行的视听创作方案。
分析必须忠于原文，禁止编造原文与检索资料中不存在的史实或细节。
${JSON_RULE}
JSON 结构：
{
  "theme": "一句话主题（≤20字）",
  "logline": "一句话故事线（≤60字）",
  "mood": "整体情绪基调（≤12字）",
  "emotions": ["情绪关键词 4-6 个"],
  "keywords": ["内容关键词 5-8 个，用于画面检索"],
  "imagery": ["具体视觉意象 5-8 个，可直接用于生图"],
  "colorStory": ["色彩描述 3-5 个，例如 冷蓝雨夜、暖橙灯箱"],
  "sections": [{"label":"段落名","segStart":1,"segEnd":4,"mood":"该段情绪"}],
  "timeline": [{"year":"年份或时期","event":"事件"}] 或 [],
  "keyFacts": [{"claim":"事实","detail":"补充","sourceIds":[]}] 或 [],
  "script": ["旁白句子 1", "旁白句子 2"],
  "directorNotes": ["导演建议 3-5 条，包含镜头语言的取舍理由"]
}
sections 必须覆盖全部文本段，segStart/segEnd 是文本段序号（从 1 开始，闭区间）。
${
  project.source.type === 'lyrics'
    ? '素材是歌词：script 返回空数组 []，不要改写歌词。'
    : `素材不是现成歌词，你必须基于原文/检索资料撰写旁白脚本：script 为 8-18 句自然口语化的中文旁白，每句 12-32 字，按叙事顺序推进，忠于资料、不虚构，适合逐句配音与字幕。旁白语言与用户需求语言一致。`
}`,
    user: `【作品标题】${project.source.title}
【素材类型】${sourceKind}
【原文】\n${segmentsText(project)}
${researchText}
【用户需求】\n${reqText(project.requirements)}
【视觉预设】${styleText(preset)}

请完成分析并输出 JSON。`,
  };
}

export function storyboardMessages(project: Project, preset: StylePreset) {
  const analysis = project.analysis;
  const requirements = project.requirements;
  const targetSec = requirements.targetDurationSec;
  const segCount = project.segments.length;
  const densityHint =
    requirements.sceneDensity === 'sparse'
      ? '镜头个数偏少，每镜 6-9 秒'
      : requirements.sceneDensity === 'dense'
        ? '镜头个数偏多，每镜 2.4-4 秒'
        : '镜头个数适中，每镜 4-6 秒';
  const durationRule = targetSec
    ? `目标总时长约 ${targetSec} 秒，镜头数量应在 ${Math.max(4, Math.round(targetSec / 8))} ~ ${Math.min(24, Math.round(targetSec / 3))} 之间。`
    : `镜头数量由内容长度和情绪节奏决定（当前 ${segCount} 个文本段），建议 ${Math.max(4, Math.min(20, Math.round(segCount / 1.5)))} 个左右，不要生硬地均分。`;

  return {
    system: `你是资深分镜师。把文本段映射为电影镜头序列，输出可直接用于 AI 生图与剪辑的分镜表。
硬性要求：
1. 每个文本段必须且只能被一个镜头覆盖，segStart/segEnd 为从 1 开始的文本段序号（闭区间），必须连续且完整覆盖 1..${segCount}。
2. 镜头数量与时长要符合用户需求与内容节奏；${durationRule}
3. ${densityHint}。
3.5 ${project.source.type === 'lyrics' ? '这是歌词项目：每个镜头只覆盖 1 个文本段（segStart === segEnd），镜头数量等于文本段数量，保证每句歌词都有独立画面。' : '旁白/历史项目：可以把 1-2 个文本段合并为一个镜头。'}
4. **画面必须来自这一镜头的原文**：先在心里把该镜头的字幕拆成"谁 / 在做什么 / 在哪 / 什么物件 / 什么光线"，再写 prompt。
   prompt 必须是「画面描述」而不是抽象概念：写清主体、动作、环境、时代细节、光线、构图、镜头焦段、材质；禁止只写风格词（如 cinematic、dramatic、moody 而没有任何具体内容）。
   每个镜头至少包含 2 个能从该镜头字幕里找到依据的具象元素（人/物/动作/环境）。
   不同镜头的 prompt 必须明显不同，不能套同一个模板只换颜色。
5. 历史题材必须与检索到的事实一致，不得出现明显时代错误（anachronism）。
6. subtitle 使用该镜头覆盖的原文，可合并但要保持原意。
${JSON_RULE}
JSON 结构：
{
  "logline": "整片一句话（≤60字）",
  "visualStyle": "整片统一视觉风格描述（≤80字）",
  "shots": [
    {
      "segStart": 1,
      "segEnd": 2,
      "title": "镜头短标题（≤10字）",
      "subtitle": "该镜头字幕文本",
      "prompt": "英文或中文的详细画面描述（80-160字）",
      "motion": "zoom-in|zoom-out|pan-left|pan-right|drift-up|static",
      "shotSize": "远景|全景|中景|近景|特写|大特写"
    }
  ]
}`,
    user: `【主题】${analysis?.theme ?? project.source.title}
【故事线】${analysis?.logline ?? project.source.title}
【情绪】${analysis?.mood ?? ''}
【关键词】${(analysis?.keywords ?? []).join('、')}
【视觉意象】${(analysis?.imagery ?? []).join('、')}
【色彩】${(analysis?.colorStory ?? []).join('、')}
【时间线】${(analysis?.timeline ?? []).map((t) => `${t.year} ${t.event}`).join('；') || '无'}
【导演建议】${(analysis?.directorNotes ?? []).join('；') || '无'}
【视觉预设】${styleText(preset)}
【用户需求】\n${reqText(requirements)}
【文本段】\n${segmentsText(project)}

请输出分镜 JSON。`,
  };
}

export function promptStageMessages(project: Project, preset: StylePreset) {
  const shots = project.storyboard?.shots ?? [];
  const shotList = shots
    .map(
      (s) =>
        `#${s.index + 1} id=${s.id} 标题=${s.title} 镜头=${s.shotSize}/${s.motion}\n  字幕：${s.subtitle}\n  原始描述：${s.prompt}`,
    )
    .join('\n');
  return {
    system: `你是 AI 生图提示词工程师。请把每个镜头的画面描述扩写为高质量、可直接投喂给文生图模型的提示词。
要求：
1. 每个镜头输出一条 final prompt：按「主体 + 动作 + 环境/时代 + 光线 + 构图/镜头 + 色彩 + 风格/质感 + 质量词」组织，英文为主，可保留必要的中文专有名词；80-150 个英文单词。
2. 保持整片视觉一致性（色调、镜头语言、质感），并遵守用户需求中的必须/避免项。
3. negativePrompt 用英文逗号分隔，包含通用缺陷词与该题材特有的禁忌（如历史题材的现代物品）。
4. 不得出现文字、水印、字幕等要求。
${JSON_RULE}
JSON 结构：
{"shots":[{"id":"镜头id","title":"≤10字标题","prompt":"...","negativePrompt":"...","shotSize":"景别"}]}`,
    user: `【视觉预设】${styleText(preset)}
【用户需求】\n${reqText(project.requirements)}
【整片风格】${project.storyboard?.visualStyle ?? ''}
【镜头列表】\n${shotList}

请输出优化后的提示词 JSON。`,
  };
}

export function researchSummaryMessages(topic: string, era: string, snippets: { title: string; url: string; snippet: string; id: string }[]) {
  const sourceText = snippets
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n摘要: ${s.snippet}`)
    .join('\n\n')
    .slice(0, 14000);
  return {
    system: `你是严谨的历史资料研究员。只能依据用户提供的检索结果总结，不得虚构。
${JSON_RULE}
JSON 结构：
{
  "summary": "300字以内的资料综述，交代背景、关键人物、主要过程与影响",
  "timeline": [{"year":"年份或时期","event":"事件","sourceIds":["s1"]}],
  "facts": [{"claim":"可直接写进脚本的事实","detail":"补充说明","sourceIds":["s1"]}]
}
timeline 3-8 条，facts 5-10 条；sourceIds 使用检索结果方括号中的编号（如 s1）。`,
    user: `研究主题：${topic}${era ? `（${era}）` : ''}\n\n检索结果：\n${sourceText}\n\n请输出 JSON。`,
  };
}

export function musicMessages(project: Project) {
  const analysis = project.analysis;
  return {
    system: `你是电影配乐设计师。根据成片内容与用户需求设计一段可用程序化合成器还原的背景音乐规格。
只能从以下选项中选择：
- waveform: sine | triangle | saw | square | noise
- role: pad | bass | arp | perc | texture
- scale: major | minor | dorian | pentatonic
- chordProgression 使用音名（如 Am F C G），2-4 个和弦循环
要求：器乐层次 3-5 个；energy 1-5；instrument 的 gain 0.05-0.6；tempoBpm 55-140；必须贴合情绪曲线，且不要盖过旁白。
${JSON_RULE}
JSON 结构：
{
  "title": "曲名（≤12字）",
  "mood": "情绪（≤12字）",
  "genre": "风格（≤12字）",
  "tempoBpm": 72,
  "key": "A",
  "scale": "minor",
  "energy": 2,
  "chordProgression": ["Am","F","C","G"],
  "instruments": [{"name":"暖垫","role":"pad","waveform":"sine","gain":0.3,"octave":0}],
  "notes": ["编曲说明 2-4 条"]
}`,
    user: `【主题】${analysis?.theme ?? project.source.title}
【情绪】${analysis?.mood ?? ''}
【情绪关键词】${(analysis?.emotions ?? []).join('、')}
【用户音乐需求】${project.requirements.bgmPrompt || '未指定，请依据内容判断'}
【旁白语气】${project.requirements.narrationTone || '自然'}
【目标时长】${project.requirements.targetDurationSec || '由内容决定'} 秒
【环境音需求】${project.music.ambience}

请输出音乐规格 JSON。`,
  };
}

export function optimizePromptMessages(idea: string, preset: StylePreset, requirements?: Partial<Requirements>) {
  return {
    system: `你是 AI 视频生图提示词专家。把用户的粗略想法扩写为可直接用于文生图/文生视频的专业提示词。
${JSON_RULE}
JSON 结构：
{
  "optimized": "主提示词（英文为主，80-150词）",
  "negative": "负面提示词（英文逗号分隔）",
  "rationale": ["中文说明 2-4 条：为什么这样写，补了哪些视觉信息"],
  "variants": [{"name":"版本名","prompt":"另一个方向的提示词","note":"中文一句话说明差异"}]
}
variants 给 3 个不同方向（如更电影感 / 更写实 / 更风格化）。`,
    user: `原始想法：${idea}
视觉预设：${styleText(preset)}
${requirements?.brief ? `补充需求：${requirements.brief}` : ''}
${requirements?.mustInclude?.length ? `必须出现：${requirements.mustInclude.join('、')}` : ''}
${requirements?.avoid?.length ? `避免出现：${requirements.avoid.join('、')}` : ''}

请输出 JSON。`,
  };
}

/** 历史题材补全检索关键词 */
export function researchQueryMessages(topic: string, era: string) {
  return {
    system: `你是检索策略助手。为历史/资料主题生成检索关键词，帮助找到权威、可引用的资料。
${JSON_RULE}
JSON 结构：{"queries":["关键词1","关键词2","关键词3","关键词4"]}
关键词尽量包含：主题全称、时间范围、关键人物、影响/评价、考古或文献佐证。`,
    user: `主题：${topic}${era ? `，时期：${era}` : ''}`,
  };
}

export const STAGE_PROMPT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_META).map(([k, v]) => [k, v.label]),
);
