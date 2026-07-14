import {
  validateExecutableCommands,
  validateExecutionReport,
  type DawAdapterId,
  type ExecutableBeatTwinCommand,
  type ExecutablePlan,
  type ExecutionReport,
} from "@beat-twin/daw-contract";

export const MAX_PLAN_TTL_MS = 120_000;
export const MAX_CONFIRMATION_TTL_MS = 30_000;
export const MAX_PAIRING_TTL_MS = 86_400_000;

export const SONG_WRITE_SCOPE = "song.write";
export const TRANSPORT_WRITE_SCOPE = "transport.write";

export type GatewayCoreErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "quota_exceeded"
  | "policy_blocked"
  | "conflict"
  | "plan_expired"
  | "confirmation_expired"
  | "confirmation_used";

export class GatewayCoreError extends Error {
  readonly code: GatewayCoreErrorCode;

  constructor(code: GatewayCoreErrorCode, message: string) {
    super(message);
    this.name = "GatewayCoreError";
    this.code = code;
  }
}

export type GatewayAuditEvent = {
  readonly type:
    | "pairing.issued"
    | "pairing.revoked"
    | "authorization.allowed"
    | "authorization.denied"
    | "authorization.rolled_back"
    | "plan.created"
    | "plan.confirmed"
    | "plan.execution_consumed"
    | "plan.execution_recorded"
    | "plan.execution_uncertain"
    | "plan.execution_rolled_back";
  readonly timestamp: string;
  readonly outcome: "allowed" | "denied";
  readonly actorId?: string;
  readonly tokenFingerprint?: string;
  readonly planId?: string;
  readonly adapterId?: DawAdapterId;
  readonly code?: GatewayCoreErrorCode | "partial_execution";
};

export type AuditSink = (event: GatewayAuditEvent) => void | Promise<void>;
export type Clock = { readonly now: () => number };
export type TokenGenerator = () => string;

export type PairingGrant = {
  readonly token: string;
  readonly actorId: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
  readonly maxRequests: number;
};

export type AuthorizationContext = {
  readonly actorId: string;
  readonly scopes: readonly string[];
  readonly tokenFingerprint: string;
  readonly remainingRequests: number;
};

type PairingRecord = {
  readonly actorId: string;
  readonly scopes: readonly string[];
  readonly expiresAt: number;
  readonly maxRequests: number;
  usedRequests: number;
  revoked: boolean;
};

export type PairingAuthorityOptions = {
  readonly clock?: Clock;
  readonly audit: AuditSink;
  readonly tokenGenerator?: TokenGenerator;
};

export class PairingAuthority {
  readonly #clock: Clock;
  readonly #audit: AuditSink;
  readonly #tokenGenerator: TokenGenerator;
  readonly #records = new Map<string, PairingRecord>();
  readonly #recordOperations = new Map<string, Promise<void>>();
  readonly #pendingTokenHashes = new Set<string>();

  constructor(options: PairingAuthorityOptions) {
    this.#clock = options.clock ?? { now: Date.now };
    this.#audit = options.audit;
    this.#tokenGenerator = options.tokenGenerator ?? randomToken;
  }

  async issue(input: {
    readonly actorId: string;
    readonly scopes: readonly string[];
    readonly ttlMs: number;
    readonly maxRequests: number;
  }): Promise<PairingGrant> {
    const actorId = requireString(input.actorId, "actorId");
    const scopes = requireUniqueStrings(input.scopes, "scopes");
    const ttlMs = requireIntegerRange(input.ttlMs, 1, MAX_PAIRING_TTL_MS, "ttlMs");
    const maxRequests = requireIntegerRange(input.maxRequests, 1, 1_000_000, "maxRequests");
    const token = `btp_${this.#tokenGenerator()}`;
    const tokenHash = await sha256(token);
    if (this.#records.has(tokenHash) || this.#pendingTokenHashes.has(tokenHash)) {
      throw new GatewayCoreError("conflict", "token generator produced a collision");
    }
    this.#pendingTokenHashes.add(tokenHash);
    try {
    const now = this.#clock.now();
    const expiresAt = now + ttlMs;
    const record: PairingRecord = {
      actorId,
      scopes,
      expiresAt,
      maxRequests,
      usedRequests: 0,
      revoked: false,
    };
    await this.#emit({
      type: "pairing.issued",
      timestamp: iso(now),
      outcome: "allowed",
      actorId,
      tokenFingerprint: fingerprint(tokenHash),
    });
    this.#records.set(tokenHash, record);
    return deepFreeze({ token, actorId, scopes, expiresAt: iso(expiresAt), maxRequests });
    } finally {
      this.#pendingTokenHashes.delete(tokenHash);
    }
  }

  async authorize(token: string, requiredScope: string): Promise<AuthorizationContext> {
    const rawToken = requireString(token, "token");
    const scope = requireString(requiredScope, "requiredScope");
    const tokenHash = await sha256(rawToken);
    return this.#withRecordLock(tokenHash, async () => {
      const tokenFingerprint = fingerprint(tokenHash);
      const record = this.#records.get(tokenHash);
      const now = this.#clock.now();
      let code: GatewayCoreErrorCode | null = null;
      let message = "";
      if (!record || record.revoked || record.expiresAt <= now) {
        code = "unauthenticated";
        message = "pairing token is missing, revoked, or expired";
      } else if (!record.scopes.includes(scope)) {
        code = "forbidden";
        message = `pairing token lacks scope ${scope}`;
      } else if (record.usedRequests >= record.maxRequests) {
        code = "quota_exceeded";
        message = "pairing token request quota is exhausted";
      }
      if (code) {
        await this.#emit({
          type: "authorization.denied",
          timestamp: iso(now),
          outcome: "denied",
          actorId: record?.actorId,
          tokenFingerprint,
          code,
        });
        throw new GatewayCoreError(code, message);
      }

      // Claim quota while holding the per-token lock. If the fail-closed audit
      // cannot persist, roll the claim back before another request may enter.
      record!.usedRequests += 1;
      const authorization = deepFreeze({
        actorId: record!.actorId,
        scopes: record!.scopes,
        tokenFingerprint,
        remainingRequests: record!.maxRequests - record!.usedRequests,
      });
      try {
        await this.#emit({
          type: "authorization.allowed",
          timestamp: iso(now),
          outcome: "allowed",
          actorId: record!.actorId,
          tokenFingerprint,
        });
        if (record!.expiresAt <= this.#clock.now()) {
          await this.#emit({
            type: "authorization.rolled_back",
            timestamp: iso(this.#clock.now()),
            outcome: "denied",
            actorId: record!.actorId,
            tokenFingerprint,
            code: "unauthenticated",
          });
          throw new GatewayCoreError(
            "unauthenticated",
            "pairing token expired before authorization completed",
          );
        }
      } catch (error) {
        record!.usedRequests -= 1;
        throw error;
      }
      return authorization;
    });
  }

  async revoke(token: string): Promise<void> {
    const rawToken = requireString(token, "token");
    const tokenHash = await sha256(rawToken);
    await this.#withRecordLock(tokenHash, async () => {
      const record = this.#records.get(tokenHash);
      if (!record) {
        throw new GatewayCoreError("unauthenticated", "pairing token is unknown");
      }
      const now = this.#clock.now();
      await this.#emit({
        type: "pairing.revoked",
        timestamp: iso(now),
        outcome: "allowed",
        actorId: record.actorId,
        tokenFingerprint: fingerprint(tokenHash),
      });
      record.revoked = true;
    });
  }

  async #emit(event: GatewayAuditEvent): Promise<void> {
    await this.#audit(deepFreeze(event));
  }

  async #withRecordLock<T>(tokenHash: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#recordOperations.get(tokenHash) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#recordOperations.set(tokenHash, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#recordOperations.get(tokenHash) === current) {
        this.#recordOperations.delete(tokenHash);
      }
    }
  }
}

export type UnsignedExecutablePlan = Omit<
  ExecutablePlan,
  "digest" | "createdAt" | "expiresAt"
>;

export type PlanPolicy = (
  plan: ExecutablePlan,
  authorization: AuthorizationContext,
) => boolean | Promise<boolean>;

type ConfirmationRecord = {
  readonly planId: string;
  readonly planDigest: string;
  readonly expiresAt: number;
  used: boolean;
};

type StoredPlan = {
  readonly plan: ExecutablePlan;
  readonly unsignedCanonical: string;
  confirmationHash?: string;
  executionState: "pending" | "consumed" | "completed" | "uncertain";
  executionAuthorization?: AuthorizationContext;
  report?: ExecutionReport;
  uncertainty?: {
    readonly code: "partial_execution";
    readonly message: string;
  };
};

export type GatewayExecutionStatus = {
  readonly planId: string;
  readonly state: StoredPlan["executionState"];
  readonly report?: ExecutionReport;
  readonly error?: {
    readonly code: "partial_execution";
    readonly message: string;
  };
};

export type GatewayPlanStoreOptions = {
  readonly pairing: PairingAuthority;
  readonly policy: PlanPolicy;
  readonly clock?: Clock;
  readonly audit: AuditSink;
  readonly tokenGenerator?: TokenGenerator;
};

export class GatewayPlanStore {
  readonly #pairing: PairingAuthority;
  readonly #policy: PlanPolicy;
  readonly #clock: Clock;
  readonly #audit: AuditSink;
  readonly #tokenGenerator: TokenGenerator;
  readonly #plans = new Map<string, StoredPlan>();
  readonly #confirmations = new Map<string, ConfirmationRecord>();
  readonly #pendingPlanIds = new Set<string>();
  readonly #pendingConfirmationPlanIds = new Set<string>();
  readonly #pendingExecutionPlanIds = new Set<string>();
  readonly #pendingReportPlanIds = new Set<string>();

  constructor(options: GatewayPlanStoreOptions) {
    this.#pairing = options.pairing;
    this.#policy = options.policy;
    this.#clock = options.clock ?? { now: Date.now };
    this.#audit = options.audit;
    this.#tokenGenerator = options.tokenGenerator ?? randomToken;
  }

  async createPlan(input: {
    readonly token: string;
    readonly plan: UnsignedExecutablePlan;
    readonly ttlMs?: number;
  }): Promise<ExecutablePlan> {
    const auth = await this.#pairing.authorize(input.token, "plan.create");
    const unsigned = validateUnsignedPlan(input.plan);
    requireExactCommandScopes(unsigned.commands, unsigned.requiredScopes);
    requirePlanScopes(auth, unsigned.requiredScopes);
    const canonical = canonicalJson(unsigned);
    const existing = this.#plans.get(unsigned.planId);
    if (existing) {
      if (existing.unsignedCanonical === canonical) {
        if (Date.parse(existing.plan.expiresAt) <= this.#clock.now()) {
          throw new GatewayCoreError("plan_expired", `plan ${unsigned.planId} expired`);
        }
        return existing.plan;
      }
      throw new GatewayCoreError("conflict", `planId ${unsigned.planId} is already bound`);
    }
    if (this.#pendingPlanIds.has(unsigned.planId)) {
      throw new GatewayCoreError("conflict", `planId ${unsigned.planId} is being created`);
    }
    this.#pendingPlanIds.add(unsigned.planId);
    try {
    const ttlMs = requireIntegerRange(
      input.ttlMs ?? MAX_PLAN_TTL_MS,
      1,
      MAX_PLAN_TTL_MS,
      "plan ttlMs",
    );
    const now = this.#clock.now();
    const createdAt = iso(now);
    const expiresAt = iso(now + ttlMs);
    const digest = await sha256(canonicalJson({ ...unsigned, createdAt, expiresAt }));
    const plan = deepFreeze({ ...unsigned, digest, createdAt, expiresAt }) as ExecutablePlan;
    let allowed = false;
    try {
      allowed = (await this.#policy(plan, auth)) === true;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      await this.#emit({
        type: "plan.created",
        timestamp: createdAt,
        outcome: "denied",
        actorId: auth.actorId,
        tokenFingerprint: auth.tokenFingerprint,
        planId: plan.planId,
        adapterId: plan.adapterId,
        code: "policy_blocked",
      });
      throw new GatewayCoreError("policy_blocked", "plan policy rejected the immutable plan");
    }
    await this.#emit({
      type: "plan.created",
      timestamp: createdAt,
      outcome: "allowed",
      actorId: auth.actorId,
      tokenFingerprint: auth.tokenFingerprint,
      planId: plan.planId,
      adapterId: plan.adapterId,
    });
    this.#plans.set(plan.planId, {
      plan,
      unsignedCanonical: canonical,
      executionState: "pending",
    });
    return plan;
    } finally {
      this.#pendingPlanIds.delete(unsigned.planId);
    }
  }

  async confirm(input: {
    readonly token: string;
    readonly planId: string;
    readonly ttlMs?: number;
  }): Promise<{ readonly confirmationToken: string; readonly expiresAt: string }> {
    const auth = await this.#pairing.authorize(input.token, "plan.confirm");
    const stored = this.#requireLivePlan(input.planId);
    requirePlanScopes(auth, stored.plan.requiredScopes);
    if (stored.confirmationHash) {
      const previous = this.#confirmations.get(stored.confirmationHash);
      if (previous && !previous.used && previous.expiresAt <= this.#clock.now()) {
        this.#confirmations.delete(stored.confirmationHash);
        stored.confirmationHash = undefined;
      } else {
        throw new GatewayCoreError("conflict", "plan already has a confirmation");
      }
    }
    if (this.#pendingConfirmationPlanIds.has(stored.plan.planId)) {
      throw new GatewayCoreError("conflict", "plan confirmation is being created");
    }
    this.#pendingConfirmationPlanIds.add(stored.plan.planId);
    try {
    const ttlMs = requireIntegerRange(
      input.ttlMs ?? MAX_CONFIRMATION_TTL_MS,
      1,
      MAX_CONFIRMATION_TTL_MS,
      "confirmation ttlMs",
    );
    const now = this.#clock.now();
    const expiresAt = Math.min(now + ttlMs, Date.parse(stored.plan.expiresAt));
    const confirmationToken = `btc_${this.#tokenGenerator()}`;
    const confirmationHash = await sha256(confirmationToken);
    if (this.#confirmations.has(confirmationHash)) {
      throw new GatewayCoreError("conflict", "confirmation token collision");
    }
    await this.#emit({
      type: "plan.confirmed",
      timestamp: iso(now),
      outcome: "allowed",
      actorId: auth.actorId,
      tokenFingerprint: auth.tokenFingerprint,
      planId: stored.plan.planId,
      adapterId: stored.plan.adapterId,
    });
    stored.confirmationHash = confirmationHash;
    this.#confirmations.set(confirmationHash, {
      planId: stored.plan.planId,
      planDigest: stored.plan.digest,
      expiresAt,
      used: false,
    });
    return deepFreeze({ confirmationToken, expiresAt: iso(expiresAt) });
    } finally {
      this.#pendingConfirmationPlanIds.delete(stored.plan.planId);
    }
  }

  async consumeExecution(input: {
    readonly token: string;
    readonly planId: string;
    readonly confirmationToken: string;
  }): Promise<ExecutablePlan> {
    const auth = await this.#pairing.authorize(input.token, "plan.execute");
    const stored = this.#requireLivePlan(input.planId);
    requirePlanScopes(auth, stored.plan.requiredScopes);
    const confirmationHash = await sha256(requireString(input.confirmationToken, "confirmationToken"));
    const confirmation = this.#confirmations.get(confirmationHash);
    const now = this.#clock.now();
    if (!confirmation || confirmation.planId !== stored.plan.planId || confirmation.planDigest !== stored.plan.digest) {
      throw new GatewayCoreError("unauthenticated", "confirmation does not match the immutable plan");
    }
    if (confirmation.used || stored.executionState !== "pending") {
      throw new GatewayCoreError("confirmation_used", "confirmation or plan was already consumed");
    }
    if (this.#pendingExecutionPlanIds.has(stored.plan.planId)) {
      throw new GatewayCoreError("confirmation_used", "confirmation or plan is being consumed");
    }
    if (confirmation.expiresAt <= now) {
      throw new GatewayCoreError("confirmation_expired", "confirmation expired");
    }
    this.#pendingExecutionPlanIds.add(stored.plan.planId);
    try {
      let allowed = false;
      try {
        allowed = (await this.#policy(stored.plan, auth)) === true;
      } catch {
        allowed = false;
      }
      if (!allowed) {
        await this.#emit({
          type: "plan.execution_consumed",
          timestamp: iso(now),
          outcome: "denied",
          actorId: auth.actorId,
          tokenFingerprint: auth.tokenFingerprint,
          planId: stored.plan.planId,
          adapterId: stored.plan.adapterId,
          code: "policy_blocked",
        });
        throw new GatewayCoreError("policy_blocked", "plan policy rejected execution");
      }
      // Policy may be asynchronous. Re-check both validity windows at the
      // exact synchronous claim point immediately before marking single-use.
      const claimNow = this.#clock.now();
      if (Date.parse(stored.plan.expiresAt) <= claimNow) {
        throw new GatewayCoreError("plan_expired", `plan ${stored.plan.planId} expired`);
      }
      if (confirmation.expiresAt <= claimNow) {
        throw new GatewayCoreError("confirmation_expired", "confirmation expired");
      }
      confirmation.used = true;
      stored.executionState = "consumed";
      stored.executionAuthorization = auth;
      try {
        await this.#emit({
          type: "plan.execution_consumed",
          timestamp: iso(claimNow),
          outcome: "allowed",
          actorId: auth.actorId,
          tokenFingerprint: auth.tokenFingerprint,
          planId: stored.plan.planId,
          adapterId: stored.plan.adapterId,
        });
        const completedAt = this.#clock.now();
        if (Date.parse(stored.plan.expiresAt) <= completedAt) {
          await this.#emit({
            type: "plan.execution_rolled_back",
            timestamp: iso(completedAt),
            outcome: "denied",
            actorId: auth.actorId,
            tokenFingerprint: auth.tokenFingerprint,
            planId: stored.plan.planId,
            adapterId: stored.plan.adapterId,
            code: "plan_expired",
          });
          throw new GatewayCoreError("plan_expired", `plan ${stored.plan.planId} expired`);
        }
        if (confirmation.expiresAt <= completedAt) {
          await this.#emit({
            type: "plan.execution_rolled_back",
            timestamp: iso(completedAt),
            outcome: "denied",
            actorId: auth.actorId,
            tokenFingerprint: auth.tokenFingerprint,
            planId: stored.plan.planId,
            adapterId: stored.plan.adapterId,
            code: "confirmation_expired",
          });
          throw new GatewayCoreError("confirmation_expired", "confirmation expired");
        }
      } catch (error) {
        confirmation.used = false;
        stored.executionState = "pending";
        stored.executionAuthorization = undefined;
        throw error;
      }
      return stored.plan;
    } finally {
      this.#pendingExecutionPlanIds.delete(stored.plan.planId);
    }
  }

  async recordExecution(input: {
    readonly planId: string;
    readonly report: ExecutionReport;
  }): Promise<ExecutionReport> {
    const stored = this.#plans.get(requireString(input.planId, "planId"));
    if (!stored || stored.executionState === "pending" || !stored.executionAuthorization) {
      throw new GatewayCoreError("invalid_request", "plan execution was not consumed");
    }
    if (stored.executionState === "uncertain") {
      throw new GatewayCoreError("conflict", "plan execution outcome is already uncertain");
    }
    const auth = stored.executionAuthorization;
    const reportValidation = validateExecutionReport(input.report, stored.plan);
    if (!reportValidation.ok) {
      throw new GatewayCoreError(
        "invalid_request",
        `execution report failed validation: ${reportValidation.error.message}`,
      );
    }
    if (stored.report) {
      if (canonicalJson(stored.report) === canonicalJson(input.report)) return stored.report;
      throw new GatewayCoreError("conflict", "plan already has a different execution report");
    }
    if (this.#pendingReportPlanIds.has(stored.plan.planId)) {
      throw new GatewayCoreError("conflict", "plan execution report is being recorded");
    }
    const now = this.#clock.now();
    this.#pendingReportPlanIds.add(stored.plan.planId);
    try {
      await this.#emit({
        type: "plan.execution_recorded",
        timestamp: iso(now),
        outcome: "allowed",
        actorId: auth.actorId,
        tokenFingerprint: auth.tokenFingerprint,
        planId: stored.plan.planId,
        adapterId: stored.plan.adapterId,
      });
      stored.report = deepFreeze(structuredClone(input.report));
      stored.executionState = "completed";
      return stored.report;
    } finally {
      this.#pendingReportPlanIds.delete(stored.plan.planId);
    }
  }

  getPlan(planId: string): ExecutablePlan | null {
    return this.#plans.get(planId)?.plan ?? null;
  }

  async recordExecutionUncertainty(input: {
    readonly planId: string;
    readonly message: string;
  }): Promise<GatewayExecutionStatus> {
    const stored = this.#plans.get(requireString(input.planId, "planId"));
    if (!stored || stored.executionState === "pending" || !stored.executionAuthorization) {
      throw new GatewayCoreError("invalid_request", "plan execution was not consumed");
    }
    if (stored.executionState === "completed") {
      throw new GatewayCoreError("conflict", "plan already has a verified execution report");
    }
    if (this.#pendingReportPlanIds.has(stored.plan.planId)) {
      throw new GatewayCoreError("conflict", "plan execution outcome is being recorded");
    }
    const message = requireString(input.message, "uncertainty message");
    if (stored.uncertainty) {
      if (stored.uncertainty.message !== message) {
        throw new GatewayCoreError("conflict", "plan already has a different uncertain outcome");
      }
      return this.getExecutionStatus(stored.plan.planId)!;
    }
    const error = deepFreeze({ code: "partial_execution" as const, message });
    this.#pendingReportPlanIds.add(stored.plan.planId);
    try {
    // The DAW may already have mutated. Preserve the terminal uncertainty even
    // if the audit sink is unavailable so status readback remains honest.
    stored.uncertainty = error;
    stored.executionState = "uncertain";
    await this.#emit({
      type: "plan.execution_uncertain",
      timestamp: iso(this.#clock.now()),
      outcome: "denied",
      actorId: stored.executionAuthorization.actorId,
      tokenFingerprint: stored.executionAuthorization.tokenFingerprint,
      planId: stored.plan.planId,
      adapterId: stored.plan.adapterId,
      code: "partial_execution",
    });
    return this.getExecutionStatus(stored.plan.planId)!;
    } finally {
      this.#pendingReportPlanIds.delete(stored.plan.planId);
    }
  }

  getExecutionStatus(planId: string): GatewayExecutionStatus | null {
    const stored = this.#plans.get(planId);
    if (!stored) return null;
    return deepFreeze({
      planId: stored.plan.planId,
      state: stored.executionState,
      ...(stored.report ? { report: stored.report } : {}),
      ...(stored.uncertainty ? { error: stored.uncertainty } : {}),
    });
  }

  #requireLivePlan(planIdInput: string): StoredPlan {
    const planId = requireString(planIdInput, "planId");
    const stored = this.#plans.get(planId);
    if (!stored) throw new GatewayCoreError("invalid_request", `unknown plan ${planId}`);
    if (Date.parse(stored.plan.expiresAt) <= this.#clock.now()) {
      throw new GatewayCoreError("plan_expired", `plan ${planId} expired`);
    }
    return stored;
  }

  async #emit(event: GatewayAuditEvent): Promise<void> {
    await this.#audit(deepFreeze(event));
  }
}

export async function computeExecutablePlanDigest(
  plan: Omit<ExecutablePlan, "digest">,
): Promise<string> {
  return sha256(canonicalJson(plan));
}

function validateUnsignedPlan(value: UnsignedExecutablePlan): UnsignedExecutablePlan {
  if (!value || typeof value !== "object") {
    throw new GatewayCoreError("invalid_request", "plan must be an object");
  }
  const allowedKeys = new Set([
    "planId",
    "requestId",
    "adapterId",
    "capabilityVersion",
    "baseRevision",
    "commands",
    "requiredScopes",
  ]);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    throw new GatewayCoreError("invalid_request", `plan contains unknown field ${unknownKey}`);
  }
  const adapterId = value.adapterId;
  if (adapterId !== "nanodaw" && adapterId !== "bitwig") {
    throw new GatewayCoreError("invalid_request", "plan adapterId is invalid");
  }
  requireString(value.planId, "planId");
  requireString(value.requestId, "requestId");
  requireString(value.capabilityVersion, "capabilityVersion");
  if (!Number.isInteger(value.baseRevision) || value.baseRevision < 0) {
    throw new GatewayCoreError("invalid_request", "baseRevision must be a non-negative integer");
  }
  if (!Array.isArray(value.commands) || value.commands.length === 0) {
    throw new GatewayCoreError("invalid_request", "commands must be a non-empty array");
  }
  const commandValidation = validateExecutableCommands(value.commands);
  if (!commandValidation.ok) {
    throw new GatewayCoreError("invalid_request", commandValidation.error.message);
  }
  requireUniqueStrings(value.requiredScopes, "requiredScopes");
  try {
    return deepFreeze(structuredClone(value));
  } catch {
    throw new GatewayCoreError("invalid_request", "plan must be structured-clone serializable");
  }
}

function requirePlanScopes(auth: AuthorizationContext, scopes: readonly string[]): void {
  const missing = scopes.find((scope) => !auth.scopes.includes(scope));
  if (missing) throw new GatewayCoreError("forbidden", `pairing token lacks plan scope ${missing}`);
}

export function deriveRequiredCommandScopes(
  commands: readonly ExecutableBeatTwinCommand[],
): readonly string[] {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new GatewayCoreError("invalid_request", "commands must be a non-empty array");
  }
  let songWrite = false;
  let transportWrite = false;
  for (const [index, command] of commands.entries()) {
    if (!command || typeof command !== "object" || typeof command.type !== "string") {
      throw new GatewayCoreError("invalid_request", `commands[${index}].type is invalid`);
    }
    if (isTransportCommand(command.type)) {
      transportWrite = true;
    } else if (isSongCommand(command.type)) {
      songWrite = true;
    } else {
      throw new GatewayCoreError("invalid_request", `commands[${index}].type is unknown`);
    }
  }
  return Object.freeze([
    ...(songWrite ? [SONG_WRITE_SCOPE] : []),
    ...(transportWrite ? [TRANSPORT_WRITE_SCOPE] : []),
  ]);
}

function requireExactCommandScopes(
  commands: readonly ExecutableBeatTwinCommand[],
  declaredScopes: readonly string[],
): void {
  const derivedScopes = deriveRequiredCommandScopes(commands);
  if (
    declaredScopes.length !== derivedScopes.length ||
    derivedScopes.some((scope) => !declaredScopes.includes(scope))
  ) {
    throw new GatewayCoreError(
      "invalid_request",
      `requiredScopes must exactly match derived command scopes: ${derivedScopes.join(", ")}`,
    );
  }
}

function isTransportCommand(type: string): boolean {
  return type === "StartPlayback" || type === "StopPlayback" || type === "SetPlayhead";
}

function isSongCommand(type: string): boolean {
  return type === "CreateSong" ||
    type === "CreateTrack" ||
    type === "CreateClip" ||
    type === "AddNote" ||
    type === "UpdateNote" ||
    type === "RemoveNote" ||
    type === "DuplicateClip" ||
    type === "QuantizeClip" ||
    type === "TransposeClip" ||
    type === "SetTempo";
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GatewayCoreError("invalid_request", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireUniqueStrings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new GatewayCoreError("invalid_request", `${label} must contain non-empty strings`);
  }
  const normalized = value.map((item) => item.trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new GatewayCoreError("invalid_request", `${label} must be unique`);
  }
  return Object.freeze(normalized);
}

function requireIntegerRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new GatewayCoreError("invalid_request", `${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new GatewayCoreError("invalid_request", "canonical JSON rejects non-finite numbers");
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new GatewayCoreError("invalid_request", "canonical JSON accepts plain objects only");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new GatewayCoreError("invalid_request", "value is not canonical JSON");
  return serialized;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fingerprint(hash: string): string {
  return hash.slice(0, 12);
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
