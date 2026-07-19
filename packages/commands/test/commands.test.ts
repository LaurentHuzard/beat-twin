import test from "node:test";
import assert from "node:assert/strict";

import {
  createCommandRuntime,
  createCommandState,
  executeCommand,
  executeCommandBatch,
  materializeCommandBatch,
  snapshotCommandState,
  validateCommandSnapshot,
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

test("creates and edits a bounded instrument identity through commands", () => {
  const createdSong = executeCommand(createCommandState(), {
    type: "CreateSong",
    id: "song-1",
  });
  assert.equal(createdSong.ok, true);
  const createdTrack = executeCommand(createdSong.state, {
    type: "CreateTrack",
    id: "track-1",
    name: "Night Bass",
    kind: "instrument",
    instrumentId: "bass",
  });
  assert.equal(createdTrack.ok, true);
  assert.equal(createdTrack.state.song?.tracks[0]?.instrumentId, "bass");
  assert.deepEqual(createdTrack.events, [{
    type: "TrackCreated",
    trackId: "track-1",
    name: "Night Bass",
    kind: "instrument",
    instrumentId: "bass",
  }]);

  const changed = executeCommand(createdTrack.state, {
    type: "SetTrackInstrument",
    trackId: "track-1",
    instrumentId: "chords",
  });
  assert.equal(changed.ok, true);
  assert.equal(changed.state.song?.tracks[0]?.instrumentId, "chords");

  const rejected = executeCommand(createdTrack.state, {
    type: "SetTrackInstrument",
    trackId: "track-1",
    instrumentId: "organ" as never,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state, createdTrack.state);
  assert.equal(createdTrack.state.song?.tracks[0]?.instrumentId, "bass");
});

test("executes a materialized command batch with one revision", () => {
  const initial = createCommandState();
  const preview = materializeCommandBatch(
    initial,
    [
      { type: "CreateSong", title: "Atomic sketch", bpm: 132 },
      { type: "CreateTrack", name: "Acid Pulse", kind: "instrument" },
      { type: "CreateClip", trackId: "track-1", name: "Pulse", lengthBeats: 4 },
      {
        type: "AddNote",
        trackId: "track-1",
        clipId: "clip-1",
        pitch: 45,
        velocity: 104,
        startBeat: 0,
        lengthBeats: 0.25,
      },
    ],
    { idFactory: fixedIds(["song-1", "track-1", "clip-1", "note-1"]) },
  );
  assert.equal(preview.ok, true);
  assert.equal(initial.song, null);
  assert.equal(initial.revision, 0);
  if (!preview.ok) throw new Error(preview.error);

  const result = executeCommandBatch(initial, {
    requestId: "request-1",
    expectedRevision: 0,
    commands: preview.commands,
  });

  assert.equal(result.ok, true);
  assert.equal(initial.revision, 0);
  assert.equal(result.state.revision, 1);
  assert.equal(result.snapshot.revision, 1);
  assert.deepEqual(result.commands.map((command) => "id" in command ? command.id : null), [
    "song-1",
    "track-1",
    "clip-1",
    "note-1",
  ]);
  assert.equal(result.results.length, 4);
  assert.equal(result.events.length, 4);
});

test("rejects an invalid batch atomically", () => {
  const initial = createCommandState();
  const result = executeCommandBatch(initial, {
    requestId: "request-invalid",
    expectedRevision: 0,
    commands: [
      { type: "CreateSong", id: "song-1", title: "Must not leak" },
      { type: "CreateClip", id: "clip-1", trackId: "missing-track", lengthBeats: 4 },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "invalid_command");
  assert.equal(result.state, initial);
  assert.equal(result.snapshot.song, null);
  assert.equal(result.snapshot.revision, 0);
  assert.deepEqual(result.events, []);
  assert.deepEqual(initial.log, []);
});

test("rejects stale revisions before materializing commands", () => {
  const state = createCommandState();
  const result = executeCommandBatch(state, {
    requestId: "request-stale",
    expectedRevision: 1,
    commands: [{ type: "CreateSong", id: "song-1" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "stale_revision");
  assert.equal(result.state, state);
  assert.deepEqual(result.commands, []);
});

test("strictly validates command snapshots and their complete song graph", () => {
  const runtime = createCommandRuntime(createCommandState());
  runtime.executeCommandBatch({
    requestId: "snapshot-song",
    expectedRevision: 0,
    commands: [{ type: "CreateSong", id: "song-1", title: "Verified" }],
  });
  const snapshot = runtime.inspect();
  assert.equal(validateCommandSnapshot(snapshot), true);
  assert.equal(validateCommandSnapshot({ song: null, revision: 0 }), true);
  assert.equal(validateCommandSnapshot({ song: {}, revision: 1 }), false);
  assert.equal(validateCommandSnapshot({ ...snapshot, extra: true }), false);
  assert.equal(
    validateCommandSnapshot({
      ...snapshot,
      song: { ...snapshot.song, transport: { ...snapshot.song?.transport, isPlaying: 1 } },
    }),
    false,
  );
  assert.equal(validateCommandSnapshot(snapshotCommandState(createCommandState())), true);
});

test("makes batch request IDs idempotent in the command runtime", () => {
  const runtime = createCommandRuntime(createCommandState());
  const request = {
    requestId: "request-idempotent",
    expectedRevision: 0,
    commands: [
      { type: "CreateSong", id: "song-1", title: "Once" },
      { type: "CreateTrack", id: "track-1", name: "Once" },
    ],
  } as const;

  const first = runtime.executeCommandBatch(request);
  const replay = runtime.executeCommandBatch(request);

  assert.equal(first.ok, true);
  assert.equal(replay, first);
  assert.equal(runtime.inspect().revision, 1);
  assert.equal(runtime.inspect().song?.tracks.length, 1);
});

test("binds idempotency to the normalized request ID and exact payload", () => {
  const runtime = createCommandRuntime(createCommandState());
  const first = runtime.executeCommandBatch({
    requestId: " request-normalized ",
    expectedRevision: 0,
    commands: [{ type: "CreateSong", id: "song-1", title: "Original" }],
  });
  const replay = runtime.executeCommandBatch({
    requestId: "request-normalized",
    expectedRevision: 0,
    commands: [{ type: "CreateSong", id: "song-1", title: "Original" }],
  });
  const collision = runtime.executeCommandBatch({
    requestId: "request-normalized",
    expectedRevision: 0,
    commands: [{ type: "CreateSong", id: "song-2", title: "Different" }],
  });

  assert.equal(first.ok, true);
  assert.equal(replay, first);
  assert.equal(collision.ok, false);
  assert.equal(collision.ok ? null : collision.errorCode, "invalid_command");
  assert.match(collision.ok ? "" : collision.error, /different payload/);
  assert.equal(runtime.inspect().revision, 1);
  assert.equal(runtime.inspect().song?.id, "song-1");
});

test("returns a stable error for a malformed runtime request", () => {
  const runtime = createCommandRuntime();
  const result = runtime.executeCommandBatch(null as never);

  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.errorCode, "invalid_command");
  assert.equal(runtime.inspect().revision, 0);
});
