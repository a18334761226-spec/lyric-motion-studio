import type { Project, ResearchBundle } from '../../shared/types';
import { getSettings } from './settings';
import { researchTopic } from './research';

/**
 * 研究阶段的统一入口：合并用户需求与主题，按设置中的通道联网检索。
 */
export async function resolveResearch(
  project: Project,
  extraQueries: string[] | undefined,
  onProgress: (pct: number, message: string) => void,
): Promise<ResearchBundle> {
  const topic = project.source.topic || project.source.title;
  const era = project.source.era;
  const settings = getSettings();
  const providers = settings.researchProviders;

  onProgress(12, '生成检索关键词…');
  const queries = [
    ...(extraQueries ?? []),
    ...(project.requirements.mustInclude.length ? [project.requirements.mustInclude.slice(0, 1).join(' ')] : []),
  ].filter(Boolean);

  onProgress(25, `联网检索：${topic}${era ? ` · ${era}` : ''}…`);
  const bundle = await researchTopic({
    topic: era ? `${era} ${topic}` : topic,
    era,
    extraQueries: queries,
    maxSources: 10,
    providers,
  });

  onProgress(80, `提炼资料要点（${bundle.sources.length} 条来源）…`);
  if (bundle.sources.length && bundle.facts.length) {
    onProgress(92, `已提炼 ${bundle.facts.length} 条事实 · ${bundle.timeline.length} 条时间线`);
  }
  return bundle;
}
