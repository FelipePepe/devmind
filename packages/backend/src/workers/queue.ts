import type { JobsRepo, Job } from '../db/repos/jobs.js';

export class JobQueueClient {
  constructor(private repo: JobsRepo) {}

  enqueue(type: string, payload: unknown = {}): string {
    return this.repo.enqueue(type, payload);
  }

  getJob(id: string): Job | undefined {
    return this.repo.getJob(id);
  }

  resetStuckJobs(timeoutMs = 300_000): void {
    this.repo.resetStuck(timeoutMs);
  }
}
