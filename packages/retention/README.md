# `@beat-twin/retention`

Deterministic, injected, process-lifetime retention primitives for safety and
idempotency registries. Entries have an explicit capacity and minimum TTL.
Cleanup is lazy; capacity pressure throws before new work begins. Callers decide
which states are safe to evict, so pending and uncertain mutations can remain
pinned. Injected stores are synchronous process-local containers and must
preserve stored value identity; the interface does not claim restart durability.
