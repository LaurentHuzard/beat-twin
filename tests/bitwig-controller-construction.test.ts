import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../bitwig-controller/BeatTwin/BeatTwin.control.ts", import.meta.url), "utf8");
function harness() {
  const calls: unknown[][] = [];
  const context: any = { loadAPI() {}, println() {}, host: { defineController() {} } };
  runInNewContext(source, context);
  const value = (initial: any, readonly = false) => {
    let current = initial;
    const observers: (() => void)[] = [];
    const item: any = { get: () => current, getRaw: () => current, update: (next: any) => { current = next; },
      markInterested() {}, addValueObserver(fn: () => void) { observers.push(fn); },
      notify() { observers.forEach((fn) => fn()); context.observeConstructionChange(); } };
    if (!readonly) item.set = (next: any) => { calls.push(["value.set", next]); current = next; };
    return item;
  };
  const tracks = Array.from({ length: 8 }, (_, trackIndex) => {
    const values: any = { exists: value(trackIndex < 2), position: value(trackIndex + 8), name: value("Track"),
      volume: value(0.5), pan: value(0.5), mute: value(false), solo: value(false), arm: value(false) };
    const slots = Array.from({ length: 8 }, (_, index) => {
      const vals: any = { exists: value(true), sceneIndex: value(index + 16), name: value("Old clip", true),
        hasContent: value(trackIndex === 0 && index === 0), isSelected: value(trackIndex === 0 && index === 0),
        isPlaying: value(false), isRecording: value(false), isPlaybackQueued: value(false) };
      const slot: any = { values: vals,
        color: () => ({ red: () => 0.2, green: () => 0.3, blue: () => 0.4, set(...rgb: number[]) { calls.push(["color", ...rgb]); } }),
        replaceInsertionPoint: () => ({ copySlotsOrScenes(src: any) { calls.push(["copy", src.sceneIndex().get(), index + 16]); } }),
        browseToInsertClip() { calls.push(["browse", trackIndex, index]); } };
      for (const key of Object.keys(vals)) slot[key] = () => vals[key];
      return slot;
    });
    const track: any = { slots, values, color: slots[0].color,
      clipLauncherSlotBank: () => ({ getItemAt: (i: number) => slots[i], deleteClip: (i: number) => calls.push(["deleteClip", trackIndex, i]) }) };
    for (const key of Object.keys(values)) track[key] = () => values[key];
    return track;
  });
  const sceneCount = value(20);
  const scenes = Array.from({ length: 8 }, (_, i) => {
    const vals: any = { exists: value(true), sceneIndex: value(i + 16), name: value("Scene"), clipCount: value(i === 0 ? 1 : 0) };
    const scene: any = { values: vals, deleteObject() { calls.push(["deleteScene", i]); },
      selectInEditor() { calls.push(["selectScene", i]); }, addIsSelectedInEditorObserver() {} };
    for (const key of Object.keys(vals)) scene[key] = () => vals[key];
    return scene;
  });
  const notes = new Map<string, { velocity: number; duration: number; state?: string }>();
  const loopLength = value(4), loopStart = value(0), playing = value(false), browser = value(false);
  let throwAt = -1, stepCalls = 0;
  const cursor: any = { exists: () => value(true), getLoopLength: () => loopLength, getLoopStart: () => loopStart,
    setName(name: string) { calls.push(["setName", name]); },
    getStep(channel: number, step: number, pitch: number) {
      const note = notes.get(`${step}:${pitch}`);
      return { state: () => note?.state ?? (note ? "NoteOn" : "Empty"), channel: () => channel,
        x: () => step, y: () => pitch, velocity: () => (note?.velocity ?? 127) / 127, duration: () => note?.duration ?? 0.25 };
    },
    setStep(...args: number[]) { if (stepCalls++ === throwAt) throw new Error("host failed"); calls.push(["setStep", ...args]); },
    clearStep(...args: number[]) { if (stepCalls++ === throwAt) throw new Error("host failed"); calls.push(["clearStep", ...args]); },
    scrollToStep() { throw new Error("Unexpected scroll"); }, scrollToKey() { throw new Error("Unexpected scroll"); } };
  Object.assign(context, { controllerInstanceId: "test", trackBank: { getItemAt: (i: number) => tracks[i],
    itemCount: () => value(10), scrollPosition: () => value(8) },
    targetTracks: tracks, targetSlots: tracks.map((track) => track.slots),
    cursorClipTrack: tracks[0], cursorClipSlot: tracks[0].slots[0],
    inspectionTrack: tracks[0], inspectionSlot: tracks[0].slots[0], inspectionClip: cursor,
    sceneBank: { getScene: (i: number) => scenes[i], itemCount: () => sceneCount },
    application: { projectName: () => value("Test") }, project: { createScene() { calls.push(["createScene"]); }, createSceneFromPlayingLauncherClips() { calls.push(["capture"]); } },
    popupBrowser: { exists: () => browser },
    transport: { isPlaying: () => playing, isArrangerRecordEnabled: () => value(false) } });
  context.watchMixValue(sceneCount, "count", "scenes"); sceneCount.notify();
  context.flush(); context.flush();
  function rpc(method: string, params: unknown[] = [], authenticated = true) {
    let reply: any;
    context.handleRequest({ id: 1, method, params }, { send(bytes: number[]) { reply = JSON.parse(String.fromCharCode(...bytes)); } }, { authenticated });
    return reply;
  }
  function settle() { context.observeConstructionChange(); context.flush(); context.flush(); }
  return { context, rpc, calls, tracks, scenes, sceneCount, notes, loopLength, loopStart, playing, browser, settle,
    failAt(index: number) { throwAt = index; } };
}
const n = (step = 0, pitch = 36, durationBeats = 0.25) => ({ step, pitch, velocity: 100, durationBeats });

test("scene creation calls the project API and waits for an observed count increment", () => {
  const h = harness();
  assert.equal(h.rpc("scene.create", [], false).error.code, -32001);
  assert.equal(h.rpc("scene.create", [1]).error.code, -32602);
  h.playing.update(true);
  assert.equal(h.rpc("scene.create").error.code, -32004);
  h.playing.update(false);
  h.context.advancedState.scenes.seen.count = false;
  h.sceneCount.update(0);
  assert.equal(h.rpc("scene.create").error.code, -32004);
  assert.deepEqual(h.calls, []);
  h.sceneCount.notify(); h.settle();
  assert.equal(h.rpc("scene.create").result.requiresReadback, true);
  assert.deepEqual(h.calls, [["createScene"]]);
  h.context.flush(); h.context.flush();
  assert.equal(h.rpc("scene.list").error.code, -32004);
  h.sceneCount.update(1);
  h.context.observeConstructionChange(); // unrelated callback cannot acknowledge the new count
  h.context.flush(); h.context.flush();
  assert.equal(h.rpc("scene.list").error.code, -32004);
  h.sceneCount.notify(); h.settle();
  assert.ok(h.rpc("scene.list").result);
});

test("clip colors are read without mutations and color writes validate bounds", () => {
  const h = harness();
  h.tracks[0].slots[0].values.isPlaying.update(true);
  assert.deepEqual(h.rpc("clip.get_color", [0, 0], false).result, { r: 0.2, g: 0.3, b: 0.4 });
  assert.equal(h.rpc("clip.set_color", [0, 0, 0.1, 0.2, 0.3]).error.code, -32004);
  h.tracks[0].slots[0].values.isPlaying.update(false);
  for (const bad of [-1, Infinity, NaN, "0.5", 1.1]) assert.equal(h.rpc("clip.set_color", [0, 0, bad, 0, 0]).error.code, -32602);
  assert.deepEqual(h.calls, []);
  assert.equal(h.rpc("clip.set_color", [0, 0, 0.1, 0.2, 0.3]).result.verified, false);
  assert.deepEqual(h.calls, [["color", 0.1, 0.2, 0.3]]);
});

test("clip rename uses the selected cursor because launcher slot name is read-only", () => {
  const h = harness();
  assert.equal(h.tracks[0].slots[0].name().set, undefined);
  const binding = h.context.currentTargetBinding();
  assert.equal(h.rpc("clip.rename", [0, 0, "Acid"]).result.requiresReadback, true);
  assert.ok(h.context.targetGeneration > binding.targetGeneration);
  assert.deepEqual(h.calls, [["setName", "Acid"]]);
  assert.equal(h.rpc("track.list").error.code, -32004);
  h.context.flush(); h.context.flush();
  assert.equal(h.rpc("target.inspect").error.code, -32004);
  h.tracks[0].slots[0].values.name.update("Acid");
  h.settle();
  assert.ok(h.rpc("track.list").result);
  assert.equal(h.rpc("target.create_clip", [binding, 4]).error.code, -32003);
});

test("clip copy targets an explicit empty slot and blocks stale state until content is observed", () => {
  for (const destination of [0, 8, -1, 0.5]) {
    const h = harness();
    assert.ok(h.rpc("clip.duplicate", [0, 0, destination]).error);
    assert.deepEqual(h.calls, []);
  }
  const h = harness();
  h.tracks[0].slots[1].values.hasContent.update(undefined);
  assert.equal(h.rpc("clip.duplicate", [0, 0, 1]).error.code, -32004);
  h.tracks[0].slots[1].values.hasContent.update(false);
  const binding = h.context.currentTargetBinding();
  assert.equal(h.rpc("clip.duplicate", [0, 0, 1]).result.status, "dispatched");
  assert.deepEqual(h.calls, [["copy", 16, 17]]);
  assert.equal(h.rpc("target.create_clip", [binding, 4]).error.code, -32004);
  h.context.flush(); h.context.flush();
  assert.equal(h.rpc("clip.get_grid").error.code, -32004);
  h.tracks[0].slots[1].values.hasContent.update(true);
  h.settle();
  assert.equal(h.rpc("clip.get_status", [0, 1]).result.hasContent, true);
});

test("clip deletion revokes bindings and requires observed empty slot before reuse", () => {
  const h = harness();
  assert.equal(h.rpc("clip.delete", [0, 0]).result.status, "dispatched");
  assert.deepEqual(h.calls, [["deleteClip", 0, 0]]);
  assert.equal(h.rpc("clip.create", [0, 0, 4]).error.code, -32004);
  h.tracks[0].slots[0].values.hasContent.update(false);
  h.settle();
  assert.equal(h.rpc("clip.get_status", [0, 0]).result.hasContent, false);
});

test("new writes reject unauthenticated, unavailable and queued targets before host calls", () => {
  for (const [method, params] of [
    ["clip.rename", [0, 0, "Acid"]], ["clip.set_color", [0, 0, 0, 0, 0]], ["clip.delete", [0, 0]],
    ["clip.duplicate", [0, 0, 1]], ["clip.browse_insert", [0, 1]], ["scene.select", [0]],
    ["scene.delete", [0]], ["scene.create_from_playing", []], ["clip.set_notes", [0, 0, [n()]]],
    ["clip.clear_notes", [0, 0, [{ step: 0, pitch: 36 }]]], ["clip.set_loop_length", [0, 0, 8]],
  ] as [string, unknown[]][]) {
    const h = harness();
    assert.equal(h.rpc(method, params, false).error.code, -32001, method);
    assert.deepEqual(h.calls, []);
  }
  const h = harness();
  h.tracks[0].slots[0].values.isPlaybackQueued.update(true);
  assert.equal(h.rpc("clip.set_notes", [0, 0, [n()]]).error.code, -32004);
  assert.equal(h.rpc("clip.delete", [0, 0]).error.code, -32004);
  assert.deepEqual(h.calls, []);
});

test("note batch validates every note, overlaps and existing sustain before first write", () => {
  const batches: any[] = [[], Array.from({ length: 257 }, () => n()), [n(), n()], [n(0, 36, 1), n(2, 36)],
    [n(), { ...n(1), velocity: 0 }], [n(), n(64)], [n(), { ...n(1), durationBeats: 0.1 }],
    [n(), { ...n(1), channel: 1 }], [n(), n(15, 37, 1)]];
  for (const notes of batches) {
    const h = harness();
    assert.ok(h.rpc("clip.set_notes", [0, 0, notes]).error);
    assert.deepEqual(h.calls, []);
  }
  for (const state of ["NoteOn", "NoteSustain", "Unknown"]) {
    const h = harness();
    h.notes.set("1:36", { velocity: 100, duration: 0.25, state });
    assert.ok(h.rpc("clip.set_notes", [0, 0, [n(0, 36, 0.5)]]).error);
    assert.deepEqual(h.calls, []);
  }
  const h = harness();
  h.loopStart.update(4);
  assert.equal(h.rpc("clip.set_notes", [0, 0, [n()]]).error.code, -32004);
  assert.deepEqual(h.calls, []);
});

test("note batch dispatches exact steps and requires observed content before subsequent writes", () => {
  const h = harness();
  const reply = h.rpc("clip.set_notes", [0, 0, [n(), n(2, 38, 0.5)]]);
  assert.deepEqual(reply.result, { status: "dispatched", dispatchedCount: 2, totalCount: 2, verified: false, requiresReadback: true });
  assert.deepEqual(h.calls, [["setStep", 0, 0, 36, 100, 0.25], ["setStep", 0, 2, 38, 100, 0.5]]);
  assert.equal(h.rpc("clip.set_notes", [0, 0, [n()]]).error.code, -32004);
  h.notes.set("0:36", { velocity: 100, duration: 0.25 });
  h.notes.set("2:38", { velocity: 100, duration: 0.5 });
  h.settle();
  assert.equal(h.rpc("clip.get_notes", [0, 0]).result.notes.length, 2);
});

test("note batch reports partial dispatch honestly and retains barrier if state is unresolved", () => {
  for (const failAt of [0, 1]) {
    const h = harness();
    h.failAt(failAt);
    assert.deepEqual(h.rpc("clip.set_notes", [0, 0, [n(), n(2, 38)]]).result, {
      status: "partial", dispatchedCount: failAt, totalCount: 2, verified: false, requiresReadback: true,
      uncertain: true, recovery: "readback_then_reload_controller", error: "host failed" });
    assert.equal(h.rpc("clip.get_notes", [0, 0]).error.code, -32004);
    if (failAt === 1) h.notes.set("0:36", { velocity: 100, duration: 0.25 });
    h.settle();
    assert.equal(h.rpc("clip.get_notes", [0, 0]).result.notes.length, failAt);
    assert.ok(h.rpc("clip.get_grid").result);
    assert.equal(h.rpc("clip.set_notes", [0, 0, [n(4)]]).error.code, -32004);
    assert.equal(h.rpc("target.inspect").error.code, -32004);
    assert.equal(h.context.constructionReadAccess, false);
  }
});

test("clear batch requires distinct observed note starts and never clears a sustain or whole clip", () => {
  const h = harness();
  h.notes.set("0:36", { velocity: 100, duration: 1 });
  h.notes.set("1:36", { velocity: 100, duration: 1, state: "NoteSustain" });
  assert.ok(h.rpc("clip.clear_notes", [0, 0, [{ step: 0, pitch: 36 }, { step: 1, pitch: 36 }]]).error);
  assert.ok(h.rpc("clip.clear_notes", [0, 0, [{ step: 0, pitch: 36 }, { step: 0, pitch: 36 }]]).error);
  assert.deepEqual(h.calls, []);
  assert.equal(h.rpc("clip.clear_notes", [0, 0, [{ step: 0, pitch: 36 }]]).result.dispatchedCount, 1);
  assert.deepEqual(h.calls, [["clearStep", 0, 0, 36]]);
});

test("loop extension rejects reduction and nonzero start, with no-op and observed update handling", () => {
  const h = harness();
  for (const length of [0, 2, 17, 4.1, NaN, "8"]) assert.ok(h.rpc("clip.set_loop_length", [0, 0, length]).error);
  assert.equal(h.rpc("clip.set_loop_length", [0, 0, 4]).result.verified, false);
  assert.equal(h.context.constructionPending, null);
  assert.deepEqual(h.calls, []);
  h.loopStart.update(1);
  assert.ok(h.rpc("clip.set_loop_length", [0, 0, 8]).error);
  h.loopStart.update(0);
  assert.equal(h.rpc("clip.set_loop_length", [0, 0, 8]).result.status, "dispatched");
  assert.deepEqual(h.calls, [["value.set", 8]]);
  assert.equal(h.rpc("track.list").error.code, -32004);
  h.settle();
  assert.ok(h.rpc("track.list").result);
});

test("scene deletion waits for observed count change; capture observes count or visible content changes", () => {
  const h = harness();
  h.playing.update(true);
  assert.equal(h.rpc("scene.delete", [0]).error.code, -32004);
  h.playing.update(false);
  assert.equal(h.rpc("scene.delete", [0]).result.status, "dispatched");
  h.settle();
  assert.equal(h.rpc("scene.list").error.code, -32004);
  h.sceneCount.update(19);
  h.settle();
  assert.ok(h.rpc("scene.list").result);
  const capture = harness();
  assert.equal(capture.rpc("scene.create_from_playing").error.code, -32004);
  capture.playing.update(true);
  assert.equal(capture.rpc("scene.create_from_playing").result.requiresReadback, true);
  capture.scenes[1].values.clipCount.update(1);
  capture.settle();
  assert.ok(capture.rpc("scene.list").result);
  assert.deepEqual(capture.calls, [["capture"]]);
});

test("scene selection and clip browser insertion wait for their specific observers", () => {
  const h = harness();
  assert.equal(h.rpc("scene.select", [1]).result.status, "dispatched");
  h.settle();
  assert.equal(h.rpc("target.inspect").error.code, -32004);
  h.context.sceneSelected[1] = true;
  h.settle();
  assert.equal(h.rpc("scene.select", [1]).result.status, "dispatched");
  assert.deepEqual(h.calls, [["selectScene", 1]]);
  const browser = harness();
  assert.ok(browser.rpc("clip.browse_insert", [0, 0]).error);
  assert.equal(browser.rpc("clip.browse_insert", [0, 1]).result.status, "dispatched");
  browser.settle();
  assert.equal(browser.rpc("browser.commit").error.code, -32004);
  browser.browser.update(true);
  browser.settle();
  assert.ok(browser.rpc("track.list").result);
  assert.deepEqual(browser.calls, [["browse", 0, 1]]);
});


test("unknown callback state fails closed without escaping into the host update cycle", () => {
  const h = harness();
  h.playing.update(true);
  h.rpc("scene.create_from_playing");
  h.sceneCount.update(undefined);
  assert.doesNotThrow(() => h.context.observeConstructionChange());
  assert.doesNotThrow(() => { h.context.flush(); h.context.flush(); });
  assert.equal(h.rpc("scene.list").error.code, -32004);
});

test("construction cannot settle or recover against a different clip or retargeted bank", () => {
  const h = harness();
  h.rpc("clip.set_notes", [0, 0, [n()]]);
  h.notes.set("0:36", { velocity: 100, duration: 0.25 });
  h.context.inspectionSlot = h.tracks[0].slots[1];
  h.settle();
  assert.equal(h.rpc("track.list").error.code, -32004);
  const partial = harness();
  partial.failAt(0);
  partial.rpc("clip.set_notes", [0, 0, [n()]]);
  partial.tracks[0].values.position.update(999);
  partial.settle();
  assert.equal(partial.rpc("clip.get_grid").error.code, -32004);
});

test("read color rejects unknown, non-numeric and out-of-range host observations", () => {
  for (const color of [null, undefined, "0.2", -1, 2, Infinity, NaN]) {
    const h = harness();
    h.tracks[0].slots[0].color = () => ({ red: () => color, green: () => 0.2, blue: () => 0.3 });
    assert.equal(h.rpc("clip.get_color", [0, 0], false).error.code, -32004);
    assert.deepEqual(h.calls, []);
  }
});

test("partial host errors are bounded and stripped of control characters", () => {
  const h = harness();
  h.context.inspectionClip.setStep = () => { throw new Error("a\nb\u0000" + "x".repeat(1000)); };
  const result = h.rpc("clip.set_notes", [0, 0, [n()]]).result;
  assert.equal(result.error.length, 300);
  assert.doesNotMatch(result.error, /[\x00-\x1f\x7f-\x9f]/);
});
