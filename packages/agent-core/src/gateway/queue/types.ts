export type QueuePriority = "interactive" | "automation" | "background";

export interface LaneQueueRetryPolicy {
  maxAttempts?: number;
  backoffMs?: number | ((attempt: number) => number);
}

export interface EnqueueLaneTaskOptions {
  id?: string;
  lane: string;
  priority?: QueuePriority;
  retry?: LaneQueueRetryPolicy;
  metadata?: Record<string, unknown>;
}

export interface LaneQueueTaskSnapshot {
  lane: string;
  queued: number;
  active: number;
}

export interface DeadLetterTask {
  id: string;
  lane: string;
  priority: QueuePriority;
  attempts: number;
  error: string;
  failedAt: string;
  metadata?: Record<string, unknown>;
}

export interface LaneQueueSnapshot {
  queued: number;
  active: number;
  lanes: LaneQueueTaskSnapshot[];
}

export interface LaneQueueOptions {
  maxGlobalConcurrency?: number;
  defaultLaneConcurrency?: number;
  laneConcurrency?: Record<string, number>;
  defaultRetry?: Required<LaneQueueRetryPolicy>;
}

export interface LaneQueueStateListener {
  (snapshot: LaneQueueSnapshot): void;
}

export interface EnqueueLaneTaskResult<T> {
  taskId: string;
  result: Promise<T>;
}
