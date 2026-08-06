import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILT_IN_INSTRUMENTS,
  AUDIO_ASSET_REFERENCE_SCHEMA_VERSION,
  MAX_AUDIO_ASSET_BYTE_LENGTH,
  DEFAULT_BUILT_IN_INSTRUMENT_ID,
  SONG_SCHEMA_VERSION,
  addClip,
  addAudioAssetReference,
  addNote,
  addTrack,
  createClip,
  createAudioAssetReference,
  createNote,
  createSong,
  createTrack,
  deserializeSong,
  duplicateClip,
  quantizeClip,
  removeNote,
  serializeSong,
  setTempo,
  setTrackInstrument,
  setTransportPlaying,
  setTransportPosition,
  transposeClip,
  updateNote,
} from "../src/index.ts";

const AUDIO_HASH = `sha256:${"a".repeat(64)}`;

function audioAsset(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: AUDIO_ASSET_REFERENCE_SCHEMA_VERSION,
    id: "asset-kick",
    label: "Kick one-shot",
    mediaType: "audio/wav",
    byteLength: 42_000,
    contentHash: AUDIO_HASH,
    locator: { kind: "browser-local", key: "asset_kick_v1" },
    ...overrides,
  };
}

test("creates a default immutable song document", () => {
  const song = createSong({ id: "song-1" });

  assert.equal(song.title, "Untitled Beat Twin Song");
  assert.equal(song.transport.bpm, 120);
  assert.equal(song.transport.positionBeats, 0);
  assert.deepEqual(song.tracks, []);
  assert.throws(() => {
    song.tracks.push(createTrack({ id: "track-late" }));
  }, TypeError);
});

test("adds tracks, clips, and relative notes without mutating previous state", () => {
  const song = createSong({ id: "song-1", title: "Draft", bpm: 126 });
  const track = createTrack({ id: "track-1", name: "Drums", color: "#f26d6d" });
  const withTrack = addTrack(song, track);
  const clip = createClip({
    id: "clip-1",
    trackId: "track-1",
    name: "Kick loop",
    startBeat: 8,
    lengthBeats: 4,
  });
  const withClip = addClip(withTrack, "track-1", clip);
  const note = createNote({
    id: "note-1",
    pitch: 36,
    velocity: 112,
    startBeat: 0,
    lengthBeats: 0.5,
  });
  const withNote = addNote(withClip, "track-1", "clip-1", note);
  const retimed = setTempo(withNote, 130);

  assert.notEqual(withTrack, song);
  assert.equal(song.tracks.length, 0);
  assert.equal(withTrack.tracks.length, 1);
  assert.equal(withClip.tracks[0].clips[0].startBeat, 8);
  assert.equal(withNote.tracks[0].clips[0].pattern.notes[0].startBeat, 0);
  assert.equal(retimed.transport.bpm, 130);
  assert.equal(withNote.transport.bpm, 126);
});

test("updates transport preview state immutably", () => {
  const song = createSong({ id: "song-1", bpm: 118 });
  const playing = setTransportPlaying(song, true);
  const moved = setTransportPosition(playing, 12.5);
  const stopped = setTransportPlaying(moved, false);

  assert.equal(song.transport.isPlaying, false);
  assert.equal(playing.transport.isPlaying, true);
  assert.equal(moved.transport.positionBeats, 12.5);
  assert.equal(stopped.transport.isPlaying, false);
  assert.equal(stopped.transport.isRecording, false);
});

test("updates and removes notes without mutating previous clip state", () => {
  const song = addTrack(createSong({ id: "song-1" }), createTrack({ id: "track-1" }));
  const clip = createClip({ id: "clip-1", trackId: "track-1", lengthBeats: 4 });
  const withClip = addClip(song, "track-1", clip);
  const withNote = addNote(
    withClip,
    "track-1",
    "clip-1",
    createNote({ id: "note-1", pitch: 60, velocity: 90, startBeat: 0, lengthBeats: 1 }),
  );
  const updated = updateNote(withNote, "track-1", "clip-1", "note-1", {
    pitch: 64,
    velocity: 110,
    startBeat: 1,
  });
  const removed = removeNote(updated, "track-1", "clip-1", "note-1");

  assert.deepEqual(withNote.tracks[0].clips[0].pattern.notes[0], {
    id: "note-1",
    pitch: 60,
    velocity: 90,
    startBeat: 0,
    lengthBeats: 1,
  });
  assert.deepEqual(updated.tracks[0].clips[0].pattern.notes[0], {
    id: "note-1",
    pitch: 64,
    velocity: 110,
    startBeat: 1,
    lengthBeats: 1,
  });
  assert.deepEqual(removed.tracks[0].clips[0].pattern.notes, []);
  assert.throws(
    () => updateNote(withNote, "track-1", "clip-1", "note-1", { startBeat: 3.5 }),
    /fit inside/,
  );
  assert.throws(
    () => removeNote(withNote, "track-1", "clip-1", "missing-note"),
    /Note not found/,
  );
});

test("duplicates, quantizes, and transposes clip patterns immutably", () => {
  const song = addTrack(createSong({ id: "song-1" }), createTrack({ id: "track-1" }));
  const withClip = addClip(
    song,
    "track-1",
    createClip({ id: "clip-1", trackId: "track-1", name: "Hook", lengthBeats: 4 }),
  );
  const withNotes = addNote(
    addNote(
      withClip,
      "track-1",
      "clip-1",
      createNote({ id: "note-1", pitch: 60, velocity: 90, startBeat: 0.12, lengthBeats: 0.5 }),
    ),
    "track-1",
    "clip-1",
    createNote({ id: "note-2", pitch: 64, velocity: 95, startBeat: 3.88, lengthBeats: 0.1 }),
  );

  const duplicated = duplicateClip(withNotes, "track-1", "clip-1", {
    id: "clip-2",
    noteIds: ["note-3", "note-4"],
  });
  const quantized = quantizeClip(duplicated, "track-1", "clip-2", 0.25);
  const transposed = transposeClip(quantized, "track-1", "clip-2", -12);

  assert.equal(withNotes.tracks[0].clips.length, 1);
  assert.equal(duplicated.tracks[0].clips[1].name, "Hook Copy");
  assert.equal(duplicated.tracks[0].clips[1].startBeat, 4);
  assert.deepEqual(
    duplicated.tracks[0].clips[1].pattern.notes.map((note) => note.id),
    ["note-3", "note-4"],
  );
  assert.deepEqual(
    quantized.tracks[0].clips[1].pattern.notes.map((note) => note.startBeat),
    [0, 3.9],
  );
  assert.deepEqual(
    transposed.tracks[0].clips[1].pattern.notes.map((note) => note.pitch),
    [48, 52],
  );
  assert.deepEqual(
    withNotes.tracks[0].clips[0].pattern.notes.map((note) => note.startBeat),
    [0.12, 3.88],
  );

  assert.throws(
    () => duplicateClip(withNotes, "track-1", "clip-1", { id: "clip-3", noteIds: ["note-5"] }),
    /noteIds/,
  );
  assert.throws(() => quantizeClip(withNotes, "track-1", "clip-1", 0), /gridBeats/);
  assert.throws(() => transposeClip(withNotes, "track-1", "clip-1", 100), /note pitch/);
});

test("round trips through the stable JSON serializer", () => {
  const song = addAudioAssetReference(addTrack(
    createSong({ id: "song-1", title: "Roundtrip" }),
    createTrack({ id: "track-1", name: "Bass" }),
  ), createAudioAssetReference({
    id: "asset-kick",
    label: "Kick one-shot",
    mediaType: "audio/wav",
    byteLength: 42_000,
    contentHash: AUDIO_HASH,
    storageKey: "asset_kick_v1",
  }));

  assert.deepEqual(deserializeSong(serializeSong(song)), song);
  assert.ok(Object.isFrozen(song.audioAssets));
  assert.ok(Object.isFrozen(song.audioAssets[0]));
  assert.ok(Object.isFrozen(song.audioAssets[0]?.locator));
});

test("migrates legacy songs to an explicit deterministic instrument", () => {
  const legacy = {
    schemaVersion: 1,
    id: "song-legacy",
    title: "Legacy",
    transport: {
      bpm: 120,
      positionBeats: 0,
      isPlaying: false,
      isRecording: false,
    },
    tracks: [
      {
        id: "track-legacy",
        name: "Old synth",
        kind: "instrument",
        color: "#36c2a1",
        clips: [],
      },
    ],
  };

  const migrated = deserializeSong(legacy);
  assert.equal(migrated.schemaVersion, SONG_SCHEMA_VERSION);
  assert.deepEqual(migrated.audioAssets, []);
  assert.equal(migrated.tracks[0]?.instrumentId, DEFAULT_BUILT_IN_INSTRUMENT_ID);
  assert.equal(JSON.parse(serializeSong(migrated)).schemaVersion, SONG_SCHEMA_VERSION);
});

test("migrates schema v2 songs without inventing audio asset references", () => {
  const migrated = deserializeSong({
    schemaVersion: 2,
    id: "song-v2",
    title: "Before assets",
    transport: {
      bpm: 120,
      positionBeats: 0,
      isPlaying: false,
      isRecording: false,
    },
    tracks: [],
  });

  assert.equal(migrated.schemaVersion, SONG_SCHEMA_VERSION);
  assert.deepEqual(migrated.audioAssets, []);

  const ignoredPreContractField = deserializeSong({
    schemaVersion: 2,
    id: "song-v2-untrusted",
    title: "Before assets",
    transport: {
      bpm: 120,
      positionBeats: 0,
      isPlaying: false,
      isRecording: false,
    },
    audioAssets: [{ url: "https://example.invalid/not-a-v2-field.wav" }],
    tracks: [],
  });
  assert.deepEqual(ignoredPreContractField.audioAssets, []);
});

test("validates bounded browser-owned audio asset metadata", () => {
  const song = createSong({ id: "song-assets" });
  const reference = createAudioAssetReference({
    id: "asset-kick",
    label: "Kick one-shot",
    mediaType: "audio/wav",
    byteLength: 42_000,
    contentHash: AUDIO_HASH,
    storageKey: "asset_kick_v1",
  });
  const withAsset = addAudioAssetReference(song, reference);

  assert.equal(withAsset.audioAssets[0]?.locator.kind, "browser-local");
  assert.equal(withAsset.audioAssets[0]?.locator.key, "asset_kick_v1");
  assert.equal(song.audioAssets.length, 0);
  assert.throws(() => addAudioAssetReference(withAsset, reference), /Duplicate audio asset id/);
  assert.throws(
    () => addAudioAssetReference(withAsset, createAudioAssetReference({
      id: "asset-copy",
      label: "Copy",
      mediaType: "audio/wav",
      byteLength: 42_000,
      contentHash: AUDIO_HASH,
      storageKey: "asset_kick_v1",
    })),
    /Duplicate audio asset locator key/,
  );
});

test("rejects untrusted or ambiguous audio asset references", () => {
  const baseSong = {
    schemaVersion: SONG_SCHEMA_VERSION,
    id: "song-assets",
    title: "Assets",
    transport: { bpm: 120, positionBeats: 0, isPlaying: false, isRecording: false },
    tracks: [],
  };
  const parseAsset = (asset: unknown) => deserializeSong({ ...baseSong, audioAssets: [asset] });

  assert.throws(() => parseAsset(audioAsset({ schemaVersion: 2 })), /Unsupported audio asset/);
  assert.throws(() => parseAsset(audioAsset({ mediaType: "application/octet-stream" })), /mediaType/);
  assert.throws(() => parseAsset(audioAsset({ byteLength: 0 })), /byteLength/);
  assert.throws(() => parseAsset(audioAsset({ byteLength: 1.5 })), /byteLength/);
  assert.throws(() => parseAsset(audioAsset({ byteLength: Number.NaN })), /byteLength/);
  assert.throws(() => parseAsset(audioAsset({ byteLength: Number.POSITIVE_INFINITY })), /byteLength/);
  assert.throws(
    () => parseAsset(audioAsset({ byteLength: MAX_AUDIO_ASSET_BYTE_LENGTH + 1 })),
    /byteLength/,
  );
  assert.throws(() => parseAsset(audioAsset({ contentHash: "sha256:ABC" })), /contentHash/);
  assert.throws(() => parseAsset(audioAsset({ contentHash: `SHA256:${"a".repeat(64)}` })), /contentHash/);
  assert.throws(() => parseAsset(audioAsset({ contentHash: ` ${AUDIO_HASH} ` })), /surrounding whitespace/);
  assert.throws(
    () => parseAsset(audioAsset({ locator: { kind: "browser-local", key: " asset_kick_v1 " } })),
    /surrounding whitespace/,
  );
  assert.throws(
    () => parseAsset(audioAsset({ locator: { kind: "browser-local", key: "file:///tmp/kick.wav" } })),
    /opaque browser-local/,
  );
  assert.throws(
    () => parseAsset(audioAsset({ locator: { kind: "browser-local", key: "blob:https://example.invalid/id" } })),
    /opaque browser-local/,
  );
  assert.throws(
    () => parseAsset(audioAsset({ locator: { kind: "remote", key: "asset_kick_v1" } })),
    /browser-local/,
  );
  assert.throws(() => parseAsset({ ...audioAsset(), url: "https://example.invalid/kick.wav" }), /unsupported field/);
  assert.throws(
    () => parseAsset(audioAsset({ locator: { kind: "browser-local", key: "asset_kick_v1", path: "/tmp/kick.wav" } })),
    /unsupported field/,
  );
  assert.throws(
    () => deserializeSong({ ...baseSong, audioAssets: [audioAsset(), audioAsset({ id: "asset-copy" })] }),
    /Duplicate audio asset locator key/,
  );
  assert.throws(() => deserializeSong({ ...baseSong }), /audioAssets must be an array/);
});

test("validates and projects the song before serialization", () => {
  const forged = {
    ...createSong({ id: "song-forged" }),
    audioAssets: [
      {
        ...audioAsset(),
        url: "https://example.invalid/kick.wav",
        bytes: [1, 2, 3],
      },
    ],
  };

  assert.throws(() => serializeSong(forged as never), /unsupported field/);
});

test("bounds built-in instruments and updates them immutably", () => {
  assert.deepEqual(BUILT_IN_INSTRUMENTS.map((instrument) => instrument.id), [
    "drums",
    "bass",
    "chords",
    "lead",
  ]);
  assert.ok(Object.isFrozen(BUILT_IN_INSTRUMENTS));

  const song = addTrack(
    createSong({ id: "song-1" }),
    createTrack({ id: "track-1", instrumentId: "bass" }),
  );
  const changed = setTrackInstrument(song, "track-1", "chords");
  assert.equal(song.tracks[0]?.instrumentId, "bass");
  assert.equal(changed.tracks[0]?.instrumentId, "chords");
  assert.throws(
    () => createTrack({ id: "audio", kind: "audio", instrumentId: "lead" }),
    /only valid for instrument tracks/,
  );
  assert.throws(
    () => createTrack({ id: "unknown", instrumentId: "organ" as never }),
    /drums, bass, chords, or lead/,
  );
});

test("rejects invalid schemas and malformed musical data", () => {
  assert.throws(
    () => deserializeSong({ schemaVersion: 999, id: "song-1", transport: {}, tracks: [] }),
    /Unsupported song schema/,
  );
  assert.throws(
    () => createNote({ id: "bad-note", pitch: 200, startBeat: 0 }),
    /note pitch/,
  );
  assert.throws(() => {
    const song = addTrack(createSong({ id: "song-1" }), createTrack({ id: "track-1" }));
    const clip = createClip({ id: "clip-1", trackId: "track-1", lengthBeats: 1 });
    const withClip = addClip(song, "track-1", clip);
    return addNote(
      withClip,
      "track-1",
      "clip-1",
      createNote({ id: "note-1", pitch: 60, startBeat: 0.75, lengthBeats: 0.5 }),
    );
  }, /fit inside/);
});
