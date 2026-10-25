interface Job {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class RateLimiter {
  private readonly pending: Job[] = [];
  private active = 0;
  private lastStartAt = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly minIntervalMs: number,
    private readonly maxConcurrent = 1,
  ) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ task, resolve: resolve as (value: unknown) => void, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.timer || this.active >= this.maxConcurrent || this.pending.length === 0) return;

    const waitMs = this.lastStartAt + this.minIntervalMs - Date.now();
    if (waitMs > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, waitMs);
      return;
    }

    const job = this.pending.shift() as Job;
    this.active += 1;
    this.lastStartAt = Date.now();

    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.active -= 1;
        this.pump();
      });

    this.pump();
  }
}
