import assert from "node:assert/strict";
import test from "node:test";
import { createCommandRuntime, createCommandState } from "@beat-twin/commands";
import { createSong, addTrack, createTrack, addClip, createClip, addNote, createNote } from "@beat-twin/core";
import { GatewayPlanStore, PairingAuthority } from "@beat-twin/gateway-core";
import { NanoDawAdapter, MemoryNanoDawPort } from "../../adapters/nanodaw/src/index.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNanoDawMcpServer, createNanoDawMcpService } from "../src/index.ts";

async function fixture() {
  let now = Date.now();
  const clock = { now: () => now };
  let song = addTrack(createSong({ id: "song" }), createTrack({ id: "bass", name: "Bass", instrumentId: "bass" }));
  song = addClip(song, "bass", createClip({ id: "verse", trackId: "bass", lengthBeats: 4 }));
  song = addNote(song, "bass", "verse", createNote({ id: "n", pitch: 36, startBeat: 0, lengthBeats: 1 }));
  const runtime = createCommandRuntime(createCommandState(song));
  const port = new MemoryNanoDawPort(runtime);
  const pairing = new PairingAuthority({ audit: () => undefined, clock });
  const planStore = new GatewayPlanStore({ pairing, audit: () => undefined, policy: () => true, clock });
  const adapter = new NanoDawAdapter({ port, verifyDigest: (plan) => planStore.getPlan(plan.planId)?.digest === plan.digest, now: clock.now });
  const service = await createNanoDawMcpService({ adapter, pairing, planStore, clock });
  const server = createNanoDawMcpServer(service);
  const client = new Client({ name: "musical-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const invoke = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const payload = JSON.parse((result.content as { text: string }[])[0]!.text);
    return { result, payload };
  };
  const user = await pairing.issue({ actorId: "test-human", ttlMs: 600000, maxRequests: 1000, scopes: ["plan.confirm", "plan.execute", "song.write", "transport.write"] });
  const apply = async (id: string) => {
    const confirmation = await planStore.confirm({ token: user.token, planId: id });
    const plan = await planStore.consumeExecution({ token: user.token, planId: id, confirmationToken: confirmation.confirmationToken });
    const report = await adapter.execute(plan);
    await planStore.recordExecution({ planId: id, report });
    return report;
  };
  return { invoke, client, server, service, port, runtime, apply, planStore, expire: () => { now += 120001; }, close: async () => { await client.close(); await server.close(); } };
}

test("MCP discovers and prepares one atomic groove; apply, variation, delete and guarded recovery", async () => {
  const f = await fixture();
  try {
    const found = await f.invoke("search_tools", { query: "clip", limit: 2 });
    assert.equal(found.payload.tools.length, 2); assert.equal(found.payload.nextOffset, 2);
    assert.equal(f.port.batchExecutionCount, 0);
    const args = { songId: "song", expectedRevision: 0, operations: [
      { tool: "nanodaw_create_track", arguments: { id: "drums", name: "Drums", instrumentId: "drums" } },
      { tool: "nanodaw_create_clip", arguments: { id: "beat", trackId: "drums", name: "Beat", lengthBeats: 4 } },
      { tool: "nanodaw_add_note", arguments: { trackId: "drums", clipId: "beat", pitch: 36, startBeat: 0, lengthBeats: 0.25 } },
      { tool: "nanodaw_set_tempo", arguments: { bpm: 118 } },
    ] };
    const prepared = await f.invoke("call_tool", { name: "nanodaw_prepare_batch", arguments: args });
    assert.equal(prepared.result.isError, undefined, JSON.stringify(prepared.payload));
    assert.equal(f.port.batchExecutionCount, 0);
    const report = await f.apply(prepared.payload.planId);
    assert.equal(report.ok, true); assert.equal(report.finalSnapshot.revision, 1);
    assert.equal(report.finalSnapshot.song!.tracks.length, 2);
    const edit = await f.invoke("nanodaw_prepare_batch", { songId: "song", expectedRevision: 1, operations: [
      { tool: "nanodaw_duplicate_clip", arguments: { trackId: "bass", clipId: "verse", id: "variation" } },
      { tool: "nanodaw_transpose_clip", arguments: { trackId: "bass", clipId: "variation", semitones: 12 } },
      { tool: "nanodaw_delete_clip", arguments: { trackId: "bass", clipId: "verse" } },
    ] });
    assert.equal(edit.result.isError, undefined, JSON.stringify(edit.payload));
    assert.equal((await f.apply(edit.payload.planId)).ok, true);
    assert.equal(f.runtime.inspect().song!.tracks[0]!.clips[0]!.pattern.notes[0]!.pitch, 48);
    assert.equal(f.service.listReviews().some((r) => r.plan.planId === edit.payload.planId), false);
    const undo = await f.invoke("nanodaw_undo", { songId: "song", expectedRevision: 2, planId: edit.payload.planId });
    assert.equal(undo.result.isError, undefined, JSON.stringify(undo.payload));
    assert.equal((await f.apply(undo.payload.planId)).ok, true);
    assert.deepEqual(f.runtime.inspect().song, report.finalSnapshot.song);
    const stale = await f.invoke("nanodaw_undo", { songId: "song", expectedRevision: 3, planId: edit.payload.planId });
    assert.equal(stale.result.isError, true);
  } finally { await f.close(); }
});

test("MCP rejects invalid bounds, bypasses, recursion, stale identities and atomic invalid batches", async () => {
  const f = await fixture();
  try {
    const invalid: [string, Record<string, unknown>][] = [
      ["search_tools", { limit: 0 }], ["search_tools", { query: "x".repeat(201) }],
      ["call_tool", { name: "call_tool" }], ["call_tool", { name: "search_tools" }],
      ["call_tool", { name: "transport_play" }], ["call_tool", { name: "nanodaw_confirm" }],
      ["call_tool", { name: "nanodaw_inspect", arguments: { override: true } }],
      ["call_tool", { name: "nanodaw_inspect", env: { write: true } }],
      ["nanodaw_play", { songId: "wrong", expectedRevision: 0 }],
      ["nanodaw_play", { songId: "song", expectedRevision: 10 }],
      ["nanodaw_play", { songId: "song", expectedRevision: "0" }],
      ["nanodaw_delete_track", { songId: "song", expectedRevision: 0, trackId: "absent" }],
      ["nanodaw_edit_clip", { songId: "song", expectedRevision: 0, trackId: "bass", clipId: "verse", lengthBeats: 0.5 }],
      ["nanodaw_prepare_batch", { songId: "song", expectedRevision: 0, operations: [{ tool: "nanodaw_set_tempo", arguments: { bpm: 130 } }, { tool: "nanodaw_delete_clip", arguments: { trackId: "bass", clipId: "absent" } }] }],
    ];
    for (const [name, args] of invalid) assert.equal((await f.invoke(name, args)).result.isError, true, name);
    assert.equal(f.port.batchExecutionCount, 0); assert.equal(f.runtime.inspect().revision, 0);
    assert.equal(f.service.listReviews().length, 0);
    const direct = await f.invoke("nanodaw_list_instruments");
    const generic = await f.invoke("call_tool", { name: "nanodaw_list_instruments" });
    assert.deepEqual(direct, generic);
    const plan = await f.invoke("nanodaw_stop", { songId: "song", expectedRevision: 0 });
    f.expire();
    assert.equal((await f.invoke("nanodaw_get_plan", { planId: plan.payload.planId })).result.isError, true);
  } finally { await f.close(); }
});

test("musical inbox bounds concurrent preparation and exposes status without confirmation authority", async () => {
  const f = await fixture();
  try {
    const status = await f.invoke("nanodaw_get_status");
    assert.equal(status.payload.status.health.status, "healthy");
    assert.equal(status.payload.status.confirmation, "browser-only");
    const results = await Promise.all(Array.from({ length: 34 }, () => f.invoke("nanodaw_play", { songId: "song", expectedRevision: 0 })));
    assert.equal(results.filter((entry) => !entry.result.isError).length, 32);
    assert.equal(f.service.listReviews().length, 32);
    const id = results.find((entry) => !entry.result.isError)!.payload.planId;
    const plan = await f.invoke("nanodaw_get_plan", { planId: id });
    assert.deepEqual(plan.payload.plan.requiredScopes, ["transport.write"]);
    assert.equal((await f.invoke("nanodaw_get_execution_report", { planId: id })).payload.execution.state, "pending");
    assert.equal(f.port.batchExecutionCount, 0);
    const report = await f.apply(id);
    assert.equal(report.ok, true);
    const readback = await f.invoke("nanodaw_get_execution_report", { planId: id });
    assert.equal(readback.payload.execution.report.status, "succeeded");
    await assert.rejects(f.apply(id));
    assert.equal(f.port.batchExecutionCount, 1);
    assert.equal((await f.invoke("call_tool", { name: "nanodaw_get_plan", arguments: { planId: "foreign-plan" } })).result.isError, true);
  } finally { await f.close(); }
});

test("recovery restores deleted track order and grouped note edits without allowing unrelated undo", async () => {
  const f = await fixture();
  try {
    const original = f.runtime.inspect().song;
    const prepared = await f.invoke("nanodaw_prepare_batch", { songId: "song", expectedRevision: 0, operations: [
      { tool: "nanodaw_rename_track", arguments: { trackId: "bass", name: "Edited Bass" } },
      { tool: "nanodaw_set_track_instrument", arguments: { trackId: "bass", instrumentId: "lead" } },
      { tool: "nanodaw_update_note", arguments: { trackId: "bass", clipId: "verse", noteId: "n", pitch: 40, startBeat: 0.2 } },
      { tool: "nanodaw_quantize_clip", arguments: { trackId: "bass", clipId: "verse", gridBeats: 0.25 } },
      { tool: "nanodaw_delete_note", arguments: { trackId: "bass", clipId: "verse", noteId: "n" } },
      { tool: "nanodaw_edit_clip", arguments: { trackId: "bass", clipId: "verse", name: "Empty", lengthBeats: 8, startBeat: 4 } },
      { tool: "nanodaw_delete_track", arguments: { trackId: "bass" } },
    ] });
    assert.equal(prepared.result.isError, undefined, JSON.stringify(prepared.payload));
    assert.equal((await f.apply(prepared.payload.planId)).ok, true);
    assert.equal(f.runtime.inspect().song!.tracks.length, 0);
    const undo = await f.invoke("nanodaw_undo", { songId: "song", expectedRevision: 1, planId: prepared.payload.planId });
    assert.equal(undo.payload.plan.commands.length, 1, "one original track payload, not one per edited note");
    assert.equal((await f.apply(undo.payload.planId)).ok, true);
    assert.deepEqual(f.runtime.inspect().song, original);
  } finally { await f.close(); }
});
