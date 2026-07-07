import test from "node:test";
import assert from "node:assert/strict";

import type { Song } from "@beat-twin/core";

import {
  beatToSeconds,
  beatsToSeconds,
  midiPitchToNoteName,
  midiVelocityToGain,
  scheduleSongNotes,
  secondsPerBeat,
} from "../src/index.ts";

const baseTransport = {
  bpm: 120,
  positionBeats: 0,
  isPlaying: false,
  isRecording: false,
};

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    schemaVersion: 1,
    id: "song-1",
    title: "Scheduler Test",
    transport: baseTransport,
    tracks: [],
    ...overrides,
  } as Song;
}

test("converts clip-relative notes into absolute beat and second events", () => {
  const song = makeSong({
    transport: { ...baseTransport, bpm: 120 },
    tracks: [
      {
        id: "track-1",
        name: "Keys",
        kind: "instrument",
        color: "#36c2a1",
        clips: [
          {
            id: "clip-1",
            trackId: "track-1",
            name: "Hook",
            startBeat: 4,
            lengthBeats: 4,
            pattern: {
              lengthBeats: 4,
              notes: [
                {
                  id: "note-1",
                  pitch: 60,
                  velocity: 96,
                  startBeat: 1,
                  lengthBeats: 0.5,
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(scheduleSongNotes(song), [
    {
      id: "track-1:clip-1:note-1",
      songId: "song-1",
      bpm: 120,
      trackId: "track-1",
      trackName: "Keys",
      trackKind: "instrument",
      trackIndex: 0,
      clipId: "clip-1",
      clipName: "Hook",
      clipIndex: 0,
      noteId: "note-1",
      noteIndex: 0,
      pitch: 60,
      velocity: 96,
      startBeat: 5,
      durationBeats: 0.5,
      endBeat: 5.5,
      startSeconds: 2.5,
      durationSeconds: 0.25,
      endSeconds: 2.75,
    },
  ]);
});

test("sorts events by musical time and source order deterministically", () => {
  const song = makeSong({
    tracks: [
      {
        id: "track-a",
        name: "Lead",
        kind: "instrument",
        color: "#826aed",
        clips: [
          {
            id: "clip-late",
            trackId: "track-a",
            name: "Late",
            startBeat: 4,
            lengthBeats: 4,
            pattern: {
              lengthBeats: 4,
              notes: [
                { id: "late", pitch: 67, velocity: 100, startBeat: 0, lengthBeats: 1 },
              ],
            },
          },
          {
            id: "clip-early",
            trackId: "track-a",
            name: "Early",
            startBeat: 0,
            lengthBeats: 4,
            pattern: {
              lengthBeats: 4,
              notes: [
                { id: "tie-a", pitch: 60, velocity: 100, startBeat: 1, lengthBeats: 1 },
                { id: "first", pitch: 62, velocity: 100, startBeat: 0, lengthBeats: 1 },
              ],
            },
          },
        ],
      },
      {
        id: "track-b",
        name: "Bass",
        kind: "instrument",
        color: "#2d7f73",
        clips: [
          {
            id: "clip-b",
            trackId: "track-b",
            name: "Bassline",
            startBeat: 0,
            lengthBeats: 4,
            pattern: {
              lengthBeats: 4,
              notes: [
                { id: "tie-b", pitch: 48, velocity: 100, startBeat: 1, lengthBeats: 1 },
              ],
            },
          },
        ],
      },
    ],
  });

  const ids = scheduleSongNotes(song).map((event) => event.noteId);

  assert.deepEqual(ids, ["first", "tie-a", "tie-b", "late"]);
});

test("uses the song BPM for beat to second conversion", () => {
  const song = makeSong({
    transport: { ...baseTransport, bpm: 90 },
    tracks: [
      {
        id: "track-1",
        name: "Bass",
        kind: "instrument",
        color: "#2d7f73",
        clips: [
          {
            id: "clip-1",
            trackId: "track-1",
            name: "Line",
            startBeat: 3,
            lengthBeats: 2,
            pattern: {
              lengthBeats: 2,
              notes: [
                { id: "note-1", pitch: 48, velocity: 127, startBeat: 0, lengthBeats: 1.5 },
              ],
            },
          },
        ],
      },
    ],
  });

  const [event] = scheduleSongNotes(song);

  assert.equal(secondsPerBeat(90), 2 / 3);
  assert.equal(beatToSeconds(3, 90), 2);
  assert.equal(beatsToSeconds(1.5, 90), 1);
  assert.equal(event.startSeconds, 2);
  assert.equal(event.durationSeconds, 1);
  assert.equal(event.endSeconds, 3);
});

test("returns immutable events and rejects invalid tempo inputs", () => {
  const song = makeSong();
  const events = scheduleSongNotes(song);

  assert.throws(() => {
    events.push({} as never);
  }, TypeError);
  assert.throws(() => secondsPerBeat(0), /bpm must be greater than 0/);
  assert.throws(
    () => scheduleSongNotes(makeSong({ transport: { ...baseTransport, bpm: Number.NaN } })),
    /song transport bpm must be a finite number/,
  );
});

test("converts MIDI values into Tone-friendly values without loading Tone.js", () => {
  assert.equal(midiPitchToNoteName(0), "C-1");
  assert.equal(midiPitchToNoteName(60), "C4");
  assert.equal(midiPitchToNoteName(127), "G9");
  assert.equal(midiVelocityToGain(0), 0);
  assert.equal(midiVelocityToGain(127), 1);
  assert.throws(() => midiPitchToNoteName(128), /MIDI pitch/);
  assert.throws(() => midiVelocityToGain(1.5), /MIDI velocity/);
});
