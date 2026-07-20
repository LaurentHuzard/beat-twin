import {
  createCommandState,
  executeCommandBatch,
  type CommandSnapshot,
  type ExecutableBeatTwinCommand,
} from "@beat-twin/commands";
import {
  addClip,
  addNote,
  addTrack,
  createClip,
  createNote,
  createSong,
  createTrack,
  type Song,
} from "@beat-twin/core";
import {
  preflightExecutablePlan,
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
import {
  BoundedRetentionMap,
  type RetentionPolicy,
  type RetentionStore,
} from "@beat-twin/retention";

export const BITWIG_CAPABILITY_VERSION = "bitwig-launcher-v1";
export const BITWIG_BRIDGE_PROTOCOL_VERSION = "beat-twin-bitwig-v2";
export const BITWIG_STEP_SIZE_BEATS = 0.25;
export const BITWIG_MAX_STEPS = 64;

export const BITWIG_SUPPORTED_COMMANDS = Object.freeze([
  "CreateSong",
  "CreateTrack",
  "CreateClip",
  "AddNote",
] as const satisfies readonly ExecutableCommandType[]);

export type BitwigTargetBinding = {
  readonly controllerInstanceId: string;
  readonly projectName: string;
  readonly trackPosition: number;
  readonly slotSceneIndex: number;
  readonly targetGeneration: number;
};

export type BitwigReadbackNote = {
  readonly channel: number;
  readonly step: number;
  readonly pitch: number;
  readonly velocity: number;
  readonly durationBeats: number;
};

export type BitwigTargetInspection = {
  readonly protocolVersion: string;
  readonly controllerInstanceId: string;
  readonly projectName: string;
  readonly writeAuthenticated: boolean;
  readonly target: {
    readonly available: boolean;
    readonly binding: BitwigTargetBinding;
    readonly trackName: string;
    readonly slotName: string;
    readonly hasContent: boolean;
    readonly clipExists: boolean;
    readonly clipLengthBeats: number | null;
  };
  readonly transport: {
    readonly tempoBpm: number;
    readonly positionBeats: number;
    readonly isPlaying: boolean;
  };
  readonly grid: {
    readonly stepSizeBeats: number;
    readonly maxSteps: number;
  };
  readonly notes: readonly BitwigReadbackNote[];
};

export type BitwigMutationMethod =
  | "target.set_tempo"
  | "target.set_track_name"
  | "target.create_clip"
  | "target.set_note";

export interface BitwigBridgePort {
  inspectTarget(): Promise<BitwigTargetInspection>;
  authenticate(): Promise<void>;
  mutate(method: BitwigMutationMethod, params: readonly unknown[]): Promise<unknown>;
}

export type BitwigRpcCall = (
  method: string,
  params?: readonly unknown[],
  options?: {
    readonly requiresAuthentication?: boolean;
    readonly bridgeSecret?: string;
  },
) => Promise<unknown>;

export function createRpcBitwigBridgePort(options: {
  readonly call: BitwigRpcCall;
  readonly bridgeSecret: string;
}): BitwigBridgePort {
  const bridgeSecret = options.bridgeSecret.trim();
  if (!bridgeSecret) throw new Error("Bitwig bridge secret is required");
  return Object.freeze({
    inspectTarget: async () => validateBitwigTargetInspection(
      await options.call("target.inspect", []),
    ),
    authenticate: async () => {
      const inspection = validateBitwigTargetInspection(await options.call(
        "target.inspect",
        [],
        { requiresAuthentication: true, bridgeSecret },
      ));
      if (!inspection.writeAuthenticated) {
        throw new Error("Bitwig bridge authentication failed");
      }
    },
    mutate: async (method: BitwigMutationMethod, params: readonly unknown[]) =>
      options.call(method, params, { requiresAuthentication: true, bridgeSecret }),
  });
}

export type BitwigAdapterOptions = {
  readonly port: BitwigBridgePort;
  readonly verifyDigest: (plan: ExecutablePlan) => boolean;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly clipReadyAttempts?: number;
  readonly executionRetention?: Partial<RetentionPolicy>;
  readonly executionStore?: RetentionStore<string, BitwigRequestExecution>;
  readonly observationRetention?: Partial<RetentionPolicy>;
  readonly observationStore?: RetentionStore<string, BitwigObservation>;
};

export type BitwigObservation = {
  readonly fingerprint: string;
  readonly inspection: BitwigTargetInspection;
  readonly snapshot: CommandSnapshot;
};

export type BitwigRequestExecution = {
  readonly planIdentity: string;
  state: "pending" | "terminal" | "uncertain";
  report?: Promise<ExecutionReport>;
};

export const DEFAULT_BITWIG_EXECUTION_RETENTION = Object.freeze({
  capacity: 2_048,
  ttlMs: 24 * 60 * 60 * 1_000,
} satisfies RetentionPolicy);

export const DEFAULT_BITWIG_OBSERVATION_RETENTION = Object.freeze({
  capacity: 1_024,
  ttlMs: 15 * 60 * 1_000,
} satisfies RetentionPolicy);

const CAPABILITIES: DawCapabilities = Object.freeze({
  adapterId: "bitwig",
  capabilityVersion: BITWIG_CAPABILITY_VERSION,
  supportedCommands: BITWIG_SUPPORTED_COMMANDS,
  scopes: Object.freeze(["song.write"]),
  limitations: Object.freeze([
    "One explicitly selected empty launcher slot per plan",
    "Sequential non-atomic writes stop after the first uncertain outcome",
    "Clip naming is not verified by the controller API",
    "Notes are bounded to a 64-step sixteenth-note grid",
  ]),
});

export class BitwigAdapter implements DawAdapter {
  readonly id = "bitwig" as const;
  readonly #port: BitwigBridgePort;
  readonly #verifyDigest: (plan: ExecutablePlan) => boolean;
  readonly #now: () => number;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #clipReadyAttempts: number;
  readonly #observationsByFingerprint: BoundedRetentionMap<string, BitwigObservation>;
  readonly #requests: BoundedRetentionMap<string, BitwigRequestExecution>;
  #nextRevision = 0;

  constructor(options: BitwigAdapterOptions) {
    this.#port = options.port;
    this.#verifyDigest = options.verifyDigest;
    this.#now = options.now ?? Date.now;
    this.#wait = options.wait ?? ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#clipReadyAttempts = options.clipReadyAttempts ?? 20;
    if (!Number.isInteger(this.#clipReadyAttempts) || this.#clipReadyAttempts < 1) {
      throw new Error("clipReadyAttempts must be a positive integer");
    }
    this.#observationsByFingerprint = new BoundedRetentionMap({
      name: "Bitwig observations",
      policy: { ...DEFAULT_BITWIG_OBSERVATION_RETENTION, ...options.observationRetention },
      clock: { now: this.#now },
      store: options.observationStore,
    });
    this.#requests = new BoundedRetentionMap({
      name: "Bitwig adapter executions",
      policy: { ...DEFAULT_BITWIG_EXECUTION_RETENTION, ...options.executionRetention },
      clock: { now: this.#now },
      store: options.executionStore,
      canEvict: (record) => record.state === "terminal",
    });
  }

  async health(): Promise<DawHealth> {
    const checkedAt = this.#timestamp();
    try {
      const inspection = validateBitwigTargetInspection(await this.#port.inspectTarget());
      if (!inspection.target.available) {
        return Object.freeze({
          adapterId: this.id,
          status: "degraded",
          checkedAt,
          detail: "Select one launcher slot before planning a Bitwig patch",
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
    const observation = await this.#observe();
    return this.#dawSnapshot(observation.snapshot, this.#timestamp());
  }

  async execute(plan: ExecutablePlan): Promise<ExecutionReport> {
    const planIdentity = stableSerialize(plan);
    const existing = this.#requests.get(plan.requestId);
    if (existing) {
      if (existing.planIdentity === planIdentity && existing.report) return existing.report;
      const snapshot = await this.inspect();
      return rejectedReport(
        plan,
        snapshot.commandSnapshot,
        this.#timestamp(),
        dawError("invalid_command", `requestId ${plan.requestId} is already bound to another plan`),
      );
    }
    const record: BitwigRequestExecution = { planIdentity, state: "pending" };
    try {
      // Reserve the request before authentication or any Bitwig mutation.
      this.#requests.set(plan.requestId, record);
    } catch (error) {
      return this.#retentionRejected(plan, errorMessage(error));
    }
    const report = this.#executeOnce(plan).then(
      (result) => {
        record.state = result.status === "partial" ? "uncertain" : "terminal";
        return result;
      },
      (error) => {
        record.state = "uncertain";
        throw error;
      },
    );
    record.report = report;
    return report;
  }

  retentionStatus(): Readonly<{
    executions: number;
    executionCapacity: number;
    observations: number;
    observationCapacity: number;
  }> {
    return Object.freeze({
      executions: this.#requests.size,
      executionCapacity: this.#requests.capacity,
      observations: this.#observationsByFingerprint.size,
      observationCapacity: this.#observationsByFingerprint.capacity,
    });
  }

  async #retentionRejected(plan: ExecutablePlan, detail: string): Promise<ExecutionReport> {
    const timestamp = this.#timestamp();
    return rejectedReport(
      plan,
      Object.freeze({ song: null, revision: plan.baseRevision }),
      timestamp,
      dawError("policy_blocked", `Bitwig retention unavailable before mutation: ${detail}`),
      timestamp,
    );
  }

  async #executeOnce(plan: ExecutablePlan): Promise<ExecutionReport> {
    const startedAt = this.#timestamp();
    let observation: BitwigObservation;
    try {
      observation = await this.#observe();
    } catch (error) {
      return this.#retentionRejected(plan, errorMessage(error));
    }
    const snapshot = this.#dawSnapshot(observation.snapshot, startedAt);
    const preflight = this.#preflight(plan, snapshot);
    if (!preflight.ok) {
      return rejectedReport(plan, snapshot.commandSnapshot, startedAt, preflight.error, this.#timestamp());
    }
    const bounded = validateBoundedPatch(plan, observation.inspection);
    if (!bounded.ok) {
      return rejectedReport(plan, snapshot.commandSnapshot, startedAt, bounded.error, this.#timestamp());
    }
    const projection = executeCommandBatch(
      createCommandState(snapshot.commandSnapshot.song, snapshot.commandSnapshot.revision),
      {
        requestId: plan.requestId,
        expectedRevision: plan.baseRevision,
        commands: plan.commands,
      },
    );
    if (!projection.ok) {
      return rejectedReport(
        plan,
        snapshot.commandSnapshot,
        startedAt,
        dawError(projection.errorCode, projection.error),
        this.#timestamp(),
      );
    }

    try {
      await this.#port.authenticate();
    } catch (error) {
      return rejectedReport(
        plan,
        snapshot.commandSnapshot,
        startedAt,
        dawError("policy_blocked", `Bitwig bridge authentication failed: ${errorMessage(error)}`),
        this.#timestamp(),
      );
    }

    let authenticatedInspection: BitwigTargetInspection;
    try {
      authenticatedInspection = validateBitwigTargetInspection(await this.#port.inspectTarget());
    } catch (error) {
      return rejectedReport(
        plan,
        snapshot.commandSnapshot,
        startedAt,
        dawError(
          "policy_blocked",
          `Bitwig target could not be verified after authentication: ${errorMessage(error)}`,
        ),
        this.#timestamp(),
      );
    }
    if (inspectionFingerprint(authenticatedInspection) !== observation.fingerprint) {
      return rejectedReport(
        plan,
        snapshot.commandSnapshot,
        startedAt,
        dawError("stale_revision", "Bitwig target changed after authentication"),
        this.#timestamp(),
      );
    }

    const results: CommandExecutionResult[] = [];
    for (const [index, command] of plan.commands.entries()) {
      const operation = commandOperation(command, observation.inspection.target.binding);
      if (!operation) {
        results.push(Object.freeze({ index, command, status: "succeeded" }));
        continue;
      }
      try {
        await this.#port.mutate(operation.method, operation.params);
        if (command.type === "CreateClip") {
          await this.#awaitCreatedClip(
            observation.inspection.target.binding,
            command.lengthBeats ?? 4,
          );
        }
        results.push(Object.freeze({ index, command, status: "succeeded" }));
      } catch (error) {
        const uncertain = dawError(
          "partial_execution",
          `Bitwig mutation outcome is unknown at command ${index}: ${errorMessage(error)}`,
          index,
        );
        return partialAfterDispatch(
          plan,
          snapshot.commandSnapshot,
          startedAt,
          this.#timestamp(),
          results,
          index,
          uncertain,
        );
      }
    }

    let readback: BitwigTargetInspection;
    try {
      readback = validateBitwigTargetInspection(await this.#port.inspectTarget());
    } catch (error) {
      const uncertain = dawError(
        "partial_execution",
        `Bitwig readback failed after mutation: ${errorMessage(error)}`,
      );
      return partialAfterReadback(
        plan,
        snapshot.commandSnapshot,
        startedAt,
        this.#timestamp(),
        results,
        uncertain,
      );
    }

    const readbackError = compareReadback(
      projection.snapshot.song,
      observation.inspection.target.binding,
      readback,
    );
    if (readbackError) {
      const uncertain = dawError("partial_execution", readbackError);
      return partialAfterReadback(
        plan,
        projectInspection(readback, snapshot.commandSnapshot.revision),
        startedAt,
        this.#timestamp(),
        results,
        uncertain,
      );
    }

    try {
      this.#recordSuccessfulReadback(readback, projection.snapshot);
    } catch (error) {
      return partialAfterReadback(
        plan,
        projectInspection(readback, projection.snapshot.revision),
        startedAt,
        this.#timestamp(),
        results,
        dawError(
          "partial_execution",
          `Bitwig mutation readback succeeded but retention failed: ${errorMessage(error)}`,
        ),
      );
    }
    return successReport(plan, projection.snapshot, startedAt, this.#timestamp());
  }

  async #observe(): Promise<BitwigObservation> {
    const inspection = validateBitwigTargetInspection(await this.#port.inspectTarget());
    const fingerprint = inspectionFingerprint(inspection);
    const existing = this.#observationsByFingerprint.get(fingerprint);
    if (existing) return existing;
    const revision = this.#nextRevision++;
    const observation = Object.freeze({
      fingerprint,
      inspection,
      snapshot: projectInspection(inspection, revision),
    });
    this.#observationsByFingerprint.set(fingerprint, observation);
    return observation;
  }

  #recordSuccessfulReadback(
    inspection: BitwigTargetInspection,
    snapshot: CommandSnapshot,
  ): void {
    const fingerprint = inspectionFingerprint(inspection);
    const observation = Object.freeze({ fingerprint, inspection, snapshot });
    this.#observationsByFingerprint.set(fingerprint, observation);
    this.#nextRevision = Math.max(this.#nextRevision, snapshot.revision + 1);
  }

  async #awaitCreatedClip(
    binding: BitwigTargetBinding,
    expectedLengthBeats: number,
  ): Promise<void> {
    let lastInspectionError: unknown;
    for (let attempt = 0; attempt < this.#clipReadyAttempts; attempt++) {
      try {
        const inspection = validateBitwigTargetInspection(await this.#port.inspectTarget());
        if (!sameBinding(binding, inspection.target.binding) || !inspection.target.available) {
          throw new Error("Bitwig target identity changed while waiting for clip readback");
        }
        if (inspection.target.hasContent && inspection.target.clipExists) {
          if (inspection.target.clipLengthBeats !== expectedLengthBeats) {
            throw new Error(
              `Bitwig created clip length ${inspection.target.clipLengthBeats ?? "unknown"}; expected ${expectedLengthBeats}`,
            );
          }
          return;
        }
        lastInspectionError = undefined;
      } catch (error) {
        if (/target identity changed|created clip length/i.test(errorMessage(error))) throw error;
        lastInspectionError = error;
      }
      if (attempt + 1 < this.#clipReadyAttempts) await this.#wait(25);
    }
    throw new Error(
      lastInspectionError
        ? `Bitwig clip readiness could not be inspected: ${errorMessage(lastInspectionError)}`
        : "Bitwig clip did not become readable within the bounded readiness wait",
    );
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
      return failure("invalid_command", `plan digest verification failed: ${errorMessage(error)}`);
    }
  }

  #dawSnapshot(commandSnapshot: CommandSnapshot, observedAt: string): DawSnapshot {
    return Object.freeze({
      adapterId: this.id,
      capabilityVersion: BITWIG_CAPABILITY_VERSION,
      observedAt,
      commandSnapshot,
    });
  }

  #timestamp(): string {
    return new Date(this.#now()).toISOString();
  }
}

function validateBoundedPatch(
  plan: ExecutablePlan,
  inspection: BitwigTargetInspection,
): ValidationResult {
  if (!inspection.target.available) {
    return failure("policy_blocked", "Select one stable launcher target before planning");
  }
  if (inspection.target.hasContent || inspection.target.clipExists || inspection.notes.length > 0) {
    return failure("policy_blocked", "Bitwig target slot must be empty before planning");
  }
  if (plan.requiredScopes.length !== 1 || plan.requiredScopes[0] !== "song.write") {
    return failure("policy_blocked", "Bitwig patch requires exactly the song.write scope");
  }
  if (plan.commands.length > 20) {
    return failure("policy_blocked", "Bitwig plans are limited to twenty commands");
  }

  let songCount = 0;
  let trackCount = 0;
  let clipCount = 0;
  let noteCount = 0;
  let clipLengthBeats: number | null = null;
  for (const [index, command] of plan.commands.entries()) {
    if (command.type === "CreateSong") {
      songCount += 1;
      const bpm = command.bpm ?? 120;
      if (!isBoundedTempo(bpm)) {
        return failure(
          "unsupported_capability",
          "Bitwig tempo must be between 40 and 240 BPM",
          index,
        );
      }
    }
    if (command.type === "SetTempo" && !isBoundedTempo(command.bpm)) {
      return failure(
        "unsupported_capability",
        "Bitwig tempo must be between 40 and 240 BPM",
        index,
      );
    }
    if (command.type === "CreateTrack") {
      trackCount += 1;
      if (command.kind !== "instrument") {
        return failure(
          "unsupported_capability",
          "Bitwig target track must be an instrument track",
          index,
        );
      }
      if (command.instrumentId !== undefined) {
        return failure(
          "unsupported_capability",
          "Bitwig built-in instrument selection is not mapped",
          index,
        );
      }
      const name = command.name ?? "Beat Twin";
      if (name.length < 1 || name.length > 64) {
        return failure(
          "unsupported_capability",
          "Bitwig track names must contain 1-64 characters",
          index,
        );
      }
    }
    if (command.type === "CreateClip") {
      clipCount += 1;
      const startBeat = command.startBeat ?? 0;
      const lengthBeats = command.lengthBeats ?? 4;
      if (startBeat !== 0 || !Number.isInteger(lengthBeats) || lengthBeats < 1 || lengthBeats > 16) {
        return failure(
          "unsupported_capability",
          "Bitwig launcher clips require start beat 0 and 1-16 whole beats",
          index,
        );
      }
      clipLengthBeats = lengthBeats;
    }
  }
  for (const [index, command] of plan.commands.entries()) {
    if (command.type === "AddNote") {
      noteCount += 1;
      const step = command.startBeat / BITWIG_STEP_SIZE_BEATS;
      const duration = command.lengthBeats ?? BITWIG_STEP_SIZE_BEATS;
      const velocity = command.velocity ?? 100;
      if (
        !Number.isInteger(step) ||
        step < 0 ||
        step >= BITWIG_MAX_STEPS ||
        !Number.isInteger(command.pitch) ||
        command.pitch < 0 ||
        command.pitch > 127 ||
        !Number.isInteger(velocity) ||
        velocity < 1 ||
        velocity > 127 ||
        !isGridBeat(duration) ||
        clipLengthBeats === null ||
        command.startBeat + duration > clipLengthBeats
      ) {
        return failure(
          "unsupported_capability",
          "Bitwig notes must use bounded MIDI values and fit the target clip's 64-step sixteenth-note grid",
          index,
        );
      }
    }
  }
  if (songCount !== 1 || trackCount !== 1 || clipCount !== 1 || noteCount < 1 || noteCount > 16) {
    return failure(
      "unsupported_capability",
      "Bitwig patch must create one song projection, one instrument track, one clip, and 1-16 notes",
    );
  }
  return Object.freeze({ ok: true });
}

function commandOperation(
  command: ExecutableBeatTwinCommand,
  binding: BitwigTargetBinding,
): { readonly method: BitwigMutationMethod; readonly params: readonly unknown[] } | null {
  if (command.type === "CreateSong") {
    return Object.freeze({
      method: "target.set_tempo",
      params: Object.freeze([binding, command.bpm ?? 120]),
    });
  }
  if (command.type === "CreateTrack") {
    return Object.freeze({
      method: "target.set_track_name",
      params: Object.freeze([binding, command.name ?? "Beat Twin"]),
    });
  }
  if (command.type === "CreateClip") {
    return Object.freeze({
      method: "target.create_clip",
      params: Object.freeze([binding, command.lengthBeats ?? 4]),
    });
  }
  if (command.type === "AddNote") {
    return Object.freeze({
      method: "target.set_note",
      params: Object.freeze([
        binding,
        command.startBeat / BITWIG_STEP_SIZE_BEATS,
        command.pitch,
        command.velocity ?? 100,
        command.lengthBeats ?? BITWIG_STEP_SIZE_BEATS,
      ]),
    });
  }
  if (command.type === "SetTempo") {
    return Object.freeze({
      method: "target.set_tempo",
      params: Object.freeze([binding, command.bpm]),
    });
  }
  throw new Error(`Unsupported Bitwig command ${command.type}`);
}

function projectInspection(
  inspection: BitwigTargetInspection,
  revision: number,
): CommandSnapshot {
  if (!inspection.target.hasContent || !inspection.target.clipExists) {
    return Object.freeze({ song: null, revision });
  }
  const bindingKey = stableId("target", inspection.target.binding);
  const songId = `${bindingKey}:song`;
  const trackId = `${bindingKey}:track`;
  const clipId = `${bindingKey}:clip`;
  const clipLength = inspection.target.clipLengthBeats ?? 16;
  let song: Song = createSong({
    id: songId,
    title: inspection.projectName || "Bitwig project",
    bpm: inspection.transport.tempoBpm,
  });
  song = addTrack(song, createTrack({
    id: trackId,
    name: inspection.target.trackName || "Bitwig target",
    kind: "instrument",
  }));
  song = addClip(song, trackId, createClip({
    id: clipId,
    trackId,
    name: inspection.target.slotName || "Launcher clip",
    startBeat: 0,
    lengthBeats: clipLength,
  }));
  for (const note of inspection.notes) {
    song = addNote(song, trackId, clipId, createNote({
      id: `${bindingKey}:note:${note.channel}:${note.step}:${note.pitch}`,
      pitch: note.pitch,
      velocity: note.velocity,
      startBeat: note.step * BITWIG_STEP_SIZE_BEATS,
      lengthBeats: note.durationBeats,
    }));
  }
  return Object.freeze({ song, revision });
}

function compareReadback(
  expected: Song | null,
  binding: BitwigTargetBinding,
  inspection: BitwigTargetInspection,
): string | null {
  const track = expected?.tracks[0];
  const clip = track?.clips[0];
  if (!track || !clip) return "Bitwig projected song is missing its bounded target";
  if (!sameBinding(binding, inspection.target.binding) || !inspection.target.available) {
    return "Bitwig target identity changed after execution";
  }
  if (!inspection.target.hasContent || !inspection.target.clipExists) {
    return "Bitwig target clip was not created or could not be read back";
  }
  if (inspection.target.trackName !== track.name) {
    return `Bitwig track readback mismatch: expected ${track.name}`;
  }
  if (inspection.target.clipLengthBeats !== clip.lengthBeats) {
    return `Bitwig clip length readback mismatch: expected ${clip.lengthBeats}`;
  }
  if (Math.abs(inspection.transport.tempoBpm - expected.transport.bpm) > 0.0001) {
    return `Bitwig tempo readback mismatch: expected ${expected.transport.bpm}`;
  }
  const expectedNotes: BitwigReadbackNote[] = clip.pattern.notes.map((note) => ({
    channel: 0,
    step: note.startBeat / BITWIG_STEP_SIZE_BEATS,
    pitch: note.pitch,
    velocity: note.velocity,
    durationBeats: note.lengthBeats,
  }));
  if (
    stableSerialize(sortNotes(inspection.notes)) !==
    stableSerialize(sortNotes(expectedNotes))
  ) {
    return "Bitwig note readback does not match the confirmed plan";
  }
  return null;
}

function sortNotes(notes: readonly BitwigReadbackNote[]): readonly BitwigReadbackNote[] {
  return [...notes].sort((left, right) =>
    left.step - right.step || left.pitch - right.pitch || left.channel - right.channel,
  );
}

export function validateBitwigTargetInspection(value: unknown): BitwigTargetInspection {
  if (
    !isRecord(value) ||
    value.protocolVersion !== BITWIG_BRIDGE_PROTOCOL_VERSION ||
    !isNonBlank(value.controllerInstanceId) ||
    typeof value.projectName !== "string" ||
    typeof value.writeAuthenticated !== "boolean" ||
    !isRecord(value.target) ||
    typeof value.target.available !== "boolean" ||
    !isBinding(value.target.binding) ||
    !isTargetAvailabilityConsistent(value.target.available, value.target.binding) ||
    typeof value.target.trackName !== "string" ||
    typeof value.target.slotName !== "string" ||
    typeof value.target.hasContent !== "boolean" ||
    typeof value.target.clipExists !== "boolean" ||
    !(value.target.clipLengthBeats === null || isPositiveFinite(value.target.clipLengthBeats)) ||
    !isRecord(value.transport) ||
    !isPositiveFinite(value.transport.tempoBpm) ||
    !isNonNegativeFinite(value.transport.positionBeats) ||
    typeof value.transport.isPlaying !== "boolean" ||
    !isRecord(value.grid) ||
    value.grid.stepSizeBeats !== BITWIG_STEP_SIZE_BEATS ||
    value.grid.maxSteps !== BITWIG_MAX_STEPS ||
    !Array.isArray(value.notes) ||
    value.notes.some((note) => !isReadbackNote(note))
  ) {
    throw new Error("Bitwig target inspection is invalid");
  }
  return value as unknown as BitwigTargetInspection;
}

function inspectionFingerprint(inspection: BitwigTargetInspection): string {
  return stableSerialize({
    protocolVersion: inspection.protocolVersion,
    controllerInstanceId: inspection.controllerInstanceId,
    projectName: inspection.projectName,
    target: inspection.target,
    transport: inspection.transport,
    grid: inspection.grid,
    notes: inspection.notes,
  });
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
    results: Object.freeze(plan.commands.map((command, index) =>
      Object.freeze({ index, command, status: "not_attempted" as const, error }))),
    error,
  });
}

function partialAfterDispatch(
  plan: ExecutablePlan,
  finalSnapshot: CommandSnapshot,
  startedAt: string,
  completedAt: string,
  succeeded: readonly CommandExecutionResult[],
  failedIndex: number,
  error: DawError,
): ExecutionReport {
  const results: CommandExecutionResult[] = [...succeeded];
  for (let index = failedIndex; index < plan.commands.length; index++) {
    results.push(Object.freeze({
      index,
      command: plan.commands[index]!,
      status: index === failedIndex ? "unknown" as const : "not_attempted" as const,
      error,
    }));
  }
  return partialReport(plan, finalSnapshot, startedAt, completedAt, results, error);
}

function partialAfterReadback(
  plan: ExecutablePlan,
  finalSnapshot: CommandSnapshot,
  startedAt: string,
  completedAt: string,
  acknowledged: readonly CommandExecutionResult[],
  error: DawError,
): ExecutionReport {
  const results = [...acknowledged];
  for (let index = 0; index < results.length; index++) {
    results[index] = Object.freeze({
      index,
      command: plan.commands[index]!,
      status: "unknown" as const,
      error,
    });
  }
  return partialReport(plan, finalSnapshot, startedAt, completedAt, results, error);
}

function partialReport(
  plan: ExecutablePlan,
  finalSnapshot: CommandSnapshot,
  startedAt: string,
  completedAt: string,
  results: readonly CommandExecutionResult[],
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
    results: Object.freeze(results),
    error,
  });
}

function successReport(
  plan: ExecutablePlan,
  finalSnapshot: CommandSnapshot,
  startedAt: string,
  completedAt: string,
): ExecutionReport {
  return Object.freeze({
    ok: true,
    status: "succeeded",
    adapterId: plan.adapterId,
    planId: plan.planId,
    requestId: plan.requestId,
    baseRevision: plan.baseRevision,
    finalSnapshot,
    startedAt,
    completedAt,
    results: Object.freeze(plan.commands.map((command, index) =>
      Object.freeze({ index, command, status: "succeeded" as const }))),
  });
}

function failure(
  code: DawError["code"],
  message: string,
  commandIndex?: number,
): ValidationResult {
  return Object.freeze({ ok: false, error: dawError(code, message, commandIndex) });
}

function dawError(code: DawError["code"], message: string, commandIndex?: number): DawError {
  return Object.freeze({
    code,
    message,
    ...(commandIndex === undefined ? {} : { commandIndex }),
  });
}

function sameBinding(left: BitwigTargetBinding, right: BitwigTargetBinding): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function stableId(kind: string, binding: BitwigTargetBinding): string {
  let hash = 2166136261;
  const input = `${kind}:${stableSerialize(binding)}`;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `bitwig-${kind}-${(hash >>> 0).toString(16)}`;
}

function isGridBeat(value: number): boolean {
  return Number.isFinite(value) && value > 0 &&
    Math.abs(value * 4 - Math.round(value * 4)) < 1e-8;
}

function isBoundedTempo(value: number): boolean {
  return Number.isFinite(value) && value >= 40 && value <= 240;
}

function isBinding(value: unknown): value is BitwigTargetBinding {
  return isRecord(value) &&
    isNonBlank(value.controllerInstanceId) &&
    typeof value.projectName === "string" &&
    Number.isInteger(value.trackPosition) &&
    (value.trackPosition as number) >= -1 &&
    Number.isInteger(value.slotSceneIndex) &&
    (value.slotSceneIndex as number) >= -1 &&
    Number.isInteger(value.targetGeneration) &&
    (value.targetGeneration as number) >= 0;
}

function isTargetAvailabilityConsistent(
  available: boolean,
  binding: BitwigTargetBinding,
): boolean {
  return !available || (binding.trackPosition >= 0 && binding.slotSceneIndex >= 0);
}

function isReadbackNote(value: unknown): value is BitwigReadbackNote {
  return isRecord(value) &&
    Number.isInteger(value.channel) && value.channel === 0 &&
    Number.isInteger(value.step) &&
    (value.step as number) >= 0 &&
    (value.step as number) < BITWIG_MAX_STEPS &&
    Number.isInteger(value.pitch) &&
    (value.pitch as number) >= 0 &&
    (value.pitch as number) <= 127 &&
    Number.isInteger(value.velocity) &&
    (value.velocity as number) >= 1 &&
    (value.velocity as number) <= 127 &&
    isPositiveFinite(value.durationBeats) &&
    isGridBeat(value.durationBeats as number);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
