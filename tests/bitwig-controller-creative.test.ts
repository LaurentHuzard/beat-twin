import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
const source = await readFile(new URL("../bitwig-controller/BeatTwin/creative.ts", import.meta.url), "utf8");
function harness(options: { initialize?: boolean; observe?: boolean; hostVersion?: string } = {}) {
  let now = 1000;
  const calls: unknown[][] = [], values: any[] = [], noteObservers: Array<() => void> = [];
  const ctx: any = { Date: { now: () => now },
    host: { getHostVersion: () => options.hostVersion ?? "6.2.0" },
    isBridgeReadMethod: (method: string) => ["transport.getIsPlaying", "project.get_status", "cursor_track.get_status"].includes(method),
    controllerInstanceId: "creative-test", targetGeneration: 0, inspectionVersion: 0,
    bridgeError: (code: number, message: string) => Object.assign(new Error(message), { jsonrpcCode: code }),
    invalidParams: (message: string) => Object.assign(new Error(message), { jsonrpcCode: -32602 }),
    isIntegerInRange: (v: any, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max,
    safeHostError: (error: Error) => error.message,
    requireArgumentCount(params: any, count: number) { if (!Array.isArray(params) || params.length !== count) throw ctx.invalidParams("Wrong argument count"); },
    requireSettledBank() {}, invalidateInspection() { ctx.inspectionVersion += 1; },
    requireStoppedStructure() { if (transport.isPlaying().get() || transport.isArrangerRecordEnabled().get()) throw ctx.bridgeError(-32004, "Stop transport"); },
    readInspectionNotes(t: number, s: number) { if (t !== 0 || s !== 0 || !clipSelected) throw ctx.bridgeError(-32004, "Clip target mismatch"); return { trackPosition: 2, slotSceneIndex: 3, coverage: { channels: [0], stepCount: 64, completeClip: false } }; },
    cursorConstructionIdentity() { return () => clipSelected; },
    cursorDeviceStatus() { return { exists: device.exists().get(), position: device.position().get(), trackPosition: track.position().get(), name: device.name().get() }; } };
  runInNewContext(source, ctx);
  function value(name: string, initial: any) {
    let current = initial; const observers: Array<(v: any) => void> = [];
    const result: any = { get: () => current, markInterested() {}, addValueObserver(fn: (v: any) => void) { observers.push(fn); },
      set(next: any) { calls.push([name, next]); if (result.throwSet) throw new Error("host setter failure"); },
      setImmediately(next: any) { calls.push([name + ".setImmediately", next]); if (result.throwSet) throw new Error("host setter failure"); },
      update(next: any) { current = next; }, notify() { observers.forEach((fn) => fn(current)); },
      emit(next: any) { current = next; result.notify(); } };
    values.push(result); return result;
  }
  function proxy(prefix: string, fields: Record<string, any>) {
    const object: any = {};
    for (const [key, initial] of Object.entries(fields)) { const v = value(prefix + "." + key, initial); object[key] = () => v; }
    return object;
  }
  function item(prefix: string, index: number, filter = true) { return proxy(prefix + index, { exists: index < 3 || index === -1, name: `Item ${index}`, isSelected: index === -1 || (!filter && index === 0), ...(filter ? { hitCount: 3 } : {}) }); }
  const browser = proxy("browser", { exists: true, title: "Insert", contentTypeNames: ["Device", "Preset"], selectedContentTypeIndex: 0, selectedContentTypeName: "Device" });
  const columns: any = {};
  for (const name of ["smartCollection", "location", "device", "category", "tag", "deviceType", "fileType", "creator"]) {
    const column = proxy(name, { exists: true, name, entryCount: 32 });
    const bank = proxy(name + "Bank", { itemCount: 32, scrollPosition: 0, canScrollForwards: true, canScrollBackwards: false });
    const items = Array.from({ length: 16 }, (_, i) => item(name, i)), wildcard = item(name, -1);
    bank.getItemAt = (index: number) => items[index];
    bank.scrollPageForwards = () => calls.push([name + ".scrollPageForwards"]);
    bank.scrollPageBackwards = () => calls.push([name + ".scrollPageBackwards"]);
    column.createItemBank = (size: number) => { assert.equal(size, 16); return bank; };
    column.getWildcardItem = () => wildcard;
    browser[name + "Column"] = () => column;
    columns[name] = { column, bank, items, wildcard };
  }
  const resultItems = Array.from({ length: 32 }, (_, i) => item("result", i, false));
  const resultBank = proxy("resultsBank", { scrollPosition: 0 }); resultBank.getItemAt = (index: number) => resultItems[index];
  const resultColumn = proxy("results", { entryCount: 3 }); browser.resultsColumn = () => resultColumn;
  for (const action of ["commit", "cancel", "selectFirstFile", "selectNextFile", "selectPreviousFile"]) browser[action] = () => calls.push(["browser." + action]);
  const remote = proxy("remote", { pageNames: ["Main", "Acid"], pageCount: 2, selectedPageIndex: 0 });
  const parameters = Array.from({ length: 8 }, (_, i) => proxy("param" + i, { exists: true, name: `Knob ${i}`, value: 0.5 })); remote.getParameter = (index: number) => parameters[index];
  const device = proxy("device", { exists: true, position: 1, name: "Synth" }), track = proxy("track", { position: 2 });
  const transport = proxy("transport", { isArrangerLoopEnabled: false, arrangerLoopStart: 0, arrangerLoopDuration: 16, isPlaying: false, isArrangerRecordEnabled: false });
  const project = proxy("project", { projectName: "Project" });
  const noteValues: Record<string, any> = { velocity: 0.8, releaseVelocity: 0.4, duration: 0.25, pan: 0, timbre: 0, pressure: 0, gain: 0.5, transpose: 0 };
  const note: any = { state: () => noteState, channel: () => 0, x: () => 0, y: () => 36 };
  let noteState = "NoteOn", clipSelected = true;
  for (const key of Object.keys(noteValues)) {
    note[key] = () => noteValues[key];
    note["set" + key[0].toUpperCase() + key.slice(1)] = (next: number) => { calls.push(["note." + key, next]); if (note.throwKey === key) throw new Error("note host error"); };
  }
  const clip = { addNoteStepObserver: (fn: () => void) => noteObservers.push(fn), getStep: (channel: number, step: number, pitch: number) => channel === 0 && step === 0 && pitch === 36 ? note : { state: () => "Empty" } };
  Object.assign(ctx, { popupBrowser: browser, browserResultBank: resultBank, remoteControlsBank: remote, cursorDevice: device, cursorTrack: track, inspectionClip: clip, transport, application: project });
  function settle() { ctx.flushCreative(); ctx.flushCreative(); }
  if (options.initialize !== false) { ctx.initCreative(); if (options.observe !== false) { values.forEach((v) => v.notify()); noteObservers.forEach((fn) => fn()); settle(); } }
  function rpc(method: string, params: any[] = []) { return ctx.handleCreativeRequest(method, params).result; }
  function throws(method: string, params: any[] = [], code = -32004) { assert.throws(() => rpc(method, params), (error: any) => error.jsonrpcCode === code); }
  return { advance(ms: number) { now += ms; }, ctx, calls, values, browser, columns, resultItems, resultBank, remote, parameters, device, track, transport, project, note, noteValues, settle, rpc, throws,
    noteNotify() { ctx.inspectionVersion += 1; noteObservers.forEach((fn) => fn()); }, setNoteState(next: string) { noteState = next; }, deselectClip() { clipSelected = false; } };
}
const coordinate = { step: 0, pitch: 36 };

test("creative module stays inert for legacy fixtures before initialization and exposes four reads", () => {
  const h = harness({ initialize: false });
  assert.equal(h.ctx.handleCreativeRequest("browser.list_results", []).handled, false);
  h.throws("browser.get_filter_items", ["category"]);
  for (const method of ["clip.get_note_expressions", "browser.get_filter_items", "device.remote_pages_get", "transport.get_arranger_loop"]) assert.equal(h.ctx.isCreativeReadMethod(method), true);
  assert.equal(h.ctx.isCreativeReadMethod("browser.set_filter"), false);
});
test("initial unobserved values are rejected rather than manufactured", () => {
  const h = harness({ observe: false });
  h.throws("browser.get_filter_items", ["category"]); h.throws("device.remote_pages_get"); h.throws("transport.get_arranger_loop");
  h.settle(); h.throws("transport.get_arranger_loop"); assert.deepEqual(h.calls, []);
});
test("note expressions read exact normalized ranges and bounded coverage", () => {
  const h = harness(), result = h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]);
  assert.equal(result.notes[0].gain, 0.5); assert.equal(result.notes[0].velocity, 0.8); assert.equal(result.notes[0].durationBeats, 0.25);
  assert.equal(result.coverage.completeClip, false); assert.ok(result.snapshotId);
  h.setNoteState("NoteSustain"); h.throws("clip.get_note_expressions", [0, 0, [coordinate]]);
});
test("all expression inputs and snapshot validate before any setter", () => {
  const invalid = [[], [coordinate], [{ ...coordinate, pressure: -1 }], [{ ...coordinate, timbre: 2 }], [{ ...coordinate, transpose: 97 }], [{ ...coordinate, gain: NaN }], [{ ...coordinate, pressure: 0.1, durationBeats: 4 }], [{ ...coordinate, pressure: 0.1 }, { ...coordinate, pan: 0.1 }], [{ step: 64, pitch: 36, pan: 0 }]];
  for (const notes of invalid) { const h = harness(), read = h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]); h.throws("clip.set_note_expressions", [0, 0, read.snapshotId, notes], -32602); assert.deepEqual(h.calls, []); }
  const h = harness(), read = h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]); h.noteNotify(); h.settle(); h.throws("clip.set_note_expressions", [0, 0, read.snapshotId, [{ ...coordinate, pan: 0.2 }]]); assert.deepEqual(h.calls, []);
});
test("expression setters wait for a real note callback and expected values", () => {
  const h = harness(), read = h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]);
  const result = h.rpc("clip.set_note_expressions", [0, 0, read.snapshotId, [{ ...coordinate, pan: -1, pressure: 1 }]]);
  assert.equal(result.dispatchedCount, 2); assert.deepEqual(h.calls, [["note.pan", -1], ["note.pressure", 1]]);
  h.noteValues.pan = -1; h.noteValues.pressure = 1; h.settle(); h.throws("clip.get_note_expressions", [0, 0, [coordinate]]);
  h.noteNotify(); h.settle(); assert.equal(h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]).notes[0].pressure, 1);
});
test("partial expression failure reports successful setters and locks writes without retry", () => {
  const h = harness(), read = h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]); h.note.throwKey = "pressure";
  const result = h.rpc("clip.set_note_expressions", [0, 0, read.snapshotId, [{ ...coordinate, pan: -1, pressure: 1 }]]);
  assert.equal(result.status, "partial"); assert.equal(result.dispatchedCount, 1); assert.equal(result.totalCount, 2); assert.equal(result.uncertain, true);
  h.settle(); h.throws("device.remote_page_select", [1, "anything"]);
  assert.doesNotThrow(() => h.ctx.guardCreativeLegacyRequest("note_input.send_note_off", [0, 36, 0]));
  assert.doesNotThrow(() => h.ctx.guardCreativeLegacyRequest("note_input.all_notes_off", []));
  assert.equal(h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]).notes[0].pan, 0);
  assert.equal(h.calls.length, 2);
});
test("browser reads eight real filter columns and explicit wildcard without text search", () => {
  const h = harness();
  for (const column of Object.keys(h.columns)) { const result = h.rpc("browser.get_filter_items", [column]); assert.equal(result.items.length, 16); assert.equal(result.wildcard.index, -1); assert.equal(result.coverage.complete, false); }
  h.throws("browser.get_filter_items", ["search"], -32602);
  h.columns.category.column.exists().emit(false); h.settle(); assert.equal(h.rpc("browser.get_filter_items", ["category"]).exists, false);
});
test("browser token expires on content callbacks and close/reopen session", () => {
  const h = harness(), old = h.rpc("browser.get_filter_items", ["category"]);
  h.browser.exists().emit(false); h.browser.exists().emit(true);
  h.throws("browser.get_filter_items", ["category"]); h.settle();
  const fresh = h.rpc("browser.get_filter_items", ["category"]); assert.notEqual(old.sessionId, fresh.sessionId);
  assert.equal(fresh.observation.source, "interested_host_cache");
  h.throws("browser.set_filter", ["category", 1, old.snapshotId]);
  h.columns.category.items[1].name().emit("New"); h.settle(); h.throws("browser.set_filter", ["category", 1, fresh.snapshotId]); assert.deepEqual(h.calls, []);
});
test("filter selection uses direct selected proxy and blocks legacy commit until its callback", () => {
  const h = harness(), before = h.rpc("browser.get_filter_items", ["category"]);
  h.rpc("browser.set_filter", ["category", 1, before.snapshotId]); assert.deepEqual(h.calls, [["category1.isSelected", true]]);
  h.columns.category.items[1].isSelected().update(true); h.columns.category.items[2].name().notify(); h.settle(); h.throws("browser.commit");
  h.columns.category.items[1].isSelected().notify(); h.settle(); assert.equal(h.rpc("browser.get_filter_items", ["category"]).items[1].selected, true);
});

test("filter selection rejects target item and column rebinding, including ABA", () => {
  for (const field of ["name", "exists", "offset", "columnExists", "columnName"]) for (const returnToOriginal of [false, true]) {
    const h = harness(), before = h.rpc("browser.get_filter_items", ["category"]);
    h.rpc("browser.set_filter", ["category", 1, before.snapshotId]);
    const column = h.columns.category, item = column.items[1];
    const value = field === "name" ? item.name() : field === "exists" ? item.exists() : field === "offset" ? column.bank.scrollPosition() : field === "columnExists" ? column.column.exists() : column.column.name();
    const initial = value.get(), replacement = field === "name" || field === "columnName" ? "Replacement" : field === "offset" ? 16 : false;
    value.emit(replacement); if (returnToOriginal) value.emit(initial);
    item.isSelected().emit(true); h.settle(); assert.notEqual(h.ctx.creativeState.pending, null);
    h.advance(10000); h.settle(); h.throws("browser.commit");
    assert.equal(h.ctx.creativeMutationStatus().writesBlocked, true); assert.equal(h.calls.length, 1);
  }
});

test("filter target epoch excludes selected/hit updates and unrelated item mapping", () => {
  const h = harness(), before = h.rpc("browser.get_filter_items", ["category"]);
  h.rpc("browser.set_filter", ["category", 1, before.snapshotId]);
  h.columns.category.items[2].name().emit("Other filter changed");
  h.columns.category.items[1].hitCount().emit(2); h.columns.category.items[1].isSelected().emit(true); h.settle();
  assert.equal(h.ctx.creativeState.pending, null);
  const next = h.rpc("browser.get_filter_items", ["category"]);
  h.rpc("browser.scroll_filter_items", ["category", "forward", next.snapshotId]);
  h.columns.category.bank.scrollPosition().emit(16); h.settle(); assert.equal(h.ctx.creativeState.pending, null);
});
test("wildcard clearing and page scrolling require fresh bounded observations", () => {
  const h = harness(); h.columns.category.wildcard.isSelected().emit(false); h.settle();
  const before = h.rpc("browser.get_filter_items", ["category"]); h.rpc("browser.set_filter", ["category", -1, before.snapshotId]);
  assert.deepEqual(h.calls, [["category-1.isSelected", true]]); h.columns.category.wildcard.isSelected().emit(true); h.settle();
  const next = h.rpc("browser.get_filter_items", ["category"]); h.rpc("browser.scroll_filter_items", ["category", "forward", next.snapshotId]);
  assert.deepEqual(h.calls[1], ["category.scrollPageForwards"]); h.columns.category.bank.scrollPosition().update(16); h.settle(); h.throws("browser.get_filter_items", ["category"]);
  h.columns.category.bank.scrollPosition().notify(); h.settle(); assert.equal(h.rpc("browser.get_filter_items", ["category"]).coverage.scrollPosition, 16);
});
test("empty browser column permits offset -1 without pretending missing items exist", () => {
  const h = harness(); h.columns.tag.column.entryCount().emit(0); h.columns.tag.bank.itemCount().emit(0); h.columns.tag.bank.scrollPosition().emit(-1); h.columns.tag.items.forEach((item: any) => item.exists().emit(false)); h.settle();
  const read = h.rpc("browser.get_filter_items", ["tag"]); assert.equal(read.coverage.entryCount, 0); assert.equal(read.coverage.scrollPosition, -1); assert.equal(read.items.filter((item: any) => item.exists).length, 0);
});
test("legacy result selection has no extra-next heuristic and commit needs one settled selected result", () => {
  const h = harness(); h.rpc("browser.select_result", [1]); assert.deepEqual(h.calls, [["result1.isSelected", true]]);
  h.resultItems[0].isSelected().emit(false); h.resultItems[1].isSelected().emit(true); h.settle();
  const commit = h.rpc("browser.commit"); assert.equal(commit.postcondition, "browser_closed_only"); assert.equal(commit.insertionVerified, false);
  assert.deepEqual(h.calls[1], ["browser.commit"]); h.browser.exists().emit(false); h.settle(); assert.equal(h.rpc("browser.get_status").exists, false);
  const other = harness(); other.resultItems[1].isSelected().emit(true); other.settle(); other.throws("browser.commit"); assert.deepEqual(other.calls, []);
});

test("browser result selection cannot confirm against replaced result identity, including ABA", () => {
  for (const field of ["name", "exists", "offset", "filter", "content", "count"]) for (const returnToOriginal of [false, true]) {
    const h = harness(); h.rpc("browser.select_result", [1]);
    const value = field === "name" ? h.resultItems[1].name() : field === "exists" ? h.resultItems[1].exists() :
      field === "offset" ? h.resultBank.scrollPosition() : field === "filter" ? h.columns.tag.items[1].isSelected() :
      field === "content" ? h.browser.selectedContentTypeIndex() : h.browser.resultsColumn().entryCount();
    const initial = value.get(), replacement = field === "name" ? "Unrelated preset" : field === "exists" ? false : field === "filter" ? true : field === "count" ? 4 : 1;
    value.emit(replacement); if (returnToOriginal) value.emit(initial);
    h.resultItems[0].isSelected().emit(false); h.resultItems[1].isSelected().emit(true); h.settle();
    assert.notEqual(h.ctx.creativeState.pending, null);
    h.advance(10000); h.settle(); h.throws("browser.commit");
    assert.equal(h.ctx.creativeMutationStatus().writesBlocked, true); assert.equal(h.calls.length, 1);
  }
});

test("first query callback after cache-based selection preserves identity transitions", () => {
  for (const field of ["filter", "content", "count", "offset", "resultName", "resultExists"]) {
    const h = harness({ observe: false }); h.browser.exists().notify(); h.settle();
    h.rpc("browser.select_result", [1]);
    const value = field === "filter" ? h.columns.tag.items[1].isSelected() : field === "content" ? h.browser.selectedContentTypeIndex() :
      field === "count" ? h.browser.resultsColumn().entryCount() : field === "offset" ? h.resultBank.scrollPosition() :
      field === "resultName" ? h.resultItems[1].name() : h.resultItems[1].exists();
    const replacement = field === "filter" ? true : field === "resultExists" ? false : field === "resultName" ? "Replacement" : field === "count" ? 4 : 1;
    value.emit(replacement); h.resultItems[1].isSelected().emit(true); h.settle();
    assert.notEqual(h.ctx.creativeState.pending, null);
    h.advance(10000); h.settle(); h.throws("browser.commit"); assert.equal(h.calls.length, 1);
  }
});

test("interested change-detector seed is not callback evidence and equal first callback is stable", () => {
  const h = harness({ observe: false }); h.browser.exists().notify(); h.settle();
  assert.equal(h.ctx.creativeState.browser.seen.contentIndex, undefined);
  assert.equal(h.ctx.creativeState.browserQueryEpoch, 0);
  h.rpc("browser.select_result", [1]);
  h.columns.tag.items[1].isSelected().notify(); h.browser.selectedContentTypeIndex().notify();
  h.resultItems[1].name().notify(); h.resultItems[1].exists().notify();
  assert.equal(h.ctx.creativeState.browserQueryEpoch, 0); assert.equal(h.ctx.creativeState.browserResultsEpoch, 0);
  h.resultItems[0].isSelected().emit(false); h.resultItems[1].isSelected().emit(true); h.settle();
  assert.equal(h.ctx.creativeState.pending, null);
});

test("unavailable initial getter makes the first identity callback during a mutation conservative", () => {
  const h = harness(), callbacks: Array<() => void> = []; let readable = false, changed = 0;
  const value = { get() { if (!readable) throw new Error("unavailable initial value"); return "new target"; }, addValueObserver(callback: () => void) { callbacks.push(callback); } };
  h.ctx.creativeObserveChange(value, () => { changed += 1; });
  h.rpc("browser.select_result", [1]); readable = true; callbacks[0](); assert.equal(changed, 1);
  callbacks[0](); assert.equal(changed, 1);
});

test("browser navigation cannot confirm a matching position after query changes away and back", () => {
  const h = harness(); h.rpc("browser.select_next_file");
  h.columns.tag.items[1].isSelected().emit(true); h.columns.tag.items[1].isSelected().emit(false);
  h.resultItems[0].isSelected().emit(false); h.resultItems[1].isSelected().emit(true); h.settle();
  assert.notEqual(h.ctx.creativeState.pending, null); h.advance(10000); h.settle(); h.throws("browser.commit");
});

test("browser selection callbacks alone preserve result identity and commit claims closure only", () => {
  const h = harness(), epoch = h.ctx.creativeState.browserResultsEpoch;
  h.rpc("browser.select_result", [1]); h.resultItems[0].isSelected().emit(false); h.resultItems[1].isSelected().emit(true); h.settle();
  assert.equal(h.ctx.creativeState.browserResultsEpoch, epoch); assert.equal(h.ctx.creativeState.pending, null);
  const commit = h.rpc("browser.commit");
  assert.equal(commit.verified, false); assert.equal(commit.insertionVerified, false); assert.equal(commit.postcondition, "browser_closed_only");
  // Clearing result proxies is a normal consequence of closing, not evidence of insertion.
  h.resultItems.forEach((item: any) => { item.exists().emit(false); item.name().emit(""); });
  h.browser.resultsColumn().entryCount().emit(0); h.browser.exists().emit(false); h.settle();
  assert.equal(h.ctx.creativeState.pending, null); assert.equal(commit.insertionVerified, false);
});
test("remote page selection validates count and snapshot and blocks writes to old page", () => {
  const h = harness(), pages = h.rpc("device.remote_pages_get");
  assert.equal(pages.pageCount, 2); h.throws("device.remote_page_select", [2, pages.snapshotId], -32602); assert.deepEqual(h.calls, []);
  h.rpc("device.remote_page_select", [1, pages.snapshotId]); assert.deepEqual(h.calls, [["remote.selectedPageIndex", 1]]);
  h.remote.selectedPageIndex().update(1); h.parameters[0].value().notify(); h.settle(); h.throws("device.set_remote_control", [0, 0.9]);
  h.remote.selectedPageIndex().notify(); h.settle(); assert.equal(h.rpc("device.remote_pages_get").selectedPageIndex, 1);
  h.throws("device.remote_page_select", [0, pages.snapshotId]);
  assert.equal(h.rpc("device.get_remote_controls")[0].available, true);
  assert.equal(h.rpc("device.get_remote_controls")[1].observation.source, "interested_host_cache");
  h.rpc("device.set_remote_control", [0, 0.9]); assert.deepEqual(h.calls[1], ["param0.value.setImmediately", 0.9]);
  h.parameters[0].value().emit(0.9); h.settle(); assert.equal(h.rpc("device.get_remote_controls")[0].value, 0.9);
});
test("remote legacy next/previous use observed bounded pages and unchanged state is a no-op", () => {
  const h = harness(); const pages = h.rpc("device.remote_pages_get");
  assert.equal(h.rpc("device.remote_page_select", [0, pages.snapshotId]).status, "unchanged"); assert.deepEqual(h.calls, []);
  h.rpc("device.page_previous"); assert.deepEqual(h.calls, [["remote.selectedPageIndex", 1]]);
});
test("loop setters prevalidate, require stopped transport, and observe every changed field", () => {
  const h = harness(), before = h.rpc("transport.get_arranger_loop");
  for (const args of [[true, -1, 16, before.snapshotId], [true, 0, 0, before.snapshotId], [true, 1048576, 1, before.snapshotId], ["yes", 0, 16, before.snapshotId]]) h.throws("transport.set_arranger_loop", args, -32602);
  h.transport.isPlaying().emit(true); h.throws("transport.set_arranger_loop", [true, 4, 8, before.snapshotId]); h.transport.isPlaying().emit(false);
  assert.deepEqual(h.calls, []); const result = h.rpc("transport.set_arranger_loop", [true, 4, 8, before.snapshotId]); assert.equal(result.dispatchedCount, 3);
  h.transport.arrangerLoopStart().emit(4); h.transport.arrangerLoopDuration().update(8); h.transport.isArrangerLoopEnabled().emit(true); h.settle(); h.throws("transport.get_arranger_loop");
  h.transport.arrangerLoopDuration().notify(); h.settle(); assert.equal(h.rpc("transport.get_arranger_loop").endBeats, 12);
});
test("partial loop exception retains honest dispatch count and cannot auto-retry", () => {
  const h = harness(), before = h.rpc("transport.get_arranger_loop"); h.transport.arrangerLoopDuration().throwSet = true;
  const result = h.rpc("transport.set_arranger_loop", [true, 4, 8, before.snapshotId]); assert.equal(result.status, "partial"); assert.equal(result.dispatchedCount, 1); assert.equal(result.totalCount, 3); assert.equal(h.calls.length, 2);
  h.settle(); h.throws("transport.set_arranger_loop", [true, 4, 8, before.snapshotId]); assert.equal(h.calls.length, 2);
});

test("filtered browser reads use the interested host cache after binding settles without identical callbacks", () => {
  const h = harness(), filter = h.rpc("browser.get_filter_items", ["category"]);
  h.rpc("browser.set_filter", ["category", 1, filter.snapshotId]); h.columns.category.items[1].isSelected().emit(true); h.settle();
  const result = h.rpc("browser.list_results"); assert.equal(result[0].available, true); assert.equal(result[0].exists, true);
  assert.equal(result[0].observation.source, "interested_host_cache");
  assert.equal(h.ctx.creativeState.browser.seen["result.0.selected"], false);
  h.rpc("browser.commit"); assert.deepEqual(h.calls[1], ["browser.commit"]);
});
test("uncertain mutation diagnostics reject changed identity and require settled observations", () => {
  const h = harness(), read = h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]); h.note.throwKey = "pressure";
  h.rpc("clip.set_note_expressions", [0, 0, read.snapshotId, [{ ...coordinate, pan: -1, pressure: 1 }]]);
  h.throws("clip.get_note_expressions", [0, 0, [coordinate]]); h.settle();
  assert.ok(h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]));
  h.deselectClip(); h.throws("clip.get_note_expressions", [0, 0, [coordinate]]);
});

test("external page changes expire snapshots while unchanged interested controls remain readable", () => {
  const h = harness(), old = h.rpc("device.remote_pages_get"); h.remote.selectedPageIndex().emit(1);
  h.throws("device.get_remote_controls"); h.settle();
  assert.equal(h.rpc("device.remote_pages_get").selectedPageIndex, 1);
  h.throws("device.remote_page_select", [0, old.snapshotId]);
  assert.equal(h.rpc("device.get_remote_controls")[0].available, true);
  assert.equal(h.ctx.creativeState.remote.seen["0.value"], false);
});

test("external device identity change revokes old tokens while unchanged pages read after settling", () => {
  const h = harness(), old = h.rpc("device.remote_pages_get"); h.device.name().emit("Other Synth");
  h.throws("device.remote_pages_get"); h.throws("device.set_remote_control", [0, 0.8]); h.settle();
  h.throws("device.remote_page_select", [1, old.snapshotId]);
  assert.equal(h.rpc("device.remote_pages_get").deviceName, "Other Synth"); assert.equal(h.rpc("device.get_remote_controls")[0].available, true);
});
test("external filter and bank changes require settling but no duplicate unchanged item callback", () => {
  const h = harness(); h.columns.tag.items[1].isSelected().emit(true);
  h.throws("browser.list_results"); h.settle(); assert.equal(h.rpc("browser.list_results")[0].available, true);
  const f = harness(), old = f.rpc("browser.get_filter_items", ["category"]); f.columns.category.bank.scrollPosition().emit(16);
  f.throws("browser.get_filter_items", ["category"]); f.settle();
  const read = f.rpc("browser.get_filter_items", ["category"]); assert.equal(read.items[0].available, true); f.throws("browser.set_filter", ["category", 0, old.snapshotId]);
});
test("browser navigation boundaries produce no host call or permanent pending barrier", () => {
  const h = harness(); assert.equal(h.rpc("browser.select_previous_file").status, "unchanged"); assert.equal(h.rpc("browser.select_first_file").status, "unchanged");
  h.resultItems[0].isSelected().emit(false); h.resultItems[2].isSelected().emit(true); h.settle();
  assert.equal(h.rpc("browser.select_next_file").status, "unchanged"); assert.deepEqual(h.calls, []); assert.equal(h.ctx.creativeState.pending, null);
});
test("browser first and next compare absolute result position across scrolling windows", () => {
  const h = harness(); h.browser.resultsColumn().entryCount().emit(100); h.resultBank.scrollPosition().emit(32);
  h.resultItems.forEach((item: any) => { item.exists().notify(); item.name().notify(); item.isSelected().notify(); }); h.settle();
  h.rpc("browser.select_first_file"); assert.deepEqual(h.calls, [["browser.selectFirstFile"]]);
  h.resultBank.scrollPosition().emit(0); h.resultItems[0].exists().notify(); h.resultItems[0].name().notify(); h.resultItems[0].isSelected().notify(); h.settle(); assert.equal(h.ctx.creativeState.pending, null);
  const next = harness(); next.browser.resultsColumn().entryCount().emit(100); next.resultBank.scrollPosition().emit(31);
  next.resultItems.forEach((item: any) => { item.exists().notify(); item.name().notify(); item.isSelected().notify(); }); next.settle();
  next.rpc("browser.select_next_file"); next.resultBank.scrollPosition().emit(32); next.resultItems[0].exists().notify(); next.resultItems[0].isSelected().notify(); next.settle();
  assert.equal(next.ctx.creativeState.pending, null); assert.deepEqual(next.calls, [["browser.selectNextFile"]]);
});
test("contradictory browser counts and existence fail before mutation", () => {
  const h = harness(); h.columns.category.column.entryCount().emit(1); h.columns.category.bank.itemCount().emit(1); h.settle(); h.throws("browser.get_filter_items", ["category"]); assert.deepEqual(h.calls, []);
  const r = harness(); r.browser.resultsColumn().entryCount().emit(1); r.resultItems[2].exists().notify(); r.resultItems[2].name().notify(); r.resultItems[2].isSelected().notify(); r.settle();
  r.throws("browser.select_result", [2]); assert.deepEqual(r.calls, []);
});

test("filter bank coverage includes the host wildcard without adding one to column entries", () => {
  const h = harness(), category = h.columns.category;
  category.column.entryCount().emit(27); category.bank.itemCount().emit(28);
  category.items.forEach((item: any) => item.exists().emit(true)); h.settle();
  const before = h.rpc("browser.get_filter_items", ["category"]);
  assert.equal(before.coverage.entryCount, 27); assert.equal(before.coverage.bankItemCount, 28);
  assert.equal(before.coverage.countSource, "bank.itemCount");
  h.rpc("browser.scroll_filter_items", ["category", "forward", before.snapshotId]);
  // Host may clamp the final full window to 28 - 16 = 12, rather than 16.
  category.bank.scrollPosition().emit(12); h.settle();
  const last = h.rpc("browser.get_filter_items", ["category"]);
  assert.equal(last.items[15].exists, true); assert.equal(last.coverage.scrollPosition, 12);
  assert.equal(last.coverage.complete, false); assert.equal(h.ctx.creativeState.pending, null);
  category.bank.scrollPosition().emit(16);
  category.items.forEach((item: any, index: number) => item.exists().emit(index < 12)); h.settle();
  const partial = h.rpc("browser.get_filter_items", ["category"]);
  assert.equal(partial.items[11].exists, true); assert.equal(partial.items[12].exists, false);
  category.items[12].exists().emit(true); h.settle();
  assert.throws(() => h.rpc("browser.get_filter_items", ["category"]), /offset=16, index=12, bankItemCount=28, columnEntryCount=27/);
});

test("filter coverage completeness follows bank count, including wildcard-only and alternate layouts", () => {
  const h = harness(), column = h.columns.category;
  column.column.entryCount().emit(16); column.bank.itemCount().emit(17);
  column.items.forEach((item: any) => item.exists().emit(true)); h.settle();
  assert.equal(h.rpc("browser.get_filter_items", ["category"]).coverage.complete, false);
  // A folder-like bank can expose a total unrelated to column.entryCount().
  column.column.entryCount().emit(0); column.bank.itemCount().emit(4);
  column.items.forEach((item: any, index: number) => item.exists().emit(index < 4)); h.settle();
  assert.equal(h.rpc("browser.get_filter_items", ["category"]).coverage.bankItemCount, 4);
  assert.equal(h.rpc("browser.get_filter_items", ["category"]).coverage.complete, true);
  column.bank.itemCount().emit(1); column.items.forEach((item: any, index: number) => item.exists().emit(index === 0)); h.settle();
  const wildcardOnly = h.rpc("browser.get_filter_items", ["category"]);
  assert.equal(wildcardOnly.coverage.entryCount, 0); assert.equal(wildcardOnly.coverage.bankItemCount, 1);
  assert.equal(wildcardOnly.items[0].exists, true); assert.equal(wildcardOnly.coverage.complete, true);
  column.bank.itemCount().emit(-1); h.settle(); h.throws("browser.get_filter_items", ["category"]);
});

test("browser navigation cannot release on an unobserved offset getter change", () => {
  const h = harness(); h.browser.resultsColumn().entryCount().emit(100);
  h.resultItems.forEach((item: any) => { item.exists().notify(); item.name().notify(); item.isSelected().notify(); }); h.settle();
  h.rpc("browser.select_next_file"); h.resultBank.scrollPosition().update(1); h.resultItems[0].isSelected().notify(); h.settle();
  assert.notEqual(h.ctx.creativeState.pending, null); h.resultBank.scrollPosition().notify();
  h.resultItems[0].exists().notify(); h.resultItems[0].isSelected().notify(); h.settle(); assert.equal(h.ctx.creativeState.pending, null);
});


test("silent expression host becomes explicitly uncertain after ten seconds without releasing writes", () => {
  const h = harness(), read = h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]);
  h.rpc("clip.set_note_expressions", [0, 0, read.snapshotId, [{ ...coordinate, pan: -0.25, pressure: 0.2 }]]);
  h.noteValues.pan = -0.25; h.noteNotify(); h.settle();
  h.advance(9999); h.settle(); h.throws("clip.get_note_expressions", [0, 0, [coordinate]]);
  assert.equal(h.ctx.creativeMutationStatus().status, "awaiting_observation");
  assert.doesNotThrow(() => h.ctx.guardCreativeLegacyRequest("transport.getIsPlaying", []));
  assert.equal(h.rpc("browser.get_status").mutation.group, "notes");
  h.advance(1); h.settle();
  const diagnostics = h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]);
  assert.equal(diagnostics.notes[0].pan, -0.25); assert.equal(diagnostics.notes[0].pressure, 0);
  assert.equal(diagnostics.mutation.status, "uncertain");
  assert.equal(diagnostics.mutation.reason, "observation_timeout");
  assert.equal(diagnostics.mutation.verified, false); assert.equal(diagnostics.mutation.writesBlocked, true);
  h.throws("clip.set_note_expressions", [0, 0, diagnostics.snapshotId, [{ ...coordinate, pressure: 0.2 }]]);
  h.throws("device.remote_page_select", [1, "anything"]);
  h.throws("application.undo"); h.throws("browser.commit");
  // A late matching callback cannot silently reopen a failed mutation barrier.
  h.noteValues.pressure = 0.2; h.noteNotify(); h.settle();
  assert.equal(h.ctx.creativeMutationStatus().status, "uncertain"); assert.equal(h.calls.length, 2);
  h.deselectClip(); h.throws("clip.get_note_expressions", [0, 0, [coordinate]]);
  assert.doesNotThrow(() => h.ctx.guardCreativeLegacyRequest("project.get_status", []));
});

test("timeout also expires on a request when no further flush or host callback arrives", () => {
  const h = harness(), pages = h.rpc("device.remote_pages_get");
  h.rpc("device.remote_page_select", [1, pages.snapshotId]);
  h.advance(10000);
  assert.throws(() => h.ctx.guardCreativeLegacyRequest("device.set_remote_control", [0, 0.4]), /observation_timeout/);
  assert.equal(h.ctx.creativeMutationStatus().writesBlocked, true);
  assert.doesNotThrow(() => h.ctx.guardCreativeLegacyRequest("transport.stop", []));
  assert.doesNotThrow(() => h.ctx.guardCreativeLegacyRequest("note_input.all_notes_off", []));
});

test("browser cancel requires observed session only, with unavailable result metadata", () => {
  const h = harness();
  h.ctx.creativeInvalidate("browser", ["results.count", "results.offset", "title", "contentTypes", "contentName"]);
  h.ctx.creativeInvalidateResults();
  // Unreadable host getters remain errors; callback absence alone is not one.
  h.browser.title().update(undefined); h.browser.resultsColumn().entryCount().update(undefined);
  h.throws("browser.get_status"); h.throws("browser.list_results"); h.throws("browser.commit");
  assert.equal(h.rpc("browser.cancel").status, "dispatched");
  assert.deepEqual(h.calls, [["browser.cancel"]]);
  h.browser.exists().emit(false); h.settle();
  assert.equal(h.ctx.creativeState.pending, null);
  assert.equal(h.rpc("browser.get_status").exists, false);
  const unknown = harness({ observe: false }); unknown.settle(); unknown.throws("browser.cancel"); assert.deepEqual(unknown.calls, []);
});


test("remote absolute parameter writes bypass takeover but still require observed readback", () => {
  const h = harness();
  // Normal set() can be pickup-gated; this mock records a distinct immediate path.
  const result = h.rpc("device.set_remote_control", [0, 0.7]);
  assert.equal(result.status, "dispatched"); assert.equal(result.verified, false);
  assert.deepEqual(h.calls, [["param0.value.setImmediately", 0.7]]);
  h.parameters[0].value().update(0.7); h.settle(); h.throws("device.get_remote_controls");
  h.parameters[0].value().notify(); h.settle();
  assert.equal(h.rpc("device.get_remote_controls")[0].value, 0.7);
  assert.equal(h.ctx.creativeState.pending, null);
  const invalid = harness(); invalid.throws("device.set_remote_control", [0, 1.1], -32602);
  assert.deepEqual(invalid.calls, []);
});

test("initial unchanged browser fields can be read only after a real session callback and settling", () => {
  const h = harness({ observe: false }); h.settle(); h.throws("browser.get_status");
  h.browser.exists().notify(); h.throws("browser.get_status"); h.settle();
  const read = h.rpc("browser.get_status"); assert.equal(read.exists, true); assert.equal(read.selectedContentTypeIndex, 0);
  assert.equal(read.observation.source, "interested_host_cache");
  assert.equal(h.ctx.creativeState.browser.seen.contentIndex, undefined);
  assert.equal(h.rpc("browser.list_results")[0].available, true);
});

test("current remote reads preserve genuine zero without forging callback evidence", () => {
  const h = harness({ observe: false });
  h.device.exists().notify(); h.device.name().notify(); h.device.position().notify(); h.track.position().notify();
  h.parameters[0].value().update(0); h.settle();
  const controls = h.rpc("device.get_remote_controls"); assert.equal(controls[0].value, 0);
  assert.equal(controls[0].observation.mutationConfirmation, "changed_field_callback_required");
  assert.equal(h.ctx.creativeState.remote.seen["0.value"], undefined);
  h.rpc("device.set_remote_control", [0, 0.6]);
  h.parameters[0].value().update(0.6); h.parameters[1].name().notify(); h.settle();
  h.throws("device.get_remote_controls"); assert.notEqual(h.ctx.creativeState.pending, null);
  h.parameters[0].value().notify(); h.settle(); assert.equal(h.ctx.creativeState.pending, null);
});

test("missing remote parameter cannot become writable through cached defaults", () => {
  const h = harness(); h.parameters[0].exists().emit(false); h.settle();
  assert.equal(h.rpc("device.get_remote_controls")[0].available, false);
  h.throws("device.set_remote_control", [0, 0.6]); assert.deepEqual(h.calls, []);
});

test("remote pending mutation cannot verify against a replaced same-position device", () => {
  const h = harness(); h.rpc("device.set_remote_control", [0, 0.6]);
  h.device.name().emit("Replacement"); h.parameters[0].value().emit(0.6); h.settle();
  assert.notEqual(h.ctx.creativeState.pending, null); h.advance(10000); h.settle();
  h.throws("device.get_remote_controls"); assert.equal(h.ctx.creativeMutationStatus().writesBlocked, true);
});

test("remote parameter and page writes reject binding ABA despite a matching final tuple", () => {
  for (const mutation of ["parameter", "page"]) for (const field of ["name", "devicePosition", "trackPosition", "exists"]) {
    const h = harness(), pages = h.rpc("device.remote_pages_get");
    if (mutation === "parameter") h.rpc("device.set_remote_control", [0, 0.6]);
    else h.rpc("device.remote_page_select", [1, pages.snapshotId]);
    const value = field === "name" ? h.device.name() : field === "devicePosition" ? h.device.position() : field === "trackPosition" ? h.track.position() : h.device.exists();
    const before = value.get(), other = field === "name" ? "Replacement" : field === "exists" ? false : 7;
    const epoch = h.ctx.creativeState.remoteBindingEpoch;
    value.emit(other); value.emit(before);
    assert.equal(h.ctx.creativeState.remoteBindingEpoch, epoch + 2);
    if (mutation === "parameter") h.parameters[0].value().emit(0.6);
    else h.remote.selectedPageIndex().emit(1);
    h.settle(); assert.notEqual(h.ctx.creativeState.pending, null);
    h.advance(10000); h.settle();
    assert.equal(h.ctx.creativeMutationStatus().writesBlocked, true);
    h.throws("device.get_remote_controls"); h.throws("device.remote_pages_get");
    h.throws("device.set_remote_control", [0, 0.2]);
    assert.equal(h.calls.length, 1);
  }
});

test("remote page/value updates and repeated equal identity callbacks do not advance binding epoch", () => {
  const h = harness(), epoch = h.ctx.creativeState.remoteBindingEpoch;
  const pages = h.rpc("device.remote_pages_get"); h.rpc("device.remote_page_select", [1, pages.snapshotId]);
  h.device.name().notify(); h.device.exists().notify(); h.device.position().notify(); h.track.position().notify();
  h.remote.selectedPageIndex().emit(1); h.parameters[0].value().emit(0.3); h.settle();
  assert.equal(h.ctx.creativeState.remoteBindingEpoch, epoch); assert.equal(h.ctx.creativeState.pending, null);
  h.rpc("device.set_remote_control", [0, 0.6]); h.parameters[0].value().emit(0.6); h.settle();
  assert.equal(h.ctx.creativeState.remoteBindingEpoch, epoch); assert.equal(h.ctx.creativeState.pending, null);
});

test("remote parameter mutation rejects page and mapping replacement, including ABA", () => {
  for (const field of ["page", "name", "exists"]) for (const returnToOriginal of [false, true]) {
    const h = harness(); h.rpc("device.set_remote_control", [0, 0.6]);
    const value = field === "page" ? h.remote.selectedPageIndex() : field === "name" ? h.parameters[0].name() : h.parameters[0].exists();
    const before = value.get(), other = field === "page" ? 1 : field === "name" ? "Different target" : false;
    const epoch = h.ctx.creativeState.remoteParameterEpochs[0];
    value.emit(other); if (returnToOriginal) value.emit(before);
    assert.equal(h.ctx.creativeState.remoteParameterEpochs[0], epoch + (returnToOriginal ? 2 : 1));
    h.parameters[0].value().emit(0.6); h.settle(); assert.notEqual(h.ctx.creativeState.pending, null);
    h.advance(10000); h.settle(); h.throws("device.get_remote_controls"); h.throws("device.set_remote_control", [0, 0.2]);
    assert.equal(h.ctx.creativeMutationStatus().writesBlocked, true); assert.equal(h.calls.length, 1);
  }
});

test("remote mapping epoch is per parameter and page selection can confirm its intended change", () => {
  const h = harness(), pages = h.rpc("device.remote_pages_get");
  h.rpc("device.remote_page_select", [1, pages.snapshotId]); h.remote.selectedPageIndex().emit(1);
  h.parameters[0].name().emit("New page mapping"); h.settle(); assert.equal(h.ctx.creativeState.pending, null);
  const epoch = h.ctx.creativeState.remoteParameterEpochs[0]; h.rpc("device.set_remote_control", [0, 0.6]);
  h.parameters[0].name().notify(); h.parameters[0].exists().notify();
  h.parameters[1].name().emit("Other control remapped"); h.parameters[0].value().emit(0.6); h.settle();
  assert.equal(h.ctx.creativeState.remoteParameterEpochs[0], epoch); assert.equal(h.ctx.creativeState.pending, null);
});

test("first mapping identity callback cannot confirm a write to a different cached target", () => {
  for (const field of ["name", "exists"]) {
    const h = harness({ observe: false });
    h.device.exists().notify(); h.device.name().notify(); h.device.position().notify(); h.track.position().notify(); h.settle();
    h.rpc("device.set_remote_control", [0, 0.6]);
    if (field === "name") h.parameters[0].name().emit("Replacement"); else h.parameters[0].exists().emit(false);
    h.parameters[0].value().emit(0.6); h.settle(); assert.notEqual(h.ctx.creativeState.pending, null);
    h.advance(10000); h.settle(); h.throws("device.get_remote_controls"); assert.equal(h.ctx.creativeMutationStatus().writesBlocked, true);
  }
  const f = harness({ observe: false }); f.browser.exists().notify(); f.settle();
  const before = f.rpc("browser.get_filter_items", ["category"]); f.rpc("browser.set_filter", ["category", 1, before.snapshotId]);
  f.columns.category.column.name().emit("Replacement column"); f.columns.category.items[1].isSelected().emit(true); f.settle();
  assert.notEqual(f.ctx.creativeState.pending, null);
});

test("known host pressure defect reports null and rejects a mixed batch before any setter", () => {
  for (const version of ["6.1.1", "6.1.1 (build test)", "Bitwig Studio 6.1.1"]) {
    const h = harness({ hostVersion: version }), read = h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]);
    assert.equal(read.notes[0].pressure, null); assert.equal(read.notes[0].velocity, 0.8);
    assert.equal(read.expressionCapabilities.hostVersion, version);
    assert.equal(read.expressionCapabilities.pressure.readable, false);
    assert.equal(read.expressionCapabilities.pressure.writable, false);
    h.throws("clip.set_note_expressions", [0, 0, read.snapshotId, [{ ...coordinate, pan: -0.25, pressure: 0.2 }]]);
    assert.deepEqual(h.calls, []); assert.equal(h.ctx.creativeState.pending, null);
    h.rpc("clip.set_note_expressions", [0, 0, read.snapshotId, [{ ...coordinate, pan: -0.25 }]]);
    h.noteValues.pan = -0.25; h.noteNotify(); h.settle();
    assert.equal(h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]).notes[0].pan, -0.25);
    assert.equal(h.ctx.creativeState.pending, null);
  }
});

test("pressure limitation is release-specific and never trusts local setter echo on other hosts", () => {
  for (const version of ["6.1.0", "6.1.10", "6.2.0", "unknown"]) {
    const h = harness({ hostVersion: version }), read = h.rpc("clip.get_note_expressions", [0, 0, [coordinate]]);
    assert.equal(read.expressionCapabilities.pressure.readable, true);
    h.rpc("clip.set_note_expressions", [0, 0, read.snapshotId, [{ ...coordinate, pressure: 0.3 }]]);
    h.noteValues.pressure = 0.3; h.settle(); assert.notEqual(h.ctx.creativeState.pending, null);
    h.noteNotify(); h.settle(); assert.equal(h.ctx.creativeState.pending, null);
  }
});

test("creative diagnostics never label uninitialized, unbound or settling observations as stable", () => {
  const uninitialized = harness({ initialize: false });
  const empty = uninitialized.ctx.creativeObservationDiagnostics();
  assert.equal(empty.browser.bindingObserved, false); assert.equal(empty.browser.settled, false);
  const h = harness({ observe: false }); h.settle();
  assert.equal(h.ctx.creativeObservationDiagnostics().remote.bindingObserved, false);
  h.browser.exists().notify();
  const pending = h.ctx.creativeObservationDiagnostics();
  assert.equal(pending.browser.bindingObserved, true); assert.equal(pending.browser.settled, false);
  h.settle(); assert.equal(h.ctx.creativeObservationDiagnostics().browser.settled, true);
  h.browser.exists().emit(false); assert.equal(h.ctx.creativeObservationDiagnostics().browser.settled, false);
});
