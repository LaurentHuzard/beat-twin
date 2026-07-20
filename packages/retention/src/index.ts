export type RetentionClock = { readonly now: () => number };

export type RetentionPolicy = {
  readonly capacity: number;
  readonly ttlMs: number;
};

export type RetentionEntry<Value> = {
  readonly value: Value;
  readonly storedAt: number;
};

/**
 * Synchronous process-local storage. Implementations must return stored
 * entries without cloning their values so callers can finalize a reserved
 * mutable safety record. This interface does not imply restart durability.
 */
export interface RetentionStore<Key, Value> {
  readonly size: number;
  has(key: Key): boolean;
  get(key: Key): RetentionEntry<Value> | undefined;
  set(key: Key, entry: RetentionEntry<Value>): void;
  delete(key: Key): boolean;
  entries(): IterableIterator<[Key, RetentionEntry<Value>]>;
}

export class MemoryRetentionStore<Key, Value> implements RetentionStore<Key, Value> {
  readonly #entries = new Map<Key, RetentionEntry<Value>>();

  get size(): number {
    return this.#entries.size;
  }

  has(key: Key): boolean {
    return this.#entries.has(key);
  }

  get(key: Key): RetentionEntry<Value> | undefined {
    return this.#entries.get(key);
  }

  set(key: Key, entry: RetentionEntry<Value>): void {
    this.#entries.set(key, entry);
  }

  delete(key: Key): boolean {
    return this.#entries.delete(key);
  }

  entries(): IterableIterator<[Key, RetentionEntry<Value>]> {
    return this.#entries.entries();
  }
}

export class RetentionCapacityError extends Error {
  readonly registry: string;
  readonly capacity: number;

  constructor(registry: string, capacity: number) {
    super(`${registry} retention capacity ${capacity} is exhausted`);
    this.name = "RetentionCapacityError";
    this.registry = registry;
    this.capacity = capacity;
  }
}

export type BoundedRetentionMapOptions<Key, Value> = {
  readonly name: string;
  readonly policy: RetentionPolicy;
  readonly clock?: RetentionClock;
  readonly store?: RetentionStore<Key, Value>;
  readonly expiresAt?: (value: Value, key: Key, storedAt: number) => number;
  readonly canEvict?: (value: Value, key: Key, now: number) => boolean;
};

/**
 * A synchronous process-lifetime registry with deterministic lazy cleanup.
 * Capacity is checked before callers begin work. Entries are removed only
 * after their retention boundary and only when the caller marks them safe.
 */
export class BoundedRetentionMap<Key, Value> {
  readonly #name: string;
  readonly #policy: RetentionPolicy;
  readonly #clock: RetentionClock;
  readonly #store: RetentionStore<Key, Value>;
  readonly #expiresAt: (value: Value, key: Key, storedAt: number) => number;
  readonly #canEvict: (value: Value, key: Key, now: number) => boolean;

  constructor(options: BoundedRetentionMapOptions<Key, Value>) {
    this.#name = requireName(options.name);
    this.#policy = validatePolicy(options.policy);
    this.#clock = options.clock ?? { now: Date.now };
    this.#store = options.store ?? new MemoryRetentionStore<Key, Value>();
    this.#expiresAt = options.expiresAt ?? ((_value, _key, storedAt) =>
      storedAt + this.#policy.ttlMs);
    this.#canEvict = options.canEvict ?? (() => true);
  }

  get size(): number {
    this.cleanup();
    return this.#store.size;
  }

  get capacity(): number {
    return this.#policy.capacity;
  }

  has(key: Key): boolean {
    this.cleanup();
    return this.#store.has(key);
  }

  get(key: Key): Value | undefined {
    this.cleanup();
    return this.#store.get(key)?.value;
  }

  /** Read one exact key without triggering unrelated lazy cleanup. */
  peek(key: Key): Value | undefined {
    return this.#store.get(key)?.value;
  }

  set(key: Key, value: Value): this {
    const existing = this.#store.get(key);
    if (!existing) this.assertCanAdd(key);
    this.#store.set(key, Object.freeze({ value, storedAt: existing?.storedAt ?? this.#clock.now() }));
    return this;
  }

  delete(key: Key): boolean {
    return this.#store.delete(key);
  }

  assertCanAdd(key: Key, reservedEntries = 0): void {
    if (!Number.isInteger(reservedEntries) || reservedEntries < 0) {
      throw new TypeError("reservedEntries must be a non-negative integer");
    }
    this.cleanup();
    if (this.#store.has(key)) return;
    if (this.#store.size + reservedEntries >= this.#policy.capacity) {
      throw new RetentionCapacityError(this.#name, this.#policy.capacity);
    }
  }

  cleanup(): number {
    const now = this.#clock.now();
    let removed = 0;
    for (const [key, entry] of this.#store.entries()) {
      if (
        this.#expiresAt(entry.value, key, entry.storedAt) <= now &&
        this.#canEvict(entry.value, key, now)
      ) {
        if (this.#store.delete(key)) removed += 1;
      }
    }
    return removed;
  }

  entries(): readonly (readonly [Key, Value])[] {
    this.cleanup();
    return Object.freeze(
      [...this.#store.entries()].map(([key, entry]) => Object.freeze([key, entry.value] as const)),
    );
  }
}

function validatePolicy(policy: RetentionPolicy): RetentionPolicy {
  if (!Number.isInteger(policy?.capacity) || policy.capacity < 1) {
    throw new TypeError("retention capacity must be a positive integer");
  }
  if (!Number.isFinite(policy.ttlMs) || policy.ttlMs < 1) {
    throw new TypeError("retention ttlMs must be a positive finite number");
  }
  return Object.freeze({ capacity: policy.capacity, ttlMs: policy.ttlMs });
}

function requireName(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("retention registry name is required");
  }
  return value.trim();
}
