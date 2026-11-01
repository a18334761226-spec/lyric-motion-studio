import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import type { VoiceConfig } from '../../shared/types';
import { detectFfmpeg, runCommand } from '../config';
import { probeDuration } from './ffmpeg';
import { hashString } from './text';

export interface WordBoundary {
  start: number;
  end: number;
  text: string;
}

export interface SynthOptions {
  /** 每个词的变调（半音），用于「半唱」模式 */
  pitchPlan?: number[];
}

export interface SynthResult {
  file: string;
  duration: number;
  warning?: string;
  /** 是否应用了半唱变调 */
  melodic?: boolean;
}

const UNIT = 1e7; // Edge metadata 时间单位：100ns

function collectMetadata(stream: Readable | null): Promise<string> {
  if (!stream) return Promise.resolve('');
  return new Promise((resolve) => {
    let raw = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(raw);
    };
    stream.on('data', (chunk) => {
      raw += chunk.toString();
    });
    stream.on('end', done);
    stream.on('close', done);
    stream.on('error', done);
    setTimeout(done, 8000).unref();
  });
}

function parseBoundaries(raw: string): WordBoundary[] {
  if (!raw.trim()) return [];
  const chunks = raw.split(/(?<=\})\s*(?=\{)/);
  const out: WordBoundary[] = [];
  for (const chunk of chunks) {
    try {
      const parsed = JSON.parse(chunk) as {
        Metadata?: { Type?: string; Data?: { Offset?: number; Duration?: number; text?: { Text?: string } } }[];
      };
      for (const item of parsed.Metadata ?? []) {
        if (item.Type !== 'WordBoundary' || !item.Data) continue;
        const offset = Number(item.Data.Offset ?? 0) / UNIT;
        const duration = Number(item.Data.Duration ?? 0) / UNIT;
        if (duration <= 0.02) continue;
        out.push({ start: offset, end: offset + duration, text: item.Data.text?.Text ?? '' });
      }
    } catch {
      /* 忽略解析失败的元数据块 */
    }
  }
  return out;
}

/**
 * 半唱：按逐词时间戳切分音频，用 rubberband 给每个词做保共振峰变调，
 * 让朗读产生旋律起伏（不改变节奏，所以仍与字幕严格对齐）。
 */
async function applyMelodicPitch(rawPath: string, outPath: string, boundaries: WordBoundary[], plan: number[]): Promise<boolean> {
  const ff = await detectFfmpeg();
  if (!ff.ok || !boundaries.length || plan.length === 0) return false;
  const words = boundaries.filter((b) => b.end - b.start > 0.05);
  if (words.length < 2) return false;
  const filters: string[] = [];
  const labels: string[] = [];
  words.forEach((word, index) => {
    const semitone = Math.max(-3.5, Math.min(3.5, plan[index % plan.length] ?? 0));
    const ratio = Math.pow(2, semitone / 12).toFixed(5);
    filters.push(
      `[0:a]atrim=start=${word.start.toFixed(3)}:end=${word.end.toFixed(3)},asetpts=PTS-STARTPTS,rubberband=pitch=${ratio}:formant=preserved[s${index}]`,
    );
    labels.push(`[s${index}]`);
  });
  filters.push(`${labels.join('')}concat=n=${words.length}:v=0:a=1[out]`);
  const res = await runCommand(ff.bin, [
    '-y',
    '-hide_banner',
    '-i',
    rawPath,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-ar',
    '24000',
    '-ac',
    '1',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '96k',
    outPath,
  ]);
  return res.code === 0;
}

const MELODY_CONTOURS = {
  gentle: [0, 1, 2, 1, 0, 1, 2, 1],
  sad: [0, -1, -2, -1, 0, 1, 0, -1],
  hope: [0, 1, 2, 3, 2, 1, 0, 1],
  epic: [0, 2, 3, 2, 0, -1, 0, 2],
  ancient: [0, 1, 3, 2, 2, 0, 1, 0],
} as const;

/** 依据情绪与句子序号给出一句的旋律走向（半音） */
export function melodyPlanFor(mood: string, index: number): number[] {
  const text = mood || '';
  let base: number[];
  if (/悲|孤独|怅然|遗憾|冷|离|雨|夜/.test(text)) base = [...MELODY_CONTOURS.sad];
  else if (/燃|战|火|史诗|力量|速度/.test(text)) base = [...MELODY_CONTOURS.epic];
  else if (/古|水墨|禅|东方|离愁/.test(text)) base = [...MELODY_CONTOURS.ancient];
  else if (/希望|天亮|温暖|夏|青春|释然/.test(text)) base = [...MELODY_CONTOURS.hope];
  else base = [...MELODY_CONTOURS.gentle];
  // 每句轮换旋律动机，避免每句完全一样；同时保持在 ±3.5 半音内
  const rotate = (index % 3) * 2;
  return base.map((_, i) => {
    const value = base[(i + rotate) % base.length];
    return Math.max(-3.5, Math.min(3.5, value));
  });
}

function autoPitchPlan(text: string, seed = 0): number[] {
  const offset = hashString(text + seed) % 3;
  return MELODY_CONTOURS.gentle.map((v) => v + offset - 1);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function prosody(cfg: VoiceConfig) {
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n)}%`;
  return {
    rate: pct(cfg.rate),
    pitch: `${cfg.pitch >= 0 ? '+' : ''}${Math.round(cfg.pitch)}Hz`,
    volume: pct(cfg.volume),
  };
}

export function estimateSpeechDuration(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (text.match(/[a-zA-Z]+/g) || []).length;
  const other = text.length - chinese + words;
  return Math.max(0.8, chinese / 4.2 + words / 2.6 + Math.max(0, other - chinese) * 0.02);
}

async function writeSilence(outPath: string, durationSec: number): Promise<void> {
  const ff = await detectFfmpeg();
  if (!ff.ok) throw new Error('ffmpeg 不可用，无法生成静音兜底');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const res = await runCommand(ff.bin, [
    '-y',
    '-hide_banner',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=24000:cl=mono',
    '-t',
    durationSec.toFixed(2),
    '-q:a',
    '9',
    '-acodec',
    'libmp3lame',
    outPath,
  ]);
  if (res.code !== 0) throw new Error(`生成静音失败：${res.log.slice(-300)}`);
}

export interface TtsSession {
  synthesize(text: string, outPath: string, opts?: SynthOptions): Promise<SynthResult>;
  close(): void;
  voiceId: string;
  melodic: boolean;
}

/**
 * 复用同一个 Edge-TTS 连接批量合成，失败时回退为静音轨（保证整条流水线不中断）。
 * singMode=melodic 时开启逐词时间戳，合成后再做逐词变调，形成「半唱」。
 */
export async function createTtsSession(cfg: VoiceConfig): Promise<TtsSession> {
  const melodicMode = cfg.singMode === 'melodic';
  let tts: MsEdgeTTS | null = null;
  const connect = async () => {
    try {
      tts?.close();
    } catch {
      /* ignore */
    }
    tts = new MsEdgeTTS({ connectionTimeoutMs: 20000, synthesisTimeoutMs: 60000 });
    await tts.setMetadata(cfg.voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: melodicMode,
    });
    // 给 WebSocket 握手/鉴权留一点余量，避免首个请求偶发空流
    await new Promise((r) => setTimeout(r, 220));
  };
  await connect();

  return {
    voiceId: cfg.voiceId,
    melodic: melodicMode,
    close() {
      try {
        tts?.close();
      } catch {
        /* ignore */
      }
    },
    async synthesize(text, outPath, opts) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const clean = escapeXml(text.trim() || ' ');
      let warning: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const rawPath = melodicMode ? `${outPath}.raw.mp3` : outPath;
          const { audioStream, metadataStream } = tts!.toStream(clean, prosody(cfg));
          const metaPromise = melodicMode ? collectMetadata(metadataStream) : Promise.resolve('');
          await pipeline(audioStream, fs.createWriteStream(rawPath));
          if (!fs.existsSync(rawPath) || fs.statSync(rawPath).size < 1000) {
            throw new Error(`音频数据过短（${fs.existsSync(rawPath) ? fs.statSync(rawPath).size : 0} bytes）`);
          }
          let applied = false;
          if (melodicMode) {
            const metaRaw = await metaPromise;
            const boundaries = parseBoundaries(metaRaw);
            const plan = opts?.pitchPlan?.length ? opts.pitchPlan : autoPitchPlan(text, attempt);
            applied = await applyMelodicPitch(rawPath, outPath, boundaries, plan);
            if (!applied) {
              fs.copyFileSync(rawPath, outPath);
            }
            try {
              fs.unlinkSync(rawPath);
            } catch {
              /* ignore */
            }
          }
          const duration = await probeDuration(outPath);
          if (duration < 0.2) throw new Error('合成时长为 0');
          return { file: outPath, duration, melodic: applied };
        } catch (err) {
          warning = (err as Error).message.slice(0, 160);
          for (const file of [outPath, `${outPath}.raw.mp3`]) {
            try {
              if (fs.existsSync(file)) fs.unlinkSync(file);
            } catch {
              /* ignore */
            }
          }
          await new Promise((r) => setTimeout(r, 400 + attempt * 600));
          try {
            await connect();
          } catch (reconnectErr) {
            warning = `${warning} / 重连失败：${(reconnectErr as Error).message.slice(0, 80)}`;
          }
        }
      }
      const fallbackDur = estimateSpeechDuration(text);
      await writeSilence(outPath, fallbackDur);
      return {
        file: outPath,
        duration: fallbackDur,
        warning: `配音失败，已用静音占位（${warning ?? 'unknown'}）`,
      };
    },
  };
}

/** 试听：合成到临时目录并返回文件路径 */
export async function synthesizePreview(
  text: string,
  cfg: VoiceConfig,
  outDir: string,
  opts?: SynthOptions,
): Promise<SynthResult> {
  const session = await createTtsSession(cfg);
  try {
    const outPath = path.join(outDir, `preview-${Date.now()}.mp3`);
    return await session.synthesize(text, outPath, opts);
  } finally {
    session.close();
  }
}
