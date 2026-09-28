import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
const source = await readFile(new URL("../bitwig-controller/BeatTwin/BeatTwin.control.ts", import.meta.url), "utf8");
function harness() {
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
  return { ctx, calls, main, mainCount, returns, returnCount, returnOffset, master, sends, devices, deviceCounts,
    cursorTrack, cursorDevice, masterCursorMatches, returnCursorMatches, clip, slot, browser, playing, recording, project, settle, rpc };
}

test("six reads report bounded known cursor/mixer state without mutations", () => {
  const h = harness();
  assert.equal(h.rpc("mixer.master.get_volume", [], false).result, 0.7);
  assert.equal(h.rpc("mixer.track.get_send", [0, 1], false).result, 0.4);
  const returns = h.rpc("mixer.return.list", [], false).result;
  assert.equal(returns.returns.length, 8); assert.equal(returns.returns[2].exists, false); assert.equal(returns.returns[2].volume, null);
  assert.deepEqual(returns.coverage, { bankSize: 8, scrollPosition: 0, projectReturnCount: 2, complete: true });
  assert.equal(h.rpc("cursor_track.get_status", [], false).result.type, "Instrument");
  assert.equal(h.rpc("cursor_device.get_status", [], false).result.position, 1);
  assert.deepEqual(h.rpc("cursor_clip.get_status", [], false).result, { exists: true, scope: "selected_launcher", trackPosition: 0, slotSceneIndex: 0,
    loopLength: 16, loopStart: 0, playStart: 0, playStop: 16, color: { red: 0.2, green: 0.3, blue: 0.4 } });
  assert.deepEqual(h.calls, []);
});

test("legacy channel writes resolve explicit host methods and reject unknown fields", () => {
  const h = harness();
  assert.equal(h.rpc("track.bank.pan", [0, 0.4]).result, "OK");
  assert.deepEqual(h.calls, [["track0.pan.setImmediately", 0.4]]);
  assert.equal(h.ctx.advancedState.cursorTrack.seen.pan, false);
  for (const key of ["volume", "pan", "mute", "solo", "arm"]) {
    assert.equal(h.ctx.channelValue(h.main[0], key), h.main[0].values[key]);
  }
  assert.throws(() => h.ctx.channelValue(h.main[0], "constructor"), /Unknown channel/);
  // JS mocks cannot reproduce Graal invokeMember vs readMember behavior.
  // Keep a source regression for the dynamic property access that failed live.
  assert.doesNotMatch(source, /(?:track|cursorTrack)\[key\]\(\)/);
  assert.doesNotMatch(source, /getItemAt\(i\)\[key\]\(\)/);
});

test("absolute normalized MCP commands bypass physical takeover while retaining readback guards", () => {
  for (const [method, args, label] of [
    ["track.bank.pan", [0, 0.3], "track0.pan"],
    ["track.bank.volume", [0, 0.3], "track0.volume"],
    ["track.selected.pan", [0.3], "track0.pan"],
    ["track.selected.volume", [0.3], "track0.volume"],
    ["mixer.master.set_volume", [0.3], "track0.volume"],
    ["mixer.track.set_send", [0, 0, 0.3], "send0:0"],
    ["mixer.return.pan", [0, 0.3], "track0.pan"],
    ["mixer.return.volume", [0, 0.3], "track0.volume"],
  ] as [string, any[], string][]) {
    const h = harness();
    const invalid = args.slice(); invalid[invalid.length - 1] = 1.1;
    assert.equal(h.rpc(method, invalid).error.code, -32602, method);
    assert.deepEqual(h.calls, []);
    assert.ok(h.rpc(method, args).result, method);
    assert.deepEqual(h.calls, [[label + ".setImmediately", 0.3]], method);
    if (method === "mixer.master.set_volume") assert.equal(h.rpc("mixer.master.get_volume").error.code, -32004);
  }
});

test("track structure revokes bindings before calls and waits for observed count while allowing new positions", () => {
  for (const [method, delta] of [["track.delete", -1], ["track.duplicate", 1]] as [string, number][]) {
    const h = harness(); const binding = h.ctx.currentTargetBinding();
    assert.equal(h.rpc(method, [0]).result.status, "dispatched");
    assert.ok(h.ctx.targetGeneration > binding.targetGeneration);
    assert.equal(h.rpc("track.rename", [0, "Wrong"]).error.code, -32004);
    h.mainCount.update(10 + delta); // getter alone cannot acknowledge a structure change
    h.ctx.observeConstructionChange(); h.settle();
    assert.equal(h.rpc("cursor_track.get_status").error.code, -32004);
    h.main[0].position().update(2); h.main[0].position().notify();
    h.mainCount.notify(); h.ctx.flush();
    assert.equal(h.rpc("cursor_track.get_status").error.code, -32004);
    h.ctx.flush(); assert.ok(h.rpc("cursor_track.get_status").result);
    assert.equal(h.rpc("target.set_tempo", [binding, 140]).error.code, -32003);
    assert.deepEqual(h.calls, [[method, 0]]);
  }
});

test("structure rejects groups, playing/recording sessions and foreign project settlement", () => {
  for (const method of ["track.delete", "track.duplicate", "application.createEffectTrack", "device.delete"]) {
    const h = harness(); h.playing.update(true);
    const params = method.startsWith("track.") ? [0] : method === "device.delete" ? [0, 0] : [];
    assert.equal(h.rpc(method, params).error.code, -32004); assert.deepEqual(h.calls, []);
  }
  const group = harness(); group.main[0].trackType().update("Group"); group.main[0].trackType().notify(); group.settle();
  assert.equal(group.rpc("track.duplicate", [0]).error.code, -32004); assert.deepEqual(group.calls, []);
  const changed = harness(); changed.rpc("track.delete", [0]); changed.project.update("Other"); changed.mainCount.update(9); changed.mainCount.notify(); changed.settle();
  assert.equal(changed.rpc("cursor_track.get_status").error.code, -32004);
});

test("effect creation and targeted device deletion use their own observed counts", () => {
  const effects = harness();
  assert.equal(effects.rpc("application.createEffectTrack").result.verified, false);
  assert.deepEqual(effects.calls, [["createEffectTrack", -1]]);
  effects.returnCount.update(3); effects.returnCount.notify(); effects.settle();
  assert.ok(effects.rpc("cursor_track.get_status").result);
  const device = harness(); device.rpc("device.delete", [0, 1]);
  assert.deepEqual(device.calls, [["device.delete", 0, 1]]);
  device.deviceCounts[0].update(1); device.deviceCounts[0].notify(); device.settle();
  assert.ok(device.rpc("cursor_device.get_status").result);
});

test("device cursor navigation requires observed selection before old cursor writes can resume", () => {
  for (const [suffix, next] of [["next", 2], ["previous", 0], ["first", 0], ["last", 3]] as [string, number][]) {
    const h = harness(); assert.equal(h.rpc(`device.select_${suffix}`).result.status, "dispatched");
    assert.equal(h.rpc("device.browse_replace").error.code, -32004);
    assert.equal(h.rpc("device.set_remote_control", [0, 0.2]).error.code, -32004);
    h.cursorDevice.position().update(next); h.cursorDevice.position().notify();
    if (suffix === "first") { h.cursorDevice.hasPrevious().update(false); h.cursorDevice.hasPrevious().notify(); }
    if (suffix === "last") { h.cursorDevice.hasNext().update(false); h.cursorDevice.hasNext().notify(); }
    h.settle(); assert.equal(h.rpc("cursor_device.get_status").result.position, next);
    assert.equal(h.calls.length, 1);
  }
  const boundary = harness(); boundary.cursorDevice.hasNext().update(false); boundary.cursorDevice.hasNext().notify(); boundary.settle();
  assert.equal(boundary.rpc("device.select_next").error.code, -32004);
  assert.ok(boundary.rpc("device.select_last").result); assert.deepEqual(boundary.calls, []);
});

test("browser insertion and replacement require a selected device and never fall back", () => {
  for (const [method, label] of [["device.browse_insert_before", "before"], ["device.browse_insert_after", "after"], ["device.browse_replace", "replace"]]) {
    const h = harness(); assert.equal(h.rpc(method).result.status, "dispatched");
    assert.deepEqual(h.calls, [["browse", label]]);
    assert.equal(h.rpc("browser.commit").error.code, -32004);
    h.browser.update(true); h.browser.notify(); h.settle(); assert.ok(h.rpc("cursor_device.get_status").result);
    const absent = harness(); absent.cursorDevice.exists().update(false); absent.cursorDevice.exists().notify(); absent.settle();
    assert.equal(absent.rpc(method).error.code, -32004); assert.deepEqual(absent.calls, []);
  }
});

test("normalized writes guard values, use bypass inverse, and invalidate only their observed value until echo", () => {
  const h = harness();
  for (const invalid of [-1, 1.1, NaN, Infinity, "0.5", null]) {
    assert.equal(h.rpc("mixer.master.set_volume", [invalid]).error.code, -32602);
    assert.equal(h.rpc("mixer.track.set_send", [0, 0, invalid]).error.code, -32602);
    assert.equal(h.rpc("mixer.return.pan", [0, invalid]).error.code, -32602);
  }
  assert.deepEqual(h.calls, []);
  assert.ok(h.rpc("mixer.master.set_volume", [0.8]).result);
  assert.equal(h.rpc("mixer.master.get_volume").error.code, -32004);
  assert.equal(h.rpc("mixer.track.get_send", [0, 0]).result, 0.4);
  h.master.volume().update(0.8); h.master.volume().notify();
  assert.equal(h.rpc("mixer.master.get_volume").result, 0.8);
  assert.ok(h.rpc("mixer.master.set_volume", [0.8]).result); assert.equal(h.calls.length, 1);
  assert.ok(h.rpc("device.bypass", [0, 0, true]).result);
  assert.deepEqual(h.calls[1], ["device0:0.isEnabled.set", false]);
  assert.equal(h.rpc("device.bypass", [0, 0, true]).error.code, -32004);
});

test("continuous volume and pan automation keeps known reads available without pretending atomic snapshots", () => {
  const h = harness();
  for (let frame = 0; frame < 5; frame++) {
    h.returns[0].volume().update(frame / 10); h.returns[0].volume().notify();
    h.returns[0].pan().update(frame / 10); h.returns[0].pan().notify();
    h.cursorTrack.volume().update(frame / 10); h.cursorTrack.volume().notify();
    assert.equal(h.rpc("mixer.return.list").result.returns[0].volume, frame / 10);
    assert.equal(h.rpc("cursor_track.get_status").result.volume, frame / 10);
  }
  assert.deepEqual(h.calls, []);
});

test("unknown state, missing proxies, invalid indices and unauthenticated writes fail before host calls", () => {
  const h = harness();
  for (const index of [-1, 8, 0.5, NaN, "0"]) {
    assert.equal(h.rpc("track.delete", [index]).error.code, -32602);
    assert.equal(h.rpc("device.bypass", [0, index, true]).error.code, -32602);
    assert.equal(h.rpc("mixer.track.get_send", [0, index]).error.code, -32602);
    assert.equal(h.rpc("mixer.return.volume", [index, 0.5]).error.code, -32602);
  }
  assert.equal(h.rpc("mixer.track.get_send", [0, 7]).error.code, -32004);
  h.master.volume().update(undefined); h.master.volume().notify();
  assert.equal(h.rpc("mixer.master.get_volume").error.code, -32004);
  h.cursorDevice.exists().update(false); h.cursorDevice.exists().notify(); h.settle();
  assert.equal(h.rpc("cursor_device.get_status").result.name, null);
  for (const method of ["track.delete", "device.bypass", "mixer.master.set_volume", "device.select_first", "application.createEffectTrack"]) assert.equal(h.rpc(method, [], false).error.code, -32001);
  assert.deepEqual(h.calls, []);
});

test("API10 source reserves sends, uses the two-argument effect bank and avoids newer API methods", () => {
  assert.match(source, /createMainTrackBank\(8, 8, 8\)/);
  assert.match(source, /createEffectTrackBank\(8, 8\)/);
  assert.doesNotMatch(source, /createEffectTrackBank\(8,\s*\d+,\s*8\)|duplicateObject\(|send\.isEnabled\(/);
  assert.match(source, /structureTrack\.duplicate\(\)/);
});


test("bypassing the selected device invalidates its cursor observation while unrelated bypass leaves it readable", () => {
  const h = harness();
  assert.ok(h.rpc("device.bypass", [0, 1, true]).result);
  assert.equal(h.rpc("cursor_device.get_status").error.code, -32004);
  h.settle();
  assert.equal(h.rpc("cursor_device.get_status").error.code, -32004);
  h.devices[0][1].isEnabled().update(false); h.devices[0][1].isEnabled().notify();
  h.cursorDevice.isEnabled().update(false); h.cursorDevice.isEnabled().notify(); h.settle();
  assert.equal(h.rpc("cursor_device.get_status").result.isEnabled, false);
  const unrelated = harness();
  assert.ok(unrelated.rpc("device.bypass", [1, 0, true]).result);
  assert.equal(unrelated.rpc("cursor_device.get_status").result.isEnabled, true);
});


test("master and return changes invalidate matching cursor levels without affecting unrelated selections", () => {
  for (const [method, field, params] of [["mixer.master.set_volume", "volume", [0.8]],
    ["mixer.return.volume", "volume", [0, 0.8]], ["mixer.return.pan", "pan", [0, 0.8]]] as [string, string, unknown[]][]) {
    const h = harness();
    const match = method.includes("master") ? h.masterCursorMatches : h.returnCursorMatches[0];
    match.update(true); match.notify(); h.settle();
    assert.ok(h.rpc(method, params).result);
    assert.equal(h.rpc("cursor_track.get_status").error.code, -32004);
    h.cursorTrack[field]().update(0.8); h.cursorTrack[field]().notify();
    assert.equal(h.rpc("cursor_track.get_status").result[field], 0.8);
    const other = harness();
    assert.ok(other.rpc(method, params).result);
    assert.ok(other.rpc("cursor_track.get_status").result);
  }
});


test("legacy track setters invalidate matching new cursor reads until observed without blocking other tracks", () => {
  for (const [method, key, next] of [["track.bank.volume", "volume", 0.2], ["track.bank.pan", "pan", 0.2],
    ["track.bank.mute", "mute", true], ["track.bank.solo", "solo", true],
    ["track.selected.volume", "volume", 0.2], ["track.selected.pan", "pan", 0.2],
    ["track.selected.mute", "mute", true], ["track.selected.solo", "solo", true], ["track.selected.arm", "arm", true]] as [string, string, any][]) {
    const h = harness();
    assert.equal(h.rpc(method, method.startsWith("track.bank") ? [0, next] : [next]).result, "OK");
    assert.equal(h.rpc("cursor_track.get_status").error.code, -32004);
    h.cursorTrack[key]().update(next); h.cursorTrack[key]().notify(); h.settle();
    assert.equal(h.rpc("cursor_track.get_status").result[key], next);
  }
  const h = harness(); assert.equal(h.rpc("track.bank.volume", [1, 0.2]).result, "OK");
  assert.ok(h.rpc("cursor_track.get_status").result);
});

test("device deletion cannot settle from a getter-only count change plus unrelated callback", () => {
  const h = harness(); h.rpc("device.delete", [0, 0]);
  h.deviceCounts[0].update(1); h.ctx.observeConstructionChange(); h.settle();
  assert.equal(h.rpc("cursor_device.get_status").error.code, -32004);
  h.deviceCounts[0].notify(); h.settle(); assert.ok(h.rpc("cursor_device.get_status").result);
});

test("failed device operations permit safe new cursor readback after settling while writes remain locked", () => {
  const h = harness();
  h.cursorDevice.selectNext = () => { h.calls.push(["failingSelect"]); throw new Error("host failure"); };
  assert.equal(h.rpc("device.select_next").error.code, -32603);
  assert.equal(h.rpc("cursor_device.get_status").error.code, -32004);
  h.settle();
  assert.equal(h.rpc("cursor_device.get_status").result.position, 1);
  assert.equal(h.rpc("mixer.master.get_volume").result, 0.7);
  assert.ok(h.rpc("mixer.return.list").result);
  assert.equal(h.rpc("device.select_next").error.code, -32004);
  assert.deepEqual(h.calls, [["failingSelect"]]);
});


test("structural and device browser preconditions require explicit observed stopped/closed states", () => {
  const stopped = harness();
  stopped.ctx.advancedState.mixSafety.seen.playing = false;
  assert.equal(stopped.rpc("track.delete", [0]).error.code, -32004);
  stopped.settle(); assert.equal(stopped.rpc("device.delete", [0, 0]).error.code, -32004);
  stopped.playing.notify(); stopped.settle();
  assert.ok(stopped.rpc("track.duplicate", [0]).result);
  const browser = harness(); browser.ctx.advancedState.mixBrowser.seen.exists = false;
  assert.equal(browser.rpc("device.browse_insert_before").error.code, -32004);
  browser.settle(); assert.equal(browser.rpc("device.browse_replace").error.code, -32004);
  browser.browser.notify(); browser.settle(); assert.ok(browser.rpc("device.browse_replace").result);
});
