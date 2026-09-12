import {
  LiveAudioEngineFault,
  type LiveAudioEngine,
  type LiveAudioError,
  type LiveAudioObservation,
  type LiveAudioSnapshot,
  type LiveMidiClipMaterial,
  type LiveTransitionRequest,
} from "@beat-twin/audio-tone";
import {
  DEFAULT_BUILT_IN_INSTRUMENT_ID,
  type Song,
} from "@beat-twin/core";

import {
  type PendingPerformanceTransition,
  type PerformanceAction,
  type PerformanceState,
} from "./performanceRuntime";

export type LiveAudioControllerHost = {
  readonly getSong: () => Song | null;
  readonly getPerformanceState: () => PerformanceState;
  readonly dispatchPerformance: (action: PerformanceAction) => void;
  readonly reportError?: (error: LiveAudioError) => void;
};

export type LiveAudioController = {
  readonly start: () => Promise<void>;
  readonly syncClock: () => void;
  /** Exact engine-owned phase anchor for a currently active track loop. */
  readonly getActiveLoopTiming?: (trackId: string) => Readonly<{
    startedAtBeat: number;
    lengthBeats: number;
  }> | null;
  readonly syncPending: () => Promise<void>;
  /** Fail-closed reconciliation after a persistent Song/material revision. */
  readonly reconcileMaterial: () => void;
  readonly cancelTrackTransition: (trackId: string, transitionId: string) => void;
  readonly cancelScene: (groupId: string) => void;
  readonly cancelTransportStop: (transitionId: string) => void;
  /**
   * Fail-safe only. Normal transport stops use the identified, scheduled
   * StopTransport handshake. This immediately clears both engine and runtime.
   */
  readonly emergencyStop: () => void;
  readonly dispose: () => void;
};

export function createLiveAudioController(input: {
  readonly engine: LiveAudioEngine;
  readonly host: LiveAudioControllerHost;
  readonly engineOwnership?: "owned" | "shared";
}): LiveAudioController {
  const { engine, host, engineOwnership = "owned" } = input;
  const handledCancelledGroups = new Set<string>();
  const suppressedCancellationIds = new Set<string>();
  const suppressedTransportStopCancellationIds = new Set<string>();
  let disposed = false;
  let syncPendingPromise: Promise<void> | null = null;
  let syncPendingDirty = false;
  let refreshSequence = 0;
  let startedBpm: number | null = null;

  const unsubscribe = engine.subscribe((observation) => {
    if (disposed) return;
    handleObservation(observation);
  });

  function handleObservation(observation: LiveAudioObservation): void {
    switch (observation.type) {
      case "transition-executed": {
        const state = host.getPerformanceState();
        const transition = state.tracks[observation.trackId]?.pendingTransition;
        if (
          !transition ||
          transition.id !== observation.transitionId ||
          transition.status !== "scheduled"
        ) {
          failSafeResetRuntime("engine executed an unowned live transition");
          return;
        }
        if (!observationMatchesMaterial(state, observation.trackId, transition, observation)) {
          failSafeResetRuntime("engine execution material did not match the current clip");
          return;
        }
        host.dispatchPerformance({
          type: "ObserveTransitionExecuted",
          trackId: observation.trackId,
          transitionId: observation.transitionId,
          observedAtBeat: Math.max(
            observation.observedAtBeat,
            state.currentBeat,
            transition.targetBeat,
          ),
        });
        return;
      }
      case "transition-cancelled": {
        if (suppressedCancellationIds.delete(observation.transitionId)) return;
        const state = host.getPerformanceState();
        const transition = state.tracks[observation.trackId]?.pendingTransition;
        if (
          !transition ||
          transition.id !== observation.transitionId ||
          transition.status !== "scheduled"
        ) {
          return;
        }
        if (observation.groupId) {
          if (!scheduledSceneMatches(state, observation.groupId)) return;
          if (handledCancelledGroups.has(observation.groupId)) return;
          handledCancelledGroups.add(observation.groupId);
          try {
            const cancellationBeat = Math.max(
              observation.observedAtBeat,
              state.currentBeat,
              transition.requestedAtBeat,
            );
            if (cancellationBeat <= transition.targetBeat) {
              host.dispatchPerformance({
                type: "ObserveSceneCancelled",
                groupId: observation.groupId,
                observedAtBeat: cancellationBeat,
              });
            } else {
              failTransition(transition, observation.trackId, {
                code: "schedule_failed",
                message: `scene cancellation arrived after target beat ${transition.targetBeat}`,
              });
            }
          } finally {
            handledCancelledGroups.delete(observation.groupId);
          }
          return;
        }
        const cancellationBeat = Math.max(
          observation.observedAtBeat,
          state.currentBeat,
          transition.requestedAtBeat,
        );
        if (cancellationBeat <= transition.targetBeat) {
          host.dispatchPerformance({
            type: "ObserveTransitionCancelled",
            trackId: observation.trackId,
            transitionId: observation.transitionId,
            observedAtBeat: cancellationBeat,
          });
        } else {
          failTransition(transition, observation.trackId, {
            code: "schedule_failed",
            message: `cancellation arrived after target beat ${transition.targetBeat}`,
          });
        }
        return;
      }
      case "transport-stopped": {
        const state = host.getPerformanceState();
        const stop = state.transportStop;
        if (!stop || stop.id !== observation.transitionId || stop.status !== "scheduled") {
          return;
        }
        host.dispatchPerformance({
          type: "ObserveTransportStopped",
          transitionId: observation.transitionId,
          observedAtBeat: Math.max(
            observation.observedAtBeat,
            state.currentBeat,
            stop.targetBeat,
          ),
        });
        return;
      }
      case "transport-stop-cancelled": {
        if (suppressedTransportStopCancellationIds.delete(observation.transitionId)) return;
        const state = host.getPerformanceState();
        const stop = state.transportStop;
        if (!stop || stop.id !== observation.transitionId || stop.status !== "scheduled") {
          return;
        }
        const cancellationBeat = Math.max(
          observation.observedAtBeat,
          state.currentBeat,
          stop.requestedAtBeat,
        );
        if (cancellationBeat <= stop.targetBeat) {
          host.dispatchPerformance({
            type: "ObserveTransportStopCancelled",
            transitionId: observation.transitionId,
            observedAtBeat: cancellationBeat,
          });
        } else {
          host.dispatchPerformance({ type: "ResetPerformance" });
        }
        return;
      }
    }
  }

  function failTransition(
    transition: PendingPerformanceTransition,
    trackId: string,
    error: LiveAudioError,
  ): void {
    const observedAtBeat = Math.max(
      host.getPerformanceState().currentBeat,
      transition.requestedAtBeat,
    );
    if (transition.groupId) {
      host.dispatchPerformance({
        type: "ObserveSceneFailed",
        groupId: transition.groupId,
        observedAtBeat,
        error: `${error.code}: ${error.message}`,
      });
      return;
    }
    host.dispatchPerformance({
      type: "ObserveTransitionFailed",
      trackId,
      transitionId: transition.id,
      observedAtBeat,
      error: `${error.code}: ${error.message}`,
    });
  }

  function observationMatchesMaterial(
    state: PerformanceState,
    trackId: string,
    transition: PendingPerformanceTransition,
    observation: Extract<LiveAudioObservation, { readonly type: "transition-executed" }>,
  ): boolean {
    if (transition.kind === "stop") {
      return observation.materialId === null && observation.materialKind === null;
    }
    try {
      const material = resolveSongLiveMaterial(
        host.getSong(),
        state.materialVersion,
        trackId,
        transition.clipId,
      );
      return (
        observation.materialId === material.materialId &&
        observation.materialKind === material.kind
      );
    } catch {
      return false;
    }
  }

  function scheduledSceneMatches(state: PerformanceState, groupId: string): boolean {
    const members = Object.values(state.tracks).flatMap((track) =>
      track.pendingTransition?.groupId === groupId ? [track.pendingTransition] : [],
    );
    return members.length > 0 && members.every((transition) => transition.status === "scheduled");
  }

  function transitionMatches(
    trackId: string,
    expected: PendingPerformanceTransition,
    status: PendingPerformanceTransition["status"],
  ): boolean {
    const state = host.getPerformanceState();
    const actual = state.tracks[trackId]?.pendingTransition;
    return (
      actual !== null &&
      actual !== undefined &&
      sameTransition(actual, expected) &&
      actual.status === status
    );
  }

  function groupMatches(
    groupId: string,
    members: readonly {
      readonly trackId: string;
      readonly transition: PendingPerformanceTransition;
    }[],
    status: PendingPerformanceTransition["status"],
  ): boolean {
    return members.every(
      ({ trackId, transition }) =>
        transition.groupId === groupId &&
        transitionMatches(trackId, transition, status),
    );
  }

  async function scheduleGroup(
    groupId: string,
    members: readonly {
      readonly trackId: string;
      readonly transition: PendingPerformanceTransition;
    }[],
  ): Promise<void> {
    const state = host.getPerformanceState();
    let requests: readonly LiveTransitionRequest[];
    try {
      requests = members.map(({ trackId, transition }) =>
        requestForTransition(host.getSong(), state.materialVersion, trackId, transition),
      );
    } catch (error) {
      const detail = audioErrorFrom(error);
      failTransition(members[0]!.transition, members[0]!.trackId, detail);
      return;
    }
    const result = await engine.scheduleTransitions(requests);
    if (!result.ok) {
      if (groupMatches(groupId, members, "pending")) {
        failTransition(members[0]!.transition, members[0]!.trackId, result.error);
      }
      return;
    }
    if (!groupMatches(groupId, members, "pending")) {
      cancelEngineRequests(requests, false);
      return;
    }
    try {
      host.dispatchPerformance({ type: "MarkSceneScheduled", groupId });
    } catch (error) {
      cancelEngineRequests(
        requests,
        groupMatches(groupId, members, "scheduled"),
      );
      throw error;
    }
    if (!groupMatches(groupId, members, "scheduled")) {
      cancelEngineRequests(requests, false);
    }
  }

  async function scheduleIndividual(
    trackId: string,
    transition: PendingPerformanceTransition,
  ): Promise<void> {
    const state = host.getPerformanceState();
    let request: LiveTransitionRequest;
    try {
      request = requestForTransition(
        host.getSong(),
        state.materialVersion,
        trackId,
        transition,
      );
    } catch (error) {
      failTransition(transition, trackId, audioErrorFrom(error));
      return;
    }
    const result = await engine.scheduleTransitions([request]);
    if (!result.ok) {
      if (transitionMatches(trackId, transition, "pending")) {
        failTransition(transition, trackId, result.error);
      }
      return;
    }
    if (!transitionMatches(trackId, transition, "pending")) {
      cancelEngineRequests([request], false);
      return;
    }
    try {
      host.dispatchPerformance({
        type: "MarkTransitionScheduled",
        trackId,
        transitionId: transition.id,
      });
    } catch (error) {
      cancelEngineRequests(
        [request],
        transitionMatches(trackId, transition, "scheduled"),
      );
      throw error;
    }
    if (!transitionMatches(trackId, transition, "scheduled")) {
      cancelEngineRequests([request], false);
    }
  }

  function cancelEngineRequests(
    requests: readonly LiveTransitionRequest[],
    notifyHost: boolean,
  ): void {
    for (const request of requests) {
      if (!notifyHost) suppressedCancellationIds.add(request.transitionId);
      if (!engine.cancelTransition(request.transitionId)) {
        suppressedCancellationIds.delete(request.transitionId);
      }
    }
  }

  function cancelEngineTransportStop(transitionId: string, notifyHost: boolean): void {
    if (!notifyHost) suppressedTransportStopCancellationIds.add(transitionId);
    if (!engine.cancelTransportStop(transitionId)) {
      suppressedTransportStopCancellationIds.delete(transitionId);
    }
  }

  function failSafeResetRuntime(message: string): void {
    const phase = engine.getSnapshot().phase;
    if (phase !== "new" && phase !== "disposed") engine.stop();
    host.dispatchPerformance({ type: "ResetPerformance" });
    host.reportError?.({ code: "invalid_state", message });
  }

  function expectedMaterialId(
    state: PerformanceState,
    trackId: string,
    clipId: string,
  ): string | null {
    try {
      return resolveSongLiveMaterial(
        host.getSong(),
        state.materialVersion,
        trackId,
        clipId,
      ).materialId;
    } catch {
      return null;
    }
  }

  function scheduledTransitionMatchesSnapshot(
    state: PerformanceState,
    snapshot: LiveAudioSnapshot,
    trackId: string,
    transition: PendingPerformanceTransition,
  ): boolean {
    const expectedPendingMaterialId =
      transition.kind === "launch"
        ? expectedMaterialId(state, trackId, transition.clipId)
        : null;
    return (
      snapshot.pendingTransitionByTrack[trackId] === transition.id &&
      (snapshot.pendingMaterialByTrack[trackId] ?? null) === expectedPendingMaterialId
    );
  }

  function cancelSnapshotTransition(
    snapshot: LiveAudioSnapshot,
    trackId: string,
  ): boolean {
    const transitionId = snapshot.pendingTransitionByTrack[trackId];
    if (!transitionId) return true;
    suppressedCancellationIds.add(transitionId);
    if (engine.cancelTransition(transitionId)) return true;
    suppressedCancellationIds.delete(transitionId);
    return false;
  }

  function syncRuntimeBeatFromEngine(): PerformanceState {
    const engineBeat = engine.getSnapshot().currentBeat;
    if (engineBeat > host.getPerformanceState().currentBeat) {
      host.dispatchPerformance({ type: "AdvanceClock", beat: engineBeat });
    }
    return host.getPerformanceState();
  }

  function requeueScheduledIndividual(
    snapshot: LiveAudioSnapshot,
    trackId: string,
    transition: PendingPerformanceTransition,
  ): boolean {
    if (!cancelSnapshotTransition(snapshot, trackId)) return false;
    const state = syncRuntimeBeatFromEngine();
    const current = state.tracks[trackId]?.pendingTransition;
    if (!current || !sameTransition(current, transition) || current.status !== "scheduled") {
      return false;
    }
    if (state.currentBeat >= transition.targetBeat) {
      failTransition(transition, trackId, {
        code: "schedule_failed",
        message: `edited material missed target beat ${transition.targetBeat}`,
      });
      return true;
    }
    host.dispatchPerformance({
      type: "RequeueScheduledTransition",
      trackId,
      transitionId: transition.id,
    });
    return true;
  }

  function requeueScheduledScene(
    snapshot: LiveAudioSnapshot,
    groupId: string,
    members: readonly {
      readonly trackId: string;
      readonly transition: PendingPerformanceTransition;
    }[],
  ): boolean {
    for (const { trackId } of members) {
      if (!cancelSnapshotTransition(snapshot, trackId)) return false;
    }
    const state = syncRuntimeBeatFromEngine();
    if (!scheduledSceneMatches(state, groupId)) return false;
    const missed = members.find(
      ({ transition }) => state.currentBeat >= transition.targetBeat,
    );
    if (missed) {
      failTransition(missed.transition, missed.trackId, {
        code: "schedule_failed",
        message: `edited scene material missed target beat ${missed.transition.targetBeat}`,
      });
      return true;
    }
    host.dispatchPerformance({ type: "RequeueScheduledScene", groupId });
    return true;
  }

  function nextActiveLoopBoundary(
    snapshot: LiveAudioSnapshot,
    trackId: string,
    currentBeat: number,
  ): number | null {
    const startedAtBeat = snapshot.activeStartedAtBeatByTrack[trackId];
    const lengthBeats = snapshot.activeLengthBeatsByTrack[trackId];
    if (
      startedAtBeat === undefined ||
      lengthBeats === undefined ||
      !Number.isFinite(startedAtBeat) ||
      !Number.isFinite(lengthBeats) ||
      startedAtBeat < 0 ||
      lengthBeats <= 0 ||
      currentBeat < startedAtBeat
    ) {
      return null;
    }
    const completedLoops = Math.floor((currentBeat - startedAtBeat) / lengthBeats);
    const targetBeat = startedAtBeat + (completedLoops + 1) * lengthBeats;
    return targetBeat > currentBeat ? targetBeat : targetBeat + lengthBeats;
  }

  function reconcileMaterial(): void {
    const song = host.getSong();
    if (
      startedBpm !== null &&
      song !== null &&
      song.transport.bpm !== startedBpm &&
      host.getPerformanceState().phase !== "idle"
    ) {
      failSafeResetRuntime(
        `song tempo changed from ${startedBpm} to ${song.transport.bpm} BPM; restart live audio to apply it`,
      );
      return;
    }
    const snapshot = engine.getSnapshot();
    if (snapshot.currentBeat > host.getPerformanceState().currentBeat) {
      host.dispatchPerformance({ type: "AdvanceClock", beat: snapshot.currentBeat });
    }
    let state = host.getPerformanceState();

    const scheduledGroups = new Map<
      string,
      Array<{ trackId: string; transition: PendingPerformanceTransition }>
    >();
    const scheduledIndividuals: Array<{
      trackId: string;
      transition: PendingPerformanceTransition;
    }> = [];
    for (const [trackId, track] of Object.entries(state.tracks)) {
      const transition = track.pendingTransition;
      if (!transition || transition.status !== "scheduled") continue;
      if (transition.groupId) {
        const members = scheduledGroups.get(transition.groupId) ?? [];
        members.push({ trackId, transition });
        scheduledGroups.set(transition.groupId, members);
      } else {
        scheduledIndividuals.push({ trackId, transition });
      }
    }

    for (const [groupId, members] of scheduledGroups) {
      if (
        members.every(({ trackId, transition }) =>
          scheduledTransitionMatchesSnapshot(state, snapshot, trackId, transition),
        )
      ) {
        continue;
      }
      if (!requeueScheduledScene(snapshot, groupId, members)) {
        failSafeResetRuntime(`could not atomically requeue edited scene ${groupId}`);
        return;
      }
      state = host.getPerformanceState();
    }
    for (const { trackId, transition } of scheduledIndividuals) {
      if (scheduledTransitionMatchesSnapshot(state, snapshot, trackId, transition)) continue;
      if (!requeueScheduledIndividual(snapshot, trackId, transition)) {
        failSafeResetRuntime(`could not requeue edited transition ${transition.id}`);
        return;
      }
      state = host.getPerformanceState();
    }

    const afterRequeueSnapshot = engine.getSnapshot();
    for (const [trackId, transitionId] of Object.entries(
      afterRequeueSnapshot.pendingTransitionByTrack,
    )) {
      const current = host.getPerformanceState().tracks[trackId]?.pendingTransition;
      if (current?.id === transitionId) continue;
      if (!cancelSnapshotTransition(afterRequeueSnapshot, trackId)) {
        failSafeResetRuntime(`engine retained orphan transition ${transitionId}`);
        return;
      }
    }

    state = host.getPerformanceState();
    for (const [trackId, materialId] of Object.entries(snapshot.activeMaterialByTrack)) {
      const track = state.tracks[trackId];
      const clipId = track?.activeClipId;
      if (!clipId) {
        failSafeResetRuntime(`active engine track ${trackId} has no matching runtime clip`);
        return;
      }
      const expectedActiveMaterialId = expectedMaterialId(state, trackId, clipId);
      if (!expectedActiveMaterialId) {
        failSafeResetRuntime(`active clip ${clipId} is no longer playable`);
        return;
      }
      if (expectedActiveMaterialId === materialId || track.pendingTransition) continue;
      const targetBeat = nextActiveLoopBoundary(snapshot, trackId, state.currentBeat);
      if (targetBeat === null) {
        failSafeResetRuntime(`active clip ${clipId} has no trustworthy next loop boundary`);
        return;
      }
      host.dispatchPerformance({
        type: "RefreshActiveClip",
        transitionId: `material-refresh:${trackId}:${++refreshSequence}`,
        trackId,
        clipId,
        requestedAtBeat: state.currentBeat,
        targetBeat,
      });
      state = host.getPerformanceState();
    }

    const engineOwnsActiveSources = snapshot.phase === "running" || snapshot.phase === "suspended";
    if (
      engineOwnsActiveSources &&
      Object.entries(state.tracks).some(
        ([trackId, track]) =>
          track.activeClipId !== null && snapshot.activeMaterialByTrack[trackId] === undefined,
      )
    ) {
      failSafeResetRuntime("runtime claimed an active clip whose engine source is missing");
    }
  }

  return {
    async start() {
      const song = host.getSong();
      if (!song) {
        throw new LiveAudioEngineFault({
          code: "material_not_ready",
          message: "Create or load a song before starting live audio",
        });
      }
      const state = host.getPerformanceState();
      engine.initialize(song.transport.bpm);
      await engine.unlock();
      if (
        disposed ||
        host.getSong() !== song ||
        host.getPerformanceState() !== state
      ) {
        const phase = engine.getSnapshot().phase;
        if (phase !== "new" && phase !== "disposed") engine.stop();
        throw new LiveAudioEngineFault({
          code: disposed ? "disposed" : "invalid_state",
          message: disposed
            ? "live audio controller was disposed while starting"
            : "song or performance runtime changed while audio was unlocking",
        });
      }
      engine.start(state.currentBeat);
      try {
        host.dispatchPerformance({ type: "StartTransport", atBeat: state.currentBeat });
        startedBpm = song.transport.bpm;
      } catch (error) {
        engine.stop();
        throw error;
      }
    },

    syncClock() {
      const beat = engine.getSnapshot().currentBeat;
      if (beat >= host.getPerformanceState().currentBeat) {
        host.dispatchPerformance({ type: "AdvanceClock", beat });
      }
    },

    getActiveLoopTiming(trackId) {
      const snapshot = engine.getSnapshot();
      const startedAtBeat = snapshot.activeStartedAtBeatByTrack[trackId];
      const lengthBeats = snapshot.activeLengthBeatsByTrack[trackId];
      if (
        startedAtBeat === undefined ||
        lengthBeats === undefined ||
        !Number.isFinite(startedAtBeat) ||
        !Number.isFinite(lengthBeats) ||
        startedAtBeat < 0 ||
        lengthBeats <= 0
      ) {
        return null;
      }
      return Object.freeze({ startedAtBeat, lengthBeats });
    },

    reconcileMaterial,

    syncPending() {
      // Close the commit-to-audio-callback race before yielding to material
      // preparation. A store subscriber may call this in the same stack as the
      // Song mutation while a boundary callback is already due.
      reconcileMaterial();
      if (syncPendingPromise) {
        syncPendingDirty = true;
        return syncPendingPromise;
      }
      const next = Promise.resolve().then(async () => {
        try {
          do {
            syncPendingDirty = false;
            reconcileMaterial();
            const state = host.getPerformanceState();
            const stop = state.transportStop;
            if (stop?.status === "pending") {
              const result = engine.scheduleTransportStop({
                transitionId: stop.id,
                targetBeat: stop.targetBeat,
              });
              if (result.ok) {
                const currentStop = host.getPerformanceState().transportStop;
                if (
                  currentStop?.id !== stop.id ||
                  currentStop.status !== "pending" ||
                  currentStop.targetBeat !== stop.targetBeat
                ) {
                  cancelEngineTransportStop(stop.id, false);
                } else {
                  try {
                    host.dispatchPerformance({
                      type: "MarkTransportStopScheduled",
                      transitionId: stop.id,
                    });
                  } catch (error) {
                    const failedStop = host.getPerformanceState().transportStop;
                    cancelEngineTransportStop(
                      stop.id,
                      failedStop?.id === stop.id && failedStop.status === "scheduled",
                    );
                    throw error;
                  }
                  const markedStop = host.getPerformanceState().transportStop;
                  if (
                    markedStop?.id !== stop.id ||
                    markedStop.status !== "scheduled"
                  ) {
                    cancelEngineTransportStop(stop.id, false);
                  }
                }
              } else {
                // There is no transport-stop failure action in #26. Keep the request
                // pending and surface the structured engine error to the caller.
                throw new LiveAudioEngineFault(result.error);
              }
            }

            const grouped = new Map<
              string,
              Array<{ trackId: string; transition: PendingPerformanceTransition }>
            >();
            const individuals: Array<{
              trackId: string;
              transition: PendingPerformanceTransition;
            }> = [];
            for (const [trackId, track] of Object.entries(state.tracks)) {
              const transition = track.pendingTransition;
              if (!transition || transition.status !== "pending") continue;
              if (transition.groupId) {
                const members = grouped.get(transition.groupId) ?? [];
                members.push({ trackId, transition });
                grouped.set(transition.groupId, members);
              } else {
                individuals.push({ trackId, transition });
              }
            }
            for (const [groupId, members] of grouped) {
              await scheduleGroup(groupId, members);
            }
            for (const { trackId, transition } of individuals) {
              await scheduleIndividual(trackId, transition);
            }
          } while (syncPendingDirty);
        } finally {
          if (syncPendingPromise === next) syncPendingPromise = null;
        }
      });
      syncPendingPromise = next;
      return next;
    },

    cancelTrackTransition(trackId, transitionId) {
      const transition = host.getPerformanceState().tracks[trackId]?.pendingTransition;
      if (!transition || transition.id !== transitionId) return;
      if (transition.groupId) {
        throw new Error(`transition ${transitionId} belongs to scene ${transition.groupId}`);
      }
      if (transition.status === "pending") {
        host.dispatchPerformance({
          type: "CancelPendingTransition",
          trackId,
          transitionId,
          cancelledAtBeat: host.getPerformanceState().currentBeat,
        });
        return;
      }
      if (!engine.cancelTransition(transitionId)) {
        throw new Error(`engine does not own scheduled transition ${transitionId}`);
      }
    },

    cancelScene(groupId) {
      const state = host.getPerformanceState();
      const members = Object.entries(state.tracks).flatMap(([trackId, track]) =>
        track.pendingTransition?.groupId === groupId
          ? [{ trackId, transition: track.pendingTransition }]
          : [],
      );
      if (members.length === 0) return;
      if (members.every(({ transition }) => transition.status === "pending")) {
        host.dispatchPerformance({
          type: "CancelPendingScene",
          groupId,
          cancelledAtBeat: state.currentBeat,
        });
        return;
      }
      handledCancelledGroups.delete(groupId);
      for (const { transition } of members) {
        if (!engine.cancelTransition(transition.id)) {
          throw new Error(`engine does not own scene transition ${transition.id}`);
        }
      }
    },

    cancelTransportStop(transitionId) {
      const stop = host.getPerformanceState().transportStop;
      if (!stop || stop.id !== transitionId) return;
      if (stop.status === "pending") {
        host.dispatchPerformance({
          type: "CancelPendingTransportStop",
          transitionId,
          cancelledAtBeat: host.getPerformanceState().currentBeat,
        });
        return;
      }
      if (!engine.cancelTransportStop(transitionId)) {
        throw new Error(`engine does not own transport stop ${transitionId}`);
      }
    },

    emergencyStop() {
      engine.stop();
      handledCancelledGroups.clear();
      suppressedCancellationIds.clear();
      suppressedTransportStopCancellationIds.clear();
      host.dispatchPerformance({ type: "ResetPerformance" });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      handledCancelledGroups.clear();
      suppressedCancellationIds.clear();
      suppressedTransportStopCancellationIds.clear();
      if (engineOwnership === "owned") engine.dispose();
    },
  };
}

function sameTransition(
  actual: PendingPerformanceTransition,
  expected: PendingPerformanceTransition,
): boolean {
  return (
    actual.id === expected.id &&
    actual.kind === expected.kind &&
    actual.requestedAtBeat === expected.requestedAtBeat &&
    actual.targetBeat === expected.targetBeat &&
    actual.sceneId === expected.sceneId &&
    actual.groupId === expected.groupId &&
    (actual.kind === "stop" ||
      (expected.kind === "launch" && actual.clipId === expected.clipId))
  );
}

export function resolveSongLiveMaterial(
  song: Song | null,
  _materialVersion: number,
  trackId: string,
  clipId: string,
): LiveMidiClipMaterial {
  if (!song) {
    throw new LiveAudioEngineFault({
      code: "material_not_ready",
      message: "No song is loaded",
    });
  }
  const track = song.tracks.find((candidate) => candidate.id === trackId);
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!track || !clip) {
    throw new LiveAudioEngineFault({
      code: "material_not_ready",
      message: `Clip ${clipId} is not available on track ${trackId}`,
    });
  }
  if (track.kind !== "instrument") {
    throw new LiveAudioEngineFault({
      code: "unsupported_material",
      message: `Track ${trackId} kind ${track.kind} has no registered live material adapter`,
    });
  }
  const instrumentId = track.instrumentId ?? DEFAULT_BUILT_IN_INSTRUMENT_ID;
  const contentIdentity = liveMaterialContentIdentity({
    instrumentId,
    lengthBeats: clip.lengthBeats,
    notes: clip.pattern.notes,
  });
  return Object.freeze({
    kind: "midi",
    materialId: contentIdentity.key,
    version: contentIdentity.version,
    clipId,
    instrumentId,
    lengthBeats: clip.lengthBeats,
    notes: contentIdentity.notes,
  });
}

function liveMaterialContentIdentity(input: {
  readonly instrumentId: string;
  readonly lengthBeats: number;
  readonly notes: readonly {
    readonly id: string;
    readonly pitch: number;
    readonly velocity: number;
    readonly startBeat: number;
    readonly lengthBeats: number;
  }[];
}): {
  readonly key: string;
  readonly version: number;
  readonly notes: readonly (typeof input.notes)[number][];
} {
  const notes = [...input.notes].sort((left, right) => {
      const leftAudible = [left.startBeat, left.pitch, left.velocity, left.lengthBeats];
      const rightAudible = [right.startBeat, right.pitch, right.velocity, right.lengthBeats];
      for (let index = 0; index < leftAudible.length; index += 1) {
        const difference = leftAudible[index]! - rightAudible[index]!;
        if (difference !== 0) return difference;
      }
      return 0;
    });
  const audibleNotes = notes.map((note) => [
    note.startBeat,
    note.pitch,
    note.velocity,
    note.lengthBeats,
  ]);
  const content = JSON.stringify([
    "instrument-midi-v1",
    input.instrumentId,
    input.lengthBeats,
    audibleNotes,
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const version = hash >>> 0;
  return Object.freeze({
    key: encodeURIComponent(content),
    version,
    notes: Object.freeze(notes.map((note) => Object.freeze({ ...note }))),
  });
}

function requestForTransition(
  song: Song | null,
  materialVersion: number,
  trackId: string,
  transition: PendingPerformanceTransition,
): LiveTransitionRequest {
  return transition.kind === "launch"
    ? {
        kind: "launch",
        transitionId: transition.id,
        groupId: transition.groupId,
        trackId,
        targetBeat: transition.targetBeat,
        material: resolveSongLiveMaterial(
          song,
          materialVersion,
          trackId,
          transition.clipId,
        ),
      }
    : {
        kind: "stop",
        transitionId: transition.id,
        groupId: transition.groupId,
        trackId,
        targetBeat: transition.targetBeat,
      };
}

function audioErrorFrom(error: unknown): LiveAudioError {
  if (error instanceof LiveAudioEngineFault) return error.detail;
  return {
    code: "material_not_ready",
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  };
}
