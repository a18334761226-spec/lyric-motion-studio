/**
 * 文本 → 美术风格（代码绘制路线的“美术指导”）。
 *
 * 每句歌词先判断情绪 / 意象 / 时间，再决定这一镜的风格：
 * 火战暗红、室内暖光、幽绿魂光、雨夜、黄昏、清晨、水墨、夜蓝。
 * 风格不同 → 色板、光影、后处理、构图都不同，避免全片一个预制模板。
 */

export type ArtStyle =
  | 'ink'
  | 'night'
  | 'dusk'
  | 'rain'
  | 'ember'
  | 'warm'
  | 'dawn'
  | 'spirit'
  | 'cyber';

export interface ArtDirection {
  style: ArtStyle;
  mood: string;
  reason: string;
}

const RULES: { test: RegExp; style: ArtStyle; mood: string; reason: string }[] = [
  { test: /赤壁|剑|血|伤|战场|旗|刃/, style: 'ember', mood: '燃/痛', reason: '剑、血、战场 → 火战暗红' },
  { test: /醇酒|酒|饮恨|烛|杯|醉/, style: 'warm', mood: '暖', reason: '酒与烛 → 室内暖光' },
  { test: /魂|转世|轮回|前世/, style: 'spirit', mood: '幽', reason: '魂、转世 → 幽绿雾光' },
  { test: /策马|出征|马蹄/, style: 'dusk', mood: '壮', reason: '策马出征 → 黄昏长路' },
  { test: /泪|雨|哭|湿|伞/, style: 'rain', mood: '悲', reason: '泪与雨 → 雨夜冷调' },
  { test: /缘|眼神|对的人|确认|心跳/, style: 'dawn', mood: '柔', reason: '缘分、对视 → 清晨柔光' },
  { test: /落叶|青春|踩过|秋/, style: 'dusk', mood: '怅', reason: '落叶 → 黄昏暖橙' },
  { test: /月|月光|青石|山城|夜|星/, style: 'night', mood: '静', reason: '月光山城 → 夜蓝月色' },
  { test: /前朝|记忆|红尘|回忆|老树|书|碑|墨|洛阳/, style: 'ink', mood: '古', reason: '前朝记忆 → 水墨宣纸' },
];

/** 关键词没命中时，按场景类型兜底，保证风格和内容一致 */
const SCENE_STYLE: Record<string, ArtStyle> = {
  'autumn-leaves': 'dusk',
  'tear-rain': 'rain',
  'eyes-meet': 'dawn',
  'red-thread': 'dawn',
  swordsman: 'ember',
  'sword-wound': 'ember',
  'fire-battle': 'ember',
  'scroll-memory': 'ink',
  'old-tree': 'ink',
  'stone-alley': 'night',
  'horse-rider': 'dusk',
  'wine-jar': 'warm',
  candle: 'warm',
  'ghost-light': 'spirit',
  heartbeat: 'dawn',
  'winding-road': 'dusk',
  title: 'night',
};

export function directStyle(line: string, index = 0, _prompt?: string, sceneType?: string): ArtDirection {
  for (const r of RULES) {
    if (r.test.test(line)) return { style: r.style, mood: r.mood, reason: r.reason };
  }
  if (sceneType && SCENE_STYLE[sceneType]) {
    const style = SCENE_STYLE[sceneType];
    return { style, mood: '平', reason: `按场景「${sceneType}」定调` };
  }
  const fallback: ArtStyle[] = ['ink', 'night', 'dusk', 'rain', 'warm', 'dawn', 'spirit'];
  return { style: fallback[index % fallback.length], mood: '平', reason: '未命中意象，按段落轮换' };
}
