# Jihn Gateway Architecture Plan (Phase 1-7)

This plan establishes Jihn as a gateway-first architecture where CLI/web/channel adapters are clients of a first-class gateway service.

## Architecture Principles

- Single authoritative gateway runtime for session orchestration.
- Versioned protocol boundary for transport independence.
- Backpressure-aware queues with deterministic per-session ordering.
- Event-driven control plane with replay cursors.
- Strict authn/authz + idempotency for side-effecting calls.
- Domain logic remains in `agent-core`; gateway is orchestration and transport.

## Queue System Decision

Primary queue model:

- In-memory lane queue for low-latency interactive turns.
- Lane key: `session:<sessionKey>` ensures single-flight per session.
- Global concurrency cap enforces host-level backpressure.
- Priority classes: `interactive`, `automation`, `background`.
- Retries + dead letter queue on final failure.

This is closer to OpenClaw's queueing model than to external broker-first models.

Durability roadmap:

- Keep interactive turn queue in-process.
- Add durable Postgres outbox/queue for outbound delivery + automation workloads.
- Add Redis/BullMQ only when horizontally scaling gateway workers for the same tenant/state.

## Phase Breakdown

### Phase 1: Protocol and Control Plane Foundations

Implemented:

- Protocol schemas for inbound/outbound frames in `packages/agent-core/src/gateway/protocol/schema.ts`.
- Event bus with sequence and replay cursor in `packages/agent-core/src/gateway/events-bus.ts`.
- Queue abstraction in `packages/agent-core/src/gateway/queue/*`.
- Control plane service with auth/idempotency and method dispatch in `packages/agent-core/src/gateway/control-plane.ts`.

### Phase 2: Queue-Backed Agent Execution

Implemented baseline:

- `agent.run` is executed through lane queue with per-session serialization.
- Start/complete/fail lifecycle events emitted around execution.

Next extension:

- Integrate `handleMessage` end-to-end as default `agent.run` handler.

### Phase 3: Real-Time Event Streaming and Replay

Implemented baseline:

- Event sequencing and replay-from-seq.
- Topic-based filtering at subscription boundary.

Next extension:

- Wire this into WebSocket transport and client subscription state.

### Phase 4: Client Convergence (CLI/Web)

Plan:

- Replace direct runtime invocation in CLI/web with gateway client calls.
- Keep fallback local mode for development behind explicit flag.

### Phase 5: Channel Adapters as Gateway Clients

Plan:

- Move `apps/channel-telegram` to gateway client mode.
- Adapter handles transport specifics; gateway owns orchestration and session state.

### Phase 6: Delivery Reliability and Outbound Queueing

Plan:

- Add per-channel/account outbound queue.
- Retry policies by failure class + DLQ + operator visibility.
- Postgres-backed durable outbox for recovery after restart.

### Phase 7: Operations and Hardening

Plan:

- Gateway daemon package/process supervision.
- Structured metrics, traces, audit logs, rate limiting, and config reload safety.
- HA-readiness boundaries and horizontal scaling policy.

## Test Strategy

Added tests for foundational behavior:

- Lane queue ordering, parallelism, retries, DLQ.
- Event bus sequence/replay/retention.
- Protocol validation.
- Control plane auth, idempotency, queue-backed execution, and event emission.

Future phases should add:

- Transport contract tests (WS frame semantics).
- End-to-end gateway tests with CLI/web/channel clients.
- Failure-injection tests for retries, idempotency conflicts, and recovery.
