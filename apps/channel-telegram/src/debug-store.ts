import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface TelegramDebugEvent {
  timestamp: string;
  level: "info" | "warn" | "error";
  event: string;
  updateId?: number;
  chatId?: number;
  detail?: string;
}

export interface TelegramDebugSnapshot {
  generatedAt: string;
  transportMode: "polling" | "webhook";
  outboundBackend: "memory" | "postgres";
  running: boolean;
  startedAt?: string;
  stoppedAt?: string;
  lastUpdateId?: number;
  stats: {
    received: number;
    replied: number;
    failed: number;
    blocked: number;
    retries: number;
  };
  outbound: {
    queueDepth: number;
    processing: number;
    retryDepth: number;
    deadLetterDepth: number;
  };
  recentEvents: TelegramDebugEvent[];
}

export class TelegramDebugStore {
  private snapshot: TelegramDebugSnapshot;
  private readonly filePath: string;
  private readonly maxEvents: number;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(params: {
    filePath: string;
    maxEvents: number;
    transportMode: "polling" | "webhook";
    outboundBackend: "memory" | "postgres";
  }) {
    this.filePath = params.filePath;
    this.maxEvents = params.maxEvents;
    this.snapshot = {
      generatedAt: new Date().toISOString(),
      transportMode: params.transportMode,
      outboundBackend: params.outboundBackend,
      running: false,
      stats: {
        received: 0,
        replied: 0,
        failed: 0,
        blocked: 0,
        retries: 0,
      },
      outbound: {
        queueDepth: 0,
        processing: 0,
        retryDepth: 0,
        deadLetterDepth: 0,
      },
      recentEvents: [],
    };
  }

  public async noteStart(): Promise<void> {
    this.snapshot.running = true;
    this.snapshot.startedAt = new Date().toISOString();
    delete this.snapshot.stoppedAt;
    await this.flush();
  }

  public async noteStop(): Promise<void> {
    this.snapshot.running = false;
    this.snapshot.stoppedAt = new Date().toISOString();
    await this.flush();
  }

  public async noteEvent(event: TelegramDebugEvent): Promise<void> {
    this.snapshot.generatedAt = new Date().toISOString();
    if (event.updateId !== undefined) {
      this.snapshot.lastUpdateId = event.updateId;
    }
    this.snapshot.recentEvents = [event, ...this.snapshot.recentEvents].slice(0, this.maxEvents);
    await this.flush();
  }

  public async increment(
    metric: "received" | "replied" | "failed" | "blocked" | "retries",
  ): Promise<void> {
    this.snapshot.stats[metric] += 1;
    this.snapshot.generatedAt = new Date().toISOString();
    await this.flush();
  }

  public async setQueueDepth(depth: number): Promise<void> {
    this.snapshot.outbound.queueDepth = Math.max(0, depth);
    this.snapshot.generatedAt = new Date().toISOString();
    await this.flush();
  }

  public async setOutboundStats(stats: {
    queueDepth: number;
    processing: number;
    retryDepth: number;
    deadLetterDepth: number;
  }): Promise<void> {
    this.snapshot.outbound.queueDepth = Math.max(0, stats.queueDepth);
    this.snapshot.outbound.processing = Math.max(0, stats.processing);
    this.snapshot.outbound.retryDepth = Math.max(0, stats.retryDepth);
    this.snapshot.outbound.deadLetterDepth = Math.max(0, stats.deadLetterDepth);
    this.snapshot.generatedAt = new Date().toISOString();
    await this.flush();
  }

  private async flush(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const dir = dirname(this.filePath);
      await mkdir(dir, { recursive: true });
      const tmpFile = `${this.filePath}.tmp`;
      await writeFile(tmpFile, JSON.stringify(this.snapshot, null, 2), "utf8");
      await rename(tmpFile, this.filePath);
    });
    await this.writeChain;
  }
}
