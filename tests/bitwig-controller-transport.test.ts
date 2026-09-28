import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../bitwig-controller/BeatTwin/BeatTwin.control.ts", import.meta.url), "utf8");
const panelNames = ["timeline", "io", "clip_launcher", "effect_tracks", "double_row_height", "cue_markers", "playback_follow"];
function harness(options: { unsettled?: boolean; count?: number; offset?: number } = {}) {
  const calls: unknown[][] = [];
  const context: any = { loadAPI() {}, println() {}, host: { defineController() {} } };
  runInNewContext(source, context);
  const values: any[] = [];
  function value(name: string, initial: any) {
    let current = initial;
    const observers: (() => void)[] = [];
    const item = { get: () => current, set(next: any) { calls.push([name + ".set", next]); },
      toggle() { calls.push([name + ".toggle"]); }, update(next: any) { current = next; },
      markInterested() {}, addValueObserver(fn: () => void) { observers.push(fn); },
      notify() { observers.forEach((fn) => fn()); } };
    values.push(item);
    return item;
  }
  const transport: any = {};
  const transportValues: any = {};
  for (const [method, key] of [["isMetronomeEnabled", "metronome"], ["isPunchInEnabled", "punchIn"],
    ["isPunchOutEnabled", "punchOut"], ["isArrangerOverdubEnabled", "arrangerOverdub"],
    ["isClipLauncherOverdubEnabled", "launcherOverdub"]]) {
    const item = value(key, false);
    transportValues[key] = item;
    transport[method] = () => item;
    context.watchAdvancedValue(item, key, "transport");
  }
  const position = value("position", 8);
  transport.getPosition = () => position;
  transport.timeSignature = () => ({ set(...args: unknown[]) { assert.equal(args.length, 1); calls.push(["timeSignature.set", ...args]); } });
  for (const method of ["tapTempo", "continuePlayback", "setPosition", "fastForward", "rewind", "incPosition"]) {
    transport[method] = (...args: unknown[]) => calls.push([method, ...args]);
  }
  const panels: any = {}, arranger: any = {};
  const panelMethods = ["isTimelineVisible", "isIoSectionVisible", "isClipLauncherVisible", "areEffectTracksVisible", "hasDoubleRowTrackHeight", "areCueMarkersVisible", "isPlaybackFollowEnabled"];
  for (let index = 0; index < panelNames.length; index++) {
    const panel = panelNames[index];
    panels[panel] = value(panel, true);
    arranger[panelMethods[index]] = () => panels[panel];
    context.watchAdvancedValue(panels[panel], panel, "arranger");
  }
  const count = value("count", options.count ?? 2), offset = value("offset", options.offset ?? 0);
  const cues = Array.from({ length: 32 }, (_, index) => {
    const cueValues = { exists: value("exists", index + offset.get() < count.get()),
      name: value("name", `Cue ${index}`), position: value("cuePosition", index * 16) };
    const color = { ...value("color", null), red: () => 0.1, green: () => 0.2, blue: () => 0.3 };
    context.watchAdvancedValue(cueValues.exists, index + ".exists", "cues");
    context.watchAdvancedValue(cueValues.name, index + ".name", "cues");
    context.watchAdvancedValue(cueValues.position, index + ".position", "cues");
    context.watchAdvancedValue(color, index + ".color", "cues");
    // Tranche 5 migrates to API15: read and write use the same name() proxy.
    return { values: cueValues, exists: () => cueValues.exists, getName: () => cueValues.name, name: () => cueValues.name,
      position: () => cueValues.position, getColor: () => color,
      launch(quantized: boolean) { calls.push(["cue.launch", index, quantized]); } };
  });
  context.watchAdvancedValue(count, "count", "cues");
  context.watchAdvancedValue(offset, "offset", "cues");
  Object.assign(context, { transport, arranger, cueMarkerBank: { getItemAt: (i: number) => cues[i], itemCount: () => count, scrollPosition: () => offset } });
  function notifyAll() { values.forEach((v) => v.notify()); }
  function settle() { context.flush(); context.flush(); }
  if (!options.unsettled) { notifyAll(); settle(); }
  function rpc(method: string, params: unknown[] = [], authenticated = true) {
    let reply: any;
    context.handleRequest({ id: 1, method, params }, { send(bytes: number[]) { reply = JSON.parse(String.fromCharCode(...bytes)); } }, { authenticated });
    return reply;
  }
  return { context, calls, rpc, transport, transportValues, position, panels, cues, count, offset, notifyAll, settle };
}
const writes: [string, unknown[], unknown[]][] = [
  ["transport.toggle_metronome", [], ["metronome.toggle"]],
  ["transport.time_signature", [7, 8], ["timeSignature.set", "7/8"]],
  ["transport.tap_tempo", [], ["tapTempo"]],
  ["transport.toggle_punch_in", [], ["punchIn.toggle"]],
  ["transport.toggle_punch_out", [], ["punchOut.toggle"]],
  ["transport.set_punch_in", [true], ["punchIn.set", true]],
  ["transport.set_punch_out", [true], ["punchOut.set", true]],
  ["transport.toggle_arranger_overdub", [], ["arrangerOverdub.toggle"]],
  ["transport.toggle_launcher_overdub", [], ["launcherOverdub.toggle"]],
  ["transport.continue_playback", [], ["continuePlayback"]],
  ["transport.return_to_zero", [], ["setPosition", 0]],
  ["transport.fast_forward", [], ["fastForward"]],
  ["transport.rewind", [], ["rewind"]],
  ["transport.nudge_forward", [], ["incPosition", 1, false]],
  ["transport.nudge_backward", [], ["incPosition", -1, false]],
  ["arranger.set_panel_visibility", ["cue_markers", false], ["cue_markers.set", false]],
  ["arranger.cues.jump", [1], ["cue.launch", 1, true]],
];

test("all 17 new mutations authenticate and dispatch exactly once using API10 argument contracts", () => {
  for (const [method, args, call] of writes) {
    const h = harness();
    assert.equal(h.rpc(method, args, false).error.code, -32001, method);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.rpc(method, args).result, { status: "dispatched", verified: false, requiresReadback: true }, method);
    assert.deepEqual(h.calls, [call], method);
  }
});

test("four added reads expose known observed state without authentication or mutations", () => {
  const h = harness();
  assert.deepEqual(h.rpc("transport.get_punch_status", [], false).result, { punchIn: false, punchOut: false });
  assert.deepEqual(h.rpc("transport.get_overdub_status", [], false).result, { arranger: false, launcher: false });
  assert.deepEqual(h.rpc("arranger.get_status", [], false).result, {
    isTimelineVisible: true, isIoSectionVisible: true, isClipLauncherVisible: true,
    areEffectTracksVisible: true, hasDoubleRowTrackHeight: true, areCueMarkersVisible: true, isPlaybackFollowEnabled: true });
  const cues = h.rpc("arranger.cues.list", [], false).result;
  assert.equal(cues.markers.length, 2);
  assert.deepEqual(cues.markers[1], { index: 1, absoluteIndex: 1, name: "Cue 1", positionBeats: 16, color: { r: 0.1, g: 0.2, b: 0.3 } });
  assert.deepEqual(cues.coverage, { bankSize: 32, scrollPosition: 0, projectMarkerCount: 2, complete: true });
  assert.deepEqual(h.calls, []);
});

test("new reads require observer evidence and two stable flushes, rejecting unknown boolean state", () => {
  const h = harness({ unsettled: true });
  const reads = ["transport.get_punch_status", "transport.get_overdub_status", "arranger.get_status", "arranger.cues.list"];
  h.settle();
  for (const method of reads) assert.equal(h.rpc(method, [], false).error.code, -32004, method);
  h.notifyAll();
  h.context.flush();
  for (const method of reads) assert.equal(h.rpc(method, [], false).error.code, -32004, method);
  h.context.flush();
  for (const method of reads) assert.ok(h.rpc(method, [], false).result, method);
  h.transportValues.punchIn.update(undefined); h.transportValues.punchIn.notify(); h.settle();
  assert.equal(h.rpc("transport.get_punch_status").error.code, -32004);
  h.panels.timeline.update("true"); h.panels.timeline.notify(); h.settle();
  assert.equal(h.rpc("arranger.get_status").error.code, -32004);
  assert.deepEqual(h.calls, []);
});

test("strict argument counts, integer time signatures, boolean setters and panel allowlist reject bad inputs", () => {
  const h = harness();
  for (const [n, d] of [[0, 4], [33, 4], [2.5, 4], [4, 3], [4, "4"], [NaN, 4], [4, Infinity]]) {
    assert.equal(h.rpc("transport.time_signature", [n, d]).error.code, -32602);
  }
  for (const value of [0, 1, "true", null, undefined]) {
    assert.equal(h.rpc("transport.set_punch_in", [value]).error.code, -32602);
    assert.equal(h.rpc("transport.set_punch_out", [value]).error.code, -32602);
    assert.equal(h.rpc("arranger.set_panel_visibility", ["timeline", value]).error.code, -32602);
  }
  for (const panel of ["unknown", "__proto__", "constructor", 0, null]) assert.equal(h.rpc("arranger.set_panel_visibility", [panel, true]).error.code, -32602);
  for (const [method, args] of writes) assert.equal(h.rpc(method, [...args, "extra"]).error.code, -32602, method);
  for (const method of ["transport.get_punch_status", "transport.get_overdub_status", "arranger.get_status", "arranger.cues.list"]) assert.equal(h.rpc(method, [1]).error.code, -32602);
  assert.deepEqual(h.calls, []);
});

test("every panel is explicitly mapped, and boundary time signatures use the string setter", () => {
  const h = harness();
  for (const panel of panelNames) {
    assert.ok(h.rpc("arranger.set_panel_visibility", [panel, false]).result);
    h.panels[panel].update(false); h.panels[panel].notify(); h.settle();
  }
  for (const denominator of [1, 2, 4, 8, 16, 32]) assert.ok(h.rpc("transport.time_signature", [32, denominator]).result);
  assert.deepEqual(h.calls.slice(0, 7), panelNames.map((name) => [name + ".set", false]));
  assert.deepEqual(h.calls.slice(7), [1, 2, 4, 8, 16, 32].map((denominator) => ["timeSignature.set", `32/${denominator}`]));
});

test("cue lists expose bounded coverage and reject inconsistent metadata instead of claiming a complete project", () => {
  const h = harness({ count: 40, offset: 4 });
  const reply = h.rpc("arranger.cues.list").result;
  assert.equal(reply.markers.length, 32);
  assert.equal(reply.markers[0].absoluteIndex, 4);
  assert.deepEqual(reply.coverage, { bankSize: 32, scrollPosition: 4, projectMarkerCount: 40, complete: false });
  h.cues[0].values.exists.update(false); h.cues[0].values.exists.notify(); h.settle();
  assert.equal(h.rpc("arranger.cues.list").error.code, -32004);
  for (const bad of [null, "1", -1, Infinity]) {
    const broken = harness();
    broken.cues[0].values.position.update(bad); broken.cues[0].values.position.notify(); broken.settle();
    assert.equal(broken.rpc("arranger.cues.list").error.code, -32004);
  }
  const unknown = harness();
  unknown.count.update(undefined); unknown.count.notify(); unknown.settle();
  assert.equal(unknown.rpc("arranger.cues.list").error.code, -32004);
  assert.deepEqual(h.calls, []);
});

test("cue launch rejects missing, unsettled and invalid marker indices without selecting or mutating anything", () => {
  const h = harness();
  for (const index of [-1, 32, 0.5, NaN, Infinity, "1", undefined]) assert.equal(h.rpc("arranger.cues.jump", [index]).error.code, -32602);
  assert.equal(h.rpc("arranger.cues.jump", [3]).error.code, -32004);
  h.cues[0].values.name.notify();
  assert.equal(h.rpc("arranger.cues.jump", [0]).error.code, -32004);
  assert.deepEqual(h.calls, []);
});

test("nudge checks observed finite nonnegative destinations and host errors never trigger a retry", () => {
  const h = harness();
  for (const position of [undefined, NaN, Infinity, -1, "8"]) {
    h.position.update(position);
    assert.equal(h.rpc("transport.nudge_forward").error.code, -32004);
    assert.equal(h.rpc("transport.nudge_backward").error.code, -32004);
  }
  h.position.update(0.5);
  assert.equal(h.rpc("transport.nudge_backward").error.code, -32004);
  assert.deepEqual(h.calls, []);
  h.transport.tapTempo = () => { h.calls.push(["failingTap"]); throw new Error("host unavailable"); };
  assert.equal(h.rpc("transport.tap_tempo").error.code, -32603);
  assert.deepEqual(h.calls, [["failingTap"]]);
});

test("arranger calls retain construction/navigation barriers while transport remains bank-independent", () => {
  const h = harness();
  h.context.bankNavigation = { observed: false };
  assert.equal(h.rpc("arranger.cues.jump", [0]).error.code, -32004);
  assert.equal(h.rpc("arranger.get_status").error.code, -32004);
  assert.ok(h.rpc("transport.tap_tempo").result);
  assert.deepEqual(h.calls, [["tapTempo"]]);
});


test("boolean mutations invalidate observations immediately and await their observer plus two flushes", () => {
  for (const [method, key] of [["transport.toggle_punch_in", "punchIn"],
    ["transport.toggle_metronome", "metronome"], ["transport.toggle_arranger_overdub", "arrangerOverdub"],
    ["transport.toggle_launcher_overdub", "launcherOverdub"]]) {
    const h = harness();
    assert.ok(h.rpc(method).result);
    assert.equal(h.rpc(method).error.code, -32004);
    assert.equal(h.rpc("transport.get_punch_status").error.code, -32004);
    h.settle(); // No observer is not proof, even after arbitrary flushes.
    assert.equal(h.rpc(method).error.code, -32004);
    h.transportValues[key].update(true); h.transportValues[key].notify(); h.context.flush();
    assert.equal(h.rpc(method).error.code, -32004);
    h.context.flush();
    assert.ok(h.rpc(method).result);
    assert.equal(h.calls.length, 2);
  }
  const panel = harness();
  assert.ok(panel.rpc("arranger.set_panel_visibility", ["timeline", false]).result);
  assert.equal(panel.rpc("arranger.get_status").error.code, -32004);
  assert.equal(panel.rpc("arranger.set_panel_visibility", ["timeline", true]).error.code, -32004);
  panel.panels.timeline.update(false); panel.panels.timeline.notify(); panel.settle();
  assert.equal(panel.rpc("arranger.get_status").result.isTimelineVisible, false);
});

test("boolean setter no-ops preserve readiness and do not wait for an observer that may never arrive", () => {
  const h = harness();
  assert.ok(h.rpc("transport.set_punch_in", [false]).result);
  assert.ok(h.rpc("transport.get_punch_status").result);
  assert.ok(h.rpc("arranger.set_panel_visibility", ["timeline", true]).result);
  assert.ok(h.rpc("arranger.get_status").result);
  assert.deepEqual(h.calls, []);
  assert.ok(h.rpc("transport.set_punch_out", [true]).result);
  assert.equal(h.rpc("transport.set_punch_out", [true]).error.code, -32004);
  h.transportValues.punchOut.update(true); h.transportValues.punchOut.notify(); h.settle();
  assert.ok(h.rpc("transport.set_punch_out", [true]).result);
  assert.deepEqual(h.calls, [["punchOut.set", true]]);
});
