import test from "node:test";
import assert from "node:assert/strict";

import {
  createCommandState,
  executeCommand,
  type IdFactory,
} from "../src/index.ts";

function fixedIds(ids: string[]): IdFactory {
  const queue = [...ids];
  return () => {
    const id = queue.shift();
    if (!id) {
      throw new Error("test id queue exhausted");
    }
    return id;
  };
}

test("executes song, track, clip, note, and tempo commands through one bus", () => {
  const idFactory = fixedIds(["song-1", "track-1", "clip-1", "note-1"]);
  let state = createCommandState();

  const songResult = executeCommand(
    state,
    { type: "CreateSong", title: "Command Demo", bpm: 124 },
    { idFactory },
  );
  assert.equal(songResult.ok, true);
  assert.deepEqual(songResult.events, [
    { type: "SongCreated", songId: "song-1", title: "Command Demo" },
  ]);
  state = songResult.state;

  const trackResult = executeCommand(
    state,
    { type: "CreateTrack", name: "Drums", color: "#f26d6d" },
    { idFactory },
  );
  assert.equal(trackResult.ok, true);
  state = trackResult.state;

  const clipResult = executeCommand(
    state,
    { type: "CreateClip", trackId: "track-1", name: "Four bars", lengthBeats: 4 },
    { idFactory },
  );
  assert.equal(clipResult.ok, true);
  state = clipResult.state;

  const noteResult = executeCommand(
    state,
    {
      type: "AddNote",
      trackId: "track-1",
      clipId: "clip-1",
      pitch: 36,
      velocity: 118,
      startBeat: 0,
      lengthBeats: 0.5,
    },
    { idFactory },
  );
  assert.equal(noteResult.ok, true);
  state = noteResult.state;

  const tempoResult = executeCommand(state, { type: "SetTempo", bpm: 128 });
  assert.equal(tempoResult.ok, true);
  assert.equal(tempoResult.state.song?.transport.bpm, 128);
  assert.deepEqual(
    tempoResult.state.log.map((event) => event.type),
    ["SongCreated", "TrackCreated", "ClipCreated", "NoteAdded", "TempoSet"],
  );
  assert.deepEqual(tempoResult.state.song?.tracks[0].clips[0].pattern.notes[0], {
    id: "note-1",
    pitch: 36,
    velocity: 118,
    startBeat: 0,
    lengthBeats: 0.5,
  });
});

test("updates and removes notes through the command bus", () => {
  const idFactory = fixedIds(["song-1", "track-1", "clip-1", "note-1"]);
  let state = createCommandState();

  for (const command of [
    { type: "CreateSong", title: "Note Edit" },
    { type: "CreateTrack", name: "Lead" },
    { type: "CreateClip", trackId: "track-1", lengthBeats: 4 },
    { type: "AddNote", trackId: "track-1", clipId: "clip-1", pitch: 60, startBeat: 0 },
  ] as const) {
    const result = executeCommand(state, command, { idFactory });
    assert.equal(result.ok, true);
    state = result.state;
  }

  const updated = executeCommand(state, {
    type: "UpdateNote",
    trackId: "track-1",
    clipId: "clip-1",
    noteId: "note-1",
    pitch: 65,
    velocity: 88,
    startBeat: 1,
    lengthBeats: 0.5,
  });
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.events, [
    {
      type: "NoteUpdated",
      trackId: "track-1",
      clipId: "clip-1",
      noteId: "note-1",
      pitch: 65,
      startBeat: 1,
    },
  ]);

  const removed = executeCommand(updated.state, {
    type: "RemoveNote",
    trackId: "track-1",
    clipId: "clip-1",
    noteId: "note-1",
  });
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.events, [
    {
      type: "NoteRemoved",
      trackId: "track-1",
      clipId: "clip-1",
      noteId: "note-1",
    },
  ]);
  assert.deepEqual(removed.state.song?.tracks[0].clips[0].pattern.notes, []);
  assert.deepEqual(removed.state.selection, {
    type: "clip",
    id: "clip-1",
    trackId: "track-1",
  });
});

test("runs clip pattern tools through the command bus", () => {
  const idFactory = fixedIds(["song-1", "track-1", "clip-1", "note-1", "clip-2", "note-2"]);
  let state = createCommandState();

  for (const command of [
    { type: "CreateSong", title: "Pattern Tools" },
    { type: "CreateTrack", name: "Bass" },
    { type: "CreateClip", trackId: "track-1", name: "Phrase", lengthBeats: 4 },
    {
      type: "AddNote",
      trackId: "track-1",
      clipId: "clip-1",
      pitch: 60,
      startBeat: 0.37,
      lengthBeats: 0.5,
    },
  ] as const) {
    const result = executeCommand(state, command, { idFactory });
    assert.equal(result.ok, true);
    state = result.state;
  }

  const duplicated = executeCommand(
    state,
    { type: "DuplicateClip", trackId: "track-1", clipId: "clip-1" },
    { idFactory },
  );
  assert.equal(duplicated.ok, true);
  assert.deepEqual(duplicated.events, [
    {
      type: "ClipDuplicated",
      trackId: "track-1",
      sourceClipId: "clip-1",
      clipId: "clip-2",
      startBeat: 4,
    },
  ]);
  assert.deepEqual(duplicated.state.selection, {
    type: "clip",
    id: "clip-2",
    trackId: "track-1",
  });

  const quantized = executeCommand(duplicated.state, {
    type: "QuantizeClip",
    trackId: "track-1",
    clipId: "clip-2",
    gridBeats: 0.25,
  });
  assert.equal(quantized.ok, true);

  const transposed = executeCommand(quantized.state, {
    type: "TransposeClip",
    trackId: "track-1",
    clipId: "clip-2",
    semitones: 7,
  });
  assert.equal(transposed.ok, true);
  assert.deepEqual(
    transposed.state.log.map((event) => event.type).slice(-3),
    ["ClipDuplicated", "ClipQuantized", "ClipTransposed"],
  );
  assert.deepEqual(transposed.state.song?.tracks[0].clips[0].pattern.notes[0], {
    id: "note-1",
    pitch: 60,
    velocity: 100,
    startBeat: 0.37,
    lengthBeats: 0.5,
  });
  assert.deepEqual(transposed.state.song?.tracks[0].clips[1].pattern.notes[0], {
    id: "note-2",
    pitch: 67,
    velocity: 100,
    startBeat: 0.25,
    lengthBeats: 0.5,
  });
});

test("executes transport preview commands through the command bus", () => {
  const idFactory = fixedIds(["song-1"]);
  const created = executeCommand(
    createCommandState(),
    { type: "CreateSong", title: "Transport" },
    { idFactory },
  );
  assert.equal(created.ok, true);

  const started = executeCommand(created.state, {
    type: "StartPlayback",
    positionBeats: 4,
  });
  assert.equal(started.ok, true);
  assert.equal(started.state.song?.transport.isPlaying, true);
  assert.equal(started.state.song?.transport.positionBeats, 4);
  assert.deepEqual(started.events, [
    { type: "PlaybackStarted", positionBeats: 4 },
  ]);

  const moved = executeCommand(started.state, {
    type: "SetPlayhead",
    positionBeats: 8,
  });
  assert.equal(moved.ok, true);
  assert.equal(moved.state.song?.transport.positionBeats, 8);

  const stopped = executeCommand(moved.state, {
    type: "StopPlayback",
  });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.state.song?.transport.isPlaying, false);
  assert.deepEqual(stopped.events, [
    { type: "PlaybackStopped", positionBeats: 8 },
  ]);
});

test("does not mutate prior command states", () => {
  const idFactory = fixedIds(["song-1"]);
  const initial = createCommandState();
  const created = executeCommand(
    initial,
    { type: "CreateSong", title: "Immutable", bpm: 110 },
    { idFactory },
  );
  assert.equal(created.ok, true);

  const retimed = executeCommand(created.state, { type: "SetTempo", bpm: 140 });

  assert.equal(retimed.ok, true);
  assert.equal(initial.song, null);
  assert.equal(created.state.song?.transport.bpm, 110);
  assert.equal(retimed.state.song?.transport.bpm, 140);
  assert.notEqual(retimed.state.song, created.state.song);
});

test("returns command errors without replacing the previous state", () => {
  const state = createCommandState();
  const result = executeCommand(state, { type: "CreateTrack", name: "No song yet" });

  assert.equal(result.ok, false);
  assert.match(result.error, /No song/);
  assert.equal(result.state, state);
  assert.deepEqual(result.events, []);
});
