export interface OutboundQueueTask {
  run: () => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => Promise<void> | void;
}

export interface OutboundQueueOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramOutboundQueue {
  private readonly queue: Array<{
    task: OutboundQueueTask;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private draining = false;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  public constructor(options: OutboundQueueOptions) {
    this.maxAttempts = options.maxAttempts;
    this.baseDelayMs = options.baseDelayMs;
    this.maxDelayMs = options.maxDelayMs ?? 10_000;
  }

  public size(): number {
    return this.queue.length;
  }

  public async enqueue(task: OutboundQueueTask): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      if (!this.draining) {
        void this.drain();
      }
    });
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift();
        if (!entry) {
          continue;
        }
        try {
          await this.runWithRetry(entry.task);
          entry.resolve();
        } catch (error) {
          entry.reject(error);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async runWithRetry(task: OutboundQueueTask): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await task.run();
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxAttempts) {
          break;
        }
        const delayMs = Math.min(
          this.maxDelayMs,
          this.baseDelayMs * Math.pow(2, attempt - 1),
        );
        await task.onRetry?.(attempt + 1, delayMs, error);
        await delay(delayMs);
      }
    }
    throw lastError;
  }
}
