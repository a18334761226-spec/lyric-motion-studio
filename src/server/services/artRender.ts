/**
 * ArtSpec → SVG 渲染器（通用场景组装）。
 *
 * 只认结构化的美术指令：风格 preset、色板、每层图元（kind/x/y/scale/color/pose），
 * 不认具体歌词，所以换歌/换风格不用改渲染代码。
 */

export interface ArtElement {
  kind: string;
  x?: number;
  y?: number;
  scale?: number;
  color?: string;
  pose?: string;
  opacity?: number;
}

export interface ArtLayer {
  depth: 'far' | 'mid' | 'near';
  elements: ArtElement[];
}

export interface ShotArt {
  line: string;
  style?: string;
  mood?: string;
  sceneNote?: string;
  composition?: { framing?: string; horizon?: number; subjectAt?: [number, number]; negativeSpace?: number };
  layers?: ArtLayer[];
  motion?: { pan?: string; zoom?: number; parallax?: number[]; transition?: string };
  typography?: { chapter?: string; mood?: string };
}

export interface SongArt {
  song?: { theme?: string; motif?: string; motionTheme?: string };
  styleBible?: { main?: string; aux?: string[]; palette?: string[]; grade?: { contrast?: string; grain?: number; vignette?: number }; typography?: { font?: string; titleStyle?: string } };
  shots: ShotArt[];
}

const W = 1080;
const H = 1920;

interface Style {
  sky: [string, string, string];
  water: [string, string];
  glow: string;
  ink: string;
  mist: string;
  paper?: boolean;
  rain?: boolean;
  ember?: boolean;
  spirit?: boolean;
  neon?: boolean;
  warm?: boolean;
}

const STYLES: Record<string, Style> = {
  ink: { sky: ['#efe8d6', '#e6dcc4', '#d8cbb0'], water: ['#cfc3a8', '#b3a68a'], glow: '#fff6e0', ink: '#2a2620', mist: '#e8e0cc', paper: true },
  night: { sky: ['#060a14', '#0d1b2c', '#22384a'], water: ['#1c3244', '#050a10'], glow: '#a8c8f0', ink: '#06070c', mist: '#7e99b0' },
  dusk: { sky: ['#1a1226', '#4c2e46', '#c97858'], water: ['#8a5a5c', '#120c16'], glow: '#ffd9a8', ink: '#0a0810', mist: '#c09a9a' },
  rain: { sky: ['#0a121e', '#18283c', '#2e4456'], water: ['#243a4c', '#060c12'], glow: '#cfe0ff', ink: '#05080c', mist: '#8aa4c8', rain: true },
  ember: { sky: ['#120808', '#2e1010', '#6a2218'], water: ['#4a1a14', '#0a0404'], glow: '#ff8a4a', ink: '#070404', mist: '#8a3a2a', ember: true },
  warm: { sky: ['#1a1008', '#3a2414', '#8a5a2a'], water: ['#5a4024', '#120c08'], glow: '#ffb45a', ink: '#0a0806', mist: '#a0825a', warm: true },
  dawn: { sky: ['#3a2a44', '#b07a84', '#ffd0a8'], water: ['#c99a92', '#4a3644'], glow: '#ffd0a0', ink: '#1c1620', mist: '#e8c8c0' },
  spirit: { sky: ['#0a1410', '#12241e', '#2a4a3e'], water: ['#123028', '#04080a'], glow: '#7affc8', ink: '#040806', mist: '#6a9a88', spirit: true },
  cyber: { sky: ['#0a0618', '#1a0e3a', '#3a1a5a'], water: ['#1a1440', '#04020a'], glow: '#ff3a9a', ink: '#04020a', mist: '#8a4ac0', neon: true },
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

const f = (n: number) => n.toFixed(1);

interface Ctx {
  id: string;
  style: Style;
  seed: number;
  out: string[];
}

function defs(c: Ctx): void {
  const s = c.style;
  c.out.push(`<defs>
  <linearGradient id="sky${c.id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${s.sky[0]}"/><stop offset="0.6" stop-color="${s.sky[1]}"/><stop offset="1" stop-color="${s.sky[2]}"/>
  </linearGradient>
  <linearGradient id="water${c.id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${s.water[0]}" stop-opacity="0.9"/><stop offset="1" stop-color="${s.water[1]}"/>
  </linearGradient>
  <radialGradient id="glow${c.id}"><stop offset="0" stop-color="${s.glow}" stop-opacity="0.6"/><stop offset="1" stop-color="${s.glow}" stop-opacity="0"/></radialGradient>
  <filter id="bl${c.id}"><feGaussianBlur stdDeviation="30"/></filter>
  <filter id="bs${c.id}"><feGaussianBlur stdDeviation="8"/></filter>
  <filter id="grain${c.id}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.06"/></feComponentTransfer></filter>
  <radialGradient id="vig${c.id}"><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient>
  </defs>`);
}

const col = (e: ArtElement, c: Ctx) => e.color ?? c.style.ink;
const op = (e: ArtElement) => (e.opacity === undefined ? 1 : e.opacity);
const px = (v: number | undefined, d = 0.5) => (v === undefined ? d : v) * W;
const py = (v: number | undefined, d = 0.5) => (v === undefined ? d : v) * H;
const sc = (e: ArtElement, d = 1) => e.scale ?? d;

function ridge(seed: number, baseY: number, amp: number): string {
  const r = rng(seed);
  const n = 4;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    // 每段高度不同，形成主峰与次峰，而不是均匀扇贝
    const peak = i === 0 || i === n ? 0.25 : (i === 2 ? 1 : 0.55 + r() * 0.35);
    pts.push([(W / n) * i, baseY - amp * peak * (0.7 + r() * 0.6)]);
  }
  let d = `M0 ${H} L0 ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = (x1 - x0) / 3;
    d += ` C ${f(x0 + dx)} ${f(y0)} ${f(x1 - dx)} ${f(y1)} ${f(x1)} ${f(y1)}`;
  }
  return d + ` L${W} ${H} Z`;
}

function person(c: Ctx, x: number, y: number, h: number, color: string, pose: string, alpha = 1): void {
  const hd = h * 0.078;
  const sy = y - h * 0.78;
  const wy = y - h * 0.52;
  const hem = y - h * 0.03;
  let s = '';
  if (pose === 'sword') {
    s += `<path d="M ${f(x + h * 0.06)} ${f(sy + h * 0.05)} L ${f(x + h * 0.4)} ${f(sy - h * 0.2)}" stroke="#e8f0fc" stroke-width="${f(h * 0.018)}" stroke-linecap="round"/>`;
  }
  // 长袍（收腰、下摆微张）
  s += `<path d="M ${f(x - h * 0.085)} ${f(sy)} C ${f(x - h * 0.15)} ${f(sy + h * 0.05)} ${f(x - h * 0.11)} ${f(wy)} ${f(x - h * 0.16)} ${f(hem)} Q ${f(x)} ${f(hem + h * 0.02)} ${f(x + h * 0.16)} ${f(hem)} C ${f(x + h * 0.11)} ${f(wy)} ${f(x + h * 0.15)} ${f(sy + h * 0.05)} ${f(x + h * 0.085)} ${f(sy)} Z" fill="${color}" opacity="${alpha}"/>`;
  // 广袖
  s += `<path d="M ${f(x - h * 0.11)} ${f(sy + h * 0.03)} C ${f(x - h * 0.23)} ${f(sy + h * 0.14)} ${f(x - h * 0.2)} ${f(sy + h * 0.3)} ${f(x - h * 0.16)} ${f(sy + h * 0.34)} C ${f(x - h * 0.09)} ${f(sy + h * 0.26)} ${f(x - h * 0.06)} ${f(sy + h * 0.12)} ${f(x - h * 0.05)} ${f(sy + h * 0.05)} Z" fill="${color}" opacity="${alpha}"/>`;
  // 脖颈
  s += `<rect x="${f(x - h * 0.022)}" y="${f(sy - h * 0.05)}" width="${f(h * 0.044)}" height="${f(h * 0.06)}" fill="${color}" opacity="${alpha}"/>`;
  // 头
  s += `<ellipse cx="${f(x)}" cy="${f(sy - h * 0.13)}" rx="${f(hd)}" ry="${f(hd * 1.08)}" fill="${color}" opacity="${alpha}"/>`;
  // 发髻
  s += `<circle cx="${f(x)}" cy="${f(sy - h * 0.205)}" r="${f(hd * 0.55)}" fill="${color}" opacity="${alpha}"/>`;
  // 垂发
  s += `<path d="M ${f(x - hd * 1.1)} ${f(sy - h * 0.17)} C ${f(x - hd * 2)} ${f(sy - h * 0.02)} ${f(x - hd * 1.7)} ${f(sy + h * 0.1)} ${f(x - hd * 1.1)} ${f(sy + h * 0.16)} C ${f(x - hd * 1.2)} ${f(sy + h * 0.02)} ${f(x - hd * 0.9)} ${f(sy - h * 0.08)} ${f(x - hd * 0.8)} ${f(sy - h * 0.18)} Z" fill="${color}" opacity="${alpha}"/>`;
  if (pose === 'umbrella') {
    const uy = sy - h * 0.36;
    s += `<path d="M ${f(x - h * 0.24)} ${f(uy)} Q ${f(x)} ${f(uy - h * 0.13)} ${f(x + h * 0.24)} ${f(uy)} Z" fill="${color}"/>`;
    s += `<rect x="${f(x - 1)}" y="${f(uy)}" width="3" height="${f(h * 0.36)}" fill="${color}"/>`;
  }
  c.out.push(s);
}

function element(c: Ctx, e: ArtElement, depth: string): void {
  const x = px(e.x);
  const y = py(e.y);
  const s = sc(e);
  const color = col(e, c);
  const o = op(e);
  switch (e.kind) {
    case 'sky':
      c.out.push(`<rect width="${W}" height="${H}" fill="url(#sky${c.id})" opacity="${o}"/>`);
      break;
    case 'stars': {
      const r = rng(c.seed ^ 0x9e37);
      let st = '';
      for (let i = 0; i < 70; i++) st += `<circle cx="${f(r() * W)}" cy="${f(r() * H * 0.6)}" r="${(r() > 0.85 ? 2.4 : 1.2)}" fill="#eef4ff" opacity="${(0.2 + r() * 0.6).toFixed(2)}"/>`;
      c.out.push(st);
      break;
    }
    case 'moon':
    case 'sun':
      c.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(52 * s * 3)}" fill="url(#glow${c.id})" opacity="0.7"/>`);
      c.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(52 * s)}" fill="${e.color ?? c.style.glow}" opacity="${o}"/>`);
      break;
    case 'clouds': {
      const r = rng(c.seed ^ 0x51ed);
      let cl = '';
      for (let i = 0; i < 4; i++) cl += `<ellipse cx="${f(r() * W)}" cy="${f(y - 120 + r() * 160)}" rx="${f(180 + r() * 240)}" ry="${f(18 + r() * 24)}" fill="${c.style.mist}" opacity="${(0.12 + r() * 0.12).toFixed(2)}" filter="url(#bl${c.id})"/>`;
      c.out.push(cl);
      break;
    }
    case 'mountains':
      c.out.push(`<path d="${ridge(c.seed + Math.floor(x), y, 130 * s)}" fill="${color}" opacity="${o}"/>`);
      break;
    case 'mist':
      c.out.push(`<rect x="-60" y="${f(y)}" width="${W + 120}" height="${f(90 * s)}" fill="${e.color ?? c.style.mist}" opacity="${0.2 * o}" filter="url(#bl${c.id})"/>`);
      break;
    case 'water':
      c.out.push(`<rect x="0" y="${f(y)}" width="${W}" height="${f(H - y)}" fill="url(#water${c.id})" opacity="${o}"/>`);
      c.out.push(`<rect x="0" y="${f(y)}" width="${W}" height="2" fill="${c.style.glow}" opacity="0.22"/>`);
      break;
    case 'reflection':
      c.out.push(`<ellipse cx="${f(x)}" cy="${f(y + 60)}" rx="${f(W * 0.16)}" ry="${f(H * 0.2)}" fill="${c.style.glow}" opacity="0.18" filter="url(#bl${c.id})"/>`);
      break;
    case 'ground':
      c.out.push(`<path d="M 0 ${f(y)} Q ${f(W * 0.35)} ${f(y - 26)} ${f(W * 0.6)} ${f(y + 12)} T ${W} ${f(y - 8)} L ${W} ${H} L 0 ${H} Z" fill="${color}" opacity="${o}"/>`);
      break;
    case 'reeds': {
      const r = rng(c.seed ^ 0x23);
      let rd = '';
      for (let i = 0; i < 20; i++) {
        const lx = i % 2 === 0 ? r() * W * 0.2 : W - r() * W * 0.2;
        const by = H * (0.92 + r() * 0.08);
        const hh = 120 + r() * 220;
        rd += `<path d="M ${f(lx)} ${f(by)} Q ${f(lx + (r() - 0.5) * 70)} ${f(by - hh * 0.6)} ${f(lx + (r() - 0.5) * 110)} ${f(by - hh)}" stroke="${color}" stroke-width="${(2 + r() * 3).toFixed(1)}" fill="none" stroke-linecap="round" opacity="${o}"/>`;
      }
      c.out.push(rd);
      break;
    }
    case 'birds': {
      const r = rng(c.seed ^ 0xbe);
      let bd = '';
      for (let i = 0; i < 4; i++) {
        const bx = x + (r() - 0.5) * 200;
        const by = y + (r() - 0.5) * 120;
        const w = 10 + r() * 10;
        bd += `<path d="M ${f(bx - w)} ${f(by)} Q ${f(bx - w * 0.4)} ${f(by - w * 0.5)} ${f(bx)} ${f(by)} Q ${f(bx + w * 0.4)} ${f(by - w * 0.5)} ${f(bx + w)} ${f(by)}" stroke="${color}" stroke-width="2" fill="none" opacity="${o}"/>`;
      }
      c.out.push(bd);
      break;
    }
    case 'tree': {
      const h = 520 * s;
      c.out.push(`<path d="M ${f(x)} ${f(y)} C ${f(x - h * 0.02)} ${f(y - h * 0.35)} ${f(x + h * 0.02)} ${f(y - h * 0.6)} ${f(x)} ${f(y - h * 0.8)}" stroke="${color}" stroke-width="${f(h * 0.05)}" fill="none" stroke-linecap="round" opacity="${o}"/>`);
      const r = rng(c.seed ^ 0x7e);
      for (let i = 0; i < 3; i++) {
        const by = y - h * (0.45 + i * 0.13);
        const dir = i % 2 === 0 ? -1 : 1;
        c.out.push(`<path d="M ${f(x)} ${f(by)} Q ${f(x + dir * h * 0.12)} ${f(by - h * 0.08)} ${f(x + dir * h * 0.22)} ${f(by - h * 0.16)}" stroke="${color}" stroke-width="${f(h * 0.025)}" fill="none" stroke-linecap="round" opacity="${o}"/>`);
      }
      for (let i = 0; i < 14; i++) {
        c.out.push(`<ellipse cx="${f(x + (r() - 0.5) * h * 0.5)}" cy="${f(y - h * (0.58 + r() * 0.3))}" rx="${f(20 + r() * 26)}" ry="${f(10 + r() * 12)}" fill="${color}" opacity="${o * 0.95}"/>`);
      }
      break;
    }
    case 'figure':
      person(c, x, y, 240 * s, color, e.pose ?? 'standing', o);
      break;
    case 'boat': {
      c.out.push(`<g transform="translate(${f(x)} ${f(y)}) scale(${s})">
        <path d="M -120 0 C -70 34 70 34 120 0 L 88 10 C 44 22 -44 22 -88 10 Z" fill="${color}" opacity="${o}"/>
        <path d="M -70 4 C -40 -52 40 -52 70 4 Z" fill="${color}" opacity="${o}"/>
        <rect x="-2" y="-70" width="4" height="70" fill="${color}" opacity="${o}"/>
      </g>`);
      break;
    }
    case 'pavilion': {
      c.out.push(`<g transform="translate(${f(x)} ${f(y)}) scale(${s})">
        <path d="M -110 0 Q -70 -70 0 -84 Q 70 -70 110 0 L 84 0 Q 60 -50 0 -60 Q -60 -50 -84 0 Z" fill="${color}" opacity="${o}"/>
        <rect x="-84" y="-4" width="8" height="50" fill="${color}"/>
        <rect x="76" y="-4" width="8" height="50" fill="${color}"/>
        <circle cx="0" cy="12" r="8" fill="${c.style.glow}" opacity="0.8"/>
      </g>`);
      break;
    }
    case 'wall': {
      let wl = `<rect x="0" y="${f(y)}" width="${W}" height="${f(H - y)}" fill="${color}" opacity="${o}"/>`;
      for (let xx = 0; xx < W; xx += 60) wl += `<rect x="${xx}" y="${f(y - 20)}" width="34" height="22" fill="${color}"/>`;
      c.out.push(wl);
      break;
    }
    case 'lanterns': {
      const r = rng(c.seed ^ 0x1a);
      for (let i = 0; i < 6; i++) {
        const lx = W * (0.12 + r() * 0.76);
        const ly = y + r() * 160;
        const rr = 10 + r() * 7;
        c.out.push(`<circle cx="${f(lx)}" cy="${f(ly)}" r="${f(rr * 4)}" fill="${c.style.glow}" opacity="0.14" filter="url(#bs${c.id})"/>`);
        c.out.push(`<ellipse cx="${f(lx)}" cy="${f(ly)}" rx="${f(rr)}" ry="${f(rr * 1.2)}" fill="${e.color ?? '#f0b060'}" opacity="${o}"/>`);
      }
      break;
    }
    case 'rain': {
      const r = rng(c.seed ^ 0x88);
      let rn = '';
      for (let i = 0; i < 130; i++) rn += `<line x1="${f(r() * W)}" y1="${f(r() * H)}" x2="${f(r() * W - 10)}" y2="${f(r() * H + 80)}" stroke="#9fb6d8" stroke-width="1.4" opacity="${(0.05 + r() * 0.1).toFixed(2)}"/>`;
      c.out.push(rn);
      break;
    }
    case 'embers': {
      const r = rng(c.seed ^ 0x9a);
      let em = '';
      for (let i = 0; i < 50; i++) em += `<circle cx="${f(r() * W)}" cy="${f(H * (0.3 + r() * 0.6))}" r="${(1 + r() * 2.4).toFixed(1)}" fill="#ffb45a" opacity="${(0.2 + r() * 0.5).toFixed(2)}"/>`;
      c.out.push(em);
      break;
    }
    case 'particles': {
      const r = rng(c.seed ^ 0xd0);
      let pt = '';
      for (let i = 0; i < 40; i++) pt += `<circle cx="${f(r() * W)}" cy="${f(r() * H)}" r="${(0.8 + r() * 2).toFixed(1)}" fill="${color}" opacity="${(0.1 + r() * 0.3).toFixed(2)}"/>`;
      c.out.push(pt);
      break;
    }
    case 'candle':
      c.out.push(`<rect x="${f(x - 8)}" y="${f(y - 120)}" width="16" height="120" fill="#e8dcc0" opacity="${o}"/>`);
      c.out.push(`<ellipse cx="${f(x)}" cy="${f(y - 136)}" rx="12" ry="26" fill="#ffcf6a"/>`);
      c.out.push(`<circle cx="${f(x)}" cy="${f(y - 136)}" r="110" fill="${c.style.glow}" opacity="0.16" filter="url(#bs${c.id})"/>`);
      break;
    case 'wineJar':
      c.out.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(140 * s)}" ry="${f(105 * s)}" fill="${color}" opacity="${o}"/>`);
      c.out.push(`<rect x="${f(x - 40 * s)}" y="${f(y - 190 * s)}" width="${f(80 * s)}" height="${f(70 * s)}" rx="12" fill="${color}" opacity="${o}"/>`);
      break;
    case 'scroll': {
      const r = rng(c.seed ^ 0x5c);
      for (let i = 0; i < 3; i++) {
        const sx = x + (r() - 0.5) * 300;
        const sy = y + (r() - 0.5) * 300;
        c.out.push(`<g transform="translate(${f(sx)} ${f(sy)}) rotate(${f((r() - 0.5) * 14)})"><rect x="-70" y="-110" width="140" height="220" rx="6" fill="#e8dcc0" opacity="${o}"/><rect x="-78" y="-116" width="156" height="12" rx="6" fill="#8a6a3a"/><rect x="-78" y="104" width="156" height="12" rx="6" fill="#8a6a3a"/></g>`);
      }
      break;
    }
    case 'sword':
      c.out.push(`<path d="M ${f(x - 100 * s)} ${f(y + 100 * s)} L ${f(x + 160 * s)} ${f(y - 240 * s)}" stroke="#9aa0b4" stroke-width="${f(16 * s)}" stroke-linecap="round"/>`);
      c.out.push(`<path d="M ${f(x - 100 * s)} ${f(y + 100 * s)} L ${f(x + 160 * s)} ${f(y - 240 * s)}" stroke="#e8f0ff" stroke-width="${f(4 * s)}" stroke-linecap="round" opacity="0.8"/>`);
      break;
    case 'banner':
      c.out.push(`<path d="M ${f(x - 10)} ${f(y)} L ${f(x + 10)} ${f(y - 420)}" stroke="${color}" stroke-width="8"/>`);
      c.out.push(`<path d="M ${f(x + 10)} ${f(y - 400)} C ${f(x + 120)} ${f(y - 380)} ${f(x + 150)} ${f(y - 300)} ${f(x + 120)} ${f(y - 260)} C ${f(x + 70)} ${f(y - 290)} ${f(x + 30)} ${f(y - 310)} ${f(x + 6)} ${f(y - 320)} Z" fill="#7a1a20" opacity="${o}"/>`);
      break;
    case 'horse':
      c.out.push(`<g transform="translate(${f(x)} ${f(y)}) scale(${s})">
        <path d="M -150 -90 C -150 -150 -60 -190 40 -188 C 120 -186 170 -150 178 -100 L 150 -76 L 158 -30 L 124 -30 L 118 -74 L -40 -70 L -46 -26 L -80 -26 L -86 -74 L -120 -80 Z" fill="${color}"/>
        <path d="M 150 -110 L 210 -170 L 236 -156 L 186 -96 Z" fill="${color}"/>
        <path d="M 200 -176 L 232 -158" stroke="${color}" stroke-width="12" stroke-linecap="round"/>
        <path d="M -150 -110 C -196 -140 -206 -170 -198 -190 C -180 -170 -160 -160 -146 -150 Z" fill="${color}"/>
        <ellipse cx="-6" cy="-224" rx="24" ry="26" fill="${color}"/>
        <path d="M -34 -206 L 26 -206 L 18 -140 L -28 -140 Z" fill="${color}"/>
      </g>`);
      break;
    case 'window':
      c.out.push(`<rect x="${f(x - 140)}" y="${f(y - 200)}" width="280" height="400" fill="url(#sky${c.id})" opacity="${o}"/>`);
      c.out.push(`<rect x="${f(x - 140)}" y="${f(y - 200)}" width="280" height="400" fill="none" stroke="#2a1a12" stroke-width="10"/>`);
      c.out.push(`<rect x="${f(x - 3)}" y="${f(y - 200)}" width="6" height="400" fill="#2a1a12"/>`);
      break;
    case 'table':
      c.out.push(`<rect x="${f(x - 400)}" y="${f(y)}" width="800" height="24" fill="${color}" opacity="${o}"/>`);
      c.out.push(`<rect x="${f(x - 340)}" y="${f(y + 24)}" width="22" height="200" fill="${color}"/>`);
      c.out.push(`<rect x="${f(x + 320)}" y="${f(y + 24)}" width="22" height="200" fill="${color}"/>`);
      break;
    case 'interiorWall':
      c.out.push(`<rect width="${W}" height="${H}" fill="${color}" opacity="${o}"/>`);
      break;
    case 'grain':
      c.out.push(`<rect width="${W}" height="${H}" filter="url(#grain${c.id})" opacity="${0.5 * o}"/>`);
      break;
    default:
      break;
  }
  void depth;
}

/* ---------------- 高质量图元（忠实执行 DeepSeek 的坐标/颜色/尺度） ---------------- */

function elementV2(c: Ctx, e: ArtElement, depth: string): void {
  const x = px(e.x);
  const y = py(e.y);
  const s = sc(e);
  const color = col(e, c);
  const o = op(e);
  const glow = c.style.glow;
  switch (e.kind) {
    case 'moon':
    case 'sun': {
      const r = 52 * s;
      c.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 2.1)}" fill="url(#glow${c.id})" opacity="0.32"/>`);
      c.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${e.color ?? glow}" opacity="${o}"/>`);
      if (e.pose === 'crescent') {
        c.out.push(`<circle cx="${f(x + r * 0.45)}" cy="${f(y - r * 0.2)}" r="${f(r * 0.92)}" fill="${c.style.sky[2]}" opacity="0.95"/>`);
      }
      break;
    }
    case 'mountains': {
      const baseY = y;
      const amp = 150 * s;
      c.out.push(`<path d="${ridge(c.seed + Math.floor(x), baseY, amp)}" fill="${color}" opacity="${o}"/>`);
      // 山脊亮边（空气感）
      c.out.push(`<path d="${ridge(c.seed + Math.floor(x), baseY, amp)}" fill="none" stroke="${glow}" stroke-width="1.6" opacity="0.12"/>`);
      break;
    }
    case 'water': {
      c.out.push(`<rect x="0" y="${f(y)}" width="${W}" height="${f(H - y)}" fill="url(#water${c.id})" opacity="${o}"/>`);
      c.out.push(`<rect x="0" y="${f(y)}" width="${W}" height="2" fill="${glow}" opacity="0.25"/>`);
      const r = rng(c.seed ^ 0x3311);
      let waves = '';
      for (let i = 0; i < 36; i++) {
        const wy = y + 20 + r() * Math.max(40, H - y - 40);
        const t = (wy - y) / Math.max(1, H - y);
        const ww = 30 + r() * (120 + t * 180);
        waves += `<rect x="${f(x - ww / 2 + (r() - 0.5) * 380)}" y="${f(wy)}" width="${f(ww)}" height="${(1.4 + t * 2.2).toFixed(1)}" fill="${glow}" opacity="${(0.04 + r() * 0.08).toFixed(2)}"/>`;
      }
      c.out.push(waves);
      break;
    }
    case 'ground':
      c.out.push(`<path d="M 0 ${f(y)} Q ${f(W * 0.32)} ${f(y - 30)} ${f(W * 0.56)} ${f(y + 8)} T ${W} ${f(y - 12)} L ${W} ${H} L 0 ${H} Z" fill="${color}" opacity="${o}"/>`);
      c.out.push(`<path d="M 0 ${f(y)} Q ${f(W * 0.32)} ${f(y - 30)} ${f(W * 0.56)} ${f(y + 8)} T ${W} ${f(y - 12)}" fill="none" stroke="${glow}" stroke-width="2" opacity="0.12"/>`);
      break;
    case 'tree': {
      const h = 560 * s;
      c.out.push(`<path d="M ${f(x)} ${f(y)} C ${f(x - h * 0.03)} ${f(y - h * 0.3)} ${f(x + h * 0.02)} ${f(y - h * 0.55)} ${f(x - h * 0.02)} ${f(y - h * 0.78)}" stroke="${color}" stroke-width="${f(h * 0.055)}" fill="none" stroke-linecap="round" opacity="${o}"/>`);
      const r = rng(c.seed ^ 0x7e);
      for (let i = 0; i < 4; i++) {
        const by = y - h * (0.4 + i * 0.12);
        const dir = i % 2 === 0 ? -1 : 1;
        c.out.push(`<path d="M ${f(x)} ${f(by)} Q ${f(x + dir * h * 0.14)} ${f(by - h * 0.09)} ${f(x + dir * h * 0.26)} ${f(by - h * 0.18)}" stroke="${color}" stroke-width="${f(h * 0.022)}" fill="none" stroke-linecap="round" opacity="${o}"/>`);
      }
      for (let i = 0; i < 22; i++) {
        c.out.push(`<ellipse cx="${f(x + (r() - 0.5) * h * 0.55)}" cy="${f(y - h * (0.55 + r() * 0.33))}" rx="${f(24 + r() * 30)}" ry="${f(12 + r() * 14)}" fill="${color}" opacity="${o * 0.95}"/>`);
      }
      break;
    }
    case 'figure':
      person(c, x, y, 260 * s, color, e.pose ?? 'standing', o);
      break;
    case 'boat': {
      c.out.push(`<g transform="translate(${f(x)} ${f(y)}) scale(${s})" opacity="${o}">
        <path d="M -150 0 C -90 40 90 40 150 0 L 110 14 C 56 28 -56 28 -110 14 Z" fill="${color}"/>
        <path d="M -80 6 C -46 -60 46 -60 80 6 Z" fill="${color}"/>
        <rect x="-2" y="-84" width="4" height="84" fill="${color}"/>
        <path d="M 6 -84 L 6 -30 L 60 -34 Z" fill="${color}" opacity="0.9"/>
      </g>`);
      c.out.push(`<ellipse cx="${f(x)}" cy="${f(y + 30)}" rx="${f(120 * s)}" ry="${f(14 * s)}" fill="${glow}" opacity="0.08"/>`);
      break;
    }
    case 'pavilion': {
      c.out.push(`<g transform="translate(${f(x)} ${f(y)}) scale(${s})" opacity="${o}">
        <path d="M -130 0 Q -84 -84 0 -100 Q 84 -84 130 0 L 100 0 Q 70 -60 0 -72 Q -70 -60 -100 0 Z" fill="${color}"/>
        <rect x="-98" y="-4" width="9" height="64" fill="${color}"/>
        <rect x="88" y="-4" width="9" height="64" fill="${color}"/>
        <rect x="-30" y="-16" width="60" height="9" fill="${color}"/>
        <circle cx="0" cy="14" r="9" fill="${glow}" opacity="0.85"/>
      </g>`);
      break;
    }
    case 'wall': {
      let wl = `<rect x="0" y="${f(y)}" width="${W}" height="${f(H - y)}" fill="${color}" opacity="${o}"/>`;
      for (let xx = 0; xx < W; xx += 62) wl += `<rect x="${xx}" y="${f(y - 22)}" width="34" height="24" fill="${color}"/>`;
      wl += `<rect x="0" y="${f(y - 4)}" width="${W}" height="3" fill="${glow}" opacity="0.1"/>`;
      c.out.push(wl);
      break;
    }
    case 'lanterns': {
      const r = rng(c.seed ^ 0x1a);
      for (let i = 0; i < 7; i++) {
        const lx = x + (r() - 0.5) * 520;
        const ly = y + (r() - 0.5) * 260;
        const rr = 12 + r() * 6;
        c.out.push(`<circle cx="${f(lx)}" cy="${f(ly)}" r="${f(rr * 4)}" fill="${glow}" opacity="0.16" filter="url(#bs${c.id})"/>`);
        c.out.push(`<ellipse cx="${f(lx)}" cy="${f(ly)}" rx="${f(rr)}" ry="${f(rr * 1.2)}" fill="${e.color ?? '#f0b060'}" opacity="${o}"/>`);
        c.out.push(`<ellipse cx="${f(lx)}" cy="${f(ly + rr * 2.6)}" rx="${f(rr * 0.7)}" ry="${f(rr * 2.2)}" fill="${glow}" opacity="0.12"/>`);
      }
      break;
    }
    case 'rain': {
      const r = rng(c.seed ^ 0x88);
      let rn = '';
      for (let i = 0; i < 150; i++) rn += `<line x1="${f(r() * W)}" y1="${f(r() * H)}" x2="${f(r() * W - 12)}" y2="${f(r() * H + 90)}" stroke="#9fb6d8" stroke-width="1.4" opacity="${(0.04 + r() * 0.1).toFixed(2)}"/>`;
      c.out.push(rn);
      break;
    }
    case 'embers': {
      const r = rng(c.seed ^ 0x9a);
      let em = '';
      for (let i = 0; i < 60; i++) em += `<circle cx="${f(x + (r() - 0.5) * 700)}" cy="${f(y + (r() - 0.5) * 500)}" r="${(1.2 + r() * 2.6).toFixed(1)}" fill="${e.color ?? '#ffb45a'}" opacity="${(0.25 + r() * 0.55).toFixed(2)}"/>`;
      c.out.push(em);
      break;
    }
    case 'particles': {
      const r = rng(c.seed ^ 0xd0);
      let pt = '';
      for (let i = 0; i < 46; i++) pt += `<circle cx="${f(x + (r() - 0.5) * 900)}" cy="${f(y + (r() - 0.5) * 900)}" r="${(0.8 + r() * 2).toFixed(1)}" fill="${color}" opacity="${(0.1 + r() * 0.3).toFixed(2)}"/>`;
      c.out.push(pt);
      break;
    }
    case 'candle':
      c.out.push(`<rect x="${f(x - 9)}" y="${f(y - 130 * s)}" width="${f(18 * s)}" height="${f(130 * s)}" fill="#e8dcc0" opacity="${o}"/>`);
      c.out.push(`<ellipse cx="${f(x)}" cy="${f(y - 148 * s)}" rx="${f(11 * s)}" ry="${f(26 * s)}" fill="#ffcf6a"/>`);
      c.out.push(`<ellipse cx="${f(x)}" cy="${f(y - 150 * s)}" rx="${f(5 * s)}" ry="${f(14 * s)}" fill="#fff6d0"/>`);
      c.out.push(`<circle cx="${f(x)}" cy="${f(y - 148 * s)}" r="${f(150 * s)}" fill="${glow}" opacity="0.14" filter="url(#bs${c.id})"/>`);
      break;
    case 'wineJar':
      c.out.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(130 * s)}" ry="${f(100 * s)}" fill="${color}" opacity="${o}"/>`);
      c.out.push(`<rect x="${f(x - 38 * s)}" y="${f(y - 186 * s)}" width="${f(76 * s)}" height="${f(74 * s)}" rx="14" fill="${color}" opacity="${o}"/>`);
      c.out.push(`<rect x="${f(x - 66 * s)}" y="${f(y - 30 * s)}" width="${f(132 * s)}" height="${f(46 * s)}" rx="6" fill="#d8c090" opacity="0.92"/>`);
      break;
    case 'scroll': {
      const r = rng(c.seed ^ 0x5c);
      for (let i = 0; i < 3; i++) {
        const sx = x + (r() - 0.5) * 420;
        const sy = y + (r() - 0.5) * 460;
        c.out.push(`<g transform="translate(${f(sx)} ${f(sy)}) rotate(${f((r() - 0.5) * 16)})" opacity="${o}">
          <rect x="-80" y="-130" width="160" height="260" rx="6" fill="#e8dcc0"/>
          <rect x="-90" y="-138" width="180" height="14" rx="7" fill="#8a6a3a"/>
          <rect x="-90" y="124" width="180" height="14" rx="7" fill="#8a6a3a"/>
          ${[0, 1, 2, 3].map((k) => `<rect x="${-58 + k * 38}" y="-96" width="3" height="192" fill="#6a5a44" opacity="0.7"/>`).join('')}
        </g>`);
      }
      break;
    }
    case 'sword': {
      // 剑插在地上：剑柄在上，剑身向下斜插
      const bx = x;
      const by = y;
      c.out.push(`<path d="M ${f(bx - 34 * s)} ${f(by)} L ${f(bx + 96 * s)} ${f(by - 360 * s)}" stroke="#9aa0b4" stroke-width="${f(15 * s)}" stroke-linecap="round" opacity="${o}"/>`);
      c.out.push(`<path d="M ${f(bx - 34 * s)} ${f(by)} L ${f(bx + 96 * s)} ${f(by - 360 * s)}" stroke="#e8f0ff" stroke-width="${f(4 * s)}" stroke-linecap="round" opacity="0.8"/>`);
      c.out.push(`<path d="M ${f(bx + 26 * s)} ${f(by - 96 * s)} L ${f(bx + 66 * s)} ${f(by - 56 * s)}" stroke="#8a5a2a" stroke-width="${f(22 * s)}" stroke-linecap="round"/>`);
      c.out.push(`<path d="M ${f(bx + 76 * s)} ${f(by - 320 * s)} L ${f(bx + 130 * s)} ${f(by - 300 * s)}" stroke="#c9a24a" stroke-width="${f(10 * s)}" stroke-linecap="round"/>`);
      break;
    }
    case 'banner':
      c.out.push(`<path d="M ${f(x)} ${f(y)} L ${f(x + 6 * s)} ${f(y - 420 * s)}" stroke="${color}" stroke-width="${f(9 * s)}" stroke-linecap="round" opacity="${o}"/>`);
      c.out.push(`<path d="M ${f(x + 6 * s)} ${f(y - 410 * s)} C ${f(x + 120 * s)} ${f(y - 392 * s)} ${f(x + 160 * s)} ${f(y - 320 * s)} ${f(x + 130 * s)} ${f(y - 270 * s)} C ${f(x + 80 * s)} ${f(y - 300 * s)} ${f(x + 34 * s)} ${f(y - 316 * s)} ${f(x + 8 * s)} ${f(y - 326 * s)} Z" fill="${e.color ?? '#7a1a20'}" opacity="${o}"/>`);
      break;
    case 'horse': {
      c.out.push(`<g transform="translate(${f(x)} ${f(y)}) scale(${s})" opacity="${o}">
        <ellipse cx="0" cy="-150" rx="150" ry="58" fill="${color}"/>
        <path d="M 110 -170 C 150 -230 190 -270 220 -276 L 246 -258 C 220 -240 198 -200 172 -150 Z" fill="${color}"/>
        <path d="M 214 -282 L 268 -268 L 254 -238 L 204 -252 Z" fill="${color}"/>
        <path d="M 220 -276 L 226 -300 L 240 -274 Z" fill="${color}"/>
        <path d="M -150 -160 C -200 -150 -226 -190 -214 -236 C -196 -210 -176 -190 -152 -182 Z" fill="${color}"/>
        <rect x="-128" y="-120" width="22" height="120" rx="8" fill="${color}"/>
        <rect x="-64" y="-120" width="22" height="120" rx="8" fill="${color}"/>
        <rect x="64" y="-120" width="22" height="120" rx="8" fill="${color}"/>
        <rect x="118" y="-120" width="22" height="120" rx="8" fill="${color}"/>
        <ellipse cx="-10" cy="-232" rx="24" ry="26" fill="${color}"/>
        <path d="M -40 -212 L 20 -212 L 12 -150 L -34 -150 Z" fill="${color}"/>
        <path d="M -34 -212 L -74 -196 L -30 -186 Z" fill="${color}"/>
      </g>`);
      break;
    }
    case 'window': {
      c.out.push(`<rect x="${f(x - 150 * s)}" y="${f(y - 210 * s)}" width="${f(300 * s)}" height="${f(420 * s)}" fill="url(#sky${c.id})" opacity="${o}"/>`);
      c.out.push(`<circle cx="${f(x + 60 * s)}" cy="${f(y - 110 * s)}" r="${f(40 * s)}" fill="url(#glow${c.id})" opacity="0.6"/>`);
      c.out.push(`<path d="M ${f(x - 150 * s)} ${f(y + 40 * s)} Q ${f(x - 50 * s)} ${f(y - 20 * s)} ${f(x + 30 * s)} ${f(y + 30 * s)} T ${f(x + 150 * s)} ${f(y - 10 * s)} L ${f(x + 150 * s)} ${f(y + 210 * s)} L ${f(x - 150 * s)} ${f(y + 210 * s)} Z" fill="${c.style.ink}" opacity="0.9"/>`);
      c.out.push(`<rect x="${f(x - 150 * s)}" y="${f(y - 210 * s)}" width="${f(300 * s)}" height="${f(420 * s)}" fill="none" stroke="#2a1a12" stroke-width="${f(10 * s)}"/>`);
      c.out.push(`<rect x="${f(x - 3 * s)}" y="${f(y - 210 * s)}" width="${f(6 * s)}" height="${f(420 * s)}" fill="#2a1a12"/>`);
      break;
    }
    case 'table':
      c.out.push(`<rect x="${f(x - 380 * s)}" y="${f(y)}" width="${f(760 * s)}" height="${f(24 * s)}" fill="${color}" opacity="${o}"/>`);
      c.out.push(`<rect x="${f(x - 320 * s)}" y="${f(y + 22 * s)}" width="${f(20 * s)}" height="${f(200 * s)}" fill="${color}"/>`);
      c.out.push(`<rect x="${f(x + 300 * s)}" y="${f(y + 22 * s)}" width="${f(20 * s)}" height="${f(200 * s)}" fill="${color}"/>`);
      break;
    case 'interiorWall':
      c.out.push(`<rect width="${W}" height="${H}" fill="${color}" opacity="${o}"/>`);
      c.out.push(`<rect x="0" y="${f(H * 0.72)}" width="${W}" height="${f(H * 0.28)}" fill="#0a0706" opacity="0.9"/>`);
      c.out.push(`<rect x="0" y="${f(H * 0.72)}" width="${W}" height="2" fill="${glow}" opacity="0.12"/>`);
      break;
    case 'factory': {
      const w = 260 * s;
      const h = 120 * s;
      const bx = x - w / 2;
      const by = y - h;
      let g = `<rect x="${f(bx)}" y="${f(by)}" width="${f(w)}" height="${f(h)}" fill="${color}" opacity="${o}"/>`;
      // 锯齿屋顶
      for (let i = 0; i < 4; i++) {
        const sx = bx + (w / 4) * i;
        g += `<path d="M ${f(sx)} ${f(by)} L ${f(sx + w / 8)} ${f(by - 34 * s)} L ${f(sx + w / 4)} ${f(by)} Z" fill="${color}"/>`;
      }
      // 窗
      for (let i = 0; i < 6; i++) g += `<rect x="${f(bx + 20 * s + i * 38 * s)}" y="${f(by + 40 * s)}" width="${f(20 * s)}" height="${f(24 * s)}" fill="${glow}" opacity="0.35"/>`;
      c.out.push(g);
      // 烟囱
      c.out.push(`<rect x="${f(bx + w * 0.7)}" y="${f(by - 150 * s)}" width="${f(24 * s)}" height="${f(160 * s)}" fill="${color}"/>`);
      c.out.push(`<circle cx="${f(bx + w * 0.7 + 12 * s)}" cy="${f(by - 170 * s)}" r="${f(40 * s)}" fill="${c.style.mist}" opacity="0.18" filter="url(#bs${c.id})"/>`);
      break;
    }
    case 'chimney':
      c.out.push(`<path d="M ${f(x - 18 * s)} ${f(y)} L ${f(x - 10 * s)} ${f(y - 320 * s)} L ${f(x + 10 * s)} ${f(y - 320 * s)} L ${f(x + 18 * s)} ${f(y)} Z" fill="${color}" opacity="${o}"/>`);
      for (let i = 1; i <= 4; i++) c.out.push(`<circle cx="${f(x + i * 14 * s)}" cy="${f(y - 330 * s - i * 26 * s)}" r="${f((14 + i * 10) * s)}" fill="${c.style.mist}" opacity="0.16" filter="url(#bs${c.id})"/>`);
      break;
    case 'smoke':
    case 'steam': {
      const isSteam = e.kind === 'steam';
      for (let i = 0; i < 5; i++) {
        c.out.push(`<ellipse cx="${f(x + (i % 2 ? 1 : -1) * i * 12 * s)}" cy="${f(y - i * 34 * s)}" rx="${f((26 + i * 12) * s)}" ry="${f((12 + i * 7) * s)}" fill="${isSteam ? c.style.mist : '#14161c'}" opacity="${isSteam ? 0.18 : 0.12}" filter="url(#bs${c.id})"/>`);
      }
      break;
    }
    case 'rails': {
      c.out.push(`<path d="M ${f(x - 420 * s)} ${f(y + 120)} L ${f(x - 40 * s)} ${f(y)} L ${f(x + 40 * s)} ${f(y)} L ${f(x + 420 * s)} ${f(y + 120)}" stroke="${color ?? '#3a4048'}" stroke-width="${f(6 * s)}" fill="none" opacity="${o}"/>`);
      c.out.push(`<path d="M ${f(x - 300 * s)} ${f(y + 90)} L ${f(x - 40 * s)} ${f(y + 4)} L ${f(x + 40 * s)} ${f(y + 4)} L ${f(x + 300 * s)} ${f(y + 90)}" stroke="${color ?? '#3a4048'}" stroke-width="${f(6 * s)}" fill="none" opacity="${o}"/>`);
      for (let i = 0; i < 5; i++) {
        const t = i / 5;
        c.out.push(`<rect x="${f(x - (380 - t * 260) * s)}" y="${f(y + 100 - t * 84)}" width="${f(760 * (1 - t * 0.7) * s)}" height="${f(1.5 * s)}" fill="#20242a" opacity="0.8"/>`);
      }
      break;
    }
    case 'train': {
      const w = 220 * s;
      c.out.push(`<g transform="translate(${f(x)} ${f(y)}) scale(${s})" opacity="${o}">
        <rect x="${-w / 2}" y="-70" width="${w * 0.55}" height="70" rx="6" fill="${color}"/>
        <rect x="${-w / 2 + 14}" y="-96" width="40" height="34" rx="4" fill="${color}"/>
        <rect x="${-w / 2 + 6}" y="-30" width="${w * 0.55}" height="10" fill="${color}"/>
        <circle cx="${-w / 2 + 30}" cy="4" r="14" fill="#14161c"/>
        <circle cx="${-w / 2 + 110}" cy="4" r="14" fill="#14161c"/>
        <rect x="${w * 0.1}" y="-62" width="${w * 0.3}" height="62" rx="5" fill="${color}"/>
        <rect x="${w * 0.42}" y="-62" width="${w * 0.3}" height="62" rx="5" fill="${color}"/>
      </g>`);
      c.out.push(`<ellipse cx="${f(x - w * 0.1)}" cy="${f(y - 120 * s)}" rx="${f(60 * s)}" ry="${f(20 * s)}" fill="#14161c" opacity="0.18" filter="url(#bs${c.id})"/>`);
      break;
    }
    case 'powerGrid': {
      const h = 380 * s;
      c.out.push(`<g stroke="${color}" fill="none" opacity="${o}">
        <path d="M ${f(x - 46 * s)} ${f(y)} L ${f(x - 14 * s)} ${f(y - h)} L ${f(x + 14 * s)} ${f(y - h)} L ${f(x + 46 * s)} ${f(y)}" stroke-width="${f(5 * s)}"/>
        <line x1="${f(x - 60 * s)}" y1="${f(y - h * 0.72)}" x2="${f(x + 60 * s)}" y2="${f(y - h * 0.72)}" stroke-width="${f(4 * s)}"/>
        <line x1="${f(x - 48 * s)}" y1="${f(y - h * 0.9)}" x2="${f(x + 48 * s)}" y2="${f(y - h * 0.9)}" stroke-width="${f(3 * s)}"/>
      </g>`);
      for (let i = 0; i < 3; i++) {
        c.out.push(`<path d="M ${f(x - 60 * s)} ${f(y - h * 0.72 + i * 8 * s)} Q ${f(x + 120 * s)} ${f(y - h * 0.5 + i * 10 * s)} ${f(x + 300 * s)} ${f(y - h * 0.74 + i * 6 * s)}" stroke="#2a3038" stroke-width="1.6" fill="none" opacity="0.7"/>`);
      }
      break;
    }
    case 'city': {
      const r = rng(c.seed ^ 0x33aa);
      let g = '';
      for (let i = 0; i < 9; i++) {
        const bw = 46 + r() * 70;
        const bh = 140 + r() * 320;
        const bx = x - 400 * s + i * 92 * s;
        g += `<rect x="${f(bx)}" y="${f(y - bh)}" width="${f(bw)}" height="${f(bh)}" fill="${color}" opacity="${o}"/>`;
        for (let wy = 0; wy < Math.floor(bh / 34); wy++) {
          for (let wx = 0; wx < Math.floor(bw / 22); wx++) {
            if (r() > 0.55) g += `<rect x="${f(bx + 8 + wx * 22)}" y="${f(y - bh + 12 + wy * 34)}" width="${f(8)}" height="${f(10)}" fill="${glow}" opacity="0.35"/>`;
          }
        }
      }
      c.out.push(g);
      break;
    }
    case 'crowd': {
      const r = rng(c.seed ^ 0x77cc);
      for (let i = 0; i < 14; i++) {
        const px2 = x + (r() - 0.5) * 700 * s;
        const h2 = (60 + r() * 40) * s;
        c.out.push(`<circle cx="${f(px2)}" cy="${f(y - h2)}" r="${f(h2 * 0.12)}" fill="${color}" opacity="${o}"/>`);
        c.out.push(`<path d="M ${f(px2 - h2 * 0.12)} ${f(y - h2 * 0.88)} L ${f(px2 + h2 * 0.12)} ${f(y - h2 * 0.88)} L ${f(px2 + h2 * 0.16)} ${f(y)} L ${f(px2 - h2 * 0.16)} ${f(y)} Z" fill="${color}" opacity="${o}"/>`);
      }
      break;
    }
    case 'desk':
      c.out.push(`<rect x="${f(x - 300 * s)}" y="${f(y)}" width="${f(600 * s)}" height="${f(22 * s)}" fill="${color}" opacity="${o}"/>`);
      c.out.push(`<rect x="${f(x - 250 * s)}" y="${f(y + 20 * s)}" width="${f(18 * s)}" height="${f(150 * s)}" fill="${color}"/>`);
      c.out.push(`<rect x="${f(x + 230 * s)}" y="${f(y + 20 * s)}" width="${f(18 * s)}" height="${f(150 * s)}" fill="${color}"/>`);
      c.out.push(`<path d="M ${f(x - 70 * s)} ${f(y - 2 * s)} L ${f(x + 60 * s)} ${f(y - 2 * s)} L ${f(x + 50 * s)} ${f(y - 26 * s)} L ${f(x - 60 * s)} ${f(y - 26 * s)} Z" fill="#e8dcc0" opacity="0.9"/>`);
      c.out.push(`<rect x="${f(x + 120 * s)}" y="${f(y - 60 * s)}" width="${f(12 * s)}" height="${f(60 * s)}" fill="#e8dcc0"/>`);
      c.out.push(`<ellipse cx="${f(x + 126 * s)}" cy="${f(y - 68 * s)}" rx="${f(8 * s)}" ry="${f(18 * s)}" fill="#ffcf6a"/>`);
      break;
    case 'port': {
      c.out.push(`<path d="M ${f(x - 380 * s)} ${f(y)} L ${f(x - 380 * s)} ${f(y - 300 * s)} L ${f(x - 60 * s)} ${f(y - 300 * s)} M ${f(x - 380 * s)} ${f(y - 300 * s)} L ${f(x + 80 * s)} ${f(y - 420 * s)} L ${f(x + 80 * s)} ${f(y)}" stroke="${color}" stroke-width="${f(14 * s)}" fill="none" opacity="${o}"/>`);
      for (let i = 0; i < 4; i++) c.out.push(`<rect x="${f(x - 200 * s + i * 80 * s)}" y="${f(y - 40 * s)}" width="${f(70 * s)}" height="${f(38 * s)}" fill="${i % 2 ? '#8a5a2a' : '#2a4a5a'}" opacity="${o}"/>`);
      c.out.push(`<path d="M ${f(x - 340 * s)} ${f(y + 10)} L ${f(x + 320 * s)} ${f(y + 10)} L ${f(x + 260 * s)} ${f(y + 80 * s)} L ${f(x - 280 * s)} ${f(y + 80 * s)} Z" fill="${color}" opacity="${o}"/>`);
      break;
    }
    case 'dataCenter': {
      for (let i = 0; i < 3; i++) {
        const bx = x - 220 * s + i * 180 * s;
        c.out.push(`<rect x="${f(bx)}" y="${f(y - 300 * s)}" width="${f(140 * s)}" height="${f(300 * s)}" fill="${color}" opacity="${o}"/>`);
        for (let r2 = 0; r2 < 8; r2++) {
          c.out.push(`<rect x="${f(bx + 16 * s)}" y="${f(y - 280 * s + r2 * 34 * s)}" width="${f(108 * s)}" height="${f(22 * s)}" fill="#1a2028"/>`);
          for (let k = 0; k < 4; k++) c.out.push(`<rect x="${f(bx + 24 * s + k * 24 * s)}" y="${f(y - 274 * s + r2 * 34 * s)}" width="${f(10 * s)}" height="${f(10 * s)}" fill="${k % 2 ? glow : '#3ad8ff'}" opacity="0.7"/>`);
        }
      }
      break;
    }
    case 'chip': {
      c.out.push(`<rect x="${f(x - 110 * s)}" y="${f(y - 110 * s)}" width="${f(220 * s)}" height="${f(220 * s)}" rx="${f(10 * s)}" fill="${color}" opacity="${o}"/>`);
      c.out.push(`<rect x="${f(x - 70 * s)}" y="${f(y - 70 * s)}" width="${f(140 * s)}" height="${f(140 * s)}" fill="#2a3a4a"/>`);
      for (let i = 0; i < 8; i++) {
        c.out.push(`<rect x="${f(x - 100 * s + i * 26 * s)}" y="${f(y - 130 * s)}" width="${f(10 * s)}" height="${f(20 * s)}" fill="${glow}" opacity="0.6"/>`);
        c.out.push(`<rect x="${f(x - 100 * s + i * 26 * s)}" y="${f(y + 110 * s)}" width="${f(10 * s)}" height="${f(20 * s)}" fill="${glow}" opacity="0.6"/>`);
      }
      break;
    }
    case 'spotlight': {
      c.out.push(`<path d="M ${f(x)} 0 L ${f(x + 220 * s)} ${H} L ${f(x - 220 * s)} ${H} Z" fill="${glow}" opacity="0.1"/>`);
      break;
    }
    case 'stairs': {
      for (let i = 0; i < 6; i++) {
        c.out.push(`<rect x="${f(x - 300 * s)}" y="${f(y - i * 30 * s)}" width="${f((600 - i * 60) * s)}" height="${f(30 * s)}" fill="${color}" opacity="${o}"/>`);
      }
      break;
    }
    default:
      element(c, e, depth);
      break;
  }
}

const FONTS: Record<string, string> = {
  kai: 'KaiTi, STKaiti, serif',
  song: 'SimSun, Songti SC, serif',
  hei: 'Microsoft YaHei, sans-serif',
};

/** 生成单镜 SVG（flattened：背景 + 三层图元）。styleOverride 可强制风格。 */
export function buildShotSvg(shot: ShotArt, opts: { id?: string; styleOverride?: string; chapter?: string; font?: string } = {}): string {
  const styleKey = opts.styleOverride ?? shot.style ?? 'night';
  const style = STYLES[styleKey] ?? STYLES.night;
  const id = (opts.id ?? 'a').replace(/[^a-zA-Z0-9_-]/g, '');
  const c: Ctx = { id, style, seed: hash(shot.line), out: [] };
  defs(c);
  const horizon = shot.composition?.horizon ?? 0.58;

  // 背景
  c.out.push(`<rect width="${W}" height="${H}" fill="url(#sky${id})"/>`);
  if (style.paper) {
    c.out.push(`<rect width="${W}" height="${H}" fill="#efe8d6" opacity="0.55"/>`);
    c.out.push(`<path d="M 0 300 C 240 160 460 340 700 200 C 880 90 1000 240 1080 160 L 1080 0 L 0 0 Z" fill="#d8ccb4" opacity="0.3" filter="url(#bl${id})"/>`);
  }
  if (style.rain) c.out.push(`<rect width="${W}" height="${H}" fill="#0a1622" opacity="0.12"/>`);
  if (style.warm) c.out.push(`<rect width="${W}" height="${H}" fill="#3a1e0a" opacity="0.12"/>`);
  if (style.ember) c.out.push(`<rect width="${W}" height="${H}" fill="#2a0808" opacity="0.12"/>`);
  if (style.spirit) {
    const r = rng(c.seed ^ 0x5511);
    for (let i = 0; i < 24; i++) c.out.push(`<circle cx="${f(r() * W)}" cy="${f(r() * H)}" r="${f(1 + r() * 2.4)}" fill="#7affc8" opacity="${(0.08 + r() * 0.25).toFixed(2)}"/>`);
  }
  if (style.neon) {
    c.out.push(`<rect width="${W}" height="${H}" fill="none" stroke="#ff3a9a" stroke-width="3" opacity="0.15"/>`);
    for (let i = 0; i < 8; i++) c.out.push(`<rect x="${i * 140}" y="0" width="2" height="${H}" fill="#3ad8ff" opacity="0.1"/>`);
  }

  // 图元
  const layers = shot.layers ?? [];
  // 器物“坐”在桌上：DeepSeek 给的 table y 作为桌面，candle/wineJar 自动贴合
  const tableEl = layers.flatMap((l) => l.elements).find((el) => el.kind === 'table');
  const tableY = tableEl?.y;
  const order: ('far' | 'mid' | 'near')[] = ['far', 'mid', 'near'];
  for (const d of order) {
    const layer = layers.find((l) => l.depth === d);
    if (!layer) continue;
    for (const e of layer.elements) {
      // 自动补齐基础图元位置
      const el = { ...e };
      if (el.kind === 'water' && el.y === undefined) el.y = horizon;
      if (el.kind === 'ground' && el.y === undefined) el.y = 0.86;
      if (el.kind === 'mist' && el.y === undefined) el.y = horizon - 0.04;
      if (tableY !== undefined && ['candle', 'wineJar'].includes(el.kind)) el.y = tableY - 0.012;
      elementV2(c, el, d);
    }
  }

  // 暗角 + 颗粒
  c.out.push(`<rect width="${W}" height="${H}" fill="url(#vig${id})"/>`);
  c.out.push(`<rect width="${W}" height="${H}" filter="url(#grain${id})" opacity="0.5"/>`);

  // 章节标记
  const chapter = opts.chapter ?? shot.typography?.chapter;
  if (chapter) {
    const font = FONTS[opts.font ?? 'kai'] ?? FONTS.kai;
    c.out.push(`<text x="64" y="96" font-family="${font}" font-size="28" fill="${style.paper ? '#3a342a' : '#e8c98a'}" opacity="0.9" letter-spacing="4">${esc(chapter)}</text>`);
  }

  // 景别：按 DeepSeek 的 framing / subjectAt 取景缩放
  const framing = shot.composition?.framing ?? 'wide';
  const zoom = framing === 'close' ? 1.32 : framing === 'medium' ? 1.14 : 1;
  let viewBox = `0 0 ${W} ${H}`;
  if (zoom > 1.001) {
    const [sx, sy] = shot.composition?.subjectAt ?? [0.5, 0.5];
    const vw = W / zoom;
    const vh = H / zoom;
    const vx = Math.max(0, Math.min(W - vw, sx * W - vw / 2));
    const vy = Math.max(0, Math.min(H - vh, sy * H - vh / 2));
    viewBox = `${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${viewBox}">${c.out.join('')}</svg>`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
