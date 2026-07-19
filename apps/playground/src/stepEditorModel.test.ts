import { describe, expect, it } from "vitest";

import type { Clip, Track } from "@beat-twin/core";

import { findNextEmptyLauncherSlot } from "./launcherModel";
import {
  midiNoteName,
  notesAtStep,
  STEP_EDITOR_STEP_COUNT,
  stepLengthBeats,
  stepStartBeat,
} from "./stepEditorModel";

describe("step editor model", () => {
  it("projects every clip length onto exactly sixteen bounded steps", () => {
    const clip = makeClip(6);
    expect(STEP_EDITOR_STEP_COUNT).toBe(16);
    expect(stepLengthBeats(clip)).toBe(0.375);
    expect(stepStartBeat(clip, 15)).toBe(5.625);
    expect(() => stepStartBeat(clip, 16)).toThrow(/between 0 and 15/);
  });

  it("groups off-grid notes into their audible pitch step and names MIDI pitches", () => {
    const clip: Clip = {
      ...makeClip(4),
      pattern: {
        lengthBeats: 4,
        notes: [
          { id: "note-a", pitch: 36, velocity: 90, startBeat: 0.24, lengthBeats: 0.2 },
          { id: "note-b", pitch: 38, velocity: 90, startBeat: 0.24, lengthBeats: 0.2 },
        ],
      },
    };
    expect(notesAtStep(clip, 36, 0).map((note) => note.id)).toEqual(["note-a"]);
    expect(notesAtStep(clip, 36, 1)).toEqual([]);
    expect(midiNoteName(36)).toBe("C2");
    expect(midiNoteName(60)).toBe("C4");
  });

  it("finds only a later empty launcher slot and never proposes overwrite", () => {
    const source = makeClip(4);
    const oneClipTrack: Track = {
      id: "track-a",
      name: "Track A",
      kind: "instrument",
      instrumentId: "bass",
      color: "#111",
      clips: [source],
    };
    expect(findNextEmptyLauncherSlot(oneClipTrack, source.id)).toEqual({
      slotIndex: 1,
      startBeat: 4,
    });
    const fullTrack: Track = {
      ...oneClipTrack,
      clips: [source, { ...source, id: "clip-b", startBeat: 4 }],
    };
    expect(findNextEmptyLauncherSlot(fullTrack, source.id)).toBeNull();
    expect(findNextEmptyLauncherSlot(fullTrack, "clip-b")).toBeNull();
  });
});

function makeClip(lengthBeats: number): Clip {
  return {
    id: "clip-a",
    trackId: "track-a",
    name: "Clip A",
    startBeat: 0,
    lengthBeats,
    pattern: { lengthBeats, notes: [] },
  };
}
