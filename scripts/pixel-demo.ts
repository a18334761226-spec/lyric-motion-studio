/**
 * 纯代码像素 MV 样片（带动画）：
 *  1) 场景内动画：雨丝下落、星光闪烁、水面波纹、窗上雨痕（逐帧绘制）
 *  2) 镜头运动：像素级平移 / 上下缓移
 *  3) 场景转场：fade / pixelize / 划像 / 圆形展开
 * 用法：node --import ./scripts/ts-loader.mjs scripts/pixel-demo.ts [projectId] [lineCount]
 */
import fs from 'node:fs';
import path from 'node:path';
import { getProject } from '../src/server/db';
import { detectFfmpeg, projectDir, runCommand } from '../src/server/config';
import { pickPixelScene, pixelSceneLabel, renderPixelScene } from '../src/server/services/pixelScene';
import { renderChiptune } from '../src/server/services/chiptune';

const PROJECT_ID = process.argv[2] || 'proj_IzaevPjtBb';
const LINE_COUNT = Number(process.argv[3] || 6);
const FONT = path.join(process.cwd(), 'assets', 'fonts', 'fusion-pixel.ttf');
const OUT_DIR = path.join(process.cwd(), 'data', 'pixel-demo');
const FPS = 12;
const TRANSITION = 0.5;
const TRANSITIONS = ['fade', 'pixelize', 'wipeleft', 'slideup', 'circleopen', 'fadeblack'];

function wrapCjk(text: string, max = 13): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const lines: string[] = [];
  let rest = clean;
  while (rest.length > 0) {
    let cut = max;
    const window = rest.slice(0, max + 2);
    const idx = Math.max(window.lastIndexOf('，'), window.lastIndexOf(' '), window.lastIndexOf('、'));
    if (idx >= Math.floor(max * 0.5)) cut = idx + 1;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
    if (lines.length >= 2) break;
  }
  if (rest) lines[lines.length - 1] += rest;
  return lines.join('\n');
}

function ffEscape(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function fmt(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function panFilter(index: number, sceneType: string): string {
  // 室内/窗景：把取景框对准窗户，再做极小横移
  if (sceneType === 'room-night' || sceneType === 'rain-window' || sceneType === 'museum-display') {
    return index % 2 === 0 ? "x='min(800,740+t*20)':y='400'" : "x='max(740-t*20,700)':y='400'";
  }
  switch (index % 4) {
    case 0:
      return "x='min(140,t*45)':y='10'";
    case 1:
      return "x='max(140-t*45,0)':y='10'";
    case 2:
      return "x='20':y='min(120,t*38)'";
    default:
      return "x='20':y='max(120-t*38,0)'";
  }
}

async function main() {
  const ff = await detectFfmpeg();
  if (!ff.ok) throw new Error('ffmpeg 不可用');
  const project = getProject(PROJECT_ID);
  if (!project) throw new Error('项目不存在');
  const timeline = project.assets.timeline ?? [];
  const segments = project.segments.slice(0, LINE_COUNT);
  if (!segments.length) throw new Error('没有歌词');

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  for (const dir of ['scenes', 'clips', 'text', 'audio']) fs.mkdirSync(path.join(OUT_DIR, dir), { recursive: true });

  const encode = async (args: string[]) => {
    const res = await runCommand(ff.bin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { timeoutMs: 180000 });
    if (res.code !== 0) throw new Error(res.log.slice(-800));
  };

  const clips: { file: string; duration: number; transition: string }[] = [];

  /* ---------- 标题卡（星光闪烁 + 缓慢上移 + 淡入） ---------- */
  const titleDir = path.join(OUT_DIR, 'scenes', 'title');
  fs.mkdirSync(titleDir, { recursive: true });
  const TITLE_DUR = 3.6;
  const titleFrames = Math.ceil(TITLE_DUR * FPS);
  for (let f = 0; f < titleFrames; f++) {
    const png = renderPixelScene({ type: 'title-desert', seed: 20261029, frame: f }, 180, 320, { lowRes: true });
    fs.writeFileSync(path.join(titleDir, `${String(f).padStart(3, '0')}.png`), png);
  }
  const titleText = path.join(OUT_DIR, 'text', 'title.txt');
  fs.writeFileSync(titleText, project.source.title, 'utf8');
  const subtitleText = path.join(OUT_DIR, 'text', 'subtitle.txt');
  fs.writeFileSync(subtitleText, '8-BIT PIXEL TRIBUTE · 像素致敬版', 'utf8');
  const metaText = path.join(OUT_DIR, 'text', 'meta.txt');
  fs.writeFileSync(
    metaText,
    `原曲信息\n原唱 / 作曲   ${project.source.author}\n专辑   ${project.source.sourceLabel ?? 'Studio Demo'}\n\nMV 创作\nMV 导演   DeepSeek\n画面   纯代码像素绘制\n\nBGM  Chopin Nocturne Op.32 No.1\n演奏 eldüendesüarez · CC BY-SA 4.0`,
    'utf8',
  );
  const titleClip = path.join(OUT_DIR, 'clips', 'title.mp4');
  await encode([
    '-framerate', String(FPS),
    '-i', path.join(titleDir, '%03d.png'),
    '-t', String(TITLE_DUR),
    '-vf',
    [
      'scale=2160:3840:flags=neighbor',
      `crop=1080:1920:x='20':y='min(90,t*30)'`,
      'fade=t=in:st=0:d=0.7',
      `drawtext=fontfile='${ffEscape(FONT)}':text='LYRIC MOTION STUDIO':fontsize=24:fontcolor=0xc9a86a@0.85:x=72:y=64:borderw=2:bordercolor=0x0a0812`,
      `drawtext=fontfile='${ffEscape(FONT)}':textfile='${ffEscape(titleText)}':fontsize=96:fontcolor=0xf6e7c6:x=(w-tw)/2:y=740:borderw=4:bordercolor=0x0a0812`,
      `drawtext=fontfile='${ffEscape(FONT)}':textfile='${ffEscape(subtitleText)}':fontsize=28:fontcolor=0xe8c98a@0.95:x=(w-tw)/2:y=880:borderw=2:bordercolor=0x0a0812`,
      `drawbox=x=110:y=960:w=860:h=2:color=0xc9a86a@0.45:t=fill`,
      `drawtext=fontfile='${ffEscape(FONT)}':textfile='${ffEscape(metaText)}':fontsize=24:fontcolor=0xd8cdb8@0.9:x=110:y=1000:line_spacing=16:borderw=2:bordercolor=0x0a0812`,
      'fps=30',
      'format=yuv420p',
    ].join(','),
    '-r', '30',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    titleClip,
  ]);
  clips.push({ file: titleClip, duration: TITLE_DUR, transition: 'fade' });

  /* ---------- 每句歌词：动画像素场景 ---------- */
  let clock = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const timing = timeline.find((t) => t.segIndex === i);
    const duration = Math.max(2.8, timing ? timing.end - timing.start + 0.4 : 3.2);
    const { type, variant } = pickPixelScene(seg.text, i);
    const sceneDir = path.join(OUT_DIR, 'scenes', `shot-${i + 1}`);
    fs.mkdirSync(sceneDir, { recursive: true });
    const frames = Math.ceil(duration * FPS);
    for (let f = 0; f < frames; f++) {
      const png = renderPixelScene({ type, seed: 9001 + i * 77, variant, frame: f }, 180, 320, { lowRes: true });
      fs.writeFileSync(path.join(sceneDir, `${String(f).padStart(3, '0')}.png`), png);
    }

    const caption = wrapCjk(seg.text, 13);
    const captionFile = path.join(OUT_DIR, 'text', `caption-${i + 1}.txt`);
    fs.writeFileSync(captionFile, caption, 'utf8');
    const lineCount = caption.split('\n').length;
    const captionTextY = Math.round(1492 + (268 - lineCount * 78) / 2);
    const chapterFile = path.join(OUT_DIR, 'text', `chapter-${i + 1}.txt`);
    fs.writeFileSync(chapterFile, `CH.${String(i + 1).padStart(2, '0')} · ${pixelSceneLabel(type)}    ${fmt(clock)} – ${fmt(clock + duration)}`, 'utf8');

    const clipPath = path.join(OUT_DIR, 'clips', `scene-${i + 1}.mp4`);
    await encode([
      '-framerate', String(FPS),
      '-i', path.join(sceneDir, '%03d.png'),
      '-t', duration.toFixed(2),
      '-vf',
      [
        'scale=2160:3840:flags=neighbor',
        `crop=1080:1920:${panFilter(i, type)}`,
        'drawbox=x=64:y=52:w=620:h=52:color=0x08060c@0.55:t=fill',
        'drawbox=x=64:y=52:w=620:h=52:color=0xc9a86a@0.75:t=2',
        `drawtext=fontfile='${ffEscape(FONT)}':textfile='${ffEscape(chapterFile)}':fontsize=24:fontcolor=0xe8c98a:x=82:y=66:borderw=2:bordercolor=0x08060c`,
        'drawbox=x=72:y=1492:w=936:h=268:color=0x08060c@0.62:t=fill',
        'drawbox=x=72:y=1492:w=936:h=268:color=0xc9a86a@0.85:t=3',
        `drawtext=fontfile='${ffEscape(FONT)}':textfile='${ffEscape(captionFile)}':fontsize=60:fontcolor=0xf6e7c6:x=(w-tw)/2:y=${captionTextY}:line_spacing=18:borderw=3:bordercolor=0x08060c`,
        'fps=30',
        'format=yuv420p',
      ].join(','),
      '-r', '30',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      clipPath,
    ]);
    clips.push({ file: clipPath, duration, transition: TRANSITIONS[i % TRANSITIONS.length] });
    clock += duration;
  }

  /* ---------- xfade 转场拼接 ---------- */
  const inputs: string[] = [];
  for (const clip of clips) inputs.push('-i', clip.file);
  let filter = '';
  let prev = '[0:v]';
  let offset = 0;
  for (let i = 1; i < clips.length; i++) {
    offset += clips[i - 1].duration - TRANSITION;
    const label = i === clips.length - 1 ? '[vout]' : `[v${i}]`;
    filter += `${prev}[${i}:v]xfade=transition=${clips[i].transition}:duration=${TRANSITION}:offset=${offset.toFixed(3)}${label};`;
    prev = label;
  }
  filter += `${prev}null[vout]`;
  const silentVideo = path.join(OUT_DIR, 'video-only.mp4');
  await encode([...inputs, '-filter_complex', filter, '-map', '[vout]', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', silentVideo]);

  /* ---------- 音频：标题静音 + 旁白 ---------- */
  const voiceover = path.join(projectDir(project.id), 'voice', 'voiceover.mp3');
  const silentMp3 = path.join(OUT_DIR, 'audio', 'silence.mp3');
  await encode(['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(TITLE_DUR), '-q:a', '9', '-acodec', 'libmp3lame', silentMp3]);
  const voicePrefix = path.join(OUT_DIR, 'audio', 'voice-prefix.mp3');
  const lastEnd = timeline[Math.min(LINE_COUNT - 1, timeline.length - 1)]?.end ?? 0;
  let voiceOk = false;
  if (fs.existsSync(voiceover) && lastEnd > 0) {
    await encode(['-i', voiceover, '-t', (lastEnd + 0.12).toFixed(2), '-q:a', '4', '-acodec', 'libmp3lame', voicePrefix]);
    voiceOk = true;
  }
  const audioList = path.join(OUT_DIR, 'audio-list.txt');
  fs.writeFileSync(audioList, [silentMp3, voiceOk ? voicePrefix : silentMp3].map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  const audioMp3 = path.join(OUT_DIR, 'audio', 'mix.mp3');
  await encode(['-f', 'concat', '-safe', '0', '-i', audioList, '-c:a', 'libmp3lame', '-b:a', '128k', audioMp3]);

  /* ---------- 背景音乐：真实歌曲（自动循环 / 淡入淡出 / 人声闪避） ---------- */
  const totalDuration = clock + TITLE_DUR - TRANSITION * (clips.length - 1);
  const songPath = path.join(process.cwd(), 'assets', 'music', 'nocturne-op32-1.mp3');
  const useSong = fs.existsSync(songPath);
  const finalPath = path.join(OUT_DIR, 'pixel-tribute.mp4');
  if (useSong) {
    await encode([
      '-i', silentVideo,
      '-i', audioMp3,
      '-stream_loop', '-1', '-i', songPath,
      '-filter_complex',
      `[2:a]volume=0.65,atrim=0:${totalDuration.toFixed(2)},afade=t=in:st=0:d=2,afade=t=out:st=${(totalDuration - 2).toFixed(2)}:d=2[bg];` +
        '[1:a]asplit=2[v1][v2];' +
        '[bg][v2]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[duck];' +
        '[duck][v1]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-15:TP=-1.5:LRA=11[a]',
      '-map', '0:v',
      '-map', '[a]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-shortest',
      finalPath,
    ]);
  } else {
    const bgmWav = path.join(OUT_DIR, 'audio', 'chip-bgm.wav');
    fs.writeFileSync(bgmWav, renderChiptune({ durationSec: totalDuration + 0.6, seed: 20261029, bpm: 96, mood: 'warm' }));
    await encode([
      '-i', silentVideo,
      '-i', audioMp3,
      '-i', bgmWav,
      '-filter_complex',
      '[2:a]volume=0.28,afade=t=in:st=0:d=1.2[bg];[1:a][bg]amix=inputs=2:normalize=0:duration=first[a]',
      '-map', '0:v',
      '-map', '[a]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-shortest',
      finalPath,
    ]);
  }
  const size = (fs.statSync(finalPath).size / 1024 / 1024).toFixed(1);
  console.log('成片：', finalPath, size + 'MB');
  console.log('镜头：', clips.length, '总时长', totalDuration.toFixed(1) + 's', '转场', TRANSITION + 's', useSong ? 'BGM=真实歌曲' : 'BGM=芯片音乐');
}

main().catch((err) => {
  console.error('失败：', err);
  process.exit(1);
});
