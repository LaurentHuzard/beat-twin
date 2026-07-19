import assert from "node:assert/strict";
import test from "node:test";

import {
  midiMaterialEvents,
  planLiveLoopOccurrences,
  validateLiveClipMaterial,
  validateLiveMidiClipMaterial,
  type LiveMidiClipMaterial,
} from "../src/index.ts";

const material: LiveMidiClipMaterial = {
  kind: "midi",
  materialId: "clip-a@7",
  version: 7,
  clipId: "clip-a",
  instrumentId: "bass",
  lengthBeats: 4,
  notes: [
    { id: "root", pitch: 36, velocity: 110, startBeat: 0, lengthBeats: 0.5 },
    { id: "turn", pitch: 43, velocity: 90, startBeat: 3, lengthBeats: 0.5 },
  ],
};

test("plans deterministic generic loop occurrences across a finite clock window", () => {
  const occurrences = planLiveLoopOccurrences({
    materialId: material.materialId,
    lengthBeats: material.lengthBeats,
    activationBeat: 4,
    windowStartBeat: 7,
    windowEndBeat: 13,
    events: midiMaterialEvents(material),
  });

  assert.deepEqual(
    occurrences.map(({ eventId, cycle, startBeat }) => ({ eventId, cycle, startBeat })),
    [
      { eventId: "turn", cycle: 0, startBeat: 7 },
      { eventId: "root", cycle: 1, startBeat: 8 },
      { eventId: "turn", cycle: 1, startBeat: 11 },
      { eventId: "root", cycle: 2, startBeat: 12 },
    ],
  );
});

test("keeps unknown future adapter descriptors source-neutral", () => {
  assert.doesNotThrow(() =>
    validateLiveClipMaterial({
      kind: "future-adapter",
      materialId: "future-loop@2",
      version: 2,
      clipId: "future-loop",
      lengthBeats: 8,
    }),
  );
});

test("rejects stale or malformed material before it reaches an audio port", () => {
  assert.throws(
    () => validateLiveMidiClipMaterial({ ...material, version: -1 }),
    /material version/,
  );
  assert.throws(
    () =>
      validateLiveMidiClipMaterial({
        ...material,
        notes: [{ ...material.notes[0]!, startBeat: 4 }],
      }),
    /outside material length/,
  );
  assert.throws(
    () =>
      validateLiveMidiClipMaterial({
        ...material,
        notes: [{ ...material.notes[0]!, startBeat: 3.75, lengthBeats: 0.5 }],
      }),
    /extends beyond material length/,
  );
  assert.throws(
    () =>
      planLiveLoopOccurrences({
        materialId: "broken",
        lengthBeats: 4,
        activationBeat: 0,
        windowStartBeat: 4,
        windowEndBeat: 3,
        events: [],
      }),
    /windowEndBeat/,
  );
});
