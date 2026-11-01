/**
 * 纯代码 SVG 山水插画系统。
 *
 * 设计语言（对齐参考图）：大渐变天空 → 层叠远山 + 雾 → 水面与倒影 →
 * 小小的剪影人物 / 楼阁 / 舟 / 树 / 城墙 → 前景芦苇枝影 → 纸纹颗粒 + 暗角。
 * 全部由 TS 拼 SVG，Chrome 无头光栅化成 1080×1920，不依赖任何 AI 模型。
 */

export type SvgSceneType =
  | 'eyes-meet'
  | 'swordsman'
  | 'tear-rain'
  | 'autumn-leaves'
  | 'old-tree'
  | 'stone-alley'
  | 'horse-rider'
  | 'wine-jar'
  | 'sword-wound'
  | 'scroll-memory'
  | 'red-thread'
  | 'ghost-light'
  | 'candle'
  | 'fire-battle'
  | 'title';

export interface SvgSceneSpec {
  type: SvgSceneType;
  style?: string;
  seed: number;
  variant?: number;
  title?: string;
  artist?: string;
  chapter?: string;
  subtitle?: string;
}

const W = 1080;
const H = 1920;
const HZ = 0.58 * H; // 地平线

interface Pal {
  name: string;
  sky: [string, string, string];
  light: string;
  glow: string;
  far: string;
  mid: string;
  near: string;
  waterTop: string;
  waterBottom: string;
  mist: string;
  ink: string;
}

const PALS: Pal[] = [
  {
    name: 'night',
    sky: ['#050912', '#0d1b2c', '#26404f'],
    light: '#f4f1e2',
    glow: '#a8c8f0',
    far: '#16283a',
    mid: '#0e1a28',
    near: '#070d16',
    waterTop: '#1c3244',
    waterBottom: '#04070c',
    mist: '#7e99b0',
    ink: '#06070c',
  },
  {
    name: 'dusk',
    sky: ['#1a1226', '#4c2e46', '#c97858'],
    light: '#ffe2b4',
    glow: '#ff9a5c',
    far: '#2e2138',
    mid: '#1c1426',
    near: '#0c0814',
    waterTop: '#8a5a5c',
    waterBottom: '#120c16',
    mist: '#c09a9a',
    ink: '#0a0810',
  },
  {
    name: 'dawn',
    sky: ['#1a2038', '#5e4560', '#e8a07e'],
    light: '#fff0d8',
    glow: '#ffb47a',
    far: '#3a2e46',
    mid: '#241e32',
    near: '#100c18',
    waterTop: '#9c6a6e',
    waterBottom: '#161018',
    mist: '#d0aaaa',
    ink: '#0c0810',
  },
  {
    name: 'misty',
    sky: ['#25343e', '#4e6670', '#9cb0b4'],
    light: '#f0f4f0',
    glow: '#c8dcdc',
    far: '#3c505c',
    mid: '#26363e',
    near: '#101a1e',
    waterTop: '#4a626c',
    waterBottom: '#0a1214',
    mist: '#a8bcc0',
    ink: '#0a1012',
  },
];


const STYLE_PALS: Record<string, Pal> = {
  ink: {
    name: 'ink', sky: ['#efe7d2', '#e3d8bf', '#cfc0a4'], light: '#f7f2e4', glow: '#d8c9a8',
    far: '#b4a98f', mid: '#8d8270', near: '#5f5749', waterTop: '#c9bda2', waterBottom: '#a89b82',
    mist: '#e8e0cc', ink: '#2a2620',
  },
  ember: {
    name: 'ember', sky: ['#120808', '#2e1010', '#6a2218'], light: '#ffd0a0', glow: '#ff6a3a',
    far: '#3a1414', mid: '#240c0c', near: '#0c0505', waterTop: '#4a1a14', waterBottom: '#0a0404',
    mist: '#8a3a2a', ink: '#070404',
  },
  warm: {
    name: 'warm', sky: ['#1a1008', '#3a2414', '#8a5a2a'], light: '#ffe2b4', glow: '#ffb45a',
    far: '#3a2a1a', mid: '#241a10', near: '#0e0a06', waterTop: '#5a4024', waterBottom: '#120c08',
    mist: '#a0825a', ink: '#0a0806',
  },
  dawn: {
    name: 'dawn', sky: ['#3a2a44', '#b07a84', '#ffd0a8'], light: '#fff4e0', glow: '#ffc08a',
    far: '#8a6a78', mid: '#5a4658', near: '#2a2030', waterTop: '#c99a92', waterBottom: '#4a3644',
    mist: '#e8c8c0', ink: '#1c1620',
  },
  spirit: {
    name: 'spirit', sky: ['#0a1410', '#12241e', '#2a4a3e'], light: '#e0fff0', glow: '#7affc8',
    far: '#1a2e28', mid: '#101e1a', near: '#060c0a', waterTop: '#123028', waterBottom: '#04080a',
    mist: '#6a9a88', ink: '#040806',
  },
  cyber: {
    name: 'cyber', sky: ['#0a0618', '#1a0e3a', '#3a1a5a'], light: '#e0f0ff', glow: '#ff3a9a',
    far: '#1a1230', mid: '#100a20', near: '#06040c', waterTop: '#1a1440', waterBottom: '#04020a',
    mist: '#8a4ac0', ink: '#04020a',
  },
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function f(n: number): string {
  return n.toFixed(1);
}

interface Ctx {
  id: string;
  pal: Pal;
  seed: number;
  out: string[];
}

function defs(c: Ctx): void {
  const p = c.pal;
  c.out.push(`<defs>
    <linearGradient id="sky${c.id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.sky[0]}"/>
      <stop offset="0.62" stop-color="${p.sky[1]}"/>
      <stop offset="1" stop-color="${p.sky[2]}"/>
    </linearGradient>
    <linearGradient id="water${c.id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.waterTop}"/>
      <stop offset="0.45" stop-color="${p.waterTop}" stop-opacity="0.65"/>
      <stop offset="1" stop-color="${p.waterBottom}"/>
    </linearGradient>
    <radialGradient id="glow${c.id}">
      <stop offset="0" stop-color="${p.glow}" stop-opacity="0.55"/>
      <stop offset="0.45" stop-color="${p.glow}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${p.glow}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="refl${c.id}">
      <stop offset="0" stop-color="${p.light}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${p.light}" stop-opacity="0"/>
    </radialGradient>
    <filter id="blurL${c.id}"><feGaussianBlur stdDeviation="26"/></filter>
    <filter id="blurS${c.id}"><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="grain${c.id}">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.06"/></feComponentTransfer>
    </filter>
    <radialGradient id="vig${c.id}" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.5" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.6"/>
    </radialGradient>
  </defs>`);
}

function sky(c: Ctx): void {
  c.out.push(`<rect width="${W}" height="${H}" fill="url(#sky${c.id})"/>`);
}

function stars(c: Ctx, count = 70): void {
  const rand = rng(c.seed ^ 0x9e37);
  let s = '';
  for (let i = 0; i < count; i++) {
    const x = rand() * W;
    const y = rand() * HZ * 0.9;
    const r = rand() > 0.86 ? 2.6 : 1.2;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="#f2f6ff" opacity="${(0.25 + rand() * 0.55).toFixed(2)}"/>`;
  }
  c.out.push(s);
}

function celestial(c: Ctx, x: number, y: number, r: number): void {
  c.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 6)}" fill="url(#glow${c.id})"/>`);
  c.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${c.pal.light}"/>`);
  c.out.push(`<circle cx="${f(x - r * 0.22)}" cy="${f(y - r * 0.18)}" r="${f(r * 0.16)}" fill="${c.pal.light}" opacity="0.35"/>`);
}

function clouds(c: Ctx, n = 4): void {
  const rand = rng(c.seed ^ 0x51ed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = rand() * W;
    const y = HZ * (0.18 + rand() * 0.45);
    const rx = 180 + rand() * 260;
    const ry = 16 + rand() * 26;
    s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${c.pal.mist}" opacity="${(0.1 + rand() * 0.12).toFixed(2)}" filter="url(#blurL${c.id})"/>`;
  }
  c.out.push(s);
}

function ridgePath(seed: number, baseY: number, amp: number): string {
  const rand = rng(seed);
  const pts: [number, number][] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) pts.push([(W / n) * i, baseY - rand() * amp]);
  let d = `M0 ${H} L0 ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` Q ${f(cx)} ${f(Math.min(y0, y1) - amp * 0.5)} ${f(x1)} ${f(y1)}`;
  }
  d += ` L${W} ${H} Z`;
  return d;
}

function ridges(c: Ctx): void {
  const p = c.pal;
  c.out.push(`<path d="${ridgePath(c.seed + 1, HZ - 70, 120)}" fill="${p.far}" opacity="0.85"/>`);
  c.out.push(`<path d="${ridgePath(c.seed + 2, HZ - 30, 90)}" fill="${p.mid}" opacity="0.9"/>`);
  c.out.push(`<rect x="-40" y="${f(HZ - 90)}" width="${W + 80}" height="120" fill="${p.mist}" opacity="0.16" filter="url(#blurL${c.id})"/>`);
  c.out.push(`<path d="${ridgePath(c.seed + 3, HZ + 30, 50)}" fill="${p.near}" opacity="0.95"/>`);
}

function water(c: Ctx, reflectionX = W * 0.5): void {
  const p = c.pal;
  c.out.push(`<rect x="0" y="${f(HZ)}" width="${W}" height="${f(H - HZ)}" fill="url(#water${c.id})"/>`);
  c.out.push(`<ellipse cx="${f(reflectionX)}" cy="${f(HZ + 40)}" rx="${f(W * 0.22)}" ry="${f(H * 0.28)}" fill="url(#refl${c.id})" opacity="0.55"/>`);
  const rand = rng(c.seed ^ 0x77aa);
  let s = '';
  for (let i = 0; i < 46; i++) {
    const y = HZ + 20 + rand() * (H - HZ - 40);
    const t = (y - HZ) / (H - HZ);
    const w = 30 + rand() * (120 + t * 160);
    const x = reflectionX + (rand() - 0.5) * (260 + t * 500);
    s += `<rect x="${f(x - w / 2)}" y="${f(y)}" width="${f(w)}" height="${(1.5 + t * 2.5).toFixed(1)}" fill="${p.light}" opacity="${(0.05 + rand() * 0.09).toFixed(2)}"/>`;
  }
  c.out.push(s);
  // 水与天的交界亮线
  c.out.push(`<rect x="0" y="${f(HZ)}" width="${W}" height="2" fill="${p.light}" opacity="0.25"/>`);
}

function reeds(c: Ctx, color?: string): void {
  const rand = rng(c.seed ^ 0x1234);
  const col = color ?? c.pal.ink;
  let s = '';
  for (let i = 0; i < 26; i++) {
    const left = i % 2 === 0;
    const x = left ? rand() * W * 0.22 : W - rand() * W * 0.22;
    const baseY = H * (0.92 + rand() * 0.08);
    const h = 140 + rand() * 240;
    const bend = (rand() - 0.5) * 90;
    s += `<path d="M ${f(x)} ${f(baseY)} Q ${f(x + bend * 0.4)} ${f(baseY - h * 0.6)} ${f(x + bend)} ${f(baseY - h)}" stroke="${col}" stroke-width="${(3 + rand() * 3).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
  }
  c.out.push(s);
}

function birds(c: Ctx, n = 3): void {
  const rand = rng(c.seed ^ 0xbeef);
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = W * (0.15 + rand() * 0.7);
    const y = H * (0.12 + rand() * 0.2);
    const w = 12 + rand() * 12;
    s += `<path d="M ${f(x - w)} ${f(y)} Q ${f(x - w * 0.4)} ${f(y - w * 0.5)} ${f(x)} ${f(y)} Q ${f(x + w * 0.4)} ${f(y - w * 0.5)} ${f(x + w)} ${f(y)}" stroke="${c.pal.ink}" stroke-width="2.4" fill="none" opacity="0.8"/>`;
  }
  c.out.push(s);
}

function particles(c: Ctx, color: string, n = 40): void {
  const rand = rng(c.seed ^ 0xd00d);
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = rand() * W;
    const y = rand() * H;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${(0.8 + rand() * 2).toFixed(1)}" fill="${color}" opacity="${(0.1 + rand() * 0.35).toFixed(2)}"/>`;
  }
  c.out.push(s);
}

/* ---------------- 剪影主体 ---------------- */

/** 立姿人物（h 为身高像素） */
function person(c: Ctx, x: number, baseY: number, h: number, opts: { umbrella?: boolean; hair?: 'bun' | 'long' } = {}): string {
  const ink = c.pal.ink;
  const hd = h * 0.095;
  const shoulderY = baseY - h * 0.76;
  const waistY = baseY - h * 0.5;
  const hemY = baseY - h * 0.04;
  const hairStyle = opts.hair ?? 'long';
  let s = '';
  // 长袍 / 身躯
  s += `<path d="M ${f(x - h * 0.075)} ${f(shoulderY)}
          C ${f(x - h * 0.14)} ${f(shoulderY + h * 0.04)} ${f(x - h * 0.12)} ${f(waistY)} ${f(x - h * 0.17)} ${f(hemY)}
          Q ${f(x)} ${f(hemY + h * 0.03)} ${f(x + h * 0.17)} ${f(hemY)}
          C ${f(x + h * 0.12)} ${f(waistY)} ${f(x + h * 0.14)} ${f(shoulderY + h * 0.04)} ${f(x + h * 0.075)} ${f(shoulderY)} Z"
        fill="${ink}"/>`;
  // 袖
  s += `<path d="M ${f(x - h * 0.1)} ${f(shoulderY + h * 0.03)}
          C ${f(x - h * 0.19)} ${f(shoulderY + h * 0.12)} ${f(x - h * 0.17)} ${f(shoulderY + h * 0.26)} ${f(x - h * 0.13)} ${f(shoulderY + h * 0.3)}
          C ${f(x - h * 0.08)} ${f(shoulderY + h * 0.24)} ${f(x - h * 0.06)} ${f(shoulderY + h * 0.12)} ${f(x - h * 0.05)} ${f(shoulderY + h * 0.06)} Z"
        fill="${ink}"/>`;
  // 脖颈
  s += `<rect x="${f(x - h * 0.025)}" y="${f(shoulderY - h * 0.045)}" width="${f(h * 0.05)}" height="${f(h * 0.06)}" fill="${ink}"/>`;
  // 头
  s += `<ellipse cx="${f(x)}" cy="${f(shoulderY - h * 0.13)}" rx="${f(hd)}" ry="${f(hd * 1.12)}" fill="${ink}"/>`;
  if (hairStyle === 'bun') {
    s += `<circle cx="${f(x - h * 0.01)}" cy="${f(shoulderY - h * 0.235)}" r="${f(hd * 0.55)}" fill="${ink}"/>`;
  } else {
    s += `<path d="M ${f(x - hd)} ${f(shoulderY - h * 0.16)}
            C ${f(x - hd * 1.5)} ${f(shoulderY + h * 0.02)} ${f(x - hd * 1.2)} ${f(shoulderY + h * 0.1)} ${f(x - hd * 0.9)} ${f(shoulderY + h * 0.16)}
            C ${f(x - hd * 0.9)} ${f(shoulderY - h * 0.02)} ${f(x - hd * 0.6)} ${f(shoulderY - h * 0.1)} ${f(x - hd * 0.7)} ${f(shoulderY - h * 0.2)} Z"
          fill="${ink}"/>`;
  }
  if (opts.umbrella) {
    const uy = shoulderY - h * 0.34;
    s += `<path d="M ${f(x - h * 0.2)} ${f(uy)} Q ${f(x)} ${f(uy - h * 0.1)} ${f(x + h * 0.2)} ${f(uy)} Z" fill="${ink}"/>`;
    s += `<rect x="${f(x - 1)}" y="${f(uy)}" width="3" height="${f(h * 0.34)}" fill="${ink}"/>`;
  }
  return s;
}

function boat(c: Ctx, x: number, y: number, s = 1): string {
  const ink = c.pal.ink;
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})">
    <path d="M -120 0 C -70 34 70 34 120 0 L 88 10 C 44 22 -44 22 -88 10 Z" fill="${ink}"/>
    <path d="M -70 4 C -40 -52 40 -52 70 4 Z" fill="${ink}"/>
    <rect x="-2" y="-70" width="4" height="70" fill="${ink}"/>
    ${person(c, 30, 0, 120, { hair: 'bun' })}
    <rect x="46" y="-150" width="3" height="150" fill="${ink}"/>
  </g>`;
}

function pavilion(c: Ctx, x: number, y: number, s = 1): string {
  const ink = c.pal.ink;
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})">
    <path d="M -110 0 Q -70 -70 0 -84 Q 70 -70 110 0 L 84 0 Q 60 -50 0 -60 Q -60 -50 -84 0 Z" fill="${ink}"/>
    <rect x="-84" y="-4" width="10" height="60" fill="${ink}"/>
    <rect x="74" y="-4" width="10" height="60" fill="${ink}"/>
    <rect x="-24" y="-14" width="48" height="10" fill="${ink}"/>
    <circle cx="0" cy="14" r="10" fill="${c.pal.glow}" opacity="0.8"/>
  </g>`;
}

function tree(c: Ctx, x: number, baseY: number, h: number, leafColor?: string, trunkColor?: string): string {
  const ink = trunkColor ?? c.pal.ink;
  const leaf = leafColor ?? c.pal.ink;
  const rand = rng(c.seed ^ 0x7ea1);
  let s = `<path d="M ${f(x)} ${f(baseY)} C ${f(x - h * 0.02)} ${f(baseY - h * 0.35)} ${f(x + h * 0.02)} ${f(baseY - h * 0.6)} ${f(x - h * 0.01)} ${f(baseY - h * 0.8)}" stroke="${ink}" stroke-width="${f(h * 0.055)}" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < 5; i++) {
    const by = baseY - h * (0.4 + i * 0.1);
    const dir = i % 2 === 0 ? -1 : 1;
    s += `<path d="M ${f(x)} ${f(by)} Q ${f(x + dir * h * 0.14)} ${f(by - h * 0.1)} ${f(x + dir * h * 0.26)} ${f(by - h * 0.2)}" stroke="${ink}" stroke-width="${f(h * 0.024)}" fill="none" stroke-linecap="round"/>`;
  }
  for (let i = 0; i < 28; i++) {
    const lx = x + (rand() - 0.5) * h * 0.62;
    const ly = baseY - h * (0.52 + rand() * 0.4);
    const rx = 26 + rand() * 34;
    const ry = 13 + rand() * 16;
    s += `<ellipse cx="${f(lx)}" cy="${f(ly)}" rx="${f(rx)}" ry="${f(ry)}" fill="${leaf}" opacity="${leafColor ? 1 : 0.95}"/>`;
  }
  return s;
}

function wall(c: Ctx, y: number): string {
  const ink = c.pal.ink;
  let s = `<rect x="0" y="${f(y)}" width="${W}" height="${f(H - y)}" fill="${ink}"/>`;
  for (let x = 0; x < W; x += 60) s += `<rect x="${x}" y="${f(y - 22)}" width="34" height="24" fill="${ink}"/>`;
  const gx = W * 0.5;
  s += `<path d="M ${f(gx - 90)} ${f(H)} L ${f(gx - 90)} ${f(y + 120)} Q ${f(gx)} ${f(y + 20)} ${f(gx + 90)} ${f(y + 120)} L ${f(gx + 90)} ${f(H)} Z" fill="${c.pal.waterBottom}"/>`;
  return s;
}

function swordsman(c: Ctx, x: number, baseY: number, h: number): string {
  const ink = c.pal.ink;
  let s = '';
  // 披风
  s += `<path d="M ${f(x - h * 0.06)} ${f(baseY - h * 0.72)}
          C ${f(x - h * 0.34)} ${f(baseY - h * 0.5)} ${f(x - h * 0.38)} ${f(baseY - h * 0.18)} ${f(x - h * 0.24)} ${f(baseY - h * 0.02)}
          C ${f(x - h * 0.14)} ${f(baseY - h * 0.2)} ${f(x - h * 0.06)} ${f(baseY - h * 0.42)} ${f(x)} ${f(baseY - h * 0.56)} Z"
        fill="#7a1e28" opacity="0.92"/>`;
  s += `<path d="M ${f(x - h * 0.09)} ${f(baseY - h * 0.74)}
          C ${f(x - h * 0.13)} ${f(baseY - h * 0.4)} ${f(x - h * 0.1)} ${f(baseY - h * 0.12)} ${f(x - h * 0.12)} ${f(baseY)}
          Q ${f(x)} ${f(baseY + h * 0.02)} ${f(x + h * 0.11)} ${f(baseY)}
          C ${f(x + h * 0.09)} ${f(baseY - h * 0.4)} ${f(x + h * 0.12)} ${f(baseY - h * 0.72)} ${f(x + h * 0.08)} ${f(baseY - h * 0.76)} Z"
        fill="${ink}"/>`;
  s += `<circle cx="${f(x)}" cy="${f(baseY - h * 0.86)}" r="${f(h * 0.09)}" fill="${ink}"/>`;
  s += `<path d="M ${f(x - h * 0.09)} ${f(baseY - h * 0.9)} Q ${f(x)} ${f(baseY - h * 0.97)} ${f(x + h * 0.1)} ${f(baseY - h * 0.9)}" stroke="${ink}" stroke-width="${f(h * 0.04)}" fill="none"/>`;
  // 手臂 + 剑
  s += `<path d="M ${f(x + h * 0.06)} ${f(baseY - h * 0.68)} L ${f(x + h * 0.24)} ${f(baseY - h * 0.56)}" stroke="${ink}" stroke-width="${f(h * 0.05)}" stroke-linecap="round"/>`;
  s += `<path d="M ${f(x + h * 0.22)} ${f(baseY - h * 0.57)} L ${f(x + h * 0.46)} ${f(baseY - h * 0.86)}" stroke="#e6eefc" stroke-width="${f(h * 0.018)}" stroke-linecap="round"/>`;
  return s;
}

function horseRider(c: Ctx, x: number, baseY: number, h: number): string {
  const ink = c.pal.ink;
  let s = '';
  s += `<path d="M ${f(x - h * 0.3)} ${f(baseY - h * 0.26)}
          C ${f(x - h * 0.34)} ${f(baseY - h * 0.4)} ${f(x - h * 0.14)} ${f(baseY - h * 0.5)} ${f(x + h * 0.08)} ${f(baseY - h * 0.48)}
          C ${f(x + h * 0.22)} ${f(baseY - h * 0.47)} ${f(x + h * 0.3)} ${f(baseY - h * 0.4)} ${f(x + h * 0.32)} ${f(baseY - h * 0.3)}
          L ${f(x + h * 0.24)} ${f(baseY - h * 0.08)} L ${f(x + h * 0.16)} ${f(baseY - h * 0.08)}
          L ${f(x + h * 0.14)} ${f(baseY - h * 0.24)} L ${f(x - h * 0.08)} ${f(baseY - h * 0.22)}
          L ${f(x - h * 0.1)} ${f(baseY - h * 0.06)} L ${f(x - h * 0.19)} ${f(baseY - h * 0.06)}
          L ${f(x - h * 0.2)} ${f(baseY - h * 0.22)} Z"
        fill="${ink}"/>`;
  // 颈与头
  s += `<path d="M ${f(x + h * 0.24)} ${f(baseY - h * 0.42)} L ${f(x + h * 0.4)} ${f(baseY - h * 0.62)} L ${f(x + h * 0.48)} ${f(baseY - h * 0.58)} L ${f(x + h * 0.36)} ${f(baseY - h * 0.38)} Z" fill="${ink}"/>`;
  s += `<path d="M ${f(x + h * 0.38)} ${f(baseY - h * 0.66)} L ${f(x + h * 0.5)} ${f(baseY - h * 0.62)}" stroke="${ink}" stroke-width="${f(h * 0.04)}" stroke-linecap="round"/>`;
  // 骑手
  s += `<ellipse cx="${f(x + h * 0.02)}" cy="${f(baseY - h * 0.72)}" rx="${f(h * 0.055)}" ry="${f(h * 0.06)}" fill="${ink}"/>`;
  s += `<path d="M ${f(x - h * 0.06)} ${f(baseY - h * 0.64)} L ${f(x + h * 0.1)} ${f(baseY - h * 0.64)} L ${f(x + h * 0.08)} ${f(baseY - h * 0.46)} L ${f(x - h * 0.05)} ${f(baseY - h * 0.46)} Z" fill="${ink}"/>`;
  return s;
}

function lanterns(c: Ctx, n = 6, yBase = H * 0.78): string {
  const rand = rng(c.seed ^ 0x1a2b);
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = W * (0.12 + rand() * 0.76);
    const y = yBase + rand() * 120;
    const r = 10 + rand() * 8;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 4)}" fill="${c.pal.glow}" opacity="0.12" filter="url(#blurS${c.id})"/>`;
    s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r)}" ry="${f(r * 1.25)}" fill="#f0b060"/>`;
    s += `<ellipse cx="${f(x)}" cy="${f(y + r * 2.6)}" rx="${f(r * 0.6)}" ry="${f(r * 2.4)}" fill="${c.pal.light}" opacity="0.12"/>`;
  }
  return s;
}

/* ---------------- 场景 ---------------- */

function landBase(c: Ctx, opts: { moonX?: number; moonY?: number; moonR?: number; withWater?: boolean; cloudsN?: number; birdsN?: number } = {}): void {
  sky(c);
  if (c.pal.name === 'night' || c.pal.name === 'misty') stars(c);
  celestial(c, opts.moonX ?? W * 0.72, opts.moonY ?? H * 0.2, opts.moonR ?? 42);
  clouds(c, opts.cloudsN ?? 4);
  ridges(c);
  if (opts.withWater !== false) {
    water(c, (opts.moonX ?? W * 0.72));
  } else {
    c.out.push(`<rect x="0" y="${f(HZ + 60)}" width="${W}" height="${f(H - HZ)}" fill="${c.pal.near}"/>`);
  }
  birds(c, opts.birdsN ?? 3);
}

function vignette(c: Ctx): void {
  c.out.push(`<rect width="${W}" height="${H}" fill="url(#vig${c.id})"/>`);
  c.out.push(`<rect width="${W}" height="${H}" filter="url(#grain${c.id})" opacity="0.55"/>`);
}

function roomBase(c: Ctx): void {
  const p = c.pal;
  c.out.push(`<rect width="${W}" height="${H}" fill="#100b09"/>`);
  c.out.push(`<rect width="${W}" height="${H}" fill="url(#sky${c.id})" opacity="0.28"/>`);
  // 地板
  c.out.push(`<rect x="0" y="${f(H * 0.72)}" width="${W}" height="${f(H * 0.28)}" fill="#0a0706"/>`);
  c.out.push(`<rect x="0" y="${f(H * 0.72)}" width="${W}" height="3" fill="${p.mist}" opacity="0.15"/>`);
  // 窗
  const wx = W * 0.62;
  const wy = H * 0.14;
  const ww = W * 0.28;
  const wh = H * 0.34;
  c.out.push(`<rect x="${f(wx)}" y="${f(wy)}" width="${f(ww)}" height="${f(wh)}" fill="url(#sky${c.id})"/>`);
  c.out.push(`<circle cx="${f(wx + ww * 0.66)}" cy="${f(wy + wh * 0.3)}" r="${f(ww * 0.29)}" fill="url(#glow${c.id})"/>`);
  c.out.push(`<circle cx="${f(wx + ww * 0.66)}" cy="${f(wy + wh * 0.3)}" r="${f(ww * 0.1)}" fill="${p.light}"/>`);
  c.out.push(`<path d="M ${f(wx)} ${f(wy + wh * 0.78)} Q ${f(wx + ww * 0.3)} ${f(wy + wh * 0.62)} ${f(wx + ww * 0.6)} ${f(wy + wh * 0.76)} T ${f(wx + ww)} ${f(wy + wh * 0.7)} L ${f(wx + ww)} ${f(wy + wh)} L ${f(wx)} ${f(wy + wh)} Z" fill="${p.near}" opacity="0.95"/>`);
  c.out.push(`<rect x="${f(wx)}" y="${f(wy)}" width="${f(ww)}" height="${f(wh)}" fill="none" stroke="#2a1a12" stroke-width="12"/>`);
  c.out.push(`<rect x="${f(wx + ww / 2 - 3)}" y="${f(wy)}" width="6" height="${f(wh)}" fill="#2a1a12"/>`);
  c.out.push(`<rect x="${f(wx - 16)}" y="${f(wy + wh)}" width="${f(ww + 32)}" height="16" fill="#241a16"/>`);
}

function seatedFigure(c: Ctx, x: number, baseY: number, h: number): string {
  const ink = c.pal.ink;
  return `<g>
    <ellipse cx="${f(x)}" cy="${f(baseY - h * 0.82)}" rx="${f(h * 0.09)}" ry="${f(h * 0.1)}" fill="${ink}"/>
    <path d="M ${f(x - h * 0.16)} ${f(baseY - h * 0.7)} C ${f(x - h * 0.2)} ${f(baseY - h * 0.5)} ${f(x - h * 0.18)} ${f(baseY - h * 0.28)} ${f(x - h * 0.2)} ${f(baseY - h * 0.08)}
      L ${f(x + h * 0.2)} ${f(baseY - h * 0.08)} C ${f(x + h * 0.16)} ${f(baseY - h * 0.32)} ${f(x + h * 0.14)} ${f(baseY - h * 0.52)} ${f(x + h * 0.12)} ${f(baseY - h * 0.66)} Z" fill="${ink}"/>
  </g>`;
}

export function buildSceneSvg(spec: SvgSceneSpec, id = 's'): string {
  const pal = (spec.style && STYLE_PALS[spec.style]) || PALS[((spec.variant ?? 0) % PALS.length + PALS.length) % PALS.length];
  const c: Ctx = { id, pal, seed: spec.seed || 1, out: [] };
  defs(c);

  switch (spec.type) {
    case 'eyes-meet': {
      landBase(c, { moonX: W * 0.74, moonY: H * 0.2, moonR: 44 });
      // 两人站在岸上对视
      c.out.push(`<path d="M 0 ${f(H * 0.86)} Q ${f(W * 0.5)} ${f(H * 0.8)} ${W} ${f(H * 0.87)} L ${W} ${H} L 0 ${H} Z" fill="${pal.ink}"/>`);
      c.out.push(person(c, W * 0.36, H * 0.85, 230, { hair: 'bun' }));
      c.out.push(person(c, W * 0.64, H * 0.85, 230, { hair: 'long' }));
      // 红线
      c.out.push(`<path d="M ${f(W * 0.4)} ${f(H * 0.72)} Q ${f(W * 0.5)} ${f(H * 0.75)} ${f(W * 0.6)} ${f(H * 0.72)}" stroke="#d83a4a" stroke-width="4" fill="none" opacity="0.85" filter="url(#blurS${id})"/>`);
      c.out.push(`<path d="M ${f(W * 0.4)} ${f(H * 0.72)} Q ${f(W * 0.5)} ${f(H * 0.75)} ${f(W * 0.6)} ${f(H * 0.72)}" stroke="#ff9aa2" stroke-width="1.6" fill="none" opacity="0.9"/>`);
      reeds(c);
      break;
    }
    case 'red-thread': {
      landBase(c, { moonX: W * 0.5, moonY: H * 0.18, moonR: 50 });
      c.out.push(`<path d="M 0 ${f(H * 0.84)} Q ${f(W * 0.32)} ${f(H * 0.78)} ${f(W * 0.5)} ${f(H * 0.84)} T ${W} ${f(H * 0.83)} L ${W} ${H} L 0 ${H} Z" fill="${pal.ink}"/>`);
      c.out.push(person(c, W * 0.3, H * 0.84, 220, { hair: 'long' }));
      c.out.push(person(c, W * 0.7, H * 0.84, 220, { hair: 'bun' }));
      c.out.push(`<path d="M ${f(W * 0.32)} ${f(H * 0.71)} C ${f(W * 0.42)} ${f(H * 0.8)} ${f(W * 0.6)} ${f(H * 0.8)} ${f(W * 0.68)} ${f(H * 0.71)}" stroke="#d83a4a" stroke-width="5" fill="none" opacity="0.8" filter="url(#blurS${id})"/>`);
      c.out.push(`<path d="M ${f(W * 0.32)} ${f(H * 0.71)} C ${f(W * 0.42)} ${f(H * 0.8)} ${f(W * 0.6)} ${f(H * 0.8)} ${f(W * 0.68)} ${f(H * 0.71)}" stroke="#ffb0b4" stroke-width="2" fill="none"/>`);
      reeds(c);
      break;
    }
    case 'tear-rain': {
      landBase(c, { moonX: W * 0.3, moonY: H * 0.18, moonR: 40 });
      const rand = rng(spec.seed ^ 0x88);
      let rainStr = '';
      for (let i = 0; i < 140; i++) {
        const x = rand() * W;
        const y = rand() * H;
        rainStr += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x - 10)}" y2="${f(y + 90)}" stroke="#9fb6d8" stroke-width="1.6" opacity="${(0.05 + rand() * 0.1).toFixed(2)}"/>`;
      }
      c.out.push(rainStr);
      c.out.push(person(c, W * 0.52, H * 0.86, 260, { umbrella: true, hair: 'long' }));
      c.out.push(`<path d="M 0 ${f(H * 0.86)} L ${W} ${f(H * 0.87)} L ${W} ${H} L 0 ${H} Z" fill="${pal.ink}"/>`);
      reeds(c);
      break;
    }
    case 'swordsman': {
      landBase(c, { moonX: W * 0.72, moonY: H * 0.2, moonR: 52, withWater: false });
      // 崖
      c.out.push(`<path d="M 0 ${f(H * 0.9)} Q ${f(W * 0.45)} ${f(H * 0.84)} ${f(W * 0.7)} ${f(H * 0.9)} L ${f(W * 0.7)} ${H} L 0 ${H} Z" fill="${pal.ink}"/>`);
      c.out.push(swordsman(c, W * 0.44, HZ + 90, 430));
      c.out.push(`<rect x="-40" y="${f(HZ - 40)}" width="${W + 80}" height="90" fill="${pal.mist}" opacity="0.14" filter="url(#blurL${id})"/>`);
      particles(c, '#ff9a5a', 40);
      break;
    }
    case 'horse-rider': {
      landBase(c, { moonX: W * 0.78, moonY: H * 0.22, moonR: 42, withWater: false });
      c.out.push(`<path d="M 0 ${f(H * 0.8)} Q ${f(W * 0.5)} ${f(H * 0.72)} ${W} ${f(H * 0.8)} L ${W} ${H} L 0 ${H} Z" fill="${pal.ink}"/>`);
      c.out.push(horseRider(c, W * 0.48, H * 0.79, 300));
      particles(c, pal.mist, 24);
      break;
    }
    case 'autumn-leaves': {
      landBase(c, { moonX: W * 0.8, moonY: H * 0.2, moonR: 36, withWater: false, cloudsN: 3, birdsN: 2 });
      c.out.push(`<circle cx="${f(W * 0.22)}" cy="${f(H * 0.28)}" r="${f(W * 0.16)}" fill="${pal.glow}" opacity="0.16" filter="url(#blurL${id})"/>`);
      c.out.push(`<path d="M 0 ${f(H * 0.86)} Q ${f(W * 0.5)} ${f(H * 0.8)} ${W} ${f(H * 0.87)} L ${W} ${H} L 0 ${H} Z" fill="${pal.ink}"/>`);
      c.out.push(tree(c, W * 0.22, H * 1.04, 1500, '#c9702a', '#1c100c'));
      c.out.push(person(c, W * 0.62, H * 0.88, 220, { hair: 'bun' }));
      const rand = rng(spec.seed ^ 0xab);
      let leaves = '';
      for (let i = 0; i < 60; i++) {
        const x = rand() * W;
        const y = H * (0.3 + rand() * 0.5);
        leaves += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(4 + rand() * 6)}" ry="${f(2 + rand() * 3)}" fill="#e08a3a" opacity="${(0.5 + rand() * 0.45).toFixed(2)}" transform="rotate(${(rand() * 160).toFixed(0)} ${f(x)} ${f(y)})"/>`;
      }
      c.out.push(leaves);
      c.out.push(`<rect x="0" y="${f(H * 0.88)}" width="${W}" height="${f(H * 0.12)}" fill="${pal.ink}"/>`);
      break;
    }
    case 'old-tree': {
      landBase(c, { moonX: W * 0.24, moonY: H * 0.2, moonR: 42, withWater: false, birdsN: 2 });
      wall(c, H * 0.78);
      c.out.push(tree(c, W * 0.62, H * 1.04, 1550));
      c.out.push(person(c, W * 0.3, H * 0.9, 180, { hair: 'bun' }));
      c.out.push(`<rect x="0" y="${f(H * 0.88)}" width="${W}" height="${f(H * 0.12)}" fill="${pal.ink}"/>`);
      reeds(c);
      break;
    }
    case 'stone-alley': {
      sky(c);
      if (pal.name === 'night') stars(c);
      celestial(c, W * 0.5, H * 0.16, 44);
      clouds(c, 3);
      // 远山
      c.out.push(`<path d="${ridgePath(spec.seed + 1, HZ - 160, 90)}" fill="${pal.far}" opacity="0.9"/>`);
      c.out.push(`<path d="${ridgePath(spec.seed + 2, HZ - 110, 60)}" fill="${pal.mid}" opacity="0.95"/>`);
      // 两侧墙与瓦
      const wallY = H * 0.56;
      c.out.push(`<path d="M 0 ${H} L 0 ${f(wallY)} L ${W * 0.24} ${f(wallY + 40)} L ${W * 0.24} ${H} Z" fill="${pal.ink}"/>`);
      c.out.push(`<path d="M ${W} ${H} L ${W} ${f(wallY)} L ${W * 0.76} ${f(wallY + 40)} L ${W * 0.76} ${H} Z" fill="${pal.ink}"/>`);
      for (let i = 0; i < 5; i++) {
        const t = i / 5;
        c.out.push(`<path d="M ${f(W * 0.24 * t)} ${f(wallY + (H - wallY) * t * 0.9)} L ${f(W * 0.24 + (W * 0.76 - W * 0.24) * t)} ${f(wallY + (H - wallY) * t * 0.2)}" stroke="${pal.mid}" stroke-width="2" opacity="0.35"/>`);
      }
      // 石板路
      let stones = '';
      for (let i = 0; i < 10; i++) {
        const t = i / 10;
        const y = H * (0.64 + t * 0.36);
        stones += `<line x1="${f(W * (0.24 - t * 0.24))}" y1="${f(y)}" x2="${f(W * (0.76 + t * 0.24))}" y2="${f(y)}" stroke="${pal.mist}" stroke-width="${f(2 + t * 4)}" opacity="0.18"/>`;
      }
      c.out.push(stones);
      c.out.push(lanterns(c, 4, H * 0.6));
      c.out.push(person(c, W * 0.5, H * 0.86, 210, { hair: 'long' }));
      break;
    }
    case 'ghost-light': {
      landBase(c, { moonX: W * 0.24, moonY: H * 0.16, moonR: 34 });
      c.out.push(`<path d="M 0 ${f(H * 0.86)} L ${W} ${f(H * 0.87)} L ${W} ${H} L 0 ${H} Z" fill="${pal.ink}"/>`);
      c.out.push(person(c, W * 0.5, H * 0.87, 200, { hair: 'bun' }));
      const rand = rng(spec.seed ^ 0xcafe);
      for (let i = 0; i < 9; i++) {
        const x = W * (0.15 + rand() * 0.7);
        const y = H * (0.25 + rand() * 0.4);
        const r = 6 + rand() * 10;
        c.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 5)}" fill="${pal.glow}" opacity="0.14" filter="url(#blurS${id})"/>`);
        c.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${pal.light}" opacity="0.95"/>`);
        c.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 1.8)}" fill="none" stroke="${pal.glow}" stroke-width="2" opacity="0.35"/>`);
      }
      reeds(c);
      break;
    }
    case 'fire-battle': {
      sky(c);
      clouds(c, 3);
      c.out.push(`<rect x="0" y="${f(HZ)}" width="${W}" height="${f(H - HZ)}" fill="${pal.waterBottom}"/>`);
      // 火光
      c.out.push(`<circle cx="${f(W * 0.38)}" cy="${f(HZ * 0.95)}" r="420" fill="#ff8a3a" opacity="0.22" filter="url(#blurL${id})"/>`);
      c.out.push(`<circle cx="${f(W * 0.72)}" cy="${f(HZ * 0.98)}" r="340" fill="#ffb45a" opacity="0.18" filter="url(#blurL${id})"/>`);
      // 战船
      for (let i = 0; i < 4; i++) {
        const x = W * (0.16 + i * 0.24);
        const y = HZ + (i % 2) * 26;
        const s = 0.85 + (i % 2) * 0.22;
        c.out.push(`<g transform="translate(${f(x)} ${f(y)}) scale(${s})">
          <path d="M -150 0 Q -120 36 -40 36 L 60 36 Q 130 36 150 0 L 110 10 Q 60 26 -40 26 Q -110 10 -150 0 Z" fill="${pal.ink}"/>
          <rect x="-4" y="-270" width="8" height="270" fill="${pal.ink}"/>
          <path d="M 8 -250 L 140 -206 L 128 -128 L 8 -150 Z" fill="${pal.ink}"/>
          <path d="M 8 -128 L 108 -96 L 96 -34 L 8 -54 Z" fill="${pal.ink}" opacity="0.92"/>
          <path d="M -8 -230 L -96 -196 L -88 -136 L -8 -150 Z" fill="${pal.ink}" opacity="0.85"/>
          <path d="M 4 -270 L 46 -256 L 4 -240 Z" fill="${pal.ink}"/>
        </g>`);
        c.out.push(`<circle cx="${f(x)}" cy="${f(y - 20)}" r="34" fill="#ffb45a" opacity="0.45" filter="url(#blurS${id})"/>`);
      }
      // 水面火光倒影
      const rand = rng(spec.seed ^ 0x99);
      let flames = '';
      for (let i = 0; i < 60; i++) {
        const x = rand() * W;
        const y = HZ + 20 + rand() * (H - HZ - 20);
        flames += `<rect x="${f(x)}" y="${f(y)}" width="${f(10 + rand() * 40)}" height="3" fill="#ff9a4a" opacity="${(0.1 + rand() * 0.2).toFixed(2)}"/>`;
      }
      c.out.push(flames);
      particles(c, '#ffcf8a', 60);
      break;
    }
    case 'wine-jar': {
      roomBase(c);
      // 桌面
      c.out.push(`<rect x="${f(W * 0.08)}" y="${f(H * 0.66)}" width="${f(W * 0.84)}" height="26" fill="#3a2214"/>`);
      c.out.push(`<rect x="${f(W * 0.14)}" y="${f(H * 0.66 + 26)}" width="24" height="${f(H * 0.26)}" fill="#2a1a10"/>`);
      c.out.push(`<rect x="${f(W * 0.84)}" y="${f(H * 0.66 + 26)}" width="24" height="${f(H * 0.26)}" fill="#2a1a10"/>`);
      // 酒坛
      c.out.push(`<ellipse cx="${f(W * 0.38)}" cy="${f(H * 0.58)}" rx="${f(W * 0.14)}" ry="${f(H * 0.1)}" fill="#6a4428"/>`);
      c.out.push(`<rect x="${f(W * 0.38 - W * 0.045)}" y="${f(H * 0.44)}" width="${f(W * 0.09)}" height="${f(H * 0.06)}" rx="14" fill="#5a3a20"/>`);
      c.out.push(`<rect x="${f(W * 0.38 - W * 0.075)}" y="${f(H * 0.55)}" width="${f(W * 0.15)}" height="${f(H * 0.06)}" rx="8" fill="#d8c090"/>`);
      c.out.push(`<rect x="${f(W * 0.38 - W * 0.05)}" y="${f(H * 0.565)}" width="${f(W * 0.1)}" height="6" fill="#6a4a28"/>`);
      // 碗
      c.out.push(`<path d="M ${f(W * 0.6)} ${f(H * 0.64)} Q ${f(W * 0.64)} ${f(H * 0.68)} ${f(W * 0.68)} ${f(H * 0.64)} Z" fill="#d8c090"/>`);
      c.out.push(`<ellipse cx="${f(W * 0.64)}" cy="${f(H * 0.638)}" rx="${f(W * 0.04)}" ry="7" fill="#8a2a22"/>`);
      // 烛
      c.out.push(`<rect x="${f(W * 0.8)}" y="${f(H * 0.56)}" width="16" height="${f(H * 0.1)}" fill="#e8dcc0"/>`);
      c.out.push(`<ellipse cx="${f(W * 0.8 + 8)}" cy="${f(H * 0.548)}" rx="10" ry="22" fill="#ffcf6a"/>`);
      c.out.push(`<circle cx="${f(W * 0.8 + 8)}" cy="${f(H * 0.548)}" r="120" fill="#ffb45a" opacity="0.14" filter="url(#blurS${id})"/>`);
      c.out.push(seatedFigure(c, W * 0.18, H * 0.86, 240));
      break;
    }
    case 'candle': {
      roomBase(c);
      c.out.push(`<rect x="${f(W * 0.2)}" y="${f(H * 0.7)}" width="${f(W * 0.6)}" height="22" fill="#3a2418"/>`);
      c.out.push(`<rect x="${f(W * 0.47)}" y="${f(H * 0.56)}" width="26" height="${f(H * 0.14)}" fill="#e8dcc0"/>`);
      c.out.push(`<ellipse cx="${f(W * 0.47 + 13)}" cy="${f(H * 0.545)}" rx="16" ry="34" fill="#ffcf6a"/>`);
      c.out.push(`<ellipse cx="${f(W * 0.47 + 13)}" cy="${f(H * 0.548)}" rx="7" ry="20" fill="#fff6d0"/>`);
      c.out.push(`<circle cx="${f(W * 0.47 + 13)}" cy="${f(H * 0.545)}" r="240" fill="#ffb45a" opacity="0.13" filter="url(#blurL${id})"/>`);
      c.out.push(`<path d="M ${f(W * 0.5)} ${f(H * 0.7)} L ${W} ${f(H * 0.9)} L ${W} ${H} L ${f(W * 0.42)} ${H} Z" fill="#060404" opacity="0.5"/>`);
      c.out.push(seatedFigure(c, W * 0.28, H * 0.88, 220));
      break;
    }
    case 'scroll-memory': {
      sky(c);
      stars(c);
      celestial(c, W * 0.72, H * 0.16, 40);
      c.out.push(`<rect width="${W}" height="${H}" fill="${pal.ink}" opacity="0.55"/>`);
      c.out.push(`<path d="M ${f(W * 0.2)} 0 L ${f(W * 0.36)} 0 L ${f(W * 0.6)} ${H} L ${f(W * 0.36)} ${H} Z" fill="${pal.light}" opacity="0.05" filter="url(#blurL${id})"/>`);
      const rand = rng(spec.seed ^ 0x5c70);
      for (let i = 0; i < 5; i++) {
        const x = W * (0.16 + rand() * 0.68);
        const y = H * (0.16 + rand() * 0.42);
        const w = 140 + rand() * 60;
        const h = 220 + rand() * 90;
        c.out.push(`<g transform="translate(${f(x)} ${f(y)}) rotate(${((rand() - 0.5) * 16).toFixed(1)})">
          <rect x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" rx="6" fill="#e8dcc0"/>
          <rect x="${f(-w / 2 - 8)}" y="${f(-h / 2 - 12)}" width="${f(w + 16)}" height="16" rx="8" fill="#8a6a3a"/>
          <rect x="${f(-w / 2 - 8)}" y="${f(h / 2 - 4)}" width="${f(w + 16)}" height="16" rx="8" fill="#8a6a3a"/>
          ${[0, 1, 2, 3].map((k) => `<rect x="${f(-w / 2 + 18 + k * (w / 5))}" y="${f(-h / 2 + 22)}" width="3" height="${f(h - 44)}" fill="#6a5a44" opacity="0.75"/>`).join('')}
        </g>`);
      }
      c.out.push(seatedFigure(c, W * 0.5, H * 0.9, 240));
      particles(c, '#c9b89a', 26);
      break;
    }
    case 'sword-wound': {
      sky(c);
      clouds(c, 3);
      c.out.push(`<rect x="0" y="${f(HZ)}" width="${W}" height="${f(H - HZ)}" fill="${pal.near}"/>`);
      c.out.push(`<circle cx="${f(W * 0.3)}" cy="${f(HZ)}" r="380" fill="#ff7a3a" opacity="0.18" filter="url(#blurL${id})"/>`);
      // 断剑
      c.out.push(`<path d="M ${f(W * 0.38)} ${f(H * 0.82)} L ${f(W * 0.66)} ${f(H * 0.5)}" stroke="#9aa0b4" stroke-width="20" stroke-linecap="round"/>`);
      c.out.push(`<path d="M ${f(W * 0.38)} ${f(H * 0.82)} L ${f(W * 0.66)} ${f(H * 0.5)}" stroke="#e8f0ff" stroke-width="5" stroke-linecap="round" opacity="0.8"/>`);
      c.out.push(`<path d="M ${f(W * 0.6)} ${f(H * 0.62)} L ${f(W * 0.7)} ${f(H * 0.68)}" stroke="#8a5a2a" stroke-width="30" stroke-linecap="round"/>`);
      // 红布
      c.out.push(`<path d="M ${f(W * 0.52)} ${f(H * 0.68)} C ${f(W * 0.62)} ${f(H * 0.72)} ${f(W * 0.7)} ${f(H * 0.78)} ${f(W * 0.68)} ${f(H * 0.88)} L ${f(W * 0.5)} ${f(H * 0.84)} Z" fill="#8a1a24" opacity="0.95"/>`);
      // 残旗
      c.out.push(`<path d="M ${f(W * 0.18)} ${f(H * 0.88)} L ${f(W * 0.24)} ${f(H * 0.46)}" stroke="${pal.ink}" stroke-width="10"/>`);
      c.out.push(`<path d="M ${f(W * 0.235)} ${f(H * 0.48)} C ${f(W * 0.32)} ${f(H * 0.5)} ${f(W * 0.36)} ${f(H * 0.56)} ${f(W * 0.33)} ${f(H * 0.6)} C ${f(W * 0.28)} ${f(H * 0.57)} ${f(W * 0.24)} ${f(H * 0.55)} ${f(W * 0.22)} ${f(H * 0.54)} Z" fill="#5a141a" opacity="0.9"/>`);
      particles(c, '#ff9a4a', 50);
      break;
    }
    case 'title': {
      landBase(c, { moonX: W * 0.74, moonY: H * 0.22, moonR: 52, birdsN: 4 });
      // 前景岸与人物
      c.out.push(`<path d="M 0 ${f(H * 0.85)} Q ${f(W * 0.4)} ${f(H * 0.8)} ${W} ${f(H * 0.86)} L ${W} ${H} L 0 ${H} Z" fill="${pal.ink}"/>`);
      c.out.push(person(c, W * 0.62, H * 0.85, 220, { umbrella: true, hair: 'long' }));
      reeds(c);
      c.out.push(`<text x="${W / 2}" y="${f(H * 0.4)}" text-anchor="middle" font-family="KaiTi, STKaiti, serif" font-size="170" fill="#f6e7c8" letter-spacing="22">${esc(spec.title ?? '')}</text>`);
      c.out.push(`<text x="${W / 2}" y="${f(H * 0.47)}" text-anchor="middle" font-family="KaiTi, STKaiti, serif" font-size="46" fill="#d8c8a8" opacity="0.9" letter-spacing="12">${esc(spec.artist ?? '')}</text>`);
      c.out.push(`<line x1="${W * 0.3}" y1="${f(H * 0.51)}" x2="${W * 0.7}" y2="${f(H * 0.51)}" stroke="#c9a86a" stroke-width="2" opacity="0.45"/>`);
      c.out.push(`<text x="${W / 2}" y="${f(H * 0.55)}" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="30" fill="#b8b0a0" letter-spacing="8">${esc(spec.subtitle ?? '代码绘制 · 原曲同步')}</text>`);
      break;
    }
  }

  if (spec.style === 'ink') {
    c.out.push(`<rect width="${W}" height="${H}" fill="#efe7d2" opacity="0.35"/>`);
    c.out.push(`<path d="M 0 240 C 200 120 420 300 620 160 C 800 40 980 220 1080 140 L 1080 0 L 0 0 Z" fill="#d8ccb4" opacity="0.35" filter="url(#blurL${id})"/>`);
  }
  if (spec.style === 'cyber') {
    c.out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#ff3a9a" stroke-width="3" opacity="0.18"/>`);
    for (let i = 0; i < 8; i++) {
      c.out.push(`<rect x="${i * 140}" y="0" width="2" height="${H}" fill="#3ad8ff" opacity="0.10"/>`);
    }
  }
  if (spec.style === 'spirit') {
    const rr = rng(spec.seed ^ 0x5511);
    for (let i = 0; i < 26; i++) {
      c.out.push(`<circle cx="${f(rr() * W)}" cy="${f(rr() * H)}" r="${f(1 + rr() * 2.6)}" fill="#7affc8" opacity="${(0.1 + rr() * 0.3).toFixed(2)}"/>`);
    }
  }
  if (spec.chapter) {
    c.out.push(`<text x="64" y="96" font-family="Microsoft YaHei, sans-serif" font-size="28" fill="#e8c98a" opacity="0.85" letter-spacing="4">${esc(spec.chapter)}</text>`);
  }
  vignette(c);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${c.out.join('')}</svg>`;
}
