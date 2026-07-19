import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CircleDot, Keyboard, Undo2, Usb, XCircle } from "lucide-react";

import type { BuiltInInstrumentId, Clip, Song, Track } from "@beat-twin/core";

import {
  MIDI_RECORDING_LENGTH_BARS,
  advanceMidiTake,
  buildMidiTakeCommands,
  captureMidiInputEvent,
  createMidiTakeSession,
  discardMidiTake,
  materializeMidiTakeNotes,
  type MidiRecordingLengthBars,
  type MidiTakeSession,
} from "./midiRecording";
import { LIVE_LAUNCHER_SLOT_COUNT, LIVE_LAUNCHER_TRACK_COUNT } from "./launcherModel";
import { usePlaygroundStore } from "./store";
import {
  connectWebMidi,
  type NormalizedMidiInputEvent,
  type WebMidiConnection,
} from "./webMidiInput";

export type MidiRecorderProps = Readonly<{
  isLive: boolean;
  syncClock: () => number;
  getActiveLoopTiming?: (trackId: string) => Readonly<{
    startedAtBeat: number;
    lengthBeats: number;
  }> | null;
}>;

type RecorderTarget = "selected" | "empty";

type MidiPad = Readonly<{
  key: string;
  label: string;
  pitch: number;
}>;

type TakeIdentity = Readonly<{
  clipId: string;
  clipStartBeat: number;
  baseRevision: number;
}>;

let recordingIdSequence = 0;

export function MidiRecorder({
  isLive,
  syncClock,
  getActiveLoopTiming = noActiveLoopTiming,
}: MidiRecorderProps) {
  const song = usePlaygroundStore((state) => state.commandState.song);
  const revision = usePlaygroundStore((state) => state.commandState.revision);
  const selectedTrackId = usePlaygroundStore((state) => state.selectedTrackId);
  const selectedClipId = usePlaygroundStore((state) => state.selectedClipId);
  const performance = usePlaygroundStore((state) => state.performanceState);
  const dispatchBatch = usePlaygroundStore((state) => state.dispatchBatch);
  const dispatchPerformance = usePlaygroundStore((state) => state.dispatchPerformance);
  const undo = usePlaygroundStore((state) => state.undo);
  const [target, setTarget] = useState<RecorderTarget>("selected");
  const [lengthBars, setLengthBars] = useState<MidiRecordingLengthBars>(1);
  const [take, setTakeState] = useState<MidiTakeSession | null>(null);
  const [message, setMessage] = useState("Choose a slot, then queue a MIDI take.");
  const [lastTakeRevision, setLastTakeRevision] = useState<number | null>(null);
  const [webMidiLabel, setWebMidiLabel] = useState("Web MIDI optional");
  const [isConnectingMidi, setConnectingMidi] = useState(false);
  const takeRef = useRef<MidiTakeSession | null>(null);
  const identityRef = useRef<TakeIdentity | null>(null);
  const mountedRef = useRef(true);
  const pressedKeysRef = useRef(new Set<string>());
  const webMidiRef = useRef<WebMidiConnection | null>(null);
  const webMidiOwnershipRef = useRef(0);
  const captureRef = useRef<(event: NormalizedMidiInputEvent) => void>(() => undefined);
  const cancelRef = useRef<(reason: string) => void>(() => undefined);

  const track = selectedLauncherTrack(song?.tracks ?? [], selectedTrackId);
  const selectedClip = selectedLauncherClip(track, selectedClipId);
  const selectedSlotIndex = selectedClip
    ? track?.clips.findIndex((clip) => clip.id === selectedClip.id) ?? -1
    : -1;
  const emptySlotIndex = firstEmptyLauncherSlot(track);
  const selectedClipBars = selectedClip
    ? exactSupportedBars(selectedClip.lengthBeats, performance.beatsPerBar)
    : null;
  const selectedClipIsActive = Boolean(
    track && selectedClip && performance.tracks[track.id]?.activeClipId === selectedClip.id,
  );
  const effectiveLengthBars = target === "selected" ? selectedClipBars : lengthBars;
  const activePhase = take?.phase === "recording" || take?.phase === "overdubbing";
  const pads = useMemo(
    () => padsForInstrument(
      track?.kind === "instrument" ? track.instrumentId ?? "lead" : "lead",
    ),
    [track],
  );

  const setTake = useCallback((next: MidiTakeSession | null) => {
    takeRef.current = next;
    if (mountedRef.current) setTakeState(next);
  }, []);

  const clearRuntimeRecording = useCallback((trackId: string) => {
    try {
      usePlaygroundStore.getState().dispatchPerformance({
        type: "CancelRecording",
        trackId,
      });
    } catch (error) {
      if (mountedRef.current) setMessage(errorMessage(error));
    }
  }, []);

  const cancelTake = useCallback((reason: string) => {
    const current = takeRef.current;
    if (!current) return;
    setTake(discardMidiTake(current, reason));
    clearRuntimeRecording(current.trackId);
    pressedKeysRef.current.clear();
    identityRef.current = null;
    setTake(null);
    if (mountedRef.current) setMessage(`Take discarded: ${reason}.`);
  }, [clearRuntimeRecording, setTake]);
  cancelRef.current = cancelTake;

  const finishTake = useCallback((completed: MidiTakeSession) => {
    const identity = identityRef.current;
    if (!identity) {
      cancelTake("missing take identity");
      return;
    }
    const stateBefore = usePlaygroundStore.getState();
    if (stateBefore.commandState.revision !== identity.baseRevision) {
      cancelTake("the Song changed during recording");
      return;
    }
    try {
      const notes = materializeMidiTakeNotes(completed);
      if (notes.length === 0) {
        cancelTake("no notes were played");
        return;
      }
      const reservedIds = songIds(stateBefore.commandState.song);
      const takeId = makeRecordingId("take");
      const commands = buildMidiTakeCommands({
        trackId: completed.trackId,
        clipId: identity.clipId,
        clipName: `Recorded ${completed.lengthBars}-bar loop`,
        clipStartBeat: identity.clipStartBeat,
        loopLengthBeats: completed.endBeat - completed.startBeat,
        createClip: completed.mode === "record",
        notes,
        noteIdFactory: (index) => `note-${takeId}-${index + 1}`,
        reservedIds,
      });
      dispatchBatch(commands);
      const stateAfter = usePlaygroundStore.getState();
      if (stateAfter.lastError) {
        cancelTake(stateAfter.lastError);
        return;
      }
      clearRuntimeRecording(completed.trackId);
      pressedKeysRef.current.clear();
      identityRef.current = null;
      setTake(null);
      setLastTakeRevision(stateAfter.commandState.revision);
      setMessage(
        `${completed.mode === "overdub" ? "Overdub" : "Recording"} committed: ${notes.length} note${notes.length === 1 ? "" : "s"}, one undo step.`,
      );
    } catch (error) {
      cancelTake(errorMessage(error));
    }
  }, [cancelTake, clearRuntimeRecording, dispatchBatch, setTake]);

  const observeBeat = useCallback((beat: number) => {
    const current = takeRef.current;
    if (!current) return;
    if (
      current.mode === "overdub" &&
      usePlaygroundStore.getState().performanceState.tracks[current.trackId]?.activeClipId !==
        current.clipId
    ) {
      cancelTake("the selected clip is no longer active");
      return;
    }
    try {
      const next = advanceMidiTake(current, beat);
      if (
        current.phase === "queued" &&
        (next.phase === "recording" || next.phase === "overdubbing")
      ) {
        if (next.mode === "overdub") {
          const activeClipId = usePlaygroundStore.getState()
            .performanceState.tracks[next.trackId]?.activeClipId;
          if (activeClipId !== next.clipId || !next.clipId) {
            cancelTake("the selected clip is no longer active");
            return;
          }
          dispatchPerformance({
            type: "StartOverdub",
            trackId: next.trackId,
            slotId: launcherSlotId(next.trackId, next.slotIndex),
            clipId: next.clipId,
          });
        } else {
          dispatchPerformance({ type: "StartRecording", trackId: next.trackId });
        }
      }
      setTake(next);
      if (next.phase === "completed") finishTake(next);
    } catch (error) {
      cancelTake(errorMessage(error));
    }
  }, [cancelTake, dispatchPerformance, finishTake, setTake]);

  const captureInput = useCallback((event: NormalizedMidiInputEvent) => {
    const current = takeRef.current;
    if (!current) return;
    if (
      current.mode === "overdub" &&
      usePlaygroundStore.getState().performanceState.tracks[current.trackId]?.activeClipId !==
        current.clipId
    ) {
      cancelTake("the selected clip is no longer active");
      return;
    }
    try {
      const beat = syncClock();
      let ready = advanceMidiTake(current, beat);
      if (
        current.phase === "queued" &&
        (ready.phase === "recording" || ready.phase === "overdubbing")
      ) {
        if (ready.mode === "overdub") {
          const activeClipId = usePlaygroundStore.getState()
            .performanceState.tracks[ready.trackId]?.activeClipId;
          if (activeClipId !== ready.clipId || !ready.clipId) {
            cancelTake("the selected clip is no longer active");
            return;
          }
          dispatchPerformance({
            type: "StartOverdub",
            trackId: ready.trackId,
            slotId: launcherSlotId(ready.trackId, ready.slotIndex),
            clipId: ready.clipId,
          });
        } else {
          dispatchPerformance({ type: "StartRecording", trackId: ready.trackId });
        }
      }
      if (ready.phase === "completed") {
        setTake(ready);
        finishTake(ready);
        return;
      }
      if (ready.phase !== "recording" && ready.phase !== "overdubbing") return;
      ready = captureMidiInputEvent(ready, { ...event, beat });
      const next = ready;
      setTake(next);
      if (next.phase === "completed") finishTake(next);
    } catch (error) {
      cancelTake(errorMessage(error));
    }
  }, [cancelTake, dispatchPerformance, finishTake, setTake, syncClock]);
  captureRef.current = captureInput;

  const queueTake = () => {
    if (!isLive || performance.phase !== "playing" || !track || track.kind !== "instrument") {
      setMessage("Start live audio and select one of the two instrument tracks first.");
      return;
    }
    if (performance.recording.phase !== "idle") {
      setMessage("Another MIDI take already owns the recording target.");
      return;
    }
    const isOverdub = target === "selected";
    if (isOverdub && (!selectedClip || selectedSlotIndex < 0 || !selectedClipBars)) {
      setMessage("Select a 1, 2, 4, or 8-bar launcher clip for overdub.");
      return;
    }
    if (isOverdub && !selectedClipIsActive) {
      setMessage("Launch the selected clip before queuing its overdub.");
      return;
    }
    if (!isOverdub && emptySlotIndex === null) {
      setMessage("This launcher track has no empty slot.");
      return;
    }
    const bars = effectiveLengthBars;
    if (!bars) return;
    try {
      const requestedAtBeat = syncClock();
      const activeTiming = isOverdub ? getActiveLoopTiming(track.id) : null;
      if (
        isOverdub &&
        (!activeTiming || activeTiming.lengthBeats !== selectedClip!.lengthBeats)
      ) {
        setMessage("The active clip timing is unavailable; overdub failed closed.");
        return;
      }
      const startBeat = activeTiming
        ? nextActiveLoopBoundary(activeTiming, requestedAtBeat)
        : nextBarBoundary(requestedAtBeat, performance.beatsPerBar);
      const slotIndex = isOverdub ? selectedSlotIndex : emptySlotIndex!;
      const clipId = isOverdub ? selectedClip!.id : makeRecordingId("clip");
      const loopLength = bars * performance.beatsPerBar;
      const session = createMidiTakeSession({
        mode: isOverdub ? "overdub" : "record",
        trackId: track.id,
        slotIndex,
        clipId: isOverdub ? clipId : null,
        requestedAtBeat,
        startBeat,
        beatsPerBar: performance.beatsPerBar,
        lengthBars: bars,
        overdubLoopStartedAtBeat: activeTiming?.startedAtBeat,
      });
      identityRef.current = {
        clipId,
        clipStartBeat: isOverdub ? selectedClip!.startBeat : nextClipStartBeat(track, loopLength),
        baseRevision: revision,
      };
      dispatchPerformance({
        type: "ArmRecordSlot",
        trackId: track.id,
        slotId: launcherSlotId(track.id, slotIndex),
        clipId: isOverdub ? clipId : null,
      });
      setTake(session);
      setMessage(`Queued for bar ${Math.floor(startBeat / performance.beatsPerBar) + 1}; count-in to the exact loop boundary.`);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  useEffect(() => {
    if (!takeRef.current) return;
    if (!isLive || performance.phase !== "playing") {
      cancelTake("live transport stopped");
      return;
    }
    if (identityRef.current?.baseRevision !== revision) {
      cancelTake("the Song changed during recording");
      return;
    }
    observeBeat(performance.currentBeat);
  }, [
    cancelTake,
    isLive,
    observeBeat,
    performance.currentBeat,
    performance.phase,
    performance.tracks,
    revision,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) return;
      const pad = pads.find((candidate) => candidate.key === event.key.toLowerCase());
      if (!pad || !takeRef.current || pressedKeysRef.current.has(pad.key)) return;
      pressedKeysRef.current.add(pad.key);
      event.preventDefault();
      captureRef.current({
        type: "noteon",
        sourceId: "computer-keyboard",
        channel: 0,
        pitch: pad.pitch,
        velocity: 100,
      });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const pad = pads.find((candidate) => candidate.key === event.key.toLowerCase());
      if (!pad || !pressedKeysRef.current.delete(pad.key)) return;
      captureRef.current({
        type: "noteoff",
        sourceId: "computer-keyboard",
        channel: 0,
        pitch: pad.pitch,
        velocity: 0,
      });
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [pads]);

  useEffect(() => {
    const onBlur = () => cancelRef.current("window focus was lost");
    const onVisibility = () => {
      if (document.hidden) cancelRef.current("document became hidden");
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      webMidiOwnershipRef.current += 1;
      webMidiRef.current?.close();
      webMidiRef.current = null;
      const current = takeRef.current;
      if (current) {
        takeRef.current = discardMidiTake(current, "recorder unmounted");
        clearRuntimeRecording(current.trackId);
      }
      takeRef.current = null;
      identityRef.current = null;
      captureRef.current = () => undefined;
      cancelRef.current = () => undefined;
      pressedKeysRef.current.clear();
    };
  }, [clearRuntimeRecording]);

  const enableWebMidi = async () => {
    if (isConnectingMidi || webMidiRef.current) return;
    const ownership = webMidiOwnershipRef.current + 1;
    webMidiOwnershipRef.current = ownership;
    setConnectingMidi(true);
    setWebMidiLabel("Requesting Web MIDI…");
    try {
      const connection = await connectWebMidi({
        onEvent: (event) => captureRef.current(event),
        onDisconnect: (sourceId) => {
          setWebMidiLabel(`MIDI device ${sourceId} disconnected; keyboard remains available.`);
          cancelRef.current(`MIDI device ${sourceId} disconnected`);
        },
      });
      if (!mountedRef.current || ownership !== webMidiOwnershipRef.current) {
        connection.close();
        return;
      }
      webMidiRef.current = connection;
      setWebMidiLabel(
        connection.deviceCount === 0
          ? "Web MIDI enabled; no input connected."
          : `Web MIDI enabled with ${connection.deviceCount} input${connection.deviceCount === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      if (mountedRef.current && ownership === webMidiOwnershipRef.current) {
        setWebMidiLabel(`${errorMessage(error)} Keyboard and pads remain available.`);
      }
    } finally {
      if (mountedRef.current && ownership === webMidiOwnershipRef.current) {
        setConnectingMidi(false);
      }
    }
  };

  const playPad = (
    event: ReactPointerEvent<HTMLButtonElement>,
    pitch: number,
    velocity: 100 | 0,
  ) => {
    if (velocity > 0) event.currentTarget.setPointerCapture?.(event.pointerId);
    captureInput({
      type: velocity > 0 ? "noteon" : "noteoff",
      sourceId: `screen-pad-${pitch}`,
      channel: 0,
      pitch,
      velocity,
    });
  };

  const canQueue = Boolean(
    isLive &&
    performance.phase === "playing" &&
    track?.kind === "instrument" &&
    performance.recording.phase === "idle" &&
    (target === "selected"
      ? selectedClip && selectedClipBars && selectedClipIsActive
      : emptySlotIndex !== null),
  );
  const canUndoLastTake = lastTakeRevision !== null && lastTakeRevision === revision && !take;

  return (
    <section className="midi-recorder" aria-label="MIDI loop recorder">
      <header className="midi-recorder-heading">
        <div>
          <p className="eyebrow">Capture</p>
          <h3><CircleDot size={18} aria-hidden="true" /> MIDI loop recorder</h3>
          <p>Loop-boundary count-in · 1/16 quantize · one atomic undo step per take.</p>
        </div>
        <div className="midi-recorder-status" role="status" data-phase={take?.phase ?? "idle"}>
          <strong>{take?.phase ?? "idle"}</strong>
          <span>{message}</span>
        </div>
      </header>

      <div className="midi-recorder-controls">
        <div className="midi-recorder-segment" aria-label="Recording target">
          <button
            type="button"
            aria-pressed={target === "selected"}
            disabled={Boolean(take)}
            onClick={() => setTarget("selected")}
          >
            Selected clip
          </button>
          <button
            type="button"
            aria-pressed={target === "empty"}
            disabled={Boolean(take)}
            onClick={() => setTarget("empty")}
          >
            Empty slot {emptySlotIndex === null ? "—" : emptySlotIndex + 1}
          </button>
        </div>
        <label>
          Take length
          <select
            aria-label="MIDI take length"
            value={effectiveLengthBars ?? lengthBars}
            disabled={Boolean(take) || target === "selected"}
            onChange={(event) => setLengthBars(Number(event.currentTarget.value) as MidiRecordingLengthBars)}
          >
            {MIDI_RECORDING_LENGTH_BARS.map((bars) => (
              <option key={bars} value={bars}>{bars} bar{bars === 1 ? "" : "s"}</option>
            ))}
          </select>
        </label>
        <button type="button" className="tool-button primary" disabled={!canQueue || Boolean(take)} onClick={queueTake}>
          <CircleDot size={17} aria-hidden="true" />
          Queue {target === "selected" ? "overdub" : "recording"}
        </button>
        <button type="button" className="tool-button" disabled={!take} onClick={() => cancelTake("cancelled by player")}>
          <XCircle size={17} aria-hidden="true" /> Cancel take
        </button>
        <button
          type="button"
          className="tool-button"
          disabled={!canUndoLastTake}
          onClick={() => {
            undo();
            setLastTakeRevision(null);
            setMessage("Last MIDI take undone.");
          }}
        >
          <Undo2 size={17} aria-hidden="true" /> Undo last take
        </button>
      </div>

      <div className="midi-recorder-inputs">
        <div>
          <span><Keyboard size={16} aria-hidden="true" /> Keyboard / pads</span>
          <small>{activePhase ? "Input is live." : take?.phase === "queued" ? "Wait for the count-in." : "Queue a take to play."}</small>
        </div>
        <button type="button" className="tool-button" disabled={isConnectingMidi || Boolean(webMidiRef.current)} onClick={() => void enableWebMidi()}>
          <Usb size={17} aria-hidden="true" /> {isConnectingMidi ? "Connecting…" : "Enable Web MIDI"}
        </button>
        <small role="status">{webMidiLabel}</small>
      </div>

      <div className="midi-pad-grid" aria-label="On-screen MIDI pads">
        {pads.map((pad) => (
          <button
            key={pad.key}
            type="button"
            disabled={!activePhase}
            aria-label={`${pad.label} pad, MIDI ${pad.pitch}`}
            onPointerDown={(event) => playPad(event, pad.pitch, 100)}
            onPointerUp={(event) => playPad(event, pad.pitch, 0)}
            onPointerCancel={(event) => playPad(event, pad.pitch, 0)}
            onLostPointerCapture={(event) => playPad(event, pad.pitch, 0)}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
                event.preventDefault();
                captureInput({
                  type: "noteon",
                  sourceId: `accessible-pad-${pad.pitch}`,
                  channel: 0,
                  pitch: pad.pitch,
                  velocity: 100,
                });
              }
            }}
            onKeyUp={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                captureInput({
                  type: "noteoff",
                  sourceId: `accessible-pad-${pad.pitch}`,
                  channel: 0,
                  pitch: pad.pitch,
                  velocity: 0,
                });
              }
            }}
          >
            <strong>{pad.label}</strong>
            <small>{pad.pitch}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function selectedLauncherTrack(
  tracks: readonly Track[],
  selectedTrackId: string | null,
): Track | null {
  const selected = tracks.find((track) => track.id === selectedTrackId) ?? tracks[0] ?? null;
  if (!selected) return null;
  const index = tracks.findIndex((track) => track.id === selected.id);
  return index >= 0 && index < LIVE_LAUNCHER_TRACK_COUNT ? selected : null;
}

function selectedLauncherClip(track: Track | null, selectedClipId: string | null): Clip | null {
  if (!track) return null;
  const selected = track.clips.find((clip) => clip.id === selectedClipId) ?? track.clips[0] ?? null;
  if (!selected) return null;
  const index = track.clips.findIndex((clip) => clip.id === selected.id);
  return index >= 0 && index < LIVE_LAUNCHER_SLOT_COUNT ? selected : null;
}

function firstEmptyLauncherSlot(track: Track | null): number | null {
  if (!track) return null;
  for (let index = 0; index < LIVE_LAUNCHER_SLOT_COUNT; index += 1) {
    if (!track.clips[index]) return index;
  }
  return null;
}

function exactSupportedBars(lengthBeats: number, beatsPerBar: number): MidiRecordingLengthBars | null {
  const bars = lengthBeats / beatsPerBar;
  return (MIDI_RECORDING_LENGTH_BARS as readonly number[]).includes(bars)
    ? bars as MidiRecordingLengthBars
    : null;
}

function nextBarBoundary(beat: number, beatsPerBar: number): number {
  return (Math.floor(beat / beatsPerBar) + 1) * beatsPerBar;
}

function nextActiveLoopBoundary(
  timing: Readonly<{ startedAtBeat: number; lengthBeats: number }>,
  currentBeat: number,
): number {
  if (currentBeat < timing.startedAtBeat) return timing.startedAtBeat;
  const completedLoops = Math.floor(
    (currentBeat - timing.startedAtBeat) / timing.lengthBeats,
  );
  return timing.startedAtBeat + (completedLoops + 1) * timing.lengthBeats;
}

function nextClipStartBeat(track: Track, loopLength: number): number {
  return track.clips.reduce(
    (latest, clip) => Math.max(latest, clip.startBeat + clip.lengthBeats),
    0,
  ) || Math.max(0, (firstEmptyLauncherSlot(track) ?? 0) * loopLength);
}

function launcherSlotId(trackId: string, slotIndex: number): string {
  return `${trackId}:slot-${slotIndex + 1}`;
}

function songIds(song: Song | null): Set<string> {
  const ids = new Set<string>();
  if (!song) return ids;
  ids.add(song.id);
  for (const track of song.tracks) {
    ids.add(track.id);
    for (const clip of track.clips) {
      ids.add(clip.id);
      for (const note of clip.pattern.notes) ids.add(note.id);
    }
  }
  return ids;
}

function makeRecordingId(scope: "clip" | "take"): string {
  if (globalThis.crypto?.randomUUID) return `${scope}-${globalThis.crypto.randomUUID()}`;
  recordingIdSequence += 1;
  return `${scope}-${Date.now().toString(36)}-${recordingIdSequence.toString(36)}`;
}

const keyboardPads = Object.freeze([
  Object.freeze({ key: "a", label: "A", semitone: 0 }),
  Object.freeze({ key: "w", label: "W", semitone: 1 }),
  Object.freeze({ key: "s", label: "S", semitone: 2 }),
  Object.freeze({ key: "e", label: "E", semitone: 3 }),
  Object.freeze({ key: "d", label: "D", semitone: 4 }),
  Object.freeze({ key: "f", label: "F", semitone: 5 }),
  Object.freeze({ key: "t", label: "T", semitone: 6 }),
  Object.freeze({ key: "g", label: "G", semitone: 7 }),
]);

const drumPitches = Object.freeze([36, 38, 42, 46, 39, 45, 49, 51]);

function padsForInstrument(instrumentId: BuiltInInstrumentId): readonly MidiPad[] {
  const basePitch = instrumentId === "bass" ? 36 : instrumentId === "chords" ? 48 : 60;
  return Object.freeze(keyboardPads.map((binding, index) => Object.freeze({
    key: binding.key,
    label: binding.label,
    pitch: instrumentId === "drums" ? drumPitches[index]! : basePitch + binding.semitone,
  })));
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, select, textarea, [contenteditable='true']"));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function noActiveLoopTiming(): null {
  return null;
}
