import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
const source = await readFile(new URL("../bitwig-controller/BeatTwin/BeatTwin.control.ts", import.meta.url), "utf8");
function baseHarness() {
  const calls: unknown[][] = [], values: any[] = [];
  const ctx: any = { loadAPI() {}, println() {}, host: { defineController() {} } };
  runInNewContext(source, ctx);
  function value(name: string, initial: any) {
    let current = initial;
    const observers: (() => void)[] = [];
    const val: any = { get: () => current, update(next: any) { current = next; },
      set(next: any) { calls.push([name + ".set", next]); },
      setImmediately(next: any) { calls.push([name + ".setImmediately", next]); }, markInterested() {},
      addValueObserver(fn: () => void) { observers.push(fn); }, notify() { observers.forEach((fn) => fn()); } };
    values.push(val); return val;
  }
  function proxy(fields: Record<string, any>, prefix: string) {
    const vals: any = {}, object: any = { values: vals };
    for (const key of Object.keys(fields)) { vals[key] = value(prefix + "." + key, fields[key]); object[key] = () => vals[key]; }
    return object;
  }
  function color() { return Object.assign(value("color", null), { red: () => 0.2, green: () => 0.3, blue: () => 0.4 }); }
  function channel(index: number, exists = true) {
    const track = proxy({ exists, position: index, name: `Track ${index}`, trackType: "Instrument", volume: 0.7, pan: 0.5, mute: false, solo: false, arm: false }, `track${index}`);
    const trackColor = color(); track.color = () => trackColor;
    track.deleteObject = () => calls.push(["track.delete", index]);
    track.duplicate = () => calls.push(["track.duplicate", index]);
    return track;
  }
  const main = Array.from({ length: 8 }, (_, i) => channel(i));
  const sends = main.map((track, t) => Array.from({ length: 8 }, (_, s) => {
    const send = value(`send${t}:${s}`, 0.4), exists = value("send.exists", s < 2);
    send.exists = () => exists;
    ctx.watchMixValue(exists, "exists", `send${t}:${s}`); ctx.watchMixValue(send, "level", `send${t}:${s}`);
    return send;
  }));
  const deviceCounts: any[] = [], deviceCursorMatches: any[][] = [], mainCursorMatches: any[] = [];
  const devices = main.map((track, t) => Array.from({ length: 8 }, (_, d) => {
    if (!deviceCursorMatches[t]) deviceCursorMatches[t] = [];
    const matchesCursor = value("cursorMatch", t === 0 && d === 1);
    deviceCursorMatches[t].push(matchesCursor);
    ctx.watchMixValue(matchesCursor, "cursorMatch", `device${t}:${d}`);
    const device = proxy({ exists: d < 2, position: d, isEnabled: true }, `device${t}:${d}`);
    device.deleteObject = () => calls.push(["device.delete", t, d]);
    ctx.watchMixValue(device.exists(), "exists", `device${t}:${d}`);
    ctx.watchMixValue(device.position(), "position", `device${t}:${d}`);
    ctx.watchMixValue(device.isEnabled(), "enabled", `device${t}:${d}`);
    return device;
  }));
  const deviceBanks = main.map((track, t) => {
    track.sendBank = () => ({ getItemAt: (s: number) => sends[t][s] });
    for (const key of ["exists", "position"]) ctx.watchMixValue(track[key](), key, `mainTrack${t}`);
    ctx.watchMixValue(track.trackType(), "type", `mainTrack${t}`);
    const mainMatch = value("mainMatch", t === 0); mainCursorMatches.push(mainMatch); ctx.watchMixValue(mainMatch, "cursorMatch", `mainTrack${t}`);
    const count = value(`deviceCount${t}`, 2); deviceCounts.push(count); ctx.watchMixValue(count, "count", `devices${t}`);
    return { itemCount: () => count, getItemAt: (d: number) => devices[t][d] };
  });
  const mainCount = value("mainCount", 10), returnCount = value("returnCount", 2), returnOffset = value("returnOffset", 0);
  ctx.watchMixValue(mainCount, "count", "mainBank");
  ctx.watchMixValue(returnCount, "count", "returns"); ctx.watchMixValue(returnOffset, "offset", "returns");
  const returns = Array.from({ length: 8 }, (_, i) => channel(i, i < 2));
  const returnCursorMatches = returns.map((track, i) => { const match = value("returnMatch", false); ctx.watchMixValue(match, "cursorMatch", `return${i}`); return match; });
  returns.forEach((track, i) => ctx.watchChannelValues(track, `return${i}`, false));
  const master = channel(0); ctx.watchMixValue(master.exists(), "exists", "master"); ctx.watchMixValue(master.volume(), "level", "master");
  const masterCursorMatches = value("masterMatch", false); ctx.watchMixValue(masterCursorMatches, "cursorMatch", "master");
  const cursorTrack = channel(0); ctx.watchChannelValues(cursorTrack, "cursorTrack", true);
  const cursorDevice = proxy({ exists: true, name: "Synth", position: 1, isEnabled: true, isWindowOpen: false, isExpanded: true, hasNext: true, hasPrevious: true }, "cursorDevice");
  for (const key of Object.keys(cursorDevice.values)) ctx.watchMixValue(cursorDevice[key](), key, "cursorDevice");
  for (const name of ["selectNext", "selectPrevious", "selectFirst", "selectLast"]) cursorDevice[name] = () => calls.push([name]);
  for (const [name, label] of [["beforeDeviceInsertionPoint", "before"], ["afterDeviceInsertionPoint", "after"], ["replaceDeviceInsertionPoint", "replace"]]) cursorDevice[name] = () => ({ browse() { calls.push(["browse", label]); } });
  const clip = proxy({ exists: true, getLoopLength: 16, getLoopStart: 0, getPlayStart: 0, getPlayStop: 16 }, "clip");
  const clipColor = color(); clip.color = () => clipColor;
  const slot = proxy({ exists: true, sceneIndex: 0, hasContent: true, name: "Clip" }, "slot");
  for (const [key, val] of Object.entries({ exists: clip.exists(), loopLength: clip.getLoopLength(), loopStart: clip.getLoopStart(), playStart: clip.getPlayStart(), playStop: clip.getPlayStop(),
    color: clipColor, trackExists: cursorTrack.exists(), trackPosition: cursorTrack.position(), slotExists: slot.exists(), slotSceneIndex: slot.sceneIndex() })) ctx.watchMixValue(val, key, "cursorClip");
  const browser = value("browser", false); browser.addValueObserver(ctx.observeConstructionChange);
  const playing = value("playing", false), recording = value("recording", false), project = value("project", "Mix");
  ctx.watchMixValue(playing, "playing", "mixSafety"); ctx.watchMixValue(recording, "recording", "mixSafety");
  ctx.watchMixValue(browser, "exists", "mixBrowser");
  Object.assign(ctx, { controllerInstanceId: "test", trackBank: { getItemAt: (i: number) => main[i], itemCount: () => mainCount, scrollPosition: () => ({ get: () => 0 }) },
    effectTrackBank: { getItemAt: (i: number) => returns[i], itemCount: () => returnCount, scrollPosition: () => returnOffset },
    masterTrack: master, masterCursorMatches, returnCursorMatches, mainCursorMatches, deviceBanks, deviceCursorMatches, cursorTrack, cursorDevice, inspectionClip: clip, inspectionTrack: cursorTrack, inspectionSlot: slot,
    cursorClipTrack: cursorTrack, cursorClipSlot: slot, targetTracks: [], targetSlots: [],
    application: { projectName: () => project, createEffectTrack(index: number) { calls.push(["createEffectTrack", index]); } },
    popupBrowser: { exists: () => browser }, transport: { isPlaying: () => playing, isArrangerRecordEnabled: () => recording } });
  values.forEach((v) => v.notify()); ctx.flush(); ctx.flush();
  const settle = () => { ctx.flush(); ctx.flush(); };
  function rpc(method: string, params: unknown[] = [], authenticated = true) {
    let reply: any; ctx.handleRequest({ id: 1, method, params }, { send(bytes: number[]) { reply = JSON.parse(String.fromCharCode(...bytes)); } }, { authenticated }); return reply;
  }
  return { value, proxy, color, values, ctx, calls, main, mainCount, returns, returnCount, returnOffset, master, sends, devices, deviceCounts,
    cursorTrack, cursorDevice, masterCursorMatches, returnCursorMatches, clip, slot, browser, playing, recording, project, settle, rpc };
}

function harness() {
  const h = baseHarness(), { ctx, calls, value, proxy } = h;
  const app = proxy({ projectName: "Parity", panelLayout: "ARRANGE", displayProfile: "Single Display", hasActiveEngine: true, canUndo: true, canRedo: false }, "app");
  for (const name of ["undo", "redo", "cut", "copy", "paste", "remove", "duplicate", "selectAll", "selectNone", "enter", "escape", "zoomIn", "zoomOut", "arrowKeyLeft", "arrowKeyRight", "arrowKeyUp", "arrowKeyDown"]) app[name] = () => calls.push([name]);
  const project = proxy({ hasSoloedTracks: true, hasMutedTracks: true, hasArmedTracks: true }, "project");
  for (const name of ["unsoloAll", "unmuteAll", "unarmAll"]) project[name] = () => calls.push([name]);
  const groove = proxy({ getEnabled: 1, getShuffleAmount: 0.5, getShuffleRate: 0.5, getAccentAmount: 0.2, getAccentRate: 0.5, getAccentPhase: 0 }, "groove");
  ctx.application = app; ctx.project = project; ctx.host.createGroove = () => groove; ctx.initParityGlobals();
  const drums = proxy({ scrollPosition: 0, itemCount: 128, canScrollForwards: true, canScrollBackwards: false }, "drums");
  const pads = Array.from({ length: 16 }, (_, i) => {
    const pad = proxy({ exists: true, name: `Pad ${i}`, volume: 0.7, mute: false, solo: false }, `pad${i}`);
    const selected = value(`selected${i}`, i === 0); pad.selected = selected;
    pad.addIsSelectedInEditorObserver = (fn: (state: boolean) => void) => selected.addValueObserver(() => fn(selected.get()));
    pad.selectInEditor = () => calls.push(["selectPad", i]); return pad;
  });
  drums.getItemAt = (i: number) => pads[i]; drums.scrollForwards = () => calls.push(["drumForward"]); drums.scrollBackwards = () => calls.push(["drumBackward"]);
  const hasPads = value("hasPads", true); h.cursorDevice.hasDrumPads = () => hasPads; h.cursorDevice.createDrumPadBank = (size: number) => { assert.equal(size, 16); return drums; };
  ctx.initDrumPads();
  const cues = proxy({ itemCount: 2, scrollPosition: 0 }, "cues");
  ctx.watchAdvancedValue(cues.itemCount(), "count", "cues"); cues.itemCount().addValueObserver(ctx.observeConstructionChange);
  ctx.watchAdvancedValue(cues.scrollPosition(), "offset", "cues");
  const markers = Array.from({ length: 32 }, (_, i) => {
    const marker = proxy({ exists: i < 2, name: `Cue ${i}`, position: i * 16 }, `cue${i}`);
    marker.getName = marker.name; const color = h.color(); marker.getColor = () => color;
    for (const [key, v] of Object.entries({ exists: marker.exists(), name: marker.name(), position: marker.position(), color })) { ctx.watchAdvancedValue(v, `${i}.${key}`, "cues"); (v as any).addValueObserver(ctx.observeConstructionChange); }
    marker.launch = (quantized: boolean) => calls.push(["launchCue", i, quantized]); return marker;
  });
  cues.getItemAt = (i: number) => markers[i]; ctx.cueMarkerBank = cues;
  const position = value("transportPosition", 8); ctx.transport.getPosition = () => position;
  ctx.transport.addCueMarkerAtPlaybackPosition = () => calls.push(["addCue"]);
  ctx.arranger = {};
  for (const name of ["zoomInLaneHeightsAll", "zoomOutLaneHeightsAll", "zoomInLaneHeightsSelected", "zoomOutLaneHeightsSelected"]) ctx.arranger[name] = () => calls.push([name]);
  h.values.forEach((v) => v.notify()); h.settle();
  return { ...h, app, project, groove, drums, pads, hasPads, cues, markers, position };
}

test("API15 and five new reads use observed values without mutations", () => {
  assert.match(source, /loadAPI\(15\)/);
  const h = harness();
  const app = h.rpc("application.get_status", [], false).result;
  assert.equal(app.panelLayout, "ARRANGE"); assert.equal(app.canUndo, true); assert.equal(app.keyboardFocus, null);
  assert.equal(h.rpc("project.get_status", [], false).result.hasMutedTracks, true);
  assert.equal(h.rpc("groove.get_status", [], false).result.enabled, true);
  assert.equal(h.rpc("drumpad.get_status", [], false).result.pads.length, 16);
  assert.equal(h.rpc("arranger.get_cue_markers", [], false).result.markers.length, 2);
  assert.deepEqual(h.calls, []);
});

test("all global application commands map explicitly and revoke bindings before dispatch", () => {
  const mapping = { undo: "undo", redo: "redo", cut: "cut", copy: "copy", paste: "paste", delete: "remove", duplicate: "duplicate", select_all: "selectAll", select_none: "selectNone", enter: "enter", escape: "escape", zoom_in: "zoomIn", zoom_out: "zoomOut" };
  for (const [command, method] of Object.entries(mapping)) {
    const h = harness(); const generation = h.ctx.targetGeneration;
    if (command === "redo") { h.app.canRedo().update(true); h.app.canRedo().notify(); h.settle(); }
    h.app[method] = () => { assert.ok(h.ctx.targetGeneration > generation); h.calls.push([method]); };
    const result = h.rpc(`application.${command}`).result;
    assert.equal(result.scope, "global_ui"); assert.equal(result.effectVerified, false); assert.equal(result.focusVerified, false);
    assert.equal(h.rpc("target.inspect").error.code, -32004);
    h.ctx.flush(); assert.equal(h.rpc("application.copy").error.code, -32004); h.ctx.flush();
    assert.equal(h.rpc("application.copy").result.status, "dispatched");
    assert.deepEqual(h.calls, [[method], ["copy"]]);
  }
});

test("application arrows and arranger lane zoom validate strict enums before dispatch", () => {
  for (const [direction, method] of [["left", "arrowKeyLeft"], ["right", "arrowKeyRight"], ["up", "arrowKeyUp"], ["down", "arrowKeyDown"]]) {
    const h = harness(); assert.ok(h.rpc("application.arrow_key", [direction]).result); assert.deepEqual(h.calls, [[method]]);
  }
  for (const [action, method] of [["in_all", "zoomInLaneHeightsAll"], ["out_all", "zoomOutLaneHeightsAll"], ["in_selected", "zoomInLaneHeightsSelected"], ["out_selected", "zoomOutLaneHeightsSelected"]]) {
    const h = harness(); assert.ok(h.rpc("arranger.zoom", [action]).result); assert.deepEqual(h.calls, [[method]]);
  }
  for (const method of ["application.arrow_key", "arranger.zoom"]) for (const bad of ["", "toString", "__proto__", false, 1]) {
    const h = harness(); assert.equal(h.rpc(method, [bad]).error.code, -32602); assert.deepEqual(h.calls, []);
  }
});

test("global actions reject unauthenticated, playing, recording and extra arguments", () => {
  for (const method of ["application.undo", "arranger.zoom", "project.unmute_all", "transport.add_cue_marker"]) {
    const params = method === "arranger.zoom" ? ["in_all"] : [];
    const h = harness(); assert.equal(h.rpc(method, params, false).error.code, -32001);
    h.playing.update(true); assert.equal(h.rpc(method, params).error.code, -32004); h.playing.update(false);
    h.recording.update(true); assert.equal(h.rpc(method, params).error.code, -32004); assert.deepEqual(h.calls, []);
  }
  const h = harness(); assert.equal(h.rpc("application.undo", [1]).error.code, -32602); assert.deepEqual(h.calls, []);
});

test("global edit invalidates undo availability until real observer notification", () => {
  const h = harness(); h.rpc("application.undo"); h.settle();
  assert.equal(h.rpc("application.get_status").result.canUndo, null);
  assert.equal(h.rpc("application.get_status").result.availabilityObserved, false);
  h.app.canUndo().notify(); h.app.canRedo().notify(); h.settle(); assert.ok(h.rpc("application.get_status").result);
});

test("project reset uses native whole-project actions and invalidates aggregate and cursor state", () => {
  for (const [method, native, key, aggregate] of [["unsolo_all", "unsoloAll", "solo", "hasSoloedTracks"], ["unmute_all", "unmuteAll", "mute", "hasMutedTracks"], ["unarm_all", "unarmAll", "arm", "hasArmedTracks"]]) {
    const h = harness(); h.cursorTrack[key]().update(true); h.cursorTrack[key]().notify(); h.settle();
    assert.equal(h.rpc(`project.${method}`).result.scope, "entire_project"); assert.deepEqual(h.calls, [[native]]);
    assert.equal(h.rpc("project.get_status").result[aggregate], null); assert.equal(h.rpc("cursor_track.get_status").error.code, -32004);
    h.project[aggregate]().update(false); h.project[aggregate]().notify(); h.cursorTrack[key]().update(false); h.cursorTrack[key]().notify(); h.settle();
    assert.equal(h.rpc("project.get_status").result[aggregate], false); assert.ok(h.rpc("cursor_track.get_status").result);
    h.rpc(`project.${method}`); assert.deepEqual(h.calls, [[native]]);
  }
});

test("groove parameters are normalized numeric values and false writes zero", () => {
  const h = harness(); assert.ok(h.rpc("groove.set_enabled", [false]).result); assert.deepEqual(h.calls, [["groove.getEnabled.setImmediately", 0]]);
  assert.equal(h.rpc("groove.get_status").error.code, -32004);
  h.groove.getEnabled().update(0); h.groove.getEnabled().notify(); h.settle(); assert.equal(h.rpc("groove.get_status").result.enabled, false);
  assert.ok(h.rpc("groove.set_shuffle_amount", [0]).result); assert.deepEqual(h.calls.at(-1), ["groove.getShuffleAmount.setImmediately", 0]);
  for (const bad of [-1, 1.01, Infinity, NaN, "0"]) assert.equal(h.rpc("groove.set_shuffle_amount", [bad]).error.code, -32602);
  assert.equal(h.rpc("groove.set_enabled", [0]).error.code, -32602);
});

test("drum writes preserve zero and false, reject bounds and missing devices", () => {
  for (const [method, next, suffix] of [["volume", 0, "volume"], ["mute", true, "mute"], ["solo", true, "solo"]]) {
    const h = harness(); assert.ok(h.rpc(`drumpad.set_${method}`, [15, next]).result); assert.deepEqual(h.calls, [[`pad15.${suffix}.${method === "volume" ? "setImmediately" : "set"}`, next]]);
    assert.equal(h.rpc("drumpad.get_status").error.code, -32004);
  }
  for (const index of [-1, 16, 0.5, "0"]) { const h = harness(); assert.equal(h.rpc("drumpad.set_volume", [index, 0.5]).error.code, -32602); assert.deepEqual(h.calls, []); }
  const absent = harness(); absent.hasPads.update(false); absent.hasPads.notify(); absent.settle(); assert.equal(absent.rpc("drumpad.get_status").error.code, -32004);
});

test("drum selection waits for selected observer and scroll waits for offset observer", () => {
  const h = harness(); assert.ok(h.rpc("drumpad.select", [1]).result); assert.deepEqual(h.calls, [["selectPad", 1]]);
  assert.equal(h.rpc("drumpad.set_volume", [0, 0.3]).error.code, -32004);
  h.pads[1].selected.update(true); h.settle(); assert.equal(h.rpc("drumpad.get_status").error.code, -32004);
  h.pads[1].selected.notify(); h.settle(); assert.ok(h.rpc("drumpad.get_status").result);
  const scroll = harness(); assert.ok(scroll.rpc("drumpad.scroll_forward").result);
  scroll.drums.scrollPosition().update(16); scroll.settle(); assert.equal(scroll.rpc("drumpad.get_status").error.code, -32004);
  scroll.drums.scrollPosition().notify(); scroll.settle(); assert.equal(scroll.rpc("drumpad.get_status").result.coverage.scrollPosition, 16);
  const boundary = harness(); assert.equal(boundary.rpc("drumpad.scroll_backward").error.code, -32004); assert.deepEqual(boundary.calls, []);
});

test("cue create aliases wait for count callback and rename waits for observed name", () => {
  for (const method of ["transport.add_cue_marker", "arranger.cues.create"]) {
    const h = harness(); assert.ok(h.rpc(method).result); assert.deepEqual(h.calls, [["addCue"]]);
    h.cues.itemCount().update(3); h.markers[2].exists().update(true); h.settle(); assert.equal(h.rpc("arranger.get_cue_markers").error.code, -32004);
    h.cues.itemCount().notify(); h.markers[2].exists().notify(); h.settle(); assert.equal(h.rpc("arranger.get_cue_markers").result.markers.length, 3);
  }
  const h = harness(); assert.ok(h.rpc("arranger.cues.rename", [1, "Drop"]).result); assert.deepEqual(h.calls, [["cue1.name.set", "Drop"]]);
  h.markers[1].name().update("Drop"); h.markers[1].name().notify(); h.settle(); assert.equal(h.rpc("arranger.get_cue_markers").result.markers[1].name, "Drop");
  const jump = harness(); assert.ok(jump.rpc("arranger.jump_to_cue_marker", [1]).result); assert.deepEqual(jump.calls, [["launchCue", 1, true]]);
});

test("cue rename rejects invalid input before any mutation or barrier", () => {
  for (const name of ["", "a".repeat(129), "bad\nname", false]) { const h = harness(); assert.equal(h.rpc("arranger.cues.rename", [0, name]).error.code, -32602); assert.deepEqual(h.calls, []); assert.equal(h.ctx.constructionPending, null); }
  for (const index of [-1, 32, 1.5, "1"]) { const h = harness(); assert.equal(h.rpc("arranger.cues.rename", [index, "Name"]).error.code, -32602); assert.deepEqual(h.calls, []); }
});

test("undo and redo require observed availability, including after no-op global dispatch", () => {
  const h = harness(); assert.equal(h.rpc("application.redo").error.code, -32004); assert.deepEqual(h.calls, []);
  h.rpc("application.cut"); h.settle(); assert.equal(h.rpc("application.undo").error.code, -32004);
  assert.equal(h.rpc("application.get_status").result.canUndo, null);
});

test("legacy selected and bank mixer writes invalidate project aggregate until callback", () => {
  for (const [method, params] of [["track.selected.mute", [true]], ["track.bank.mute", [0, true]]] as [string, any[]][]) {
    const h = harness(); const reply = h.rpc(method, params); assert.ok(reply.result, JSON.stringify(reply));
    assert.equal(h.rpc("project.get_status").result.hasMutedTracks, null);
    h.project.hasMutedTracks().notify(); h.settle(); assert.equal(h.rpc("project.get_status").result.hasMutedTracks, true);
  }
});
