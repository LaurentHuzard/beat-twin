import {
  planLiveLoopOccurrences,
  validateLiveClipMaterial,
  type LiveClipMaterial,
  type LivePreparedEvent,
} from "./live-scheduler.ts";

export type LiveAudioErrorCode =
  | "autoplay_rejected"
  | "tone_unavailable"
  | "invalid_state"
  | "invalid_request"
  | "material_not_ready"
  | "unsupported_material"
  | "schedule_failed"
  | "disposed";

export type LiveAudioError = {
  readonly code: LiveAudioErrorCode;
  readonly message: string;
  readonly cause?: unknown;
};

export class LiveAudioEngineFault extends Error {
  readonly detail: LiveAudioError;

  constructor(detail: LiveAudioError) {
    super(detail.message, detail.cause === undefined ? undefined : { cause: detail.cause });
    this.name = "LiveAudioEngineFault";
    this.detail = Object.freeze({ ...detail });
  }
}

export type LiveAudioEnginePhase =
  | "new"
  | "initialized"
  | "blocked"
  | "ready"
  | "running"
  | "suspended"
  | "stopped"
  | "disposed";

export type LiveScheduleHandle = string | number;

export type LiveTrackBus = {
  readonly trackId: string;
  /** Adapter-owned connection target; the generic engine never inspects it. */
  readonly destination?: unknown;
  readonly dispose: () => void;
};

export type LiveAudioPort = {
  readonly unlock: () => Promise<void>;
  readonly setBpm: (bpm: number) => void;
  readonly currentBeat: () => number;
  readonly scheduleAtBeat: (
    beat: number,
    callback: (audioTime: number) => void,
  ) => LiveScheduleHandle;
  readonly scheduleRepeatAtBeat: (
    firstBeat: number,
    intervalBeats: number,
    callback: (audioTime: number, occurrenceBeat: number) => void,
  ) => LiveScheduleHandle;
  readonly cancel: (handle: LiveScheduleHandle) => void;
  readonly start: (atBeat: number) => void;
  readonly suspend: () => void;
  readonly resume: () => void;
  readonly stop: (audioTime?: number) => void;
  readonly reset: () => void;
  readonly createTrackBus: (trackId: string) => LiveTrackBus;
  readonly dispose: () => void;
};

export type LivePreparedMaterial = {
  readonly kind: string;
  readonly materialId: string;
  readonly version: number;
  readonly clipId: string;
  readonly lengthBeats: number;
  readonly events: readonly LivePreparedEvent[];
  readonly trigger: (
    event: LivePreparedEvent,
    audioTime: number,
    bpm: number,
  ) => void;
  readonly releaseAll: (audioTime?: number) => void;
  readonly dispose: (audioTime?: number) => void;
};

export type LiveMaterialPreparer = (
  material: LiveClipMaterial,
  bus: LiveTrackBus,
) => Promise<LivePreparedMaterial>;

type LiveLaunchRequest = {
  readonly kind: "launch";
  readonly transitionId: string;
  readonly groupId: string | null;
  readonly trackId: string;
  readonly targetBeat: number;
  readonly material: LiveClipMaterial;
};

type LiveStopRequest = {
  readonly kind: "stop";
  readonly transitionId: string;
  readonly groupId: string | null;
  readonly trackId: string;
  readonly targetBeat: number;
};

export type LiveTransitionRequest = LiveLaunchRequest | LiveStopRequest;

export type LiveScheduleResult =
  | { readonly ok: true; readonly transitionIds: readonly string[] }
  | { readonly ok: false; readonly error: LiveAudioError };

export type LiveAudioObservation =
  | {
      readonly type: "transition-executed";
      readonly transitionId: string;
      readonly groupId: string | null;
      readonly trackId: string;
      readonly targetBeat: number;
      readonly observedAtBeat: number;
      readonly materialId: string | null;
      readonly materialKind: string | null;
    }
  | {
      readonly type: "transition-cancelled";
      readonly transitionId: string;
      readonly groupId: string | null;
      readonly trackId: string;
      readonly observedAtBeat: number;
    }
  | {
      readonly type: "transport-stopped" | "transport-stop-cancelled";
      readonly transitionId: string;
      readonly observedAtBeat: number;
    };

export type LiveAudioSnapshot = {
  readonly phase: LiveAudioEnginePhase;
  readonly bpm: number | null;
  readonly currentBeat: number;
  readonly activeMaterialByTrack: Readonly<Record<string, string>>;
  readonly pendingTransitionByTrack: Readonly<Record<string, string>>;
  readonly pendingMaterialByTrack: Readonly<Record<string, string | null>>;
  readonly error: LiveAudioError | null;
};

export type LiveAudioEngine = {
  readonly initialize: (bpm: number) => void;
  readonly unlock: () => Promise<void>;
  readonly start: (atBeat?: number) => void;
  readonly suspend: () => void;
  readonly resume: () => void;
  readonly scheduleTransitions: (
    requests: readonly LiveTransitionRequest[],
  ) => Promise<LiveScheduleResult>;
  readonly cancelTransition: (transitionId: string) => boolean;
  readonly scheduleTransportStop: (request: {
    readonly transitionId: string;
    readonly targetBeat: number;
  }) => LiveScheduleResult;
  readonly cancelTransportStop: (transitionId: string) => boolean;
  readonly stop: () => void;
  readonly reset: () => void;
  readonly dispose: () => void;
  readonly getSnapshot: () => LiveAudioSnapshot;
  readonly subscribe: (listener: (observation: LiveAudioObservation) => void) => () => void;
};

type ScheduledSource = {
  readonly request: LiveTransitionRequest;
  readonly prepared: LivePreparedMaterial | null;
  readonly handles: Set<LiveScheduleHandle>;
  cutoffBeat: number | null;
  disposed: boolean;
};

type TrackRuntime = {
  readonly bus: LiveTrackBus;
  active: ScheduledSource | null;
  pending: ScheduledSource | null;
};

export function createLiveAudioEngine(input: {
  readonly port: LiveAudioPort;
  readonly prepareMaterial: LiveMaterialPreparer;
}): LiveAudioEngine {
  const { port, prepareMaterial } = input;
  const tracks = new Map<string, TrackRuntime>();
  const inFlightTracks = new Map<string, symbol>();
  const listeners = new Set<(observation: LiveAudioObservation) => void>();
  let phase: LiveAudioEnginePhase = "new";
  let bpm: number | null = null;
  let unlocked = false;
  let lastError: LiveAudioError | null = null;
  let transportStop: { transitionId: string; handle: LiveScheduleHandle } | null = null;
  let lifecycleGeneration = 0;

  function getTrack(trackId: string): TrackRuntime {
    let track = tracks.get(trackId);
    if (!track) {
      track = { bus: port.createTrackBus(trackId), active: null, pending: null };
      tracks.set(trackId, track);
    }
    return track;
  }

  function emit(observation: LiveAudioObservation): void {
    for (const listener of listeners) listener(observation);
  }

  function failed(error: LiveAudioError): LiveScheduleResult {
    lastError = error;
    return { ok: false, error };
  }

  function currentBeat(): number {
    return nonNegativeFinite(port.currentBeat(), "current beat");
  }

  function requireUsable(): void {
    if (phase === "disposed") {
      throw fault("disposed", "live audio engine is disposed");
    }
    if (bpm === null || phase === "new") {
      throw fault("invalid_state", "live audio engine must be initialized first");
    }
  }

  function clearSource(
    source: ScheduledSource | null,
    audioTime?: number,
  ): void {
    if (!source || source.disposed) return;
    source.disposed = true;
    for (const handle of source.handles) port.cancel(handle);
    source.handles.clear();
    source.prepared?.releaseAll(audioTime);
    source.prepared?.dispose(audioTime);
  }

  function clearTrackSources(track: TrackRuntime, audioTime?: number): void {
    clearSource(track.pending, audioTime);
    if (track.active !== track.pending) clearSource(track.active, audioTime);
    track.pending = null;
    track.active = null;
  }

  function scheduleSource(track: TrackRuntime, source: ScheduledSource): void {
    if (!source.prepared) return;
    // Pure planner validates generic event bounds independently from the port.
    planLiveLoopOccurrences({
      materialId: source.prepared.materialId,
      lengthBeats: source.prepared.lengthBeats,
      activationBeat: source.request.targetBeat,
      windowStartBeat: source.request.targetBeat,
      windowEndBeat: source.request.targetBeat + source.prepared.lengthBeats,
      events: source.prepared.events,
    });
    for (const event of source.prepared.events) {
      const handle = port.scheduleRepeatAtBeat(
        source.request.targetBeat + event.startBeat,
        source.prepared.lengthBeats,
        (audioTime, occurrenceBeat) => {
          if (source.disposed) return;
          if (source.cutoffBeat !== null && occurrenceBeat >= source.cutoffBeat) return;
          if (track.active !== source && track.pending !== source) return;
          source.prepared?.trigger(event, audioTime, bpm as number);
        },
      );
      source.handles.add(handle);
    }
  }

  function scheduleBoundary(track: TrackRuntime, source: ScheduledSource): void {
    let handle: LiveScheduleHandle;
    handle = port.scheduleAtBeat(source.request.targetBeat, (audioTime) => {
      source.handles.delete(handle);
      if (source.disposed || track.pending !== source) return;
      const previous = track.active;
      track.pending = null;
      if (source.request.kind === "launch") {
        track.active = source;
      } else {
        track.active = null;
      }
      if (previous && previous !== source) clearSource(previous, audioTime);
      if (source.request.kind === "stop") clearSource(source, audioTime);
      emit({
        type: "transition-executed",
        transitionId: source.request.transitionId,
        groupId: source.request.groupId,
        trackId: source.request.trackId,
        targetBeat: source.request.targetBeat,
        observedAtBeat: Math.max(currentBeat(), source.request.targetBeat),
        materialId: source.prepared?.materialId ?? null,
        materialKind: source.prepared?.kind ?? null,
      });
    });
    source.handles.add(handle);
  }

  function rollbackSources(sources: readonly ScheduledSource[]): void {
    for (const source of sources) {
      const track = tracks.get(source.request.trackId);
      if (track?.pending === source) track.pending = null;
      if (track?.active) track.active.cutoffBeat = null;
      clearSource(source);
    }
  }

  function cleanupAll(disposeBuses: boolean, audioTime?: number): void {
    if (transportStop) {
      port.cancel(transportStop.handle);
      transportStop = null;
    }
    for (const track of tracks.values()) {
      clearTrackSources(track, audioTime);
      if (disposeBuses) track.bus.dispose();
    }
    if (disposeBuses) tracks.clear();
  }

  const engine: LiveAudioEngine = {
    initialize(nextBpm) {
      if (phase === "disposed") throw fault("disposed", "live audio engine is disposed");
      if (phase === "running" || phase === "suspended") {
        throw fault("invalid_state", `cannot initialize live audio while ${phase}`);
      }
      if (
        transportStop ||
        inFlightTracks.size > 0 ||
        [...tracks.values()].some((track) => track.active || track.pending)
      ) {
        throw fault("invalid_state", "cannot initialize live audio while work is owned");
      }
      bpm = positiveFinite(nextBpm, "bpm");
      lifecycleGeneration += 1;
      port.setBpm(bpm);
      lastError = null;
      phase = unlocked ? "ready" : "initialized";
    },

    async unlock() {
      requireUsable();
      if (unlocked) return;
      const unlockGeneration = lifecycleGeneration;
      try {
        await port.unlock();
      } catch (cause) {
        if (unlockGeneration !== lifecycleGeneration) {
          throw fault(
            phase === "disposed" ? "disposed" : "invalid_state",
            "live audio lifecycle changed while browser audio was unlocking",
            cause,
          );
        }
        lastError = audioError(
          "autoplay_rejected",
          "Browser audio could not start. Use an explicit user gesture and retry.",
          cause,
        );
        phase = "blocked";
        throw new LiveAudioEngineFault(lastError);
      }
      if (unlockGeneration !== lifecycleGeneration) {
        throw fault(
          phase === "disposed" ? "disposed" : "invalid_state",
          "live audio lifecycle changed while browser audio was unlocking",
        );
      }
      unlocked = true;
      phase = "ready";
      lastError = null;
    },

    start(atBeat = currentBeat()) {
      requireUsable();
      if (!unlocked || (phase !== "ready" && phase !== "stopped")) {
        if (phase === "running") return;
        throw fault("invalid_state", `cannot start live audio while ${phase}`);
      }
      port.start(nonNegativeFinite(atBeat, "start beat"));
      phase = "running";
    },

    suspend() {
      requireUsable();
      if (phase !== "running") throw fault("invalid_state", `cannot suspend while ${phase}`);
      port.suspend();
      phase = "suspended";
    },

    resume() {
      requireUsable();
      if (phase !== "suspended") throw fault("invalid_state", `cannot resume while ${phase}`);
      port.resume();
      phase = "running";
    },

    async scheduleTransitions(requests) {
      requireUsable();
      lastError = null;
      if (requests.length === 0) {
        return failed(audioError("invalid_request", "transition batch is empty"));
      }
      const now = currentBeat();
      const seenTracks = new Set<string>();
      const seenIds = new Set<string>();
      try {
        for (const request of requests) {
          identifier(request.transitionId, "transitionId");
          identifier(request.trackId, "trackId");
          nonNegativeFinite(request.targetBeat, "targetBeat");
          if (request.targetBeat < now) {
            throw fault(
              "schedule_failed",
              `transition ${request.transitionId} missed target beat ${request.targetBeat}`,
            );
          }
          if (seenTracks.has(request.trackId)) {
            throw fault("invalid_request", `batch contains duplicate track ${request.trackId}`);
          }
          if (seenIds.has(request.transitionId)) {
            throw fault("invalid_request", `batch contains duplicate transition ${request.transitionId}`);
          }
          seenTracks.add(request.trackId);
          seenIds.add(request.transitionId);
          if (inFlightTracks.has(request.trackId)) {
            throw fault(
              "invalid_state",
              `track ${request.trackId} already has material preparation in flight`,
            );
          }
          if (request.kind === "launch") validateLiveClipMaterial(request.material);
          const track = getTrack(request.trackId);
          if (track.pending) {
            if (sameRequest(track.pending.request, request)) continue;
            throw fault(
              "invalid_state",
              `track ${request.trackId} already has transition ${track.pending.request.transitionId}`,
            );
          }
        }
      } catch (error) {
        return failed(errorDetail(error, "invalid_request"));
      }

      const retryCount = requests.filter((request) => {
        const pending = tracks.get(request.trackId)?.pending;
        return Boolean(pending && sameRequest(pending.request, request));
      }).length;
      if (retryCount === requests.length) {
        return {
          ok: true,
          transitionIds: Object.freeze(requests.map((request) => request.transitionId)),
        };
      }
      if (retryCount > 0) {
        return failed(
          audioError(
            "invalid_request",
            "a transition batch cannot mix exact retries with new work",
          ),
        );
      }

      const reservation = Symbol("live-transition-batch");
      const scheduleGeneration = lifecycleGeneration;
      for (const request of requests) inFlightTracks.set(request.trackId, reservation);

      const prepared: Array<LivePreparedMaterial | null> = [];
      try {
        try {
          for (const request of requests) {
            prepared.push(
              request.kind === "launch"
                ? await prepareMaterial(request.material, getTrack(request.trackId).bus)
                : null,
            );
          }
        } catch (error) {
          for (const source of prepared) {
            source?.releaseAll();
            source?.dispose();
          }
          return failed(errorDetail(error, "material_not_ready"));
        }

        if (scheduleGeneration !== lifecycleGeneration) {
          for (const source of prepared) {
            source?.releaseAll();
            source?.dispose();
          }
          return failed(
            audioError(
              phase === "disposed" ? "disposed" : "invalid_state",
              "live audio lifecycle changed during material preparation",
            ),
          );
        }

        const afterPreparationBeat = currentBeat();
        const missed = requests.find((request) => request.targetBeat < afterPreparationBeat);
        if (missed) {
          for (const source of prepared) {
            source?.releaseAll();
            source?.dispose();
          }
          return failed(
            audioError(
              "schedule_failed",
              `transition ${missed.transitionId} missed target beat ${missed.targetBeat} during material preparation`,
            ),
          );
        }

        const sources: ScheduledSource[] = [];
        try {
          requests.forEach((request, index) => {
            const track = getTrack(request.trackId);
            if (track.pending && sameRequest(track.pending.request, request)) return;
            const preparedMaterial = prepared[index] ?? null;
            if (request.kind === "launch") {
              validatePreparedMaterial(request.material, preparedMaterial);
            }
            const source: ScheduledSource = {
              request,
              prepared: preparedMaterial,
              handles: new Set(),
              cutoffBeat: null,
              disposed: false,
            };
            if (track.active) track.active.cutoffBeat = request.targetBeat;
            track.pending = source;
            sources.push(source);
            scheduleSource(track, source);
            scheduleBoundary(track, source);
          });
        } catch (error) {
          rollbackSources(sources);
          const owned = new Set(sources.map((source) => source.prepared));
          for (const source of prepared) {
            if (source && !owned.has(source)) {
              source.releaseAll();
              source.dispose();
            }
          }
          return failed(errorDetail(error, "schedule_failed"));
        }
        lastError = null;
        return Object.freeze({
          ok: true as const,
          transitionIds: Object.freeze(requests.map((request) => request.transitionId)),
        });
      } finally {
        for (const request of requests) {
          if (inFlightTracks.get(request.trackId) === reservation) {
            inFlightTracks.delete(request.trackId);
          }
        }
      }
    },

    cancelTransition(transitionId) {
      identifier(transitionId, "transitionId");
      for (const [trackId, track] of tracks) {
        const pending = track.pending;
        if (pending?.request.transitionId !== transitionId) continue;
        track.pending = null;
        if (track.active) track.active.cutoffBeat = null;
        clearSource(pending);
        emit({
          type: "transition-cancelled",
          transitionId,
          groupId: pending.request.groupId,
          trackId,
          observedAtBeat: currentBeat(),
        });
        return true;
      }
      return false;
    },

    scheduleTransportStop(request) {
      requireUsable();
      lastError = null;
      identifier(request.transitionId, "transitionId");
      const targetBeat = nonNegativeFinite(request.targetBeat, "targetBeat");
      if (transportStop) {
        return transportStop.transitionId === request.transitionId
          ? { ok: true, transitionIds: Object.freeze([request.transitionId]) }
          : failed(audioError("invalid_state", "a transport stop is already scheduled"));
      }
      if (targetBeat < currentBeat()) {
        return failed(
          audioError("schedule_failed", `transport stop missed beat ${targetBeat}`),
        );
      }
      try {
        let handle: LiveScheduleHandle;
        handle = port.scheduleAtBeat(targetBeat, (audioTime) => {
          if (transportStop?.handle !== handle) return;
          transportStop = null;
          lifecycleGeneration += 1;
          cleanupAll(false, audioTime);
          port.stop(audioTime);
          phase = "stopped";
          emit({
            type: "transport-stopped",
            transitionId: request.transitionId,
            observedAtBeat: Math.max(currentBeat(), targetBeat),
          });
        });
        transportStop = { transitionId: request.transitionId, handle };
        return { ok: true, transitionIds: Object.freeze([request.transitionId]) };
      } catch (error) {
        return failed(errorDetail(error, "schedule_failed"));
      }
    },

    cancelTransportStop(transitionId) {
      identifier(transitionId, "transitionId");
      if (!transportStop || transportStop.transitionId !== transitionId) return false;
      port.cancel(transportStop.handle);
      transportStop = null;
      emit({
        type: "transport-stop-cancelled",
        transitionId,
        observedAtBeat: currentBeat(),
      });
      return true;
    },

    stop() {
      requireUsable();
      lifecycleGeneration += 1;
      cleanupAll(false);
      port.stop();
      phase = "stopped";
    },

    reset() {
      requireUsable();
      lifecycleGeneration += 1;
      cleanupAll(true);
      port.reset();
      lastError = null;
      phase = unlocked ? "ready" : "initialized";
    },

    dispose() {
      if (phase === "disposed") return;
      lifecycleGeneration += 1;
      cleanupAll(true);
      port.dispose();
      listeners.clear();
      phase = "disposed";
    },

    getSnapshot() {
      const activeMaterialByTrack: Record<string, string> = {};
      const pendingTransitionByTrack: Record<string, string> = {};
      const pendingMaterialByTrack: Record<string, string | null> = {};
      for (const [trackId, track] of tracks) {
        if (track.active?.prepared) {
          activeMaterialByTrack[trackId] = track.active.prepared.materialId;
        }
        if (track.pending) {
          pendingTransitionByTrack[trackId] = track.pending.request.transitionId;
          pendingMaterialByTrack[trackId] = track.pending.prepared?.materialId ?? null;
        }
      }
      return Object.freeze({
        phase,
        bpm,
        currentBeat: phase === "new" || phase === "disposed" ? 0 : currentBeat(),
        activeMaterialByTrack: Object.freeze(activeMaterialByTrack),
        pendingTransitionByTrack: Object.freeze(pendingTransitionByTrack),
        pendingMaterialByTrack: Object.freeze(pendingMaterialByTrack),
        error: lastError,
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return engine;
}

function validatePreparedMaterial(
  requested: LiveClipMaterial,
  prepared: LivePreparedMaterial | null,
): asserts prepared is LivePreparedMaterial {
  if (!prepared) throw fault("material_not_ready", "material preparation returned nothing");
  if (
    prepared.kind !== requested.kind ||
    prepared.materialId !== requested.materialId ||
    prepared.version !== requested.version ||
    prepared.clipId !== requested.clipId ||
    prepared.lengthBeats !== requested.lengthBeats
  ) {
    throw fault("material_not_ready", `prepared material ${requested.materialId} is stale`);
  }
}

function sameRequest(left: LiveTransitionRequest, right: LiveTransitionRequest): boolean {
  return (
    left.kind === right.kind &&
    left.transitionId === right.transitionId &&
    left.groupId === right.groupId &&
    left.trackId === right.trackId &&
    left.targetBeat === right.targetBeat &&
    (left.kind === "stop" ||
      (right.kind === "launch" &&
        left.material.kind === right.material.kind &&
        left.material.materialId === right.material.materialId &&
        left.material.version === right.material.version &&
        left.material.clipId === right.material.clipId &&
        left.material.lengthBeats === right.material.lengthBeats))
  );
}

function errorDetail(error: unknown, fallback: LiveAudioErrorCode): LiveAudioError {
  if (error instanceof LiveAudioEngineFault) return error.detail;
  return audioError(
    fallback,
    error instanceof Error ? error.message : String(error),
    error,
  );
}

function fault(code: LiveAudioErrorCode, message: string, cause?: unknown): LiveAudioEngineFault {
  return new LiveAudioEngineFault(audioError(code, message, cause));
}

function audioError(
  code: LiveAudioErrorCode,
  message: string,
  cause?: unknown,
): LiveAudioError {
  return Object.freeze({ code, message, ...(cause === undefined ? {} : { cause }) });
}

function positiveFinite(value: number, label: string): number {
  const number = finite(value, label);
  if (number <= 0) throw fault("invalid_request", `${label} must be positive`);
  return number;
}

function nonNegativeFinite(value: number, label: string): number {
  const number = finite(value, label);
  if (number < 0) throw fault("invalid_request", `${label} must be non-negative`);
  return number;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw fault("invalid_request", `${label} must be finite`);
  return value;
}

function identifier(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw fault("invalid_request", `${label} must not be empty`);
  }
}
