import assert from "node:assert/strict";
import test from "node:test";

import {
  BoundedRetentionMap,
  MemoryRetentionStore,
  RetentionCapacityError,
  type RetentionEntry,
} from "../src/index.ts";

test("retains entries through the full TTL and lazily removes them afterwards", () => {
  let now = 0;
  const registry = new BoundedRetentionMap<string, string>({
    name: "test",
    policy: { capacity: 2, ttlMs: 100 },
    clock: { now: () => now },
  });
  registry.set("one", "value");
  now = 99;
  assert.equal(registry.get("one"), "value");
  now = 100;
  assert.equal(registry.get("one"), undefined);
  assert.equal(registry.size, 0);
});

test("fails closed at capacity before the minimum retention boundary", () => {
  const registry = new BoundedRetentionMap<string, string>({
    name: "idempotency",
    policy: { capacity: 1, ttlMs: 100 },
    clock: { now: () => 0 },
  });
  registry.set("one", "value");
  assert.throws(() => registry.assertCanAdd("two"), RetentionCapacityError);
  assert.equal(registry.size, 1);
});

test("pinned uncertain entries survive expiry and keep capacity fail-closed", () => {
  let now = 0;
  const registry = new BoundedRetentionMap<string, { state: string }>({
    name: "executions",
    policy: { capacity: 1, ttlMs: 10 },
    clock: { now: () => now },
    canEvict: (value) => value.state !== "uncertain",
  });
  registry.set("unknown", { state: "uncertain" });
  now = 1_000;
  assert.equal(registry.get("unknown")?.state, "uncertain");
  assert.throws(() => registry.assertCanAdd("next"), RetentionCapacityError);
});

test("injected storage errors surface synchronously before callers mutate", () => {
  class FailingStore extends MemoryRetentionStore<string, string> {
    override set(_key: string, _entry: RetentionEntry<string>): void {
      throw new Error("storage unavailable");
    }
  }
  const registry = new BoundedRetentionMap<string, string>({
    name: "injected",
    policy: { capacity: 1, ttlMs: 10 },
    store: new FailingStore(),
  });
  assert.throws(() => registry.set("one", "value"), /storage unavailable/);
});

test("long synthetic sessions remain bounded across cleanup windows", () => {
  let now = 0;
  const registry = new BoundedRetentionMap<number, number>({
    name: "long-session",
    policy: { capacity: 8, ttlMs: 1 },
    clock: { now: () => now },
  });
  for (let index = 0; index < 10_000; index += 1) {
    if (index > 0 && index % 8 === 0) now += 1;
    registry.set(index, index);
    assert.ok(registry.size <= 8);
  }
  assert.equal(registry.size, 8);
});
