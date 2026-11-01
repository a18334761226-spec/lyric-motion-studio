import fs from 'node:fs';
import path from 'node:path';

/**
 * 每日自动出片流水线（程序能力）：
 *   选题 → 自动写口播文案 → 建项目 → 跑完整流水线 → 导出发布包
 * 用法：
 *   node scripts/daily-video.mjs            # 按日期轮换选题，全部自动
 *   node scripts/daily-video.mjs --topic 3  # 指定选题下标
 *   node scripts/daily-video.mjs --dry      # 只生成文案和项目，不渲染
 *
 * 发布包输出到 data/exports/<日期>-<slug>/：
 *   video.mp4 / cover.jpg / script.txt / title.txt / desc.txt / tags.txt / meta.json
 */

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  console.error('缺少 DEEPSEEK_API_KEY 环境变量：请先 export/设置后再运行每日出片');
  process.exit(1);
}
const API = process.env.API_BASE || 'http://127.0.0.1:5099/api';
const ROOT = process.cwd();
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const topicIdxArg = args.indexOf('--topic');
const topicIdx = topicIdxArg >= 0 ? Number(args[topicIdxArg + 1]) : undefined;
const customArg = args.indexOf('--custom');
let custom: { title?: string; topic?: string; angle?: string; script?: string } | undefined;
if (customArg >= 0) {
  try {
    custom = JSON.parse(args[customArg + 1]);
  } catch {
    custom = undefined;
  }
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function chat(system: string, user: string, maxTokens = 6000): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.85, max_tokens: maxTokens }),
      });
      const j = (await r.json()) as any;
      const c = j.choices?.[0]?.message?.content;
      if (r.ok && c) return c as string;
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error('DeepSeek 调用失败');
}

async function api(method: string, p: string, body?: unknown): Promise<any> {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let d: any;
  try {
    d = JSON.parse(t);
  } catch {
    d = t;
  }
  if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  return d;
}

async function main(): Promise<void> {
  const topicsFile = [path.join(ROOT, 'data/topics.json'), path.join(ROOT, 'config/topics.json')].find((f) => fs.existsSync(f));
  if (!topicsFile) throw new Error('找不到选题库：请提供 data/topics.json 或 config/topics.json');
  const topics = JSON.parse(fs.readFileSync(topicsFile, 'utf8')) as { id: string; title: string; topic: string; angle: string }[];
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const pick = custom?.topic
    ? { id: `custom-${Date.now()}`, title: (custom.title || custom.topic).slice(0, 14), topic: custom.topic, angle: custom.angle || '' }
    : topics[topicIdx ?? dayOfYear % topics.length];
  console.log('选题:', pick.title, '—', pick.topic);

  let clean = (custom?.script ?? '').replace(/\s+/g, '').trim();
  if (clean.length >= 80) {
    console.log('① 使用你提供的口播稿（' + clean.length + ' 字）');
  } else {
  console.log('① 生成口播文案…');
  const script = await chat(
    `你是财经短视频爆款文案写手。写一篇 3 分钟口播稿（约 1100 字，1.3 倍语速约 180 秒）。
要求：
- 第一段必须是开场白，例如「今天我们来聊一个词，XXX」，直接点题，并用一句反常识/数字制造钩子。
- 结构：开场钩子 → 现象/数据 → 机制解释 → 2 个具体案例或人物 → 当下判断 → 给普通人 2–3 条可执行动作 → 一句金句收尾。
- 短句、有节奏、每 20–30 秒一个钩子或反常识；可以有数字、年份、对比，但不要编造精确数据，不确定就用「大约/接近」。
- 纯口播文本：不要分点符号、不要标题、不要 emoji、不要「大家好」。
只输出文案正文。`,
    `主题：${pick.topic}\n角度：${pick.angle}`,
    5000,
  );
  clean = script.replace(/\s+/g, '').trim();
  console.log('   文案字数:', clean.length, '| 预计时长:', Math.round(clean.length / 5.8), '秒');
  }

  console.log('② 创建项目…');
  const project = await api('POST', '/projects', {
    sourceType: 'idea',
    topic: pick.topic,
    raw: clean,
    stylePresetId: 'documentary',
    aspect: '9:16',
    requirements: {
      brief: '口播稿：保留原文；信息图画面；底部留字幕；1.3 倍语速；每句与画面逐句对应',
      targetDurationSec: 180,
      sceneDensity: 'medium',
      mustInclude: [pick.title],
      avoid: ['与台词无关的装饰', '纯意境插画'],
      styleKeywords: '财经信息图，深色底金色标题，清晰有力',
      narrationTone: '沉稳、有力量、像财经纪录片旁白',
      language: 'zh',
      bgmMode: 'generate',
      bgmPrompt: '低音提琴与电子脉冲，紧张、思辨、推进',
    },
  });
  console.log('   project:', project.id);

  if (!dry) {
    console.log('③ 跑流水线（画面/配音/BGM/合成）…');
    await api('POST', `/projects/${project.id}/start`, {});
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 10000));
      const p = await api('GET', `/projects/${project.id}`);
      if (p.status !== 'running') {
        console.log('   状态:', p.status, '| 时长:', p.assets?.videoDuration);
        if (p.error) throw new Error(p.error);
        break;
      }
      if (Date.now() - t0 > 40 * 60 * 1000) throw new Error('渲染超时');
    }
  }

  console.log('④ 生成发布包…');
  const p = await api('GET', `/projects/${project.id}`);
  const slug = pick.id;
  const outDir = path.join(ROOT, 'data/exports', `${today()}-${slug}`);
  fs.mkdirSync(outDir, { recursive: true });
  const videoPath = path.join(ROOT, 'data/projects', project.id, 'out/video.mp4');
  const coverPath = path.join(ROOT, 'data/projects', project.id, 'out/cover.png');
  const coverJpg = path.join(ROOT, 'data/projects', project.id, 'out/cover.jpg');
  if (fs.existsSync(videoPath)) fs.copyFileSync(videoPath, path.join(outDir, 'video.mp4'));
  if (fs.existsSync(coverPath)) fs.copyFileSync(coverPath, path.join(outDir, 'cover.png'));
  else if (fs.existsSync(coverJpg)) fs.copyFileSync(coverJpg, path.join(outDir, 'cover.jpg'));
  fs.writeFileSync(path.join(outDir, 'script.txt'), clean, 'utf8');

  const meta = await chat(
    `你是短视频运营。为这条视频写发布信息，输出严格 JSON：{"title":"20字内标题，带数字或反差","desc":"2-3行简介，含1个问题引导互动","tags":["5-8个话题词，不带#"]}`,
    `主题：${pick.topic}\n文案摘要：${clean.slice(0, 600)}`,
    1200,
  );
  let publish: { title: string; desc: string; tags: string[] };
  try {
    publish = JSON.parse(meta.replace(/^```json\s*|```$/g, '').trim());
  } catch {
    publish = { title: pick.title, desc: pick.angle, tags: [pick.title, '财经', '周期', '财富'] };
  }
  if (custom?.title) publish.title = custom.title.slice(0, 30);
  fs.writeFileSync(path.join(outDir, 'title.txt'), publish.title, 'utf8');
  fs.writeFileSync(path.join(outDir, 'desc.txt'), publish.desc, 'utf8');
  fs.writeFileSync(path.join(outDir, 'tags.txt'), publish.tags.map((t) => `#${t}`).join(' '), 'utf8');
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ date: today(), topic: pick, projectId: project.id, duration: p.assets?.videoDuration, publish, scriptChars: clean.length }, null, 2), 'utf8');
  fs.appendFileSync(path.join(ROOT, 'data/exports/log.jsonl'), JSON.stringify({ date: today(), topic: pick.title, projectId: project.id, outDir, at: new Date().toISOString() }) + '\n');
  console.log('发布包:', outDir);
  console.log('   ✓ video / cover / script / title / desc / tags / meta');
  console.log('待发布：在抖音创作者中心上传 video.mp4，标题用 title.txt，简介用 desc.txt，话题用 tags.txt');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
