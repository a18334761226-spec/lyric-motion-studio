import { EventEmitter } from 'node:events';
import type { PipelineEvent } from '../../shared/types';

class PipelineBus extends EventEmitter {
  publish(event: PipelineEvent): void {
    this.emit(`project:${event.projectId}`, event);
  }
  subscribe(projectId: string, listener: (event: PipelineEvent) => void): () => void {
    const channel = `project:${projectId}`;
    this.on(channel, listener);
    return () => this.off(channel, listener);
  }
}

export const pipelineBus = new PipelineBus();
