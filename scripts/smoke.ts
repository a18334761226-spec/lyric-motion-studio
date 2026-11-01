/**
 * 端到端冒烟测试：创建项目 → 跑完整流水线 → 校验 MP4。
 * 用法：pnpm smoke [-- 9:16|16:9] [--full]
 */
import fs from 'node:fs';
import path from 'node:path';
import type { StageKey } from '../src/shared/types';
import { createProject } from '../src/server/services/projects';
import { getProject } from '../src/server/db';
import { startPipeline, isPipelineRunning } from '../src/server/services/pipeline';
import { loadSong } from '../src/server/services/lyrics';
import { PROJECTS_DIR } from '../src/server/config';

const args = process.argv.slice(2);
const aspect = args.includes('16:9') ? '16:9' : '9:16';
const full = args.includes('--full');

async function main() {
  const loaded = await loadSong('seed-01');
  if (!loaded.song) throw new Error('示例歌词加载失败');

  const result = await createProject({
    sourceType: 'lyrics',
    songId: 'seed-01',
    section: full ? undefined : { startLine: 0, endLine: 9 },
    requirements: {
      brief: '想做成雨夜城市里一个人走回家的感觉，克制一点，不要出现人脸特写。',
      sceneDensity: 'medium',
      mustInclude: ['雨夜街道', '路灯'],
      avoid: ['人脸特写', '文字水印'],
      bgmPrompt: '低沉的氛围电子，雨声与低频脉动',
      bgmMode: 'ai',
    },
    stylePresetId: 'neon-noir',
    aspect,
    resolution: '1080p',
    voiceId: 'zh-CN-XiaoxiaoNeural',
  });
  if (!result.project) throw new Error(result.error || '创建项目失败');
  const project = result.project;
  console.log(`\n▶ 项目已创建：${project.id} 「${project.title}」 ${aspect} / ${project.segments.length} 段\n`);

  const start = startPipeline(project.id, {});
  if (!start.ok) throw new Error(start.error || '启动失败');

  const startedAt = Date.now();
  let lastLine = '';
  for (;;) {
    await new Promise((r) => setTimeout(r, 1200));
    const current = getProject(project.id);
    if (!current) throw new Error('项目丢失');
    const line = current.stages
      .map((s) => {
        const icon = s.status === 'done' ? '✓' : s.status === 'running' ? '▶' : s.status === 'failed' ? '✗' : s.status === 'skipped' ? '-' : '·';
        return `${icon}${s.key}${s.status === 'running' ? `(${s.progress}%)` : ''}`;
      })
      .join(' ');
    if (line !== lastLine) {
      lastLine = line;
      console.log(`  ${line}`);
    }
    if (!isPipelineRunning(project.id) && current.status !== 'running') {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`\n▶ 流水线结束：status=${current.status} 用时 ${elapsed}s`);
      if (current.error) console.log(`  错误：${current.error}`);
      for (const stage of current.stages) {
        if (stage.error) console.log(`  阶段 ${stage.key} 错误：${stage.error}`);
      }
      const video = current.assets.videoUrl;
      if (!video) {
        console.error('\n✗ 没有产出成片');
        process.exit(1);
      }
      const file = path.join(PROJECTS_DIR, project.id, 'out', 'video.mp4');
      const stat = fs.statSync(file);
      console.log(`✓ 成片：${file}`);
      console.log(`  大小：${(stat.size / 1024 / 1024).toFixed(2)} MB · 时长：${current.assets.videoDuration?.toFixed(1)}s`);
      console.log(`  镜头：${current.storyboard?.shots.length ?? 0} · 段落：${current.segments.length}`);
      console.log(`  AI：analysis=${current.analysis?.provider} storyboard=${current.storyboard?.provider} music=${current.assets.music?.spec?.provider ?? 'none'}`);
      console.log(`  封面：${current.assets.coverUrl ?? '无'}`);
      const timeline = current.assets.timeline ?? [];
      console.log(`  时间轴：${timeline.length} 句，最后一句 ${timeline[timeline.length - 1]?.end.toFixed(2)}s`);
      process.exit(0);
    }
    if (Date.now() - startedAt > 12 * 60 * 1000) {
      console.error('✗ 超时');
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('✗ 冒烟测试失败：', err);
  process.exit(1);
});

export type { StageKey };
