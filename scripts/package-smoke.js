import assert from "node:assert/strict";

import { compileSongPatchV1 } from "../packages/agent-contract/dist/index.js";
import { NANODAW_CAPABILITY_VERSION } from "../packages/adapters/nanodaw/dist/index.js";
import { scheduleSongNotes } from "../packages/audio-tone/dist/index.js";
import {
  createCommandState,
  executeCommandBatch,
} from "../packages/commands/dist/index.js";
import { createSong } from "../packages/core/dist/index.js";

const song = createSong({ id: "smoke-song", title: "Package smoke", bpm: 120 });
assert.equal(song.id, "smoke-song");

const batch = executeCommandBatch(
  createCommandState(),
  {
    requestId: "package-smoke",
    expectedRevision: 0,
    commands: [{ type: "CreateSong", id: "smoke-song", bpm: 120 }],
  },
);
assert.equal(batch.ok, true);
assert.equal(batch.snapshot.revision, 1);
assert.deepEqual(scheduleSongNotes(batch.snapshot.song), []);
const compiled = compileSongPatchV1({
  schemaVersion: 1,
  track: {
    kind: "instrument",
    name: "Smoke",
    clip: {
      name: "Smoke clip",
      lengthBeats: 1,
      notes: [{ pitch: 60, velocity: 100, startBeat: 0, lengthBeats: 0.25 }],
    },
  },
});
assert.equal(compiled.every((command) => !("id" in command) || Boolean(command.id)), true);
assert.equal(NANODAW_CAPABILITY_VERSION, "nanodaw-v1");

console.log(JSON.stringify({
  ok: true,
  packages: [
    "core",
    "commands",
    "audio-tone",
    "daw-contract",
    "agent-contract",
    "nanodaw-adapter",
  ],
}));
