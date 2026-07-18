import {
  validateCommandSnapshot,
  type CommandSnapshot,
  type ExecutableBeatTwinCommand,
} from "@beat-twin/commands";

/*
 * Re-export the portable command types without duplicating their runtime
 * validation in this contract layer.
 */
export type {
  CommandSnapshot,
  ExecutableBeatTwinCommand,
} from "@beat-twin/commands";

export type DawAdapterId = "nanodaw" | "bitwig";

export type DawErrorCode =
  | "invalid_command"
  | "stale_revision"
  | "unsupported_capability"
  | "policy_blocked"
  | "partial_execution";

export type DawError = {
  readonly code: DawErrorCode;
  readonly message: string;
  readonly commandIndex?: number;
};

export type DawHealthStatus = "healthy" | "degraded" | "unavailable";

export type DawHealth = {
  readonly adapterId: DawAdapterId;
  readonly status: DawHealthStatus;
  readonly checkedAt: string;
  readonly detail?: string;
};

export type ExecutableCommandType = ExecutableBeatTwinCommand["type"];

export type DawCapabilities = {
  readonly adapterId: DawAdapterId;
  readonly capabilityVersion: string;
  readonly supportedCommands: readonly ExecutableCommandType[];
  readonly scopes: readonly string[];
  readonly limitations: readonly string[];
};

export type DawSnapshot = {
  readonly adapterId: DawAdapterId;
  readonly capabilityVersion: string;
  readonly observedAt: string;
  readonly commandSnapshot: CommandSnapshot;
};

export type ExecutablePlan = {
  readonly planId: string;
  readonly requestId: string;
  readonly adapterId: DawAdapterId;
  readonly capabilityVersion: string;
  readonly baseRevision: number;
  readonly commands: readonly ExecutableBeatTwinCommand[];
  readonly requiredScopes: readonly string[];
  readonly digest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
};

export type CommandExecutionStatus = "succeeded" | "failed" | "not_attempted" | "unknown";

export type CommandExecutionResult = {
  readonly index: number;
  readonly command: ExecutableBeatTwinCommand;
  readonly status: CommandExecutionStatus;
  readonly error?: DawError;
};

type ExecutionReportBase = {
  readonly adapterId: DawAdapterId;
  readonly planId: string;
  readonly requestId: string;
  readonly baseRevision: number;
  readonly finalSnapshot: CommandSnapshot;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly results: readonly CommandExecutionResult[];
};

export type ExecutionReport =
  | (ExecutionReportBase & {
      readonly ok: true;
      readonly status: "succeeded";
    })
  | (ExecutionReportBase & {
      readonly ok: false;
      readonly status: "failed" | "partial";
      readonly error: DawError;
    });

export interface DawAdapter {
  readonly id: DawAdapterId;
  health(): Promise<DawHealth>;
  capabilities(): Promise<DawCapabilities>;
  inspect(): Promise<DawSnapshot>;
  execute(plan: ExecutablePlan): Promise<ExecutionReport>;
}

export type ValidationSuccess = { readonly ok: true };
export type ValidationFailure = { readonly ok: false; readonly error: DawError };
export type ValidationResult = ValidationSuccess | ValidationFailure;

export type PlanPreflightContext = {
  readonly adapterId: DawAdapterId;
  readonly capabilities: DawCapabilities;
  readonly snapshot: DawSnapshot;
  readonly now?: number;
  readonly verifyDigest: (plan: ExecutablePlan) => boolean;
};

const ADAPTER_IDS = new Set<DawAdapterId>(["nanodaw", "bitwig"]);
const HEALTH_STATUSES = new Set<DawHealthStatus>(["healthy", "degraded", "unavailable"]);
const ERROR_CODES = new Set<DawErrorCode>([
  "invalid_command",
  "stale_revision",
  "unsupported_capability",
  "policy_blocked",
  "partial_execution",
]);
const COMMAND_STATUSES = new Set<CommandExecutionStatus>([
  "succeeded",
  "failed",
  "not_attempted",
  "unknown",
]);
const COMMAND_TYPES = new Set<ExecutableCommandType>([
  "CreateSong",
  "CreateTrack",
  "SetTrackInstrument",
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
]);

export function validateDawHealth(value: unknown, adapterId?: DawAdapterId): ValidationResult {
  if (!isRecord(value) || !isAdapterId(value.adapterId)) {
    return invalid("health.adapterId must be nanodaw or bitwig");
  }
  if (!hasExactKeys(value, ["adapterId", "status", "checkedAt"], ["detail"])) {
    return invalid("health contains unknown or missing fields");
  }
  if (adapterId && value.adapterId !== adapterId) {
    return invalid(`health.adapterId must be ${adapterId}`);
  }
  if (typeof value.status !== "string" || !HEALTH_STATUSES.has(value.status as DawHealthStatus)) {
    return invalid("health.status is invalid");
  }
  if (!isIsoDate(value.checkedAt)) {
    return invalid("health.checkedAt must be an ISO date");
  }
  if (value.detail !== undefined && typeof value.detail !== "string") {
    return invalid("health.detail must be a string");
  }
  return VALID;
}

export function validateDawCapabilities(
  value: unknown,
  adapterId?: DawAdapterId,
): ValidationResult {
  if (!isRecord(value) || !isAdapterId(value.adapterId)) {
    return invalid("capabilities.adapterId must be nanodaw or bitwig");
  }
  if (!hasExactKeys(value, [
    "adapterId",
    "capabilityVersion",
    "supportedCommands",
    "scopes",
    "limitations",
  ])) {
    return invalid("capabilities contains unknown or missing fields");
  }
  if (adapterId && value.adapterId !== adapterId) {
    return invalid(`capabilities.adapterId must be ${adapterId}`);
  }
  if (!isNonEmptyString(value.capabilityVersion)) {
    return invalid("capabilities.capabilityVersion must be a non-empty string");
  }
  if (!isUniqueStringArray(value.supportedCommands)) {
    return invalid("capabilities.supportedCommands must contain unique command names");
  }
  if (value.supportedCommands.some((type) => !COMMAND_TYPES.has(type as ExecutableCommandType))) {
    return invalid("capabilities.supportedCommands contains an unknown command");
  }
  if (!isUniqueStringArray(value.scopes)) {
    return invalid("capabilities.scopes must contain unique non-empty strings");
  }
  if (!isUniqueStringArray(value.limitations)) {
    return invalid("capabilities.limitations must contain unique non-empty strings");
  }
  return VALID;
}

export function validateDawSnapshot(
  value: unknown,
  adapterId?: DawAdapterId,
  capabilityVersion?: string,
): ValidationResult {
  if (!isRecord(value) || !isAdapterId(value.adapterId)) {
    return invalid("snapshot.adapterId must be nanodaw or bitwig");
  }
  if (!hasExactKeys(value, ["adapterId", "capabilityVersion", "observedAt", "commandSnapshot"])) {
    return invalid("snapshot contains unknown or missing fields");
  }
  if (adapterId && value.adapterId !== adapterId) {
    return invalid(`snapshot.adapterId must be ${adapterId}`);
  }
  if (!isNonEmptyString(value.capabilityVersion)) {
    return invalid("snapshot.capabilityVersion must be a non-empty string");
  }
  if (capabilityVersion && value.capabilityVersion !== capabilityVersion) {
    return invalid(`snapshot.capabilityVersion must be ${capabilityVersion}`);
  }
  if (!isIsoDate(value.observedAt)) {
    return invalid("snapshot.observedAt must be an ISO date");
  }
  if (!validateCommandSnapshot(value.commandSnapshot)) {
    return invalid("snapshot.commandSnapshot must be a strict CommandSnapshot");
  }
  return VALID;
}

export function preflightExecutablePlan(
  value: unknown,
  context: PlanPreflightContext,
): ValidationResult {
  const capabilitiesValidation = validateDawCapabilities(context.capabilities, context.adapterId);
  if (!capabilitiesValidation.ok) {
    return capabilitiesValidation;
  }
  const snapshotValidation = validateDawSnapshot(
    context.snapshot,
    context.adapterId,
    context.capabilities.capabilityVersion,
  );
  if (!snapshotValidation.ok) {
    return snapshotValidation;
  }
  if (!isRecord(value)) {
    return invalid("plan must be an object");
  }
  if (!isNonEmptyString(value.planId) || !isNonEmptyString(value.requestId)) {
    return invalid("planId and requestId must be non-empty strings");
  }
  if (!isAdapterId(value.adapterId) || value.adapterId !== context.adapterId) {
    return invalid(`plan.adapterId must be ${context.adapterId}`);
  }
  if (
    !isNonEmptyString(value.capabilityVersion) ||
    value.capabilityVersion !== context.capabilities.capabilityVersion
  ) {
    return failure(
      "unsupported_capability",
      "plan capabilityVersion does not match current adapter capabilities",
    );
  }
  if (!isRevision(value.baseRevision)) {
    return invalid("plan.baseRevision must be a non-negative integer");
  }
  if (value.baseRevision !== context.snapshot.commandSnapshot.revision) {
    return failure(
      "stale_revision",
      `plan revision ${value.baseRevision} does not match current revision ${context.snapshot.commandSnapshot.revision}`,
    );
  }
  if (!Array.isArray(value.commands) || value.commands.length === 0) {
    return invalid("plan.commands must be a non-empty array");
  }
  if (!isUniqueStringArray(value.requiredScopes)) {
    return invalid("plan.requiredScopes must contain unique non-empty strings");
  }
  if (!isNonEmptyString(value.digest)) {
    return invalid("plan.digest must be a non-empty string");
  }
  if (!isIsoDate(value.createdAt) || !isIsoDate(value.expiresAt)) {
    return invalid("plan timestamps must be ISO dates");
  }
  const createdAt = Date.parse(value.createdAt);
  const expiresAt = Date.parse(value.expiresAt);
  const now = context.now ?? Date.now();
  if (createdAt >= expiresAt || expiresAt <= now) {
    return invalid("plan is expired or has an invalid validity window");
  }
  if (!context.verifyDigest(value as unknown as ExecutablePlan)) {
    return invalid("plan digest verification failed");
  }

  const supportedCommands = new Set(context.capabilities.supportedCommands);
  for (const [index, command] of value.commands.entries()) {
    const commandValidation = validateExecutableCommand(command, index);
    if (!commandValidation.ok) {
      return commandValidation;
    }
    if (!supportedCommands.has(command.type as ExecutableCommandType)) {
      return failure(
        "unsupported_capability",
        `command ${command.type} is not supported by ${context.adapterId}`,
        index,
      );
    }
  }

  const availableScopes = new Set(context.capabilities.scopes);
  for (const scope of value.requiredScopes) {
    if (!availableScopes.has(scope)) {
      return failure(
        "unsupported_capability",
        `scope ${scope} is not supported by ${context.adapterId}`,
      );
    }
  }
  return VALID;
}

export function validateExecutionReport(
  value: unknown,
  plan: ExecutablePlan,
): ValidationResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return invalid("execution report must be an object with an ok flag");
  }
  const reportKeys = [
    "ok",
    "status",
    "adapterId",
    "planId",
    "requestId",
    "baseRevision",
    "finalSnapshot",
    "startedAt",
    "completedAt",
    "results",
  ];
  if (!hasExactKeys(value, value.ok ? reportKeys : [...reportKeys, "error"])) {
    return invalid("execution report contains unknown or missing fields");
  }
  if (
    value.adapterId !== plan.adapterId ||
    value.planId !== plan.planId ||
    value.requestId !== plan.requestId ||
    value.baseRevision !== plan.baseRevision
  ) {
    return invalid("execution report identity does not match its plan");
  }
  if (!isIsoDate(value.startedAt) || !isIsoDate(value.completedAt)) {
    return invalid("execution report timestamps must be ISO dates");
  }
  if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    return invalid("execution report completedAt cannot precede startedAt");
  }
  if (!validateCommandSnapshot(value.finalSnapshot)) {
    return invalid("execution report finalSnapshot is invalid");
  }
  if (!Array.isArray(value.results) || value.results.length !== plan.commands.length) {
    return invalid("execution report must contain one result per plan command");
  }
  for (const [index, item] of value.results.entries()) {
    if (!isRecord(item) || item.index !== index) {
      return invalid(`execution result ${index} does not match its plan command`);
    }
    if (typeof item.status !== "string" || !COMMAND_STATUSES.has(item.status as CommandExecutionStatus)) {
      return invalid(`execution result ${index} has an invalid status`);
    }
    if (!hasExactKeys(
      item,
      item.status === "succeeded"
        ? ["index", "command", "status"]
        : ["index", "command", "status", "error"],
    )) {
      return invalid(`execution result ${index} contains unknown or missing fields`);
    }
    const commandValidation = validateExecutableCommand(item.command, index);
    if (!commandValidation.ok || stableJson(item.command) !== stableJson(plan.commands[index])) {
      return invalid(`execution result ${index} does not match its plan command`);
    }
    if (item.status === "succeeded" && item.error !== undefined) {
      return invalid(`successful execution result ${index} cannot contain an error`);
    }
    if (item.status !== "succeeded" && !isDawError(item.error)) {
      return invalid(`unsuccessful execution result ${index} must contain a stable error`);
    }
  }
  if (value.ok) {
    if (value.status !== "succeeded" || value.results.some((item) => item.status !== "succeeded")) {
      return invalid("successful execution report must contain only successful results");
    }
    if (value.error !== undefined) {
      return invalid("successful execution report cannot contain an error");
    }
    if (value.finalSnapshot.revision !== plan.baseRevision + 1) {
      return invalid("successful execution report must advance revision exactly once");
    }
  } else {
    if ((value.status !== "failed" && value.status !== "partial") || !isDawError(value.error)) {
      return invalid("failed execution report must contain a stable error");
    }
    if (value.status === "failed" && value.results.some((item) => item.status === "succeeded")) {
      return invalid("failed execution report cannot contain successful commands; use partial");
    }
    if (value.status === "failed" && value.results.some((item) => item.status === "unknown")) {
      return invalid("failed execution report cannot hide unknown command outcomes; use partial");
    }
    if (value.status === "partial" && value.error.code !== "partial_execution") {
      return invalid("partial execution report must use partial_execution");
    }
    if (
      value.status === "partial" &&
      (
        !value.results.some((item) => item.status === "unknown") &&
        (
          !value.results.some((item) => item.status === "succeeded") ||
          !value.results.some((item) => item.status !== "succeeded")
        )
      )
    ) {
      return invalid("partial execution report must mix known outcomes or mark outcomes unknown");
    }
  }
  return VALID;
}

/** Strictly validates the portable command batch before it crosses an adapter boundary. */
export function validateExecutableCommands(value: unknown): ValidationResult {
  if (!Array.isArray(value) || value.length === 0) {
    return invalid("commands must be a non-empty array");
  }
  for (const [index, command] of value.entries()) {
    const validation = validateExecutableCommand(command, index);
    if (!validation.ok) return validation;
  }
  return VALID;
}

export type DawAdapterConformanceInput = {
  readonly createAdapter: () => DawAdapter | Promise<DawAdapter>;
  readonly createValidPlan: (
    snapshot: DawSnapshot,
    capabilities: DawCapabilities,
  ) => ExecutablePlan | Promise<ExecutablePlan>;
  readonly createStalePlan: (
    snapshot: DawSnapshot,
    capabilities: DawCapabilities,
  ) => ExecutablePlan | Promise<ExecutablePlan>;
  readonly createUnsupportedPlan: (
    snapshot: DawSnapshot,
    capabilities: DawCapabilities,
  ) => ExecutablePlan | Promise<ExecutablePlan>;
};

export type DawAdapterConformanceResult = {
  readonly health: DawHealth;
  readonly capabilities: DawCapabilities;
  readonly initialSnapshot: DawSnapshot;
  readonly staleReport: ExecutionReport;
  readonly unsupportedReport: ExecutionReport;
  readonly executionReport: ExecutionReport;
  readonly idempotentReport: ExecutionReport;
  readonly finalSnapshot: DawSnapshot;
};

export async function runDawAdapterConformance(
  input: DawAdapterConformanceInput,
): Promise<DawAdapterConformanceResult> {
  const adapter = await input.createAdapter();
  requireConformance(isAdapterId(adapter.id), "adapter id must be nanodaw or bitwig");

  const health = await adapter.health();
  requireValid(validateDawHealth(health, adapter.id), "health");

  const capabilities = await adapter.capabilities();
  requireValid(validateDawCapabilities(capabilities, adapter.id), "capabilities");

  const initialSnapshot = await adapter.inspect();
  requireValid(
    validateDawSnapshot(initialSnapshot, adapter.id, capabilities.capabilityVersion),
    "initial snapshot",
  );

  const stalePlan = await input.createStalePlan(initialSnapshot, capabilities);
  const staleReport = await adapter.execute(stalePlan);
  requireValid(validateExecutionReport(staleReport, stalePlan), "stale report");
  requireConformance(
    !staleReport.ok && staleReport.error.code === "stale_revision",
    "stale plan must fail with stale_revision",
  );
  requireConformance(
    staleReport.results.every((result) => result.status === "not_attempted"),
    "stale plan must reject every command before mutation",
  );
  const afterStale = await adapter.inspect();
  requireConformance(
    afterStale.commandSnapshot.revision === initialSnapshot.commandSnapshot.revision,
    "stale plan must not mutate adapter revision",
  );

  const unsupportedPlan = await input.createUnsupportedPlan(afterStale, capabilities);
  const unsupportedReport = await adapter.execute(unsupportedPlan);
  requireValid(validateExecutionReport(unsupportedReport, unsupportedPlan), "unsupported report");
  requireConformance(
    !unsupportedReport.ok && unsupportedReport.error.code === "unsupported_capability",
    "unsupported plan must fail with unsupported_capability",
  );
  requireConformance(
    unsupportedReport.results.every((result) => result.status === "not_attempted"),
    "unsupported preflight must reject every command before mutation",
  );
  const afterUnsupported = await adapter.inspect();
  requireConformance(
    afterUnsupported.commandSnapshot.revision === initialSnapshot.commandSnapshot.revision,
    "unsupported plan must be atomic and preserve revision",
  );

  const validPlan = await input.createValidPlan(afterUnsupported, capabilities);
  const executionReport = await adapter.execute(validPlan);
  requireValid(validateExecutionReport(executionReport, validPlan), "execution report");
  requireConformance(executionReport.ok, "valid plan must succeed");
  requireConformance(
    executionReport.finalSnapshot.revision === initialSnapshot.commandSnapshot.revision + 1,
    "successful plan must advance adapter revision exactly once",
  );

  const idempotentReport = await adapter.execute(validPlan);
  requireValid(validateExecutionReport(idempotentReport, validPlan), "idempotent report");
  requireConformance(
    stableJson(idempotentReport) === stableJson(executionReport),
    "replaying the same request must return the cached execution report",
  );

  const finalSnapshot = await adapter.inspect();
  requireConformance(
    finalSnapshot.commandSnapshot.revision === executionReport.finalSnapshot.revision,
    "idempotent replay must not advance adapter revision",
  );

  return Object.freeze({
    health,
    capabilities,
    initialSnapshot,
    staleReport,
    unsupportedReport,
    executionReport,
    idempotentReport,
    finalSnapshot,
  });
}

function validateExecutableCommand(value: unknown, index: number): ValidationResult {
  if (!isRecord(value) || typeof value.type !== "string" || !COMMAND_TYPES.has(value.type as ExecutableCommandType)) {
    return failure("invalid_command", `command ${index} has an unknown type`, index);
  }
  const command = value as Record<string, unknown> & { type: ExecutableCommandType };
  const fail = (message: string) => failure("invalid_command", `command ${index} ${message}`, index);
  const requireKeys = (keys: readonly string[]) => {
    const allowed = new Set(["type", ...keys]);
    const unknown = Object.keys(command).find((key) => !allowed.has(key));
    return unknown ? fail(`contains unknown field ${unknown}`) : VALID;
  };
  const id = (key: string) => isNonEmptyString(command[key]);
  const optionalString = (key: string) => command[key] === undefined || isNonEmptyString(command[key]);
  const finite = (key: string) => typeof command[key] === "number" && Number.isFinite(command[key]);
  const optionalFinite = (key: string) => command[key] === undefined || finite(key);
  const nonNegative = (key: string) => finite(key) && (command[key] as number) >= 0;
  const optionalNonNegative = (key: string) => command[key] === undefined || nonNegative(key);
  const positive = (key: string) => finite(key) && (command[key] as number) > 0;
  const optionalPositive = (key: string) => command[key] === undefined || positive(key);
  const midi = (key: string, minimum = 0) =>
    Number.isInteger(command[key]) && (command[key] as number) >= minimum && (command[key] as number) <= 127;

  let keys: readonly string[];
  let valid = true;
  switch (command.type) {
    case "CreateSong":
      keys = ["id", "title", "bpm"];
      valid = id("id") && optionalString("title") && optionalPositive("bpm");
      break;
    case "CreateTrack":
      keys = ["id", "name", "kind", "instrumentId", "color"];
      valid = id("id") && optionalString("name") && optionalString("color") &&
        (command.kind === undefined || ["instrument", "audio", "effect", "group"].includes(command.kind as string)) &&
        (command.instrumentId === undefined ||
          (["drums", "bass", "chords", "lead"].includes(command.instrumentId as string) &&
            (command.kind === undefined || command.kind === "instrument")));
      break;
    case "SetTrackInstrument":
      keys = ["trackId", "instrumentId"];
      valid = id("trackId") &&
        ["drums", "bass", "chords", "lead"].includes(command.instrumentId as string);
      break;
    case "CreateClip":
      keys = ["id", "trackId", "name", "startBeat", "lengthBeats"];
      valid = id("id") && id("trackId") && optionalString("name") &&
        optionalNonNegative("startBeat") && optionalPositive("lengthBeats");
      break;
    case "AddNote":
      keys = ["id", "trackId", "clipId", "pitch", "velocity", "startBeat", "lengthBeats"];
      valid = id("id") && id("trackId") && id("clipId") && midi("pitch") &&
        (command.velocity === undefined || midi("velocity")) && nonNegative("startBeat") &&
        optionalPositive("lengthBeats");
      break;
    case "UpdateNote":
      keys = ["trackId", "clipId", "noteId", "pitch", "velocity", "startBeat", "lengthBeats"];
      valid = id("trackId") && id("clipId") && id("noteId") &&
        (command.pitch === undefined || midi("pitch")) &&
        (command.velocity === undefined || midi("velocity")) &&
        optionalNonNegative("startBeat") && optionalPositive("lengthBeats") &&
        ["pitch", "velocity", "startBeat", "lengthBeats"].some((key) => command[key] !== undefined);
      break;
    case "RemoveNote":
      keys = ["trackId", "clipId", "noteId"];
      valid = id("trackId") && id("clipId") && id("noteId");
      break;
    case "DuplicateClip":
      keys = ["id", "noteIds", "trackId", "clipId", "name", "startBeat"];
      valid = id("id") && id("trackId") && id("clipId") && optionalString("name") &&
        optionalNonNegative("startBeat") && Array.isArray(command.noteIds) &&
        command.noteIds.every(isNonEmptyString) && new Set(command.noteIds).size === command.noteIds.length;
      break;
    case "QuantizeClip":
      keys = ["trackId", "clipId", "gridBeats"];
      valid = id("trackId") && id("clipId") && positive("gridBeats");
      break;
    case "TransposeClip":
      keys = ["trackId", "clipId", "semitones"];
      valid = id("trackId") && id("clipId") && Number.isInteger(command.semitones);
      break;
    case "SetTempo":
      keys = ["bpm"];
      valid = positive("bpm");
      break;
    case "StartPlayback":
    case "StopPlayback":
      keys = ["positionBeats"];
      valid = optionalNonNegative("positionBeats");
      break;
    case "SetPlayhead":
      keys = ["positionBeats"];
      valid = nonNegative("positionBeats");
      break;
  }
  const keyValidation = requireKeys(keys!);
  if (!keyValidation.ok) return keyValidation;
  return valid ? VALID : fail("has invalid or missing fields");
}

function isAdapterId(value: unknown): value is DawAdapterId {
  return typeof value === "string" && ADAPTER_IDS.has(value as DawAdapterId);
}

function isDawError(value: unknown): value is DawError {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["code", "message"], ["commandIndex"]) &&
    typeof value.code === "string" &&
    ERROR_CODES.has(value.code as DawErrorCode) &&
    isNonEmptyString(value.message) &&
    (value.commandIndex === undefined ||
      (Number.isInteger(value.commandIndex) && (value.commandIndex as number) >= 0))
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key));
}

function isRevision(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isUniqueStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(isNonEmptyString) &&
    new Set(value).size === value.length
  );
}

function failure(
  code: DawErrorCode,
  message: string,
  commandIndex?: number,
): ValidationFailure {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, ...(commandIndex === undefined ? {} : { commandIndex }) }),
  });
}

function invalid(message: string): ValidationFailure {
  return failure("invalid_command", message);
}

function requireValid(result: ValidationResult, label: string): asserts result is ValidationSuccess {
  if (!result.ok) {
    throw new Error(`${label} failed conformance validation: ${result.error.code}: ${result.error.message}`);
  }
}

function requireConformance(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`DAW adapter conformance failed: ${message}`);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

const VALID: ValidationSuccess = Object.freeze({ ok: true });
