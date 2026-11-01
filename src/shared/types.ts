/**
 * 共享领域模型：前端与后端共用。
 * 时间单位：秒（除非标注 ms）。
 *
 * 核心设计：素材源（歌词 / 历史研究 / 创意想法）统一为「文本分段 + 分镜 + 音轨」，
 * 镜头、提示词、音乐全部由「内容 + 用户需求」动态生成，不预设固定场景数量。
 */

export type AspectRatio = '9:16' | '16:9' | '1:1';
export type RenderResolution = '720p' | '1080p';
export type ProjectStatus = 'draft' | 'running' | 'ready' | 'error';
export type SourceType = 'lyrics' | 'history' | 'idea';

export type StageKey =
  | 'source'
  | 'research'
  | 'analysis'
  | 'storyboard'
  | 'prompts'
  | 'images'
  | 'voice'
  | 'music'
  | 'render';

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface StageState {
  key: StageKey;
  status: StageStatus;
  /** 0 - 100 */
  progress: number;
  message?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
}

/* ------------------------------------------------------------------ */
/* 素材源                                                              */
/* ------------------------------------------------------------------ */

export interface ScriptSegment {
  id: string;
  index: number;
  text: string;
  kind: 'lyric' | 'narration';
  /** LRC 起始时间（秒），仅歌词有 */
  startSec?: number;
}

export interface LyricLine {
  id: string;
  index: number;
  start?: number;
  text: string;
}

export interface LyricSource {
  type: 'library' | 'paste' | 'upload';
  songId?: string;
  title: string;
  artist: string;
  raw: string;
  language?: string;
  sourceLabel?: string;
}

export interface LyricSection {
  startLine: number;
  endLine: number;
  label?: string;
}

/* ---------------------------- 联网研究 ---------------------------- */

export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  provider: string;
  fetchedAt: number;
}

export interface ResearchFact {
  claim: string;
  detail?: string;
  sourceIds: string[];
  year?: string;
}

export interface ResearchTimelineItem {
  year: string;
  event: string;
  sourceIds?: string[];
}

export interface ResearchBundle {
  query: string;
  queries: string[];
  provider: string;
  sources: ResearchSource[];
  summary: string;
  facts: ResearchFact[];
  timeline: ResearchTimelineItem[];
  notices: string[];
  searchedAt: number;
  /** 生成摘要所用模型 */
  model?: string;
}

export interface SourceDoc {
  type: SourceType;
  title: string;
  /** 歌词：歌手；历史：时期/朝代；想法：作者 */
  author: string;
  /** 原始文本：LRC / 史料 / 想法 */
  raw: string;
  language: string;
  songId?: string;
  sourceLabel?: string;
  /** 历史/想法主题 */
  topic?: string;
  era?: string;
  research?: ResearchBundle;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  language: string;
  tags: string[];
  lrc: string;
  source: 'local' | 'netease' | 'imported';
  sourceLabel?: string;
  durationSec?: number;
  lineCount: number;
  excerpt?: string;
  createdAt: number;
}

export interface SongSearchResult {
  songs: Song[];
  source: string;
  notice?: string;
}

/* ------------------------------------------------------------------ */
/* 用户需求（驱动一切生成的输入）                                        */
/* ------------------------------------------------------------------ */

export type SceneDensity = 'auto' | 'sparse' | 'medium' | 'dense';
export type BgmMode = 'ai' | 'none' | 'upload';

export interface Requirements {
  /** 自由创作需求，例如「纪录片口吻，多用兵器与地貌空镜，避免人物特写」 */
  brief: string;
  /** 目标成片时长，0 或空表示由素材长度决定 */
  targetDurationSec: number;
  sceneDensity: SceneDensity;
  /** 必须出现的元素 */
  mustInclude: string[];
  /** 尽量避免的元素 */
  avoid: string[];
  /** 自由风格描述，与预设风格叠加 */
  styleKeywords: string;
  /** 旁白/配音语气 */
  narrationTone: string;
  language: 'zh' | 'en';
  bgmMode: BgmMode;
  /** BGM 需求，例如「古琴 + 低音鼓，克制、苍凉」 */
  bgmPrompt: string;
}

/* ---------------------------- 声音设计 ---------------------------- */

export interface MusicInstrument {
  name: string;
  role: 'pad' | 'bass' | 'arp' | 'perc' | 'texture' | 'lead';
  waveform: 'sine' | 'triangle' | 'saw' | 'square' | 'noise';
  /** 相对音量 0-1 */
  gain: number;
  /** 八度偏移 */
  octave: number;
}

export interface MusicSpec {
  title: string;
  mood: string;
  genre: string;
  tempoBpm: number;
  key: string;
  scale: 'major' | 'minor' | 'dorian' | 'pentatonic';
  /** 1 静谧 - 5 强烈 */
  energy: number;
  instruments: MusicInstrument[];
  /** 和弦进行，如 Am F C G */
  chordProgression: string[];
  durationSec: number;
  notes: string[];
  provider: 'deepseek' | 'mock';
  model?: string;
}

export interface MusicConfig {
  mode: BgmMode;
  prompt: string;
  /** 混音音量 0-1 */
  volume: number;
  /** 环境音层：room / wind / rain / none */
  ambience: 'none' | 'room' | 'wind' | 'rain' | 'crowd';
  /** 用户上传的 BGM 路径（相对项目目录） */
  uploadPath?: string;
}

export interface MusicAssets {
  spec?: MusicSpec;
  bgmUrl?: string;
  bgmDuration?: number;
  ambienceUrl?: string;
  generatedAt?: number;
}

/* ---------------------------- 风格 / 字幕 ------------------------- */

export interface StylePreset {
  id: string;
  name: string;
  tagline: string;
  palette: [string, string, string];
  descriptors: string[];
  negative: string[];
  subtitle: SubtitleStyle;
  motion: ShotMotion[];
  moodWords: string[];
}

export type ShotMotion = 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'drift-up' | 'static';

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  marginV: number;
  letterSpacing: number;
  bold: boolean;
  fade: boolean;
}

export interface VoiceOption {
  id: string;
  name: string;
  locale: string;
  gender: 'female' | 'male' | 'neutral';
  tags: string[];
  description: string;
}

export interface VoiceConfig {
  voiceId: string;
  rate: number;
  pitch: number;
  volume: number;
  gapMs: number;
  /** 朗读：自然口语；半唱：按旋律给每个词变调，形成"念唱"的旋律感 */
  singMode?: 'speak' | 'melodic';
  /** 人声朗读开关：关闭后只有歌曲 BGM + 歌词字幕 */
  enabled?: boolean;
}

export interface RenderConfig {
  aspect: AspectRatio;
  resolution: RenderResolution;
  fps: number;
  xfade: boolean;
  transitionSec: number;
  subtitle: SubtitleStyle;
  outroSec: number;
  /** 片头标题卡时长 */
  introSec: number;
}

/* ------------------------------------------------------------------ */
/* AI 产物                                                             */
/* ------------------------------------------------------------------ */

export interface AnalysisSection {
  label: string;
  segStart: number;
  segEnd: number;
  mood: string;
}

export interface ContentAnalysis {
  theme: string;
  logline: string;
  mood: string;
  emotions: string[];
  keywords: string[];
  imagery: string[];
  colorStory: string[];
  sections: AnalysisSection[];
  /** 历史模式的时间线 */
  timeline?: ResearchTimelineItem[];
  keyFacts?: ResearchFact[];
  /** 由 AI 撰写的旁白/字幕脚本（历史与创意模式使用） */
  script?: string[];
  directorNotes: string[];
  provider: 'deepseek' | 'mock';
  model: string;
}

export interface Shot {
  id: string;
  index: number;
  title: string;
  /** 该镜头字幕文本（多行用 \n） */
  subtitle: string;
  prompt: string;
  negativePrompt: string;
  motion: ShotMotion;
  shotSize: string;
  segStart: number;
  segEnd: number;
  duration: number;
  palette: [string, string, string];
  /** 画面依据：从原句提炼出的具象母题（中文标签），用于 UI 展示分镜与文案的关联 */
  visualAnchors?: string[];
  /** 讲解焦点：合成时按顺序高亮并打标签 */
  focuses?: { x: number; y: number; w: number; h: number; label?: string; start: number; end: number }[];
  /** 实拍素材检索关键词（可手动修改后单独重绘） */
  searchQuery?: string;
  /** 像素场景配方：合成时按帧重新绘制并做镜头运动 */
  pixelScene?: { type: string; variant: number; seed: number };
  imageUrl?: string;
  clipUrl?: string;
  imageStatus?: 'pending' | 'running' | 'done' | 'failed' | 'mock' | 'stock';
  error?: string;
}

export interface Storyboard {
  logline: string;
  visualStyle: string;
  shots: Shot[];
  provider: 'deepseek' | 'mock';
  model: string;
  updatedAt: number;
}

export interface PromptVariant {
  name: string;
  prompt: string;
  note: string;
}

export interface PromptOptimizeResult {
  original: string;
  optimized: string;
  negative: string;
  rationale: string[];
  variants: PromptVariant[];
  provider: 'deepseek' | 'mock';
  model: string;
}

/* ------------------------------------------------------------------ */
/* 项目                                                                */
/* ------------------------------------------------------------------ */

export interface TimelineItem {
  segId: string;
  segIndex: number;
  text: string;
  start: number;
  end: number;
  audioUrl?: string;
}

export interface ImageCredit {
  shotId: string;
  title: string;
  author?: string;
  license?: string;
  url: string;
}

export interface ProjectAssets {
  voiceoverUrl?: string;
  voiceoverDuration?: number;
  timeline?: TimelineItem[];
  videoUrl?: string;
  coverUrl?: string;
  videoDuration?: number;
  videoSize?: number;
  music?: MusicAssets;
  /** 实拍素材来源（Wikimedia Commons 等 CC 授权的照片） */
  imageCredits?: ImageCredit[];
}

export interface Project {
  id: string;
  title: string;
  requirements: Requirements;
  status: ProjectStatus;
  stage: StageKey;
  stages: StageState[];
  source: SourceDoc;
  segments: ScriptSegment[];
  stylePresetId: string;
  analysis?: ContentAnalysis;
  storyboard?: Storyboard;
  voice: VoiceConfig;
  render: RenderConfig;
  music: MusicConfig;
  assets: ProjectAssets;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  brief: string;
  sourceType: SourceType;
  status: ProjectStatus;
  stage: StageKey;
  stageProgress: number;
  stylePresetId: string;
  aspect: AspectRatio;
  coverUrl?: string;
  videoUrl?: string;
  segmentCount: number;
  shotCount: number;
  duration?: number;
  createdAt: number;
  updatedAt: number;
}

export interface DashboardStats {
  projectCount: number;
  readyCount: number;
  runningCount: number;
  totalVideoSec: number;
  songCount: number;
  voiceCount: number;
  llmProvider: 'deepseek' | 'mock';
  imageProvider: 'api' | 'mock';
  researchProvider: string;
  ffmpegReady: boolean;
  recentProjects: ProjectSummary[];
  activity: ActivityItem[];
}

export interface ActivityItem {
  id: string;
  projectId?: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

export interface SettingsView {
  deepseekConfigured: boolean;
  deepseekKeyMasked: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  imageConfigured: boolean;
  imageKeyMasked: string;
  imageBaseUrl: string;
  imageModel: string;
  /** 生图是否复用 DeepSeek Key（未单独配置生图 Key 时） */
  imageUsesDeepseekKey: boolean;
  /** 当前实际画图引擎 */
  imageEngine: 'api' | 'procedural';
  /** 联网检索走哪个通道 */
  researchProviders: ('wikipedia' | 'duckduckgo' | 'bing')[];
  onlineLyricsEnabled: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  renderConcurrency: number;
  defaultVoiceId: string;
  defaultStylePresetId: string;
  defaultAspect: AspectRatio;
  defaultResolution: RenderResolution;
  env: {
    ffmpegReady: boolean;
    ffmpegVersion?: string;
    ttsReady: boolean;
    dataDir: string;
    platform: string;
    nodeVersion: string;
  };
}

export interface SettingsUpdate {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  imageApiKey?: string;
  imageBaseUrl?: string;
  imageModel?: string;
  researchProviders?: ('wikipedia' | 'duckduckgo' | 'bing')[];
  onlineLyricsEnabled?: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
  renderConcurrency?: number;
  defaultVoiceId?: string;
  defaultStylePresetId?: string;
  defaultAspect?: AspectRatio;
  defaultResolution?: RenderResolution;
}

export interface TestResult {
  ok: boolean;
  latencyMs?: number;
  message: string;
  detail?: string;
}

/* ------------------------------------------------------------------ */
/* 请求体                                                              */
/* ------------------------------------------------------------------ */

export interface CreateProjectBody {
  title?: string;
  sourceType: SourceType;
  /** 歌词：songId 或 lyricsRaw；历史：topic；想法：brief */
  songId?: string;
  lyricsRaw?: string;
  lyricsTitle?: string;
  lyricsArtist?: string;
  section?: LyricSection;
  topic?: string;
  era?: string;
  raw?: string;
  requirements: Partial<Requirements>;
  stylePresetId?: string;
  aspect?: AspectRatio;
  resolution?: RenderResolution;
  voiceId?: string;
  /** 已完成的联网研究（来自 /api/research） */
  research?: ResearchBundle;
}

export interface StartPipelineBody {
  from?: StageKey;
  force?: boolean;
  /** 只跑到该阶段（含）为止，便于先审分镜 */
  until?: StageKey;
}

export interface ResearchRequestBody {
  topic: string;
  era?: string;
  /** 追加检索关键词 */
  extraQueries?: string[];
  maxSources?: number;
}

export interface OptimizePromptBody {
  idea: string;
  stylePresetId?: string;
  aspect?: AspectRatio;
  requirements?: Partial<Requirements>;
}

/* ------------------------------------------------------------------ */
/* 事件（SSE）                                                         */
/* ------------------------------------------------------------------ */

export type PipelineEventName = 'snapshot' | 'stage' | 'log' | 'progress' | 'shot' | 'done' | 'error' | 'cancelled';

export interface PipelineEvent {
  type: PipelineEventName;
  projectId: string;
  at: number;
  stage?: StageKey;
  progress?: number;
  message?: string;
  level?: ActivityItem['level'];
  shotId?: string;
  project?: Project;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

export const STAGE_META: Record<StageKey, { label: string; short: string; description: string }> = {
  source: { label: '素材解析', short: '素材', description: '解析歌词 / 史料 / 想法，切分为可配音的文本段' },
  research: { label: '联网研究', short: '研究', description: '检索史料与资料，提炼摘要、时间线与可引用事实' },
  analysis: { label: '内容理解', short: '理解', description: 'AI 提炼主题、情绪曲线、意象与导演思路' },
  storyboard: { label: '分镜脚本', short: '分镜', description: '按内容与需求动态决定镜头数量、画面内容与运镜' },
  prompts: { label: '提示词优化', short: '提示词', description: '把每个镜头扩写为专业生图提示词与负面词' },
  images: { label: '画面生成', short: '画面', description: '按提示词生成每个镜头的画面素材' },
  voice: { label: '配音合成', short: '配音', description: 'Edge-TTS 逐段配音并合成时间轴' },
  music: { label: '声音设计', short: '音乐', description: 'AI 依据需求设计 BGM，本地合成并与旁白混音' },
  render: { label: '成片渲染', short: '渲染', description: 'ffmpeg 运镜、转场、字幕与音轨合成 MP4' },
};

export const STAGE_ORDER: StageKey[] = [
  'source',
  'research',
  'analysis',
  'storyboard',
  'prompts',
  'images',
  'voice',
  'music',
  'render',
];

export const ASPECT_META: Record<AspectRatio, { label: string; width: number; height: number; hint: string }> = {
  '9:16': { label: '竖屏 9:16', width: 1080, height: 1920, hint: '抖音 / 视频号 / Reels' },
  '16:9': { label: '横屏 16:9', width: 1920, height: 1080, hint: 'B 站 / YouTube / 大屏' },
  '1:1': { label: '方形 1:1', width: 1080, height: 1080, hint: '小红书 / 封面' },
};

export const SCENE_DENSITY_META: Record<SceneDensity, { label: string; hint: string }> = {
  auto: { label: '自动', hint: '由内容长度与情绪节奏决定' },
  sparse: { label: '稀疏', hint: '镜头更长、更少空镜' },
  medium: { label: '均衡', hint: '常规 MV / 纪录片节奏' },
  dense: { label: '密集', hint: '短镜头快切，信息量大' },
};

export const SOURCE_TYPE_META: Record<SourceType, { label: string; hint: string; icon: string }> = {
  lyrics: { label: '歌词成片', hint: '检索 / 粘贴 LRC 歌词，逐句配唱与字幕', icon: 'music' },
  history: { label: '历史·资料', hint: '联网检索史料，生成时间线、分镜与旁白', icon: 'landmark' },
  idea: { label: '口播稿 / 主题', hint: '粘贴口播稿或主题；长文保留原文并自动补开场白', icon: 'sparkles' },
};
