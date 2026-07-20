# ADR-003: Process-Lifetime Retention And Restart Semantics

Status: accepted by GitHub #48

Date: 2026-07-20

## Context

Beat Twin keeps pairing grants, immutable plans, confirmations, execution
reports, adapter idempotency evidence, command request IDs, browser transition
IDs, and readback observations in memory. Those registries protect mutation
boundaries, but previously had no common capacity or cleanup contract. A
long-lived process could therefore grow without limit, while a restart silently
discarded state that some documentation described as durable.

The safe default must remain local and fail closed. Retention pressure must not
cause an external mutation to be retried, and cleanup must not erase evidence
for an active or uncertain execution.

## Decision

### Current state is process-lifetime only

No current registry is restart-durable. The default retention store is process
memory, and the browser performance registry lasts only for the current
performance session. The injected synchronous `RetentionStore` and clock are
ports for deterministic tests and future composition; they do not create a
restart-recovery guarantee.

After a Gateway or browser restart:

- pair again and inspect the browser or DAW again;
- create a new request ID, plan, and confirmation;
- treat an absent prior execution status as unavailable, not as proof that no
  mutation occurred;
- never replay an external mutation automatically.

Restart-durable recovery would require a separate storage design with atomic
claims, schema/version migration, crash consistency, secret handling, and an
adapter-specific reconciliation protocol. It is not part of this decision.

### Registries are bounded and clock-aware

`@beat-twin/retention` supplies an injected `BoundedRetentionMap`, clock, and
store contract. Every registry has an explicit capacity and retention boundary.
Cleanup runs lazily on access or capacity checks; no background timer or new
process lifecycle is introduced.

The default policies are:

| Registry | Capacity | Retention boundary | Eviction rule |
| --- | ---: | --- | --- |
| Command request IDs | 4,096 | 24 hours from first claim | completed only |
| NanoDAW adapter executions | 2,048 | 24 hours from first claim | terminal only; pending and uncertain stay pinned |
| Bitwig adapter executions | 2,048 | 24 hours from first claim | terminal only; pending and uncertain stay pinned |
| Bitwig observations | 1,024 | 15 minutes | expired observations may be evicted |
| Gateway pairings | 1,024 | token expiry, at most 24 hours | expired or revoked records may be evicted; concurrent operations are capped by the same capacity |
| Gateway plans and status | 2,048 | pending plans: plan expiry, at most 2 minutes; completed reports: 24 hours after completion | pending-expired and completed-expired records may be evicted; consumed or uncertain records stay pinned |
| Gateway confirmations | 2,048 | confirmation expiry, at most 30 seconds and never later than the plan | expired confirmations may be evicted |
| NanoDAW MCP reviews | 2,048 | associated plan expiry, at most 2 minutes | expired reviews may be evicted |
| Browser performance transition IDs | 4,096 | performance reset or material replacement | no in-session eviction; the new performance session clears the registry |

The browser WebSocket proxy already bounds each pending request independently
to 32 in-flight operations and a 10-second timeout. Short-lived coordination
sets in Gateway and browser audio orchestration are cleared in `finally`, after
dispatch completion, on emergency stop, or on disposal; parent registry limits
bound the number of related operations.

### Idempotency claims precede mutation

Command and adapter request IDs are reserved before any mutation starts.
Gateway plans, confirmations, pairings, and MCP reviews reserve capacity before
creating their retained state. If retention is full or storage rejects the
claim, the operation fails before mutation.

If retention or readback fails after an external mutation may have been sent,
the result is reported as partial or uncertain. It is pinned for the remainder
of the process and is never retried automatically.

### Capacity exhaustion fails closed

Safe terminal entries may be removed only after their retention boundary. The
runtime does not evict the oldest entry merely to make room. If all capacity is
still occupied, new work receives a stable policy/capacity error before
mutation. This deliberately trades availability for replay safety.

## Consequences

### Positive

- memory growth is bounded during long process and browser sessions;
- tests can advance clocks and inject failing stores without wall-clock waits;
- unsafe pending, consumed, partial, and uncertain outcomes are not silently
  forgotten to admit new work;
- restart behavior is explicit and no status is called durable without durable
  storage.

### Costs

- a process with many pinned uncertain outcomes can stop accepting new work and
  require operator inspection plus restart;
- lazy cleanup means expired entries may remain allocated until the registry is
  accessed;
- a restart loses all pairing, plan, review, idempotency, and status evidence.

### Operational recovery

When a capacity error is returned, inspect current status and resolve the
underlying active or uncertain work. Restarting clears process-memory evidence,
but it must not be used as permission to replay a possibly dispatched external
mutation. Re-inspection and a newly confirmed plan are required.

## Rejected Alternatives

### Unbounded maps

Rejected because long-lived local processes can grow indefinitely and because
the absence of pressure behavior leaves mutation safety undefined.

### Least-recently-used eviction under pressure

Rejected because age or recency does not prove that idempotency or uncertain
execution evidence is safe to forget.

### Immediate database persistence

Rejected for this slice. A database alone would not define atomic claim,
reconciliation, migration, or secret semantics, and would falsely imply
restart-safe execution before those contracts exist.
