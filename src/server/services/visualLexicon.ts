import type { ShotMotion, StylePreset } from '../../shared/types';
import { hashString, mulberry32 } from './text';

/**
 * 「文案 → 视觉」词典。
 * 每个镜头先从它对应的原句里抽取具象母题（雨窗、街灯、电梯、江面…），
 * 再由母题生成具体场景、构图、色调与标题 —— 而不是套一组通用风格词。
 */

export type ArtMotif =
  | 'rain-window'
  | 'street-lamp'
  | 'skyline'
  | 'corridor'
  | 'water'
  | 'sky-clouds'
  | 'fire-glow'
  | 'silhouette'
  | 'room-window'
  | 'road'
  | 'starry'
  | 'mountain'
  | 'flowers'
  | 'leaves'
  | 'boat'
  | 'paper-boat'
  | 'battle'
  | 'tower'
  | 'store'
  | 'traffic'
  | 'station'
  | 'clock'
  | 'moon'
  | 'none';

export interface VisualMotifDef {
  id: string;
  /** 中文短标签，用于 UI「画面依据」 */
  label: string;
  keys: string[];
  /** 英文场景描述，直接进生图提示词 */
  scene: string;
  /** 用于检索实拍素材（Wikimedia Commons）的英文关键词 */
  search?: string[];
  palette?: [string, string, string];
  art: ArtMotif;
  mood?: string;
}

const MOTIFS: VisualMotifDef[] = [
  {
    id: 'rain',
    label: '雨',
    keys: ['雨', '下雨', '潮湿', '湿'],
    scene: 'rain streaking down a glass surface, blurred reflections of city lights',
    palette: ['#0a1420', '#1d4ed8', '#67e8f9'],
    art: 'rain-window',
    mood: '潮湿、冷',
  },
  {
    id: 'window',
    label: '窗 / 玻璃',
    keys: ['玻璃', '窗', '窗帘', '窗口'],
    scene: "a window frame with condensation, the world outside softly out of focus",
    palette: ['#101725', '#334155', '#a5f3fc'],
    art: 'room-window',
    mood: '隔绝、向内',
  },
  {
    id: 'streetlamp',
    label: '路灯',
    keys: ['路灯', '街灯', '灯光', '光晕', '灯'],
    scene: 'a lone street lamp casting a long cone of warm light through drizzle',
    palette: ['#14100a', '#b45309', '#fcd34d'],
    art: 'street-lamp',
    mood: '温暖、孤零',
  },
  {
    id: 'shadow',
    label: '影子',
    keys: ['影子', '倒影', '剪影'],
    scene: 'a long human shadow stretched across wet pavement, elongated by low light',
    palette: ['#0b0d14', '#3f3f5a', '#c4b5fd'],
    art: 'silhouette',
    mood: '孤独、失重',
  },
  {
    id: 'neon',
    label: '霓虹',
    keys: ['霓虹', '招牌', '广告牌'],
    scene: 'dense neon signage burning in the dark, colors bleeding into the wet air',
    palette: ['#150a24', '#7c3aed', '#22d3ee'],
    art: 'skyline',
    mood: '迷离、夜',
  },
  {
    id: 'city',
    label: '城市 / 街道',
    keys: ['城市', '街道', '街', '路口', '马路', '巷'],
    scene: 'an empty city street at night, wet asphalt mirroring the shop lights, no people',
    palette: ['#080d18', '#1e3a8a', '#38bdf8'],
    art: 'skyline',
    mood: '空旷、夜',
  },
  {
    id: 'traffic',
    label: '车流',
    keys: ['车流', '车', '汽车', '地铁', '公交'],
    scene: 'long-exposure car light trails sweeping across the road, the rest of the city dark',
    palette: ['#0a0d16', '#1d4ed8', '#f472b6'],
    art: 'traffic',
    mood: '流动、掠过',
  },
  {
    id: 'corridor',
    label: '楼道 / 电梯',
    keys: ['电梯', '楼道', '楼梯', '走廊', '门'],
    scene: 'a narrow apartment corridor with flickering fluorescent light and closed doors',
    palette: ['#0d1112', '#374151', '#86efac'],
    art: 'corridor',
    mood: '逼仄、静',
  },
  {
    id: 'night',
    label: '深夜',
    keys: ['凌晨', '深夜', '夜', '午夜', '凌晨两点', '没睡', '失眠'],
    scene: 'deep night, a faint distant city glow on the horizon, almost no detail in the sky',
    palette: ['#05070e', '#1e1b4b', '#818cf8'],
    art: 'starry',
    mood: '静默、深沉',
  },
  {
    id: 'dawn',
    label: '天亮',
    keys: ['天亮', '清晨', '黎明', '晨光', '早安', '晚安', '日出', '醒来'],
    scene: 'dawn light breaking over a sleeping city skyline, cool shadows turning warm',
    palette: ['#1b1420', '#7c3aed', '#fbbf24'],
    art: 'sky-clouds',
    mood: '释然、微光',
  },
  {
    id: 'summer',
    label: '夏天 / 蝉',
    keys: ['夏天', '蝉鸣', '蝉', '盛夏', '夏天'],
    scene: 'sunlit summer afternoon, heat haze shimmering above the asphalt, cicada-filled air',
    palette: ['#0e1a12', '#0891b2', '#fde68a'],
    art: 'leaves',
    mood: '明亮、燥热',
  },
  {
    id: 'leaves',
    label: '梧桐 / 树叶',
    keys: ['梧桐', '叶', '树叶', '树'],
    scene: 'backlit plane-tree leaves trembling in the wind, dappled light falling through',
    palette: ['#0f1a10', '#15803d', '#fef08a'],
    art: 'leaves',
    mood: '夏日、轻盈',
  },
  {
    id: 'bicycle',
    label: '单车',
    keys: ['单车', '自行车', '骑', '长坡', '坡'],
    scene: 'a bicycle rolling down a long sloping road, motion blur on the wheels',
    palette: ['#0d1620', '#0369a1', '#fde68a'],
    art: 'road',
    mood: '少年、自由',
  },
  {
    id: 'shirt',
    label: '白衬衫',
    keys: ['白衬衫', '衬衫', '校服', '衣角'],
    scene: 'a white shirt billowing in the wind, fabric catching the backlight',
    palette: ['#101820', '#64748b', '#f8fafc'],
    art: 'leaves',
    mood: '干净、青春',
  },
  {
    id: 'letter',
    label: '信 / 信封',
    keys: ['信封', '信', '写下', '背面'],
    scene: 'a handwritten letter folded into an envelope, paper fibers visible in raking light',
    palette: ['#181410', '#b45309', '#fef3c7'],
    art: 'none',
    mood: '私密、旧时光',
  },
  {
    id: 'clouds',
    label: '云',
    keys: ['云', '云朵', '天空'],
    scene: 'cumulus clouds drifting across a vast summer sky, slow and weightless',
    palette: ['#0b1626', '#0ea5e9', '#e0f2fe'],
    art: 'sky-clouds',
    mood: '辽阔、失重',
  },
  {
    id: 'track',
    label: '操场 / 跑道',
    keys: ['操场', '白线', '跑道', '毕业', '青春'],
    scene: 'an empty school running track with painted white lines, long shadows at dusk',
    palette: ['#12100f', '#a16207', '#fde68a'],
    art: 'road',
    mood: '青春、回望',
  },
  {
    id: 'soda',
    label: '汽水 / 气泡',
    keys: ['汽水', '气泡', '勇气', '喝'],
    scene: 'condensation and rising bubbles in a glass bottle of soda, backlit by sun',
    palette: ['#0c1a1a', '#0d9488', '#bbf7d0'],
    art: 'none',
    mood: '清爽、少年',
  },
  {
    id: 'clock',
    label: '旧钟',
    keys: ['钟', '挂钟', '时间', '日历'],
    scene: 'an old wall clock, its pendulum swaying, dust in the air',
    palette: ['#17120d', '#92400e', '#fde68a'],
    art: 'clock',
    mood: '缓慢、怀旧',
  },
  {
    id: 'jasmine',
    label: '茉莉 / 花',
    keys: ['茉莉', '花', '开了一半', '阳台'],
    scene: 'jasmine flowers half-open on a balcony railing at dusk, petals catching last light',
    palette: ['#111410', '#4d7c0f', '#fef9c3'],
    art: 'flowers',
    mood: '温柔、旧',
  },
  {
    id: 'autumn',
    label: '秋天 / 落叶',
    keys: ['秋天', '落叶', '秋'],
    scene: 'autumn leaves drifting across a quiet courtyard, cool air, long shadows',
    palette: ['#1b120c', '#c2410c', '#fcd34d'],
    art: 'leaves',
    mood: '萧瑟、温柔',
  },
  {
    id: 'paperboat',
    label: '纸船',
    keys: ['纸船', '折成', '小船'],
    scene: 'a folded paper boat floating on still water, its reflection trembling',
    palette: ['#0b1114', '#155e75', '#a5f3fc'],
    art: 'paper-boat',
    mood: '童真、易逝',
  },
  {
    id: 'pocket',
    label: '口袋 / 折叠',
    keys: ['口袋', '折叠', '塞进', '藏好'],
    scene: 'a hand folding something small and slipping it into a coat pocket, fabric creasing in low light',
    palette: ['#121016', '#52525b', '#d4d4d8'],
    art: 'none',
    mood: '私密、收拢',
  },
  {
    id: 'station',
    label: '站台 / 站',
    keys: ['站台', '列车', '火车', '车站', '轨'],
    scene: 'a blurred train platform under pale station light, empty tracks receding',
    palette: ['#0a0f16', '#475569', '#e2e8f0'],
    art: 'station',
    mood: '离别、流动',
  },
  {
    id: 'umbrella',
    label: '伞',
    keys: ['伞', '撑伞', '下雨天'],
    scene: 'an umbrella held against the rain, seen from behind, fabric beaded with water',
    palette: ['#0a1118', '#1e40af', '#cbd5e1'],
    art: 'rain-window',
    mood: '独行、雨',
  },
  {
    id: 'mountain',
    label: '山',
    keys: ['山', '山色', '山后', '翻过'],
    scene: 'layered mountain ridges fading into mist, no human scale in sight',
    palette: ['#0c1210', '#334155', '#e2e8f0'],
    art: 'mountain',
    mood: '辽阔、清冷',
  },
  {
    id: 'river',
    label: '江 / 河',
    keys: ['江', '河', '水', '江面', '长江', '赤壁'],
    scene: 'a wide river under an overcast sky, ripples catching a sliver of light',
    palette: ['#091014', '#0f766e', '#99f6e4'],
    art: 'water',
    mood: '苍茫、流动',
  },
  {
    id: 'boat',
    label: '舟 / 船',
    keys: ['舟', '一叶舟', '孤舟', '船'],
    scene: 'a single small boat drifting on a vast river, the shore far away',
    palette: ['#0a1012', '#4b5563', '#d1d5db'],
    art: 'boat',
    mood: '孤寂、漂泊',
  },
  {
    id: 'moon',
    label: '月',
    keys: ['月', '月色', '月光'],
    scene: 'moonlight silvering the water surface, everything else in deep shadow',
    palette: ['#080b16', '#312e81', '#e0e7ff'],
    art: 'moon',
    mood: '清冷、思念',
  },
  {
    id: 'willow',
    label: '柳 / 岸',
    keys: ['柳', '岸上', '岸'],
    scene: 'willow branches trailing into the water, stirred by a light breeze',
    palette: ['#0a120e', '#166534', '#d9f99d'],
    art: 'leaves',
    mood: '离愁、古意',
  },
  {
    id: 'bridge',
    label: '桥',
    keys: ['桥', '桥头'],
    scene: 'an old stone bridge half-lost in mist, its reflection broken by ripples',
    palette: ['#0b1012', '#3f4a54', '#e2e8f0'],
    art: 'tower',
    mood: '古意、等待',
  },
  {
    id: 'ceiling',
    label: '天花板 / 房间',
    keys: ['天花板', '房间', '床', '屋内', '室内'],
    scene: 'a cracked ceiling seen from a bed in dim pre-dawn light, dust suspended',
    palette: ['#0b0c12', '#3f3f46', '#e4e4e7'],
    art: 'room-window',
    mood: '封闭、内省',
  },
  {
    id: 'breath',
    label: '呼吸',
    keys: ['呼吸', '沉默', '安静', '声音', '音量', '没回答'],
    scene: 'a still room where a faint breath is visible in cold air, silence made physical',
    palette: ['#0a0d14', '#374151', '#cbd5e1'],
    art: 'none',
    mood: '静默、内里',
  },
  {
    id: 'phone',
    label: '手机',
    keys: ['手机', '屏幕', '消息', '亮了又暗'],
    scene: 'a phone screen glowing alone in the dark, its light pooling on the sheets',
    palette: ['#080b12', '#1e3a8a', '#93c5fd'],
    art: 'room-window',
    mood: '等待、冷光',
  },
  {
    id: 'wind',
    label: '风',
    keys: ['风', '吹', '风一吹', '风一停'],
    scene: 'grass and loose fabric bending in a strong wind, direction of air visible',
    palette: ['#0b1214', '#0e7490', '#a5f3fc'],
    art: 'sky-clouds',
    mood: '流动、无常',
  },
  {
    id: 'running',
    label: '奔跑 / 鞋底',
    keys: ['鞋底', '跑', '奔跑', '逆光', '飞行', '飞过'],
    scene: 'running shoes striking the ground, motion blur streaking behind the legs',
    palette: ['#0a0d16', '#1d4ed8', '#f472b6'],
    art: 'road',
    mood: '速度、不服',
  },
  {
    id: 'heartbeat',
    label: '心跳 / 鼓点',
    keys: ['心跳', '鼓点', '燃料'],
    scene: 'abstract pulsing light rings expanding in rhythm, like a heartbeat made visible',
    palette: ['#120a14', '#be123c', '#fda4af'],
    art: 'none',
    mood: '律动、热',
  },
  {
    id: 'sea',
    label: '海',
    keys: ['海', '海边', '海边'],
    scene: 'the sea stretching to the horizon under heavy clouds, the beach empty',
    palette: ['#081014', '#0f766e', '#ccfbf1'],
    art: 'water',
    mood: '辽阔、尽头',
  },
  {
    id: 'wilderness',
    label: '旷野 / 荒原',
    keys: ['荒原', '旷野', '远方', '行囊'],
    scene: 'an empty windswept wilderness with distant mountains and a single path under a wide sky',
    palette: ['#12100c', '#a16207', '#fde68a'],
    art: 'mountain',
    mood: '苍凉、远行',
  },
  {
    id: 'stars',
    label: '星',
    keys: ['星', '星子', '星空'],
    scene: 'a sky full of stars above a dark plain, the ground barely readable',
    palette: ['#05070f', '#1e1b4b', '#e0e7ff'],
    art: 'starry',
    mood: '辽阔、微光',
  },
  {
    id: 'fire',
    label: '火',
    keys: ['火', '烧', '燃烧', '火攻', '灯'],
    scene: 'distant fire glow and drifting embers against heavy smoke, figures reduced to silhouettes',
    palette: ['#160b06', '#b91c1c', '#fbbf24'],
    art: 'fire-glow',
    mood: '危险、灼热',
  },
  {
    id: 'battle',
    label: '战船 / 兵',
    keys: ['战船', '兵', '箭', '军', '战场', '曹操', '孙权', '刘备', '周瑜'],
    scene: 'silhouettes of ancient chinese war ships on a misty river, torches multiplying on the water',
    palette: ['#12100c', '#7f1d1d', '#fbbf24'],
    art: 'battle',
    mood: '肃杀、史诗',
  },
  {
    id: 'tower',
    label: '城楼 / 台',
    keys: ['铜雀台', '城楼', '城墙', '宫', '殿'],
    scene: 'an ancient chinese tower standing against a dramatic sky, its eaves sharp in silhouette',
    palette: ['#100e0a', '#78350f', '#fde68a'],
    art: 'tower',
    mood: '厚重、历史',
  },
  {
    id: 'store',
    label: '便利店 / 货架',
    keys: ['便利店', '货架', '收银台', '店员', '超市'],
    scene: 'a convenience store glowing at night, shelves and counter visible through its glass front',
    palette: ['#0d1410', '#15803d', '#fef9c3'],
    art: 'store',
    mood: '暖光、孤独',
  },
  {
    id: 'crowd',
    label: '人群',
    keys: ['人群', '人群里', '人群'],
    scene: 'a blurred crowd moving through a passage, one figure standing still against the flow',
    palette: ['#0c0e16', '#475569', '#e2e8f0'],
    art: 'corridor',
    mood: '拥挤、疏离',
  },
];

const MOTIF_BY_ID = new Map(MOTIFS.map((m) => [m.id, m]));

/** 实拍素材检索词（Wikimedia Commons，英文命中率更高） */
const SEARCH_TERMS: Record<string, string[]> = {
  rain: ['rain on window glass', 'rain window night'],
  window: ['window night city', 'window condensation'],
  streetlamp: ['street lamp night rain', 'street light night'],
  shadow: ['long shadow street night', 'silhouette street night'],
  neon: ['neon signs night street', 'neon lights city'],
  city: ['city street night rain', 'empty city street night'],
  traffic: ['car light trails night', 'traffic long exposure'],
  corridor: ['apartment corridor', 'elevator lobby interior'],
  night: ['night city lights aerial', 'night sky city glow'],
  dawn: ['sunrise city skyline', 'dawn sky over city'],
  summer: ['summer tree sunlight', 'cicada summer afternoon'],
  leaves: ['plane tree leaves backlight', 'tree leaves sunlight'],
  bicycle: ['bicycle road', 'cyclist road sunset'],
  shirt: ['white shirt wind', 'white shirt sunlight'],
  letter: ['handwritten letter envelope', 'old letters paper'],
  clouds: ['cumulus clouds sky', 'clouds sky summer'],
  track: ['school running track', 'athletics track dusk'],
  soda: ['soda glass bottle', 'sparkling water glass bubbles'],
  clock: ['old wall clock', 'antique clock pendulum'],
  jasmine: ['jasmine flowers', 'flowers balcony evening'],
  autumn: ['autumn leaves falling', 'autumn leaves ground'],
  paperboat: ['paper boat water', 'origami boat water'],
  pocket: ['hand coat pocket', 'folding fabric hands'],
  station: ['train station platform night', 'railway platform'],
  umbrella: ['umbrella rain night street', 'person umbrella rain'],
  mountain: ['mountain ridges mist', 'mountain landscape fog'],
  river: ['Yangtze river gorge', 'river landscape china'],
  boat: ['small boat river china', 'wooden boat river'],
  moon: ['moon river night', 'moonlight water'],
  willow: ['willow tree water', 'willow branches river'],
  bridge: ['stone bridge mist china', 'chinese stone bridge'],
  ceiling: ['ceiling morning light room', 'bedroom ceiling light'],
  breath: ['empty room light dust', 'silence interior light'],
  phone: ['smartphone screen dark', 'phone glowing dark'],
  wind: ['wind grass field', 'fabric wind'],
  running: ['running shoes road', 'runner legs road'],
  heartbeat: ['abstract bokeh light', 'light trails abstract'],
  sea: ['sea horizon clouds', 'ocean horizon'],
  wilderness: ['wasteland mountains path', 'empty wilderness road'],
  stars: ['starry sky night', 'stars night sky landscape'],
  fire: ['fire embers smoke', 'bonfire night embers'],
  battle: ['Battle of Red Cliffs', 'ancient chinese warship'],
  tower: ['chinese pagoda', 'ancient chinese tower'],
  store: ['convenience store night', 'supermarket shelves night'],
  crowd: ['crowd street motion blur', 'people walking crowd'],
};

for (const motif of MOTIFS) {
  const terms = SEARCH_TERMS[motif.id];
  if (terms) motif.search = terms;
}

export function getMotif(id: string): VisualMotifDef | undefined {
  return MOTIF_BY_ID.get(id);
}

export interface MotifHit {
  def: VisualMotifDef;
  matched: string;
}

/** 从一段中文里找出具象视觉母题（按出现顺序去重） */
export function findMotifs(text: string, limit = 3): MotifHit[] {
  const hits: MotifHit[] = [];
  const seen = new Set<string>();
  const normalized = text.replace(/\s+/g, '');
  // 同一段里先匹配长关键词，避免「灯」抢走「路灯」
  const candidates: { def: VisualMotifDef; key: string; index: number }[] = [];
  for (const def of MOTIFS) {
    for (const key of def.keys) {
      const index = normalized.indexOf(key);
      if (index >= 0) candidates.push({ def, key, index });
    }
  }
  candidates.sort((a, b) => a.index - b.index || b.key.length - a.key.length);
  for (const candidate of candidates) {
    if (seen.has(candidate.def.id)) continue;
    seen.add(candidate.def.id);
    hits.push({ def: candidate.def, matched: candidate.key });
    if (hits.length >= limit) break;
  }
  return hits;
}

export interface ShotVisualPlan {
  prompt: string;
  negativePrompt: string;
  palette: [string, string, string];
  anchors: string[];
  motifIds: ArtMotif[];
  /** 实拍素材检索词（英文），可被用户手动覆盖 */
  searchTerms: string[];
  titleHint?: string;
}

const CAMERA_EN: Record<string, string> = {
  远景: 'wide establishing shot',
  全景: 'full shot',
  中景: 'medium shot',
  近景: 'close-up',
  特写: 'extreme close-up',
  大特写: 'macro detail shot',
};

const MOTION_EN: Record<ShotMotion, string> = {
  'zoom-in': 'slow push in',
  'zoom-out': 'slow pull out',
  'pan-left': 'slow lateral pan left',
  'pan-right': 'slow lateral pan right',
  'drift-up': 'slow tilt up',
  static: 'locked-off static frame',
};

function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.replace('#', '').slice(i - 1, i + 1), 16));
  const pa = parse(a);
  const pb = parse(b);
  return `#${pa
    .map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** 由预设色板与母题色板合成该镜头的专属色调 */
function blendPalette(preset: StylePreset, motifs: VisualMotifDef[], seed: number): [string, string, string] {
  const rand = mulberry32(seed);
  const base = motifs.find((m) => m.palette)?.palette;
  if (!base) {
    return [preset.palette[0], preset.palette[1], preset.palette[2]];
  }
  const t = 0.45 + rand() * 0.3;
  return [mixHex(preset.palette[0], base[0], 0.5), mixHex(preset.palette[1], base[1], t), mixHex(preset.palette[2], base[2], 0.5 + rand() * 0.4)];
}

/**
 * 生成一个镜头的画面方案：场景来自原句母题，构图/运镜来自镜头参数，色调来自母题。
 * 关键：prompt 里必须出现原句提炼出的具体场景，而不是只有风格词。
 */
export function buildShotVisual(input: {
  subtitle: string;
  preset: StylePreset;
  shotSize: string;
  motion: ShotMotion;
  mood: string;
  index: number;
  isHistory: boolean;
  avoid?: string[];
  seed?: number;
}): ShotVisualPlan {
  const { subtitle, preset, shotSize, motion, mood, index, isHistory, avoid = [] } = input;
  const seed = input.seed ?? hashString(subtitle + index);
  const hits = findMotifs(subtitle, 3);
  const defs = hits.map((h) => h.def);

  let scenes: string[];
  let anchors: string[];
  if (defs.length) {
    scenes = defs.map((d) => d.scene);
    anchors = defs.map((d) => d.label);
  } else {
    // 没有命中词典时，退化为「原文关键词 + 通用但具体的空间描述」
    const compact = subtitle.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ').trim();
    const words = compact
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .slice(0, 3);
    const fallbackScene = `an intimate cinematic frame illustrating the line "${subtitle.slice(0, 24)}"` +
      (words.length ? `, featuring ${words.join(' / ')}` : '');
    scenes = [fallbackScene];
    anchors = words.length ? words.slice(0, 2) : ['原文意象'];
  }

  // 历史题材追加考据约束
  const historyConstraint = isHistory
    ? 'period-accurate props and costumes, ancient Chinese setting, no modern objects or anachronisms'
    : '';
  const camera = CAMERA_EN[shotSize] ?? 'medium shot';
  const cameraMove = MOTION_EN[motion] ?? 'slow push in';
  const composition = ['wide establishing shot', 'full shot'].includes(camera)
    ? 'subject small in a large negative-space composition'
    : 'subject anchored on the rule-of-thirds intersection, foreground bokeh';

  const palette = blendPalette(preset, defs, seed);
  const paletteDesc = `color palette ${palette.join(' / ')}, cohesive cinematic grade`;
  const styleDesc = preset.descriptors.length
    ? preset.descriptors.join(', ')
    : 'naturalistic cinematography, restrained color, fine film grain';

  const prompt = [
    scenes.join('; '),
    composition,
    `${camera}, ${cameraMove}`,
    `emotional beat: ${mood || '克制'}`,
    paletteDesc,
    styleDesc,
    historyConstraint,
    QUALITY,
  ]
    .filter(Boolean)
    .join(', ');

  const negativePrompt = [
    ...preset.negative,
    ...avoid,
    'abstract wallpaper', 'subjectless blur', 'random gradient', 'generic stock photo',
    'text', 'watermark', 'logo',
  ].join(', ');

  return {
    prompt,
    negativePrompt,
    palette,
    anchors,
    motifIds: defs.map((d) => d.art),
    searchTerms: [...new Set(defs.flatMap((d) => d.search ?? []))].slice(0, 4),
  };
}

const QUALITY =
  'cinematic lighting, shallow depth of field, 35mm film still, high dynamic range, detailed texture, award-winning cinematography, 8k';

/** 分析阶段用：从整篇文案提取「具象意象」与色彩故事 */
export function summarizeVisuals(lines: string[], preset: StylePreset): {
  imagery: string[];
  colorStory: string[];
  anchors: string[];
  motifIds: ArtMotif[];
} {
  const counts = new Map<string, { def: VisualMotifDef; count: number }>();
  for (const line of lines) {
    for (const hit of findMotifs(line, 4)) {
      const entry = counts.get(hit.def.id);
      if (entry) entry.count += 1;
      else counts.set(hit.def.id, { def: hit.def, count: 1 });
    }
  }
  const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, 6).map((e) => e.def);
  const imagery = top.map((d) => `${d.label}：${d.scene}`);
  const palettes = top.filter((d) => d.palette).map((d) => d.palette!);
  const colorStory = palettes.length
    ? palettes.slice(0, 3).map((p, i) => `${['冷', '中', '暖'][i] || '中'}调 ${p[1]}`)
    : preset.palette.map((hex, i) => `${['冷', '中', '暖'][i] || '中'}调 ${hex}`);
  return {
    imagery: imagery.length ? imagery : preset.descriptors.slice(0, 5),
    colorStory,
    anchors: top.map((d) => d.label),
    motifIds: top.map((d) => d.art),
  };
}

/** 给已有分镜补足「原文依据」（用于 DeepSeek 返回的分镜做二次校验） */
export function enrichShotWithSource(shot: { subtitle: string; prompt: string; negativePrompt: string; palette: [string, string, string]; index: number }, preset: StylePreset, isHistory: boolean): {
  prompt: string;
  negativePrompt: string;
  palette: [string, string, string];
  anchors: string[];
  motifIds: ArtMotif[];
} {
  const plan = buildShotVisual({
    subtitle: shot.subtitle,
    preset,
    shotSize: '中景',
    motion: 'zoom-in',
    mood: '',
    index: shot.index,
    isHistory,
  });
  const prompt = shot.prompt.includes(plan.anchors[0] ?? '\u0000') ? shot.prompt : `${shot.prompt}, ${plan.prompt.split(',').slice(0, 6).join(',')}`;
  return {
    prompt,
    negativePrompt: shot.negativePrompt || plan.negativePrompt,
    palette: shot.palette?.length === 3 ? shot.palette : plan.palette,
    anchors: plan.anchors,
    motifIds: plan.motifIds,
  };
}
