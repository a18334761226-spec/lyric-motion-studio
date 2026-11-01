import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Settings2, KeyRound, Image, Globe2, MonitorPlay, Cpu, CheckCircle2, XCircle, Loader2, Save, RotateCw, Info } from 'lucide-react';
import type { AspectRatio, RenderResolution, SettingsUpdate, SettingsView, TestResult } from '../../shared/types';
import { ASPECT_META } from '../../shared/types';
import { STYLE_PRESETS, VOICE_OPTIONS } from '../../shared/presets';
import { api } from '../api';
import { Field, SectionTitle, Segmented, Switch, Tag, useToast } from '../ui';

const PROVIDERS = [
  { id: 'wikipedia' as const, label: 'Wikipedia', hint: '权威、可引用，历史题材首选' },
  { id: 'duckduckgo' as const, label: 'DuckDuckGo', hint: '通用网页检索，无广告' },
  { id: 'bing' as const, label: 'Bing', hint: '中文网页覆盖更广' },
];

export function Settings() {
  const toast = useToast();
  const { data: settings, refetch } = useQuery<SettingsView>({ queryKey: ['settings'], queryFn: () => api.get<SettingsView>('/settings') });
  const [form, setForm] = useState<SettingsUpdate>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    if (!settings) return;
    setForm({
      deepseekBaseUrl: settings.deepseekBaseUrl,
      deepseekModel: settings.deepseekModel,
      imageBaseUrl: settings.imageBaseUrl,
      imageModel: settings.imageModel,
      researchProviders: settings.researchProviders,
      onlineLyricsEnabled: settings.onlineLyricsEnabled,
      ffmpegPath: settings.ffmpegPath,
      renderConcurrency: settings.renderConcurrency,
      defaultVoiceId: settings.defaultVoiceId,
      defaultStylePresetId: settings.defaultStylePresetId,
      defaultAspect: settings.defaultAspect,
      defaultResolution: settings.defaultResolution,
    });
  }, [settings]);

  async function save() {
    setSaving(true);
    try {
      await api.put<SettingsView>('/settings', form);
      await refetch();
      toast.success('设置已保存');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function test(target: 'deepseek' | 'image' | 'research' | 'tts' | 'ffmpeg') {
    setTesting(target);
    try {
      const result = await api.post<TestResult>('/settings/test', { target });
      setTestResults((prev) => ({ ...prev, [target]: result }));
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTesting(null);
    }
  }

  const status = (target: string) => {
    const result = testResults[target];
    if (!result) return null;
    return (
      <span className={`badge ${result.ok ? 'badge-ready' : 'badge-error'}`}>
        {result.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
        {result.message}
        {result.latencyMs ? ` · ${result.latencyMs}ms` : ''}
      </span>
    );
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>
            <Settings2 size={22} style={{ color: 'var(--brand-400)' }} />
            设置
          </h2>
          <p>所有密钥只保存在本机 data/studio.db 中；不填也能跑通全流程（使用本地引擎）。</p>
        </div>
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
          保存设置
        </button>
      </div>

      <div className="settings-grid">
        <div className="card card-pad">
          <SectionTitle icon={<KeyRound size={16} />}>DeepSeek 文本模型</SectionTitle>
          <div className="col" style={{ gap: 13 }}>
            <Field label="API Key" hint="必填以启用真实模型">
              <input
                className="input"
                type="password"
                value={form.deepseekApiKey ?? ''}
                onChange={(e) => setForm({ ...form, deepseekApiKey: e.target.value })}
                placeholder={settings?.deepseekConfigured ? `已配置：${settings.deepseekKeyMasked}（留空则不修改）` : 'sk-…'}
              />
            </Field>
            <div className="form-grid" style={{ gap: 12 }}>
              <Field label="Base URL">
                <input className="input" value={form.deepseekBaseUrl ?? ''} onChange={(e) => setForm({ ...form, deepseekBaseUrl: e.target.value })} />
              </Field>
              <Field label="模型名" hint="如 deepseek-chat / 自定义版本">
                <input className="input" value={form.deepseekModel ?? ''} onChange={(e) => setForm({ ...form, deepseekModel: e.target.value })} />
              </Field>
            </div>
            <div className="row wrap">
              <button className="btn btn-ghost btn-sm" onClick={() => void test('deepseek')} disabled={testing === 'deepseek'}>
                {testing === 'deepseek' ? <Loader2 size={13} className="spin" /> : <RotateCw size={13} />}
                测试连接
              </button>
              {status('deepseek')}
            </div>
            <p className="field-help">
              用于：内容理解、分镜脚本、提示词优化、史料提炼、配乐设计。未配置时全部自动降级为本地确定性引擎。
            </p>
          </div>
        </div>

        <div className="card card-pad">
          <SectionTitle icon={<Image size={16} />}>画面策略</SectionTitle>
          <div className="col" style={{ gap: 8, marginBottom: 4 }}>
            <div className="status-line">
              <span className={`dot ${settings?.imageEngine === 'api' ? 'ok' : 'ok'}`} />
              默认画面
              <strong style={{ marginLeft: 'auto' }}>
                {settings?.imageEngine === 'api' ? 'OpenAI 兼容生图 API' : '纯代码像素画（8-bit）'}
              </strong>
            </div>
            <p className="field-help">
              每个镜头会按该句歌词的意象，用代码绘制像素插画（雨窗 / 夜街 / 河舟 / 陈列柜 / 房间…），再合成像素字幕与章节标记。
              完全本地、无需任何生图 Key。若配置了生图接口，则优先用接口出图。
            </p>
          </div>
          <div className="col" style={{ gap: 13 }}>
            <p className="field-help" style={{ margin: 0 }}>
              生图走 OpenAI 兼容的 <code>/images/generations</code>。可以**只填下面的 Base URL + 模型名**，Key 留空即自动复用上面的 DeepSeek Key；
              也可以单独填任意生图服务（如 SiliconFlow / 即梦代理）的 Key。
            </p>
            <Field label="生图 API Key" hint={settings?.imageUsesDeepseekKey ? '当前复用 DeepSeek Key' : '留空则复用 DeepSeek Key'}>
              <input
                className="input"
                type="password"
                value={form.imageApiKey ?? ''}
                onChange={(e) => setForm({ ...form, imageApiKey: e.target.value })}
                placeholder={settings?.imageConfigured ? `已配置：${settings.imageKeyMasked}（留空则不修改）` : '留空 → 使用 DeepSeek Key'}
              />
            </Field>
            <div className="form-grid" style={{ gap: 12 }}>
              <Field label="生图 Base URL" hint="留空则用 DeepSeek Base URL">
                <input className="input" value={form.imageBaseUrl ?? ''} onChange={(e) => setForm({ ...form, imageBaseUrl: e.target.value })} placeholder="https://api.deepseek.com" />
              </Field>
              <Field label="生图模型名" hint="必须是提供 /images/generations 的模型">
                <input className="input" value={form.imageModel ?? ''} onChange={(e) => setForm({ ...form, imageModel: e.target.value })} placeholder="例如 janus-pro / deepseek-image / flux.1-schnell" />
              </Field>
            </div>
            <div className="row wrap">
              <button className="btn btn-ghost btn-sm" onClick={() => void test('image')} disabled={testing === 'image'}>
                {testing === 'image' ? <Loader2 size={13} className="spin" /> : <RotateCw size={13} />}
                测试生图接口
              </button>
              {status('image')}
            </div>
            {testResults.image?.detail ? <p className="field-help">{testResults.image.detail}</p> : null}
            <p className="field-help">
              注意：DeepSeek 官方 <code>deepseek-chat</code> 只出文本，不出图。若你的接入点提供生图模型，请填对应模型名；否则需填第三方生图服务的 Key。
            </p>
          </div>
        </div>

        <div className="card card-pad">
          <SectionTitle icon={<Globe2 size={16} />}>联网检索</SectionTitle>
          <div className="col" style={{ gap: 8 }}>
            {PROVIDERS.map((provider) => {
              const enabled = (form.researchProviders ?? []).includes(provider.id);
              return (
                <div className="setting-row" key={provider.id}>
                  <div className="setting-info">
                    <strong>{provider.label}</strong>
                    <span>{provider.hint}</span>
                  </div>
                  <Switch
                    checked={enabled}
                    onChange={(next) => {
                      const current = form.researchProviders ?? [];
                      setForm({
                        ...form,
                        researchProviders: next ? [...current, provider.id] : current.filter((id) => id !== provider.id),
                      });
                    }}
                  />
                </div>
              );
            })}
            <div className="setting-row">
              <div className="setting-info">
                <strong>在线歌词检索</strong>
                <span>走网易云音乐公开接口；关闭后仅用本地曲库</span>
              </div>
              <Switch checked={Boolean(form.onlineLyricsEnabled)} onChange={(next) => setForm({ ...form, onlineLyricsEnabled: next })} />
            </div>
            <div className="row wrap">
              <button className="btn btn-ghost btn-sm" onClick={() => void test('research')} disabled={testing === 'research'}>
                {testing === 'research' ? <Loader2 size={13} className="spin" /> : <RotateCw size={13} />}
                测试检索通道
              </button>
              {status('research')}
            </div>
            {testResults.research?.detail ? <p className="field-help">{testResults.research.detail}</p> : null}
          </div>
        </div>

        <div className="card card-pad">
          <SectionTitle icon={<MonitorPlay size={16} />}>渲染与配音</SectionTitle>
          <div className="col" style={{ gap: 13 }}>
            <Field label="ffmpeg 路径" hint={settings?.env.ffmpegReady ? `已检测：${settings.env.ffmpegVersion}` : '未检测到，请安装或指定路径'}>
              <input className="input" value={form.ffmpegPath ?? ''} onChange={(e) => setForm({ ...form, ffmpegPath: e.target.value })} placeholder="留空自动探测" />
            </Field>
            <Field label={`渲染并发 ${form.renderConcurrency ?? 2}`} hint="越高越快，但更吃 CPU">
              <input
                className="range"
                type="range"
                min={1}
                max={4}
                value={form.renderConcurrency ?? 2}
                onChange={(e) => setForm({ ...form, renderConcurrency: Number(e.target.value) })}
              />
            </Field>
            <div className="row wrap">
              <button className="btn btn-ghost btn-sm" onClick={() => void test('ffmpeg')} disabled={testing === 'ffmpeg'}>
                {testing === 'ffmpeg' ? <Loader2 size={13} className="spin" /> : <RotateCw size={13} />}
                检测 ffmpeg
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => void test('tts')} disabled={testing === 'tts'}>
                {testing === 'tts' ? <Loader2 size={13} className="spin" /> : <RotateCw size={13} />}
                测试 Edge-TTS
              </button>
              {status('ffmpeg')}
              {status('tts')}
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <SectionTitle icon={<Cpu size={16} />}>默认参数</SectionTitle>
          <div className="col" style={{ gap: 13 }}>
            <Field label="默认风格">
              <select className="select" value={form.defaultStylePresetId} onChange={(e) => setForm({ ...form, defaultStylePresetId: e.target.value })}>
                {STYLE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} — {preset.tagline}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="默认音色">
              <select className="select" value={form.defaultVoiceId} onChange={(e) => setForm({ ...form, defaultVoiceId: e.target.value })}>
                {VOICE_OPTIONS.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} · {voice.locale}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="默认画幅">
              <Segmented
                value={(form.defaultAspect ?? settings?.defaultAspect ?? '9:16') as AspectRatio}
                onChange={(value) => setForm({ ...form, defaultAspect: value })}
                options={(Object.keys(ASPECT_META) as AspectRatio[]).map((key) => ({ value: key, label: ASPECT_META[key].label }))}
              />
            </Field>
            <Field label="默认分辨率">
              <Segmented
                value={(form.defaultResolution ?? settings?.defaultResolution ?? '1080p') as RenderResolution}
                onChange={(value) => setForm({ ...form, defaultResolution: value })}
                options={[
                  { value: '720p' as RenderResolution, label: '720p' },
                  { value: '1080p' as RenderResolution, label: '1080p' },
                ]}
              />
            </Field>
          </div>
        </div>

        <div className="card card-pad">
          <SectionTitle icon={<Info size={16} />}>环境自检</SectionTitle>
          <div className="col" style={{ gap: 8 }}>
            <div className="status-line">
              <span className={`dot ${settings?.env.ffmpegReady ? 'ok' : 'off'}`} />
              ffmpeg
              <strong style={{ marginLeft: 'auto' }}>{settings?.env.ffmpegVersion ?? '未检测到'}</strong>
            </div>
            <div className="status-line">
              <span className="dot ok" />
              Edge-TTS
              <strong style={{ marginLeft: 'auto' }}>在线可用（无需 Key）</strong>
            </div>
            <div className="status-line">
              <span className="dot ok" />
              数据目录
              <strong style={{ marginLeft: 'auto', fontSize: 11 }}>{settings?.env.dataDir}</strong>
            </div>
            <div className="status-line">
              <span className="dot ok" />
              运行环境
              <strong style={{ marginLeft: 'auto' }}>
                {settings?.env.platform} · Node {settings?.env.nodeVersion}
              </strong>
            </div>
          </div>
          <div className="divider" />
          <div className="col" style={{ gap: 7 }}>
            <Tag>本地优先：数据与成片都保存在本机</Tag>
            <Tag>LLM 决定风格：信息图 / 文字卡 / 插画 · 底部 260px 留给字幕 · 抖音安全区</Tag>
            <Tag>DeepSeek 仅传输文本，不上传音视频</Tag>
          </div>
        </div>
      </div>
    </div>
  );
}
