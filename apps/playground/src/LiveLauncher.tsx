import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  AlertTriangle,
  CirclePlay,
  Clock3,
  Grid2X2,
  Square,
  StepForward,
} from "lucide-react";

import type { Clip, Song, Track } from "@beat-twin/core";

import {
  createBrowserLiveAudioController,
} from "./browserAudioRuntime";
import type {
  LiveAudioController,
  LiveAudioControllerHost,
} from "./liveAudioController";
import type {
  LaunchQuantization,
  PerformanceTrackState,
} from "./performanceRuntime";
import {
  LIVE_LAUNCHER_SLOT_COUNT,
  LIVE_LAUNCHER_TRACK_COUNT,
} from "./launcherModel";
import { usePlaygroundStore } from "./store";

const clockRefreshMs = 40;

export type LiveAudioControllerFactory = (
  host: LiveAudioControllerHost,
) => Promise<LiveAudioController>;

export type LiveLauncherProps = {
  readonly controllerFactory?: LiveAudioControllerFactory;
  readonly externalAudioActive?: boolean;
  readonly onRunningChange?: (isRunning: boolean) => void;
};

type LauncherTrackProjection = {
  readonly position: number;
  readonly track: Track | null;
  readonly clips: readonly (Clip | null)[];
};

export function LiveLauncher({
  controllerFactory = createBrowserLiveAudioController,
  externalAudioActive = false,
  onRunningChange = noopRunningChange,
}: LiveLauncherProps) {
  const song = usePlaygroundStore((state) => state.commandState.song);
  const performance = usePlaygroundStore((state) => state.performanceState);
  const dispatchPerformance = usePlaygroundStore((state) => state.dispatchPerformance);
  const [isStarting, setStarting] = useState(false);
  const [isSessionActive, setSessionActive] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const controllerRef = useRef<LiveAudioController | null>(null);
  const mountedRef = useRef(true);
  const startOwnershipRef = useRef(0);
  const transitionNumberRef = useRef(0);
  const runningChangeRef = useRef(onRunningChange);
  runningChangeRef.current = onRunningChange;
  const reportRuntimeError = useCallback((error: string | null) => {
    if (mountedRef.current) setRuntimeError(error);
  }, []);

  const closeController = useCallback((emergency: boolean) => {
    startOwnershipRef.current += 1;
    const controller = controllerRef.current;
    controllerRef.current = null;
    if (controller) {
      if (emergency) controller.emergencyStop();
      controller.dispose();
    }
    setSessionActive(false);
    runningChangeRef.current(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startOwnershipRef.current += 1;
      const controller = controllerRef.current;
      controllerRef.current = null;
      if (controller) {
        controller.emergencyStop();
        controller.dispose();
      }
      runningChangeRef.current(false);
    };
  }, []);

  useEffect(() => {
    if (!isSessionActive) return;
    const intervalId = window.setInterval(() => {
      try {
        controllerRef.current?.syncClock();
      } catch (error) {
        reportRuntimeError(errorMessage(error));
      }
    }, clockRefreshMs);
    return () => window.clearInterval(intervalId);
  }, [isSessionActive, reportRuntimeError]);

  useEffect(() => {
    if (!isSessionActive || performance.phase !== "idle") return;
    closeController(false);
  }, [closeController, isSessionActive, performance.phase]);

  useEffect(() => {
    if (!isSessionActive) return;
    const syncMaterial = () => {
      const controller = controllerRef.current;
      if (!controller) return;
      try {
        controller.reconcileMaterial();
      } catch (error) {
        reportRuntimeError(errorMessage(error));
        return;
      }
      void syncController(controller, reportRuntimeError);
    };
    syncMaterial();
    return usePlaygroundStore.subscribe((state, previous) => {
      if (state.commandState !== previous.commandState) syncMaterial();
    });
  }, [isSessionActive, reportRuntimeError]);

  const nextTransitionId = useCallback((
    kind: "launch" | "stop" | "scene" | "transport",
  ) => {
    transitionNumberRef.current += 1;
    return `launcher-${kind}-${transitionNumberRef.current}`;
  }, []);

  const startLive = async () => {
    if (isStarting || isSessionActive || externalAudioActive || !song) return;
    const ownership = startOwnershipRef.current + 1;
    startOwnershipRef.current = ownership;
    setStarting(true);
    setRuntimeError(null);
    let controller: LiveAudioController | null = null;
    try {
      controller = await controllerFactory({
        getSong: () => usePlaygroundStore.getState().commandState.song,
        getPerformanceState: () => usePlaygroundStore.getState().performanceState,
        dispatchPerformance: (action) =>
          usePlaygroundStore.getState().dispatchPerformance(action),
        reportError: (error) =>
          reportRuntimeError(`${error.code}: ${error.message}`),
      });
      if (
        !mountedRef.current ||
        startOwnershipRef.current !== ownership ||
        controllerRef.current !== null
      ) {
        controller.dispose();
        return;
      }
      controllerRef.current = controller;
      await controller.start();
      if (
        !mountedRef.current ||
        startOwnershipRef.current !== ownership ||
        controllerRef.current !== controller
      ) {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          controller.emergencyStop();
          controller.dispose();
        }
        return;
      }
      setSessionActive(true);
      runningChangeRef.current(true);
    } catch (error) {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        controller?.dispose();
      }
      if (mountedRef.current) setRuntimeError(errorMessage(error));
    } finally {
      if (mountedRef.current && startOwnershipRef.current === ownership) {
        setStarting(false);
      }
    }
  };

  const queueLaunch = (trackId: string, clipId: string) => {
    const controller = controllerRef.current;
    if (!controller || performance.phase !== "playing") return;
    try {
      controller.syncClock();
      const current = usePlaygroundStore.getState().performanceState;
      dispatchPerformance({
        type: "LaunchClip",
        transitionId: nextTransitionId("launch"),
        trackId,
        clipId,
        requestedAtBeat: current.currentBeat,
      });
      setRuntimeError(null);
      void syncController(controller, reportRuntimeError);
    } catch (error) {
      reportRuntimeError(errorMessage(error));
    }
  };

  const queueTrackStop = (trackId: string) => {
    const controller = controllerRef.current;
    if (!controller || performance.phase !== "playing") return;
    try {
      controller.syncClock();
      const current = usePlaygroundStore.getState().performanceState;
      dispatchPerformance({
        type: "StopTrack",
        transitionId: nextTransitionId("stop"),
        trackId,
        requestedAtBeat: current.currentBeat,
      });
      setRuntimeError(null);
      void syncController(controller, reportRuntimeError);
    } catch (error) {
      reportRuntimeError(errorMessage(error));
    }
  };

  const queueScene = (sceneIndex: number) => {
    const controller = controllerRef.current;
    if (!controller || performance.phase !== "playing") return;
    const slots = projectLauncher(usePlaygroundStore.getState().commandState.song)
      .map(({ track, clips }) => ({ track, clip: clips[sceneIndex] ?? null }))
      .filter(
        (slot): slot is { readonly track: Track; readonly clip: Clip } =>
          slot.track?.kind === "instrument" && slot.clip !== null,
      );
    if (slots.length !== LIVE_LAUNCHER_TRACK_COUNT) return;
    try {
      controller.syncClock();
      const current = usePlaygroundStore.getState().performanceState;
      dispatchPerformance({
        type: "LaunchScene",
        transitionId: nextTransitionId("scene"),
        sceneId: `launcher-scene-${sceneIndex + 1}`,
        slots: slots.map(({ track, clip }) => ({ trackId: track.id, clipId: clip.id })),
        requestedAtBeat: current.currentBeat,
      });
      setRuntimeError(null);
      void syncController(controller, reportRuntimeError);
    } catch (error) {
      reportRuntimeError(errorMessage(error));
    }
  };

  const queueTransportStop = () => {
    const controller = controllerRef.current;
    if (!controller || performance.phase !== "playing") return;
    try {
      controller.syncClock();
      const current = usePlaygroundStore.getState().performanceState;
      dispatchPerformance({
        type: "StopTransport",
        transitionId: nextTransitionId("transport"),
        requestedAtBeat: current.currentBeat,
      });
      setRuntimeError(null);
      void syncController(controller, reportRuntimeError);
    } catch (error) {
      reportRuntimeError(errorMessage(error));
    }
  };

  const setQuantization = (quantization: LaunchQuantization) => {
    try {
      dispatchPerformance({ type: "SetLaunchQuantization", quantization });
      setRuntimeError(null);
    } catch (error) {
      reportRuntimeError(errorMessage(error));
    }
  };

  const tracks = projectLauncher(song);
  const hasOpenTrackTransition = tracks.some(({ track }) =>
    track ? Boolean(performance.tracks[track.id]?.pendingTransition) : false,
  );
  const transportUnavailable = !song || externalAudioActive;
  const transportLabel = externalAudioActive
    ? "Preview owns audio"
    : isStarting
      ? "Starting audio"
      : performance.phase === "stopping"
        ? "Stop queued"
        : isSessionActive
          ? "Live audio running"
          : song
            ? "Live audio idle"
            : "No song available";

  return (
    <section className="live-launcher" aria-label="Live launcher">
      <header className="launcher-header">
        <div className="launcher-title">
          <Grid2X2 size={20} />
          <div>
            <p className="eyebrow">NanoDAW Live</p>
            <h2>2 × 2 launcher</h2>
            <p>Browser-owned clips, one shared audio clock.</p>
          </div>
        </div>

        <div className="launcher-transport" aria-label="Live transport">
          <div className={`launcher-clock ${isSessionActive ? "running" : "idle"}`} role="status">
            <Clock3 size={17} />
            <span>
              <strong>{transportLabel}</strong>
              <small>
                Bar {performance.currentBar} · Beat {formatBeat(
                  performance.currentBeat,
                  performance.beatsPerBar,
                )}
              </small>
            </span>
          </div>
          <label className="launcher-quantization">
            Quantize
            <select
              aria-label="Launch quantization"
              value={performance.launchQuantization}
              onChange={(event) =>
                setQuantization(event.currentTarget.value as LaunchQuantization)
              }
              disabled={isStarting || performance.phase === "stopping"}
            >
              <option value="immediate">Immediate</option>
              <option value="beat">Next beat</option>
              <option value="bar">Next bar</option>
            </select>
          </label>
          <button
            type="button"
            className="tool-button primary"
            onClick={() => void startLive()}
            disabled={transportUnavailable || isStarting || isSessionActive}
          >
            <CirclePlay size={18} />
            {isStarting ? "Starting…" : "Start live"}
          </button>
          <button
            type="button"
            className="tool-button"
            onClick={queueTransportStop}
            disabled={!isSessionActive || performance.phase !== "playing"}
          >
            <Square size={17} />
            Stop live
          </button>
        </div>
      </header>

      {runtimeError ? (
        <p className="launcher-error" role="alert">
          <AlertTriangle size={17} />
          <span>
            <strong>Live audio unavailable</strong>
            {runtimeError}
          </span>
          {isSessionActive ? (
            <button type="button" onClick={() => closeController(true)}>
              Reset live
            </button>
          ) : null}
        </p>
      ) : null}

      <div className="launcher-scenes" aria-label="Launcher scenes">
        {Array.from({ length: LIVE_LAUNCHER_SLOT_COUNT }, (_, sceneIndex) => {
          const sceneId = `launcher-scene-${sceneIndex + 1}`;
          const sceneSlots = tracks.map(({ track, clips }) => ({
            track,
            clip: clips[sceneIndex] ?? null,
          }));
          const sceneAvailable = sceneSlots.every(
            ({ track, clip }) => track?.kind === "instrument" && clip !== null,
          );
          const sceneQueued = sceneSlots.every(({ track }) =>
            track
              ? performance.tracks[track.id]?.pendingTransition?.sceneId === sceneId
              : false,
          );
          const scenePlaying =
            !sceneQueued &&
            sceneAvailable &&
            sceneSlots.every(({ track, clip }) =>
              track && clip
                ? performance.tracks[track.id]?.activeClipId === clip.id
                : false,
            );
          const sceneStatus = !sceneAvailable
            ? "unavailable"
            : sceneQueued
              ? "queued"
              : scenePlaying
                ? "playing"
                : "idle";
          return (
            <button
              key={sceneId}
              type="button"
              className={`launcher-scene ${sceneStatus}`}
              data-status={sceneStatus}
              aria-label={`Launch Scene ${sceneIndex + 1}, ${sceneStatus}`}
              onClick={() => queueScene(sceneIndex)}
              disabled={
                !sceneAvailable ||
                !isSessionActive ||
                performance.phase !== "playing" ||
                hasOpenTrackTransition ||
                scenePlaying
              }
            >
              <StepForward size={17} />
              <span>
                <small>Scene {sceneIndex + 1} · {sceneStatus}</small>
                <strong>
                  {sceneSlots.map(({ clip }) => clip?.name ?? "Empty").join(" + ")}
                </strong>
              </span>
            </button>
          );
        })}
      </div>

      <div className="launcher-track-grid">
        {tracks.map((projection) => {
          const track = projection.track;
          const runtime = track ? performance.tracks[track.id] : undefined;
          return (
            <LauncherTrack
              key={track?.id ?? `empty-track-${projection.position}`}
              projection={projection}
              runtime={runtime}
              isLive={isSessionActive && performance.phase === "playing"}
              beatsPerBar={performance.beatsPerBar}
              onLaunch={queueLaunch}
              onStop={queueTrackStop}
            />
          );
        })}
      </div>
    </section>
  );
}

type LauncherTrackProps = {
  readonly projection: LauncherTrackProjection;
  readonly runtime: PerformanceTrackState | undefined;
  readonly isLive: boolean;
  readonly beatsPerBar: number;
  readonly onLaunch: (trackId: string, clipId: string) => void;
  readonly onStop: (trackId: string) => void;
};

function LauncherTrack({
  projection,
  runtime,
  isLive,
  beatsPerBar,
  onLaunch,
  onStop,
}: LauncherTrackProps) {
  const { track, clips, position } = projection;
  const materialAvailable = track?.kind === "instrument";
  const pending = runtime?.pendingTransition ?? null;
  const failure =
    !pending && runtime?.lastResolvedTransition?.status === "failed"
      ? runtime.lastResolvedTransition.error
      : null;
  const trackStatus = !track || !materialAvailable
    ? "unavailable"
    : failure
      ? "error"
      : pending?.kind === "stop"
        ? "stop-queued"
        : pending
          ? "queued"
          : runtime?.activeClipId
            ? "playing"
            : "idle";
  const activeClip = clips.find((clip) => clip?.id === runtime?.activeClipId) ?? null;

  return (
    <article
      className="launcher-track"
      aria-label={track ? `${track.name} launcher track` : `Unavailable track ${position}`}
      data-status={trackStatus}
      style={{ "--track-color": track?.color ?? "#aab4ae" } as CSSProperties}
    >
      <div className="launcher-track-heading">
        <span className="launcher-track-swatch" aria-hidden="true" />
        <div>
          <small>Track {position}</small>
          <h3>{track?.name ?? "No track"}</h3>
        </div>
        <span className={`launcher-state ${trackStatus}`} role="status">
          {trackStatus}
        </span>
      </div>

      <p className="launcher-track-detail">
        {!track
          ? "Add a browser-owned track to use this lane."
          : !materialAvailable
            ? `${track.kind} material has no live adapter yet.`
            : pending
              ? `${pending.kind === "launch" ? "Queued" : "Stop queued"} for bar ${targetBar(pending.targetBeat, beatsPerBar)}`
              : failure
                ? failure
                : activeClip
                  ? `Observed active: ${activeClip.name}`
                  : "No clip is active."}
      </p>

      <div className="launcher-slots">
        {clips.map((clip, index) => {
          const isQueued = pending?.kind === "launch" && pending.clipId === clip?.id;
          const isActive = runtime?.activeClipId === clip?.id;
          const slotStatus = !clip
            ? "empty"
            : !materialAvailable
              ? "unavailable"
              : isQueued
                ? "queued"
                : isActive && pending?.kind === "stop"
                  ? "stop-queued"
                  : isActive
                    ? "playing"
                    : "idle";
          const disabled =
            !clip ||
            !materialAvailable ||
            !isLive ||
            Boolean(pending);
          return (
            <button
              key={clip?.id ?? `empty-slot-${index}`}
              type="button"
              className={`launcher-slot ${slotStatus}`}
              data-status={slotStatus}
              aria-label={
                track && clip
                  ? `${track.name} ${isActive ? "stop" : "launch"} ${clip.name}, ${slotStatus}`
                  : `Track ${position} slot ${index + 1}, ${slotStatus}`
              }
              disabled={disabled}
              onClick={() => {
                if (!track || !clip) return;
                if (isActive) {
                  onStop(track.id);
                } else {
                  onLaunch(track.id, clip.id);
                }
              }}
            >
              <StepForward size={18} />
              <span>
                <small>Slot {index + 1} · {slotStatus}</small>
                <strong>{clip?.name ?? "Empty slot"}</strong>
                <em>{clip ? `${clip.pattern.notes.length} notes` : "No clip"}</em>
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="launcher-track-stop"
        onClick={() => {
          if (track) onStop(track.id);
        }}
        disabled={!track || !isLive || !runtime?.activeClipId || Boolean(pending)}
      >
        <Square size={16} />
        Stop {track?.name ?? `track ${position}`}
      </button>
    </article>
  );
}

function projectLauncher(song: Song | null): readonly LauncherTrackProjection[] {
  return Array.from({ length: LIVE_LAUNCHER_TRACK_COUNT }, (_, trackIndex) => {
    const track = song?.tracks[trackIndex] ?? null;
    return Object.freeze({
      position: trackIndex + 1,
      track,
      clips: Object.freeze(
        Array.from(
          { length: LIVE_LAUNCHER_SLOT_COUNT },
          (_, clipIndex) => track?.clips[clipIndex] ?? null,
        ),
      ),
    });
  });
}

async function syncController(
  controller: LiveAudioController,
  setError: (error: string | null) => void,
): Promise<void> {
  try {
    await controller.syncPending();
  } catch (error) {
    setError(errorMessage(error));
  }
}

function targetBar(targetBeat: number, beatsPerBar: number): number {
  return Math.floor(targetBeat / beatsPerBar) + 1;
}

function formatBeat(beat: number, beatsPerBar: number): string {
  return ((beat % beatsPerBar) + 1).toFixed(2);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function noopRunningChange(): void {}
