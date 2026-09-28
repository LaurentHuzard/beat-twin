import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const core = await readFile(new URL("../bitwig-controller/BeatTwin/BeatTwin.control.ts", import.meta.url), "utf8");
const midi = await readFile(new URL("../bitwig-controller/BeatTwin/midi.ts", import.meta.url), "utf8");
function harness(enabled = true) {
  const calls: any[][] = [], scheduled: { fn: () => void; delay: number }[] = [], definitions: any[][] = [];
  const input: any = {
    includeInAllInputs: () => ({ set(value: boolean) { calls.push(["includeInAllInputs", value]); } }),
    sendRawMidiEvent(status: number, data1: number, data2: number) { calls.push([status, data1, data2]); },
    assignPolyphonicAftertouchToExpression(...args: any[]) { calls.push(["expression", ...args]); },
    setUseExpressiveMidi(...args: any[]) { calls.push(["mpe", ...args]); },
    setKeyTranslationTable(table: number[]) { calls.push(["keys", table]); },
    setVelocityTranslationTable(table: number[]) { calls.push(["velocities", table]); }
  };
  const context: any = { loadAPI() {}, println() {}, NoteExpression: Object.fromEntries(["NONE", "PITCH_DOWN", "PITCH_UP", "GAIN_DOWN", "GAIN_UP", "PAN_LEFT", "PAN_RIGHT", "TIMBRE_DOWN", "TIMBRE_UP"].map((name) => [name, name])),
    host: { defineController(...args: any[]) { definitions.push(args); }, defineMidiPorts(...args: any[]) { definitions.push(args); },
      getMidiInPort(index: number) { assert.equal(index, 0); return { createNoteInput(...args: any[]) { calls.push(["createNoteInput", ...args]); return input; } }; },
      scheduleTask(fn: () => void, delay: number) { scheduled.push({ fn, delay }); } } };
  runInNewContext(core.replace("var midiProfileEnabled = false;", `var midiProfileEnabled = ${enabled};`) + "\n" + midi, context);
  context.initMidi(); calls.length = 0;
  function rpc(method: string, params: unknown[] = [], authenticated = true) {
    let reply: any; context.handleRequest({ id: 1, method, params }, { send(bytes: number[]) { reply = JSON.parse(String.fromCharCode(...bytes)); } }, { authenticated }); return reply;
  }
  return { ctx: context, input, calls, scheduled, definitions, rpc };
}

test("standard profile has no MIDI ports and read-only status explains unavailable writes", () => {
  const h = harness(false); assert.equal(h.definitions.length, 1); assert.equal(h.definitions[0][3], "761be710-90df-4577-8094-01314323214c");
  const status = h.rpc("note_input.get_status", [], false).result; assert.equal(status.available, false); assert.equal(status.profile, "standard");
  assert.equal(h.rpc("note_input.send_note_on", [0, 60, 100]).error.code, -32004); assert.deepEqual(h.calls, []);
});

test("optional MIDI profile is separate and requires explicit track input routing", () => {
  const h = harness(); assert.deepEqual(h.definitions[1], [1, 0]); assert.notEqual(h.definitions[0][3], "761be710-90df-4577-8094-01314323214c");
  h.ctx.initMidi(); assert.deepEqual(h.calls.at(-1), ["includeInAllInputs", false]);
  const status = h.rpc("note_input.get_status", [], false).result; assert.equal(status.available, true); assert.equal(status.injectedMidiChannelIgnored, true); assert.equal(status.translationTablesApplyToInjectedMidi, false);
});

test("note_play schedules a bounded note release before emission and cleanup ignores later revocation", () => {
  const h = harness(); h.input.sendRawMidiEvent = (...args: any[]) => { assert.equal(h.scheduled.length, 1); h.calls.push(args); };
  assert.equal(h.rpc("note_input.play_note", [0, 48, 100, 125]).result.leaseMs, 125);
  assert.deepEqual(h.calls, [[144, 48, 100]]); assert.equal(h.scheduled[0].delay, 125);
  assert.equal(h.rpc("note_input.send_note_on", [0, 49, 100], false).error.code, -32001);
  h.scheduled[0].fn(); assert.deepEqual(h.calls, [[144, 48, 100], [128, 48, 0]]);
  assert.deepEqual(h.rpc("note_input.get_status").result.trackedInjectedPitches, []);
});

test("note_on and raw note_on receive 10-second leases and duplicate pitches are rejected", () => {
  for (const [method, params] of [["note_input.send_note_on", [0, 60, 100]], ["note_input.send_raw_midi", [144, 60, 100]]] as [string, number[]][]) {
    const h = harness(); assert.ok(h.rpc(method, params).result); assert.equal(h.scheduled[0].delay, 10000);
    assert.equal(h.rpc(method, params).error.code, -32004); assert.deepEqual(h.calls, [[144, 60, 100]]);
  }
});

test("old callbacks cannot release a new note with the same pitch", () => {
  const h = harness(); h.rpc("note_input.send_note_on", [0, 60, 100]); const stale = h.scheduled[0].fn;
  h.rpc("note_input.send_note_off", [0, 60, 0]); h.rpc("note_input.send_note_on", [0, 60, 90]);
  stale(); assert.deepEqual(h.calls, [[144, 60, 100], [128, 60, 0], [144, 60, 90]]);
  h.scheduled[1].fn(); assert.deepEqual(h.calls.at(-1), [128, 60, 0]);
});

test("raw note_on velocity zero becomes note_off and program/pressure lengths are strict", () => {
  const h = harness(); h.rpc("note_input.send_note_on", [0, 60, 100]); assert.ok(h.rpc("note_input.send_raw_midi", [144, 60, 0]).result); assert.deepEqual(h.calls.at(-1), [128, 60, 0]);
  for (const status of [192, 208]) { assert.equal(h.rpc("note_input.send_raw_midi", [status, 3, 1]).error.code, -32602); assert.ok(h.rpc("note_input.send_raw_midi", [status, 3, 0]).result); }
});

test("raw sustain, sostenuto and hold pedals receive leases and cannot extend by duplicate on", () => {
  for (const cc of [64, 66, 69]) {
    const h = harness(); assert.ok(h.rpc("note_input.send_raw_midi", [176, cc, 127]).result);
    assert.equal(h.rpc("note_input.send_raw_midi", [176, cc, 127]).error.code, -32004);
    assert.equal(h.scheduled[0].delay, 10000); h.scheduled[0].fn();
    assert.equal(h.rpc("note_input.get_status").result.sustainPending, false);
    assert.ok(h.calls.some((call) => call[0] === 176 && call[1] === cc && call[2] === 0));
    assert.deepEqual(h.calls.at(-1), [176, 120, 0]);
  }
});

test("note lease releases hold pedals before note_off", () => {
  const h = harness(); h.rpc("note_input.send_raw_midi", [176, 66, 127]); h.rpc("note_input.play_note", [0, 60, 100, 5]);
  h.scheduled[1].fn(); assert.deepEqual(h.calls.slice(-2), [[176, 66, 0], [128, 60, 0]]);
  assert.equal(h.rpc("note_input.get_status").result.sustainPending, false);
});

test("scheduler failure emits no note or pedal and preserves prior release callbacks", () => {
  const h = harness(); h.ctx.host.scheduleTask = () => { throw new Error("scheduler unavailable"); };
  assert.equal(h.rpc("note_input.send_note_on", [0, 60, 100]).error.code, -32603); assert.deepEqual(h.calls, []);
  assert.deepEqual(h.rpc("note_input.get_status").result.trackedInjectedPitches, []);
  assert.equal(h.rpc("note_input.send_raw_midi", [176, 64, 127]).error.code, -32603); assert.deepEqual(h.calls, []);
});

test("host dispatch uncertainty releases any potentially emitted note", () => {
  const h = harness(); h.input.sendRawMidiEvent = (status: number, a: number, b: number) => { h.calls.push([status, a, b]); if (status === 144) throw new Error("post-send exception"); };
  assert.equal(h.rpc("note_input.send_note_on", [0, 60, 100]).error.code, -32603); assert.deepEqual(h.calls, [[144, 60, 100], [128, 60, 0]]);
});

test("lease release retries host exceptions without forgetting uncertain active notes", () => {
  const h = harness(); h.rpc("note_input.play_note", [0, 60, 100, 1]);
  h.input.sendRawMidiEvent = () => { throw new Error("temporarily unavailable"); }; h.scheduled[0].fn();
  assert.deepEqual(h.rpc("note_input.get_status").result.trackedInjectedPitches, [60]); assert.equal(h.scheduled[1].delay, 1000);
  h.input.sendRawMidiEvent = (...args: any[]) => h.calls.push(args); h.scheduled[1].fn(); assert.deepEqual(h.rpc("note_input.get_status").result.trackedInjectedPitches, []);
});

test("cleanup remains available during bank transitions and exit emits panic", () => {
  const h = harness(); h.rpc("note_input.send_note_on", [0, 60, 100]); h.ctx.bankNavigation = { observed: false };
  assert.equal(h.rpc("note_input.get_status", [], false).result.available, true);
  assert.ok(h.rpc("note_input.send_note_off", [0, 60, 0]).result); assert.ok(h.rpc("note_input.all_notes_off").result.released);
  h.ctx.exit(); assert.deepEqual(h.calls.slice(-2), [[176, 123, 0], [176, 120, 0]]);
  assert.match(core, /setDisconnectCallback\(function \(\) \{\s+if \(typeof cleanupMidi/);
});

test("strict MIDI arguments fail before dispatch", () => {
  const invalid: [string, unknown[]][] = [["note_input.send_note_on", [1, 60, 100]], ["note_input.send_note_on", [0, 60, 0]], ["note_input.send_note_on", [0, 128, 100]],
    ["note_input.send_note_off", [0, -1, 0]], ["note_input.play_note", [0, 60, 100, 0]], ["note_input.play_note", [0, 60, 100, 10001]], ["note_input.play_note", [0, 60, 100, 1.5]],
    ["note_input.send_raw_midi", [145, 60, 100]], ["note_input.send_raw_midi", [240, 0, 0]], ["note_input.send_raw_midi", [144, NaN, 100]]];
  for (const [method, params] of invalid) { const h = harness(); assert.equal(h.rpc(method, params).error.code, -32602); assert.deepEqual(h.calls, []); }
});

test("MPE and poly-aftertouch use real API enums and bounded channels", () => {
  const h = harness(); assert.ok(h.rpc("note_input.assign_poly_aftertouch_to_expression", [15, "TIMBRE_UP", 24]).result); assert.deepEqual(h.calls.at(-1), ["expression", 15, "TIMBRE_UP", 24]);
  for (const expression of ["PITCH", "TIMBRE", "PRESSURE", "__proto__"]) assert.equal(h.rpc("note_input.assign_poly_aftertouch_to_expression", [0, expression, 12]).error.code, -32602);
  assert.ok(h.rpc("note_input.set_use_expressive_midi", [false, 15, 48]).result); assert.deepEqual(h.calls.at(-1), ["mpe", false, 15, 48]);
  assert.equal(h.rpc("note_input.set_use_expressive_midi", [true, 1, 48]).error.code, -32602);
  assert.equal(h.rpc("note_input.set_use_expressive_midi", [true, 0, 97]).error.code, -32602);
});

test("translation tables are exact bounded copies; changing configuration requires no active voice", () => {
  for (const method of ["note_input.set_key_translation_table", "note_input.set_velocity_translation_table"]) {
    const h = harness(), table = Array.from({ length: 128 }, (_, i) => i);
    if (method === "note_input.set_key_translation_table") table[0] = -1;
    assert.ok(h.rpc(method, [table]).result); const emitted = h.calls[0][1]; assert.notEqual(emitted, table); assert.deepEqual(Array.from(emitted), table);
    for (const bad of [[], table.slice(1), [...table, 0], Array(128), Array(128).fill(128), Array(128).fill(-2)]) assert.equal(h.rpc(method, [bad]).error.code, -32602);
    h.rpc("note_input.send_note_on", [0, 60, 100]); assert.equal(h.rpc(method, [table]).error.code, -32004);
  }
});

test("velocity negative filtering is rejected atomically while key -1 remains supported", () => {
  for (const index of [0, 45, 127]) {
    const h = harness(), table = Array.from({ length: 128 }, (_, i) => i); table[index] = -1;
    const rejected = h.rpc("note_input.set_velocity_translation_table", [table]);
    assert.equal(rejected.error.code, -32602);
    assert.match(rejected.error.message, /negative filtering is unsupported/);
    assert.deepEqual(h.calls, []);
    assert.ok(h.rpc("note_input.set_key_translation_table", [table]).result);
    assert.equal(h.calls[0][0], "keys");
    assert.deepEqual(Array.from(h.calls[0][1]), table);
  }
  const h = harness();
  assert.equal(h.rpc("note_input.set_velocity_translation_table", [Array(128).fill(-1)]).error.code, -32602);
  assert.deepEqual(h.calls, []);
  for (const value of [0, 127]) {
    assert.ok(h.rpc("note_input.set_velocity_translation_table", [Array(128).fill(value)]).result);
    assert.equal(h.calls.at(-1)[0], "velocities");
    assert.deepEqual(Array.from(h.calls.at(-1)[1]), Array(128).fill(value));
  }
});

test("raw injection is dispatched unchanged with key filtering and zero velocity translation configured", () => {
  const h = harness();
  assert.ok(h.rpc("note_input.set_key_translation_table", [Array(128).fill(-1)]).result);
  assert.ok(h.rpc("note_input.set_velocity_translation_table", [Array(128).fill(0)]).result);
  assert.ok(h.rpc("note_input.send_raw_midi", [144, 48, 45]).result);
  assert.deepEqual(h.calls.at(-1), [144, 48, 45]);
  assert.equal(h.rpc("note_input.get_status").result.translationTablesApplyToInjectedMidi, false);
});

test("bridge disconnect invokes cleanup without permission checks", () => {
  const h = harness(); let disconnect: (() => void) | undefined;
  h.ctx.host.connectToRemoteHost = (address: string, port: number, callback: (remote: any) => void) => {
    assert.equal(address, "127.0.0.1"); assert.equal(port, 8889);
    callback({ setDisconnectCallback(fn: () => void) { disconnect = fn; }, setReceiveCallback() {}, disconnect() {} });
  };
  h.ctx.connectLocalBridge(); h.rpc("note_input.send_note_on", [0, 60, 100]);
  assert.ok(disconnect); disconnect();
  assert.equal(h.ctx.bridgeConnection, null); assert.equal(h.ctx.isConnected, false);
  assert.deepEqual(h.rpc("note_input.get_status", [], false).result.trackedInjectedPitches, []);
  assert.deepEqual(h.calls.slice(-2), [[176, 123, 0], [176, 120, 0]]);
});

test("failure to schedule another hold pedal preserves the original pedal lease", () => {
  const h = harness(); h.rpc("note_input.send_raw_midi", [176, 64, 127]); const release = h.scheduled[0].fn;
  h.ctx.host.scheduleTask = () => { throw new Error("scheduler unavailable"); };
  assert.equal(h.rpc("note_input.send_raw_midi", [176, 66, 127]).error.code, -32603);
  release(); assert.equal(h.rpc("note_input.get_status").result.sustainPending, false);
  assert.deepEqual(h.calls.at(-1), [176, 120, 0]);
});

test("cleanup failures stay explicit and never pretend voices were released", () => {
  const h = harness(); h.rpc("note_input.send_note_on", [0, 60, 100]);
  h.input.sendRawMidiEvent = () => { throw new Error("host unavailable"); };
  assert.equal(h.rpc("note_input.all_notes_off").error.code, -32004);
  const status = h.rpc("note_input.get_status").result; assert.deepEqual(status.trackedInjectedPitches, [60]); assert.match(status.cleanupError, /host unavailable/);
});
