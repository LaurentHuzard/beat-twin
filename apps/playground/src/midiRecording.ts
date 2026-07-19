import type { BeatTwinCommand } from "@beat-twin/commands";

export const MIDI_RECORDING_GRID_BEATS = 0.25;
export const MIDI_RECORDING_MIN_NOTE_BEATS = 0.25;
export const MIDI_RECORDING_LENGTH_BARS = Object.freeze([1, 2, 4, 8] as const);

export type MidiRecordingLengthBars = (typeof MIDI_RECORDING_LENGTH_BARS)[number];
export type MidiRecordingMode = "record" | "overdub";
export type MidiTakePhase =
  | "queued"
  | "recording"
  | "overdubbing"
  | "completed"
  | "discarded";

/** A normalized note event shared by keyboard, pads, and optional Web MIDI. */
export type MidiNoteInputEvent = Readonly<{
  sourceId: string;
  channel: number;
  pitch: number;
  /** MIDI velocity 0 is normalized note-off; 1-127 is note-on. */
  velocity: number;
  beat: number;
}>;

export type MidiTakeNote = Readonly<{
  pitch: number;
  velocity: number;
  startBeat: number;
  lengthBeats: number;
}>;

type HeldMidiNote = Readonly<{
  sourceId: string;
  channel: number;
  pitch: number;
  velocity: number;
  startedAtBeat: number;
}>;

type RawMidiNote = Readonly<{
  sourceId: string;
  channel: number;
  pitch: number;
  velocity: number;
  startedAtBeat: number;
  endedAtBeat: number;
}>;

export type MidiTakeSession = Readonly<{
  phase: MidiTakePhase;
  mode: MidiRecordingMode;
  trackId: string;
  slotIndex: number;
  clipId: string | null;
  requestedAtBeat: number;
  startBeat: number;
  endBeat: number;
  beatsPerBar: number;
  lengthBars: MidiRecordingLengthBars;
  lastObservedBeat: number;
  held: Readonly<Record<string, HeldMidiNote>>;
  notes: readonly RawMidiNote[];
  discardReason: string | null;
}>;

export function createMidiTakeSession(input: {
  readonly mode: MidiRecordingMode;
  readonly trackId: string;
  readonly slotIndex: number;
  readonly clipId: string | null;
  readonly requestedAtBeat: number;
  readonly startBeat: number;
  readonly beatsPerBar: number;
  readonly lengthBars: MidiRecordingLengthBars;
  readonly overdubLoopStartedAtBeat?: number;
}): MidiTakeSession {
  assertRecordingMode(input.mode);
  requiredId(input.trackId, "trackId");
  boundedInteger(input.slotIndex, 0, 1, "slotIndex");
  const requestedAtBeat = nonNegativeFinite(input.requestedAtBeat, "requestedAtBeat");
  const startBeat = nonNegativeFinite(input.startBeat, "startBeat");
  const beatsPerBar = positiveFinite(input.beatsPerBar, "beatsPerBar");
  assertLengthBars(input.lengthBars);
  const loopLengthBeats = beatsPerBar * input.lengthBars;
  const expectedStartBeat = roundBeat(
    (Math.floor(requestedAtBeat / beatsPerBar) + 1) * beatsPerBar,
  );
  if (input.mode === "record" && startBeat !== expectedStartBeat) {
    throw new Error(
      `recording startBeat must be the exact next bar ${expectedStartBeat}`,
    );
  }
  if (input.mode === "overdub") {
    const anchor = nonNegativeFinite(
      input.overdubLoopStartedAtBeat ?? Number.NaN,
      "overdubLoopStartedAtBeat",
    );
    const loopPosition = roundBeat((startBeat - anchor) / loopLengthBeats);
    if (
      startBeat <= requestedAtBeat ||
      startBeat < anchor ||
      !Number.isInteger(loopPosition)
    ) {
      throw new Error("overdub startBeat must be a strictly future active-loop boundary");
    }
  }
  if (input.mode === "record" && input.clipId !== null) {
    throw new Error("recording an empty slot must not target an existing clip");
  }
  if (input.mode === "overdub" && !input.clipId) {
    throw new Error("overdub requires an existing clipId");
  }
  return freezeSession({
    phase: "queued",
    mode: input.mode,
    trackId: input.trackId,
    slotIndex: input.slotIndex,
    clipId: input.clipId,
    requestedAtBeat,
    startBeat,
    endBeat: roundBeat(startBeat + loopLengthBeats),
    beatsPerBar,
    lengthBars: input.lengthBars,
    lastObservedBeat: requestedAtBeat,
    held: {},
    notes: [],
    discardReason: null,
  });
}

export function advanceMidiTake(session: MidiTakeSession, beatInput: number): MidiTakeSession {
  if (session.phase === "completed" || session.phase === "discarded") return session;
  const beat = nonNegativeFinite(beatInput, "beat");
  if (beat < session.lastObservedBeat) {
    throw new Error(`recording beat ${beat} is before observed beat ${session.lastObservedBeat}`);
  }
  if (beat >= session.endBeat) {
    return freezeSession({
      ...closeHeldNotes(session, session.endBeat),
      phase: "completed",
      lastObservedBeat: beat,
    });
  }
  const phase =
    session.phase === "queued" && beat >= session.startBeat
      ? session.mode === "record" ? "recording" : "overdubbing"
      : session.phase;
  return freezeSession({ ...session, phase, lastObservedBeat: beat });
}

/**
 * Apply one normalized event. A same-source/channel/pitch retrigger first closes
 * the previous note at the retrigger beat, then opens the replacement.
 */
export function captureMidiInputEvent(
  sessionInput: MidiTakeSession,
  eventInput: MidiNoteInputEvent,
): MidiTakeSession {
  const event = normalizeMidiInputEvent(eventInput);
  let session = advanceMidiTake(sessionInput, event.beat);
  const key = heldNoteKey(event.sourceId, event.channel, event.pitch);
  if (event.velocity === 0) return closeHeldNote(session, key, event.beat);
  if (session.phase !== "recording" && session.phase !== "overdubbing") return session;
  if (session.held[key]) session = closeHeldNote(session, key, event.beat);
  return freezeSession({
    ...session,
    held: {
      ...session.held,
      [key]: Object.freeze({
        sourceId: event.sourceId,
        channel: event.channel,
        pitch: event.pitch,
        velocity: event.velocity,
        startedAtBeat: event.beat,
      }),
    },
  });
}

/** Close every held note for one disconnected or released input source. */
export function releaseMidiInputSource(
  sessionInput: MidiTakeSession,
  sourceIdInput: string,
  beatInput: number,
): MidiTakeSession {
  const sourceId = requiredId(sourceIdInput, "sourceId");
  const beat = nonNegativeFinite(beatInput, "beat");
  let session = advanceMidiTake(sessionInput, beat);
  for (const [key, held] of Object.entries(session.held)) {
    if (held.sourceId === sourceId) session = closeHeldNote(session, key, beat);
  }
  return session;
}

/** Discard is all-or-nothing: held and completed raw notes are both removed. */
export function discardMidiTake(session: MidiTakeSession, reasonInput: string): MidiTakeSession {
  if (session.phase === "discarded") return session;
  const reason = requiredId(reasonInput, "discard reason");
  return freezeSession({
    ...session,
    phase: "discarded",
    held: {},
    notes: [],
    discardReason: reason,
  });
}

/**
 * Quantize starts onto the quarter-beat grid modulo the loop. Durations retain
 * their captured value subject to a quarter-beat minimum and the clip boundary.
 */
export function materializeMidiTakeNotes(
  session: MidiTakeSession,
): readonly MidiTakeNote[] {
  if (session.phase !== "completed") {
    throw new Error("only a completed MIDI take can be materialized");
  }
  const grid = MIDI_RECORDING_GRID_BEATS;
  const loopLength = session.endBeat - session.startBeat;
  return Object.freeze(session.notes.map((note) => {
    const relativeStart = modulo(note.startedAtBeat - session.startBeat, loopLength);
    const startBeat = roundBeat(modulo(Math.round(relativeStart / grid) * grid, loopLength));
    const capturedLength = note.endedAtBeat - note.startedAtBeat;
    const lengthBeats = roundBeat(Math.min(
      Math.max(MIDI_RECORDING_MIN_NOTE_BEATS, capturedLength),
      loopLength - startBeat,
    ));
    return Object.freeze({
      pitch: note.pitch,
      velocity: note.velocity,
      startBeat,
      lengthBeats,
    });
  }));
}

/**
 * Build the single atomic document batch for a completed take. Every created
 * clip and note identity is explicit before the batch leaves this boundary.
 */
export function buildMidiTakeCommands(input: {
  readonly trackId: string;
  readonly clipId: string;
  readonly clipName?: string;
  readonly clipStartBeat?: number;
  readonly loopLengthBeats: number;
  readonly createClip: boolean;
  readonly notes: readonly MidiTakeNote[];
  readonly noteIdFactory: (index: number) => string;
  readonly reservedIds?: ReadonlySet<string>;
}): readonly BeatTwinCommand[] {
  requiredId(input.trackId, "trackId");
  const clipId = requiredId(input.clipId, "clipId");
  const loopLengthBeats = positiveFinite(input.loopLengthBeats, "loopLengthBeats");
  if (input.notes.length === 0) return Object.freeze([]);
  const claimedIds = new Set(input.reservedIds ?? []);
  if (input.createClip && claimedIds.has(clipId)) {
    throw new Error(`duplicate MIDI take id ${clipId}`);
  }
  claimedIds.add(clipId);
  const commands: BeatTwinCommand[] = [];
  if (input.createClip) {
    commands.push({
      type: "CreateClip",
      id: clipId,
      trackId: input.trackId,
      name: input.clipName ?? "Recorded loop",
      startBeat: nonNegativeFinite(input.clipStartBeat ?? 0, "clipStartBeat"),
      lengthBeats: loopLengthBeats,
    });
  }
  input.notes.forEach((note, index) => {
    const id = requiredId(input.noteIdFactory(index), `noteId ${index}`);
    if (claimedIds.has(id)) throw new Error(`duplicate MIDI take id ${id}`);
    claimedIds.add(id);
    commands.push({
      type: "AddNote",
      id,
      trackId: input.trackId,
      clipId,
      pitch: midiInteger(note.pitch, "pitch"),
      velocity: positiveMidiVelocity(note.velocity),
      startBeat: boundedNoteStart(note.startBeat, loopLengthBeats),
      lengthBeats: boundedNoteLength(note.startBeat, note.lengthBeats, loopLengthBeats),
    });
  });
  return Object.freeze(commands);
}

function closeHeldNote(
  session: MidiTakeSession,
  key: string,
  beatInput: number,
): MidiTakeSession {
  const held = session.held[key];
  if (!held) return session;
  const endedAtBeat = Math.min(
    session.endBeat,
    Math.max(held.startedAtBeat, nonNegativeFinite(beatInput, "beat")),
  );
  const heldNotes = { ...session.held };
  delete heldNotes[key];
  return freezeSession({
    ...session,
    held: heldNotes,
    notes: [...session.notes, Object.freeze({
      sourceId: held.sourceId,
      channel: held.channel,
      pitch: held.pitch,
      velocity: held.velocity,
      startedAtBeat: held.startedAtBeat,
      endedAtBeat,
    })],
  });
}

function closeHeldNotes(session: MidiTakeSession, beat: number): MidiTakeSession {
  let next = session;
  for (const key of Object.keys(session.held)) next = closeHeldNote(next, key, beat);
  return next;
}

function normalizeMidiInputEvent(event: MidiNoteInputEvent): MidiNoteInputEvent {
  return Object.freeze({
    sourceId: requiredId(event.sourceId, "sourceId"),
    channel: boundedInteger(event.channel, 0, 15, "channel"),
    pitch: midiInteger(event.pitch, "pitch"),
    velocity: midiInteger(event.velocity, "velocity"),
    beat: nonNegativeFinite(event.beat, "beat"),
  });
}

function heldNoteKey(sourceId: string, channel: number, pitch: number): string {
  return JSON.stringify([sourceId, channel, pitch]);
}

function freezeSession(session: MidiTakeSession): MidiTakeSession {
  return Object.freeze({
    ...session,
    held: Object.freeze({ ...session.held }),
    notes: Object.freeze([...session.notes]),
  });
}

function boundedNoteStart(value: number, loopLength: number): number {
  const start = nonNegativeFinite(value, "note startBeat");
  if (start >= loopLength) throw new Error("note startBeat must be inside the loop");
  return start;
}

function boundedNoteLength(start: number, length: number, loopLength: number): number {
  const normalized = positiveFinite(length, "note lengthBeats");
  if (normalized < MIDI_RECORDING_MIN_NOTE_BEATS) {
    throw new Error(`note lengthBeats must be at least ${MIDI_RECORDING_MIN_NOTE_BEATS}`);
  }
  if (start + normalized > loopLength) {
    throw new Error("note must not escape the loop");
  }
  return normalized;
}

function assertLengthBars(value: number): asserts value is MidiRecordingLengthBars {
  if (!(MIDI_RECORDING_LENGTH_BARS as readonly number[]).includes(value)) {
    throw new Error("lengthBars must be one of 1, 2, 4, or 8");
  }
}

function assertRecordingMode(value: string): asserts value is MidiRecordingMode {
  if (value !== "record" && value !== "overdub") {
    throw new Error("mode must be record or overdub");
  }
}

function positiveMidiVelocity(value: number): number {
  const velocity = midiInteger(value, "velocity");
  if (velocity === 0) throw new Error("materialized note velocity must be positive");
  return velocity;
}

function midiInteger(value: number, label: string): number {
  return boundedInteger(value, 0, 127, label);
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  const number = finite(value, label);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function positiveFinite(value: number, label: string): number {
  const number = finite(value, label);
  if (number <= 0) throw new Error(`${label} must be positive`);
  return number;
}

function nonNegativeFinite(value: number, label: string): number {
  const number = finite(value, label);
  if (number < 0) throw new Error(`${label} must be non-negative`);
  return number;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function requiredId(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return value;
}

function modulo(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function roundBeat(beat: number): number {
  return Math.round(beat * 1_000_000_000) / 1_000_000_000;
}
