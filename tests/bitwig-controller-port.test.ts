import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../bitwig-controller/BeatTwin/BeatTwin.control.ts", import.meta.url), "utf8");

function harness() {
  const writes: unknown[][] = [];
  const observers: (() => void)[] = [];
  const value = (initial: any) => {
    let current = initial;
    return { get: () => current, getRaw: () => current,
      set(next: any) { writes.push(["set", next]); current = next; },
      update(next: any) { current = next; },
      markInterested() {}, addValueObserver(fn: () => void) { observers.push(fn); } };
  };
  const color = { red: () => 0.2, green: () => 0.3, blue: () => 0.4,
    set(...rgb: number[]) { writes.push(["color", ...rgb]); } };
  const tracks = Array.from({ length: 8 }, (_, index) => {
    const values: Record<string, any> = { exists: value(index < 2), position: value(index + 16),
      name: value(`Track ${index}`), volume: value(0.75), pan: value(0.5), mute: value(false),
      solo: value(false), arm: value(false) };
    const slots = Array.from({ length: 8 }, (_, slotIndex) => {
      const slotValues: Record<string, any> = { exists: value(true), sceneIndex: value(slotIndex + 8),
        name: value(`Clip ${slotIndex}`), hasContent: value(index === 0 && slotIndex === 0),
        isSelected: value(index === 0 && slotIndex === 0), isPlaying: value(false),
        isRecording: value(false), isPlaybackQueued: value(false) };
      return Object.assign({ values: slotValues }, Object.fromEntries(Object.entries(slotValues).map(([key, val]) => [key, () => val])));
    });
    return Object.assign({ values, slots, color: () => color,
      clipLauncherSlotBank: () => ({ getItemAt: (slot: number) => slots[slot] }),
      makeVisibleInArranger() { writes.push(["arranger", index]); },
      makeVisibleInMixer() { writes.push(["mixer", index]); } },
    Object.fromEntries(Object.entries(values).map(([key, val]) => [key, () => val])));
  });
  const scenes = Array.from({ length: 8 }, (_, index) => ({ exists: () => value(index < 2),
    name: () => value(`Scene ${index}`), sceneIndex: () => value(index + 8) }));
  const scrollPosition = value(16);
  const context: any = { loadAPI() {}, println() {}, host: { defineController() {} } };
  runInNewContext(source, context);
  Object.assign(context, { trackBank: { getItemAt: (i: number) => tracks[i],
    itemCount: () => value(18), scrollPosition: () => scrollPosition,
    canScrollForwards: () => value(true), canScrollBackwards: () => value(true),
    scrollForwards() { writes.push(["forward"]); }, scrollBackwards() { writes.push(["backward"]); } },
  sceneBank: { getScene: (i: number) => scenes[i] },
  application: { projectName: () => value("Acid") },
  transport: { tempo: () => ({ value: () => value(139) }), getPosition: () => value(8),
    isPlaying: () => value(false), isArrangerRecordEnabled: () => value(false) },
  controllerInstanceId: "test-controller", targetTracks: tracks, targetSlots: tracks.map((track) => track.slots),
  cursorClipTrack: tracks[0], cursorClipSlot: tracks[0].slots[0],
  inspectionTrack: tracks[0], inspectionSlot: tracks[0].slots[0],
  inspectionClip: { exists: () => value(true), getLoopLength: () => value(32),
    getStep: (_channel: number, x: number, y: number) => ({ state: () => x === 3 && y === 36 ? "NoteOn" : "Empty",
      channel: () => 0, x: () => x, y: () => y, velocity: () => 0.75, duration: () => 0.5 }),
    scrollToStep() { throw new Error("Read must not scroll"); }, scrollToKey() { throw new Error("Read must not scroll"); } },
  });
  function rpc(method: string, params: unknown[] = [], authenticated = false) {
    let reply: any;
    context.handleRequest({ id: 1, method, params }, { send(bytes: number[]) {
      reply = JSON.parse(String.fromCharCode(...bytes));
    } }, { authenticated });
    return reply;
  }
  return { context, tracks, writes, rpc, scrollPosition, value };
}

test("read port reports absolute identities, empty slots, and nonexistent bank rows without writes", () => {
  const h = harness();
  const grid = h.rpc("clip.get_grid").result;
  assert.equal(grid.tracks.length, 8);
  assert.equal(grid.bank.scrollPosition, 16);
  assert.equal(grid.bank.trackCount, 18);
  assert.equal(grid.tracks[0].slots[0].trackPosition, 16);
  assert.equal(grid.tracks[0].slots[0].slotSceneIndex, 8);
  assert.equal(grid.tracks[0].slots[0].hasContent, true);
  assert.equal(grid.tracks[0].slots[1].exists, true);
  assert.equal(grid.tracks[0].slots[1].hasContent, false);
  assert.equal(grid.tracks[2].exists, false);
  assert.equal(grid.tracks[2].position, null);
  assert.equal(grid.tracks[2].slots[0].exists, false);
  assert.equal(grid.tracks[2].slots[0].slotSceneIndex, null);
  assert.equal(h.rpc("track.list").result.length, 8);
  assert.equal(h.rpc("track.get_info", [0]).result.name, "Track 0");
  assert.equal(h.rpc("project.get_summary").result.transport.tempoBpm, 139);
  assert.deepEqual(h.writes, []);
});

test("project diagnostics expose a creative mutation lock only when one exists", () => {
  const h = harness();
  assert.equal("creativeMutation" in h.rpc("project.get_summary").result, false);
  h.context.creativeMutationStatus = () => null;
  assert.equal("creativeMutation" in h.rpc("project.get_summary").result, false);
  const status = { status: "uncertain", group: "notes", verified: false, writesBlocked: true,
    reason: "Expected note state was not observed", recovery: "readback_then_reload_controller" };
  h.context.creativeMutationStatus = () => status;
  assert.deepEqual(h.rpc("project.get_summary").result.creativeMutation, status);
  assert.deepEqual(h.writes, []);
});

test("invalid bank indices, names, colors and positions fail before mutation", () => {
  const h = harness();
  for (const index of [-1, 8, 0.5, NaN, Infinity, "0", null, undefined]) {
    for (const [method, args] of [
      ["track.get_info", [index]], ["clip.get_status", [0, index]],
      ["track.rename", [index, "Acid"]], ["scene.rename", [index, "Drop"]],
      ["track.scroll_into_view", [index]], ["clip.get_notes", [index, 0]],
    ] as [string, unknown[]][]) assert.equal(h.rpc(method, args, true).error.code, -32602, method);
  }
  for (const name of ["", "  ", "a".repeat(129), "a\nb", "a\u0085b", 23]) {
    assert.equal(h.rpc("track.rename", [0, name], true).error.code, -32602);
    assert.equal(h.rpc("scene.rename", [0, name], true).error.code, -32602);
  }
  for (const component of [-0.1, 1.1, NaN, Infinity, "0.5"]) {
    assert.equal(h.rpc("track.set_color", [0, 0.1, component, 0.3], true).error.code, -32602);
  }
  for (const position of [-1, 18, 0.5, Infinity, "1"]) {
    assert.equal(h.rpc("track.bank.scroll_to_position", [position], true).error.code, -32602);
  }
  assert.equal(h.rpc("track.rename", [7, "Missing"], true).error.code, -32004);
  assert.equal(h.rpc("scene.rename", [7, "Missing"], true).error.code, -32004);
  assert.deepEqual(h.writes, []);
});

test("new mutations require authenticated relay and dispatch supported host calls", () => {
  const h = harness();
  for (const [method, params] of [
    ["track.rename", [0, "Dark Acid"]], ["track.set_color", [0, 0.1, 0.2, 0.3]],
    ["scene.rename", [0, "Drop"]], ["track.scroll_into_view", [0]],
    ["track.bank.scroll_forward", []], ["track.bank.scroll_backward", []],
    ["track.bank.scroll_to_position", [9]],
  ] as [string, unknown[]][]) {
    assert.equal(h.rpc(method, params).error.code, -32001);
    assert.equal(h.rpc(method, params, true).result, "OK");
    if (h.context.bankNavigation !== null) {
      const position = h.context.bankNavigation.destination ?? (h.context.bankNavigation.from + (method.endsWith("backward") ? -1 : 1));
      h.scrollPosition.update(position);
      h.context.observeBankNavigationPosition(position);
      h.context.flush(); h.context.flush();
    }
  }
  assert.equal(h.tracks[0].name().get(), "Dark Acid");
  assert.equal(h.scrollPosition.get(), 9);
  assert.deepEqual(h.writes, [["set", "Dark Acid"], ["color", 0.1, 0.2, 0.3], ["set", "Drop"],
    ["arranger", 0], ["mixer", 0], ["forward"], ["backward"], ["set", 9]]);
});

test("note reads require selected matching settled cursor and return bounded actual note data", () => {
  const h = harness();
  assert.equal(h.rpc("clip.get_notes", [0, 0]).error.code, -32004);
  h.context.flush();
  assert.equal(h.rpc("clip.get_notes", [0, 0]).error.code, -32004);
  h.context.flush();
  const reply = h.rpc("clip.get_notes", [0, 0]);
  assert.deepEqual(reply.result.notes, [{ channel: 0, step: 3, pitch: 36, velocity: 95, durationBeats: 0.5 }]);
  assert.deepEqual(reply.result.coverage, { startStep: 0, stepCount: 64, stepSizeBeats: 0.25,
    minPitch: 0, maxPitch: 127, channels: [0], completeClip: false });
  assert.equal(reply.result.clipLengthBeats, 32);
  assert.equal(h.rpc("clip.get_notes", [0, 1]).error.code, -32004);
  h.context.inspectionTrack = h.tracks[1];
  assert.equal(h.rpc("clip.get_notes", [0, 0]).error.code, -32004);
  h.context.inspectionTrack = h.tracks[0];
  h.context.invalidateInspection();
  assert.equal(h.rpc("clip.get_notes", [0, 0]).error.code, -32004);
  h.context.flush(); h.context.flush();
  assert.equal(h.rpc("clip.get_notes", [0, 0]).result.notes.length, 1);
  assert.deepEqual(h.writes, []);
});

test("unknown occupancy and note states fail closed instead of reporting empty", () => {
  const h = harness();
  h.tracks[0].slots[0].values.hasContent.update(undefined);
  assert.equal(h.rpc("clip.get_status", [0, 0]).error.code, -32004);
  h.tracks[0].slots[0].values.hasContent.update(true);
  h.context.flush(); h.context.flush();
  h.context.inspectionClip.getStep = () => ({ state: () => "Unknown" });
  assert.equal(h.rpc("clip.get_notes", [0, 0]).error.code, -32004);
  h.context.inspectionClip.getStep = () => null;
  assert.equal(h.rpc("clip.get_notes", [0, 0]).error.code, -32004);
  assert.deepEqual(h.writes, []);
});

test("navigation invalidates note readiness and unknown boundaries fail closed", () => {
  const h = harness();
  h.context.flush(); h.context.flush();
  assert.ok(h.rpc("clip.get_notes", [0, 0]).result);
  assert.equal(h.rpc("track.bank.scroll_forward", [], true).result, "OK");
  assert.equal(h.rpc("clip.get_notes", [0, 0]).error.code, -32004);
  h.context.trackBank.canScrollForwards = () => h.value(undefined);
  assert.equal(h.rpc("track.bank.scroll_forward", [], true).error.code, -32004);
  assert.deepEqual(h.writes, [["forward"]]);
});

test("read cursor setup subscribes to API10 note updates and anchors only during initialization", () => {
  const initBody = source.slice(source.indexOf("function init()"), source.indexOf("function connectLocalBridge()"));
  assert.match(initBody, /inspectionClip\.addNoteStepObserver\(invalidateInspection\)/);
  assert.match(initBody, /inspectionClip\.scrollToStep\(0\)/);
  assert.match(initBody, /inspectionClip\.scrollToKey\(0\)/);
  assert.match(initBody, /inspectionValues\[readIndex\]\.addValueObserver\(invalidateInspection\)/);
  const readBody = source.slice(source.indexOf("function readInspectionNotes"), source.indexOf("function handleRequest"));
  assert.doesNotMatch(readBody, /scrollTo|\.select\(|showInEditor|\.set\(/);
});


test("navigation revokes confirmed targets synchronously and blocks inspection plus legacy writes", () => {
  for (const [method, params] of [
    ["track.bank.scroll_forward", []], ["track.bank.scroll_backward", []],
    ["track.bank.scroll_to_position", [9]],
  ] as [string, unknown[]][]) {
    const h = harness();
    const binding = h.context.currentTargetBinding();
    assert.equal(h.rpc(method, params, true).result, "OK");
    assert.ok(h.context.targetGeneration > binding.targetGeneration);
    assert.equal(h.rpc("target.create_clip", [binding, 4], true).error.code, -32004);
    assert.equal(h.rpc("target.inspect").error.code, -32004);
    for (const [blockedMethod, blockedParams] of [
      ["track.list", []], ["project.get_summary", []], ["clip.get_grid", []],
      ["track.rename", [0, "Wrong track"]], ["track.bank.volume", [0, 0.1]],
      ["clip.create", [0, 0, 4]], ["device.browse_start", [0]],
    ] as [string, unknown[]][]) assert.equal(h.rpc(blockedMethod, blockedParams, true).error.code, -32004);
    assert.throws(() => h.context.currentTargetBinding(), /synchronizing/);
    assert.equal(h.rpc("transport.getTempo").result, 139);
    assert.equal(h.rpc("bridge.identity").result.controllerInstanceId, "test-controller");
    assert.equal(h.writes.length, 1);
  }
});

test("navigation waits for matching position observer then two stable update cycles", () => {
  const h = harness();
  const binding = h.context.currentTargetBinding();
  h.rpc("track.bank.scroll_to_position", [9], true);
  // A getter can update before the observer: neither this nor time alone releases the barrier.
  for (let frame = 0; frame < 5; frame++) h.context.flush();
  assert.equal(h.rpc("track.list").error.code, -32004);
  h.context.observeBankNavigationPosition(16);
  h.context.flush(); h.context.flush();
  assert.equal(h.rpc("target.inspect").error.code, -32004);
  h.context.observeBankNavigationPosition(9);
  h.context.flush();
  assert.equal(h.rpc("track.list").error.code, -32004);
  // A late identity update requires another pair of stable frames.
  h.context.refreshTargetGeneration();
  h.context.flush();
  assert.equal(h.rpc("track.list").error.code, -32004);
  h.context.flush();
  assert.ok(h.rpc("track.list").result);
  assert.equal(h.rpc("target.create_clip", [binding, 4], true).error.code, -32003);
  assert.ok(h.context.currentTargetBinding().targetGeneration > binding.targetGeneration);
  assert.deepEqual(h.writes, [["set", 9]]);
});

test("scroll to current position is a validated no-op and does not wait for an observer", () => {
  const h = harness();
  const binding = h.context.currentTargetBinding();
  assert.equal(h.rpc("track.bank.scroll_to_position", [16], true).result, "OK");
  assert.equal(h.context.bankNavigation, null);
  assert.deepEqual(h.context.currentTargetBinding(), binding);
  assert.ok(h.rpc("track.list").result);
  assert.deepEqual(h.writes, []);
});
