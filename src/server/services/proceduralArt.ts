import zlib from 'node:zlib';
import { mulberry32 } from './text';

/**
 * 程序化「电影感抽象画面」生成器（纯 Node，无原生依赖）。
 * 分层：基础渐变 → 体积光晕 → 散景光斑 → 斜向光带 → 暗角 → 胶片颗粒。
 * 由镜头提示词的 hash 决定构图，因此同一片内每个镜头都不同、但色调统一。
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0,
  };
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

/** CRC32（PNG 分块需要） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

export interface ProceduralArtOptions {
  width: number;
  height: number;
  seed: number;
  palette: [string, string, string];
  /** 构图强度 0.4 - 1.4 */
  intensity?: number;
  /** 由原句提炼出的画面母题，决定画面里出现什么「东西」 */
  motifs?: string[];
}

type Color = { r: number; g: number; b: number };

export function generateProceduralArt(options: ProceduralArtOptions): Buffer {
  const { width, height, seed, palette } = options;
  const intensity = Math.max(0.4, Math.min(1.5, options.intensity ?? 1));
  const rand = mulberry32(seed);
  const total = width * height;
  const rBuf = new Float32Array(total);
  const gBuf = new Float32Array(total);
  const bBuf = new Float32Array(total);

  const c0 = hexToRgb(palette[0]);
  const c1 = hexToRgb(palette[1]);
  const c2 = hexToRgb(palette[2]);
  // 压暗底色，让画面有电影感的深部
  const darken = (c: Rgb, k: number): Rgb => ({ r: c.r * k, g: c.g * k, b: c.b * k });
  const deep = darken(c0, 0.55);
  const mid = c1;
  const bright = c2;

  // 1. 基础渐变：随机方向的斜向渐变 + 垂直压暗
  const angle = rand() * Math.PI * 2;
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const maxProj = Math.abs(ax) * width + Math.abs(ay) * height;
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const t = Math.max(0, Math.min(1, (x * ax + y * ay) / maxProj + 0.5));
      const eased = t * t * (3 - 2 * t);
      const vertical = Math.pow(ny, 0.85);
      const baseR = deep.r + (mid.r - deep.r) * eased;
      const baseG = deep.g + (mid.g - deep.g) * eased;
      const baseB = deep.b + (mid.b - deep.b) * eased;
      const idx = y * width + x;
      rBuf[idx] = baseR * (0.55 + 0.6 * (1 - vertical));
      gBuf[idx] = baseG * (0.55 + 0.6 * (1 - vertical));
      bBuf[idx] = baseB * (0.55 + 0.6 * (1 - vertical));
    }
  }

  // 2. 体积光晕：2-3 个径向光斑
  const glows = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < glows; i++) {
    const cx = rand() * width;
    const cy = rand() * height * 0.9;
    const radius = (0.25 + rand() * 0.35) * Math.max(width, height);
    const color = i === 0 ? bright : i === 1 ? mid : bright;
    const strength = (0.35 + rand() * 0.45) * intensity;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(height - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const falloff = Math.pow(1 - d2 / r2, 2.2);
        const k = falloff * strength;
        const idx = y * width + x;
        rBuf[idx] += color.r * k;
        gBuf[idx] += color.g * k;
        bBuf[idx] += color.b * k;
      }
    }
  }

  // 3. 散景光斑：大小不一的柔边光点
  const bokehCount = 10 + Math.floor(rand() * 14);
  for (let i = 0; i < bokehCount; i++) {
    const cx = rand() * width;
    const cy = rand() * height;
    const radius = (0.008 + rand() * 0.035) * Math.max(width, height);
    const strength = (0.12 + rand() * 0.3) * intensity;
    const color = rand() > 0.55 ? bright : c2;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(height - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        // 柔和的圆盘 + 轻微亮边（真实散景特征）
        const d = Math.sqrt(d2) / radius;
        const ring = Math.exp(-Math.pow((d - 0.9) * 4.5, 2)) * 0.22 + Math.pow(1 - d, 2.2) * 0.78;
        const k = ring * strength;
        const idx = y * width + x;
        rBuf[idx] += color.r * k;
        gBuf[idx] += color.g * k;
        bBuf[idx] += color.b * k;
      }
    }
  }

  // 4. 斜向光带（2-3 道）
  const streaks = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < streaks; i++) {
    const angle2 = angle + (rand() - 0.5) * 0.7;
    const sx = Math.sin(angle2);
    const sy = -Math.cos(angle2);
    const offset = (rand() - 0.5) * Math.max(width, height) * 1.2;
    const thickness = (0.012 + rand() * 0.03) * Math.max(width, height);
    const strength = (0.1 + rand() * 0.16) * intensity;
    const color = bright;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const d = Math.abs(x * sx + y * sy - offset);
        if (d > thickness * 3) continue;
        const k = Math.exp(-Math.pow(d / thickness, 2)) * strength;
        const idx = y * width + x;
        rBuf[idx] += color.r * k;
        gBuf[idx] += color.g * k;
        bBuf[idx] += color.b * k;
      }
    }
  }

  // 5. 场景母题：让画面出现与歌词对应的具体元素（雨丝、窗框、街灯、天际线、人影…）
  if (options.motifs?.length) {
    drawMotifs({
      motifs: options.motifs,
      width,
      height,
      rand,
      rBuf,
      gBuf,
      bBuf,
      palette: { base: c0, mid: c1, bright: c2 },
      intensity,
    });
  }

  // 6. 暗角 + 胶片颗粒 + 输出
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.hypot(cx, cy);
  const grainAmount = 7 + rand() * 5;
  const rgb = new Uint8Array(total * 3);
  const noise = mulberry32(seed ^ 0x9e3779b9);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const dist = Math.hypot(x - cx, y - cy) / maxDist;
      const vignette = 1 - 0.72 * Math.pow(dist, 2.4);
      // 轻微横向色偏，增加胶片感
      const grain = (noise() - 0.5) * grainAmount;
      const grainR = grain + (noise() - 0.5) * 2;
      const grainB = grain - (noise() - 0.5) * 2;
      rgb[idx * 3] = clampByte((rBuf[idx] + grainR) * vignette);
      rgb[idx * 3 + 1] = clampByte((gBuf[idx] + grain) * vignette);
      rgb[idx * 3 + 2] = clampByte((bBuf[idx] + grainB) * vignette);
    }
  }
  return encodePng(width, height, rgb);
}

/** 由 seed 派生一个更"有戏"的调色板（在预设主色基础上做色相漂移） */
export function shiftPalette(palette: [string, string, string], seed: number): [string, string, string] {
  const rand = mulberry32(seed);
  const shift = (hex: string, amount: number): string => {
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb);
    hsl.h = (hsl.h + amount + 360) % 360;
    hsl.l = Math.max(0.12, Math.min(0.86, hsl.l + (rand() - 0.5) * 0.18));
    const out = hslToRgb(hsl);
    return `#${[out.r, out.g, out.b].map((v) => clampByte(v).toString(16).padStart(2, '0')).join('')}`;
  };
  return [shift(palette[0], (rand() - 0.5) * 12), shift(palette[1], (rand() - 0.5) * 26), shift(palette[2], (rand() - 0.5) * 30)];
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

/* ------------------------------------------------------------------ */
/* 场景母题绘制：让画面出现与歌词对应的具体元素                        */
/* ------------------------------------------------------------------ */

interface DrawContext {
  motifs: string[];
  width: number;
  height: number;
  rand: () => number;
  rBuf: Float32Array;
  gBuf: Float32Array;
  bBuf: Float32Array;
  palette: { base: Rgb; mid: Rgb; bright: Rgb };
  intensity: number;
}

function drawMotifs(ctx: DrawContext): void {
  const seen = new Set<string>();
  for (const motif of ctx.motifs.slice(0, 3)) {
    if (seen.has(motif)) continue;
    seen.add(motif);
    switch (motif) {
      case 'rain-window':
        drawRainWindow(ctx);
        break;
      case 'street-lamp':
        drawStreetLamp(ctx);
        break;
      case 'skyline':
        drawSkyline(ctx);
        break;
      case 'corridor':
        drawCorridor(ctx);
        break;
      case 'water':
        drawWater(ctx);
        break;
      case 'sky-clouds':
        drawClouds(ctx);
        break;
      case 'fire-glow':
        drawFire(ctx);
        break;
      case 'silhouette':
        drawSilhouette(ctx);
        break;
      case 'room-window':
        drawRoomWindow(ctx);
        break;
      case 'road':
        drawRoad(ctx);
        break;
      case 'starry':
        drawStars(ctx);
        break;
      case 'mountain':
        drawMountains(ctx);
        break;
      case 'flowers':
        drawFlowers(ctx);
        break;
      case 'leaves':
        drawLeaves(ctx);
        break;
      case 'boat':
        drawBoat(ctx, false);
        break;
      case 'paper-boat':
        drawBoat(ctx, true);
        break;
      case 'battle':
        drawBattle(ctx);
        break;
      case 'tower':
        drawTower(ctx);
        break;
      case 'store':
        drawStore(ctx);
        break;
      case 'traffic':
        drawTraffic(ctx);
        break;
      case 'station':
        drawStation(ctx);
        break;
      case 'clock':
        drawClock(ctx);
        break;
      case 'moon':
        drawMoon(ctx);
        break;
      default:
        break;
    }
  }
}

function addPixel(ctx: DrawContext, x: number, y: number, color: Rgb, alpha: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= ctx.width || yi >= ctx.height) return;
  const idx = yi * ctx.width + xi;
  ctx.rBuf[idx] += color.r * alpha;
  ctx.gBuf[idx] += color.g * alpha;
  ctx.bBuf[idx] += color.b * alpha;
}

function shadePixel(ctx: DrawContext, x: number, y: number, factor: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= ctx.width || yi >= ctx.height) return;
  const idx = yi * ctx.width + xi;
  ctx.rBuf[idx] *= factor;
  ctx.gBuf[idx] *= factor;
  ctx.bBuf[idx] *= factor;
}

function softRect(ctx: DrawContext, x0: number, y0: number, x1: number, y1: number, color: Rgb, alpha: number, soft = 1.5, dark = false): void {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  for (let y = Math.floor(top - soft); y <= Math.ceil(bottom + soft); y++) {
    for (let x = Math.floor(left - soft); x <= Math.ceil(right + soft); x++) {
      const dx = x < left ? left - x : x > right ? x - right : 0;
      const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
      const dist = Math.hypot(dx, dy);
      const k = dist > soft ? 0 : 1 - dist / soft;
      if (k <= 0) continue;
      if (dark) shadePixel(ctx, x, y, 1 - alpha * k);
      else addPixel(ctx, x, y, color, alpha * k);
    }
  }
}

function disc(ctx: DrawContext, cx: number, cy: number, radius: number, color: Rgb, alpha: number, edge = 1.4): void {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius - edge); y <= Math.ceil(cy + radius + edge); y++) {
    for (let x = Math.floor(cx - radius - edge); x <= Math.ceil(cx + radius + edge); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius + edge) continue;
      const k = d <= radius ? 1 : Math.max(0, 1 - (d - radius) / edge);
      addPixel(ctx, x, y, color, alpha * k);
    }
  }
}

function glow(ctx: DrawContext, cx: number, cy: number, radius: number, color: Rgb, alpha: number): void {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const d = Math.hypot(x - cx, y - cy) / radius;
      if (d > 1) continue;
      addPixel(ctx, x, y, color, alpha * Math.pow(1 - d, 2.2));
    }
  }
}

function segment(ctx: DrawContext, x0: number, y0: number, x1: number, y1: number, thickness: number, color: Rgb, alpha: number): void {
  const minX = Math.floor(Math.min(x0, x1) - thickness);
  const maxX = Math.ceil(Math.max(x0, x1) + thickness);
  const minY = Math.floor(Math.min(y0, y1) - thickness);
  const maxY = Math.ceil(Math.max(y0, y1) + thickness);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / lenSq));
      const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
      if (d > thickness) continue;
      addPixel(ctx, x, y, color, alpha * (1 - d / thickness));
    }
  }
}

function drawRainWindow(ctx: DrawContext): void {
  const { width, height, rand } = ctx;
  softRect(ctx, width * 0.06, height * 0.05, width * 0.94, height * 0.75, ctx.palette.base, 0.4, 2, true);
  softRect(ctx, width * 0.06, height * 0.05, width * 0.08, height * 0.75, ctx.palette.mid, 0.14, 1.5);
  softRect(ctx, width * 0.92, height * 0.05, width * 0.94, height * 0.75, ctx.palette.mid, 0.14, 1.5);
  softRect(ctx, width * 0.48, height * 0.05, width * 0.52, height * 0.75, ctx.palette.base, 0.35, 2, true);
  softRect(ctx, width * 0.06, height * 0.39, width * 0.94, height * 0.41, ctx.palette.base, 0.35, 2, true);
  for (let i = 0; i < 80; i++) {
    const x = rand() * width;
    const y = height * 0.04 + rand() * height * 0.72;
    const len = height * (0.015 + rand() * 0.05);
    segment(ctx, x, y, x + len * 0.16, y + len, 0.8 + rand() * 1.4, ctx.palette.bright, 0.05 + rand() * 0.12);
  }
  for (let i = 0; i < 20; i++) {
    disc(ctx, rand() * width, height * (0.08 + rand() * 0.62), width * (0.002 + rand() * 0.006), ctx.palette.bright, 0.18 + rand() * 0.2, 2);
  }
  glow(ctx, width * (0.2 + rand() * 0.6), height * (0.2 + rand() * 0.35), width * 0.3, ctx.palette.mid, 0.22);
}

function drawStreetLamp(ctx: DrawContext): void {
  const { width, height } = ctx;
  const lx = width * 0.24;
  const ly = height * 0.2;
  glow(ctx, lx, ly, width * 0.26, ctx.palette.bright, 0.5);
  disc(ctx, lx, ly, width * 0.018, ctx.palette.bright, 0.9, 3);
  segment(ctx, lx, ly, lx + width * 0.015, height * 0.8, 2.2, ctx.palette.base, 0.55);
  for (let i = 0; i < 130; i++) {
    const t = i / 130;
    const y = ly + (height * 0.82 - ly) * t;
    const spread = width * (0.02 + 0.17 * t);
    segment(ctx, lx - spread, y, lx + spread, y, 1.2, ctx.palette.bright, 0.03 * (1 - t * 0.6));
  }
  glow(ctx, lx, height * 0.82, width * 0.2, ctx.palette.mid, 0.28);
}

function drawSkyline(ctx: DrawContext): void {
  const { width, height, rand } = ctx;
  const horizon = height * 0.68;
  glow(ctx, width * 0.5, horizon, width * 0.6, ctx.palette.mid, 0.2);
  let x = 0;
  while (x < width) {
    const w = width * (0.03 + rand() * 0.09);
    const h = height * (0.05 + rand() * 0.24);
    softRect(ctx, x, horizon - h, x + w, horizon + height * 0.015, ctx.palette.base, 0.55, 1.5, true);
    const cols = Math.max(1, Math.floor(w / (width * 0.016)));
    const rows = Math.max(1, Math.floor(h / (height * 0.022)));
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        if (rand() > 0.7) continue;
        addPixel(
          ctx,
          x + (cx + 0.5) * (w / cols),
          horizon - h + (cy + 0.5) * (h / rows),
          ctx.palette.bright,
          0.1 + rand() * 0.28,
        );
      }
    }
    x += w + width * 0.004;
  }
}

function drawCorridor(ctx: DrawContext): void {
  const { width, height } = ctx;
  const cx = width * 0.5;
  const cy = height * 0.46;
  for (let i = 6; i >= 1; i--) {
    const t = i / 6;
    const w = width * 0.46 * t;
    const h = height * 0.34 * t;
    softRect(ctx, cx - w, cy - h, cx + w, cy + h, ctx.palette.base, 0.22, 1.4, true);
  }
  for (let i = 0; i < 4; i++) {
    const t = (i + 1) / 5;
    glow(ctx, cx, cy - height * 0.16 * t, width * 0.05 * (1 - t * 0.6), ctx.palette.bright, 0.35);
  }
  glow(ctx, cx, cy + height * 0.24, width * 0.3, ctx.palette.mid, 0.16);
}

function drawWater(ctx: DrawContext): void {
  const { width, height, rand } = ctx;
  const horizon = height * 0.52;
  glow(ctx, width * 0.5, horizon, width * 0.7, ctx.palette.mid, 0.2);
  for (let y = horizon; y < height; y++) {
    const t = (y - horizon) / (height - horizon);
    for (let x = 0; x < width; x += 2) {
      const wave = Math.sin(x * 0.02 + y * 0.08) * 0.5 + 0.5;
      addPixel(ctx, x, y, ctx.palette.bright, (0.02 + t * 0.09) * wave * 0.6);
    }
  }
  for (let i = 0; i < 36; i++) {
    const y = horizon + rand() * (height - horizon);
    segment(ctx, width * (0.42 + rand() * 0.16), y, width * (0.42 + rand() * 0.16), y + 1.5, 1, ctx.palette.bright, 0.08 + rand() * 0.1);
  }
}

function drawClouds(ctx: DrawContext): void {
  const { width, height, rand } = ctx;
  for (let i = 0; i < 6; i++) {
    const cx = rand() * width;
    const cy = height * (0.08 + rand() * 0.3);
    const r = width * (0.16 + rand() * 0.22);
    glow(ctx, cx, cy, r, ctx.palette.bright, 0.1 + rand() * 0.08);
    glow(ctx, cx + r * 0.4, cy + r * 0.1, r * 0.7, ctx.palette.mid, 0.08);
  }
  glow(ctx, width * 0.5, height * 0.62, width * 0.6, ctx.palette.mid, 0.14);
}

function drawFire(ctx: DrawContext): void {
  const { width, height, rand } = ctx;
  glow(ctx, width * 0.5, height * 0.64, width * 0.55, { r: 240, g: 120, b: 40 }, 0.42);
  glow(ctx, width * 0.42, height * 0.7, width * 0.3, ctx.palette.bright, 0.32);
  for (let i = 0; i < 60; i++) {
    disc(ctx, width * (0.25 + rand() * 0.5), height * (0.3 + rand() * 0.5), 0.8 + rand() * 2.2, ctx.palette.bright, 0.2 + rand() * 0.35, 1.2);
  }
}

function drawSilhouette(ctx: DrawContext): void {
  const { width, height } = ctx;
  const cx = width * 0.52;
  const baseY = height * 0.78;
  const scale = height * 0.001;
  softRect(ctx, cx, baseY, cx + width * 0.34, baseY + height * 0.02, ctx.palette.base, 0.5, 4, true);
  disc(ctx, cx, baseY - 150 * scale, 26 * scale, ctx.palette.base, 0.85, 2);
  for (let y = Math.floor(baseY - 124 * scale); y < baseY; y++) {
    const t = (y - (baseY - 124 * scale)) / (124 * scale);
    const halfW = (14 + 32 * t) * scale;
    for (let x = Math.floor(cx - halfW); x < cx + halfW; x++) {
      shadePixel(ctx, x, y, 0.45);
    }
  }
  glow(ctx, cx, baseY, width * 0.2, ctx.palette.mid, 0.16);
}

function drawRoomWindow(ctx: DrawContext): void {
  const { width, height } = ctx;
  const x0 = width * 0.52;
  const y0 = height * 0.16;
  const x1 = width * 0.88;
  const y1 = height * 0.62;
  softRect(ctx, x0 - width * 0.06, y0 - height * 0.03, x1 + width * 0.06, y1 + height * 0.03, ctx.palette.bright, 0.09, 8);
  softRect(ctx, x0, y0, x1, y1, ctx.palette.bright, 0.42, 2);
  softRect(ctx, (x0 + x1) / 2 - 2, y0, (x0 + x1) / 2 + 2, y1, ctx.palette.base, 0.45, 1.5, true);
  softRect(ctx, x0, (y0 + y1) / 2 - 2, x1, (y0 + y1) / 2 + 2, ctx.palette.base, 0.45, 1.5, true);
  for (let y = Math.floor(y1); y < height; y += 2) {
    const t = (y - y1) / (height - y1);
    for (let x = Math.floor(x0 - width * 0.08); x < x1 + width * 0.08; x += 2) {
      addPixel(ctx, x, y, ctx.palette.bright, 0.05 * (1 - t));
    }
  }
}

function drawRoad(ctx: DrawContext): void {
  const { width, height } = ctx;
  const cx = width * 0.5;
  const horizon = height * 0.5;
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const y = horizon + (height - horizon) * t;
    const halfW = width * (0.02 + t * 0.42);
    segment(ctx, cx - halfW, y, cx - halfW * 0.8, y + height * 0.02, 1, ctx.palette.bright, 0.05);
    segment(ctx, cx + halfW, y, cx + halfW * 0.8, y + height * 0.02, 1, ctx.palette.bright, 0.05);
  }
  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    const y = horizon + (height - horizon) * t;
    const len = height * 0.02 * (0.4 + t * 1.6);
    softRect(ctx, cx - 1.5, y, cx + 1.5, y + len, ctx.palette.bright, 0.18, 1);
  }
  glow(ctx, cx, horizon - height * 0.04, width * 0.3, ctx.palette.mid, 0.22);
}

function drawStars(ctx: DrawContext): void {
  const { width, height, rand } = ctx;
  for (let i = 0; i < 150; i++) {
    const x = rand() * width;
    const y = rand() * height * 0.6;
    addPixel(ctx, x, y, ctx.palette.bright, 0.2 + rand() * 0.65);
    if (rand() > 0.85) disc(ctx, x, y, 1.2 + rand(), ctx.palette.bright, 0.3, 1.2);
  }
  for (let x = 0; x < width; x++) {
    addPixel(ctx, x, height * 0.76, ctx.palette.mid, 0.16);
  }
}

function drawMountains(ctx: DrawContext): void {
  const { width, height, rand } = ctx;
  for (let l = 0; l < 3; l++) {
    const baseY = height * (0.5 + l * 0.1);
    const amp = height * (0.08 + rand() * 0.06);
    const freq = 0.006 + rand() * 0.008;
    const phase = rand() * 6;
    for (let x = 0; x < width; x += 2) {
      const yy = baseY + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.7) * amp * 0.3;
      for (let y = Math.floor(yy); y < height; y += 2) {
        shadePixel(ctx, x, y, l === 0 ? 0.75 : l === 1 ? 0.65 : 0.55);
      }
    }
  }
  glow(ctx, width * 0.7, height * 0.18, width * 0.25, ctx.palette.bright, 0.2);
}

function drawFlowers(ctx: DrawContext): void {
  const { width, height, rand } = ctx;
  for (let i = 0; i < 24; i++) {
    const cx = width * (0.1 + rand() * 0.8);
    const cy = height * (0.3 + rand() * 0.4);
    const r = width * (0.004 + rand() * 0.01);
    for (let p = 0; p < 5; p++) {
      const angle = (p / 5) * Math.PI * 2 + rand();
      disc(ctx, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, r * 0.8, ctx.palette.bright, 0.3, 1.2);
    }
    disc(ctx, cx, cy, r * 0.5, ctx.palette.mid, 0.45, 1.2);
  }
  glow(ctx, width * 0.5, height * 0.3, width * 0.4, ctx.palette.mid, 0.16);
}

function drawLeaves(ctx: DrawContext): void {
  const { width, height, rand } = ctx;
  for (let i = 0; i < 70; i++) {
    const cx = rand() * width;
    const cy = height * (0.1 + rand() * 0.7);
    const angle = rand() * Math.PI;
    const len = width * (0.008 + rand() * 0.02);
    segment(ctx, cx, cy, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len, 1.2, ctx.palette.bright, 0.1 + rand() * 0.16);
  }
  glow(ctx, width * (0.3 + rand() * 0.4), height * 0.2, width * 0.3, ctx.palette.mid, 0.14);
}

function drawBoat(ctx: DrawContext, small: boolean): void {
  const { width, height } = ctx;
  const cx = width * 0.5;
  const y = height * 0.62;
  const s = small ? 0.6 : 1;
  softRect(ctx, cx - width * 0.07 * s, y, cx + width * 0.07 * s, y + height * 0.02 * s, ctx.palette.base, 0.55, 2, true);
  segment(ctx, cx, y, cx, y - height * 0.1 * s, 1.6, ctx.palette.base, 0.55);
  for (let i = 0; i < 14; i++) {
    segment(ctx, cx - width * 0.05 * s, y + i * height * 0.004, cx + width * 0.05 * s, y + i * height * 0.004, 0.8, ctx.palette.bright, 0.05);
  }
  glow(ctx, cx, y, width * 0.16, ctx.palette.mid, 0.18);
}

function drawBattle(ctx: DrawContext): void {
  const { width, height, rand } = ctx;
  const horizon = height * 0.58;
  glow(ctx, width * 0.5, horizon, width * 0.7, { r: 200, g: 90, b: 40 }, 0.2);
  for (let i = 0; i < 4; i++) {
    const cx = width * (0.15 + rand() * 0.7);
    const s = 0.6 + rand() * 0.7;
    softRect(ctx, cx - width * 0.05 * s, horizon, cx + width * 0.05 * s, horizon + height * 0.02 * s, ctx.palette.base, 0.55, 1.5, true);
    segment(ctx, cx, horizon, cx, horizon - height * 0.09 * s, 1.4, ctx.palette.base, 0.5);
    glow(ctx, cx, horizon - height * 0.06 * s, width * 0.012, ctx.palette.bright, 0.55);
  }
  for (let i = 0; i < 26; i++) {
    disc(ctx, width * rand(), horizon - height * rand() * 0.3, 0.8 + rand(), ctx.palette.bright, 0.25 + rand() * 0.35, 1);
  }
}

function drawTower(ctx: DrawContext): void {
  const { width, height } = ctx;
  const cx = width * 0.5;
  const baseY = height * 0.72;
  glow(ctx, cx, height * 0.4, width * 0.3, ctx.palette.bright, 0.18);
  for (let tier = 0; tier < 3; tier++) {
    const t = tier / 3;
    const halfW = width * (0.12 - t * 0.03);
    const y0 = baseY - height * (0.06 + t * 0.1);
    const y1 = y0 - height * 0.06;
    softRect(ctx, cx - halfW, y0, cx + halfW, y1, ctx.palette.base, 0.5, 2, true);
    softRect(ctx, cx - halfW * 1.18, y0 - 2, cx + halfW * 1.18, y0 + 2, ctx.palette.bright, 0.28, 1.5);
  }
  disc(ctx, cx, height * 0.24, width * 0.05, ctx.palette.bright, 0.35, 4);
}

function drawStore(ctx: DrawContext): void {
  const { width, height } = ctx;
  const x0 = width * 0.18;
  const y0 = height * 0.3;
  const x1 = width * 0.82;
  const y1 = height * 0.68;
  softRect(ctx, x0 - width * 0.04, y0 - height * 0.04, x1 + width * 0.04, y1 + height * 0.04, ctx.palette.bright, 0.12, 8);
  softRect(ctx, x0, y0, x1, y1, ctx.palette.bright, 0.24, 2);
  for (let i = 0; i < 4; i++) {
    const y = y0 + ((i + 1) / 5) * (y1 - y0);
    softRect(ctx, x0, y - 1, x1, y + 1, ctx.palette.base, 0.4, 1.5, true);
  }
  softRect(ctx, x0 + (x1 - x0) * 0.55, y1 - height * 0.06, x1, y1, ctx.palette.base, 0.45, 2, true);
  glow(ctx, width * 0.5, height * 0.84, width * 0.3, ctx.palette.mid, 0.2);
}

function drawTraffic(ctx: DrawContext): void {
  const { width, height, rand } = ctx;
  const baseY = height * 0.6;
  for (let i = 0; i < 6; i++) {
    const y = baseY + i * height * 0.03;
    const amp = height * 0.01;
    for (let x = 0; x < width; x += 2) {
      const yy = y + Math.sin(x * 0.004 + i) * amp;
      addPixel(ctx, x, yy, i % 2 === 0 ? ctx.palette.bright : { r: 250, g: 80, b: 120 }, 0.05 + rand() * 0.04);
    }
  }
  for (let i = 0; i < 18; i++) {
    disc(ctx, rand() * width, baseY + rand() * height * 0.22, 1 + rand() * 3, ctx.palette.bright, 0.12, 2);
  }
}

function drawStation(ctx: DrawContext): void {
  const { width, height } = ctx;
  const horizon = height * 0.55;
  softRect(ctx, 0, horizon, width, height, ctx.palette.base, 0.3, 4, true);
  for (let i = 0; i < 5; i++) {
    const y = horizon + i * height * 0.03;
    segment(ctx, 0, y, width, y + height * 0.01, 0.8, ctx.palette.bright, 0.05);
  }
  for (let i = 0; i < 4; i++) {
    glow(ctx, width * (0.2 + i * 0.2), horizon - height * 0.18, width * 0.08, ctx.palette.bright, 0.28);
  }
}

function drawClock(ctx: DrawContext): void {
  const { width, height } = ctx;
  const cx = width * 0.5;
  const cy = height * 0.4;
  const r = width * 0.16;
  for (let a = 0; a < 360; a += 2) {
    const rad = (a * Math.PI) / 180;
    addPixel(ctx, cx + Math.cos(rad) * r, cy + Math.sin(rad) * r, ctx.palette.bright, 0.16);
  }
  segment(ctx, cx, cy, cx, cy - r * 0.62, 2, ctx.palette.bright, 0.35);
  segment(ctx, cx, cy, cx + r * 0.42, cy + r * 0.24, 1.6, ctx.palette.bright, 0.28);
  glow(ctx, cx, cy, r * 1.2, ctx.palette.mid, 0.16);
}

function drawMoon(ctx: DrawContext): void {
  const { width, height } = ctx;
  const cx = width * 0.68;
  const cy = height * 0.22;
  const r = width * 0.09;
  disc(ctx, cx, cy, r, ctx.palette.bright, 0.75, 6);
  glow(ctx, cx, cy, r * 2.4, ctx.palette.bright, 0.22);
  for (let i = 0; i < 24; i++) {
    const x = cx - r * 0.6 + Math.random() * r * 1.2;
    const y = height * 0.6 + Math.random() * height * 0.25;
    segment(ctx, x, y, x, y + 2, 1, ctx.palette.bright, 0.07);
  }
}
