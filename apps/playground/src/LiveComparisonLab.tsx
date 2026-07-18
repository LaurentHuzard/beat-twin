import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Activity,
  CirclePlay,
  RotateCcw,
  Shuffle,
  Square,
  StepForward,
  X,
} from "lucide-react";

import {
  beatAtTime,
  cancelPendingTransition,
  createLiveSessionState,
  createMusicalClock,
  getOpenTransition,
  markTransitionScheduled,
  observeTransition,
  queueTransition,
  type LiveSessionState,
  type MusicalClock,
} from "./liveSession";
import {
  createLivePrototypeAudioEngine,
  type LivePrototypeAudioEngine,
  type LivePrototypeAudioEngineFactory,
} from "./livePrototypeAudio";
import {
  applyPrototypeAction,
  describePrototypeAction,
  LIVE_PROTOTYPE_BEATS_PER_BAR,
  LIVE_PROTOTYPE_BPM,
  LIVE_PROTOTYPE_TRACKS,
  type PrototypeAction,
  type PrototypeObservation,
  type PrototypeTrack,
  type PrototypeTrackId,
} from "./livePrototypeModel";

type Costume = "deck" | "mutation";
type PrototypeSession = LiveSessionState<PrototypeAction, PrototypeObservation>;

export type LiveComparisonLabProps = {
  readonly audioEngineFactory?: LivePrototypeAudioEngineFactory;
  readonly externalAudioActive?: boolean;
  readonly nowSeconds?: () => number;
  readonly onRunningChange?: (isRunning: boolean) => void;
};

const scheduleLookaheadBeats = 0.35;

export function LiveComparisonLab({
  audioEngineFactory = createLivePrototypeAudioEngine,
  externalAudioActive = false,
  nowSeconds = defaultNowSeconds,
  onRunningChange = noopRunningChange,
}: LiveComparisonLabProps) {
  const [costume, setCostume] = useState<Costume>("deck");
  const [session, setSession] = useState<PrototypeSession>(() =>
    createLiveSessionState<PrototypeAction, PrototypeObservation>(),
  );
  const [isClockRunning, setClockRunning] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setStarting] = useState(false);
  const clockRef = useRef<MusicalClock | null>(null);
  const currentBeatRef = useRef(0);
  const audioEngineRef = useRef<LivePrototypeAudioEngine | null>(null);
  const transitionNumberRef = useRef(0);

  const stopLab = useCallback(() => {
    audioEngineRef.current?.stop();
    audioEngineRef.current = null;
    clockRef.current = null;
    currentBeatRef.current = 0;
    setCurrentBeat(0);
    setClockRunning(false);
    onRunningChange(false);
    setStarting(false);
    setStartError(null);
    setSession(createLiveSessionState<PrototypeAction, PrototypeObservation>());
  }, [onRunningChange]);

  useEffect(() => () => audioEngineRef.current?.stop(), []);

  useEffect(() => {
    if (!isClockRunning) {
      return;
    }
    const intervalId = window.setInterval(() => {
      const clock = clockRef.current;
      if (!clock) {
        return;
      }
      const beat = beatAtTime(clock, nowSeconds());
      currentBeatRef.current = beat;
      setCurrentBeat(beat);
    }, 40);
    return () => window.clearInterval(intervalId);
  }, [isClockRunning, nowSeconds]);

  useEffect(() => {
    if (!isClockRunning) {
      return;
    }

    let next = session;
    let changed = false;
    for (const transitionId of Object.values(next.openTransitionByTrack)) {
      const transition = next.transitions.find((candidate) => candidate.id === transitionId);
      if (
        transition?.status === "pending" &&
        currentBeat >= transition.targetBeat - scheduleLookaheadBeats
      ) {
        next = markTransitionScheduled(next, transition.id);
        changed = true;
      }
    }

    for (const transitionId of Object.values(next.openTransitionByTrack)) {
      const transition = next.transitions.find((candidate) => candidate.id === transitionId);
      if (transition?.status === "scheduled" && currentBeat >= transition.targetBeat) {
        const trackId = transition.trackId as PrototypeTrackId;
        const observation = applyPrototypeAction(
          trackId,
          transition.action,
          next.observedTrackState[trackId],
        );
        audioEngineRef.current?.setTrackState(trackId, observation);
        next = observeTransition(next, {
          transitionId: transition.id,
          outcome: "executed",
          observedAtBeat: currentBeat,
          trackState: observation,
        });
        changed = true;
      }
    }

    if (changed) {
      setSession(next);
    }
  }, [currentBeat, isClockRunning, session]);

  const startClock = async () => {
    if (isClockRunning || isStarting || externalAudioActive) {
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const engine = await audioEngineFactory();
      const originTimeSeconds = nowSeconds();
      audioEngineRef.current = engine;
      clockRef.current = createMusicalClock({
        bpm: LIVE_PROTOTYPE_BPM,
        beatsPerBar: LIVE_PROTOTYPE_BEATS_PER_BAR,
        originTimeSeconds,
      });
      currentBeatRef.current = 0;
      setCurrentBeat(0);
      setClockRunning(true);
      onRunningChange(true);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  const requestAction = (trackId: PrototypeTrackId, action: PrototypeAction) => {
    if (!isClockRunning) {
      return;
    }
    transitionNumberRef.current += 1;
    setSession((current) =>
      queueTransition(current, {
        id: `prototype-transition-${transitionNumberRef.current}`,
        trackId,
        action,
        requestedAtBeat: currentBeatRef.current,
        beatsPerBar: LIVE_PROTOTYPE_BEATS_PER_BAR,
      }),
    );
  };

  const cancelAction = (trackId: PrototypeTrackId) => {
    setSession((current) =>
      cancelPendingTransition(current, trackId, currentBeatRef.current),
    );
  };

  const selectCostume = (nextCostume: Costume) => {
    if (nextCostume === costume) {
      return;
    }
    stopLab();
    setCostume(nextCostume);
  };

  const barNumber = Math.floor(currentBeat / LIVE_PROTOTYPE_BEATS_PER_BAR) + 1;
  const beatInBar = (currentBeat % LIVE_PROTOTYPE_BEATS_PER_BAR) + 1;

  return (
    <section className="live-lab" aria-label="Live comparison lab">
      <header className="live-lab-header">
        <div className="live-lab-title">
          <Activity size={19} />
          <div>
            <h2>Live comparison lab</h2>
            <p>One clock, two costumes. Nothing here is saved to the song.</p>
          </div>
        </div>

        <div className="live-costume-switch" aria-label="Prototype costume">
          <button
            type="button"
            aria-pressed={costume === "deck"}
            onClick={() => selectCostume("deck")}
          >
            Session Deck
          </button>
          <button
            type="button"
            aria-pressed={costume === "mutation"}
            onClick={() => selectCostume("mutation")}
          >
            Mutation Instrument
          </button>
        </div>
      </header>

      <div className="live-clock-rail" aria-label="Shared musical clock">
        <div className={`live-clock-state ${isClockRunning ? "running" : ""}`}>
          <span>{isClockRunning ? "Clock running" : "Clock stopped"}</span>
          <strong>
            Bar {barNumber} · Beat {beatInBar.toFixed(2)}
          </strong>
          <small>{LIVE_PROTOTYPE_BPM} BPM · next bar only</small>
        </div>
        <div className="live-clock-progress" aria-hidden="true">
          <span
            style={{
              width: `${((currentBeat % LIVE_PROTOTYPE_BEATS_PER_BAR) / LIVE_PROTOTYPE_BEATS_PER_BAR) * 100}%`,
            }}
          />
        </div>
        <div className="live-clock-actions">
          <button
            type="button"
            className="tool-button primary"
            onClick={() => void startClock()}
            disabled={isClockRunning || isStarting || externalAudioActive}
            title={
              externalAudioActive
                ? "Stop the editor preview before starting the live clock"
                : undefined
            }
          >
            <CirclePlay size={18} />
            {externalAudioActive
              ? "Preview active"
              : isStarting
                ? "Starting…"
                : "Start clock"}
          </button>
          <button
            type="button"
            className="tool-button"
            onClick={stopLab}
            disabled={!isClockRunning && !isStarting}
          >
            <Square size={17} />
            Stop lab
          </button>
        </div>
      </div>

      {startError ? <p className="live-lab-error">Audio start failed: {startError}</p> : null}

      <div className="live-track-grid">
        {LIVE_PROTOTYPE_TRACKS.map((track) => (
          <PrototypeTrackPanel
            key={track.id}
            costume={costume}
            track={track}
            session={session}
            isClockRunning={isClockRunning}
            onRequest={requestAction}
            onCancel={cancelAction}
          />
        ))}
      </div>
    </section>
  );
}

type PrototypeTrackPanelProps = {
  readonly costume: Costume;
  readonly track: PrototypeTrack;
  readonly session: PrototypeSession;
  readonly isClockRunning: boolean;
  readonly onRequest: (trackId: PrototypeTrackId, action: PrototypeAction) => void;
  readonly onCancel: (trackId: PrototypeTrackId) => void;
};

function PrototypeTrackPanel({
  costume,
  track,
  session,
  isClockRunning,
  onRequest,
  onCancel,
}: PrototypeTrackPanelProps) {
  const openTransition = getOpenTransition(session, track.id);
  const observation = session.observedTrackState[track.id];
  const isEngineLocked = openTransition?.status === "scheduled";
  const actionLabel = openTransition
    ? describePrototypeAction(track.id, openTransition.action)
    : null;
  const targetBar = openTransition
    ? Math.floor(openTransition.targetBeat / LIVE_PROTOTYPE_BEATS_PER_BAR) + 1
    : null;

  const deckActions = track.sources.map((source) => ({
    label: source.label,
    detail: source.detail,
    action: { kind: "activate", sourceId: source.id } as const,
  }));

  return (
    <article
      className="live-track"
      aria-label={`${track.name} live track`}
      style={{ "--track-color": track.color } as CSSProperties}
    >
      <div className="live-track-heading">
        <span className="live-track-swatch" />
        <div>
          <h3>{track.name}</h3>
          <p>{track.role}</p>
        </div>
        <div className={`live-observed-state ${observation?.sourceId ? "active" : ""}`}>
          <small>Observed</small>
          <strong>{observation?.variation ?? "Stopped"}</strong>
        </div>
      </div>

      <div className={`live-pending-state ${openTransition?.status ?? "idle"}`} role="status">
        <span>{openTransition ? openTransition.status : "No pending change"}</span>
        <strong>
          {openTransition ? `${actionLabel} · bar ${targetBar}` : "Engine state is authoritative"}
        </strong>
      </div>

      <div className="live-track-actions">
        {costume === "deck" ? (
          deckActions.map(({ label, detail, action }) => (
            <button
              key={label}
              type="button"
              onClick={() => onRequest(track.id, action)}
              disabled={!isClockRunning || isEngineLocked}
              aria-label={`${track.name} ${label}`}
            >
              <StepForward size={17} />
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
            </button>
          ))
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                onRequest(track.id, { kind: "activate", sourceId: track.sources[0].id })
              }
              disabled={!isClockRunning || isEngineLocked}
              aria-label={`${track.name} start anchor`}
            >
              <CirclePlay size={17} />
              <span>
                <strong>Start</strong>
                <small>Anchor</small>
              </span>
            </button>
            <button
              type="button"
              onClick={() =>
                onRequest(track.id, { kind: "transform", operation: "transpose" })
              }
              disabled={!isClockRunning || isEngineLocked}
              aria-label={`${track.name} transpose`}
            >
              <StepForward size={17} />
              <span>
                <strong>Transpose</strong>
                <small>+5</small>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRequest(track.id, { kind: "transform", operation: "rotate" })}
              disabled={!isClockRunning || isEngineLocked}
              aria-label={`${track.name} rotate`}
            >
              <Shuffle size={17} />
              <span>
                <strong>Rotate</strong>
                <small>Two steps</small>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRequest(track.id, { kind: "transform", operation: "restore" })}
              disabled={!isClockRunning || isEngineLocked}
              aria-label={`${track.name} restore anchor`}
            >
              <RotateCcw size={17} />
              <span>
                <strong>Restore</strong>
                <small>Anchor</small>
              </span>
            </button>
          </>
        )}

        <button
          type="button"
          className="stop"
          onClick={() => onRequest(track.id, { kind: "stop" })}
          disabled={!isClockRunning || isEngineLocked}
          aria-label={`${track.name} stop`}
        >
          <Square size={16} />
          <span>
            <strong>Stop</strong>
            <small>Track only</small>
          </span>
        </button>
      </div>

      <button
        type="button"
        className="live-cancel-action"
        onClick={() => onCancel(track.id)}
        disabled={openTransition?.status !== "pending"}
        aria-label={`${track.name} cancel pending change`}
      >
        <X size={15} />
        Cancel pending
      </button>
    </article>
  );
}

function defaultNowSeconds(): number {
  return performance.now() / 1_000;
}

function noopRunningChange(): void {}
