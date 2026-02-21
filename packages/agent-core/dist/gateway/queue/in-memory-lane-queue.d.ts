import { type DeadLetterTask, type EnqueueLaneTaskOptions, type EnqueueLaneTaskResult, type LaneQueueOptions, type LaneQueueSnapshot, type LaneQueueStateListener } from "./types.js";
type TaskHandler<T> = () => Promise<T>;
export declare class InMemoryLaneQueue {
    private readonly maxGlobalConcurrency;
    private readonly defaultLaneConcurrency;
    private readonly laneConcurrency;
    private readonly defaultRetryMaxAttempts;
    private readonly defaultRetryBackoffMs;
    private readonly lanes;
    private readonly deadLetters;
    private readonly listeners;
    private activeTotal;
    private laneRoundRobinIndex;
    private sequenceCounter;
    constructor(options?: LaneQueueOptions);
    subscribe(listener: LaneQueueStateListener): () => void;
    enqueue<T>(options: EnqueueLaneTaskOptions, handler: TaskHandler<T>): EnqueueLaneTaskResult<T>;
    getSnapshot(): LaneQueueSnapshot;
    listDeadLetters(): DeadLetterTask[];
    private getOrCreateLane;
    private laneLimit;
    private emitSnapshot;
    private pump;
    private findNextRunnableLane;
    private executeTask;
    private completeTask;
}
export {};
//# sourceMappingURL=in-memory-lane-queue.d.ts.map