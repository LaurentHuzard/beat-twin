import { describe, expect, it } from "vitest";

import {
  advanceMidiTake,
  buildMidiTakeCommands,
  captureMidiInputEvent,
  createMidiTakeSession,
  discardMidiTake,
  materializeMidiTakeNotes,
  releaseMidiInputSource,
  type MidiNoteInputEvent,
} from "./midiRecording";

describe("quantized MIDI take model", () => {
  it.each([1, 2, 4, 8] as const)("bounds a %s-bar take to one exact queued window", (lengthBars) => {
    const take = createMidiTakeSession({
      mode: "record",
      trackId: "track-a",
      slotIndex: 0,
      clipId: null,
      requestedAtBeat: 1,
      startBeat: 4,
      beatsPerBar: 4,
      lengthBars,
    });
    expect(take).toMatchObject({ phase: "queued", startBeat: 4, endBeat: 4 + lengthBars * 4 });
  });

  it("normalizes source/channel/pitch, treats velocity zero as off, and closes retriggers", () => {
    let take = advanceMidiTake(queuedTake(), 4);
    take = event(take, { sourceId: "keyboard", channel: 0, pitch: 60, velocity: 96, beat: 4.12 });
    take = event(take, { sourceId: "keyboard", channel: 0, pitch: 60, velocity: 110, beat: 4.37 });
    take = event(take, { sourceId: "keyboard", channel: 0, pitch: 60, velocity: 0, beat: 4.62 });
    take = advanceMidiTake(take, 8);

    expect(take.notes).toHaveLength(2);
    expect(materializeMidiTakeNotes(take)).toEqual([
      { pitch: 60, velocity: 96, startBeat: 0, lengthBeats: 0.25 },
      { pitch: 60, velocity: 110, startBeat: 0.25, lengthBeats: 0.25 },
    ]);
  });

  it("keeps same pitches from distinct sources or channels independent", () => {
    let take = advanceMidiTake(queuedTake(), 4);
    take = event(take, { sourceId: "keyboard", channel: 0, pitch: 60, velocity: 90, beat: 4.1 });
    take = event(take, { sourceId: "midi-a", channel: 1, pitch: 60, velocity: 100, beat: 4.2 });
    take = event(take, { sourceId: "keyboard", channel: 0, pitch: 60, velocity: 0, beat: 4.4 });
    expect(Object.values(take.held)).toEqual([
      expect.objectContaining({ sourceId: "midi-a", channel: 1 }),
    ]);
  });

  it("quantizes modulo the loop and clamps duration to a quarter beat and clip end", () => {
    let take = advanceMidiTake(queuedTake(), 4);
    take = event(take, { sourceId: "midi-a", channel: 2, pitch: 65, velocity: 100, beat: 7.62 });
    take = event(take, { sourceId: "midi-a", channel: 2, pitch: 64, velocity: 127, beat: 7.9 });
    take = event(take, { sourceId: "midi-a", channel: 2, pitch: 64, velocity: 0, beat: 7.95 });
    take = advanceMidiTake(take, 8.5);

    expect(take.phase).toBe("completed");
    expect(take.held).toEqual({});
    expect(materializeMidiTakeNotes(take)).toEqual([
      { pitch: 64, velocity: 127, startBeat: 0, lengthBeats: 0.25 },
      { pitch: 65, velocity: 100, startBeat: 3.5, lengthBeats: 0.38 },
    ]);
  });

  it("finalizes every active note at endBeat and ignores a late note-off", () => {
    let take = advanceMidiTake(queuedTake(), 4);
    take = event(take, { sourceId: "keyboard", channel: 0, pitch: 62, velocity: 100, beat: 7.5 });
    take = advanceMidiTake(take, 9);
    expect(materializeMidiTakeNotes(take)).toEqual([
      { pitch: 62, velocity: 100, startBeat: 3.5, lengthBeats: 0.5 },
    ]);
    expect(event(take, { sourceId: "keyboard", channel: 0, pitch: 62, velocity: 0, beat: 9 })).toBe(take);
  });

  it("releases only one disconnected source and discards interrupted takes atomically", () => {
    let take = advanceMidiTake(queuedTake(), 4);
    take = event(take, { sourceId: "midi-a", channel: 0, pitch: 60, velocity: 100, beat: 4.2 });
    take = event(take, { sourceId: "keyboard", channel: 0, pitch: 62, velocity: 90, beat: 4.25 });
    take = releaseMidiInputSource(take, "midi-a", 4.5);
    expect(Object.values(take.held)).toEqual([expect.objectContaining({ sourceId: "keyboard" })]);
    take = discardMidiTake(take, "document hidden");
    expect(take).toMatchObject({ phase: "discarded", notes: [], held: {}, discardReason: "document hidden" });
    expect(() => materializeMidiTakeNotes(take)).toThrow(/completed/);
  });

  it("allows a completed but uncommitted take to be discarded and keeps discard idempotent", () => {
    let take = advanceMidiTake(queuedTake(), 8);
    expect(take.phase).toBe("completed");
    take = discardMidiTake(take, "commit rejected");
    expect(take).toMatchObject({
      phase: "discarded",
      notes: [],
      held: {},
      discardReason: "commit rejected",
    });
    expect(discardMidiTake(take, "second reason")).toBe(take);
  });

  it("builds a new-clip batch with every ID explicit and unique", () => {
    const commands = buildMidiTakeCommands({
      trackId: "track-a",
      clipId: "clip-take",
      clipName: "Take 1",
      clipStartBeat: 4,
      loopLengthBeats: 4,
      createClip: true,
      notes: [
        { pitch: 36, velocity: 100, startBeat: 0, lengthBeats: 0.25 },
        { pitch: 38, velocity: 110, startBeat: 1, lengthBeats: 0.5 },
      ],
      noteIdFactory: (index) => `take-note-${index + 1}`,
    });
    expect(commands).toEqual([
      { type: "CreateClip", id: "clip-take", trackId: "track-a", name: "Take 1", startBeat: 4, lengthBeats: 4 },
      { type: "AddNote", id: "take-note-1", trackId: "track-a", clipId: "clip-take", pitch: 36, velocity: 100, startBeat: 0, lengthBeats: 0.25 },
      { type: "AddNote", id: "take-note-2", trackId: "track-a", clipId: "clip-take", pitch: 38, velocity: 110, startBeat: 1, lengthBeats: 0.5 },
    ]);
  });

  it("builds overdub AddNote commands only and rejects duplicate or escaping identities", () => {
    const input = {
      trackId: "track-a",
      clipId: "clip-existing",
      loopLengthBeats: 4,
      createClip: false,
      notes: [{ pitch: 60, velocity: 96, startBeat: 0, lengthBeats: 0.25 }],
    } as const;
    expect(buildMidiTakeCommands({ ...input, noteIdFactory: () => "note-new" })).toEqual([
      { type: "AddNote", id: "note-new", trackId: "track-a", clipId: "clip-existing", pitch: 60, velocity: 96, startBeat: 0, lengthBeats: 0.25 },
    ]);
    expect(() => buildMidiTakeCommands({
      ...input,
      notes: [...input.notes, ...input.notes],
      noteIdFactory: () => "note-duplicate",
    })).toThrow(/duplicate MIDI take id/);
    expect(() => buildMidiTakeCommands({
      ...input,
      clipId: "clip-collision",
      createClip: true,
      reservedIds: new Set(["clip-collision"]),
      noteIdFactory: () => "note-new",
    })).toThrow(/duplicate MIDI take id clip-collision/);
    expect(() => buildMidiTakeCommands({
      ...input,
      notes: [{ pitch: 60, velocity: 96, startBeat: 3.9, lengthBeats: 0.25 }],
      noteIdFactory: () => "note-outside",
    })).toThrow(/escape the loop/);
  });

  it("rejects invalid normalized MIDI values and unsupported loop lengths", () => {
    const take = advanceMidiTake(queuedTake(), 4);
    expect(() => event(take, { sourceId: "midi-a", channel: 16, pitch: 60, velocity: 1, beat: 4 })).toThrow(/channel/);
    expect(() => event(take, { sourceId: "midi-a", channel: 0, pitch: 128, velocity: 1, beat: 4 })).toThrow(/pitch/);
    expect(() => createMidiTakeSession({
      mode: "record",
      trackId: "track-a",
      slotIndex: 0,
      clipId: null,
      requestedAtBeat: 1,
      startBeat: 4,
      beatsPerBar: 4,
      lengthBars: 3 as never,
    })).toThrow(/1, 2, 4, or 8/);
  });

  it("bounds the launcher slot, runtime mode, and start to the exact next bar", () => {
    const input = {
      mode: "record" as const,
      trackId: "track-a",
      slotIndex: 0,
      clipId: null,
      requestedAtBeat: 4,
      startBeat: 8,
      beatsPerBar: 4,
      lengthBars: 1 as const,
    };
    expect(createMidiTakeSession(input).startBeat).toBe(8);
    expect(() => createMidiTakeSession({ ...input, slotIndex: 2 })).toThrow(/slotIndex/);
    expect(() => createMidiTakeSession({ ...input, mode: "replace" as never })).toThrow(/mode/);
    expect(() => createMidiTakeSession({ ...input, requestedAtBeat: 4.5, startBeat: 8.25 })).toThrow(
      /exact next bar 8/,
    );
    expect(createMidiTakeSession({
      ...input,
      mode: "overdub",
      clipId: "clip-a",
      requestedAtBeat: 5,
      startBeat: 16,
      lengthBars: 4,
      overdubLoopStartedAtBeat: 0,
    })).toMatchObject({ mode: "overdub", startBeat: 16, endBeat: 32 });
    expect(createMidiTakeSession({
      ...input,
      mode: "overdub",
      clipId: "clip-a",
      requestedAtBeat: 5,
      startBeat: 9,
      lengthBars: 2,
      overdubLoopStartedAtBeat: 1,
    })).toMatchObject({ mode: "overdub", startBeat: 9, endBeat: 17 });
    expect(() => createMidiTakeSession({
      ...input,
      mode: "overdub",
      clipId: "clip-a",
      requestedAtBeat: 5,
      startBeat: 12.25,
      overdubLoopStartedAtBeat: 1,
    })).toThrow(/future active-loop boundary/);
  });
});

function queuedTake() {
  return createMidiTakeSession({
    mode: "record",
    trackId: "track-a",
    slotIndex: 0,
    clipId: null,
    requestedAtBeat: 1,
    startBeat: 4,
    beatsPerBar: 4,
    lengthBars: 1,
  });
}

function event(
  take: ReturnType<typeof queuedTake>,
  input: MidiNoteInputEvent,
) {
  return captureMidiInputEvent(take, input);
}
