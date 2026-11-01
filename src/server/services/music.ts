import fs from 'node:fs';
import path from 'node:path';
import type { MusicSpec } from '../../shared/types';

const SR = 44100;

/* ------------------------------------------------------------------ */
/* 乐理工具                                                            */
/* ------------------------------------------------------------------ */

const NOTE_BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteToMidi(name: string): number {
  const m = name.match(/^([A-Ga-g])([#b]?)/);
  if (!m) return 57;
  const base = NOTE_BASE[m[1].toUpperCase()] ?? 9;
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 60 + base + accidental;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 解析和弦：Am / F#m / C / G7 / Dm -> 音级列表 */
function chordMidi(chord: string, baseOctave = 4): number[] {
  const minor = /m(?!aj)/i.test(chord);
  const seventh = /7/.test(chord);
  const root = noteToMidi(chord);
  const third = minor ? 3 : 4;
  const notes = [0, third, 7];
  if (seventh) notes.push(10);
  return notes.map((n) => {
    const midi = root + n;
    return midi + (baseOctave - 4) * 12;
  });
}

/* ------------------------------------------------------------------ */
/* 合成器                                                              */
/* ------------------------------------------------------------------ */

interface Voice {
  role: string;
  gain: number;
  octave: number;
  waveform: string;
}

class StereoBuffer {
  readonly length: number;
  left: Float32Array;
  right: Float32Array;
  constructor(length: number) {
    this.length = length;
    this.left = new Float32Array(length);
    this.right = new Float32Array(length);
  }
  add(index: number, value: number, pan = 0) {
    if (index < 0 || index >= this.length) return;
    const l = Math.max(0, 1 - Math.max(0, pan));
    const r = Math.max(0, 1 + Math.min(0, pan));
    this.left[index] += value * l;
    this.right[index] += value * r;
  }
}

function sine(phase: number): number {
  return Math.sin(phase);
}

function saw(phase: number): number {
  const t = ((phase / (2 * Math.PI)) % 1 + 1) % 1;
  return 2 * t - 1;
}

function triangle(phase: number): number {
  const t = ((phase / (2 * Math.PI)) % 1 + 1) % 1;
  return 4 * Math.abs(t - 0.5) - 1;
}

function osc(waveform: string, phase: number): number {
  switch (waveform) {
    case 'saw':
      return saw(phase) * 0.6;
    case 'triangle':
      return triangle(phase) * 0.8;
    case 'square':
      return Math.sign(Math.sin(phase)) * 0.5;
    case 'noise':
      return (Math.random() * 2 - 1) * 0.7;
    default:
      return sine(phase);
  }
}

function addPad(buf: StereoBuffer, notes: number[], start: number, duration: number, gain: number, waveform: string) {
  const startSample = Math.floor(start * SR);
  const endSample = Math.min(buf.length, Math.floor((start + duration) * SR));
  const attack = Math.min(0.35 * SR, (endSample - startSample) * 0.3);
  const release = Math.min(0.5 * SR, (endSample - startSample) * 0.35);
  for (const midi of notes) {
    const freq = midiToFreq(midi);
    const detune = 1 + (Math.random() * 0.003 - 0.0015);
    let phase = Math.random() * Math.PI * 2;
    let phase2 = Math.random() * Math.PI * 2;
    const inc = (2 * Math.PI * freq * detune) / SR;
    for (let i = startSample; i < endSample; i++) {
      const local = i - startSample;
      const total = endSample - startSample;
      let env = 1;
      if (local < attack) env = local / attack;
      else if (total - local < release) env = (total - local) / release;
      // 缓慢起伏，让长音不呆板
      const swell = 0.85 + 0.15 * Math.sin(((i - startSample) / SR) * 0.35 + midi);
      const sample = (osc(waveform, phase) + osc('sine', phase2) * 0.35) * env * swell * gain;
      buf.add(i, sample, Math.sin(midi) * 0.3);
      phase += inc;
      phase2 += inc * 0.5;
    }
  }
}

function addPluck(
  buf: StereoBuffer,
  midi: number,
  start: number,
  gain: number,
  waveform: string,
  decay = 0.35,
  pan = 0,
) {
  const freq = midiToFreq(midi);
  const startSample = Math.floor(start * SR);
  const length = Math.floor(Math.min(2.2, decay * 4) * SR);
  let phase = 0;
  const inc = (2 * Math.PI * freq) / SR;
  for (let i = 0; i < length; i++) {
    const idx = startSample + i;
    if (idx >= buf.length) break;
    const t = i / SR;
    const env = Math.exp(-t / decay) * (1 - Math.exp(-t * 220));
    buf.add(idx, osc(waveform, phase) * env * gain, pan);
    phase += inc;
  }
}

function addKick(buf: StereoBuffer, start: number, gain: number) {
  const startSample = Math.floor(start * SR);
  const length = Math.floor(0.32 * SR);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const idx = startSample + i;
    if (idx >= buf.length) break;
    const t = i / SR;
    const freq = 55 + 110 * Math.exp(-t * 32);
    phase += (2 * Math.PI * freq) / SR;
    const env = Math.exp(-t * 9);
    buf.add(idx, Math.sin(phase) * env * gain, 0);
  }
}

function addNoiseLayer(
  buf: StereoBuffer,
  start: number,
  duration: number,
  gain: number,
  lowpass: number,
  modulate = 0,
) {
  const startSample = Math.floor(start * SR);
  const endSample = Math.min(buf.length, Math.floor((start + duration) * SR));
  let lpL = 0;
  let lpR = 0;
  const alpha = Math.min(0.95, lowpass);
  for (let i = startSample; i < endSample; i++) {
    const t = (i - startSample) / SR;
    const env = modulate ? 0.65 + 0.35 * Math.sin(t * modulate) : 1;
    lpL = lpL * alpha + (Math.random() * 2 - 1) * (1 - alpha);
    lpR = lpR * alpha + (Math.random() * 2 - 1) * (1 - alpha);
    buf.left[i] += lpL * gain * env;
    buf.right[i] += lpR * gain * env;
  }
}

function buildVoices(spec: MusicSpec): Voice[] {
  const allowed = new Set(['pad', 'bass', 'arp', 'perc', 'texture']);
  const voices = (spec.instruments || [])
    .filter((i) => allowed.has(i.role))
    .map((i) => ({ role: i.role, gain: Math.min(0.7, Math.max(0.02, i.gain)), octave: i.octave ?? 0, waveform: i.waveform || 'sine' }));
  if (!voices.length) {
    voices.push(
      { role: 'pad', gain: 0.3, octave: 0, waveform: 'sine' },
      { role: 'bass', gain: 0.24, octave: -2, waveform: 'triangle' },
    );
  }
  return voices;
}

export interface SynthResult {
  wav: Buffer;
  duration: number;
  peaks: number;
}

/**
 * 纯 Node 程序化配乐：氛围垫 / 低音 / 琶音 / 打击 / 噪声质感。
 * 依据 LLM 给出的调式、速度、配器与情绪能量生成，可复现（seed）。
 */
export function synthesizeMusic(spec: MusicSpec, durationSec: number, seed = 1): SynthResult {
  const duration = Math.max(4, durationSec);
  const length = Math.ceil(duration * SR);
  const buf = new StereoBuffer(length);
  const voices = buildVoices(spec);
  const bpm = Math.min(160, Math.max(40, spec.tempoBpm || 72));
  const beat = 60 / bpm;
  const bar = beat * 4;
  const progression = (spec.chordProgression?.length ? spec.chordProgression : ['Am', 'F', 'C', 'G']).slice(0, 4);
  const energy = Math.min(5, Math.max(1, spec.energy || 2));
  const rand = mulberry32(seed);
  const padVoice = voices.find((v) => v.role === 'pad');
  const bassVoice = voices.find((v) => v.role === 'bass');
  const arpVoice = voices.find((v) => v.role === 'arp');
  const percVoice = voices.find((v) => v.role === 'perc');
  const textureVoice = voices.find((v) => v.role === 'texture');

  const bars = Math.ceil(duration / bar) + 1;
  for (let b = 0; b < bars; b++) {
    const chord = progression[b % progression.length];
    const notes = chordMidi(chord, 4);
    const start = b * bar;
    if (start > duration) break;

    // 情绪曲线：前半段更静，后半段更满
    const progress = Math.min(1, start / Math.max(1, duration * 0.75));
    const dynamic = 0.62 + 0.38 * progress;

    if (padVoice) {
      addPad(buf, notes.map((n) => n + padVoice.octave * 12), start, bar * 1.05, padVoice.gain * dynamic, padVoice.waveform);
      addPad(buf, [notes[0] - 12 + padVoice.octave * 12], start, bar * 1.05, padVoice.gain * 0.35 * dynamic, 'sine');
    }
    if (bassVoice) {
      const bassNote = notes[0] - 24 + bassVoice.octave * 12;
      addPluck(buf, bassNote, start, bassVoice.gain * dynamic, bassVoice.waveform, 0.9);
      if (energy >= 3) addPluck(buf, bassNote, start + beat * 2, bassVoice.gain * 0.8 * dynamic, bassVoice.waveform, 0.7);
    }
    if (arpVoice) {
      const steps = energy >= 3 ? 8 : 4;
      for (let s = 0; s < steps; s++) {
        if (s % 2 === 0 && energy <= 1) continue;
        const note = notes[(s + b) % notes.length] + 12 + arpVoice.octave * 12;
        addPluck(buf, note, start + (s * bar) / steps, arpVoice.gain * dynamic * (0.7 + rand() * 0.5), arpVoice.waveform, 0.22, s % 2 === 0 ? -0.25 : 0.25);
      }
    }
    if (percVoice) {
      addKick(buf, start, percVoice.gain * dynamic);
      if (energy >= 4) addKick(buf, start + beat * 2, percVoice.gain * 0.7 * dynamic);
      const hats = energy >= 3 ? 8 : 4;
      for (let h = 1; h < hats; h += 2) {
        addNoiseLayer(buf, start + (h * bar) / hats, 0.06, percVoice.gain * 0.12, 0.2);
      }
    }
    if (textureVoice) {
      addNoiseLayer(buf, start, bar, textureVoice.gain * 0.5, 0.996, 0.6);
    }
  }

  // 全局淡入淡出 + 软削波 + 归一化
  const fadeIn = Math.floor(1.8 * SR);
  const fadeOut = Math.floor(3.5 * SR);
  let peak = 0;
  for (let i = 0; i < length; i++) {
    let env = 1;
    if (i < fadeIn) env = i / fadeIn;
    if (length - i < fadeOut) env = Math.min(env, (length - i) / fadeOut);
    const l = Math.tanh(buf.left[i] * 0.9) * env;
    const r = Math.tanh(buf.right[i] * 0.9) * env;
    buf.left[i] = l;
    buf.right[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const norm = peak > 0.0001 ? 0.82 / peak : 1;
  const wav = encodeWav(buf, norm);
  return { wav, duration, peaks: peak };
}

/** 环境音层 */
export function synthesizeAmbience(mode: string, durationSec: number): SynthResult {
  const duration = Math.max(2, durationSec);
  const length = Math.ceil(duration * SR);
  const buf = new StereoBuffer(length);
  const rand = mulberry32(7);
  switch (mode) {
    case 'rain': {
      addNoiseLayer(buf, 0, duration, 0.16, 0.72);
      // 零星雨滴
      for (let i = 0; i < duration * 4; i++) {
        const t = rand() * duration;
        const freq = 1200 + rand() * 1800;
        const startSample = Math.floor(t * SR);
        for (let k = 0; k < 400; k++) {
          const idx = startSample + k;
          if (idx >= buf.length) break;
          const env = Math.exp(-k / 90);
          buf.add(idx, Math.sin((2 * Math.PI * freq * k) / SR) * env * 0.08, rand() * 2 - 1);
        }
      }
      break;
    }
    case 'wind': {
      addNoiseLayer(buf, 0, duration, 0.2, 0.988, 0.22);
      addNoiseLayer(buf, 0, duration, 0.1, 0.94, 0.5);
      break;
    }
    case 'crowd': {
      addNoiseLayer(buf, 0, duration, 0.1, 0.86, 1.1);
      addNoiseLayer(buf, 0, duration, 0.06, 0.7, 0.37);
      break;
    }
    case 'room': {
      addNoiseLayer(buf, 0, duration, 0.05, 0.995, 0.13);
      break;
    }
    default:
      break;
  }
  const fadeIn = Math.floor(0.8 * SR);
  const fadeOut = Math.floor(1.2 * SR);
  let peak = 0;
  for (let i = 0; i < length; i++) {
    let env = 1;
    if (i < fadeIn) env = i / fadeIn;
    if (length - i < fadeOut) env = Math.min(env, (length - i) / fadeOut);
    buf.left[i] *= env;
    buf.right[i] *= env;
    peak = Math.max(peak, Math.abs(buf.left[i]), Math.abs(buf.right[i]));
  }
  const norm = peak > 0.0001 ? 0.6 / peak : 1;
  return { wav: encodeWav(buf, norm), duration, peaks: peak };
}

function encodeWav(buf: StereoBuffer, gain = 1): Buffer {
  const channels = 2;
  const bits = 16;
  const dataSize = buf.length * channels * (bits / 8);
  const out = Buffer.alloc(44 + dataSize);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataSize, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * channels * (bits / 8), 28);
  out.writeUInt16LE(channels * (bits / 8), 32);
  out.writeUInt16LE(bits, 34);
  out.write('data', 36);
  out.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < buf.length; i++) {
    const l = Math.max(-1, Math.min(1, buf.left[i] * gain));
    const r = Math.max(-1, Math.min(1, buf.right[i] * gain));
    out.writeInt16LE(Math.round(l * 32767), offset);
    out.writeInt16LE(Math.round(r * 32767), offset + 2);
    offset += 4;
  }
  return out;
}

export function writeWav(filePath: string, result: SynthResult): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, result.wav);
  if (fs.statSync(filePath).size < 1000) throw new Error('BGM 合成失败：输出文件为空');
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
