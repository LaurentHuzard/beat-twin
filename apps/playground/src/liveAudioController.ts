import {
  LiveAudioEngineFault,
  type LiveAudioEngine,
  type LiveAudioError,
  type LiveAudioObservation,
  type LiveClipMaterial,
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
};

export type LiveAudioController = {
  readonly start: () => Promise<void>;
  readonly syncClock: () => void;
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
          failSafeResetRuntime();
          return;
        }
        if (!observationMatchesMaterial(state, observation.trackId, transition, observation)) {
          failSafeResetRuntime();
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
    materialVersion: number,
    trackId: string,
    expected: PendingPerformanceTransition,
    status: PendingPerformanceTransition["status"],
  ): boolean {
    const state = host.getPerformanceState();
    const actual = state.tracks[trackId]?.pendingTransition;
    return (
      state.materialVersion === materialVersion &&
      actual !== null &&
      actual !== undefined &&
      sameTransition(actual, expected) &&
      actual.status === status
    );
  }

  function groupMatches(
    materialVersion: number,
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
        transitionMatches(materialVersion, trackId, transition, status),
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
      if (groupMatches(state.materialVersion, groupId, members, "pending")) {
        failTransition(members[0]!.transition, members[0]!.trackId, result.error);
      }
      return;
    }
    if (!groupMatches(state.materialVersion, groupId, members, "pending")) {
      cancelEngineRequests(requests, false);
      return;
    }
    try {
      host.dispatchPerformance({ type: "MarkSceneScheduled", groupId });
    } catch (error) {
      cancelEngineRequests(
        requests,
        groupMatches(state.materialVersion, groupId, members, "scheduled"),
      );
      throw error;
    }
    if (!groupMatches(state.materialVersion, groupId, members, "scheduled")) {
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
      if (transitionMatches(state.materialVersion, trackId, transition, "pending")) {
        failTransition(transition, trackId, result.error);
      }
      return;
    }
    if (!transitionMatches(state.materialVersion, trackId, transition, "pending")) {
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
        transitionMatches(state.materialVersion, trackId, transition, "scheduled"),
      );
      throw error;
    }
    if (!transitionMatches(state.materialVersion, trackId, transition, "scheduled")) {
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

  function failSafeResetRuntime(): void {
    const phase = engine.getSnapshot().phase;
    if (phase !== "new" && phase !== "disposed") engine.stop();
    host.dispatchPerformance({ type: "ResetPerformance" });
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

  function reconcileMaterial(): void {
    const state = host.getPerformanceState();
    const snapshot = engine.getSnapshot();
    const invalidActive = Object.entries(snapshot.activeMaterialByTrack).some(
      ([trackId, materialId]) => {
        const clipId = state.tracks[trackId]?.activeClipId;
        return !clipId || expectedMaterialId(state, trackId, clipId) !== materialId;
      },
    );
    if (invalidActive) {
      if (snapshot.phase !== "new" && snapshot.phase !== "disposed") engine.stop();
      host.dispatchPerformance({ type: "ResetPerformance" });
      return;
    }

    const reconciledGroups = new Set<string>();
    for (const [trackId, transitionId] of Object.entries(
      snapshot.pendingTransitionByTrack,
    )) {
      const transition = state.tracks[trackId]?.pendingTransition;
      const pendingMaterialId = snapshot.pendingMaterialByTrack[trackId] ?? null;
      const expectedPendingMaterialId =
        transition?.kind === "launch"
          ? expectedMaterialId(state, trackId, transition.clipId)
          : null;
      const isCurrent =
        transition?.id === transitionId &&
        transition.status === "scheduled" &&
        pendingMaterialId === expectedPendingMaterialId;
      if (isCurrent) continue;

      if (transition?.groupId && transition.status === "scheduled") {
        if (reconciledGroups.has(transition.groupId)) continue;
        reconciledGroups.add(transition.groupId);
        for (const [memberTrackId, memberTrack] of Object.entries(state.tracks)) {
          if (memberTrack.pendingTransition?.groupId !== transition.groupId) continue;
          const memberTransitionId = snapshot.pendingTransitionByTrack[memberTrackId];
          if (memberTransitionId) engine.cancelTransition(memberTransitionId);
        }
      } else {
        engine.cancelTransition(transitionId);
      }
    }

    const current = host.getPerformanceState();
    const missingGroups = new Set<string>();
    for (const [trackId, track] of Object.entries(current.tracks)) {
      const transition = track.pendingTransition;
      if (
        !transition ||
        transition.status !== "scheduled" ||
        snapshot.pendingTransitionByTrack[trackId] === transition.id
      ) {
        continue;
      }
      if (transition.groupId) {
        if (missingGroups.has(transition.groupId)) continue;
        missingGroups.add(transition.groupId);
        for (const [memberTrackId, memberTrack] of Object.entries(current.tracks)) {
          if (memberTrack.pendingTransition?.groupId !== transition.groupId) continue;
          const memberTransitionId = snapshot.pendingTransitionByTrack[memberTrackId];
          if (memberTransitionId) engine.cancelTransition(memberTransitionId);
        }
        const afterEngineCancellation = host.getPerformanceState();
        if (!scheduledSceneMatches(afterEngineCancellation, transition.groupId)) continue;
        if (afterEngineCancellation.currentBeat <= transition.targetBeat) {
          host.dispatchPerformance({
            type: "ObserveSceneCancelled",
            groupId: transition.groupId,
            observedAtBeat: afterEngineCancellation.currentBeat,
          });
        } else {
          failTransition(transition, trackId, {
            code: "material_not_ready",
            message: "scheduled scene has no matching engine work",
          });
        }
      } else if (current.currentBeat <= transition.targetBeat) {
        host.dispatchPerformance({
          type: "ObserveTransitionCancelled",
          trackId,
          transitionId: transition.id,
          observedAtBeat: current.currentBeat,
        });
      } else {
        failTransition(transition, trackId, {
          code: "material_not_ready",
          message: "scheduled transition has no matching engine work",
        });
      }
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

    reconcileMaterial,

    syncPending() {
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
      host.dispatchPerformance({ type: "ResetPerformance" });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
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
  materialVersion: number,
  trackId: string,
  clipId: string,
): LiveClipMaterial {
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
  return Object.freeze({
    kind: "midi",
    materialId: `${song.id}:${trackId}:${clipId}@${materialVersion}`,
    version: materialVersion,
    clipId,
    instrumentId: track.instrumentId ?? DEFAULT_BUILT_IN_INSTRUMENT_ID,
    lengthBeats: clip.lengthBeats,
    notes: Object.freeze(clip.pattern.notes.map((note) => Object.freeze({ ...note }))),
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
