import { encodePng } from './proceduralArt';

/**
 * 纯代码像素画渲染器（8-bit 风格）。
 *
 * 低分辨率画布（180×320 / 320×180）+ 有限色板 + 分段色带，
 * 画出参考图那种：像素天空、月牙、金字塔、城市剪影、展示柜、像素人物、
 * 雨窗、河面木舟。输出 PNG，再由 ffmpeg 最近邻放大成 1080×1920。
 */

export type PixelSceneType =
  | 'desert-night'
  | 'museum-display'
  | 'night-city'
  | 'rain-window'
  | 'river-boat'
  | 'room-night'
  | 'fire-battle'
  | 'palace'
  | 'tavern'
  | 'city-gate'
  | 'mountain-pass'
  | 'battlefield-close'
  | 'lantern-river'
  | 'autumn-leaves'
  | 'tear-rain'
  | 'eyes-meet'
  | 'swordsman'
  | 'scroll-memory'
  | 'old-tree'
  | 'stone-alley'
  | 'horse-rider'
  | 'wine-jar'
  | 'sword-wound'
  | 'candle'
  | 'winding-road'
  | 'red-thread'
  | 'ghost-light'
  | 'heartbeat'
  | 'title-desert';

export interface PixelSceneSpec {
  type: PixelSceneType;
  seed: number;
  /** 同场景构图变体 0-2 */
  variant?: number;
  /** 动画帧序号（雨丝、星光、水波按帧变化） */
  frame?: number;
}

type RGB = [number, number, number];

function hex(h: string): RGB {
  const c = h.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** 统一 16 色古风像素色板 */
const PIXEL_PALETTE: RGB[] = [
  [8, 8, 12],
  [16, 20, 32],
  [28, 38, 60],
  [52, 70, 94],
  [90, 106, 122],
  [150, 160, 168],
  [232, 226, 210],
  [251, 247, 238],
  [242, 211, 160],
  [216, 154, 90],
  [176, 94, 56],
  [122, 62, 44],
  [74, 38, 34],
  [184, 67, 60],
  [224, 90, 74],
  [76, 90, 62],
];

const PIXEL_LUT: Uint8Array = (() => {
  const lut = new Uint8Array(32768);
  for (let key = 0; key < 32768; key++) {
    const r = ((key >> 10) & 31) * 8 + 4;
    const g = ((key >> 5) & 31) * 8 + 4;
    const b = (key & 31) * 8 + 4;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < PIXEL_PALETTE.length; i++) {
      const c = PIXEL_PALETTE[i];
      const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    lut[key] = best;
  }
  return lut;
})();

class Pixel {
  readonly w: number;
  readonly h: number;
  readonly W: number;
  readonly H: number;
  readonly outW: number;
  readonly outH: number;
  readonly sx: number;
  readonly sy: number;
  buf: Buffer;

  /** w/h 为逻辑坐标；targetW/targetH 为实际渲染分辨率（缺省则等分辨率） */
  constructor(w: number, h: number, targetW?: number, targetH?: number) {
    this.w = w;
    this.h = h;
    this.outW = targetW ?? w;
    this.outH = targetH ?? h;
    // 细颗粒像素：逻辑分辨率直接绘制，最后最近邻放大到目标分辨率
    this.W = w;
    this.H = h;
    this.sx = 1;
    this.sy = 1;
    this.buf = Buffer.alloc(w * h * 3, 0);
  }

  /** 加色光晕（月光/灯光/火光） */
  glow(cx: number, cy: number, radius: number, color: RGB, strength: number, power = 2): void {
    const ncx = cx * this.sx;
    const ncy = cy * this.sy;
    const nr = radius * this.sx;
    const x0 = Math.max(0, Math.floor(ncx - nr));
    const x1 = Math.min(this.W - 1, Math.ceil(ncx + nr));
    const y0 = Math.max(0, Math.floor(ncy - nr));
    const y1 = Math.min(this.H - 1, Math.ceil(ncy + nr));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - ncx, y - ncy) / nr;
        if (d > 1) continue;
        const a = strength * Math.pow(1 - d, power);
        const i = (y * this.W + x) * 3;
        this.buf[i] = Math.min(255, this.buf[i] + color[0] * a);
        this.buf[i + 1] = Math.min(255, this.buf[i + 1] + color[1] * a);
        this.buf[i + 2] = Math.min(255, this.buf[i + 2] + color[2] * a);
      }
    }
  }

  private blendN(xi: number, yi: number, c: RGB, a: number): void {
    if (a <= 0 || xi < 0 || yi < 0 || xi >= this.W || yi >= this.H) return;
    const i = (yi * this.W + xi) * 3;
    this.buf[i] = Math.round(this.buf[i] * (1 - a) + c[0] * a);
    this.buf[i + 1] = Math.round(this.buf[i + 1] * (1 - a) + c[1] * a);
    this.buf[i + 2] = Math.round(this.buf[i + 2] * (1 - a) + c[2] * a);
  }

  set(x: number, y: number, c: RGB, a = 1): void {
    this.blendN(Math.round(x * this.sx), Math.round(y * this.sy), c, a);
  }

  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.round(x * this.sx));
    const y0 = Math.max(0, Math.round(y * this.sy));
    const x1 = Math.min(this.W - 1, Math.round((x + w) * this.sx) - 1);
    const y1 = Math.min(this.H - 1, Math.round((y + h) * this.sy) - 1);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) this.blendN(xx, yy, c, a);
  }

  hline(x0: number, x1: number, y: number, c: RGB, a = 1): void {
    const y0 = Math.round(y * this.sy);
    const a0 = Math.max(0, Math.round(x0 * this.sx));
    const a1 = Math.min(this.W - 1, Math.round(x1 * this.sx));
    for (let xx = a0; xx <= a1; xx++) this.blendN(xx, y0, c, a);
  }

  vline(x: number, y0: number, y1: number, c: RGB, a = 1): void {
    const x0 = Math.round(x * this.sx);
    const thick = Math.max(1, Math.round(this.sx * 0.5));
    const yy0 = Math.max(0, Math.round(y0 * this.sy));
    const yy1 = Math.min(this.H - 1, Math.round(y1 * this.sy));
    for (let yy = yy0; yy <= yy1; yy++) for (let k = 0; k < thick; k++) this.blendN(x0 + k, yy, c, a);
  }

  /** 分段色带（干净渐变，适合天空） */
  bandGradient(x0: number, x1: number, y0: number, y1: number, from: RGB, to: RGB, steps = 6): void {
    void steps;
    const a0 = Math.max(0, Math.round(x0 * this.sx));
    const a1 = Math.min(this.W - 1, Math.round(x1 * this.sx));
    const ny0 = Math.max(0, Math.round(y0 * this.sy));
    const ny1 = Math.min(this.H - 1, Math.round(y1 * this.sy));
    const span = Math.max(1, ny1 - ny0);
    for (let yy = ny0; yy <= ny1; yy++) {
      const k = (yy - ny0) / span;
      const c: RGB = [
        Math.round(from[0] + (to[0] - from[0]) * k),
        Math.round(from[1] + (to[1] - from[1]) * k),
        Math.round(from[2] + (to[2] - from[2]) * k),
      ];
      for (let xx = a0; xx <= a1; xx++) this.blendN(xx, yy, c, 1);
    }
  }

  /** 有序抖动 */
  ditherBand(x0: number, x1: number, y0: number, y1: number, from: RGB, to: RGB): void {
    const a0 = Math.max(0, Math.round(x0 * this.sx));
    const a1 = Math.min(this.W - 1, Math.round(x1 * this.sx));
    const ny0 = Math.max(0, Math.round(y0 * this.sy));
    const ny1 = Math.min(this.H - 1, Math.round(y1 * this.sy));
    const span = Math.max(1, ny1 - ny0);
    for (let yy = ny0; yy <= ny1; yy++) {
      const t = (yy - ny0) / span;
      for (let xx = a0; xx <= a1; xx++) this.blendN(xx, yy, t > BAYER[yy & 3][xx & 3] / 16 ? to : from, 1);
    }
  }

  polygon(points: [number, number][], color: RGB, alpha = 1): void {
    if (points.length < 3) return;
    const pts: [number, number][] = points.map(([x, y]) => [x * this.sx, y * this.sy]);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const yStart = Math.max(0, Math.floor(minY));
    const yEnd = Math.min(this.H - 1, Math.ceil(maxY));
    const xs: number[] = [];
    for (let y = yStart; y <= yEnd; y++) {
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      if (!xs.length) continue;
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const f = Math.max(0, Math.round(xs[i]));
        const l = Math.min(this.W - 1, Math.round(xs[i + 1]));
        for (let xx = f; xx <= l; xx++) this.blendN(xx, y, color, alpha);
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: RGB, alpha = 1): void {
    const ncx = cx * this.sx;
    const ncy = cy * this.sy;
    const nrx = rx * this.sx;
    const nry = ry * this.sy;
    for (let y = Math.floor(ncy - nry); y <= Math.ceil(ncy + nry); y++) {
      const dy = (y - ncy) / Math.max(0.001, nry);
      const span = Math.sqrt(Math.max(0, 1 - dy * dy)) * nrx;
      const f = Math.max(0, Math.round(ncx - span));
      const l = Math.min(this.W - 1, Math.round(ncx + span));
      for (let x = f; x <= l; x++) this.blendN(x, y, color, alpha);
    }
  }

  thickLine(x1: number, y1: number, x2: number, y2: number, width: number, color: RGB, alpha = 1): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (width / 2);
    const ny = (dx / len) * (width / 2);
    this.polygon(
      [
        [x1 + nx, y1 + ny],
        [x2 + nx, y2 + ny],
        [x2 - nx, y2 - ny],
        [x1 - nx, y1 - ny],
      ],
      color,
      alpha,
    );
  }

  circle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    this.ellipse(cx, cy, r, r, c, a);
  }

  /** 月牙：两圆之差，保持背景不变 */
  crescent(cx: number, cy: number, r: number, color: RGB, offset = 3): void {
    const ncx = cx * this.sx;
    const ncy = cy * this.sy;
    const nr = r * this.sx;
    const off = offset * this.sx;
    for (let y = Math.floor(-nr - 2); y <= nr + 2; y++) {
      for (let x = Math.floor(-nr - 2); x <= nr + 2; x++) {
        const inMoon = x * x + y * y <= nr * nr;
        const dx = x - off;
        const dy = y + off * 0.4;
        const inCut = dx * dx + dy * dy <= nr * nr;
        if (inMoon && !inCut) this.blendN(Math.round(ncx + x), Math.round(ncy + y), color, 1);
      }
    }
  }

  /** 按镜头序号做整体调色（夜/黄昏/黎明/雨/暖/冷），让同类型场景也有区别 */
  grade(variant: number): void {
    const v = ((variant % 6) + 6) % 6;
    if (v === 0) return;
    const grades: { add: [number, number, number]; sat: number }[] = [
      { add: [0, 0, 0], sat: 1 },
      { add: [26, 6, -18], sat: 1.04 },
      { add: [14, -6, 30], sat: 1.02 },
      { add: [-12, -6, 14], sat: 0.86 },
      { add: [34, 10, -22], sat: 1.08 },
      { add: [-16, -4, 26], sat: 0.92 },
    ];
    const g = grades[v];
    const buf = this.buf;
    for (let i = 0; i < buf.length; i += 3) {
      const r = (buf[i] - 128) * g.sat + 128 + g.add[0];
      const gr = (buf[i + 1] - 128) * g.sat + 128 + g.add[1];
      const b = (buf[i + 2] - 128) * g.sat + 128 + g.add[2];
      buf[i] = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
      buf[i + 1] = gr < 0 ? 0 : gr > 255 ? 255 : Math.round(gr);
      buf[i + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    }
  }

  /** 量化到统一 16 色像素色板 */
  quantize(): void {
    const buf = this.buf;
    const pal = PIXEL_PALETTE;
    const lut = PIXEL_LUT;
    for (let i = 0; i < buf.length; i += 3) {
      const key = ((buf[i] >> 3) << 10) | ((buf[i + 1] >> 3) << 5) | (buf[i + 2] >> 3);
      const idx = lut[key];
      const c = pal[idx];
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    }
  }

  toPng(): Buffer {
    // 暗角
    const bw = this.W;
    const bh = this.H;
    const cx = bw / 2;
    const cy = bh / 2;
    const maxR = Math.hypot(cx, cy);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const d = Math.hypot(x - cx, y - cy) / maxR;
        const vig = 1 - 0.24 * Math.pow(d, 2.4);
        const i = (y * bw + x) * 3;
        this.buf[i] = Math.min(255, this.buf[i] * vig);
        this.buf[i + 1] = Math.min(255, this.buf[i + 1] * vig);
        this.buf[i + 2] = Math.min(255, this.buf[i + 2] * vig);
      }
    }
    this.quantize();
    // 最近邻放大到目标分辨率（2 倍 → 颗粒 2px）
    const ow = this.outW;
    const oh = this.outH;
    if (ow === bw && oh === bh) return encodePng(bw, bh, this.buf);
    const out = Buffer.alloc(ow * oh * 3);
    for (let y = 0; y < oh; y++) {
      const sy = Math.min(bh - 1, Math.floor((y * bh) / oh));
      for (let x = 0; x < ow; x++) {
        const sx = Math.min(bw - 1, Math.floor((x * bw) / ow));
        const si = (sy * bw + sx) * 3;
        const o = (y * ow + x) * 3;
        out[o] = this.buf[si];
        out[o + 1] = this.buf[si + 1];
        out[o + 2] = this.buf[si + 2];
      }
    }
    return encodePng(ow, oh, out);
  }
}

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

/** 像素飞鸟（V 字形） */
function drawBirds(p: Pixel, count: number, color: RGB, yBase = 0.2): void {
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(p.w * (0.18 + 0.64 * ((i * 0.37 + 0.11) % 1)));
    const cy = Math.floor(p.h * (yBase + 0.12 * ((i * 0.53 + 0.07) % 1)));
    const s = Math.max(2, Math.round(p.w * 0.014));
    p.hline(cx - s, cx - 1, cy, color);
    p.hline(cx + 1, cx + s, cy, color);
    p.set(cx, cy - 1, color);
  }
}

function stars(p: Pixel, rand: () => number, count: number, maxY: number, frame = 0): void {  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * p.w);
    const y = Math.floor(rand() * maxY);
    const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(i * 1.7 + frame * 0.55));
    p.set(x, y, [235, 238, 255], twinkle);
    if (rand() > 0.9) {
      p.set(x - 1, y, [200, 205, 235], twinkle * 0.7);
      p.set(x + 1, y, [200, 205, 235], twinkle * 0.7);
      p.set(x, y - 1, [200, 205, 235], twinkle * 0.7);
      p.set(x, y + 1, [200, 205, 235], twinkle * 0.7);
    }
  }
}

/** 阶梯金字塔 */
function pyramid(p: Pixel, cx: number, baseY: number, halfW: number, height: number, color: RGB, edge: RGB): void {
  for (let s = 0; s < height; s++) {
    const t = s / height;
    const half = Math.max(1, Math.round(halfW * (1 - t)));
    p.hline(cx - half, cx + half, baseY - s, color);
    p.set(cx - half, baseY - s, edge);
  }
}

/** 像素人物（正面） */
function person(
  p: Pixel,
  cx: number,
  groundY: number,
  colors: { body: RGB; head: RGB; accent?: RGB },
  opts: { scale?: number; umbrella?: boolean; sitting?: boolean } = {},
): void {
  const s = Math.max(0.8, opts.scale ?? 1);
  const u = Math.max(1, Math.round(2 * s));
  const headY = groundY - (opts.sitting ? 6 : 11) * s;
  // 头
  p.rect(cx - u, headY - u * 2, u * 2, u * 2, colors.head);
  // 肩 + 身体（上宽下窄）
  p.rect(cx - u * 1.5, headY, u * 3, u, colors.body);
  p.rect(cx - u, headY + u, u * 2, u * 4, colors.body);
  if (!opts.sitting) {
    p.rect(cx - u, groundY - u * 3, u, u * 3, colors.body);
    p.rect(cx + 1, groundY - u * 3, u, u * 3, colors.body);
  } else {
    p.rect(cx - u, groundY - u * 2, u * 3, u * 2, colors.body);
  }
  if (opts.umbrella) {
    p.rect(cx - u * 3, headY - u * 3, u * 6, u, colors.body);
    p.rect(cx - u * 2, headY - u * 4, u * 4, u, colors.body);
    p.vline(cx, headY - u * 4, headY - u, colors.body);
  }
  if (colors.accent) p.rect(cx - u, headY + u * 2, u * 2, u, colors.accent);
}

/** 城市天际线 */
function skyline(p: Pixel, baseY: number, rand: () => number, color: RGB, window: RGB, maxH: number): void {
  let x = 0;
  while (x < p.w) {
    const bw = 6 + Math.floor(rand() * 14);
    const bh = 4 + Math.floor(rand() * maxH);
    p.rect(x, baseY - bh, bw, bh, color);
    for (let wy = baseY - bh + 2; wy < baseY - 1; wy += 3) {
      for (let wx = x + 1; wx < x + bw - 1; wx += 3) {
        if (rand() > 0.45) p.set(wx, wy, window);
      }
    }
    if (rand() > 0.75) p.vline(x + Math.floor(bw / 2), baseY - bh - 3, baseY - bh, color);
    x += bw + 1;
  }
}

function rain(p: Pixel, rand: () => number, count: number, color: RGB, frame = 0): void {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * p.w);
    const speed = 3 + (i % 3);
    const y = ((rand() * p.h + frame * speed) % p.h);
    const len = 2 + Math.floor(rand() * 5);
    p.vline(x, y, y + len, color, 0.55);
  }
}

function plant(p: Pixel, cx: number, baseY: number, color: RGB, rand: () => number): void {
  p.rect(cx - 3, baseY - 4, 7, 4, color);
  for (let i = 0; i < 5; i++) {
    const h = 4 + Math.floor(rand() * 8);
    p.vline(cx - 3 + i * 1.5, baseY - 4 - h, baseY - 4, color, 0.9);
  }
}

/* ------------------------------------------------------------------ */
/* 场景                                                                */
/* ------------------------------------------------------------------ */

export function renderPixelScene(
  spec: PixelSceneSpec,
  width: number,
  height: number,
  opts: { lowRes?: boolean } = {},
): Buffer {
  const portrait = height > width;
  const square = height === width;
  const lw = square ? 720 : portrait ? 540 : 960;
  const lh = square ? 720 : portrait ? 960 : 540;
  const p = new Pixel(lw, lh, opts.lowRes ? undefined : width, opts.lowRes ? undefined : height);
  const rand = rng(spec.seed || 1);
  switch (spec.type) {
    case 'desert-night':
    case 'title-desert':
      drawDesert(p, rand, spec);
      break;
    case 'museum-display':
      drawMuseum(p, rand, spec);
      break;
    case 'night-city':
      drawNightCity(p, rand, spec);
      break;
    case 'rain-window':
      drawRainWindow(p, rand, spec);
      break;
    case 'river-boat':
      drawRiverBoat(p, rand, spec);
      break;
    case 'room-night':
      drawRoom(p, rand, spec);
      break;
    case 'fire-battle':
      drawFireBattle(p, rand, spec);
      break;
    case 'palace':
      drawPalace(p, rand, spec);
      break;
    case 'tavern':
      drawTavern(p, rand, spec);
      break;
    case 'city-gate':
      drawCityGate(p, rand, spec);
      break;
    case 'mountain-pass':
      drawMountainPass(p, rand, spec);
      break;
    case 'battlefield-close':
      drawBattlefield(p, rand, spec);
      break;
    case 'lantern-river':
      drawLanternRiver(p, rand, spec);
      break;
    case 'autumn-leaves':
      drawAutumnLeaves2(p, rand, spec);
      break;
    case 'tear-rain':
      drawTearRain2(p, rand, spec);
      break;
    case 'eyes-meet':
      drawEyesMeet2(p, rand, spec);
      break;
    case 'swordsman':
      drawSwordsman2(p, rand, spec);
      break;
    case 'scroll-memory':
      drawScrollMemory2(p, rand, spec);
      break;
    case 'old-tree':
      drawOldTree2(p, rand, spec);
      break;
    case 'stone-alley':
      drawStoneAlley2(p, rand, spec);
      break;
    case 'horse-rider':
      drawHorseRider2(p, rand, spec);
      break;
    case 'wine-jar':
      drawWineJar2(p, rand, spec);
      break;
    case 'sword-wound':
      drawSwordWound2(p, rand, spec);
      break;
    case 'candle':
      drawCandle(p, rand, spec);
      break;
    case 'winding-road':
      drawWindingRoad(p, rand, spec);
      break;
    case 'red-thread':
      drawRedThread(p, rand, spec);
      break;
    case 'ghost-light':
      drawGhostLight(p, rand, spec);
      break;
    case 'heartbeat':
      drawHeartbeat(p, rand, spec);
      break;
  }
  artDirection(p, spec);
  p.grade(spec.variant ?? 0);
  return p.toPng();
}

function drawDesert(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const horizon = Math.floor(p.h * 0.7);
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.24), hex('#070b1c'), hex('#101a34'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.24), Math.floor(p.h * 0.46), hex('#101a34'), hex('#2a2145'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.46), horizon, hex('#2a2145'), hex('#4a3050'), 6);
  stars(p, rand, 55, horizon - 6, spec.frame ?? 0);
  const moonX = spec.type === 'title-desert'
    ? Math.floor(p.w * 0.72)
    : (spec.variant ?? 0) === 1
      ? Math.floor(p.w * 0.78)
      : Math.floor(p.w * 0.24 + rand() * p.w * 0.2);
  const moonY = Math.floor(p.h * (spec.type === 'title-desert' ? 0.22 : 0.28));
  const moonR = Math.floor(p.w * 0.075) + 2;
  p.crescent(moonX, moonY, moonR, hex('#ffe9b0'), 3);
  p.set(moonX - 2, moonY - moonR - 2, [255, 240, 200]);
  for (let band = 0; band < 4; band++) {
    const y0 = horizon + 2 + band * Math.floor((p.h - horizon) / 4);
    const color = band % 2 === 0 ? hex('#1a1428') : hex('#120e1e');
    for (let x = 0; x < p.w; x++) {
      const wave = Math.sin((x / p.w) * (5 + band) + band * 2 + spec.seed) * 1.6;
      for (let dy = 0; dy < Math.ceil((p.h - horizon) / 4); dy++) {
        p.set(x, y0 + Math.round(wave) + dy, color);
      }
    }
  }
  const baseY = horizon + 1;
  pyramid(p, Math.floor(p.w * 0.3), baseY, Math.floor(p.w * 0.2), Math.floor(p.h * 0.18), hex('#0c0a18'), hex('#5a4a72'));
  pyramid(p, Math.floor(p.w * 0.62), baseY, Math.floor(p.w * 0.14), Math.floor(p.h * 0.13), hex('#100c1c'), hex('#6b5686'));
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rand() * p.w);
    const y = horizon + 4 + Math.floor(rand() * (p.h - horizon - 6));
    p.hline(x, x + 1 + Math.floor(rand() * 3), y, hex('#2a2038'), 0.5);
  }
  if (spec.type === 'desert-night') {
    person(p, Math.floor(p.w * 0.5), horizon + 8, { body: hex('#07060c'), head: hex('#07060c') }, { scale: 1.1 });
  }
}

function drawMuseum(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const variant = spec.variant ?? 0;
  p.ditherBand(0, p.w - 1, 0, p.h, hex('#0a0910'), hex('#14111c'));
  for (let x = 10; x < p.w - 10; x += 22) {
    p.rect(x, 6, 8, 1, hex('#3a3040'));
    p.rect(x + 1, 7, 6, 1, hex('#ffcf8a'), 0.5);
  }
  const floorY = Math.floor(p.h * 0.82);
  p.rect(0, floorY, p.w, p.h - floorY, hex('#08070c'));
  p.hline(0, p.w - 1, floorY, hex('#2a2433'));
  const caseW = Math.floor(p.w * 0.5);
  const caseH = Math.floor(p.h * 0.46);
  const caseX = Math.floor(p.w * 0.32);
  const caseY = Math.floor(p.h * 0.28);
  p.rect(caseX - 2, caseY - 2, caseW + 4, caseH + 4, hex('#3a3448'));
  p.rect(caseX, caseY, caseW, caseH, hex('#1c2030'));
  for (let i = 0; i < 10; i++) {
    const w = 10 + i * 3;
    p.ditherBand(caseX + caseW / 2 - w, caseX + caseW / 2 + w, caseY + i * 2, caseY + i * 2 + 2, hex('#2a2418'), hex('#4a3a20'));
  }
  const steleW = Math.floor(caseW * (variant === 1 ? 0.44 : 0.34));
  const steleH = Math.floor(caseH * (variant === 1 ? 0.42 : 0.5));
  const steleX = caseX + Math.floor((caseW - steleW) / 2);
  const steleY = caseY + Math.floor(caseH * 0.28);
  p.rect(steleX, steleY, steleW, steleH, hex('#2a2620'));
  p.rect(steleX + 1, steleY + 1, steleW - 2, steleH - 2, hex('#3d382c'));
  for (let y = steleY + 3; y < steleY + steleH - 3; y += 2) {
    for (let x = steleX + 2; x < steleX + steleW - 2; x += 2) {
      if (rand() > 0.45) p.set(x, y, hex('#c9a86a'), 0.75);
    }
  }
  p.rect(steleX - 3, steleY + steleH, steleW + 6, 3, hex('#1a1a22'));
  for (let y = caseY + 2; y < caseY + caseH; y += 5) p.vline(caseX + caseW - 4, y, y + 2, hex('#9fb4d8'), 0.35);
  p.vline(caseX + 2, caseY + 2, caseY + caseH - 2, hex('#9fb4d8'), 0.2);
  p.rect(8, Math.floor(p.h * 0.5), 22, 8, hex('#2a2a36'));
  p.rect(9, Math.floor(p.h * 0.5) + 1, 20, 1, hex('#c9a86a'), 0.7);
  p.rect(p.w - 30, Math.floor(p.h * 0.5), 22, 8, hex('#2a2a36'));
  p.rect(p.w - 29, Math.floor(p.h * 0.5) + 1, 20, 1, hex('#c9a86a'), 0.7);
  person(p, Math.floor(p.w * (variant === 1 ? 0.24 : 0.18)), floorY, { body: hex('#1a2438'), head: hex('#e0b48a'), accent: hex('#c9a86a') }, { scale: 1.1 });
  person(p, Math.floor(p.w * (variant === 1 ? 0.16 : 0.24)), Math.floor(p.h * 0.72), { body: hex('#5a1f24'), head: hex('#f0c8a0'), accent: hex('#9fb4d8') }, { scale: 1.5 });
  p.rect(caseX + 6, floorY - 1, caseW - 12, 2, hex('#4a3a20'), 0.5);
}

function drawNightCity(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const horizon = Math.floor(p.h * 0.62);
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.3), hex('#050914'), hex('#0c1630'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.3), horizon, hex('#0c1630'), hex('#1b3050'), 6);
  stars(p, rand, 50, horizon - 6, spec.frame ?? 0);
  const mx = Math.floor(p.w * 0.74);
  const my = Math.floor(p.h * 0.15);
  p.crescent(mx, my, 5, hex('#f4f4ff'), 2);
  skyline(p, horizon, rand, hex('#080c18'), hex('#ffcf8a'), Math.floor(p.h * 0.28));
  p.rect(0, horizon, p.w, p.h - horizon, hex('#0a0c14'));
  // 街道：路缘 + 湿地面反光
  p.hline(0, p.w - 1, horizon, hex('#1a1f2c'));
  p.hline(0, p.w - 1, Math.floor(p.h * 0.9), hex('#161a24'));
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(rand() * p.w);
    const y = horizon + 2 + Math.floor(rand() * (p.h - horizon - 8));
    p.vline(x, y, y + 1 + Math.floor(rand() * 3), hex('#ffcf8a'), 0.18);
  }
  // 路灯
  const lx = Math.floor(p.w * 0.18);
  p.vline(lx, Math.floor(p.h * 0.34), horizon + 10, hex('#12121c'));
  p.rect(lx - 2, Math.floor(p.h * 0.34), 5, 1, hex('#2a2a38'));
  p.circle(lx, Math.floor(p.h * 0.34), 2, hex('#ffe0a0'));
  // 灯光只落在街道上，避免糊在楼体上
  for (let y = horizon + 2; y < p.h; y++) {
    const t = (y - horizon) / (p.h - horizon);
    const spread = Math.floor(4 + t * 30);
    for (let x = lx - spread; x <= lx + spread; x++) {
      if (rand() > 0.8) p.set(x, y, hex('#ffe0a0'), 0.1 * (1 - t));
    }
  }
  // 近景人物
  person(p, Math.floor(p.w * (spec.variant === 1 ? 0.36 : 0.62)), Math.floor(p.h * 0.74), { body: hex('#05060a'), head: hex('#05060a') }, { scale: spec.variant === 1 ? 2 : 1.6, umbrella: spec.variant === 2 });
  if (spec.variant === 2) rain(p, rand, 90, hex('#a8c0e0'), spec.frame ?? 0);
  if (spec.variant === 1) {
    p.hline(6, p.w - 8, horizon + 3, hex('#ff6b6b'), 0.55);
    p.hline(10, p.w - 14, horizon + 6, hex('#f6c177'), 0.55);
  }
}

function drawRainWindow(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0c0a12'), hex('#16121e'), 5);
  const x0 = Math.floor(p.w * 0.16);
  const x1 = Math.floor(p.w * 0.84);
  const y0 = Math.floor(p.h * 0.11);
  const y1 = Math.floor(p.h * 0.5);
  p.rect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6, hex('#2a2433'));
  p.bandGradient(x0, x1, y0, y0 + 22, hex('#0a1430'), hex('#16264a'), 5);
  p.bandGradient(x0, x1, y0 + 22, y1 - 14, hex('#16264a'), hex('#3a2a4a'), 6);
  skyline(p, y1 - 14, rand, hex('#0c1224'), hex('#ffcf8a'), 14);
  for (let i = 0; i < 60; i++) {
    const x = x0 + Math.floor(rand() * (x1 - x0));
    const span = y1 - y0;
    const y = y0 + ((Math.floor(rand() * span) + (spec.frame ?? 0) * 3) % span);
    p.vline(x, y, y + 2 + Math.floor(rand() * 4), hex('#a8c0e0'), 0.35);
  }
  const mx = Math.floor((x0 + x1) / 2);
  p.rect(mx - 1, y0, 3, y1 - y0, hex('#2a2433'));
  for (let i = 0; i < 26; i++) {
    const x = x0 + Math.floor(rand() * (x1 - x0));
    const y = y0 + Math.floor(rand() * (y1 - y0));
    p.vline(x, y, y + 4 + Math.floor(rand() * 8), hex('#dfeaff'), 0.3);
  }
  for (let y = 0; y < y1 + 2; y += 2) {
    p.rect(x0 - 10 + Math.round(Math.sin(y / 8) * 1.5), y, 7, 2, hex('#171322'));
    p.rect(x1 + 3 - Math.round(Math.sin(y / 9) * 1.5), y, 7, 2, hex('#171322'));
  }
  p.rect(x0 - 6, y1 + 2, x1 - x0 + 12, 3, hex('#241e2e'));
  plant(p, Math.floor(p.w * 0.8), y1 + 2, hex('#1f3a2a'), rand);
  const floorY = Math.floor(p.h * 0.62);
  p.rect(0, floorY, p.w, p.h - floorY, hex('#0a080e'));
  p.hline(0, p.w - 1, floorY, hex('#241e2e'));
  // 窗光落在地板上（柔和的像素光斑）
  for (let y = floorY; y < Math.min(p.h * 0.8, p.h); y += 2) {
    const t = (y - floorY) / (p.h * 0.8 - floorY);
    const half = Math.floor((x1 - x0) / 2 * (0.8 + t * 0.4));
    const cx = Math.floor((x0 + x1) / 2);
    p.hline(cx - half, cx + half, y, hex('#1c1826'), 0.8 - t * 0.3);
  }
}

function drawRiverBoat(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const horizon = Math.floor(p.h * 0.6);
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.28), hex('#120c20'), hex('#2a1838'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.28), horizon, hex('#2a1838'), hex('#7a4a52'), 6);
  stars(p, rand, 30, Math.floor(p.h * 0.3), spec.frame ?? 0);
  const mx = Math.floor(p.w * 0.68);
  const my = Math.floor(p.h * 0.26);
  p.crescent(mx, my, 5, hex('#fff1cc'), 2);
  p.bandGradient(0, p.w - 1, horizon, p.h, hex('#3a2438'), hex('#120c20'), 5);
  for (let y = horizon; y < p.h; y++) {
    const spread = Math.floor(1 + ((y - horizon) / (p.h - horizon)) * 8);
    if (rand() > 0.4) p.hline(mx - spread, mx + spread, y, hex('#ffe1b5'), 0.28);
  }
  for (let i = 0; i < 22; i++) {
    const y = horizon + Math.floor(rand() * (p.h - horizon));
    const x = Math.floor(rand() * p.w);
    p.hline(x, x + 2 + Math.floor(rand() * 5), y, hex('#8a6a72'), 0.4);
  }
  const bx = Math.floor(p.w * 0.42);
  const by = horizon + Math.floor(p.h * 0.05);
  p.hline(bx - 12, bx + 12, by, hex('#0a0812'));
  p.hline(bx - 10, bx + 10, by + 1, hex('#0a0812'));
  p.hline(bx - 8, bx + 8, by + 2, hex('#0a0812'));
  p.vline(bx, by - 14, by, hex('#0a0812'));
  p.rect(bx, by - 13, 7, 1, hex('#0a0812'));
  person(p, bx + 3, by, { body: hex('#05040a'), head: hex('#05040a'), accent: hex('#c9a86a') }, { scale: 0.8 });
  for (let i = 0; i < 12; i++) {
    const x = i < 6 ? Math.floor(rand() * p.w * 0.16) : p.w - Math.floor(rand() * p.w * 0.16);
    const h = 8 + Math.floor(rand() * 14);
    p.vline(x, p.h - h, p.h, hex('#100c14'), 0.9);
  }
}

function drawRoom(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0c0a10'), hex('#1a1620'), 5);
  const x0 = Math.floor(p.w * 0.5);
  const x1 = Math.floor(p.w * 0.9);
  const y0 = Math.floor(p.h * 0.14);
  const y1 = Math.floor(p.h * 0.5);
  p.rect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4, hex('#2a2433'));
  p.bandGradient(x0, x1, y0, y1, hex('#151f3a'), hex('#3a3a5a'), 5);
  stars(p, rand, 18, y0 + 16, spec.frame ?? 0);
  p.crescent(Math.floor(x0 + (x1 - x0) * 0.68), y0 + 8, 4, hex('#ffe9b0'), 2);
  // 窗外城市
  skyline(p, y1 - 2, rand, hex('#101828'), hex('#ffcf8a'), 12);
  // 竖框
  p.rect(Math.floor((x0 + x1) / 2), y0, 1, y1 - y0, hex('#2a2433'));
  // 窗帘
  for (let y = 0; y < y1; y += 2) {
    p.rect(x0 - 9 + Math.round(Math.sin(y / 7) * 1.5), y, 6, 2, hex('#171322'));
  }
  // 窗台
  p.rect(x0 - 4, y1 + 2, x1 - x0 + 8, 2, hex('#241e2e'));
  // 窗光落在地板上
  for (let y = Math.floor(p.h * 0.62); y < Math.floor(p.h * 0.72); y += 1) {
    const t = (y - p.h * 0.62) / (p.h * 0.1);
    const half = Math.floor(((x1 - x0) / 2) * (0.7 + t * 0.5));
    const cx = Math.floor((x0 + x1) / 2);
    p.hline(cx - half, cx + half, y, hex('#2c2638'), 0.55 - t * 0.25);
  }
  // 床
  const bedY = Math.floor(p.h * 0.72);
  p.rect(0, bedY, Math.floor(p.w * 0.5), Math.floor(p.h * 0.16), hex('#1a1622'));
  p.rect(0, bedY, Math.floor(p.w * 0.5), 2, hex('#2a2434'));
  p.rect(Math.floor(p.w * 0.06), bedY - 3, Math.floor(p.w * 0.16), 3, hex('#2e2638'));
  // 坐在床边的人
  person(p, Math.floor(p.w * 0.3), bedY, { body: hex('#05060a'), head: hex('#05060a') }, { scale: 1.5, sitting: true });
  // 地面
  p.rect(0, Math.floor(p.h * 0.88), p.w, p.h, hex('#08070c'));
  p.hline(0, p.w - 1, Math.floor(p.h * 0.88), hex('#1e1a28'));
  // 植物
  plant(p, Math.floor(p.w * 0.12), Math.floor(p.h * 0.88), hex('#1f3a2a'), rand);
}

/* ------------------------------------------------------------------ */
/* 逐句具象场景：落叶 / 泪雨 / 对视 / 挥剑 / 记忆 / 老树 / 青石 / 策马    */
/* ------------------------------------------------------------------ */

function drawAutumnLeaves(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const frame = spec.frame ?? 0;
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.34), hex('#3a2426'), hex('#8a5242'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.34), Math.floor(p.h * 0.7), hex('#8a5242'), hex('#d8a070'), 6);
  // 低日
  p.circle(Math.floor(p.w * 0.24), Math.floor(p.h * 0.34), 4, hex('#ffe0a8'));
  // 树
  p.thickLine(Math.floor(p.w * 0.72), Math.floor(p.h * 0.1), Math.floor(p.w * 0.62), Math.floor(p.h * 0.52), 5, hex('#1a1010'));
  p.thickLine(Math.floor(p.w * 0.72), Math.floor(p.h * 0.3), Math.floor(p.w * 0.52), Math.floor(p.h * 0.22), 3, hex('#1a1010'));
  p.thickLine(Math.floor(p.w * 0.7), Math.floor(p.h * 0.42), Math.floor(p.w * 0.88), Math.floor(p.h * 0.36), 3, hex('#1a1010'));
  // 地面
  const ground = Math.floor(p.h * 0.72);
  p.rect(0, ground, p.w, p.h - ground, hex('#2a1c18'));
  p.hline(0, p.w - 1, ground, hex('#4a2e22'));
  // 落叶（逐帧飘落）
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rand() * p.w);
    const baseY = rand() * p.h;
    const y = (baseY + frame * (1 + (i % 3))) % (ground - 4);
    const color = [hex('#e08a3a'), hex('#c9702a'), hex('#f0b060'), hex('#a84a24')][i % 4];
    p.hline(x, x + 2, y, color, 0.9);
  }
  // 落叶堆
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(rand() * p.w);
    const y = ground + Math.floor(rand() * Math.min(20, p.h - ground));
    p.hline(x, x + 1 + Math.floor(rand() * 3), y, hex('#c9702a'), 0.7);
  }
  // 走在落叶上的人
  person(p, Math.floor(p.w * 0.45), Math.floor(p.h * 0.7), { body: hex('#241412'), head: hex('#241412'), accent: hex('#c9a86a') }, { scale: 2.2, sitting: false });
}

function drawTearRain(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const frame = spec.frame ?? 0;
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0a1020'), hex('#1a2438'), 5);
  rain(p, rand, 130, hex('#8aa4c8'), frame);
  // 仰起的侧脸剪影
  const cx = Math.floor(p.w * 0.44);
  const cy = Math.floor(p.h * 0.5);
  p.ellipse(cx, cy, 20, 26, hex('#06080e'));
  p.polygon(
    [
      [cx + 16, cy - 6],
      [cx + 30, cy + 4],
      [cx + 26, cy + 40],
      [cx - 20, cy + 44],
      [cx - 20, cy + 10],
    ],
    hex('#06080e'),
  );
  // 泪光
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    p.set(cx + 18, cy + 6 + i * 3, hex('#bfe0ff'), 0.8 - t * 0.05);
    if (i % 2 === 0) p.set(cx + 14, cy + 10 + i * 3, hex('#7fa8d8'), 0.5);
  }
  // 地面水洼
  p.rect(0, Math.floor(p.h * 0.82), p.w, Math.floor(p.h * 0.18), hex('#0a0e18'));
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(rand() * p.w);
    p.hline(x, x + 2 + Math.floor(rand() * 4), Math.floor(p.h * 0.84 + rand() * 40), hex('#3a5a88'), 0.35);
  }
}

function drawEyesMeet(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const frame = spec.frame ?? 0;
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#080a18'), hex('#1c2038'), 5);
  stars(p, rand, 55, Math.floor(p.h * 0.5), frame);
  p.crescent(Math.floor(p.w * 0.5), Math.floor(p.h * 0.2), 6, hex('#ffe9b0'), 2);
  // 两人侧脸，相对
  const y = Math.floor(p.h * 0.52);
  const leftX = Math.floor(p.w * 0.34);
  const rightX = Math.floor(p.w * 0.66);
  const profile = (x: number, dir: 1 | -1, color: RGB) => {
    p.ellipse(x, y, 13, 16, color);
    p.polygon(
      [
        [x + dir * 10, y - 4],
        [x + dir * 20, y + 4],
        [x + dir * 16, y + 34],
        [x - dir * 14, y + 38],
        [x - 13, y + 6],
      ],
      color,
    );
    p.set(x + dir * 8, y - 2, hex('#ffd27a'));
    p.set(x + dir * 9, y - 2, hex('#ffd27a'));
  };
  profile(leftX, 1, hex('#06080e'));
  profile(rightX, -1, hex('#06080e'));
  // 视线之间的红线
  for (let i = 0; i < 24; i++) {
    const t = i / 24;
    const x = leftX + 8 + (rightX - leftX - 16) * t;
    const yy = y - 2 + Math.sin(t * Math.PI) * 6;
    p.set(x, yy, hex('#c93a4a'), 0.85);
    if (i % 3 === 0) p.set(x, yy + 1, hex('#8a1e2a'), 0.6);
  }
  // 地面
  p.rect(0, Math.floor(p.h * 0.82), p.w, Math.floor(p.h * 0.18), hex('#0a0c16'));
}

function drawSwordsman(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.55), hex('#120c18'), hex('#3a2030'), 5);
  p.crescent(Math.floor(p.w * 0.2), Math.floor(p.h * 0.18), 5, hex('#ffe9b0'), 2);
  const ground = Math.floor(p.h * 0.84);
  p.rect(0, ground, p.w, p.h - ground, hex('#0a080c'));
  const cx = Math.floor(p.w * 0.5);
  const cy = Math.floor(p.h * 0.5);
  // 身体
  p.polygon(
    [
      [cx - 16, cy + 60],
      [cx + 18, cy + 60],
      [cx + 12, cy - 6],
      [cx - 12, cy - 6],
    ],
    hex('#08060a'),
  );
  p.ellipse(cx, cy - 20, 13, 14, hex('#08060a'));
  // 挥剑的手臂与剑
  p.thickLine(cx + 8, cy + 4, cx + 34, cy - 24, 6, hex('#08060a'));
  p.thickLine(cx + 34, cy - 24, cx + 62, cy - 58, 3, hex('#cfd6e8'));
  p.thickLine(cx + 30, cy - 20, cx + 40, cy - 12, 4, hex('#8a5a2a'));
  // 红披风 / 血
  p.polygon(
    [
      [cx - 12, cy - 4],
      [cx - 34, cy + 30],
      [cx - 22, cy + 58],
      [cx - 8, cy + 26],
    ],
    hex('#8a1e2a'),
    0.9,
  );
  for (let i = 0; i < 18; i++) {
    p.set(cx + 50 + Math.floor(rand() * 20), cy - 40 + Math.floor(rand() * 30), hex('#e03a3a'), 0.7);
  }
  // 地面暗红
  p.hline(cx - 30, cx + 50, ground - 1, hex('#4a1418'), 0.6);
}

function drawScrollMemory(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const frame = spec.frame ?? 0;
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0e0a10'), hex('#241a20'), 5);
  // 光柱
  for (let x = Math.floor(p.w * 0.2); x < p.w * 0.7; x += 2) {
    p.vline(x, 0, p.h, hex('#3a3040'), 0.12);
  }
  // 漂浮的卷轴
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(rand() * p.w);
    const y = ((rand() * p.h + frame * 0.6) % p.h);
    const w = 14 + Math.floor(rand() * 12);
    p.rect(x, y, w, 7, hex('#e0d4b4'), 0.85);
    p.rect(x, y, w, 1, hex('#a89068'));
    for (let k = 0; k < 3; k++) p.vline(x + 2 + k * 4, y + 2, y + 5, hex('#6a5a44'), 0.8);
  }
  // 底部读书的剪影
  person(p, Math.floor(p.w * 0.5), Math.floor(p.h * 0.9), { body: hex('#060409'), head: hex('#060409') }, { scale: 1.8, sitting: true });
  // 浮尘
  for (let i = 0; i < 30; i++) p.set(Math.floor(rand() * p.w), Math.floor(rand() * p.h * 0.8), hex('#c9b89a'), 0.3);
}

function drawOldTree(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.6), hex('#0a0e1c'), hex('#22304a'), 5);
  stars(p, rand, 40, Math.floor(p.h * 0.4), spec.frame ?? 0);
  p.crescent(Math.floor(p.w * 0.24), Math.floor(p.h * 0.2), 5, hex('#ffe9b0'), 2);
  // 城墙
  p.rect(0, Math.floor(p.h * 0.5), p.w, Math.floor(p.h * 0.16), hex('#1a1622'));
  for (let x = 0; x < p.w; x += 8) p.rect(x, Math.floor(p.h * 0.5) - 3, 4, 3, hex('#1a1622'));
  // 地面
  p.rect(0, Math.floor(p.h * 0.66), p.w, Math.floor(p.h * 0.34), hex('#120e16'));
  // 老树干
  const tx = Math.floor(p.w * 0.62);
  p.rect(tx, Math.floor(p.h * 0.3), 16, Math.floor(p.h * 0.4), hex('#1a120e'));
  p.rect(tx + 3, Math.floor(p.h * 0.3), 3, Math.floor(p.h * 0.4), hex('#2a1e16'));
  p.thickLine(tx + 8, Math.floor(p.h * 0.32), tx - 30, Math.floor(p.h * 0.16), 5, hex('#1a120e'));
  p.thickLine(tx + 12, Math.floor(p.h * 0.36), tx + 50, Math.floor(p.h * 0.2), 4, hex('#1a120e'));
  // 树根延伸
  for (let i = 0; i < 6; i++) {
    const endX = tx + (i - 3) * 22;
    p.thickLine(tx + 8, Math.floor(p.h * 0.7), endX, Math.floor(p.h * 0.86 + (i % 2) * 6), 3, hex('#1a120e'));
  }
  // 残叶
  for (let i = 0; i < 24; i++) p.hline(Math.floor(rand() * p.w), Math.floor(rand() * p.w) + 1, Math.floor(p.h * (0.5 + rand() * 0.3)), hex('#8a4a2a'), 0.6);
  person(p, Math.floor(p.w * 0.3), Math.floor(p.h * 0.88), { body: hex('#08060a'), head: hex('#08060a') }, { scale: 1.6 });
}

function drawStoneAlley(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const horizon = Math.floor(p.h * 0.5);
  p.bandGradient(0, p.w - 1, 0, horizon, hex('#0a1024'), hex('#2a3450'), 5);
  stars(p, rand, 40, Math.floor(p.h * 0.35), spec.frame ?? 0);
  p.crescent(Math.floor(p.w * 0.5), Math.floor(p.h * 0.16), 7, hex('#ffe9b0'), 2);
  // 远山
  for (let x = 0; x < p.w; x++) {
    const y = horizon - 8 + Math.sin((x / p.w) * 8) * 6;
    p.vline(x, y, horizon, hex('#141a2e'));
  }
  // 两侧墙（透视）
  p.polygon([[0, 0], [Math.floor(p.w * 0.2), horizon - 6], [Math.floor(p.w * 0.2), p.h], [0, p.h]], hex('#12101a'));
  p.polygon([[p.w - 1, 0], [Math.floor(p.w * 0.8), horizon - 6], [Math.floor(p.w * 0.8), p.h], [p.w - 1, p.h]], hex('#12101a'));
  // 青石板路
  p.polygon(
    [
      [Math.floor(p.w * 0.2), horizon],
      [Math.floor(p.w * 0.8), horizon],
      [p.w, p.h],
      [0, p.h],
    ],
    hex('#2a2a38'),
  );
  for (let i = 0; i < 12; i++) {
    const t = i / 12;
    const y = Math.floor(horizon + (p.h - horizon) * Math.pow(t, 1.4));
    p.hline(Math.floor(p.w * (0.2 - t * 0.2)), Math.floor(p.w * (0.8 + t * 0.2)), y, hex('#3a3a4c'), 0.7);
  }
  // 月光照在石板
  for (let i = 0; i < 10; i++) {
    const y = horizon + Math.floor(rand() * (p.h - horizon));
    p.hline(Math.floor(p.w * 0.42 + rand() * p.w * 0.16), Math.floor(p.w * 0.5 + rand() * p.w * 0.2), y, hex('#8a9ac8'), 0.25);
  }
  // 灯笼
  for (const x of [0.18, 0.82]) {
    const lx = Math.floor(p.w * x);
    p.rect(lx - 2, horizon + 10, 5, 7, hex('#ffb45a'));
    p.set(lx, horizon + 12, hex('#fff0c0'));
    p.rect(lx, horizon + 4, 1, 6, hex('#2a1a14'));
  }
  // 走远的人
  person(p, Math.floor(p.w * 0.5), Math.floor(p.h * 0.78), { body: hex('#06060a'), head: hex('#06060a'), accent: hex('#c9a86a') }, { scale: 1.6 });
}

function drawHorseRider(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.6), hex('#2a1820'), hex('#8a4a3a'), 5);
  p.circle(Math.floor(p.w * 0.76), Math.floor(p.h * 0.28), 5, hex('#ffe0a8'));
  const ground = Math.floor(p.h * 0.82);
  p.rect(0, ground, p.w, p.h - ground, hex('#1a1210'));
  p.hline(0, p.w - 1, ground, hex('#4a2e22'));
  const bx = Math.floor(p.w * 0.46);
  const by = ground - 10;
  // 马身
  p.rect(bx - 26, by - 18, 52, 18, hex('#0a080c'));
  p.polygon(
    [
      [bx + 20, by - 20],
      [bx + 36, by - 36],
      [bx + 44, by - 30],
      [bx + 32, by - 16],
    ],
    hex('#0a080c'),
  );
  // 腿
  for (const lx of [bx - 20, bx - 8, bx + 10, bx + 22]) p.rect(lx, by, 4, ground - by, hex('#0a080c'));
  // 尾
  p.thickLine(bx - 26, by - 16, bx - 40, by + 6, 4, hex('#0a080c'));
  // 骑手
  p.ellipse(bx - 2, by - 42, 7, 8, hex('#0a080c'));
  p.polygon(
    [
      [bx - 10, by - 34],
      [bx + 8, by - 34],
      [bx + 6, by - 18],
      [bx - 8, by - 18],
    ],
    hex('#0a080c'),
  );
  p.thickLine(bx + 4, by - 32, bx + 26, by - 38, 3, hex('#0a080c'));
  // 尘土
  for (let i = 0; i < 26; i++) p.set(bx - 30 - Math.floor(rand() * 50), ground - Math.floor(rand() * 14), hex('#8a6a4a'), 0.4);
  void spec;
}

function drawWineJar(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#140c08'), hex('#2a1a10'), 5);
  // 窗
  const wx = Math.floor(p.w * 0.62);
  p.rect(wx, Math.floor(p.h * 0.14), Math.floor(p.w * 0.26), Math.floor(p.h * 0.26), hex('#0a1024'));
  p.crescent(wx + Math.floor(p.w * 0.18), Math.floor(p.h * 0.22), 4, hex('#ffe9b0'), 2);
  // 桌子
  const tableY = Math.floor(p.h * 0.72);
  p.rect(Math.floor(p.w * 0.12), tableY, Math.floor(p.w * 0.7), 5, hex('#4a2e1a'));
  p.rect(Math.floor(p.w * 0.16), tableY + 5, 5, Math.floor(p.h * 0.22), hex('#3a2214'));
  p.rect(Math.floor(p.w * 0.74), tableY + 5, 5, Math.floor(p.h * 0.22), hex('#3a2214'));
  // 酒坛
  const jx = Math.floor(p.w * 0.34);
  const jy = tableY;
  p.rect(jx - 14, jy - 34, 29, 34, hex('#6a4428'));
  p.rect(jx - 16, jy - 22, 33, 22, hex('#7a5232'));
  p.rect(jx - 8, jy - 42, 17, 9, hex('#5a3a20'));
  p.hline(jx - 16, jx + 16, jy - 26, hex('#c9a86a'), 0.6);
  p.rect(jx - 7, jy - 32, 14, 8, hex('#c9a86a'), 0.85);
  p.rect(jx - 5, jy - 30, 10, 1, hex('#6a4a28'));
  // 碗
  p.rect(jx + 28, jy - 8, 12, 8, hex('#c9a86a'));
  p.rect(jx + 30, jy - 6, 8, 2, hex('#8a5a2a'));
  // 烛火
  const cx2 = Math.floor(p.w * 0.66);
  p.rect(cx2, jy - 18, 3, 18, hex('#e0d4b4'));
  p.ellipse(cx2 + 1, jy - 22, 2, 4, hex('#ffcf6a'));
  for (let i = 0; i < 20; i++) p.set(cx2 + Math.floor(rand() * 12) - 6, jy - 26 - Math.floor(rand() * 12), hex('#ffb45a'), 0.2);
  person(p, Math.floor(p.w * 0.2), Math.floor(p.h * 0.9), { body: hex('#0a0608'), head: hex('#0a0608') }, { scale: 1.6, sitting: true });
  void spec;
}

function drawSwordWound(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0a0606'), hex('#2a100e'), 5);
  // 地面
  const ground = Math.floor(p.h * 0.82);
  p.rect(0, ground, p.w, p.h - ground, hex('#0a0606'));
  // 断剑插地
  const sx = Math.floor(p.w * 0.48);
  p.thickLine(sx - 26, ground - 70, sx + 18, ground + 4, 5, hex('#8a8a9a'));
  p.thickLine(sx - 26, ground - 70, sx - 34, ground - 64, 3, hex('#cfd6e8'));
  p.thickLine(sx - 18, ground - 42, sx - 2, ground - 46, 8, hex('#6a4a2a'));
  // 红布
  p.polygon(
    [
      [sx - 4, ground - 44],
      [sx + 34, ground - 30],
      [sx + 26, ground - 2],
      [sx - 10, ground - 12],
    ],
    hex('#7a1822'),
    0.92,
  );
  for (let i = 0; i < 5; i++) p.vline(sx + 8 + i * 5, ground - 26, ground - 6, hex('#a82a32'), 0.6);
  // 血滴
  for (let i = 0; i < 22; i++) p.set(Math.floor(sx + (rand() - 0.5) * 60), ground - Math.floor(rand() * 12), hex('#c02030'), 0.7);
  // 余烬
  for (let i = 0; i < 30; i++) p.set(Math.floor(rand() * p.w), Math.floor(p.h * (0.3 + rand() * 0.4)), hex('#ff9a4a'), 0.4);
  // 风中的残旗影
  p.polygon(
    [
      [Math.floor(p.w * 0.14), Math.floor(p.h * 0.2)],
      [Math.floor(p.w * 0.26), Math.floor(p.h * 0.24)],
      [Math.floor(p.w * 0.22), Math.floor(p.h * 0.34)],
      [Math.floor(p.w * 0.12), Math.floor(p.h * 0.3)],
    ],
    hex('#3a1216'),
    0.8,
  );
  void spec;
}

function drawCandle(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0c0908'), hex('#1e1410'), 5);
  // 窗与月光
  const wx = Math.floor(p.w * 0.62);
  p.rect(wx, Math.floor(p.h * 0.12), Math.floor(p.w * 0.26), Math.floor(p.h * 0.3), hex('#0a1024'));
  p.crescent(wx + 10, Math.floor(p.h * 0.2), 4, hex('#ffe9b0'), 2);
  // 桌子
  const tableY = Math.floor(p.h * 0.74);
  p.rect(Math.floor(p.w * 0.18), tableY, Math.floor(p.w * 0.56), 5, hex('#3a2418'));
  // 蜡烛
  const cx = Math.floor(p.w * 0.4);
  p.rect(cx - 4, tableY - 34, 9, 34, hex('#e8dcc0'));
  for (let i = 0; i < 3; i++) p.rect(cx - 3 + i * 3, tableY - 34, 1, 8 + (i % 2) * 5, hex('#c9b89a'), 0.6);
  p.ellipse(cx, tableY - 38, 3, 6, hex('#ffcf6a'));
  p.ellipse(cx, tableY - 37, 2, 3, hex('#fff6d0'));
  for (let i = 0; i < 26; i++) p.set(cx + Math.floor(rand() * 22) - 11, tableY - 44 - Math.floor(rand() * 14), hex('#ffb45a'), 0.16);
  // 影子
  p.polygon(
    [[cx + 6, tableY], [Math.floor(p.w * 0.9), Math.floor(p.h * 0.9)], [Math.floor(p.w * 0.9), p.h], [cx + 2, p.h]],
    hex('#060404'),
    0.5,
  );
  void spec;
}

function drawWindingRoad(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.5), hex('#080c1c'), hex('#26304a'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.5), p.h, hex('#1a2030'), hex('#080a12'), 5);
  stars(p, rand, 50, Math.floor(p.h * 0.4), spec.frame ?? 0);
  p.crescent(Math.floor(p.w * 0.24), Math.floor(p.h * 0.18), 6, hex('#ffe9b0'), 2);
  // 远山
  for (let x = 0; x < p.w; x++) {
    const y = Math.floor(p.h * 0.5) - 6 + Math.sin((x / p.w) * 9 + 1) * 5;
    p.vline(x, y, Math.floor(p.h * 0.62), hex('#0c1220'));
  }
  // 蜿蜒小路
  for (let i = 0; i < 90; i++) {
    const t = i / 90;
    const y = Math.floor(p.h * (0.58 + t * 0.38));
    const x = Math.floor(p.w * (0.5 + Math.sin(t * 5.2 + 0.6) * (0.16 + t * 0.18)));
    p.hline(x - 1 - Math.floor(t * 5), x + 1 + Math.floor(t * 5), y, hex('#4a4458'), 0.85);
    if (i % 6 === 0) p.set(x, y, hex('#ffcf8a'), 0.5);
  }
  // 赶路的人
  person(p, Math.floor(p.w * 0.4), Math.floor(p.h * 0.86), { body: hex('#06060a'), head: hex('#06060a'), accent: hex('#c9a86a') }, { scale: 1.6 });
  drawBirds(p, 3, hex('#101828'), 0.28);
}

/* ------------------------------------------------------------------ */
/* 古风场景：宫殿 / 酒肆 / 城楼 / 山道 / 残旗战场 / 灯河                 */
/* ------------------------------------------------------------------ */

function drawPalace(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const horizon = Math.floor(p.h * 0.74);
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.22), hex('#120c20'), hex('#2a1836'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.22), Math.floor(p.h * 0.5), hex('#2a1836'), hex('#5a2f48'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.5), horizon, hex('#5a2f48'), hex('#a85a5e'), 6);
  stars(p, rand, 40, Math.floor(p.h * 0.4), spec.frame ?? 0);
  p.crescent(Math.floor(p.w * 0.76), Math.floor(p.h * 0.2), 5, hex('#ffe9b0'), 2);
  // 双层屋顶
  const roof = (cx: number, baseY: number, halfW: number, h: number, edge: RGB, body: RGB) => {
    for (let i = 0; i < h; i++) {
      const t = i / h;
      const uplift = Math.round(Math.sin(t * Math.PI) * 2);
      const half = Math.max(2, Math.round(halfW * (1 - t * 0.55))) + uplift;
      p.hline(cx - half, cx + half, baseY - i, i === h - 1 ? edge : body);
    }
    p.hline(cx - Math.round(halfW * 0.9), cx + Math.round(halfW * 0.9), baseY + 1, edge);
  };
  roof(Math.floor(p.w * 0.5), Math.floor(p.h * 0.5), Math.floor(p.w * 0.36), Math.floor(p.h * 0.12), hex('#8a5a3a'), hex('#150d18'));
  roof(Math.floor(p.w * 0.5), Math.floor(p.h * 0.62), Math.floor(p.w * 0.46), Math.floor(p.h * 0.1), hex('#8a5a3a'), hex('#120a14'));
  // 立柱与宫墙
  p.rect(0, Math.floor(p.h * 0.64), p.w, Math.floor(p.h * 0.2), hex('#2a1418'));
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(p.w * (0.08 + i * 0.14));
    p.rect(x, Math.floor(p.h * 0.64), 4, Math.floor(p.h * 0.2), hex('#6a2028'));
    p.rect(x, Math.floor(p.h * 0.64), 1, Math.floor(p.h * 0.2), hex('#9a3a34'));
  }
  // 宫灯
  for (let i = 0; i < 5; i++) {
    const lx = Math.floor(p.w * (0.14 + i * 0.18));
    const ly = Math.floor(p.h * 0.66);
    p.rect(lx - 2, ly, 5, 5, hex('#ffb45a'));
    p.set(lx, ly + 1, hex('#fff0c0'));
    p.rect(lx, ly - 3, 1, 3, hex('#3a1e1a'));
  }
  // 台阶
  for (let i = 0; i < 5; i++) {
    p.hline(Math.floor(p.w * (0.18 + i * 0.03)), Math.floor(p.w * (0.82 - i * 0.03)), horizon + i * 3, hex('#241820'));
  }
  person(p, Math.floor(p.w * 0.5), horizon + 14, { body: hex('#0a0710'), head: hex('#0a0710'), accent: hex('#c9a86a') }, { scale: 1.2 });
}

function drawTavern(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#1a0f0a'), hex('#2e1a10'), 5);
  // 木梁
  for (let y = Math.floor(p.h * 0.12); y < p.h; y += Math.floor(p.h * 0.2)) p.hline(0, p.w - 1, y, hex('#120a06'));
  // 窗
  const x0 = Math.floor(p.w * 0.6);
  const y0 = Math.floor(p.h * 0.16);
  p.rect(x0 - 2, y0 - 2, Math.floor(p.w * 0.28) + 4, Math.floor(p.h * 0.26) + 4, hex('#0e0a08'));
  p.bandGradient(x0, x0 + Math.floor(p.w * 0.28), y0, y0 + Math.floor(p.h * 0.26), hex('#0a1024'), hex('#2a2440'), 5);
  p.crescent(x0 + Math.floor(p.w * 0.2), y0 + 8, 3, hex('#ffe9b0'), 2);
  p.rect(Math.floor((x0 + x0 + p.w * 0.28) / 2), y0, 1, Math.floor(p.h * 0.26), hex('#0e0a08'));
  // 灯笼
  for (let i = 0; i < 2; i++) {
    const lx = Math.floor(p.w * (0.18 + i * 0.26));
    const ly = Math.floor(p.h * 0.2);
    p.rect(lx - 3, ly, 7, 9, hex('#d8482a'));
    p.rect(lx - 2, ly + 1, 5, 2, hex('#ff8a4a'));
    p.rect(lx, ly - 5, 1, 5, hex('#3a1e14'));
    for (let k = 0; k < 4; k++) p.set(lx - 6 + k * 4, ly + 12, hex('#ffcf8a'), 0.5);
  }
  // 柜台与酒坛
  const counterY = Math.floor(p.h * 0.66);
  p.rect(0, counterY, Math.floor(p.w * 0.42), Math.floor(p.h * 0.34), hex('#3a2214'));
  p.hline(0, Math.floor(p.w * 0.42), counterY, hex('#5a3a22'));
  for (let i = 0; i < 4; i++) {
    const jx = Math.floor(p.w * (0.04 + i * 0.1));
    p.rect(jx, counterY - 9, 7, 9, hex('#6a4a2a'));
    p.rect(jx + 1, counterY - 10, 5, 2, hex('#8a6a3a'));
    p.rect(jx + 3, counterY - 12, 1, 2, hex('#3a2a18'));
  }
  // 桌与人
  const tx = Math.floor(p.w * 0.56);
  p.rect(tx, Math.floor(p.h * 0.68), Math.floor(p.w * 0.26), 3, hex('#4a2e1a'));
  p.rect(tx + 4, Math.floor(p.h * 0.68) + 3, 2, Math.floor(p.h * 0.2), hex('#3a2214'));
  p.rect(tx + Math.floor(p.w * 0.2), Math.floor(p.h * 0.68) + 3, 2, Math.floor(p.h * 0.2), hex('#3a2214'));
  p.rect(tx + 6, Math.floor(p.h * 0.65), 3, 3, hex('#c9a86a'));
  p.rect(tx + 14, Math.floor(p.h * 0.65), 3, 3, hex('#c9a86a'));
  person(p, tx + Math.floor(p.w * 0.1), Math.floor(p.h * 0.9), { body: hex('#120a08'), head: hex('#120a08') }, { scale: 1.4, sitting: true });
  // 蒸汽
  for (let i = 0; i < 12; i++) p.set(tx + 8 + Math.floor(rand() * 10), Math.floor(p.h * 0.6) - i, hex('#c9b89a'), 0.25);
}

function drawCityGate(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const horizon = Math.floor(p.h * 0.86);
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.24), hex('#070b18'), hex('#12203a'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.24), horizon, hex('#12203a'), hex('#2a3a58'), 6);
  stars(p, rand, 50, Math.floor(p.h * 0.5), spec.frame ?? 0);
  p.crescent(Math.floor(p.w * 0.22), Math.floor(p.h * 0.18), 5, hex('#f4f4ff'), 2);
  // 城墙
  const wallTop = Math.floor(p.h * 0.46);
  p.rect(0, wallTop, p.w, horizon - wallTop, hex('#1a1622'));
  for (let y = wallTop + 3; y < horizon; y += 5) p.hline(0, p.w - 1, y, hex('#241e2e'), 0.6);
  for (let x = 0; x < p.w; x += 8) p.rect(x, wallTop - 3, 4, 3, hex('#1a1622'));
  // 城门
  const gateW = Math.floor(p.w * 0.2);
  const gx = Math.floor((p.w - gateW) / 2);
  for (let i = 0; i < 14; i++) {
    const half = Math.round((gateW / 2) * Math.sqrt(1 - Math.pow((i - 13) / 14, 2)));
    p.hline(gx + gateW / 2 - half, gx + gateW / 2 + half, horizon - i, hex('#06060a'));
  }
  // 城楼
  for (let tier = 0; tier < 2; tier++) {
    const baseY = wallTop - 4 - tier * Math.floor(p.h * 0.07);
    const half = Math.floor(p.w * (0.3 - tier * 0.06));
    for (let i = 0; i < Math.floor(p.h * 0.055); i++) {
      const t = i / Math.floor(p.h * 0.055);
      p.hline(p.w / 2 - Math.round(half * (1 - t * 0.4)), p.w / 2 + Math.round(half * (1 - t * 0.4)), baseY - i, i === 0 ? hex('#8a5a3a') : hex('#120c14'));
    }
  }
  // 旗
  for (const side of [0.1, 0.9]) {
    const bx = Math.floor(p.w * side);
    p.vline(bx, Math.floor(p.h * 0.34), wallTop, hex('#120c14'));
    p.polygon(
      [
        [bx, Math.floor(p.h * 0.34)],
        [bx + Math.floor(p.w * 0.09), Math.floor(p.h * 0.36)],
        [bx + Math.floor(p.w * 0.08), Math.floor(p.h * 0.42)],
        [bx, Math.floor(p.h * 0.4)],
      ],
      hex('#7a1e2a'),
      0.95,
    );
  }
  // 火把与守卫
  for (const side of [0.32, 0.68]) {
    const tx = Math.floor(p.w * side);
    p.rect(tx, wallTop + 6, 2, 8, hex('#3a2a1a'));
    p.rect(tx - 1, wallTop + 3, 4, 4, hex('#ff8a3a'));
    for (let i = 0; i < 6; i++) p.set(tx + Math.floor(rand() * 5) - 2, wallTop - i, hex('#ffcf8a'), 0.35);
  }
  person(p, Math.floor(p.w * 0.42), horizon, { body: hex('#08060c'), head: hex('#08060c') }, { scale: 1.3 });
  person(p, Math.floor(p.w * 0.6), horizon, { body: hex('#08060c'), head: hex('#08060c') }, { scale: 1.3 });
}

function drawMountainPass(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.3), hex('#0a0e22'), hex('#26304a'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.3), Math.floor(p.h * 0.62), hex('#26304a'), hex('#6a5a72'), 6);
  stars(p, rand, 45, Math.floor(p.h * 0.45), spec.frame ?? 0);
  p.crescent(Math.floor(p.w * 0.7), Math.floor(p.h * 0.2), 6, hex('#fff1cc'), 2);
  // 层叠山脊
  const ridge = (baseY: number, amp: number, color: RGB, phase: number) => {
    for (let x = 0; x < p.w; x++) {
      const y = Math.round(baseY + Math.sin((x / p.w) * 7 + phase) * amp + Math.sin((x / p.w) * 17 + phase * 2) * amp * 0.35);
      p.vline(x, y, p.h, color);
    }
  };
  ridge(Math.floor(p.h * 0.62), 8, hex('#1a2236'), 0.4);
  ridge(Math.floor(p.h * 0.72), 10, hex('#121a2a'), 1.7);
  ridge(Math.floor(p.h * 0.82), 12, hex('#0a0e18'), 3.1);
  // 山道
  for (let i = 0; i < 46; i++) {
    const t = i / 46;
    const y = Math.floor(p.h * (0.66 + t * 0.3));
    const x = Math.floor(p.w * (0.18 + t * 0.5) + Math.sin(t * 6) * 6);
    p.hline(x, x + 3 + Math.floor(t * 6), y, hex('#4a4258'), 0.7);
  }
  // 松树
  for (const side of [0.08, 0.92]) {
    const tx = Math.floor(p.w * side);
    for (let tier = 0; tier < 4; tier++) {
      const ty = Math.floor(p.h * (0.52 + tier * 0.09));
      const half = Math.floor(p.w * (0.05 + tier * 0.015));
      for (let i = 0; i < Math.floor(p.h * 0.05); i++) {
        p.hline(tx - Math.round(half * (1 - i / Math.floor(p.h * 0.05))), tx + Math.round(half * (1 - i / Math.floor(p.h * 0.05))), ty + i, hex('#060a10'));
      }
    }
    p.rect(tx - 1, Math.floor(p.h * 0.7), 2, Math.floor(p.h * 0.14), hex('#060a10'));
  }
  // 行人 + 拐杖
  const px = Math.floor(p.w * 0.42);
  const py = Math.floor(p.h * 0.88);
  person(p, px, py, { body: hex('#05070c'), head: hex('#05070c'), accent: hex('#c9a86a') }, { scale: 1.5 });
  p.vline(px - 8, py - 26, py, hex('#0a0c12'));
  drawBirds(p, 3, hex('#1a2030'), 0.3);
}

function drawBattlefield(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.3), hex('#0a0608'), hex('#24100e'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.3), Math.floor(p.h * 0.62), hex('#24100e'), hex('#5a2418'), 6);
  // 远处火光
  for (let i = 0; i < 160; i++) {
    const x = Math.floor(rand() * p.w * 0.5);
    const y = Math.floor(p.h * (0.5 + rand() * 0.15));
    p.set(x, y, hex('#ff8a3a'), 0.06 + rand() * 0.1);
  }
  // 地面
  const ground = Math.floor(p.h * 0.72);
  p.rect(0, ground, p.w, p.h - ground, hex('#0a0708'));
  p.hline(0, p.w - 1, ground, hex('#2a1a14'));
  // 残旗
  const flag = (bx: number, lean: number) => {
    const top = Math.floor(p.h * 0.36);
    p.thickLine(bx, ground, bx + lean, top, 2, hex('#0e0a0c'));
    p.polygon(
      [
        [bx + lean, top],
        [bx + lean + 14, top + 3],
        [bx + lean + 10, top + 9],
        [bx + lean + 2, top + 7],
        [bx + lean, top + 12],
      ],
      hex('#6a1c22'),
      0.9,
    );
    for (let i = 0; i < 6; i++) p.set(bx + lean + 3 + i * 2, top + 4 + (i % 3), hex('#a83a30'), 0.6);
  };
  flag(Math.floor(p.w * 0.2), 8);
  flag(Math.floor(p.w * 0.68), -10);
  // 插在地上的剑
  for (let i = 0; i < 4; i++) {
    const sx = Math.floor(p.w * (0.36 + i * 0.08));
    const sy = ground + 4 + (i % 2) * 4;
    p.vline(sx, sy - 20, sy, hex('#2a2a34'));
    p.hline(sx - 4, sx + 4, sy - 16, hex('#3a3a44'));
    p.set(sx, sy - 21, hex('#8a8a9a'));
  }
  // 乌鸦
  for (let i = 0; i < 4; i++) {
    const cx2 = Math.floor(rand() * p.w);
    const cy2 = Math.floor(p.h * (0.15 + rand() * 0.25));
    p.hline(cx2 - 2, cx2 - 1, cy2, hex('#050508'));
    p.hline(cx2 + 1, cx2 + 2, cy2, hex('#050508'));
    p.set(cx2, cy2 - 1, hex('#050508'));
  }
  // 余烬
  for (let i = 0; i < 40; i++) p.set(Math.floor(rand() * p.w), Math.floor(p.h * (0.3 + rand() * 0.4)), hex('#ffcf8a'), 0.5);
  void spec;
}

function drawLanternRiver(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const horizon = Math.floor(p.h * 0.58);
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.3), hex('#060a1c'), hex('#121a34'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.3), horizon, hex('#121a34'), hex('#2a3050'), 6);
  stars(p, rand, 60, Math.floor(p.h * 0.4), spec.frame ?? 0);
  p.crescent(Math.floor(p.w * 0.78), Math.floor(p.h * 0.2), 6, hex('#ffe9b0'), 2);
  // 远处桥与宫殿剪影
  p.hline(0, p.w - 1, horizon, hex('#0a0e18'));
  for (let i = 0; i < 3; i++) {
    const bx = Math.floor(p.w * (0.1 + i * 0.36));
    for (let tier = 0; tier < 2; tier++) {
      const baseY = horizon - 6 - tier * 7;
      const half = Math.floor(p.w * (0.09 - tier * 0.02));
      for (let k = 0; k < 6; k++) p.hline(bx - Math.round(half * (1 - k / 6)), bx + Math.round(half * (1 - k / 6)), baseY - k, hex('#0a0e18'));
    }
  }
  // 水面
  p.bandGradient(0, p.w - 1, horizon, p.h, hex('#101a2e'), hex('#05070c'), 5);
  // 河灯
  for (let i = 0; i < 16; i++) {
    const lx = Math.floor(rand() * p.w);
    const ly = horizon + 6 + Math.floor(rand() * (p.h - horizon - 10));
    p.rect(lx - 1, ly, 3, 2, hex('#ffd27a'));
    p.set(lx, ly - 1, hex('#fff0c0'));
    p.set(lx - 2, ly, hex('#ff9a4a'), 0.6);
    p.set(lx + 3, ly, hex('#ff9a4a'), 0.6);
    for (let k = 0; k < 4; k++) p.set(lx - 1 + k, ly + 3 + k, hex('#ffb45a'), 0.25);
    if (rand() > 0.6) p.hline(lx - 3, lx + 4, ly + 6, hex('#ff9a4a'), 0.18);
  }
  // 波纹
  for (let i = 0; i < 26; i++) {
    const y = horizon + Math.floor(rand() * (p.h - horizon));
    const x = Math.floor(rand() * p.w);
    p.hline(x, x + 2 + Math.floor(rand() * 5), y, hex('#3a4a6a'), 0.35);
  }
  drawBirds(p, 2, hex('#0a0e18'), 0.25);
  void spec;
}

/* ------------------------------------------------------------------ */
/* 场景选择                                                            */
/* ------------------------------------------------------------------ */

function drawFireBattle(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const horizon = Math.floor(p.h * 0.58);
  // 烟云天空
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.22), hex('#0b0609'), hex('#25100f'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.22), Math.floor(p.h * 0.42), hex('#25100f'), hex('#4a1a12'), 5);
  p.bandGradient(0, p.w - 1, Math.floor(p.h * 0.42), horizon, hex('#4a1a12'), hex('#8a3418'), 6);
  // 火光晕
  const glowX = Math.floor(p.w * 0.5);
  for (let i = 0; i < 240; i++) {
    const gx = glowX + Math.floor((rand() - 0.5) * p.w * 0.7);
    const gy = Math.floor(p.h * 0.45 + rand() * p.h * 0.2);
    p.set(gx, gy, hex('#ff9a40'), 0.05 + rand() * 0.08);
  }
  // 江面
  p.bandGradient(0, p.w - 1, horizon, p.h, hex('#4a1c10'), hex('#0c0608'), 5);
  // 火光倒影
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(p.w * 0.2 + rand() * p.w * 0.6);
    const y = horizon + Math.floor(rand() * (p.h - horizon));
    p.hline(x, x + 1 + Math.floor(rand() * 4), y, hex('#ff8a3a'), 0.25 + rand() * 0.2);
  }
  // 战船剪影（变体 1 船更近、更密）
  const variant = spec.variant ?? 0;
  const ships = variant === 1 ? [0.14, 0.3, 0.46, 0.62, 0.78, 0.9] : [0.22, 0.42, 0.62, 0.8];
  const baseScale = variant === 1 ? 1.2 : 0.8;
  for (let s = 0; s < ships.length; s++) {
    const bx = Math.floor(p.w * ships[s]);
    const by = horizon + Math.floor(p.h * 0.04 + s * 2);
    const sc = baseScale + (s % 2) * 0.35;
    p.hline(bx - 14 * sc, bx + 14 * sc, by, hex('#07040a'));
    p.hline(bx - 12 * sc, bx + 12 * sc, by + 1, hex('#07040a'));
    p.hline(bx - 9 * sc, bx + 9 * sc, by + 2, hex('#07040a'));
    p.vline(bx, by - 20 * sc, by, hex('#07040a'));
    p.rect(bx, by - 18 * sc, 9 * sc, 1, hex('#07040a'));
    p.rect(bx + 2 * sc, by - 17 * sc, 1, 12 * sc, hex('#07040a'));
    // 火光
    p.set(bx - 6 * sc, by - 2, hex('#ffb050'));
    p.set(bx + 5 * sc, by - 4, hex('#ff7a30'));
  }
  // 火焰
  for (let i = 0; i < 8; i++) {
    const fx = Math.floor(p.w * (0.15 + rand() * 0.7));
    const fy = horizon + 2;
    for (let k = 0; k < 5; k++) {
      const h = Math.floor(2 + rand() * 5);
      p.vline(fx + k - 2, fy - h, fy, k % 2 ? hex('#ffb050') : hex('#ff6a20'), 0.85);
    }
  }
  // 火星
  for (let i = 0; i < 50; i++) {
    const x = Math.floor(rand() * p.w);
    const y = Math.floor(p.h * 0.2 + rand() * p.h * 0.55);
    p.set(x, y, hex('#ffcf8a'), 0.5 + rand() * 0.4);
  }
  // 近景水波
  for (let i = 0; i < 20; i++) {
    const y = horizon + Math.floor(rand() * (p.h - horizon));
    const x = Math.floor(rand() * p.w);
    p.hline(x, x + 2 + Math.floor(rand() * 6), y, hex('#8a3a1c'), 0.4);
  }
  void spec;
}

/* ------------------------------------------------------------------ */
/* 场景选择                                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* V2：可读性更强的具象插画（脸/泪/人物/树/巷/马/酒/卷轴）              */
/* ------------------------------------------------------------------ */

const SKIN: RGB = [224, 180, 138];
/** 剪影人物（暗色 + 暖色轮廓光，避免“大白脸”的廉价感） */
const SIL: RGB = [10, 9, 15];

function silhouetteProfile(p: Pixel, x: number, y: number, dir: 1 | -1, s = 1, rim: RGB = [255, 200, 150]): void {
  // 头 + 发
  p.ellipse(x, y, 17 * s, 21 * s, SIL);
  p.polygon(
    [
      [x + dir * 11 * s, y - 9 * s],
      [x + dir * 21 * s, y + 2 * s],
      [x + dir * 15 * s, y + 11 * s],
      [x + dir * 8 * s, y + 17 * s],
      [x - dir * 13 * s, y + 19 * s],
      [x - dir * 15 * s, y - 11 * s],
    ],
    SIL,
  );
  // 发髻/长发
  p.polygon(
    [
      [x - dir * 15 * s, y - 19 * s],
      [x - dir * 32 * s, y + 6 * s],
      [x - dir * 25 * s, y + 44 * s],
      [x - dir * 6 * s, y + 22 * s],
    ],
    SIL,
  );
  // 颈与肩袍
  p.polygon(
    [
      [x - dir * 8 * s, y + 17 * s],
      [x + dir * 12 * s, y + 19 * s],
      [x + dir * 22 * s, y + 54 * s],
      [x - dir * 32 * s, y + 58 * s],
    ],
    SIL,
  );
  // 轮廓边缘光
  for (let i = 0; i < 12; i++) {
    p.set(x + dir * 16 * s, y - 8 * s + i * 2.2 * s, rim, 0.75 - i * 0.05);
  }
  // 一点眼神光
  p.set(x + dir * 10 * s, y - 2 * s, [255, 220, 170], 0.9);
}

/** 细颗粒像素风：只保留少量漂浮光尘，避免大色块光晕破坏 16 色板 */
function artDirection(p: Pixel, spec: PixelSceneSpec): void {
  const frame = spec.frame ?? 0;
  for (let i = 0; i < 18; i++) {
    const x = (i * 67 + frame * 2) % p.w;
    const y = (i * 113 + frame * 3) % p.h;
    p.set(x, y, [251, 247, 238], 0.6);
  }
}
const HAIR: RGB = [26, 18, 22];
const ROBE: RGB = [18, 16, 26];

function drawAutumnLeaves2(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const frame = spec.frame ?? 0;
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.55), hex('#4a2c26'), hex('#d89a68'), 6);
  p.circle(Math.floor(p.w * 0.2), Math.floor(p.h * 0.3), 5, hex('#ffe0a8'));
  // 树（左侧）
  const tx = Math.floor(p.w * 0.22);
  p.rect(tx - 5, Math.floor(p.h * 0.2), 11, Math.floor(p.h * 0.62), hex('#2e1c12'));
  p.thickLine(tx, Math.floor(p.h * 0.26), tx + 40, Math.floor(p.h * 0.14), 4, hex('#2e1c12'));
  p.thickLine(tx, Math.floor(p.h * 0.34), tx - 32, Math.floor(p.h * 0.18), 3, hex('#2e1c12'));
  // 树冠叶团
  for (let i = 0; i < 26; i++) {
    const ex = tx + Math.floor((rand() - 0.5) * 92);
    const ey = Math.floor(p.h * 0.1 + rand() * p.h * 0.22);
    p.ellipse(ex, ey, 6 + Math.floor(rand() * 6), 3 + Math.floor(rand() * 3), [hex('#e08a3a'), hex('#c9702a'), hex('#f0b060')][i % 3], 0.85);
  }
  // 地面
  const ground = Math.floor(p.h * 0.78);
  p.rect(0, ground, p.w, p.h - ground, hex('#3a2418'));
  p.hline(0, p.w - 1, ground, hex('#6a4028'));
  // 落叶堆
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(rand() * p.w);
    const y = ground + Math.floor(rand() * p.h * 0.2);
    p.hline(x, x + 1 + Math.floor(rand() * 3), y, [hex('#e08a3a'), hex('#c9702a'), hex('#f0b060')][i % 3], 0.8);
  }
  // 风中飘落的叶子（逐帧）
  for (let i = 0; i < 46; i++) {
    const x = (Math.floor(rand() * p.w) + frame) % p.w;
    const y = (Math.floor(rand() * p.h) + frame * (1 + (i % 3))) % ground;
    p.set(x, y, [hex('#f0b060'), hex('#e08a3a')][i % 2], 0.95);
  }
  // 走在落叶上的人（剪影 + 发髻）
  const px = Math.floor(p.w * 0.58);
  const py = Math.floor(p.h * 0.84);
  p.ellipse(px, py - 58, 9, 10, SIL);
  p.polygon(
    [
      [px - 8, py - 70],
      [px + 8, py - 72],
      [px + 5, py - 60],
      [px - 7, py - 58],
    ],
    SIL,
  );
  p.polygon(
    [
      [px - 12, py - 48],
      [px + 12, py - 48],
      [px + 16, py - 10],
      [px - 16, py - 10],
    ],
    SIL,
  );
  p.thickLine(px - 6, py - 10, px - 12, py, 5, SIL);
  p.thickLine(px + 6, py - 10, px + 14, py, 5, SIL);
  // 衣服轮廓光
  for (let i = 0; i < 8; i++) p.set(px + 14, py - 46 + i * 4, [255, 210, 150], 0.5 - i * 0.04);
  drawBirds(p, 2, hex('#3a2018'), 0.16);
}

function drawTearRain2(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const frame = spec.frame ?? 0;
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0c1226'), hex('#1e2a42'), 5);
  // 侧脸剪影 + 泪光
  const cx = Math.floor(p.w * 0.44);
  const cy = Math.floor(p.h * 0.42);
  silhouetteProfile(p, cx, cy, 1, 1.5);
  for (let i = 0; i < 7; i++) {
    p.set(cx + 18, cy + 6 + i * 3 + ((frame >> 1) % 3), hex('#dff0ff'), 0.9 - i * 0.08);
  }
  p.glow(cx + 20, cy + 22, 24, [150, 200, 255], 0.22);
  // 雨
  for (let i = 0; i < 100; i++) {
    const x = Math.floor(rand() * p.w);
    const y = (Math.floor(rand() * p.h) + frame * 3) % p.h;
    p.vline(x, y, y + 2 + Math.floor(rand() * 4), hex('#8aa4c8'), 0.35);
  }
  // 水洼
  p.rect(0, Math.floor(p.h * 0.88), p.w, Math.floor(p.h * 0.12), hex('#0a0e18'));
}

function drawEyesMeet2(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const frame = spec.frame ?? 0;
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0a0e22'), hex('#20263e'), 5);
  stars(p, rand, 50, Math.floor(p.h * 0.45), frame);
  p.crescent(Math.floor(p.w * 0.5), Math.floor(p.h * 0.16), 7, hex('#ffe9b0'), 2);
  const y = Math.floor(p.h * 0.48);
  const profile = (x: number, dir: 1 | -1) => {
    silhouetteProfile(p, x, y, dir, 1.05, [255, 215, 170]);
    p.set(x + dir * 10, y - 2, [255, 238, 200], 0.95);
    p.glow(x + dir * 10, y - 2, 9, [255, 210, 150], 0.3);
  };
  const leftX = Math.floor(p.w * 0.32);
  const rightX = Math.floor(p.w * 0.68);
  profile(leftX, 1);
  profile(rightX, -1);
  // 红线（从眼神到眼神）
  for (let i = 0; i < 30; i++) {
    const t = i / 30;
    const x = leftX + 26 + (rightX - leftX - 52) * t;
    const yy = y - 4 + Math.sin(t * Math.PI) * 8;
    p.set(x, yy, hex('#d83a4a'), 0.9);
    if (i % 4 === 0) p.set(x, yy + 1, hex('#8a1e2a'), 0.7);
  }
}

function drawSwordsman2(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.62), hex('#160e1c'), hex('#4a2438'), 5);
  p.crescent(Math.floor(p.w * 0.18), Math.floor(p.h * 0.16), 6, hex('#ffe9b0'), 2);
  const ground = Math.floor(p.h * 0.9);
  p.rect(0, ground, p.w, p.h - ground, hex('#0a080c'));
  const cx = Math.floor(p.w * 0.46);
  const cy = Math.floor(p.h * 0.52);
  // 披风
  p.polygon(
    [
      [cx - 14, cy - 20],
      [cx - 50, cy + 34],
      [cx - 30, cy + 90],
      [cx - 6, cy + 30],
    ],
    hex('#9a1e2a'),
    0.95,
  );
  // 腿
  p.thickLine(cx - 8, cy + 44, cx - 18, ground, 8, hex('#0a0810'));
  p.thickLine(cx + 8, cy + 44, cx + 20, ground, 8, hex('#0a0810'));
  // 身体
  p.polygon(
    [
      [cx - 14, cy - 10],
      [cx + 16, cy - 10],
      [cx + 12, cy + 50],
      [cx - 12, cy + 50],
    ],
    hex('#0e0c18'),
  );
  // 头与发
  p.ellipse(cx, cy - 30, 12, 14, SKIN);
  p.polygon(
    [
      [cx - 13, cy - 38],
      [cx + 13, cy - 40],
      [cx + 10, cy - 28],
      [cx - 12, cy - 26],
    ],
    HAIR,
  );
  // 持剑手臂
  p.thickLine(cx + 10, cy - 2, cx + 38, cy - 30, 6, hex('#0e0c18'));
  p.thickLine(cx + 38, cy - 30, cx + 70, cy - 74, 3, hex('#e8f0ff'));
  p.thickLine(cx + 34, cy - 24, cx + 44, cy - 16, 5, hex('#8a5a2a'));
  // 血
  for (let i = 0; i < 14; i++) p.set(cx + 52 + Math.floor(rand() * 22), cy - 50 + Math.floor(rand() * 26), hex('#e03a3a'), 0.8);
  // 地面影子
  p.hline(cx - 34, cx + 44, ground - 1, hex('#2a0e12'), 0.7);
}

function drawOldTree2(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.5), hex('#0a0e1c'), hex('#2a3248'), 5);
  stars(p, rand, 40, Math.floor(p.h * 0.4), spec.frame ?? 0);
  p.crescent(Math.floor(p.w * 0.24), Math.floor(p.h * 0.18), 6, hex('#ffe9b0'), 2);
  // 城墙
  p.rect(0, Math.floor(p.h * 0.44), p.w, Math.floor(p.h * 0.14), hex('#241c2a'));
  for (let x = 0; x < p.w; x += 9) p.rect(x, Math.floor(p.h * 0.44) - 4, 5, 4, hex('#241c2a'));
  for (let y = Math.floor(p.h * 0.47); y < Math.floor(p.h * 0.58); y += 4) p.hline(0, p.w - 1, y, hex('#2e2434'), 0.7);
  // 地面
  p.rect(0, Math.floor(p.h * 0.58), p.w, p.h, hex('#16101a'));
  // 老树
  const tx = Math.floor(p.w * 0.62);
  const ground = Math.floor(p.h * 0.88);
  p.rect(tx - 10, Math.floor(p.h * 0.2), 22, Math.floor(p.h * 0.7), hex('#3a2418'));
  p.rect(tx - 2, Math.floor(p.h * 0.2), 4, Math.floor(p.h * 0.7), hex('#5a3a22'));
  for (let i = 0; i < 8; i++) p.vline(tx - 8 + i * 3, Math.floor(p.h * 0.24), ground - 10, hex('#24160e'), 0.6);
  // 枝
  p.thickLine(tx, Math.floor(p.h * 0.28), tx - 44, Math.floor(p.h * 0.1), 5, hex('#3a2418'));
  p.thickLine(tx + 4, Math.floor(p.h * 0.36), tx + 44, Math.floor(p.h * 0.16), 4, hex('#3a2418'));
  p.thickLine(tx, Math.floor(p.h * 0.44), tx - 52, Math.floor(p.h * 0.3), 3, hex('#3a2418'));
  // 根
  for (let i = 0; i < 6; i++) {
    p.thickLine(tx, ground - 6, tx + (i - 3) * 26, ground + 6 + (i % 2) * 6, 4, hex('#3a2418'));
  }
  // 残叶
  for (let i = 0; i < 30; i++) p.set(Math.floor(rand() * p.w), Math.floor(p.h * (0.25 + rand() * 0.35)), hex('#8a5a2a'), 0.6);
  // 城下的人
  const px = Math.floor(p.w * 0.3);
  const py = Math.floor(p.h * 0.9);
  p.ellipse(px, py - 52, 8, 9, SKIN);
  p.polygon(
    [
      [px - 10, py - 44],
      [px + 10, py - 44],
      [px + 8, py - 6],
      [px - 8, py - 6],
    ],
    hex('#1a1420'),
  );
}

function drawStoneAlley2(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const horizon = Math.floor(p.h * 0.46);
  p.bandGradient(0, p.w - 1, 0, horizon, hex('#0a1024'), hex('#2e3a56'), 5);
  stars(p, rand, 40, Math.floor(p.h * 0.35), spec.frame ?? 0);
  p.crescent(Math.floor(p.w * 0.52), Math.floor(p.h * 0.14), 7, hex('#ffe9b0'), 2);
  // 远山
  for (let x = 0; x < p.w; x++) p.vline(x, horizon - 10 + Math.sin((x / p.w) * 8) * 6, horizon, hex('#121a2e'));
  // 左侧墙 + 瓦
  p.rect(0, horizon - 20, Math.floor(p.w * 0.22), p.h - horizon + 20, hex('#1a1622'));
  // 右侧墙
  p.rect(Math.floor(p.w * 0.78), horizon - 20, Math.ceil(p.w * 0.22), p.h - horizon + 20, hex('#1a1622'));
  for (let y = horizon - 16; y < p.h; y += 6) {
    p.hline(0, Math.floor(p.w * 0.22), y, hex('#2a2230'), 0.8);
    p.hline(Math.floor(p.w * 0.78), p.w - 1, y, hex('#2a2230'), 0.8);
  }
  // 石板路
  p.polygon(
    [
      [Math.floor(p.w * 0.22), horizon],
      [Math.floor(p.w * 0.78), horizon],
      [p.w, p.h],
      [0, p.h],
    ],
    hex('#2e2e3e'),
  );
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    const y = Math.floor(horizon + (p.h - horizon) * Math.pow(t, 1.5));
    p.hline(Math.floor(p.w * (0.22 - t * 0.22)), Math.floor(p.w * (0.78 + t * 0.22)), y, hex('#44445a'), 0.8);
  }
  // 灯笼（左右各两盏）
  for (const [lx, ly] of [
    [0.18, 0.5],
    [0.82, 0.54],
    [0.22, 0.68],
    [0.78, 0.72],
  ]) {
    const x = Math.floor(p.w * lx);
    const y = Math.floor(p.h * ly);
    p.rect(x - 3, y, 7, 9, hex('#e8a04a'));
    p.rect(x - 2, y + 2, 5, 5, hex('#ffe0a0'));
    p.rect(x, y - 5, 1, 5, hex('#2a1a14'));
    for (let k = 0; k < 10; k++) p.set(x + Math.floor(rand() * 20) - 10, y + Math.floor(rand() * 14) - 6, hex('#ffb45a'), 0.12);
  }
  // 人影
  const px = Math.floor(p.w * 0.5);
  const py = Math.floor(p.h * 0.84);
  p.ellipse(px, py - 56, 8, 10, hex('#0a0810'));
  p.polygon(
    [
      [px - 11, py - 46],
      [px + 11, py - 46],
      [px + 8, py - 6],
      [px - 8, py - 6],
    ],
    hex('#0a0810'),
  );
  p.thickLine(px - 4, py - 6, px - 10, py, 4, hex('#0a0810'));
  p.thickLine(px + 4, py - 6, px + 12, py, 4, hex('#0a0810'));
}

function drawHorseRider2(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, Math.floor(p.h * 0.6), hex('#3a2020'), hex('#b0603a'), 5);
  p.circle(Math.floor(p.w * 0.78), Math.floor(p.h * 0.24), 6, hex('#ffe0a8'));
  const ground = Math.floor(p.h * 0.86);
  p.rect(0, ground, p.w, p.h - ground, hex('#241a14'));
  p.hline(0, p.w - 1, ground, hex('#5a3a24'));
  const bx = Math.floor(p.w * 0.46);
  const by = ground - 8;
  // 马身
  p.ellipse(bx, by - 22, 34, 17, hex('#0a080c'));
  // 颈与头
  p.polygon(
    [
      [bx + 26, by - 28],
      [bx + 40, by - 52],
      [bx + 48, by - 48],
      [bx + 44, by - 30],
    ],
    hex('#0a080c'),
  );
  p.rect(bx + 36, by - 56, 14, 10, hex('#0a080c'));
  p.rect(bx + 36, by - 60, 4, 5, hex('#0a080c'));
  p.rect(bx + 46, by - 60, 4, 5, hex('#0a080c'));
  p.set(bx + 44, by - 52, hex('#e8e8f0'));
  // 腿
  for (const lx of [bx - 26, bx - 14, bx + 12, bx + 24]) {
    p.rect(lx, by - 10, 5, ground - by + 10, hex('#0a080c'));
    p.rect(lx, ground - 2, 7, 2, hex('#0a080c'));
  }
  // 尾与鬃
  p.thickLine(bx - 34, by - 30, bx - 52, by - 4, 5, hex('#0a080c'));
  for (let i = 0; i < 8; i++) p.set(bx + 30 + i, by - 46 + (i % 3), hex('#0a080c'));
  // 骑手
  p.ellipse(bx - 4, by - 62, 9, 10, SKIN);
  p.polygon(
    [
      [bx - 14, by - 54],
      [bx + 10, by - 54],
      [bx + 8, by - 30],
      [bx - 12, by - 30],
    ],
    hex('#7a1e2a'),
  );
  p.rect(bx - 8, by - 72, 16, 4, hex('#0a080c'));
  p.thickLine(bx + 6, by - 50, bx + 30, by - 52, 3, hex('#0a080c'));
  // 尘土
  for (let i = 0; i < 30; i++) p.set(bx - 40 - Math.floor(rand() * 50), ground - Math.floor(rand() * 10), hex('#8a6a4a'), 0.4);
}

function drawWineJar2(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#160e08'), hex('#2e1c10'), 5);
  // 窗与月
  const wx = Math.floor(p.w * 0.64);
  p.rect(wx, Math.floor(p.h * 0.1), Math.floor(p.w * 0.24), Math.floor(p.h * 0.26), hex('#0a1024'));
  p.crescent(wx + Math.floor(p.w * 0.16), Math.floor(p.h * 0.18), 4, hex('#ffe9b0'), 2);
  // 桌子
  const ty = Math.floor(p.h * 0.72);
  p.rect(Math.floor(p.w * 0.06), ty, Math.floor(p.w * 0.68), 6, hex('#5a3a22'));
  p.rect(Math.floor(p.w * 0.1), ty + 6, 6, Math.floor(p.h * 0.24), hex('#3a2214'));
  p.rect(Math.floor(p.w * 0.66), ty + 6, 6, Math.floor(p.h * 0.24), hex('#3a2214'));
  // 酒坛
  const jx = Math.floor(p.w * 0.3);
  p.rect(jx - 18, ty - 44, 37, 44, hex('#7a4a26'));
  p.rect(jx - 21, ty - 30, 43, 30, hex('#8a5a30'));
  p.rect(jx - 10, ty - 54, 21, 11, hex('#6a3e1e'));
  p.hline(jx - 21, jx + 21, ty - 34, hex('#c9a86a'), 0.7);
  p.rect(jx - 9, ty - 42, 18, 12, hex('#d8c090'));
  for (let i = 0; i < 3; i++) p.hline(jx - 6, jx + 6, ty - 39 + i * 3, hex('#6a4a28'), 0.8);
  p.rect(jx - 14, ty - 40, 2, 32, hex('#a07040'), 0.5);
  // 酒碗
  p.rect(jx + 30, ty - 12, 16, 11, hex('#d8c090'));
  p.rect(jx + 32, ty - 9, 12, 4, hex('#8a2a22'));
  // 烛
  const cx2 = Math.floor(p.w * 0.68);
  p.rect(cx2, ty - 24, 4, 24, hex('#e8dcc0'));
  p.ellipse(cx2 + 2, ty - 28, 3, 5, hex('#ffcf6a'));
  p.ellipse(cx2 + 2, ty - 27, 1, 3, hex('#fff6d0'));
  for (let i = 0; i < 16; i++) p.set(cx2 + Math.floor(rand() * 20) - 10, ty - 34 - Math.floor(rand() * 12), hex('#ffb45a'), 0.15);
  // 蒸汽
  for (let i = 0; i < 10; i++) p.set(jx + 4 + Math.floor(rand() * 8), ty - 58 - i, hex('#c9b89a'), 0.25);
  // 坐着的酒客
  const px = Math.floor(p.w * 0.16);
  p.ellipse(px, ty - 58, 9, 10, SKIN);
  p.polygon(
    [
      [px - 12, ty - 50],
      [px + 12, ty - 50],
      [px + 10, ty - 20],
      [px - 10, ty - 20],
    ],
    hex('#2a1a14'),
  );
}

function drawScrollMemory2(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const frame = spec.frame ?? 0;
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0e0a12'), hex('#2a1e24'), 5);
  // 光柱
  for (let x = Math.floor(p.w * 0.15); x < p.w * 0.75; x += 3) p.vline(x, 0, p.h, hex('#3a3040'), 0.08);
  // 漂浮卷轴
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(p.w * (0.16 + i * 0.15));
    const y = Math.floor(((p.h * 0.2 + i * 0.12 * p.h + frame * 0.8) % (p.h * 0.7)) + 8);
    const w = 26;
    const h = 42;
    p.rect(x - w / 2, y, w, h, hex('#e8dcc0'));
    p.rect(x - w / 2 - 2, y - 2, w + 4, 3, hex('#8a6a3a'));
    p.rect(x - w / 2 - 2, y + h - 1, w + 4, 3, hex('#8a6a3a'));
    for (let k = 0; k < 4; k++) p.vline(x - 9 + k * 6, y + 6, y + h - 8, hex('#6a5a44'), 0.75);
  }
  // 底部抬头看的人
  const px = Math.floor(p.w * 0.5);
  const py = Math.floor(p.h * 0.9);
  p.ellipse(px, py - 58, 11, 12, SKIN);
  p.polygon(
    [
      [px - 14, py - 46],
      [px + 14, py - 46],
      [px + 12, py - 4],
      [px - 12, py - 4],
    ],
    hex('#161220'),
  );
  // 浮尘
  for (let i = 0; i < 30; i++) p.set(Math.floor(rand() * p.w), Math.floor(rand() * p.h * 0.8), hex('#c9b89a'), 0.3);
}

function drawSwordWound2(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0a0606'), hex('#2e1210'), 5);
  const ground = Math.floor(p.h * 0.84);
  p.rect(0, ground, p.w, p.h - ground, hex('#0a0606'));
  // 断剑（斜插）
  const sx = Math.floor(p.w * 0.5);
  p.thickLine(sx - 40, ground - 96, sx + 24, ground + 4, 6, hex('#9aa0b4'));
  p.thickLine(sx - 40, ground - 96, sx - 50, ground - 88, 3, hex('#e8f0ff'));
  p.thickLine(sx - 28, ground - 60, sx - 6, ground - 66, 10, hex('#8a5a2a'));
  p.thickLine(sx - 28, ground - 60, sx - 30, ground - 48, 4, hex('#c9a86a'));
  // 红布缠绕
  p.polygon(
    [
      [sx - 10, ground - 62],
      [sx + 44, ground - 40],
      [sx + 34, ground - 2],
      [sx - 16, ground - 16],
    ],
    hex('#8a1a24'),
    0.95,
  );
  for (let i = 0; i < 6; i++) p.vline(sx + 10 + i * 5, ground - 34, ground - 8, hex('#b02a32'), 0.6);
  // 血滴
  for (let i = 0; i < 18; i++) p.set(Math.floor(sx + (rand() - 0.5) * 70), ground - Math.floor(rand() * 16), hex('#c02030'), 0.75);
  // 残旗
  p.thickLine(Math.floor(p.w * 0.18), ground, Math.floor(p.w * 0.26), Math.floor(p.h * 0.3), 3, hex('#0e0a0c'));
  p.polygon(
    [
      [Math.floor(p.w * 0.25), Math.floor(p.h * 0.32)],
      [Math.floor(p.w * 0.4), Math.floor(p.h * 0.36)],
      [Math.floor(p.w * 0.34), Math.floor(p.h * 0.46)],
      [Math.floor(p.w * 0.22), Math.floor(p.h * 0.42)],
    ],
    hex('#5a141a'),
    0.85,
  );
  // 余烬
  for (let i = 0; i < 40; i++) p.set(Math.floor(rand() * p.w), Math.floor(p.h * (0.25 + rand() * 0.45)), hex('#ff9a4a'), 0.45);
  void spec;
}

function drawRedThread(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0a0e1e'), hex('#221a30'), 5);
  stars(p, rand, 50, Math.floor(p.h * 0.5), spec.frame ?? 0);
  p.crescent(Math.floor(p.w * 0.5), Math.floor(p.h * 0.18), 6, hex('#ffe9b0'), 2);
  // 两只手
  const hand = (x: number, dir: 1 | -1) => {
    p.ellipse(x, Math.floor(p.h * 0.56), 18, 13, SKIN);
    for (let i = 0; i < 4; i++) {
      p.rect(x + dir * (12 + i * 1), Math.floor(p.h * 0.54) - 8 + i * 5, 16, 4, SKIN);
    }
    p.polygon(
      [
        [x - dir * 18, Math.floor(p.h * 0.55)],
        [x - dir * 30, Math.floor(p.h * 0.62)],
        [x - dir * 26, p.h],
        [x + dir * 8, p.h],
      ],
      hex('#1a1626'),
    );
  };
  hand(Math.floor(p.w * 0.26), 1);
  hand(Math.floor(p.w * 0.74), -1);
  // 红线
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    const x = p.w * 0.26 + (p.w * 0.74 - p.w * 0.26) * t;
    const y = Math.floor(p.h * 0.54) + Math.sin(t * Math.PI * 2) * 6 + Math.sin(t * Math.PI) * 10;
    p.set(x, y, hex('#e03a4a'));
    p.set(x, y + 1, hex('#8a1e2a'), 0.8);
  }
  // 中间的结
  p.ellipse(Math.floor(p.w * 0.5), Math.floor(p.h * 0.52), 5, 4, hex('#ff5a6a'));
  for (let k = 0; k < 12; k++) p.set(Math.floor(p.w * 0.5) + Math.floor(rand() * 24) - 12, Math.floor(p.h * 0.5) + Math.floor(rand() * 18) - 9, hex('#ffb0b8'), 0.5);
}

function drawGhostLight(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const frame = spec.frame ?? 0;
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#060812'), hex('#161a2e'), 5);
  stars(p, rand, 60, Math.floor(p.h * 0.6), frame);
  p.crescent(Math.floor(p.w * 0.24), Math.floor(p.h * 0.18), 5, hex('#c8d8ff'), 2);
  // 上升的魂光
  for (let i = 0; i < 7; i++) {
    const baseX = p.w * (0.18 + i * 0.11);
    const y = p.h * 0.85 - ((frame * (1 + (i % 3)) * 1.2 + i * 34) % (p.h * 0.7));
    p.ellipse(baseX, y, 4 + (i % 2), 6 + (i % 2), hex('#cfe4ff'), 0.85);
    p.ellipse(baseX, y - 2, 2, 3, hex('#ffffff'));
    for (let k = 1; k < 14; k++) p.set(baseX + Math.sin(k + i) * 3, y + k * 2, hex('#8fb4e8'), 0.12);
  }
  // 仰头的人
  const px = Math.floor(p.w * 0.5);
  const py = Math.floor(p.h * 0.92);
  p.ellipse(px, py - 56, 11, 12, SKIN);
  p.polygon(
    [
      [px - 14, py - 44],
      [px + 14, py - 44],
      [px + 12, py - 4],
      [px - 12, py - 4],
    ],
    hex('#10121e'),
  );
  for (let i = 0; i < 24; i++) p.set(Math.floor(rand() * p.w), Math.floor(rand() * p.h * 0.8), hex('#a8c0e8'), 0.25);
}

function drawHeartbeat(p: Pixel, rand: () => number, spec: PixelSceneSpec): void {
  const frame = spec.frame ?? 0;
  p.bandGradient(0, p.w - 1, 0, p.h, hex('#0c070c'), hex('#241220'), 5);
  // 胸口剪影
  const cx = Math.floor(p.w * 0.5);
  const cy = Math.floor(p.h * 0.5);
  p.ellipse(cx, cy - 40, 40, 46, hex('#1a1220'));
  p.polygon(
    [
      [cx - 46, cy + 6],
      [cx + 46, cy + 6],
      [cx + 40, p.h],
      [cx - 40, p.h],
    ],
    hex('#100a14'),
  );
  // 发光的心
  const beat = 0.82 + 0.18 * Math.abs(Math.sin(frame * 0.9));
  p.ellipse(cx, cy + 10, 12 * beat, 12 * beat, hex('#e03a4a'));
  p.ellipse(cx, cy + 8, 7 * beat, 7 * beat, hex('#ff8a9a'));
  p.ellipse(cx, cy + 6, 3 * beat, 3 * beat, hex('#fff0f4'));
  for (let ring = 1; ring <= 3; ring++) {
    const rr = (12 + ring * 9) * beat;
    for (let a = 0; a < 48; a++) {
      const rad = (a / 48) * Math.PI * 2;
      p.set(cx + Math.cos(rad) * rr, cy + 10 + Math.sin(rad) * rr * 0.8, hex('#ff6a7a'), 0.22);
    }
  }
  // 心电图
  const baseY = Math.floor(p.h * 0.82);
  p.hline(0, p.w - 1, baseY, hex('#2a1418'), 0.8);
  const shift = (frame * 3) % Math.floor(p.w * 0.5);
  for (let x = 0; x < p.w; x += 1) {
    const local = (x + shift) % Math.floor(p.w * 0.5);
    const spike = local > 18 && local < 26 ? -12 : local > 12 && local < 34 ? -4 : 0;
    p.set(x, baseY + spike, hex('#ff4a5a'), 0.9);
  }
}

export function pixelSceneLabel(type: PixelSceneType): string {
  const labels: Record<PixelSceneType, string> = {
    'desert-night': '沙海夜',
    'museum-display': '陈列柜',
    'night-city': '夜街',
    'rain-window': '雨窗',
    'river-boat': '河舟',
    'room-night': '房间',
    'fire-battle': '赤壁火战',
    palace: '宫殿夜宴',
    tavern: '酒肆',
    'city-gate': '城楼',
    'mountain-pass': '山道',
    'battlefield-close': '残旗战场',
    'lantern-river': '灯河',
    'autumn-leaves': '落叶',
    'tear-rain': '泪雨',
    'eyes-meet': '对视',
    swordsman: '挥剑',
    'scroll-memory': '前朝记忆',
    'old-tree': '老树根',
    'stone-alley': '青石月光',
    'horse-rider': '策马',
    'wine-jar': '醇酒',
    'sword-wound': '伤痕',
    candle: '一灯',
    'winding-road': '长路',
    'red-thread': '红线缘分',
    'ghost-light': '转世魂光',
    heartbeat: '心跳',
    'title-desert': '序章',
  };
  return labels[type];
}

export function pickPixelScene(text: string, index: number): { type: PixelSceneType; variant: number } {
  // 逐句具象：优先画这句歌词真正说的东西
  const specific: { test: RegExp; types: PixelSceneType[] }[] = [
    { test: /落叶|踩过|青春/, types: ['autumn-leaves'] },
    { test: /伤痕|赤壁|醉醉坠入/, types: ['sword-wound'] },
    { test: /策马|马蹄|出征|泪奔/, types: ['horse-rider'] },
    { test: /挥剑|剑|血|红唇/, types: ['swordsman'] },
    { test: /泪语|泪|哭/, types: ['tear-rain'] },
    { test: /醇酒|酒|饮恨|醉/, types: ['wine-jar'] },
    { test: /缘份|缘分|结.*绳/, types: ['red-thread'] },
    { test: /转世|魂|轮回声/, types: ['ghost-light'] },
    { test: /心跳|是谁的心跳/, types: ['heartbeat'] },
    { test: /确认过眼神|眼神|对的人/, types: ['eyes-meet'] },
    { test: /前朝|记忆|红尘|轮回|千年/, types: ['scroll-memory'] },
    { test: /老树|树根|回忆般/, types: ['old-tree'] },
    { test: /青石|月光|山城|照进/, types: ['stone-alley'] },
    { test: /一路的跟|用情极深/, types: ['winding-road'] },
    { test: /一世|认真|只能有/, types: ['candle'] },
  ];
  for (const rule of specific) {
    if (rule.test.test(text)) return { type: rule.types[index % rule.types.length], variant: index % 6 };
  }
  const rain = /雨|伞|湿|玻璃|窗/.test(text);
  const water = /江|河|海|水|舟|船|月|波/.test(text);
  const indoor = /电梯|楼道|走廊|房间|天花板|床|手机|门|心事|沉默|音量/.test(text);
  const night = /夜|凌晨|霓虹|灯|街|城市|车流|影|车/.test(text);
  const desert = /西元|千年|泥板|碑文|橱窗|历史|古|公元前|文明/.test(text);
  const battle = /剑|血|战|征|赤壁|刀|锋|沙场|兵|伤痕/.test(text);
  const memory = /前世|前朝|轮回|转世|缘分|千年|记忆|眼神|今生|认真|用情/.test(text);
  const ancient = /月光|山城|青石|老树|红尘|落叶|酒|醇酒|洛阳|马蹄|策马|城/.test(text);
  if (/酒|醇|醉|饮/.test(text)) {
    const types: PixelSceneType[] = ['tavern', 'palace'];
    return { type: types[index % 2], variant: index % 2 };
  }
  if (battle) {
    const types: PixelSceneType[] = ['fire-battle', 'battlefield-close', 'city-gate'];
    return { type: types[index % 3], variant: index % 2 };
  }
  if (memory) {
    const types: PixelSceneType[] = ['museum-display', 'palace', 'lantern-river'];
    return { type: types[index % 3], variant: index % 2 };
  }
  if (/老树|落叶|山道|行囊|风/.test(text)) {
    const types: PixelSceneType[] = ['mountain-pass', 'desert-night', 'city-gate'];
    return { type: types[index % 3], variant: index % 2 };
  }
  if (ancient) {
    const types: PixelSceneType[] = ['city-gate', 'lantern-river', 'mountain-pass', 'desert-night', 'river-boat'];
    return { type: types[index % 5], variant: index % 2 };
  }
  if (desert) return { type: 'museum-display', variant: index % 2 };
  if (rain && /窗|玻璃/.test(text)) return { type: 'rain-window', variant: 0 };
  if (water) return { type: 'river-boat', variant: index % 2 };
  if (indoor) return { type: 'room-night', variant: index % 2 };
  if (night) return { type: 'night-city', variant: index % 3 };
  return { type: index % 2 === 0 ? 'night-city' : 'river-boat', variant: index % 3 };
}
