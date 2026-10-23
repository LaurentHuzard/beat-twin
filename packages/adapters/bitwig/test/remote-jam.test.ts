import assert from "node:assert/strict";
import test from "node:test";
import {
  createRemoteJamBitwigPort,
  parseRemoteJamFrame,
  RemoteJamBitwigConsumer,
  type RemoteJamMidiPort,
} from "../src/remote-jam.ts";

const SESSION = { sessionId: "jam-1", streamId: "epoch-1", sourcePeerId: "peer-a", targetPeerId: "peer-b" };
function frame(n: number, type: string, payload: Record<string, number> = {}) {
  return {
    version: "midi-delivery-v1", session_id: SESSION.sessionId, stream_id: SESSION.streamId,
    sequence: n, sent_ns: (n - 1) * 1000, play_ns: n * 1000, deadline_ns: n * 1000 + 1000,
    event: {
      event_id: "event-" + n, event_type: type, occurred_at: "2026-10-23T18:00:00Z",
      source_peer_id: SESSION.sourcePeerId, target_peer_id: SESSION.targetPeerId, payload,
    },
  };
}
function harness() {
  const calls: unknown[][] = [];
  let writeAllowed = true;
  let peerAuthenticated = true;
  let failOnWrite = false;
  const port: RemoteJamMidiPort = {
    status: async () => ({ available: true, profile: "midi", trackedInjectedPitches: [] }),
    noteOn: async (pitch, velocity) => { calls.push(["noteOn", pitch, velocity]); if (failOnWrite) throw new Error("disconnected"); },
    noteOff: async (pitch, velocity) => { calls.push(["noteOff", pitch, velocity]); if (failOnWrite) throw new Error("disconnected"); },
    panic: async () => { calls.push(["panic"]); },
  };
  const consumer = new RemoteJamBitwigConsumer({
    port, isWriteAuthorized: () => writeAllowed,
    isAuthenticatedPeer: () => peerAuthenticated,
  });
  return {
    consumer, calls, port,
    revokeWrite: () => { writeAllowed = false; },
    revokePeer: () => { peerAuthenticated = false; },
    failWrite: () => { failOnWrite = true; },
  };
}

test("strict envelope rejects unknown fields, invalid ranges, invalid tempo and dates", () => {
  assert.equal(parseRemoteJamFrame(frame(1, "note_on", { channel: 1, note: 60, velocity: 100 })).event.event_type, "note_on");
  const bad = [
    { ...frame(1, "clock"), version: "wrong" },
    { ...frame(1, "clock"), extra: 1 },
    { ...frame(1, "clock"), sequence: 0 },
    { ...frame(1, "clock"), play_ns: -1 },
    { ...frame(1, "clock"), event: { ...frame(1, "clock").event, source_peer_id: "" } },
    frame(1, "note_on", { channel: 0, note: 60, velocity: 100 }),
    frame(1, "note_off", { channel: 1, note: 128, velocity: 0 }),
    frame(1, "control_change", { channel: 1, controller: 64, value: 128 }),
    frame(1, "tempo", { bpm: Infinity }),
    frame(1, "clock", { bpm: 120 }),
    { ...frame(1, "clock"), event: { ...frame(1, "clock").event, occurred_at: "yesterday" } },
  ];
  for (const value of bad) assert.throws(() => parseRemoteJamFrame(value));
});

test("arm requires independent write authorization, peer authentication and MIDI profile", async () => {
  const denied = harness();
  denied.revokeWrite();
  await assert.rejects(denied.consumer.arm(SESSION), /authorization/);
  const foreign = harness();
  foreign.revokePeer();
  await assert.rejects(foreign.consumer.arm(SESSION), /authorization/);
  const h = harness();
  const noMidi = new RemoteJamBitwigConsumer({
    port: { ...h.port, status: async () => ({ available: false, profile: "standard" }) },
    isWriteAuthorized: () => true, isAuthenticatedPeer: () => true,
  });
  await assert.rejects(noMidi.arm(SESSION), /MIDI profile/);
  assert.deepEqual(denied.calls, []);
});

test("channel 1 maps to Bitwig channel-0 note on and off with explicit disarm", async () => {
  const h = harness();
  await h.consumer.arm(SESSION);
  assert.equal((await h.consumer.accept(frame(1, "note_on", { channel: 1, note: 64, velocity: 96 }))).status, "dispatched_unverified");
  assert.equal((await h.consumer.accept(frame(2, "note_off", { channel: 1, note: 64, velocity: 0 }))).status, "dispatched_unverified");
  assert.deepEqual(h.calls, [["noteOn", 64, 96], ["noteOff", 64, 0]]);
  assert.equal(h.consumer.heldNotes, 0);
  await h.consumer.disarm();
  assert.deepEqual(h.calls.at(-1), ["panic"]);
});

test("unverified clock, transport, CC and other channels never change Bitwig", async () => {
  const h = harness();
  await h.consumer.arm(SESSION);
  const events: [string, Record<string, number>][] = [
    ["start", {}], ["clock", {}], ["continue", {}],
    ["tempo", { bpm: 120 }], ["control_change", { channel: 1, controller: 74, value: 63 }],
    ["note_on", { channel: 2, note: 64, velocity: 96 }],
  ];
  for (const [i, [type, payload]] of events.entries()) {
    assert.equal((await h.consumer.accept(frame(i + 1, type, payload))).status, "unsupported");
  }
  assert.deepEqual(h.calls, []);
});

test("stop invokes note panic without falsely claiming DAW transport stop", async () => {
  const h = harness();
  await h.consumer.arm(SESSION);
  await h.consumer.accept(frame(1, "note_on", { channel: 1, note: 64, velocity: 100 }));
  const result = await h.consumer.accept(frame(2, "stop"));
  assert.equal(result.status, "unsupported");
  assert.match(result.detail, /transport was not controlled/);
  assert.deepEqual(h.calls, [["noteOn", 64, 100], ["panic"]]);
});

test("duplicate sequences do not replay and gaps latch fault plus panic", async () => {
  const h = harness();
  await h.consumer.arm(SESSION);
  await h.consumer.accept(frame(1, "note_on", { channel: 1, note: 60, velocity: 99 }));
  assert.equal((await h.consumer.accept(frame(1, "note_on", { channel: 1, note: 60, velocity: 99 }))).status, "duplicate");
  assert.equal((await h.consumer.accept(frame(3, "note_on", { channel: 1, note: 61, velocity: 99 }))).status, "faulted");
  assert.equal(h.consumer.armed, false);
  assert.equal((await h.consumer.accept(frame(4, "note_on", { channel: 1, note: 62, velocity: 99 }))).status, "faulted");
  assert.deepEqual(h.calls, [["noteOn", 60, 99], ["panic"]]);
  await h.consumer.disarm();
  await h.consumer.arm({ ...SESSION, streamId: "epoch-2" });
  assert.equal(h.consumer.armed, true);
});

test("foreign session/stream/source/target cannot dispatch MIDI", async () => {
  const h = harness();
  await h.consumer.arm(SESSION);
  const foreign = [
    { ...frame(1, "clock"), session_id: "other" },
    { ...frame(1, "clock"), stream_id: "other" },
    { ...frame(1, "clock"), event: { ...frame(1, "clock").event, source_peer_id: "intruder" } },
    { ...frame(1, "clock"), event: { ...frame(1, "clock").event, target_peer_id: "other" } },
  ];
  for (const item of foreign) assert.equal((await h.consumer.accept(item)).status, "faulted");
  assert.equal((await h.consumer.accept(frame(1, "note_on", { channel: 1, note: 60, velocity: 80 }))).status, "dispatched_unverified");
  assert.deepEqual(h.calls, [["noteOn", 60, 80]]);
});

test("revoked peer authority attempts panic before accepting another event", async () => {
  const h = harness();
  await h.consumer.arm(SESSION);
  await h.consumer.accept(frame(1, "note_on", { channel: 1, note: 60, velocity: 95 }));
  h.revokePeer();
  assert.equal((await h.consumer.accept(frame(2, "note_off", { channel: 1, note: 60, velocity: 0 }))).status, "faulted");
  assert.deepEqual(h.calls, [["noteOn", 60, 95], ["panic"]]);
});

test("Bitwig dispatch exception is uncertain and triggers best-effort panic", async () => {
  const h = harness();
  await h.consumer.arm(SESSION);
  h.failWrite();
  await assert.rejects(h.consumer.accept(frame(1, "note_on", { channel: 1, note: 60, velocity: 95 })), /uncertain/);
  assert.equal(h.consumer.armed, false);
  assert.deepEqual(h.calls, [["noteOn", 60, 95], ["panic"]]);
});

test("revocation invalidates queued writes and serializes panic", async () => {
  const h = harness();
  await h.consumer.arm(SESSION);
  const a = h.consumer.accept(frame(1, "note_on", { channel: 1, note: 60, velocity: 90 }));
  const b = h.consumer.accept(frame(2, "note_on", { channel: 1, note: 61, velocity: 90 }));
  await h.consumer.disarm();
  const [one, two] = await Promise.all([a, b]);
  assert.equal(one.status, "faulted");
  assert.equal(two.status, "faulted");
  assert.deepEqual(h.calls, [["panic"]]);
});

test("concurrent arms cannot silently change active peer", async () => {
  const h = harness();
  const first = h.consumer.arm(SESSION);
  const second = h.consumer.arm({ ...SESSION, sourcePeerId: "someone-else" });
  const outcomes = await Promise.allSettled([first, second]);
  assert.equal(outcomes[0].status, "fulfilled");
  assert.equal(outcomes[1].status, "rejected");
  assert.equal(h.consumer.armed, true);
});

test("malformed frame while holding a note fails closed with panic", async () => {
  const h = harness();
  await h.consumer.arm(SESSION);
  await h.consumer.accept(frame(1, "note_on", { channel: 1, note: 62, velocity: 90 }));
  await assert.rejects(h.consumer.accept({ ...frame(2, "note_off", { channel: 1, note: 62, velocity: 0 }), extra: true }));
  assert.equal(h.consumer.armed, false);
  assert.deepEqual(h.calls, [["noteOn", 62, 90], ["panic"]]);
});

test("RPC adapter only uses authenticated NoteInput status, on/off and panic", async () => {
  const calls: unknown[][] = [];
  const port = createRemoteJamBitwigPort(async (...args) => {
    calls.push(args as unknown[]);
    if (args[0] === "note_input.get_status") return { available: true, profile: "midi", trackedInjectedPitches: [] };
    return { status: "dispatched", verified: false };
  });
  await port.status(); await port.noteOn(60, 90); await port.noteOff(60, 0); await port.panic();
  assert.deepEqual(calls.map((c) => c[0]), [
    "note_input.get_status", "note_input.send_note_on", "note_input.send_note_off", "note_input.all_notes_off",
  ]);
  assert.deepEqual(calls[1], ["note_input.send_note_on", [0, 60, 90], { requiresAuthentication: true }]);
  assert.deepEqual(calls[2], ["note_input.send_note_off", [0, 60, 0], { requiresAuthentication: true }]);
});
