import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCommandState, executeCommandBatch } from "@beat-twin/commands";

import {
  SONG_PATCH_V1_JSON_SCHEMA,
  SONG_PATCH_V1_TOOL_SCHEMA,
  SONG_PATCH_V2_JSON_SCHEMA,
  SongPatchValidationError,
  compileSongPatch,
  compileSongPatchV1,
  compileSongPatchV2,
  materializeSongPatchIds,
  previewSongPatchV1,
  previewSongPatchV2,
  safeValidateSongPatchV2,
  safeValidateSongPatchV1,
  validateSongPatchV1,
  validateSongPatchV2,
} from "../src/index.ts";

function validPatch() {
  return {
    schemaVersion: 1,
    tempoBpm: 128,
    track: {
      kind: "instrument",
      name: "Glass Bass",
      clip: {
        name: "Pulse",
        lengthBeats: 4,
        notes: [
          { pitch: 36, velocity: 110, startBeat: 0, lengthBeats: 0.25 },
          { pitch: 43, velocity: 96, startBeat: 1.25, lengthBeats: 0.5 },
        ],
      },
    },
  };
}

function validPatchV2(instrumentId = "bass") {
  return {
    ...validPatch(),
    schemaVersion: 2,
    track: {
      ...validPatch().track,
      instrumentId,
    },
  };
}

test("accepts and freezes a strict SongPatchV1 from unknown", () => {
  const input: unknown = validPatch();
  const patch = validateSongPatchV1(input);

  assert.deepEqual(patch, input);
  assert.ok(Object.isFrozen(patch));
  assert.ok(Object.isFrozen(patch.track));
  assert.ok(Object.isFrozen(patch.track.clip));
  assert.ok(Object.isFrozen(patch.track.clip.notes));
  assert.ok(Object.isFrozen(patch.track.clip.notes[0]));
});

test("accepts every inclusive boundary and sixteen notes", () => {
  const lower = validPatch();
  lower.tempoBpm = 40;
  lower.track.name = "x";
  lower.track.clip.name = "y";
  lower.track.clip.lengthBeats = 1;
  lower.track.clip.notes = [
    { pitch: 0, velocity: 1, startBeat: 0, lengthBeats: 0.25 },
  ];
  assert.equal(safeValidateSongPatchV1(lower).ok, true);

  const upper = validPatch();
  upper.tempoBpm = 240;
  upper.track.name = "t".repeat(64);
  upper.track.clip.name = "🎛".repeat(64);
  upper.track.clip.lengthBeats = 16;
  upper.track.clip.notes = Array.from({ length: 16 }, (_, index) => ({
    pitch: 127,
    velocity: 127,
    startBeat: index,
    lengthBeats: 0.25,
  }));
  assert.equal(safeValidateSongPatchV1(upper).ok, true);
});

test("tempo is optional and no implicit tempo command is introduced", () => {
  const patch = validPatch();
  delete patch.tempoBpm;

  const commands = compileSongPatchV1(patch, { idSeed: "request-no-tempo" });
  assert.equal(commands.some((command) => command.type === "SetTempo"), false);
  assert.equal(commands.length, 5);
  assert.equal(commands[0]?.type, "CreateSong");
});

test("keeps V1 readable with a deterministic lead default", () => {
  const patch = validateSongPatchV1(validPatch());
  const commands = compileSongPatchV1(patch, { idSeed: "legacy-v1" });
  const createTrack = commands.find((command) => command.type === "CreateTrack");
  assert.equal(createTrack?.type, "CreateTrack");
  if (createTrack?.type === "CreateTrack") {
    assert.equal(createTrack.instrumentId, undefined);
  }

  const result = executeCommandBatch(createCommandState(), {
    requestId: "legacy-v1",
    expectedRevision: 0,
    commands,
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.song?.tracks[0]?.instrumentId, "lead");
  assert.equal(previewSongPatchV1(patch).diff.instrumentId, "lead");
});

test("validates and compiles explicit bounded SongPatchV2 instruments", () => {
  const patch = validateSongPatchV2(validPatchV2());
  assert.equal(patch.track.instrumentId, "bass");
  assert.equal(safeValidateSongPatchV2(validPatchV2("organ")).ok, false);

  const commands = compileSongPatchV2(patch, { idSeed: "night-bass" });
  assert.deepEqual(commands, compileSongPatch(patch, { idSeed: "night-bass" }));
  const createTrack = commands.find((command) => command.type === "CreateTrack");
  assert.equal(createTrack?.type, "CreateTrack");
  if (createTrack?.type === "CreateTrack") {
    assert.equal(createTrack.instrumentId, "bass");
  }

  const preview = previewSongPatchV2(patch, { idSeed: "night-bass" });
  assert.equal(preview.diff.instrumentId, "bass");
  assert.ok(preview.summary.includes("Instrument: Bass (bass)"));
  assert.equal(
    SONG_PATCH_V2_JSON_SCHEMA.properties.track.properties.instrumentId.enum.includes("bass"),
    true,
  );
});

test("rejects unknown fields at every level and excluded domains", () => {
  const cases: unknown[] = [
    { ...validPatch(), playback: true },
    { ...validPatch(), tracks: [] },
    { ...validPatch(), track: { ...validPatch().track, device: "Polysynth" } },
    {
      ...validPatch(),
      track: {
        ...validPatch().track,
        clip: { ...validPatch().track.clip, audioFile: "/tmp/kick.wav" },
      },
    },
    {
      ...validPatch(),
      track: {
        ...validPatch().track,
        clip: {
          ...validPatch().track.clip,
          notes: [{ ...validPatch().track.clip.notes[0], channel: 1 }],
        },
      },
    },
  ];

  for (const candidate of cases) {
    const result = safeValidateSongPatchV1(candidate);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((entry) => entry.code === "unknown_field"));
    }
  }
});

test("rejects wrong shape, missing fields, non-instrument tracks, and extra clips", () => {
  const cases: unknown[] = [
    null,
    [],
    {},
    { ...validPatch(), schemaVersion: 2 },
    { ...validPatch(), track: { ...validPatch().track, kind: "audio" } },
    {
      ...validPatch(),
      track: { ...validPatch().track, clips: [validPatch().track.clip] },
    },
    {
      ...validPatch(),
      track: {
        kind: "instrument",
        name: "Missing clip",
      },
    },
  ];

  for (const candidate of cases) {
    assert.equal(safeValidateSongPatchV1(candidate).ok, false);
  }
});

test("rejects invalid tempo, names, MIDI values, counts, and clip bounds", () => {
  const mutations: Array<(patch: ReturnType<typeof validPatch>) => void> = [
    (patch) => {
      patch.tempoBpm = 39.99;
    },
    (patch) => {
      patch.tempoBpm = 240.01;
    },
    (patch) => {
      patch.track.name = "   ";
    },
    (patch) => {
      patch.track.clip.name = "x".repeat(65);
    },
    (patch) => {
      patch.track.clip.lengthBeats = 0.99;
    },
    (patch) => {
      patch.track.clip.lengthBeats = 16.01;
    },
    (patch) => {
      patch.track.clip.notes = [];
    },
    (patch) => {
      patch.track.clip.notes = Array.from({ length: 17 }, () => ({
        pitch: 60,
        velocity: 100,
        startBeat: 0,
        lengthBeats: 0.25,
      }));
    },
    (patch) => {
      patch.track.clip.notes[0]!.pitch = -1;
    },
    (patch) => {
      patch.track.clip.notes[0]!.pitch = 128;
    },
    (patch) => {
      patch.track.clip.notes[0]!.pitch = 60.5;
    },
    (patch) => {
      patch.track.clip.notes[0]!.velocity = 0;
    },
    (patch) => {
      patch.track.clip.notes[0]!.velocity = 128;
    },
  ];

  for (const mutate of mutations) {
    const patch = validPatch();
    mutate(patch);
    assert.equal(safeValidateSongPatchV1(patch).ok, false);
  }
});

test("rejects non-sixteenth notes, non-positive lengths, and notes outside the clip", () => {
  const cases = [
    { pitch: 60, velocity: 100, startBeat: 0.1, lengthBeats: 0.25 },
    { pitch: 60, velocity: 100, startBeat: 0, lengthBeats: 0.3 },
    { pitch: 60, velocity: 100, startBeat: 0, lengthBeats: 0 },
    { pitch: 60, velocity: 100, startBeat: 3.75, lengthBeats: 0.5 },
  ];

  for (const note of cases) {
    const patch = validPatch();
    patch.track.clip.notes = [note];
    assert.equal(safeValidateSongPatchV1(patch).ok, false);
  }

  const result = safeValidateSongPatchV1({
    ...validPatch(),
    track: {
      ...validPatch().track,
      clip: {
        ...validPatch().track.clip,
        notes: [{ pitch: 60, velocity: 100, startBeat: 3.75, lengthBeats: 0.5 }],
      },
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((entry) => entry.code === "note_outside_clip"));
  }
});

test("throws a stable validation error while safe validation remains non-throwing", () => {
  const invalid = { ...validPatch(), schemaVersion: 9 };
  const result = safeValidateSongPatchV1(invalid);
  assert.equal(result.ok, false);
  assert.throws(
    () => validateSongPatchV1(invalid),
    (error: unknown) =>
      error instanceof SongPatchValidationError &&
      error.issues.some((entry) => entry.path === "$.schemaVersion"),
  );
});

test("compiles deterministic executable commands with every ID materialized", () => {
  const first = compileSongPatchV1(validPatch(), { idSeed: "request-42" });
  const second = compileSongPatchV1(validPatch(), { idSeed: "request-42" });
  const otherSeed = compileSongPatchV1(validPatch(), { idSeed: "request-43" });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, otherSeed);
  assert.deepEqual(
    first.map((command) => command.type),
    ["CreateSong", "CreateTrack", "CreateClip", "AddNote", "AddNote"],
  );

  const createTrack = first[1];
  const createClip = first[2];
  const notes = first.slice(3);
  assert.equal(createTrack?.type, "CreateTrack");
  assert.equal(createClip?.type, "CreateClip");
  if (createTrack?.type === "CreateTrack" && createClip?.type === "CreateClip") {
    assert.ok(createTrack.id.length > 0);
    assert.equal(createTrack.kind, "instrument");
    assert.ok(createClip.id.length > 0);
    assert.equal(createClip.trackId, createTrack.id);
    for (const command of notes) {
      assert.equal(command.type, "AddNote");
      if (command.type === "AddNote") {
        assert.ok(command.id.length > 0);
        assert.equal(command.trackId, createTrack.id);
        assert.equal(command.clipId, createClip.id);
      }
    }
  }
  assert.ok(Object.isFrozen(first));
  assert.ok(first.every(Object.isFrozen));
});

test("supports complete ID injection and rejects partial, mismatched, or duplicate IDs", () => {
  const ids = {
    songId: "song-fixed",
    trackId: "track-fixed",
    clipId: "clip-fixed",
    noteIds: ["note-a", "note-b"],
  };
  const commands = compileSongPatchV1(validPatch(), { ids });
  assert.deepEqual(materializeSongPatchIds(validPatch(), { ids }), ids);
  assert.equal(commands[1]?.type, "CreateTrack");
  assert.equal(commands[2]?.type, "CreateClip");
  if (commands[1]?.type === "CreateTrack" && commands[2]?.type === "CreateClip") {
    assert.equal(commands[1].id, "track-fixed");
    assert.equal(commands[2].id, "clip-fixed");
  }

  assert.throws(
    () => compileSongPatchV1(validPatch(), { ids: { ...ids, noteIds: ["only-one"] } }),
    /exactly 2/,
  );
  assert.throws(
    () =>
      compileSongPatchV1(validPatch(), {
        ids: { ...ids, noteIds: ["note-a", "track-fixed"] },
      }),
    /unique/,
  );
  assert.throws(
    () =>
      compileSongPatchV1(validPatch(), {
        ids: { songId: "song", trackId: "track", clipId: "clip" } as never,
      }),
    /exactly songId, trackId, clipId, and noteIds/,
  );
});

test("previews and executes a patch against an empty NanoDAW snapshot", () => {
  const snapshot = { song: null, revision: 0 } as const;
  const preview = previewSongPatchV1(validPatch(), {
    idSeed: "empty-session",
    snapshot,
  });
  assert.equal(preview.commands[0]?.type, "CreateSong");
  assert.equal(snapshot.song, null);

  const result = executeCommandBatch(createCommandState(), {
    requestId: "empty-session",
    expectedRevision: 0,
    commands: preview.commands,
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.revision, 1);
  assert.equal(result.snapshot.song?.tracks[0]?.clips[0]?.pattern.notes.length, 2);
});

test("previews a deterministic summary without mutating patch or snapshot", () => {
  const patch = validPatch();
  const snapshot = {
    revision: 7,
    song: {
      schemaVersion: 2,
      id: "song-existing",
      title: "Existing",
      transport: {
        bpm: 120,
        positionBeats: 2,
        isPlaying: false,
        isRecording: false,
      },
      tracks: [
        {
          id: "track-existing",
          name: "Existing Track",
          kind: "instrument",
          instrumentId: "lead",
          color: "#fff",
          clips: [],
        },
      ],
    },
  } as const;
  const patchBefore = structuredClone(patch);
  const snapshotBefore = structuredClone(snapshot);

  const preview = previewSongPatchV1(patch, {
    idSeed: "preview-1",
    snapshot,
  });
  const repeated = previewSongPatchV1(patch, {
    idSeed: "preview-1",
    snapshot,
  });

  assert.deepEqual(preview, repeated);
  assert.deepEqual(patch, patchBefore);
  assert.deepEqual(snapshot, snapshotBefore);
  assert.equal(preview.baseRevision, 7);
  assert.deepEqual(preview.diff.tempoBpm, {
    before: 120,
    after: 128,
    changed: true,
  });
  assert.deepEqual(preview.diff.instrumentTracks, {
    before: 1,
    after: 2,
    added: 1,
  });
  assert.equal(preview.diff.clipsAdded, 1);
  assert.equal(preview.diff.notesAdded, 2);
  assert.deepEqual(preview.diff.pitchRange, { min: 36, max: 43 });
  assert.deepEqual(preview.summary, [
    "Tempo: 120 -> 128 BPM",
    'Add instrument track "Glass Bass"',
    "Instrument: Lead (lead)",
    'Add clip "Pulse" (4 beats)',
    "Add 2 notes",
  ]);
  assert.ok(Object.isFrozen(preview));
  assert.ok(Object.isFrozen(preview.diff));
  assert.ok(Object.isFrozen(preview.summary));
});

test("exports a strict provider-facing JSON schema", () => {
  assert.equal(SONG_PATCH_V1_JSON_SCHEMA.additionalProperties, false);
  assert.equal(SONG_PATCH_V1_JSON_SCHEMA.properties.track.additionalProperties, false);
  assert.equal(
    SONG_PATCH_V1_JSON_SCHEMA.properties.track.properties.clip.properties.notes.maxItems,
    16,
  );
  assert.ok(Object.isFrozen(SONG_PATCH_V1_JSON_SCHEMA));
});

test("exports the exact LiteRT-compatible SongPatchV1 tool projection", () => {
  assert.deepEqual(SONG_PATCH_V1_TOOL_SCHEMA, {
    type: "object",
    required: ["schemaVersion", "track"],
    properties: {
      schemaVersion: { type: "number", enum: [1] },
      tempoBpm: { type: "number", minimum: 40, maximum: 240 },
      track: {
        type: "object",
        required: ["kind", "name", "clip"],
        properties: {
          kind: { type: "string", enum: ["instrument"] },
          name: { type: "string", minLength: 1, maxLength: 64 },
          clip: {
            type: "object",
            required: ["name", "lengthBeats", "notes"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 64 },
              lengthBeats: { type: "number", minimum: 1, maximum: 16 },
              notes: {
                type: "array",
                minItems: 1,
                maxItems: 16,
                items: {
                  type: "object",
                  required: ["pitch", "velocity", "startBeat", "lengthBeats"],
                  properties: {
                    pitch: { type: "integer", minimum: 0, maximum: 127 },
                    velocity: { type: "integer", minimum: 1, maximum: 127 },
                    startBeat: { type: "number", minimum: 0, maximum: 16 },
                    lengthBeats: { type: "number", minimum: 0.25, maximum: 16 },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  assert.ok(Object.isFrozen(SONG_PATCH_V1_TOOL_SCHEMA));
});

test("keeps required fields across root, track, clip, and note levels", () => {
  const track = SONG_PATCH_V1_TOOL_SCHEMA.properties.track;
  const clip = track.properties.clip;
  const note = clip.properties.notes.items;

  assert.deepEqual(SONG_PATCH_V1_TOOL_SCHEMA.required, ["schemaVersion", "track"]);
  assert.deepEqual(track.required, ["kind", "name", "clip"]);
  assert.deepEqual(clip.required, ["name", "lengthBeats", "notes"]);
  assert.deepEqual(note.required, ["pitch", "velocity", "startBeat", "lengthBeats"]);
  assert.deepEqual(Object.keys(note.properties), [
    "pitch",
    "velocity",
    "startBeat",
    "lengthBeats",
  ]);
});

test("omits unsupported LiteRT schema keywords at every depth", () => {
  const unsupported = new Set([
    "$schema",
    "$id",
    "const",
    "additionalProperties",
    "multipleOf",
  ]);

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assert.equal(unsupported.has(key), false, `unsupported schema keyword: ${key}`);
      visit(child);
    }
  };

  visit(SONG_PATCH_V1_TOOL_SCHEMA);
});

test("validates the captured S25 propose_song_patch arguments at runtime", () => {
  const fixtureUrl = new URL(
    "../../../tests/fixtures/litert-s25-tool-call.json",
    import.meta.url,
  );
  const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
    response?: {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
  };
  const toolCall = fixture.response?.choices?.[0]?.message?.tool_calls?.[0]?.function;

  assert.equal(toolCall?.name, "propose_song_patch");
  assert.equal(typeof toolCall.arguments, "string");
  const patch = validateSongPatchV1(JSON.parse(toolCall.arguments!));
  assert.deepEqual(patch, {
    schemaVersion: 1,
    tempoBpm: 120,
    track: {
      kind: "instrument",
      name: "SimpleSynth",
      clip: {
        name: "OneBeatClip",
        lengthBeats: 1,
        notes: [{ pitch: 60, velocity: 100, startBeat: 0, lengthBeats: 1 }],
      },
    },
  });
});
