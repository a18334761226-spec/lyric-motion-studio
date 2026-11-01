import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Sparkles, Loader2, Wand2, ArrowRight, Copy, Check, Lightbulb, RefreshCw } from 'lucide-react';
import type { PromptOptimizeResult, StylePreset } from '../../shared/types';
import { api } from '../api';
import { CopyButton, EmptyState, Field, SectionTitle, Tag, useToast } from '../ui';

const EXAMPLES = [
  '凌晨四点的便利店，暖色灯光，一个人站在货架前发呆，窗外下着雨，电影感，安静',
  '赤壁之战，江面大雾，火船冲阵，远景，史诗感，水墨与实拍混合',
  '初春的山谷，薄雾中一叶扁舟，中国水墨，留白，极简构图',
  '赛博城市雨夜，霓虹倒映在积水里，长焦压缩，孤独的行人剪影',
];

export function PromptLab() {
  const navigate = useNavigate();
  const toast = useToast();
  const [idea, setIdea] = useState('');
  const [brief, setBrief] = useState('');
  const [stylePresetId, setStylePresetId] = useState('auto');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PromptOptimizeResult | null>(null);

  const { data: styles } = useQuery<StylePreset[]>({ queryKey: ['styles'], queryFn: () => api.get<StylePreset[]>('/styles') });
  const currentStyle = useMemo(() => styles?.find((s) => s.id === stylePresetId), [styles, stylePresetId]);

  async function optimize() {
    if (!idea.trim()) {
      toast.error('先写一句你的想法');
      return;
    }
    setLoading(true);
    try {
      const data = await api.post<PromptOptimizeResult & { warning?: string }>('/prompt/optimize', {
        idea: idea.trim(),
        stylePresetId,
        requirements: { brief, mustInclude: [], avoid: [] },
      });
      setResult(data);
      if (data.warning) toast.error(`DeepSeek 不可用，已使用本地引擎：${data.warning.slice(0, 60)}`);
      else toast.success('提示词已生成');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>
            <FlaskConical size={22} style={{ color: 'var(--brand-400)' }} />
            提示词实验室
          </h2>
          <p>不需要懂提示词工程：写下画面想法，DeepSeek 会补全主体、环境、光线、镜头与质感，并给出三个不同方向的变体。</p>
        </div>
        {result ? (
          <button className="btn btn-ghost" onClick={() => setResult(null)}>
            <RefreshCw size={14} />
            清空结果
          </button>
        ) : null}
      </div>

      <div className="split">
        <div className="card card-pad">
          <SectionTitle icon={<Wand2 size={16} />}>画面想法</SectionTitle>
          <div className="col" style={{ gap: 14 }}>
            <Field label="你想要的画面" hint="一句话也可以">
              <textarea
                className="textarea"
                style={{ minHeight: 120 }}
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="例如：雨夜的便利店门口，一个撑伞的人没有进去，暖光从玻璃里透出来"
              />
            </Field>
            <div className="chips">
              {EXAMPLES.map((example) => (
                <button key={example} className="chip" onClick={() => setIdea(example)} title={example}>
                  {example.slice(0, 14)}…
                </button>
              ))}
            </div>
            <div className="form-grid">
              <Field label="风格预设">
                <select className="select" value={stylePresetId} onChange={(e) => setStylePresetId(e.target.value)}>
                  {(styles ?? []).map((style) => (
                    <option key={style.id} value={style.id}>
                      {style.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="补充要求" hint="可选">
                <input className="input" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="例如：不要出现人脸，竖构图" />
              </Field>
            </div>
            {currentStyle ? (
              <div className="row wrap" style={{ gap: 8 }}>
                <Tag brand>{currentStyle.name}</Tag>
                {currentStyle.descriptors.slice(0, 4).map((descriptor) => (
                  <Tag key={descriptor}>{descriptor}</Tag>
                ))}
              </div>
            ) : null}
            <button className="btn btn-primary btn-lg" onClick={() => void optimize()} disabled={loading}>
              {loading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
              {loading ? '正在扩写…' : '生成专业提示词'}
            </button>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          {!result ? (
            <div className="card card-pad">
              <EmptyState
                icon={<Lightbulb />}
                title="结果会出现在这里"
                description="包括主提示词、负面提示词、修改理由，以及电影感 / 写实 / 风格化三个方向的变体。"
              />
            </div>
          ) : (
            <>
              <div className="card card-pad">
                <div className="row-between" style={{ marginBottom: 10 }}>
                  <SectionTitle icon={<Sparkles size={16} />}>主提示词</SectionTitle>
                  <CopyButton text={result.optimized} />
                </div>
                <div className="prompt-box">{result.optimized}</div>
                <div className="small muted" style={{ marginTop: 12, marginBottom: 6 }}>
                  负面提示词
                </div>
                <div className="prompt-box" style={{ fontSize: 11 }}>
                  {result.negative}
                </div>
              </div>

              <div className="card card-pad">
                <SectionTitle icon={<Lightbulb size={16} />}>为什么这样写</SectionTitle>
                <div className="col" style={{ gap: 7 }}>
                  {result.rationale.map((reason, index) => (
                    <div className="fact-item" key={index}>
                      <span className="fact-num">{String(index + 1).padStart(2, '0')}</span>
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card card-pad">
                <SectionTitle icon={<Wand2 size={16} />} count={result.variants.length}>
                  方向变体
                </SectionTitle>
                <div className="col" style={{ gap: 10 }}>
                  {result.variants.map((variant) => (
                    <div className="variant-card" key={variant.name}>
                      <div className="row-between">
                        <h4>
                          <Tag brand>{variant.name}</Tag>
                        </h4>
                        <CopyButton text={variant.prompt} label="复制" />
                      </div>
                      <p>{variant.prompt}</p>
                      <span className="small muted">{variant.note}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                className="btn btn-ghost btn-block"
                onClick={() => {
                  const seed = `${idea}${brief ? `。${brief}` : ''}。请使用以下提示词风格：${result.optimized}`;
                  navigate(`/new?type=idea&idea=${encodeURIComponent(seed)}`);
                }}
              >
                用这个想法创建成片
                <ArrowRight size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
