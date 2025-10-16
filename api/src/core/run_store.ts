import type { RunRecord } from './types.js';

export class RunStore {
  private readonly runs = new Map<string, RunRecord>();

  public save(run: RunRecord) {
    this.runs.set(run.id, run);
  }

  public get(id: string) {
    return this.runs.get(id) ?? null;
  }
}
