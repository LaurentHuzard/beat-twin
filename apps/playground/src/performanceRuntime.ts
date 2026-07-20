export type LaunchQuantization = "immediate" | "beat" | "bar";

export type PerformanceMacroId = "tone" | "space" | "echo" | "repeat";

export type PerformanceRecordingState =
  | {
      readonly phase: "idle";
      readonly trackId: null;
      readonly slotId: null;
      readonly clipId: null;
    }
  | {
      readonly phase: "armed" | "recording";
      readonly trackId: string;
      readonly slotId: string;
      readonly clipId: string | null;
    }
  | {
      readonly phase: "overdubbing";
      readonly trackId: string;
      readonly slotId: string;
      readonly clipId: string;
    };

type PerformanceTransitionBase = {
  readonly id: string;
  readonly requestedAtBeat: number;
  readonly targetBeat: number;
  readonly sceneId: string | null;
  readonly groupId: string | null;
};

type PerformanceTransitionPayload =
  | {
      readonly kind: "launch";
      readonly clipId: string;
    }
  | {
      readonly kind: "stop";
    };

export type PendingPerformanceTransition = PerformanceTransitionBase &
  PerformanceTransitionPayload & {
    readonly status: "pending" | "scheduled";
  };

export type ResolvedPerformanceTransition =
  | (PerformanceTransitionBase & PerformanceTransitionPayload & {
      readonly status: "executed";
      readonly observedAtBeat: number;
    })
  | (PerformanceTransitionBase & PerformanceTransitionPayload & {
      readonly status: "failed";
      readonly observedAtBeat: number;
      readonly error: string;
    })
  | (PerformanceTransitionBase & PerformanceTransitionPayload & {
      readonly status: "cancelled";
      readonly observedAtBeat: number;
      readonly reason: "player" | "replaced" | "engine" | "material-replaced";
    });

export type PerformanceTrackState = {
  readonly activeClipId: string | null;
  readonly activeTransitionId: string | null;
  readonly pendingTransition: PendingPerformanceTransition | null;
  readonly lastResolvedTransition: ResolvedPerformanceTransition | null;
  readonly level: number;
  readonly muted: boolean;
  readonly soloed: boolean;
};

export type PerformanceState = {
  readonly phase: "idle" | "playing" | "stopping";
  readonly currentBeat: number;
  /** One-based musical bar number derived from currentBeat. */
  readonly currentBar: number;
  readonly beatsPerBar: number;
  readonly launchQuantization: LaunchQuantization;
  readonly transportStop: Readonly<{
    readonly id: string;
    readonly requestedAtBeat: number;
    readonly targetBeat: number;
    readonly status: "pending" | "scheduled";
  }> | null;
  /** Persistent material revision last reconciled by the browser store. */
  readonly materialVersion: number;
  readonly tracks: Readonly<Record<string, PerformanceTrackState>>;
  /** Exactly one recording or overdub target exists across all tracks. */
  readonly recording: PerformanceRecordingState;
  readonly macros: Readonly<Record<PerformanceMacroId, number>>;
  /** Claimed IDs remain reserved until ResetPerformance. */
  readonly transitionIds: Readonly<Record<string, true>>;
  /** Capacity pressure fails closed; reset is the only cleanup boundary. */
  readonly transitionIdCapacity: number;
};

export const MAX_RETAINED_PERFORMANCE_TRANSITION_IDS = 4_096;

export type PerformanceMaterialSnapshot = {
  readonly version: number;
  readonly clipIdsByTrack: Readonly<Record<string, readonly string[]>>;
};

export type PerformanceSceneSlot = {
  readonly trackId: string;
  /** A null clip queues a stop for this scene row. */
  readonly clipId: string | null;
};

export type PerformanceAction =
  | { readonly type: "StartTransport"; readonly atBeat?: number }
  | {
      readonly type: "StopTransport";
      readonly transitionId: string;
      readonly requestedAtBeat: number;
      readonly quantization?: LaunchQuantization;
    }
  | { readonly type: "AdvanceClock"; readonly beat: number }
  | { readonly type: "MarkTransportStopScheduled"; readonly transitionId: string }
  | {
      readonly type: "CancelPendingTransportStop";
      readonly transitionId: string;
      readonly cancelledAtBeat: number;
    }
  | {
      readonly type: "ObserveTransportStopCancelled";
      readonly transitionId: string;
      readonly observedAtBeat: number;
    }
  | {
      readonly type: "ObserveTransportStopped";
      readonly transitionId: string;
      readonly observedAtBeat: number;
    }
  | {
      readonly type: "SetLaunchQuantization";
      readonly quantization: LaunchQuantization;
    }
  | {
      readonly type: "LaunchClip";
      readonly transitionId: string;
      readonly trackId: string;
      readonly clipId: string;
      readonly requestedAtBeat: number;
      readonly quantization?: LaunchQuantization;
    }
  | {
      /** Replace current material at one exact, strictly-future loop boundary. */
      readonly type: "RefreshActiveClip";
      readonly transitionId: string;
      readonly trackId: string;
      readonly clipId: string;
      readonly requestedAtBeat: number;
      readonly targetBeat: number;
    }
  | {
      readonly type: "StopTrack";
      readonly transitionId: string;
      readonly trackId: string;
      readonly requestedAtBeat: number;
      readonly quantization?: LaunchQuantization;
    }
  | {
      readonly type: "LaunchScene";
      readonly transitionId: string;
      readonly sceneId: string;
      readonly slots: readonly PerformanceSceneSlot[];
      readonly requestedAtBeat: number;
      readonly quantization?: LaunchQuantization;
    }
  | {
      readonly type: "MarkTransitionScheduled";
      readonly trackId: string;
      readonly transitionId: string;
    }
  | {
      readonly type: "RequeueScheduledTransition";
      readonly trackId: string;
      readonly transitionId: string;
    }
  | { readonly type: "RequeueScheduledScene"; readonly groupId: string }
  | {
      readonly type: "ObserveTransitionExecuted";
      readonly trackId: string;
      readonly transitionId: string;
      readonly observedAtBeat: number;
    }
  | {
      readonly type: "ObserveTransitionFailed";
      readonly trackId: string;
      readonly transitionId: string;
      readonly observedAtBeat: number;
      readonly error: string;
    }
  | {
      readonly type: "CancelPendingTransition";
      readonly trackId: string;
      readonly transitionId: string;
      readonly cancelledAtBeat: number;
    }
  | {
      readonly type: "ObserveTransitionCancelled";
      readonly trackId: string;
      readonly transitionId: string;
      readonly observedAtBeat: number;
    }
  | { readonly type: "MarkSceneScheduled"; readonly groupId: string }
  | {
      readonly type: "CancelPendingScene";
      readonly groupId: string;
      readonly cancelledAtBeat: number;
    }
  | {
      readonly type: "ObserveSceneCancelled";
      readonly groupId: string;
      readonly observedAtBeat: number;
    }
  | {
      readonly type: "ObserveSceneFailed";
      readonly groupId: string;
      readonly observedAtBeat: number;
      readonly error: string;
    }
  | {
      readonly type: "ArmRecordSlot";
      readonly trackId: string;
      readonly slotId: string;
      readonly clipId: string | null;
    }
  | { readonly type: "StartRecording"; readonly trackId: string }
  | { readonly type: "StopRecording"; readonly trackId: string }
  | {
      readonly type: "StartOverdub";
      readonly trackId: string;
      readonly slotId: string;
      readonly clipId: string;
    }
  | { readonly type: "StopOverdub"; readonly trackId: string }
  | { readonly type: "CancelRecording"; readonly trackId: string }
  | { readonly type: "SetTrackLevel"; readonly trackId: string; readonly level: number }
  | { readonly type: "SetTrackMute"; readonly trackId: string; readonly muted: boolean }
  | { readonly type: "SetTrackSolo"; readonly trackId: string; readonly soloed: boolean }
  | { readonly type: "SetMacro"; readonly macro: PerformanceMacroId; readonly value: number }
  | { readonly type: "ResetPerformance" };

const defaultMacros: Readonly<Record<PerformanceMacroId, number>> = Object.freeze({
  tone: 0,
  space: 0,
  echo: 0,
  repeat: 0,
});

export function createPerformanceState(input: {
  readonly beatsPerBar?: number;
  readonly launchQuantization?: LaunchQuantization;
  readonly materialVersion?: number;
  readonly transitionIdCapacity?: number;
} = {}): PerformanceState {
  const beatsPerBar = positiveFinite(input.beatsPerBar ?? 4, "beatsPerBar");
  const launchQuantization = input.launchQuantization ?? "bar";
  assertLaunchQuantization(launchQuantization);
  return freezeState({
    phase: "idle",
    currentBeat: 0,
    currentBar: 1,
    beatsPerBar,
    launchQuantization,
    transportStop: null,
    materialVersion: nonNegativeInteger(input.materialVersion ?? 0, "materialVersion"),
    tracks: {},
    recording: idleRecording(),
    macros: defaultMacros,
    transitionIds: {},
    transitionIdCapacity: positiveInteger(
      input.transitionIdCapacity ?? MAX_RETAINED_PERFORMANCE_TRANSITION_IDS,
      "transitionIdCapacity",
    ),
  });
}

export function resetPerformanceForMaterial(
  state: PerformanceState,
  material: PerformanceMaterialSnapshot,
): PerformanceState {
  validateMaterialSnapshot(material);
  return createPerformanceState({
    beatsPerBar: state.beatsPerBar,
    launchQuantization: state.launchQuantization,
    materialVersion: material.version,
    transitionIdCapacity: state.transitionIdCapacity,
  });
}

/**
 * Remove runtime references that no longer exist after a persistent document
 * change. This contract accepts IDs only so the reducer never imports Song.
 */
export function reconcilePerformanceMaterial(
  state: PerformanceState,
  material: PerformanceMaterialSnapshot,
): PerformanceState {
  validateMaterialSnapshot(material);
  const clipIdsByTrack: Record<string, ReadonlySet<string>> = Object.fromEntries(
    Object.entries(material.clipIdsByTrack).map(([trackId, clipIds]) => [
      trackId,
      new Set(clipIds),
    ]),
  );
  const invalidGroupIds = new Set<string>();
  for (const [trackId, track] of Object.entries(state.tracks)) {
    const validClips = clipIdsByTrack[trackId];
    const pending = track.pendingTransition;
    if (
      pending &&
      pending.groupId !== null &&
      (!validClips || (pending.kind === "launch" && !validClips.has(pending.clipId)))
    ) {
      invalidGroupIds.add(pending.groupId);
    }
  }

  const tracks: Record<string, PerformanceTrackState> = {};
  for (const [trackId, track] of Object.entries(state.tracks)) {
    const validClips = clipIdsByTrack[trackId];
    if (!validClips) {
      continue;
    }
    const activeIsValid =
      track.activeClipId === null || validClips.has(track.activeClipId);
    const pendingIsValid =
      track.pendingTransition === null ||
      (track.pendingTransition.groupId !== null &&
      invalidGroupIds.has(track.pendingTransition.groupId)
        ? false
        : track.pendingTransition.kind === "stop" ||
          validClips.has(track.pendingTransition.clipId));
    const lastIsValid =
      track.lastResolvedTransition === null ||
      track.lastResolvedTransition.kind === "stop" ||
      validClips.has(track.lastResolvedTransition.clipId);
    const invalidPending = pendingIsValid ? null : track.pendingTransition;
    const invalidPendingPayloadIsStillValid =
      invalidPending !== null &&
      (invalidPending.kind === "stop" || validClips.has(invalidPending.clipId));
    tracks[trackId] = freezeTrack({
      ...track,
      activeClipId: activeIsValid ? track.activeClipId : null,
      activeTransitionId: activeIsValid ? track.activeTransitionId : null,
      pendingTransition: pendingIsValid ? track.pendingTransition : null,
      lastResolvedTransition: invalidPendingPayloadIsStillValid
        ? Object.freeze({
            ...withoutPendingStatus(invalidPending as PendingPerformanceTransition),
            status: "cancelled" as const,
            observedAtBeat: state.currentBeat,
            reason: "material-replaced" as const,
          })
        : lastIsValid
          ? track.lastResolvedTransition
          : null,
    });
  }

  const recording = recordingExistsInMaterial(state.recording, clipIdsByTrack)
    ? state.recording
    : idleRecording();
  return freezeState({
    ...state,
    materialVersion: material.version,
    tracks,
    recording,
  });
}

/**
 * Resolve a request once to a stable musical beat. Beat and bar quantization
 * are strictly future boundaries; an exact boundary therefore advances to the
 * next beat or bar. Immediate requests retain their exact request beat.
 */
export function resolveLaunchTargetBeat(
  requestedAtBeat: number,
  quantization: LaunchQuantization,
  beatsPerBar = 4,
): number {
  const beat = nonNegativeFinite(requestedAtBeat, "requestedAtBeat");
  const barLength = positiveFinite(beatsPerBar, "beatsPerBar");
  assertLaunchQuantization(quantization);
  if (quantization === "immediate") {
    return beat;
  }

  const quantum = quantization === "beat" ? 1 : barLength;
  return roundBeat((Math.floor(beat / quantum) + 1) * quantum);
}

export function reducePerformanceState(
  state: PerformanceState,
  action: PerformanceAction,
): PerformanceState {
  switch (action.type) {
    case "StartTransport": {
      const atBeat = nonNegativeFinite(action.atBeat ?? state.currentBeat, "atBeat");
      if (atBeat < state.currentBeat) {
        throw new Error(
          `transport cannot start behind current beat ${state.currentBeat}`,
        );
      }
      if (state.phase === "playing" || state.phase === "stopping") {
        return state;
      }
      if (state.transportStop !== null) {
        throw new Error("idle transport cannot start with an unresolved stop transition");
      }
      return freezeState({
        ...state,
        phase: "playing",
        currentBeat: atBeat,
        currentBar: barAtBeat(atBeat, state.beatsPerBar),
      });
    }

    case "StopTransport": {
      if (state.phase === "idle") {
        throw new Error("transport must be playing before stop can be requested");
      }
      const transitionId = requiredId(action.transitionId, "transitionId");
      assertRequestNotInPast(state, action.requestedAtBeat);
      const targetBeat = resolveLaunchTargetBeat(
        action.requestedAtBeat,
        action.quantization ?? state.launchQuantization,
        state.beatsPerBar,
      );
      if (state.transportStop !== null) {
        if (
          state.transportStop.id === transitionId &&
          state.transportStop.requestedAtBeat === action.requestedAtBeat &&
          state.transportStop.targetBeat === targetBeat
        ) {
          return state;
        }
        throw new Error(`transport stop ${state.transportStop.id} is already open`);
      }
      const next = reserveTransitionId(state, transitionId);
      return freezeState({
        ...next,
        phase: "stopping",
        transportStop: Object.freeze({
          id: transitionId,
          requestedAtBeat: action.requestedAtBeat,
          targetBeat,
          status: "pending" as const,
        }),
      });
    }

    case "AdvanceClock":
      return advanceClock(state, action.beat);

    case "MarkTransportStopScheduled": {
      const stop = requireTransportStop(state, action.transitionId);
      if (stop.status === "scheduled") {
        return state;
      }
      if (state.currentBeat > stop.targetBeat) {
        throw new Error(
          `transport stop ${stop.id} cannot be scheduled after target beat ${stop.targetBeat}`,
        );
      }
      return freezeState({
        ...state,
        transportStop: Object.freeze({ ...stop, status: "scheduled" as const }),
      });
    }

    case "CancelPendingTransportStop": {
      const stop = requireTransportStop(state, action.transitionId);
      if (stop.status !== "pending") {
        throw new Error(`transport stop ${stop.id} is scheduled, expected pending`);
      }
      validateTransportStopCancellation(state, stop, action.cancelledAtBeat);
      return freezeState({ ...state, phase: "playing", transportStop: null });
    }

    case "ObserveTransportStopCancelled": {
      const stop = requireTransportStop(state, action.transitionId);
      if (stop.status !== "scheduled") {
        throw new Error(`transport stop ${stop.id} is pending, expected scheduled`);
      }
      validateTransportStopCancellation(state, stop, action.observedAtBeat);
      return freezeState({ ...state, phase: "playing", transportStop: null });
    }

    case "ObserveTransportStopped": {
      const stop = requireTransportStop(state, action.transitionId);
      if (stop.status !== "scheduled") {
        throw new Error(`transport stop ${stop.id} must be scheduled before execution`);
      }
      const observedAtBeat = nonNegativeFinite(action.observedAtBeat, "observedAtBeat");
      if (observedAtBeat < stop.targetBeat) {
        throw new Error(
          `transport cannot stop before target beat ${stop.targetBeat}`,
        );
      }
      const tracks = Object.fromEntries(
        Object.entries(state.tracks).map(([trackId, track]) => [
          trackId,
          freezeTrack({
            ...track,
            activeClipId: null,
            activeTransitionId: null,
            pendingTransition: null,
          }),
        ]),
      );
      return freezeState({
        ...state,
        phase: "idle",
        currentBeat: Math.max(state.currentBeat, observedAtBeat),
        currentBar: barAtBeat(
          Math.max(state.currentBeat, observedAtBeat),
          state.beatsPerBar,
        ),
        transportStop: null,
        tracks,
        recording: idleRecording(),
      });
    }

    case "SetLaunchQuantization":
      assertLaunchQuantization(action.quantization);
      return state.launchQuantization === action.quantization
        ? state
        : freezeState({ ...state, launchQuantization: action.quantization });

    case "LaunchClip":
      return queueTrackTransition(state, {
        id: action.transitionId,
        kind: "launch",
        trackId: action.trackId,
        clipId: action.clipId,
        requestedAtBeat: action.requestedAtBeat,
        targetBeat: resolveActionTarget(state, action),
        sceneId: null,
        groupId: null,
      });

    case "RefreshActiveClip": {
      const trackId = requiredId(action.trackId, "trackId");
      const clipId = requiredId(action.clipId, "clipId");
      const requestedAtBeat = nonNegativeFinite(action.requestedAtBeat, "requestedAtBeat");
      const targetBeat = nonNegativeFinite(action.targetBeat, "targetBeat");
      if (state.tracks[trackId]?.activeClipId !== clipId) {
        throw new Error(`track ${trackId} must have clip ${clipId} active before refresh`);
      }
      if (targetBeat <= Math.max(state.currentBeat, requestedAtBeat)) {
        throw new Error("active clip refresh target must be strictly in the future");
      }
      return queueTrackTransition(state, {
        id: action.transitionId,
        kind: "launch",
        trackId,
        clipId,
        requestedAtBeat,
        targetBeat,
        sceneId: null,
        groupId: null,
        allowActiveRelaunch: true,
      });
    }

    case "StopTrack":
      return queueTrackTransition(state, {
        id: action.transitionId,
        kind: "stop",
        trackId: action.trackId,
        requestedAtBeat: action.requestedAtBeat,
        targetBeat: resolveActionTarget(state, action),
        sceneId: null,
        groupId: null,
      });

    case "LaunchScene": {
      const groupId = requiredId(action.transitionId, "transitionId");
      const sceneId = requiredId(action.sceneId, "sceneId");
      if (action.slots.length === 0) {
        throw new Error("scene slots must not be empty");
      }
      const targetBeat = resolveActionTarget(state, action);
      const seenTracks = new Set<string>();
      const inputs = action.slots.map((slot): QueueTrackTransitionInput => {
        const trackId = requiredId(slot.trackId, "trackId");
        if (seenTracks.has(trackId)) {
          throw new Error(`scene contains duplicate track ${trackId}`);
        }
        seenTracks.add(trackId);
        if (slot.clipId !== null) {
          identifier(slot.clipId, "clipId");
        }
        return {
          id: `${groupId}:${trackId}`,
          kind: slot.clipId === null ? "stop" : "launch",
          trackId,
          ...(slot.clipId === null ? {} : { clipId: slot.clipId }),
          requestedAtBeat: action.requestedAtBeat,
          targetBeat,
          sceneId,
          groupId,
        };
      });

      if (state.transitionIds[groupId]) {
        if (inputs.every((input) => isExactPendingRetry(state, input))) {
          return state;
        }
        throw new Error(`scene groupId ${groupId} is already in use`);
      }
      assertTransitionIdAvailable(state, groupId);
      for (const input of inputs) {
        validateQueueTrackTransition(state, input);
      }

      let next = reserveTransitionId(state, groupId);
      for (const input of inputs) {
        next = queueTrackTransition(next, input);
      }
      return next;
    }

    case "MarkTransitionScheduled":
      return updatePendingTransition(
        state,
        action.trackId,
        action.transitionId,
        (transition) => {
          if (transition.groupId !== null) {
            throw new Error(
              `transition ${transition.id} belongs to scene group ${transition.groupId}; use MarkSceneScheduled`,
            );
          }
          if (transition.status === "scheduled") {
            return transition;
          }
          if (state.currentBeat > transition.targetBeat) {
            throw new Error(
              `transition ${transition.id} cannot be scheduled after target beat ${transition.targetBeat}`,
            );
          }
          return Object.freeze({ ...transition, status: "scheduled" as const });
        },
      );

    case "RequeueScheduledTransition":
      return requeueScheduledTransition(state, action.trackId, action.transitionId);

    case "RequeueScheduledScene":
      return requeueScheduledScene(state, action.groupId);

    case "ObserveTransitionExecuted":
      return resolveObservedTransition(state, action, "executed");

    case "ObserveTransitionFailed":
      return resolveObservedTransition(state, action, "failed");

    case "CancelPendingTransition":
      return cancelTransition(state, action, "pending", "player");

    case "ObserveTransitionCancelled":
      return cancelTransition(
        state,
        {
          trackId: action.trackId,
          transitionId: action.transitionId,
          cancelledAtBeat: action.observedAtBeat,
        },
        "scheduled",
        "engine",
      );

    case "MarkSceneScheduled":
      return updateSceneGroup(state, action.groupId, "pending", (transition) => {
        if (state.currentBeat > transition.targetBeat) {
          throw new Error(
            `scene group ${action.groupId} cannot be scheduled after target beat ${transition.targetBeat}`,
          );
        }
        return Object.freeze({ ...transition, status: "scheduled" as const });
      });

    case "CancelPendingScene":
      return resolveSceneGroup(
        state,
        action.groupId,
        "pending",
        action.cancelledAtBeat,
        { status: "cancelled", reason: "player" },
      );

    case "ObserveSceneCancelled":
      return resolveSceneGroup(
        state,
        action.groupId,
        "scheduled",
        action.observedAtBeat,
        { status: "cancelled", reason: "engine" },
      );

    case "ObserveSceneFailed":
      return resolveSceneGroup(
        state,
        action.groupId,
        undefined,
        action.observedAtBeat,
        { status: "failed", error: action.error },
      );

    case "ArmRecordSlot": {
      const trackId = requiredId(action.trackId, "trackId");
      const slotId = requiredId(action.slotId, "slotId");
      const clipId = action.clipId === null ? null : requiredId(action.clipId, "clipId");
      if (state.recording.phase === "recording" || state.recording.phase === "overdubbing") {
        throw new Error(`cannot arm a slot while ${state.recording.phase}`);
      }
      return freezeState({
        ...state,
        recording: Object.freeze({
          phase: "armed" as const,
          trackId,
          slotId,
          clipId,
        }),
      });
    }

    case "StartRecording": {
      const trackId = requiredId(action.trackId, "trackId");
      if (state.recording.phase !== "armed" || state.recording.trackId !== trackId) {
        throw new Error(`track ${trackId} must own the armed slot before recording`);
      }
      return freezeState({
        ...state,
        recording: Object.freeze({ ...state.recording, phase: "recording" as const }),
      });
    }

    case "StopRecording": {
      const trackId = requiredId(action.trackId, "trackId");
      if (state.recording.phase !== "recording") {
        return state;
      }
      if (state.recording.trackId !== trackId) {
        throw new Error(`track ${trackId} does not own the recording target`);
      }
      return freezeState({ ...state, recording: idleRecording() });
    }

    case "StartOverdub": {
      const trackId = requiredId(action.trackId, "trackId");
      const slotId = requiredId(action.slotId, "slotId");
      const clipId = requiredId(action.clipId, "clipId");
      if (state.phase !== "playing") {
        throw new Error("transport must be playing before overdub");
      }
      if (state.tracks[trackId]?.activeClipId !== clipId) {
        throw new Error(`clip ${clipId} must be active on track ${trackId} before overdub`);
      }
      if (
        state.recording.phase !== "armed" ||
        state.recording.trackId !== trackId ||
        state.recording.slotId !== slotId ||
        state.recording.clipId !== clipId
      ) {
        throw new Error(`clip ${clipId} must own the armed slot before overdub`);
      }
      return freezeState({
        ...state,
        recording: Object.freeze({
          phase: "overdubbing" as const,
          trackId,
          slotId,
          clipId,
        }),
      });
    }

    case "StopOverdub": {
      const trackId = requiredId(action.trackId, "trackId");
      if (state.recording.phase !== "overdubbing") {
        return state;
      }
      if (state.recording.trackId !== trackId) {
        throw new Error(`track ${trackId} does not own the overdub target`);
      }
      return freezeState({ ...state, recording: idleRecording() });
    }

    case "CancelRecording": {
      const trackId = requiredId(action.trackId, "trackId");
      if (state.recording.phase === "idle") return state;
      if (state.recording.trackId !== trackId) {
        throw new Error(`track ${trackId} does not own the recording target`);
      }
      return freezeState({ ...state, recording: idleRecording() });
    }

    case "SetTrackLevel": {
      const level = unitInterval(action.level, "level");
      return updateTrack(state, action.trackId, (track) =>
        track.level === level ? track : { ...track, level },
      );
    }

    case "SetTrackMute": {
      const muted = booleanValue(action.muted, "muted");
      return updateTrack(state, action.trackId, (track) =>
        track.muted === muted ? track : { ...track, muted },
      );
    }

    case "SetTrackSolo": {
      const soloed = booleanValue(action.soloed, "soloed");
      return updateTrack(state, action.trackId, (track) =>
        track.soloed === soloed ? track : { ...track, soloed },
      );
    }

    case "SetMacro": {
      assertPerformanceMacro(action.macro);
      const value = unitInterval(action.value, "macro value");
      if (state.macros[action.macro] === value) {
        return state;
      }
      return freezeState({
        ...state,
        macros: { ...state.macros, [action.macro]: value },
      });
    }

    case "ResetPerformance":
      return createPerformanceState({
        beatsPerBar: state.beatsPerBar,
        launchQuantization: state.launchQuantization,
        materialVersion: state.materialVersion,
        transitionIdCapacity: state.transitionIdCapacity,
      });
  }
}

type QueueTrackTransitionInput = {
  readonly id: string;
  readonly kind: "launch" | "stop";
  readonly trackId: string;
  readonly clipId?: string;
  readonly requestedAtBeat: number;
  readonly targetBeat: number;
  readonly sceneId: string | null;
  readonly groupId: string | null;
  readonly allowActiveRelaunch?: boolean;
};

function queueTrackTransition(
  state: PerformanceState,
  input: QueueTrackTransitionInput,
): PerformanceState {
  validateQueueTrackTransition(state, input);
  const trackId = input.trackId;

  const track = state.tracks[trackId] ?? createTrackState();
  const pending: PendingPerformanceTransition = Object.freeze(
    input.kind === "launch"
      ? {
          id: input.id,
          kind: "launch" as const,
          clipId: input.clipId as string,
          requestedAtBeat: input.requestedAtBeat,
          targetBeat: input.targetBeat,
          sceneId: input.sceneId,
          groupId: input.groupId,
          status: "pending" as const,
        }
      : {
          id: input.id,
          kind: "stop" as const,
          requestedAtBeat: input.requestedAtBeat,
          targetBeat: input.targetBeat,
          sceneId: input.sceneId,
          groupId: input.groupId,
          status: "pending" as const,
        },
  );

  if (isExactPendingRetry(state, input)) {
    return state;
  }
  let next = reserveTransitionId(state, pending.id);

  if (
    pending.kind === "launch" &&
    track.activeClipId === pending.clipId &&
    !track.pendingTransition &&
    !input.allowActiveRelaunch
  ) {
    return next;
  }
  if (pending.kind === "stop" && track.activeClipId === null && !track.pendingTransition) {
    return next;
  }

  const replaced = track.pendingTransition;
  next = replaceTrack(next, trackId, {
    ...track,
    pendingTransition: pending,
    lastResolvedTransition: replaced
      ? Object.freeze({
          ...withoutPendingStatus(replaced),
          status: "cancelled" as const,
          observedAtBeat: input.requestedAtBeat,
          reason: "replaced" as const,
        })
      : track.lastResolvedTransition,
  });
  return next;
}

function advanceClock(state: PerformanceState, beatInput: number): PerformanceState {
  const beat = nonNegativeFinite(beatInput, "beat");
  if (beat < state.currentBeat) {
    throw new Error(`clock cannot move backward from ${state.currentBeat} to ${beat}`);
  }

  if (
    beat === state.currentBeat &&
    state.currentBar === barAtBeat(beat, state.beatsPerBar)
  ) {
    return state;
  }

  return freezeState({
    ...state,
    currentBeat: beat,
    currentBar: barAtBeat(beat, state.beatsPerBar),
  });
}

function requireTransportStop(
  state: PerformanceState,
  transitionIdInput: string,
): NonNullable<PerformanceState["transportStop"]> {
  const transitionId = requiredId(transitionIdInput, "transitionId");
  if (state.phase !== "stopping" || state.transportStop === null) {
    throw new Error("transport is not waiting for a stop transition");
  }
  if (state.transportStop.id !== transitionId) {
    throw new Error(
      `transport stop ${transitionId} does not match open transition ${state.transportStop.id}`,
    );
  }
  return state.transportStop;
}

function validateTransportStopCancellation(
  state: PerformanceState,
  stop: NonNullable<PerformanceState["transportStop"]>,
  observedAtBeatInput: number,
): void {
  const observedAtBeat = nonNegativeFinite(observedAtBeatInput, "observedAtBeat");
  if (
    observedAtBeat < state.currentBeat ||
    observedAtBeat < stop.requestedAtBeat ||
    observedAtBeat > stop.targetBeat
  ) {
    throw new Error(
      `transport stop ${stop.id} cancellation must be between current/request beat and target beat ${stop.targetBeat}`,
    );
  }
}

function updatePendingTransition(
  state: PerformanceState,
  trackIdInput: string,
  transitionIdInput: string,
  update: (transition: PendingPerformanceTransition) => PendingPerformanceTransition,
): PerformanceState {
  const trackId = requiredId(trackIdInput, "trackId");
  const transitionId = requiredId(transitionIdInput, "transitionId");
  const track = state.tracks[trackId];
  if (!track?.pendingTransition || track.pendingTransition.id !== transitionId) {
    throw new Error(`transition ${transitionId} is not pending on track ${trackId}`);
  }
  const pendingTransition = update(track.pendingTransition);
  return pendingTransition === track.pendingTransition
    ? state
    : replaceTrack(state, trackId, { ...track, pendingTransition });
}

function resolveObservedTransition(
  state: PerformanceState,
  action: {
    readonly trackId: string;
    readonly transitionId: string;
    readonly observedAtBeat: number;
    readonly error?: string;
  },
  outcome: "executed" | "failed",
): PerformanceState {
  const trackId = requiredId(action.trackId, "trackId");
  const transitionId = requiredId(action.transitionId, "transitionId");
  const track = state.tracks[trackId];
  const pending = track?.pendingTransition;
  if (!track || !pending || pending.id !== transitionId) {
    throw new Error(`transition ${transitionId} is not pending on track ${trackId}`);
  }
  const observedAtBeat = nonNegativeFinite(action.observedAtBeat, "observedAtBeat");
  if (outcome === "executed") {
    if (pending.status !== "scheduled") {
      throw new Error(`transition ${transitionId} must be scheduled before execution`);
    }
    if (observedAtBeat < pending.targetBeat) {
      throw new Error(
        `transition ${transitionId} cannot execute before target beat ${pending.targetBeat}`,
      );
    }
    const resolved: ResolvedPerformanceTransition = Object.freeze({
      ...withoutPendingStatus(pending),
      status: "executed",
      observedAtBeat,
    });
    return replaceTrack(state, trackId, {
      ...track,
      activeClipId: pending.kind === "launch" ? pending.clipId : null,
      activeTransitionId: pending.kind === "launch" ? pending.id : null,
      pendingTransition: null,
      lastResolvedTransition: resolved,
    });
  }

  if (pending.groupId !== null) {
    throw new Error(
      `transition ${transitionId} belongs to scene group ${pending.groupId}; use ObserveSceneFailed`,
    );
  }
  if (observedAtBeat < pending.requestedAtBeat) {
    throw new Error(
      `transition ${transitionId} cannot fail before request beat ${pending.requestedAtBeat}`,
    );
  }
  const error = action.error?.trim();
  if (!error) {
    throw new Error("failed transition observation requires an error");
  }
  const resolved: ResolvedPerformanceTransition = Object.freeze({
    ...withoutPendingStatus(pending),
    status: "failed",
    observedAtBeat,
    error,
  });
  return replaceTrack(state, trackId, {
    ...track,
    pendingTransition: null,
    lastResolvedTransition: resolved,
  });
}

function cancelTransition(
  state: PerformanceState,
  action: {
    readonly trackId: string;
    readonly transitionId: string;
    readonly cancelledAtBeat: number;
  },
  expectedStatus: "pending" | "scheduled",
  reason: "player" | "engine",
): PerformanceState {
  const trackId = requiredId(action.trackId, "trackId");
  const transitionId = requiredId(action.transitionId, "transitionId");
  const track = state.tracks[trackId];
  const pending = track?.pendingTransition;
  if (!track || !pending || pending.id !== transitionId) {
    throw new Error(`transition ${transitionId} is not pending on track ${trackId}`);
  }
  if (pending.groupId !== null) {
    const operation = expectedStatus === "pending" ? "CancelPendingScene" : "ObserveSceneCancelled";
    throw new Error(
      `transition ${transitionId} belongs to scene group ${pending.groupId}; use ${operation}`,
    );
  }
  if (pending.status !== expectedStatus) {
    throw new Error(
      `transition ${transitionId} is ${pending.status}, expected ${expectedStatus}`,
    );
  }
  const cancelledAtBeat = nonNegativeFinite(action.cancelledAtBeat, "cancelledAtBeat");
  if (
    cancelledAtBeat < state.currentBeat ||
    cancelledAtBeat < pending.requestedAtBeat ||
    cancelledAtBeat > pending.targetBeat
  ) {
    throw new Error(
      `transition ${transitionId} cancellation must be between current/request beat and target beat ${pending.targetBeat}`,
    );
  }
  const resolved: ResolvedPerformanceTransition = Object.freeze({
    ...withoutPendingStatus(pending),
    status: "cancelled",
    observedAtBeat: cancelledAtBeat,
    reason,
  });
  return replaceTrack(state, trackId, {
    ...track,
    pendingTransition: null,
    lastResolvedTransition: resolved,
  });
}

function updateSceneGroup(
  state: PerformanceState,
  groupIdInput: string,
  expectedStatus: "pending" | "scheduled",
  update: (transition: PendingPerformanceTransition) => PendingPerformanceTransition,
): PerformanceState {
  const groupId = requiredId(groupIdInput, "groupId");
  const members = openSceneGroupMembers(state, groupId);
  for (const { transition } of members) {
    if (transition.status !== expectedStatus) {
      throw new Error(
        `scene group ${groupId} has ${transition.status} work, expected ${expectedStatus}`,
      );
    }
  }
  let tracks = state.tracks;
  for (const { trackId, track, transition } of members) {
    tracks = {
      ...tracks,
      [trackId]: freezeTrack({ ...track, pendingTransition: update(transition) }),
    };
  }
  return freezeState({ ...state, tracks });
}

function requeueScheduledTransition(
  state: PerformanceState,
  trackIdInput: string,
  transitionIdInput: string,
): PerformanceState {
  return updatePendingTransition(
    state,
    trackIdInput,
    transitionIdInput,
    (transition) => {
      if (transition.groupId !== null) {
        throw new Error(
          `transition ${transition.id} belongs to scene group ${transition.groupId}; use RequeueScheduledScene`,
        );
      }
      if (transition.status !== "scheduled") {
        throw new Error(`transition ${transition.id} must be scheduled before requeue`);
      }
      if (state.currentBeat >= transition.targetBeat) {
        throw new Error(
          `transition ${transition.id} cannot be requeued at or after target beat ${transition.targetBeat}`,
        );
      }
      return Object.freeze({ ...transition, status: "pending" as const });
    },
  );
}

function requeueScheduledScene(
  state: PerformanceState,
  groupIdInput: string,
): PerformanceState {
  return updateSceneGroup(state, groupIdInput, "scheduled", (transition) => {
    if (state.currentBeat >= transition.targetBeat) {
      throw new Error(
        `scene group ${groupIdInput} cannot be requeued at or after target beat ${transition.targetBeat}`,
      );
    }
    return Object.freeze({ ...transition, status: "pending" as const });
  });
}

function resolveSceneGroup(
  state: PerformanceState,
  groupIdInput: string,
  expectedStatus: "pending" | "scheduled" | undefined,
  observedAtBeatInput: number,
  outcome:
    | { readonly status: "cancelled"; readonly reason: "player" | "engine" }
    | { readonly status: "failed"; readonly error: string },
): PerformanceState {
  const groupId = requiredId(groupIdInput, "groupId");
  const observedAtBeat = nonNegativeFinite(observedAtBeatInput, "observedAtBeat");
  const members = openSceneGroupMembers(state, groupId);
  const error = outcome.status === "failed" ? outcome.error.trim() : null;
  if (outcome.status === "failed" && !error) {
    throw new Error("failed scene observation requires an error");
  }
  for (const { transition } of members) {
    if (expectedStatus !== undefined && transition.status !== expectedStatus) {
      throw new Error(
        `scene group ${groupId} has ${transition.status} work, expected ${expectedStatus}`,
      );
    }
    if (observedAtBeat < state.currentBeat || observedAtBeat < transition.requestedAtBeat) {
      throw new Error(`scene group ${groupId} observation is before current/request beat`);
    }
    if (outcome.status === "cancelled" && observedAtBeat > transition.targetBeat) {
      throw new Error(
        `scene group ${groupId} cannot be cancelled after target beat ${transition.targetBeat}`,
      );
    }
  }

  let tracks = state.tracks;
  for (const { trackId, track, transition } of members) {
    const resolved: ResolvedPerformanceTransition = Object.freeze(
      outcome.status === "cancelled"
        ? {
            ...withoutPendingStatus(transition),
            status: "cancelled" as const,
            observedAtBeat,
            reason: outcome.reason,
          }
        : {
            ...withoutPendingStatus(transition),
            status: "failed" as const,
            observedAtBeat,
            error: error as string,
          },
    );
    tracks = {
      ...tracks,
      [trackId]: freezeTrack({
        ...track,
        pendingTransition: null,
        lastResolvedTransition: resolved,
      }),
    };
  }
  return freezeState({ ...state, tracks });
}

function openSceneGroupMembers(
  state: PerformanceState,
  groupId: string,
): readonly {
  readonly trackId: string;
  readonly track: PerformanceTrackState;
  readonly transition: PendingPerformanceTransition;
}[] {
  if (!state.transitionIds[groupId]) {
    throw new Error(`scene groupId ${groupId} is unknown`);
  }
  const members = Object.entries(state.tracks).flatMap(([trackId, track]) =>
    track.pendingTransition?.groupId === groupId
      ? [{ trackId, track, transition: track.pendingTransition }]
      : [],
  );
  if (members.length === 0) {
    throw new Error(`scene group ${groupId} has no open transitions`);
  }
  return members;
}

function withoutPendingStatus(
  transition: PendingPerformanceTransition,
): PerformanceTransitionBase & PerformanceTransitionPayload {
  const { status: _status, ...base } = transition;
  return base;
}

function resolveActionTarget(
  state: PerformanceState,
  action: {
    readonly requestedAtBeat: number;
    readonly quantization?: LaunchQuantization;
  },
): number {
  assertRequestNotInPast(state, action.requestedAtBeat);
  return resolveLaunchTargetBeat(
    action.requestedAtBeat,
    action.quantization ?? state.launchQuantization,
    state.beatsPerBar,
  );
}

function assertRequestNotInPast(state: PerformanceState, requestedAtBeat: number): void {
  const beat = nonNegativeFinite(requestedAtBeat, "requestedAtBeat");
  if (beat < state.currentBeat) {
    throw new Error(`request beat ${beat} is before current beat ${state.currentBeat}`);
  }
}

function validateQueueTrackTransition(
  state: PerformanceState,
  input: QueueTrackTransitionInput,
): void {
  identifier(input.id, "transitionId");
  identifier(input.trackId, "trackId");
  assertRequestNotInPast(state, input.requestedAtBeat);
  if (input.kind === "launch") {
    identifier(input.clipId ?? "", "clipId");
  }
  if (input.groupId !== null) {
    identifier(input.groupId, "groupId");
  }

  if (state.transitionIds[input.id]) {
    if (isExactPendingRetry(state, input)) {
      return;
    }
    throw new Error(`transitionId ${input.id} is already in use`);
  }
  const open = state.tracks[input.trackId]?.pendingTransition;
  if (open?.status === "scheduled") {
    throw new Error(
      `transition ${open.id} is scheduled and requires engine cancellation observation before replacement`,
    );
  }
}

function isExactPendingRetry(
  state: PerformanceState,
  input: QueueTrackTransitionInput,
): boolean {
  const open = state.tracks[input.trackId]?.pendingTransition;
  return Boolean(
    open &&
      open.id === input.id &&
      open.kind === input.kind &&
      open.requestedAtBeat === input.requestedAtBeat &&
      open.targetBeat === input.targetBeat &&
      open.sceneId === input.sceneId &&
      open.groupId === input.groupId &&
      (open.kind === "stop" ||
        (input.kind === "launch" && open.clipId === input.clipId)),
  );
}

function assertTransitionIdAvailable(
  state: PerformanceState,
  transitionId: string,
): void {
  if (state.transitionIds[transitionId]) {
    throw new Error(`transitionId ${transitionId} is already in use`);
  }
}

function reserveTransitionId(
  state: PerformanceState,
  transitionId: string,
): PerformanceState {
  assertTransitionIdAvailable(state, transitionId);
  if (Object.keys(state.transitionIds).length >= state.transitionIdCapacity) {
    throw new Error(
      `performance transition ID capacity ${state.transitionIdCapacity} is exhausted; reset performance before continuing`,
    );
  }
  return freezeState({
    ...state,
    transitionIds: { ...state.transitionIds, [transitionId]: true },
  });
}

function updateTrack(
  state: PerformanceState,
  trackIdInput: string,
  update: (track: PerformanceTrackState) => PerformanceTrackState,
): PerformanceState {
  const trackId = requiredId(trackIdInput, "trackId");
  const current = state.tracks[trackId] ?? createTrackState();
  const next = update(current);
  return next === current ? state : replaceTrack(state, trackId, next);
}

function replaceTrack(
  state: PerformanceState,
  trackId: string,
  track: PerformanceTrackState,
): PerformanceState {
  return freezeState({
    ...state,
    tracks: { ...state.tracks, [trackId]: freezeTrack(track) },
  });
}

function createTrackState(): PerformanceTrackState {
  return freezeTrack({
    activeClipId: null,
    activeTransitionId: null,
    pendingTransition: null,
    lastResolvedTransition: null,
    level: 1,
    muted: false,
    soloed: false,
  });
}

function idleRecording(): PerformanceRecordingState {
  return Object.freeze({
    phase: "idle",
    trackId: null,
    slotId: null,
    clipId: null,
  });
}

function freezeTrack(track: PerformanceTrackState): PerformanceTrackState {
  return Object.freeze({ ...track });
}

function freezeState(state: PerformanceState): PerformanceState {
  return Object.freeze({
    ...state,
    transportStop:
      state.transportStop === null ? null : Object.freeze({ ...state.transportStop }),
    tracks: Object.freeze({ ...state.tracks }),
    recording: Object.freeze({ ...state.recording }),
    macros: Object.freeze({ ...state.macros }),
    transitionIds: Object.freeze({ ...state.transitionIds }),
  });
}

function barAtBeat(beat: number, beatsPerBar: number): number {
  return Math.floor(beat / beatsPerBar) + 1;
}

function roundBeat(beat: number): number {
  return Math.round(beat * 1_000_000_000) / 1_000_000_000;
}

function unitInterval(value: number, label: string): number {
  const number = finite(value, label);
  if (number < 0 || number > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
  return number;
}

function booleanValue(value: boolean, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  const number = nonNegativeFinite(value, label);
  if (!Number.isInteger(number)) {
    throw new Error(`${label} must be an integer`);
  }
  return number;
}

function positiveInteger(value: number, label: string): number {
  const number = positiveFinite(value, label);
  if (!Number.isInteger(number)) {
    throw new Error(`${label} must be an integer`);
  }
  return number;
}

function positiveFinite(value: number, label: string): number {
  const number = finite(value, label);
  if (number <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return number;
}

function nonNegativeFinite(value: number, label: string): number {
  const number = finite(value, label);
  if (number < 0) {
    throw new Error(`${label} must be non-negative`);
  }
  return number;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
}

function requiredId(value: string, label: string): string {
  identifier(value, label);
  return value;
}

function identifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} must not be empty`);
  }
}

function assertLaunchQuantization(value: LaunchQuantization): void {
  if (!(["immediate", "beat", "bar"] as const).includes(value)) {
    throw new Error(`unknown launch quantization ${String(value)}`);
  }
}

function assertPerformanceMacro(value: PerformanceMacroId): void {
  if (!(["tone", "space", "echo", "repeat"] as const).includes(value)) {
    throw new Error(`unknown performance macro ${String(value)}`);
  }
}

function validateMaterialSnapshot(material: PerformanceMaterialSnapshot): void {
  nonNegativeInteger(material.version, "material version");
  for (const [trackId, clipIds] of Object.entries(material.clipIdsByTrack)) {
    identifier(trackId, "material trackId");
    const seen = new Set<string>();
    for (const clipId of clipIds) {
      identifier(clipId, "material clipId");
      if (seen.has(clipId)) {
        throw new Error(`material contains duplicate clipId ${clipId} on track ${trackId}`);
      }
      seen.add(clipId);
    }
  }
}

function recordingExistsInMaterial(
  recording: PerformanceRecordingState,
  clipIdsByTrack: Readonly<Record<string, ReadonlySet<string>>>,
): boolean {
  if (recording.phase === "idle") {
    return true;
  }
  const clips = clipIdsByTrack[recording.trackId];
  return Boolean(clips && (recording.clipId === null || clips.has(recording.clipId)));
}
