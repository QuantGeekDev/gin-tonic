import {} from "./types.js";
const PRIORITY_WEIGHT = {
    interactive: 0,
    automation: 1,
    background: 2,
};
const DEFAULT_MAX_GLOBAL_CONCURRENCY = 4;
const DEFAULT_LANE_CONCURRENCY = 1;
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BACKOFF_MS = 500;
const DEFAULT_DEAD_LETTER_RETENTION = 200;
function nowIso() {
    return new Date().toISOString();
}
function toErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function normalizeConcurrency(value, fallback) {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.floor(value);
}
export class InMemoryLaneQueue {
    maxGlobalConcurrency;
    defaultLaneConcurrency;
    laneConcurrency;
    defaultRetryMaxAttempts;
    defaultRetryBackoffMs;
    lanes = new Map();
    deadLetters = [];
    listeners = new Set();
    activeTotal = 0;
    laneRoundRobinIndex = 0;
    sequenceCounter = 0;
    constructor(options = {}) {
        this.maxGlobalConcurrency = normalizeConcurrency(options.maxGlobalConcurrency, DEFAULT_MAX_GLOBAL_CONCURRENCY);
        this.defaultLaneConcurrency = normalizeConcurrency(options.defaultLaneConcurrency, DEFAULT_LANE_CONCURRENCY);
        this.laneConcurrency = Object.fromEntries(Object.entries(options.laneConcurrency ?? {}).map(([lane, value]) => [
            lane,
            normalizeConcurrency(value, this.defaultLaneConcurrency),
        ]));
        this.defaultRetryMaxAttempts = normalizeConcurrency(options.defaultRetry?.maxAttempts, DEFAULT_RETRY_MAX_ATTEMPTS);
        this.defaultRetryBackoffMs =
            options.defaultRetry?.backoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.getSnapshot());
        return () => {
            this.listeners.delete(listener);
        };
    }
    enqueue(options, handler) {
        const taskId = options.id?.trim() || `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const lane = options.lane.trim();
        if (lane.length === 0) {
            throw new Error("lane must be a non-empty string");
        }
        const priority = options.priority ?? "interactive";
        const maxAttempts = normalizeConcurrency(options.retry?.maxAttempts, this.defaultRetryMaxAttempts);
        const backoffMs = options.retry?.backoffMs ?? this.defaultRetryBackoffMs;
        let resolve;
        let reject;
        const result = new Promise((innerResolve, innerReject) => {
            resolve = innerResolve;
            reject = innerReject;
        });
        const task = {
            id: taskId,
            lane,
            priority,
            priorityWeight: PRIORITY_WEIGHT[priority],
            sequence: this.sequenceCounter,
            attempts: 0,
            maxAttempts,
            backoffMs,
            ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
            handler,
            resolve,
            reject,
        };
        this.sequenceCounter += 1;
        const laneState = this.getOrCreateLane(lane);
        laneState.pending.push(task);
        laneState.pending.sort((left, right) => {
            if (left.priorityWeight !== right.priorityWeight) {
                return left.priorityWeight - right.priorityWeight;
            }
            return left.sequence - right.sequence;
        });
        this.emitSnapshot();
        this.pump();
        return {
            taskId,
            result,
        };
    }
    getSnapshot() {
        const lanes = [];
        let queued = 0;
        for (const [lane, state] of this.lanes.entries()) {
            if (state.pending.length === 0 && state.active === 0) {
                continue;
            }
            lanes.push({
                lane,
                queued: state.pending.length,
                active: state.active,
            });
            queued += state.pending.length;
        }
        lanes.sort((a, b) => a.lane.localeCompare(b.lane));
        return {
            queued,
            active: this.activeTotal,
            lanes,
        };
    }
    listDeadLetters() {
        return [...this.deadLetters];
    }
    getOrCreateLane(lane) {
        const existing = this.lanes.get(lane);
        if (existing !== undefined) {
            return existing;
        }
        const created = {
            active: 0,
            pending: [],
        };
        this.lanes.set(lane, created);
        return created;
    }
    laneLimit(lane) {
        return this.laneConcurrency[lane] ?? this.defaultLaneConcurrency;
    }
    emitSnapshot() {
        if (this.listeners.size === 0) {
            return;
        }
        const snapshot = this.getSnapshot();
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }
    pump() {
        while (this.activeTotal < this.maxGlobalConcurrency) {
            const lane = this.findNextRunnableLane();
            if (lane === null) {
                return;
            }
            const laneState = this.lanes.get(lane);
            if (!laneState || laneState.pending.length === 0) {
                return;
            }
            const task = laneState.pending.shift();
            if (!task) {
                return;
            }
            laneState.active += 1;
            this.activeTotal += 1;
            this.emitSnapshot();
            void this.executeTask(task);
        }
    }
    findNextRunnableLane() {
        const candidates = [...this.lanes.keys()].sort((left, right) => left.localeCompare(right));
        if (candidates.length === 0) {
            return null;
        }
        for (let offset = 0; offset < candidates.length; offset += 1) {
            const index = (this.laneRoundRobinIndex + offset) % candidates.length;
            const lane = candidates[index];
            if (!lane) {
                continue;
            }
            const state = this.lanes.get(lane);
            if (!state || state.pending.length === 0) {
                continue;
            }
            if (state.active >= this.laneLimit(lane)) {
                continue;
            }
            this.laneRoundRobinIndex = (index + 1) % candidates.length;
            return lane;
        }
        return null;
    }
    async executeTask(task) {
        task.attempts += 1;
        try {
            const value = await task.handler();
            task.resolve(value);
            this.completeTask(task.lane);
        }
        catch (error) {
            if (task.attempts < task.maxAttempts) {
                this.completeTask(task.lane);
                const delay = typeof task.backoffMs === "function"
                    ? task.backoffMs(task.attempts)
                    : task.backoffMs;
                const normalizedDelay = Math.max(0, Math.floor(delay));
                setTimeout(() => {
                    const laneState = this.getOrCreateLane(task.lane);
                    laneState.pending.push(task);
                    laneState.pending.sort((left, right) => {
                        if (left.priorityWeight !== right.priorityWeight) {
                            return left.priorityWeight - right.priorityWeight;
                        }
                        return left.sequence - right.sequence;
                    });
                    this.emitSnapshot();
                    this.pump();
                }, normalizedDelay);
                return;
            }
            task.reject(error);
            this.deadLetters.unshift({
                id: task.id,
                lane: task.lane,
                priority: task.priority,
                attempts: task.attempts,
                error: toErrorMessage(error),
                failedAt: nowIso(),
                ...(task.metadata !== undefined ? { metadata: task.metadata } : {}),
            });
            if (this.deadLetters.length > DEFAULT_DEAD_LETTER_RETENTION) {
                this.deadLetters.length = DEFAULT_DEAD_LETTER_RETENTION;
            }
            this.completeTask(task.lane);
        }
    }
    completeTask(lane) {
        const laneState = this.lanes.get(lane);
        if (laneState) {
            laneState.active = Math.max(0, laneState.active - 1);
            if (laneState.active === 0 && laneState.pending.length === 0) {
                this.lanes.delete(lane);
            }
        }
        this.activeTotal = Math.max(0, this.activeTotal - 1);
        this.emitSnapshot();
        this.pump();
    }
}
//# sourceMappingURL=in-memory-lane-queue.js.map