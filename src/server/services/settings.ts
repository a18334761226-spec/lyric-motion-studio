import type { AspectRatio, RenderResolution, SettingsView, SettingsUpdate } from '../../shared/types';
import { allSettings, getSetting, setSetting } from '../db';
import { DATA_DIR, detectFfmpeg, invalidateFfmpegCache } from '../config';
import { DEFAULT_STYLE_PRESET_ID, DEFAULT_VOICE_ID } from '../../shared/presets';
import os from 'node:os';

const KEY = 'app';

export interface AppSettings {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  imageApiKey: string;
  imageBaseUrl: string;
  imageModel: string;
  researchProviders: ('wikipedia' | 'duckduckgo' | 'bing')[];
  onlineLyricsEnabled: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  renderConcurrency: number;
  defaultVoiceId: string;
  defaultStylePresetId: string;
  defaultAspect: AspectRatio;
  defaultResolution: RenderResolution;
}

const DEFAULTS: AppSettings = {
  deepseekApiKey: '',
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekModel: 'deepseek-chat',
  imageApiKey: '',
  imageBaseUrl: '',
  imageModel: '',
  researchProviders: ['wikipedia', 'duckduckgo', 'bing'],
  onlineLyricsEnabled: true,
  ffmpegPath: '',
  ffprobePath: '',
  renderConcurrency: 2,
  defaultVoiceId: DEFAULT_VOICE_ID,
  defaultStylePresetId: DEFAULT_STYLE_PRESET_ID,
  defaultAspect: '9:16',
  defaultResolution: '1080p',
};

let cache: AppSettings | null = null;

export function getSettings(force = false): AppSettings {
  if (cache && !force) return cache;
  const raw = getSetting(KEY);
  let stored: Partial<AppSettings> = {};
  if (raw) {
    try {
      stored = JSON.parse(raw) as Partial<AppSettings>;
    } catch {
      stored = {};
    }
  }
  cache = {
    ...DEFAULTS,
    ...stored,
    // 环境变量仅在没有界面配置时兜底
    deepseekApiKey: stored.deepseekApiKey || process.env.DEEPSEEK_API_KEY || '',
    deepseekBaseUrl: stored.deepseekBaseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULTS.deepseekBaseUrl,
    deepseekModel: stored.deepseekModel || process.env.DEEPSEEK_MODEL || DEFAULTS.deepseekModel,
    imageApiKey: stored.imageApiKey || process.env.IMAGE_API_KEY || '',
    imageBaseUrl: stored.imageBaseUrl || process.env.IMAGE_BASE_URL || '',
    imageModel: stored.imageModel || process.env.IMAGE_MODEL || '',
    ffmpegPath: stored.ffmpegPath || process.env.FFMPEG_PATH || '',
    ffprobePath: stored.ffprobePath || process.env.FFPROBE_PATH || '',
  };
  return cache;
}

export function updateSettings(patch: SettingsUpdate): AppSettings {
  const current = getSettings();
  const next: AppSettings = { ...current };

  if (patch.deepseekApiKey !== undefined) next.deepseekApiKey = patch.deepseekApiKey.trim();
  if (patch.deepseekBaseUrl !== undefined) next.deepseekBaseUrl = patch.deepseekBaseUrl.trim() || DEFAULTS.deepseekBaseUrl;
  if (patch.deepseekModel !== undefined) next.deepseekModel = patch.deepseekModel.trim() || DEFAULTS.deepseekModel;
  if (patch.imageApiKey !== undefined) next.imageApiKey = patch.imageApiKey.trim();
  if (patch.imageBaseUrl !== undefined) next.imageBaseUrl = patch.imageBaseUrl.trim();
  if (patch.imageModel !== undefined) next.imageModel = patch.imageModel.trim();
  if (patch.researchProviders !== undefined) next.researchProviders = patch.researchProviders;
  if (patch.onlineLyricsEnabled !== undefined) next.onlineLyricsEnabled = patch.onlineLyricsEnabled;
  if (patch.ffmpegPath !== undefined) next.ffmpegPath = patch.ffmpegPath.trim();
  if (patch.ffprobePath !== undefined) next.ffprobePath = patch.ffprobePath.trim();
  if (patch.renderConcurrency !== undefined) next.renderConcurrency = Math.min(4, Math.max(1, Number(patch.renderConcurrency) || 2));
  if (patch.defaultVoiceId !== undefined) next.defaultVoiceId = patch.defaultVoiceId;
  if (patch.defaultStylePresetId !== undefined) next.defaultStylePresetId = patch.defaultStylePresetId;
  if (patch.defaultAspect !== undefined) next.defaultAspect = patch.defaultAspect;
  if (patch.defaultResolution !== undefined) next.defaultResolution = patch.defaultResolution;

  setSetting(KEY, JSON.stringify(next));
  cache = next;
  invalidateFfmpegCache();
  return next;
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return '••••••';
  return `${key.slice(0, 5)}••••••${key.slice(-4)}`;
}

export function llmProvider(): 'deepseek' | 'mock' {
  return getSettings().deepseekApiKey ? 'deepseek' : 'mock';
}

export function imageProvider(): 'api' | 'mock' {
  const s = getSettings();
  const key = s.imageApiKey || s.deepseekApiKey;
  return key && s.imageBaseUrl && s.imageModel ? 'api' : 'mock';
}

/** 生图调用实际使用的凭据：优先专用生图 Key，其次复用 DeepSeek Key */
export function imageCredentials(): { key: string; baseUrl: string; model: string; viaDeepseek: boolean } {
  const s = getSettings();
  const viaDeepseek = !s.imageApiKey && Boolean(s.deepseekApiKey);
  return {
    key: s.imageApiKey || s.deepseekApiKey,
    baseUrl: s.imageBaseUrl || s.deepseekBaseUrl,
    model: s.imageModel,
    viaDeepseek,
  };
}

export async function buildSettingsView(): Promise<SettingsView> {
  const s = getSettings();
  const ff = await detectFfmpeg(Boolean(s.ffmpegPath));
  const ffBin = s.ffmpegPath || ff.bin;
  const apiReady = imageProvider() === 'api';
  return {
    deepseekConfigured: Boolean(s.deepseekApiKey),
    deepseekKeyMasked: maskKey(s.deepseekApiKey),
    deepseekBaseUrl: s.deepseekBaseUrl,
    deepseekModel: s.deepseekModel,
    imageConfigured: apiReady,
    imageKeyMasked: maskKey(s.imageApiKey),
    imageBaseUrl: s.imageBaseUrl,
    imageModel: s.imageModel,
    imageUsesDeepseekKey: !s.imageApiKey && Boolean(s.deepseekApiKey),
    imageEngine: apiReady ? 'api' : 'procedural',
    researchProviders: s.researchProviders,
    onlineLyricsEnabled: s.onlineLyricsEnabled,
    ffmpegPath: ffBin,
    ffprobePath: s.ffprobePath || ff.probe,
    renderConcurrency: s.renderConcurrency,
    defaultVoiceId: s.defaultVoiceId,
    defaultStylePresetId: s.defaultStylePresetId,
    defaultAspect: s.defaultAspect,
    defaultResolution: s.defaultResolution,
    env: {
      ffmpegReady: ff.ok,
      ffmpegVersion: ff.version || undefined,
      ttsReady: true,
      dataDir: DATA_DIR,
      platform: `${process.platform} ${os.arch()}`,
      nodeVersion: process.version,
    },
  };
}

/** 调试用：导出所有设置（含密钥），仅在服务端使用，不对外暴露 */
export function rawSettingsSnapshot(): Record<string, string> {
  return allSettings();
}
