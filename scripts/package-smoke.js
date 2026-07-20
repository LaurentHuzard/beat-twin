import assert from "node:assert/strict";

import { compileSongPatchV1 } from "../packages/agent-contract/dist/index.js";
import { NANODAW_CAPABILITY_VERSION } from "../packages/adapters/nanodaw/dist/index.js";
import { BITWIG_CAPABILITY_VERSION } from "../packages/adapters/bitwig/dist/index.js";
import { MAX_PLAN_TTL_MS } from "../packages/gateway-core/dist/index.js";
import {
  BROWSER_NANODAW_PROTOCOL,
  createGatewayRequestHandler,
} from "../packages/gateway-http/dist/index.js";
import { LITERT_AGENT_TOOL_NAMES } from "../packages/litert-provider/dist/index.js";
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
assert.equal(NANODAW_CAPABILITY_VERSION, "nanodaw-v2");
assert.equal(BITWIG_CAPABILITY_VERSION, "bitwig-launcher-v1");
assert.equal(MAX_PLAN_TTL_MS, 120_000);
assert.equal(BROWSER_NANODAW_PROTOCOL, "beat-twin.nanodaw.v1");
assert.equal(typeof createGatewayRequestHandler, "function");
assert.deepEqual(LITERT_AGENT_TOOL_NAMES, [
  "list_daw_targets",
  "inspect_session",
  "propose_song_patch",
]);

console.log(JSON.stringify({
  ok: true,
  packages: [
    "core",
    "commands",
    "audio-tone",
    "daw-contract",
    "agent-contract",
    "nanodaw-adapter",
    "bitwig-adapter",
    "litert-provider",
    "gateway-core",
    "gateway-http",
  ],
}));
