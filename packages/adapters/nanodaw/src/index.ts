import {
  createCommandState,
  executeCommandBatch,
  type CommandBatchResult,
  type CommandRuntime,
  type CommandSnapshot,
  type ExecuteCommandBatchRequest,
} from "@beat-twin/commands";
import {
  preflightExecutablePlan,
  validateDawSnapshot,
  type CommandExecutionResult,
  type DawAdapter,
  type DawCapabilities,
  type DawError,
  type DawHealth,
  type DawSnapshot,
  type ExecutableCommandType,
  type ExecutablePlan,
  type ExecutionReport,
  type ValidationResult,
} from "@beat-twin/daw-contract";

export const NANODAW_CAPABILITY_VERSION = "nanodaw-v1";

export const NANODAW_SUPPORTED_COMMANDS = Object.freeze([
  "CreateSong",
  "CreateTrack",
  "CreateClip",
  "AddNote",
  "UpdateNote",
  "RemoveNote",
  "DuplicateClip",
  "QuantizeClip",
  "TransposeClip",
  "SetTempo",
  "StartPlayback",
  "StopPlayback",
  "SetPlayhead",
] as const satisfies readonly ExecutableCommandType[]);

export const NANODAW_SCOPES = Object.freeze([
  "song.write",
  "transport.write",
] as const);

type Awaitable<T> = T | Promise<T>;

/**
 * The adapter's only state boundary. A browser implementation must proxy these
 * calls to the browser-owned CommandRuntime instead of mirroring song state in
 * the gateway.
 */
export interface NanoDawPort {
  inspect(): Awaitable<CommandSnapshot>;
  executeCommandBatch(request: ExecuteCommandBatchRequest): Awaitable<CommandBatchResult>;
}

/**
 * Abstract contract for the authenticated browser-session proxy implemented by
 * the gateway slice. No transport or WebSocket server is created here.
 */
export interface BrowserNanoDawPort extends NanoDawPort {
  readonly kind: "browser-proxy";
}

/** In-process port for conformance tests and non-browser integration tests. */
export class MemoryNanoDawPort implements NanoDawPort {
  readonly kind = "memory" as const;
  readonly #runtime: CommandRuntime;
  #batchExecutionCount = 0;

  constructor(runtime: CommandRuntime) {
    this.#runtime = runtime;
  }

  get batchExecutionCount(): number {
    return this.#batchExecutionCount;
  }

  inspect(): CommandSnapshot {
    return this.#runtime.inspect();
  }

  executeCommandBatch(request: ExecuteCommandBatchRequest): CommandBatchResult {
    this.#batchExecutionCount += 1;
    return this.#runtime.executeCommandBatch(request);
  }
}

export type NanoDawAdapterOptions = {
  readonly port: NanoDawPort;
  readonly verifyDigest: (plan: ExecutablePlan) => boolean;
  readonly now?: () => number;
};

type RequestExecution = {
  readonly planIdentity: string;
  readonly report: Promise<ExecutionReport>;
};

const CAPABILITIES: DawCapabilities = Object.freeze({
  adapterId: "nanodaw",
  capabilityVersion: NANODAW_CAPABILITY_VERSION,
  supportedCommands: NANODAW_SUPPORTED_COMMANDS,
  scopes: NANODAW_SCOPES,
  limitations: Object.freeze([
    "Browser session is the sole owner of NanoDAW song state",
    "Execution requires one atomic command batch",
  ]),
});

export class NanoDawAdapter implements DawAdapter {
  readonly id = "nanodaw" as const;
  readonly #port: NanoDawPort;
  readonly #verifyDigest: (plan: ExecutablePlan) => boolean;
  readonly #now: () => number;
  readonly #requests = new Map<string, RequestExecution>();

  constructor(options: NanoDawAdapterOptions) {
    this.#port = options.port;
    this.#verifyDigest = options.verifyDigest;
    this.#now = options.now ?? Date.now;
  }

  async health(): Promise<DawHealth> {
    const checkedAt = this.#timestamp();
    try {
      const commandSnapshot = await this.#port.inspect();
      const snapshot = this.#snapshot(commandSnapshot, checkedAt);
      const validation = validateDawSnapshot(
        snapshot,
        this.id,
        NANODAW_CAPABILITY_VERSION,
      );
      if (!validation.ok) {
        return Object.freeze({
          adapterId: this.id,
          status: "degraded",
          checkedAt,
          detail: validation.error.message,
        });
      }
      return Object.freeze({ adapterId: this.id, status: "healthy", checkedAt });
    } catch (error) {
      return Object.freeze({
        adapterId: this.id,
        status: "unavailable",
        checkedAt,
        detail: errorMessage(error),
      });
    }
  }

  async capabilities(): Promise<DawCapabilities> {
    return CAPABILITIES;
  }

  async inspect(): Promise<DawSnapshot> {
    const commandSnapshot = await this.#port.inspect();
    return this.#snapshot(commandSnapshot, this.#timestamp());
  }

  async execute(plan: ExecutablePlan): Promise<ExecutionReport> {
    const planIdentity = stableSerialize(plan);
    const existing = this.#requests.get(plan.requestId);
    if (existing) {
      if (existing.planIdentity === planIdentity) {
        return existing.report;
      }

      const snapshot = await this.inspect();
      return rejectedReport(
        plan,
        snapshot.commandSnapshot,
        this.#timestamp(),
        dawError(
          "invalid_command",
          `requestId ${plan.requestId} is already bound to a different plan`,
        ),
      );
    }

    const report = this.#executeOnce(plan);
    this.#requests.set(
      plan.requestId,
      Object.freeze({ planIdentity, report }),
    );
    return report;
  }

  async #executeOnce(plan: ExecutablePlan): Promise<ExecutionReport> {
    const startedAt = this.#timestamp();
    const snapshot = await this.inspect();
    const preflight = this.#preflight(plan, snapshot);
    if (!preflight.ok) {
      return rejectedReport(
        plan,
        snapshot.commandSnapshot,
        startedAt,
        preflight.error,
        this.#timestamp(),
      );
    }

    const scopeValidation = validateRequiredCommandScopes(plan);
    if (!scopeValidation.ok) {
      return rejectedReport(
        plan,
        snapshot.commandSnapshot,
        startedAt,
        scopeValidation.error,
        this.#timestamp(),
      );
    }

    let batch: CommandBatchResult;
    try {
      // This is deliberately the adapter's only mutating port call.
      batch = await this.#port.executeCommandBatch({
        requestId: plan.requestId,
        expectedRevision: plan.baseRevision,
        commands: plan.commands,
      });
    } catch (error) {
      const uncertain = dawError(
        "partial_execution",
        `NanoDAW port failed after dispatch; mutation state is unknown: ${errorMessage(error)}`,
      );
      return uncertainReport(
        plan,
        snapshot.commandSnapshot,
        startedAt,
        this.#timestamp(),
        uncertain,
      );
    }

    const completedAt = this.#timestamp();
    try {
      if (!batch.ok) {
        const readback = await this.#port.inspect();
        const failureConsistencyError = validateFailedBatch(plan, batch, readback);
        if (
          failureConsistencyError ||
          stableSerialize(readback) !== stableSerialize(snapshot.commandSnapshot)
        ) {
          const error = dawError(
            "partial_execution",
            failureConsistencyError ??
              "NanoDAW rejected the batch but readback changed; mutation state is uncertain",
          );
          return uncertainReport(plan, readback, startedAt, completedAt, error);
        }
        return rejectedReport(
          plan,
          readback,
          startedAt,
          dawError(batch.errorCode, batch.error),
          completedAt,
        );
      }

      const consistencyError = validateSuccessfulBatch(plan, batch, snapshot.commandSnapshot);
      const readback = await this.#port.inspect();
      if (consistencyError || stableSerialize(readback) !== stableSerialize(batch.snapshot)) {
        const error = dawError(
          "partial_execution",
          consistencyError ?? "NanoDAW readback does not match the reported batch snapshot",
        );
        return uncertainReport(plan, readback, startedAt, completedAt, error);
      }
      return reportFromBatch(plan, batch, startedAt, completedAt);
    } catch (error) {
      const uncertain = dawError(
        "partial_execution",
        `NanoDAW result validation failed after dispatch: ${errorMessage(error)}`,
      );
      return uncertainReport(
        plan,
        snapshot.commandSnapshot,
        startedAt,
        completedAt,
        uncertain,
      );
    }
  }

  #preflight(plan: ExecutablePlan, snapshot: DawSnapshot): ValidationResult {
    try {
      return preflightExecutablePlan(plan, {
        adapterId: this.id,
        capabilities: CAPABILITIES,
        snapshot,
        now: this.#now(),
        verifyDigest: this.#verifyDigest,
      });
    } catch (error) {
      return Object.freeze({
        ok: false,
        error: dawError(
          "invalid_command",
          `plan digest verification failed: ${errorMessage(error)}`,
        ),
      });
    }
  }

  #snapshot(commandSnapshot: CommandSnapshot, observedAt: string): DawSnapshot {
    return Object.freeze({
      adapterId: this.id,
      capabilityVersion: NANODAW_CAPABILITY_VERSION,
      observedAt,
      commandSnapshot,
    });
  }

  #timestamp(): string {
    return new Date(this.#now()).toISOString();
  }
}

function validateRequiredCommandScopes(plan: ExecutablePlan): ValidationResult {
  const declared = new Set(plan.requiredScopes);
  for (const [commandIndex, command] of plan.commands.entries()) {
    const requiredScope = isTransportCommand(command.type)
      ? "transport.write"
      : "song.write";
    if (!declared.has(requiredScope)) {
      return Object.freeze({
        ok: false,
        error: dawError(
          "policy_blocked",
          `command ${command.type} requires scope ${requiredScope}`,
          commandIndex,
        ),
      });
    }
  }
  return Object.freeze({ ok: true });
}

function isTransportCommand(type: ExecutableCommandType): boolean {
  return type === "StartPlayback" || type === "StopPlayback" || type === "SetPlayhead";
}

function rejectedReport(
  plan: ExecutablePlan,
  finalSnapshot: CommandSnapshot,
  startedAt: string,
  error: DawError,
  completedAt = startedAt,
): ExecutionReport {
  return Object.freeze({
    ok: false,
    status: "failed",
    adapterId: plan.adapterId,
    planId: plan.planId,
    requestId: plan.requestId,
    baseRevision: plan.baseRevision,
    finalSnapshot,
    startedAt,
    completedAt,
    results: Object.freeze(
      plan.commands.map((command, index) =>
        Object.freeze({
          index,
          command,
          status: "not_attempted" as const,
          error,
        }),
      ),
    ),
    error,
  });
}

function uncertainReport(
  plan: ExecutablePlan,
  finalSnapshot: CommandSnapshot,
  startedAt: string,
  completedAt: string,
  error: DawError,
): ExecutionReport {
  return Object.freeze({
    ok: false,
    status: "partial",
    adapterId: plan.adapterId,
    planId: plan.planId,
    requestId: plan.requestId,
    baseRevision: plan.baseRevision,
    finalSnapshot,
    startedAt,
    completedAt,
    results: Object.freeze(
      plan.commands.map((command, index) =>
        Object.freeze({ index, command, status: "failed" as const, error }),
      ),
    ),
    error,
  });
}

function reportFromBatch(
  plan: ExecutablePlan,
  batch: CommandBatchResult,
  startedAt: string,
  completedAt: string,
): ExecutionReport {
  if (!batch.ok) {
    const error = dawError(batch.errorCode, batch.error);
    return rejectedReport(plan, batch.snapshot, startedAt, error, completedAt);
  }

  if (
    batch.requestId !== plan.requestId ||
    batch.snapshot.revision !== plan.baseRevision + 1 ||
    batch.results.length !== plan.commands.length
  ) {
    const error = dawError(
      "partial_execution",
      "NanoDAW port returned an inconsistent result after dispatch",
    );
    return uncertainReport(plan, batch.snapshot, startedAt, completedAt, error);
  }

  const results: readonly CommandExecutionResult[] = Object.freeze(
    plan.commands.map((command, index) =>
      Object.freeze({ index, command, status: "succeeded" as const }),
    ),
  );
  return Object.freeze({
    ok: true,
    status: "succeeded",
    adapterId: plan.adapterId,
    planId: plan.planId,
    requestId: plan.requestId,
    baseRevision: plan.baseRevision,
    finalSnapshot: batch.snapshot,
    startedAt,
    completedAt,
    results,
  });
}

function validateSuccessfulBatch(
  plan: ExecutablePlan,
  batch: Extract<CommandBatchResult, { readonly ok: true }>,
  initialSnapshot: CommandSnapshot,
): string | null {
  if (
    batch.requestId !== plan.requestId ||
    batch.snapshot.revision !== plan.baseRevision + 1 ||
    batch.state.revision !== batch.snapshot.revision ||
    stableSerialize(batch.state.song) !== stableSerialize(batch.snapshot.song) ||
    stableSerialize(batch.commands) !== stableSerialize(plan.commands) ||
    batch.results.length !== plan.commands.length
  ) {
    return "NanoDAW port returned inconsistent batch identity, revision, commands, or state";
  }

  const projected = executeCommandBatch(
    createCommandState(initialSnapshot.song, initialSnapshot.revision),
    {
      requestId: plan.requestId,
      expectedRevision: plan.baseRevision,
      commands: plan.commands,
    },
  );
  if (!projected.ok) {
    return `NanoDAW plan failed deterministic projection: ${projected.error}`;
  }
  if (
    stableSerialize(batch.snapshot) !== stableSerialize(projected.snapshot) ||
    stableSerialize(batch.commands) !== stableSerialize(projected.commands) ||
    stableSerialize(batch.results) !== stableSerialize(projected.results) ||
    stableSerialize(batch.events) !== stableSerialize(projected.events)
  ) {
    return "NanoDAW port result does not match deterministic command projection";
  }
  return null;
}

function validateFailedBatch(
  plan: ExecutablePlan,
  batch: Extract<CommandBatchResult, { readonly ok: false }>,
  readback: CommandSnapshot,
): string | null {
  const attemptedPrefix = plan.commands.slice(0, batch.commands.length);
  if (
    batch.requestId !== plan.requestId ||
    batch.results.length !== 0 ||
    batch.events.length !== 0 ||
    batch.state.revision !== readback.revision ||
    stableSerialize(batch.state.song) !== stableSerialize(readback.song) ||
    stableSerialize(batch.snapshot) !== stableSerialize(readback) ||
    stableSerialize(batch.commands) !== stableSerialize(attemptedPrefix)
  ) {
    return "NanoDAW rejected batch returned inconsistent identity, diagnostics, state, or snapshot";
  }
  return null;
}

function dawError(
  code: DawError["code"],
  message: string,
  commandIndex?: number,
): DawError {
  return Object.freeze({
    code,
    message,
    ...(commandIndex === undefined ? {} : { commandIndex }),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
