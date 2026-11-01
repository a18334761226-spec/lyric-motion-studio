/**
 * 纯代码 8-bit 芯片音乐合成器（无任何采样库 / 外部服务）。
 *
 * 方波主旋律 + 三角波贝斯 + 方波琶音 + 噪声鼓组，
 * 输出 16-bit PCM WAV，可直接与旁白混音。
 */

export interface ChiptuneOptions {
  durationSec: number;
  seed?: number;
  bpm?: number;
  /** 情绪：决定音阶与和弦进行 */
  mood?: 'warm' | 'sad' | 'hopeful' | 'epic';
}

const SR = 32000;

const SCALES: Record<string, number[]> = {
  // 相对根音的半音
  minorPent: [0, 3, 5, 7, 10],
  majorPent: [0, 2, 4, 7, 9],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
};

/** 和弦进行（MIDI 根音 + 三和弦音程） */
const PROGRESSIONS = {
  warm: [
    { root: 57, chord: [0, 4, 7] }, // Am
    { root: 53, chord: [0, 4, 7] }, // F
    { root: 48, chord: [0, 4, 7] }, // C
    { root: 55, chord: [0, 4, 7] }, // G
  ],
  sad: [
    { root: 57, chord: [0, 3, 7] }, // Am
    { root: 50, chord: [0, 3, 7] }, // Dm
    { root: 53, chord: [0, 4, 7] }, // F
    { root: 52, chord: [0, 3, 7] }, // Em
  ],
  hopeful: [
    { root: 48, chord: [0, 4, 7] }, // C
    { root: 55, chord: [0, 4, 7] }, // G
    { root: 57, chord: [0, 3, 7] }, // Am
    { root: 53, chord: [0, 4, 7] }, // F
  ],
  epic: [
    { root: 50, chord: [0, 3, 7] }, // Dm
    { root: 58, chord: [0, 4, 7] }, // Bb
    { root: 53, chord: [0, 4, 7] }, // F
    { root: 48, chord: [0, 4, 7] }, // C
  ],
};

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Synth {
  buf: Float32Array;
  seconds: number;
  constructor(seconds: number) {
    this.seconds = seconds;
    this.buf = new Float32Array(Math.ceil(seconds * SR));
  }

  private add(i: number, v: number): void {
    if (i < 0 || i >= this.buf.length) return;
    this.buf[i] += v;
  }

  private envelope(t: number, dur: number, attack = 0.004, decay = 0.08, sustain = 0.55, release = 0.05): number {
    if (t < attack) return t / attack;
    if (t < attack + decay) return 1 - (1 - sustain) * ((t - attack) / decay);
    if (t < dur) return sustain;
    if (t < dur + release) return sustain * (1 - (t - dur) / release);
    return 0;
  }

  /** 方波（duty 0.5 = 经典 8-bit，0.25 = 更亮） */
  square(start: number, dur: number, freq: number, vol: number, duty = 0.25, vibrato = 0): void {
    const i0 = Math.floor(start * SR);
    const n = Math.floor((dur + 0.06) * SR);
    for (let k = 0; k < n; k++) {
      const t = k / SR;
      const f = freq * (1 + vibrato * Math.sin(t * 2 * Math.PI * 5.5) * 0.004);
      const cycle = (t * f) % 1;
      const v = cycle < duty ? 1 : -1;
      this.add(i0 + k, v * vol * this.envelope(t, dur));
    }
  }

  triangle(start: number, dur: number, freq: number, vol: number): void {
    const i0 = Math.floor(start * SR);
    const n = Math.floor((dur + 0.05) * SR);
    for (let k = 0; k < n; k++) {
      const t = k / SR;
      const cycle = (t * freq) % 1;
      const v = 2 * Math.abs(2 * cycle - 1) - 1;
      this.add(i0 + k, v * vol * this.envelope(t, dur, 0.006, 0.1, 0.7));
    }
  }

  noise(start: number, dur: number, vol: number, rand: () => number, tone = 0): void {
    const i0 = Math.floor(start * SR);
    const n = Math.floor((dur + 0.02) * SR);
    let prev = 0;
    for (let k = 0; k < n; k++) {
      const t = k / SR;
      const white = rand() * 2 - 1;
      prev = prev * 0.55 + white * 0.45;
      const body = tone ? Math.sin(t * 2 * Math.PI * tone) * 0.5 : 0;
      const env = t < 0.002 ? t / 0.002 : Math.pow(1 - t / dur, 2);
      this.add(i0 + k, (prev + body) * vol * env);
    }
  }

  toWav(): Buffer {
    const n = this.buf.length;
    const out = Buffer.alloc(44 + n * 2);
    out.write('RIFF', 0);
    out.writeUInt32LE(36 + n * 2, 4);
    out.write('WAVE', 8);
    out.write('fmt ', 12);
    out.writeUInt32LE(16, 16);
    out.writeUInt16LE(1, 20);
    out.writeUInt16LE(1, 22);
    out.writeUInt32LE(SR, 24);
    out.writeUInt32LE(SR * 2, 28);
    out.writeUInt16LE(2, 32);
    out.writeUInt16LE(16, 34);
    out.write('data', 36);
    out.writeUInt32LE(n * 2, 40);
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(this.buf[i]));
    const gain = peak > 0 ? 0.85 / peak : 1;
    for (let i = 0; i < n; i++) {
      const v = Math.tanh(this.buf[i] * gain * 1.4);
      out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 30000))), 44 + i * 2);
    }
    return out;
  }
}

/** 生成一段可循环的 8-bit 芯片音乐 */
export function renderChiptune(opts: ChiptuneOptions): Buffer {
  const duration = Math.max(4, opts.durationSec);
  const bpm = opts.bpm ?? 96;
  const mood = opts.mood ?? 'warm';
  const rand = seeded(opts.seed ?? 7);
  const synth = new Synth(duration);

  const beat = 60 / bpm;
  const bar = beat * 4;
  const eighth = beat / 2;
  const sixteenth = beat / 4;
  const progression = PROGRESSIONS[mood];
  const scale = SCALES[mood === 'sad' ? 'naturalMinor' : 'minorPent'];

  const chordAt = (barIndex: number) => progression[barIndex % progression.length];
  const bars = Math.ceil(duration / bar);

  // 主旋律：8 分音符，按和弦音阶随机走位，乐句重复
  let melodyNote = 0;
  const motif: number[] = [];
  for (let i = 0; i < 8; i++) motif.push(rand() > 0.28 ? Math.floor(rand() * 5) : -1);
  for (let b = 0; b < bars; b++) {
    const chord = chordAt(b);
    for (let step = 0; step < 8; step++) {
      if (b % 4 === 3 && step === 7) continue;
      const motifStep = motif[(step + (Math.floor(b / 4) % 2) * 0) % 8];
      if (motifStep < 0) continue;
      const stepIndex = (motifStep + (b % 4 === 2 ? 1 : 0) + melodyNote) % 5;
      const octave = b % 8 >= 4 && step > 3 ? 12 : 0;
      const note = chord.root + 12 + scale[stepIndex] + octave;
      const start = b * bar + step * eighth;
      synth.square(start, eighth * 0.92, midiToFreq(note), 0.16, 0.25, 1);
      if (step === 0) melodyNote = (melodyNote + 1) % 3;
    }
  }

  // 琶音：16 分音符，轻柔
  for (let b = 0; b < bars; b++) {
    const chord = chordAt(b);
    for (let s = 0; s < 16; s++) {
      const degree = [0, 1, 2, 1][s % 4];
      const note = chord.root + 24 + chord.chord[degree];
      synth.square(b * bar + s * sixteenth, sixteenth * 0.6, midiToFreq(note), 0.045, 0.125);
    }
  }

  // 贝斯：三角波，根音/五度
  for (let b = 0; b < bars; b++) {
    const chord = chordAt(b);
    const pattern = [0, 0, 7, 0, 0, 12, 7, 0];
    for (let s = 0; s < 8; s++) {
      const note = chord.root - 24 + pattern[s];
      synth.triangle(b * bar + s * eighth, eighth * 0.95, midiToFreq(note), 0.2);
    }
  }

  // 鼓组：底鼓 1/3、军鼓 2/4、轻镲 8 分
  for (let b = 0; b < bars; b++) {
    for (let s = 0; s < 8; s++) {
      const t = b * bar + s * eighth;
      if (s === 0 || s === 4) synth.triangle(t, 0.09, 70, 0.5);
      if (s === 2 || s === 6) synth.noise(t, 0.11, 0.22, rand, 190);
      synth.noise(t, 0.03, s % 2 === 0 ? 0.07 : 0.04, rand);
    }
  }

  // 收尾淡出
  const fade = Math.min(2, duration * 0.15);
  for (let i = 0; i < Math.ceil(fade * SR); i++) {
    const idx = synth.buf.length - 1 - i;
    if (idx < 0) break;
    synth.buf[idx] *= i / (fade * SR);
  }
  const fadeIn = Math.min(0.6, duration * 0.05);
  for (let i = 0; i < Math.ceil(fadeIn * SR); i++) {
    synth.buf[i] *= i / (fadeIn * SR);
  }

  return synth.toWav();
}
