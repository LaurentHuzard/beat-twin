// @ts-nocheck
// Concatenated with BeatTwin.control.ts. Runtime syntax intentionally stays ES5.
var creativeState = null;
var creativeColumns = ["smartCollection", "location", "device", "category", "tag", "deviceType", "fileType", "creator"];
var creativeExpressionLimits = { velocity: [0, 1], releaseVelocity: [0, 1], pan: [-1, 1], timbre: [-1, 1], pressure: [0, 1], gain: [0, 1], transpose: [-96, 96] };

function creativeGroup() { return { version: 0, flushed: -1, settled: -1, seen: {}, callbacks: 0 }; }
function creativeChanged(group, key, identityChange) {
  var state = creativeState[group];
  state.seen[key] = true; state.callbacks += 1;
  if (identityChange !== false) { state.version += 1; state.settled = -1; }
}
function creativeWatch(value, group, key, identityChange) {
  value.markInterested();
  value.addValueObserver(function () { creativeChanged(group, key, identityChange); });
}
function creativeWatchItem(item, prefix, filter) {
  creativeWatch(item.exists(), "browser", prefix + ".exists");
  creativeWatch(item.name(), "browser", prefix + ".name");
  creativeWatch(item.isSelected(), "browser", prefix + ".selected");
  if (filter) {
    creativeWatch(item.hitCount(), "browser", prefix + ".hits");
    creativeObserveChange(item.isSelected(), function () { creativeInvalidateResults(); });
  }
}
function creativeObserveChange(value, changed) {
  var initialized = false, previous;
  value.addValueObserver(function () {
    var current = value.get();
    if (initialized && current !== previous) changed();
    previous = current; initialized = true;
  });
}
function creativeInvalidateFilterItems(name) {
  for (var i = 0; i < 16; i++) creativeInvalidate("browser", [name + "." + i + ".exists", name + "." + i + ".name", name + "." + i + ".selected", name + "." + i + ".hits"]);
}
function creativeWatchFilterOffset(bank, name) { creativeObserveChange(bank.scrollPosition(), function () { creativeInvalidateFilterItems(name); }); }
function initCreative() {
  creativeState = { browser: creativeGroup(), remote: creativeGroup(), loop: creativeGroup(), notes: creativeGroup(), columns: {}, pending: null, session: 0, projectEpoch: 0, lastBrowserExists: null, initialized: true };
  var browserValues = { exists: popupBrowser.exists(), title: popupBrowser.title(), contentTypes: popupBrowser.contentTypeNames(), contentIndex: popupBrowser.selectedContentTypeIndex(), contentName: popupBrowser.selectedContentTypeName() };
  for (var key in browserValues) creativeWatch(browserValues[key], "browser", key);
  popupBrowser.exists().addValueObserver(function (exists) {
    // Read the same interested proxy: JavaScript callback signatures vary by host.
    var current = popupBrowser.exists().get();
    if (current !== creativeState.lastBrowserExists) {
      if (creativeState.lastBrowserExists !== null) { creativeState.browser.seen = { exists: true }; }
      creativeState.session += 1; creativeState.lastBrowserExists = current;
    }
  });
  for (var c = 0; c < creativeColumns.length; c++) {
    var name = creativeColumns[c], column = popupBrowser[name + "Column"](), bank = column.createItemBank(16);
    creativeState.columns[name] = { column: column, bank: bank, wildcard: column.getWildcardItem() };
    creativeWatch(column.exists(), "browser", name + ".exists");
    creativeWatch(column.name(), "browser", name + ".name");
    creativeWatch(column.entryCount(), "browser", name + ".count");
    creativeWatch(bank.scrollPosition(), "browser", name + ".offset");
    creativeWatch(bank.canScrollForwards(), "browser", name + ".forward");
    creativeWatch(bank.canScrollBackwards(), "browser", name + ".backward");
    creativeWatchFilterOffset(bank, name);
    creativeWatchItem(column.getWildcardItem(), name + ".wildcard", true);
    for (var i = 0; i < 16; i++) creativeWatchItem(bank.getItemAt(i), name + "." + i, true);
  }
  creativeWatch(popupBrowser.resultsColumn().entryCount(), "browser", "results.count");
  creativeObserveChange(popupBrowser.resultsColumn().entryCount(), creativeInvalidateResults);
  creativeWatch(browserResultBank.scrollPosition(), "browser", "results.offset");
  browserResultBank.scrollPosition().addValueObserver(function () { creativeState.observedResultOffset = browserResultBank.scrollPosition().get(); });
  creativeObserveChange(browserResultBank.scrollPosition(), creativeInvalidateResults);
  creativeObserveChange(popupBrowser.selectedContentTypeIndex(), function () { creativeState.browser.seen = { exists: true, contentIndex: true }; });
  for (var r = 0; r < 32; r++) creativeWatchItem(browserResultBank.getItemAt(r), "result." + r, false);
  creativeWatch(remoteControlsBank.pageNames(), "remote", "names");
  creativeWatch(remoteControlsBank.pageCount(), "remote", "count");
  creativeWatch(remoteControlsBank.selectedPageIndex(), "remote", "index");
  var lastRemotePage = null;
  remoteControlsBank.selectedPageIndex().addValueObserver(function () {
    var current = remoteControlsBank.selectedPageIndex().get();
    if (lastRemotePage !== null && current !== lastRemotePage) creativeInvalidateRemoteControls();
    lastRemotePage = current;
  });
  creativeWatch(cursorDevice.exists(), "remote", "deviceExists");
  creativeWatch(cursorDevice.position(), "remote", "devicePosition");
  creativeWatch(cursorDevice.name(), "remote", "deviceName");
  creativeWatch(cursorTrack.position(), "remote", "trackPosition");
  var deviceBindingValues = [cursorDevice.exists(), cursorDevice.position(), cursorDevice.name(), cursorTrack.position()];
  for (var d = 0; d < deviceBindingValues.length; d++) creativeObserveChange(deviceBindingValues[d], function () { creativeInvalidate("remote", ["names", "count", "index"]); creativeInvalidateRemoteControls(); });
  for (var p = 0; p < 8; p++) {
    creativeWatch(remoteControlsBank.getParameter(p).name(), "remote", p + ".name");
    creativeWatch(remoteControlsBank.getParameter(p).value(), "remote", p + ".value", false);
  }
  creativeWatch(transport.isArrangerLoopEnabled(), "loop", "enabled");
  creativeWatch(transport.arrangerLoopStart(), "loop", "start");
  creativeWatch(transport.arrangerLoopDuration(), "loop", "duration");
  inspectionClip.addNoteStepObserver(function () { creativeChanged("notes", "grid"); });
  application.projectName().addValueObserver(function () {
    creativeState.session += 1; creativeState.projectEpoch += 1;
    for (var g = 0; g < 4; g++) { var group = creativeState[["browser", "remote", "loop", "notes"][g]]; group.version += 1; group.settled = -1; }
  });
}
function creativeError(message) { return bridgeError(-32004, message); }
function creativeHas(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function creativeNumber(value, min, max) { return typeof value === "number" && isFinite(value) && value >= min && value <= max; }
function creativeObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function creativeKeys(value, allowed) {
  if (!creativeObject(value)) throw invalidParams("Expected an object");
  for (var key in value) if (!creativeHas(value, key) || allowed.indexOf(key) < 0) throw invalidParams("Unexpected property: " + key);
}
function creativeObserved(group, key, value, type) {
  var state = creativeState[group];
  if (state.seen[key] !== true || state.settled !== state.version) throw creativeError("Creative " + group + " observations are unavailable or settling");
  var current = value.get();
  if (typeof current !== type || (type === "number" && !isFinite(current))) throw creativeError("Creative value is unavailable: " + key);
  return current;
}
function creativeInvalidate(group, keys) {
  for (var i = 0; i < keys.length; i++) creativeState[group].seen[keys[i]] = false;
}
function creativeSeen(group, keys) {
  for (var i = 0; i < keys.length; i++) if (creativeState[group].seen[keys[i]] !== true) return false;
  return true;
}
function creativeStringArray(value, max) {
  if (!value || !isIntegerInRange(value.length, 0, max)) throw creativeError("Observed string array is unavailable or exceeds bounds");
  var result = [];
  for (var i = 0; i < value.length; i++) { if (typeof value[i] !== "string") throw creativeError("Observed array entry is unavailable"); result.push(value[i]); }
  return result;
}
function creativeToken(group, extra) {
  var version = group === "notes" ? inspectionVersion : creativeState[group].version;
  return "creative:" + controllerInstanceId + ":" + group + ":" + creativeState.session + ":" + targetGeneration + ":" + version + ":" + (extra || "");
}
function creativeRequireToken(value, expected) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) throw invalidParams("snapshotId must be a nonempty string of at most 256 characters");
  if (value !== expected) throw creativeError("Creative snapshot is stale; inspect again before writing");
}
function creativeDispatch(operations, group, matches, identity) {
  if (operations.length === 0) return { status: "unchanged", dispatchedCount: 0, totalCount: 0, verified: false, requiresReadback: true };
  if (creativeState.pending) throw creativeError("Creative mutation is already pending");
  var state = creativeState[group];
  targetGeneration += 1; invalidateInspection();
  var operationIdentity = identity || function () { return true; }, projectEpoch = creativeState.projectEpoch;
  creativeState.pending = { group: group, beforeCallbacks: state.callbacks, matches: matches, identity: function () { return creativeState.projectEpoch === projectEpoch && operationIdentity(); }, failed: false };
  state.version += 1; state.settled = -1;
  var dispatched = 0;
  try {
    for (var i = 0; i < operations.length; i++) { operations[i](); dispatched += 1; }
  } catch (error) {
    creativeState.pending.failed = true;
    return { status: "partial", dispatchedCount: dispatched, totalCount: operations.length, verified: false, requiresReadback: true, uncertain: true, recovery: "readback_then_reload_controller", error: safeHostError(error) };
  }
  return { status: "dispatched", dispatchedCount: dispatched, totalCount: operations.length, verified: false, requiresReadback: true };
}
function flushCreative() {
  if (!creativeState || !creativeState.initialized) return;
  for (var i = 0; i < 4; i++) {
    var state = creativeState[["browser", "remote", "loop", "notes"][i]];
    if (state.flushed === state.version) state.settled = state.version;
    state.flushed = state.version;
  }
  var pending = creativeState.pending;
  if (pending && !pending.failed) {
    var group = creativeState[pending.group];
    try {
      if (group.callbacks > pending.beforeCallbacks && group.settled === group.version && pending.identity() && pending.matches()) creativeState.pending = null;
    } catch (unavailable) { /* Keep the mutation barrier until observed outcome. */ }
  }
}
function isCreativeReadMethod(method) {
  return method === "clip.get_note_expressions" || method === "browser.get_filter_items" || method === "device.remote_pages_get" || method === "transport.get_arranger_loop";
}
function guardCreativeLegacyRequest(method, params) {
  if (!creativeState || !creativeState.pending) return;
  if (method === "ping" || method.indexOf("bridge.") === 0 || method === "transport.stop" || method === "note_input.get_status" || method === "note_input.send_note_off" || method === "note_input.all_notes_off") return;
  var pending = creativeState.pending;
  if (pending.failed && (isCreativeReadMethod(method) || method === "browser.get_status" || method === "browser.list_results" || method === "device.get_remote_controls")) {
    if (creativeState[pending.group].settled !== creativeState[pending.group].version || !pending.identity()) throw creativeError("Uncertain mutation diagnostics require the original identity and settled observations");
    return;
  }
  throw creativeError(pending.failed ? "Uncertain creative mutation; read back then reload controller before further writes" : "Creative mutation awaiting observed outcome; wait for controller updates");
}
function creativeCoordinates(notes, writing) {
  if (!Array.isArray(notes) || notes.length < 1 || notes.length > 256) throw invalidParams("notes must contain 1 to 256 entries");
  var seen = {}, fields = Object.keys(creativeExpressionLimits), allowed = ["step", "pitch"].concat(writing ? fields : []);
  for (var i = 0; i < notes.length; i++) {
    var note = notes[i]; creativeKeys(note, allowed);
    if (!isIntegerInRange(note.step, 0, 63) || !isIntegerInRange(note.pitch, 0, 127)) throw invalidParams("Expected step 0..63 and pitch 0..127");
    var coordinate = note.step + ":" + note.pitch;
    if (seen[coordinate]) throw invalidParams("Duplicate note coordinates");
    seen[coordinate] = true;
    if (writing) {
      var changed = 0;
      for (var f = 0; f < fields.length; f++) if (creativeHas(note, fields[f])) {
        var range = creativeExpressionLimits[fields[f]];
        if (!creativeNumber(note[fields[f]], range[0], range[1])) throw invalidParams("Invalid note expression: " + fields[f]);
        changed += 1;
      }
      if (!changed) throw invalidParams("Each note update needs at least one expression");
    }
  }
}
function creativeNoteContext(trackIndex, sceneIndex) {
  if (!isIntegerInRange(trackIndex, 0, 7) || !isIntegerInRange(sceneIndex, 0, 7)) throw invalidParams("Clip indices must be 0..7");
  var context = readInspectionNotes(trackIndex, sceneIndex);
  context.snapshotId = creativeToken("notes", context.trackPosition + ":" + context.slotSceneIndex);
  return context;
}
function creativeReadNote(coordinate) {
  var step = inspectionClip.getStep(0, coordinate.step, coordinate.pitch);
  if (!step || String(step.state()) !== "NoteOn" || step.channel() !== 0 || step.x() !== coordinate.step || step.y() !== coordinate.pitch) throw creativeError("An observed NoteOn is required at every requested coordinate");
  var result = { step: coordinate.step, pitch: coordinate.pitch, durationBeats: step.duration() };
  if (typeof result.durationBeats !== "number" || !isFinite(result.durationBeats) || result.durationBeats <= 0) throw creativeError("Note duration is unavailable");
  for (var key in creativeExpressionLimits) {
    var range = creativeExpressionLimits[key], value = step[key]();
    if (!creativeNumber(value, range[0], range[1])) throw creativeError("Note expression is unavailable: " + key);
    result[key] = value;
  }
  return result;
}
function creativeNoteOperation(step, key, value) { return function () { step["set" + key.charAt(0).toUpperCase() + key.substring(1)](value); }; }
function creativeExpressions(params, writing) {
  requireArgumentCount(params, writing ? 4 : 3);
  var notes = params[writing ? 3 : 2]; creativeCoordinates(notes, writing);
  var context = creativeNoteContext(params[0], params[1]), observations = [];
  for (var n = 0; n < notes.length; n++) observations.push(creativeReadNote(notes[n]));
  if (!writing) return { trackIndex: params[0], sceneIndex: params[1], trackPosition: context.trackPosition, slotSceneIndex: context.slotSceneIndex, snapshotId: context.snapshotId, coverage: context.coverage, notes: observations };
  creativeRequireToken(params[2], context.snapshotId);
  var identity = cursorConstructionIdentity(), operations = [], expected = [];
  for (var i = 0; i < notes.length; i++) for (var key in creativeExpressionLimits) {
    if (creativeHas(notes[i], key) && notes[i][key] !== observations[i][key]) {
      operations.push(creativeNoteOperation(inspectionClip.getStep(0, notes[i].step, notes[i].pitch), key, notes[i][key]));
      expected.push({ step: notes[i].step, pitch: notes[i].pitch, key: key, value: notes[i][key] });
    }
  }
  return creativeDispatch(operations, "notes", function () {
    for (var e = 0; e < expected.length; e++) {
      var item = expected[e], current = creativeReadNote(item);
      if (Math.abs(current[item.key] - item.value) > 0.000001) return false;
    }
    return true;
  }, identity);
}
function creativeBrowserOpen() {
  if (creativeObserved("browser", "exists", popupBrowser.exists(), "boolean") !== true) throw creativeError("An observed open browser session is required");
}
function creativeBrowserIdentity() {
  var session = creativeState.session, projectName = application.projectName().get();
  return function () { return creativeState.session === session && popupBrowser.exists().get() === true && application.projectName().get() === projectName; };
}
function creativeBrowserItem(item, prefix, index, filter) {
  var fields = [prefix + ".name", prefix + ".selected"];
  if (filter) fields.push(prefix + ".hits");
  var knownExists = creativeSeen("browser", [prefix + ".exists"]);
  var exists = knownExists ? creativeObserved("browser", prefix + ".exists", item.exists(), "boolean") : null;
  var ready = knownExists && (exists === false || creativeSeen("browser", fields));
  var result = { index: index, exists: exists, name: null, selected: null, available: ready };
  if (filter) result.hitCount = null;
  if (!ready || !exists) return result;
  result.name = creativeObserved("browser", prefix + ".name", item.name(), "string");
  result.selected = creativeObserved("browser", prefix + ".selected", item.isSelected(), "boolean");
  if (filter) {
    result.hitCount = creativeObserved("browser", prefix + ".hits", item.hitCount(), "number");
    if (!isIntegerInRange(result.hitCount, 0, 2147483647)) throw creativeError("Browser hit count is unavailable");
  }
  return result;
}
function creativeFilterState(columnName) {
  if (typeof columnName !== "string" || creativeColumns.indexOf(columnName) < 0) throw invalidParams("Unknown browser column");
  creativeBrowserOpen();
  var entry = creativeState.columns[columnName], column = entry.column, bank = entry.bank;
  var exists = creativeObserved("browser", columnName + ".exists", column.exists(), "boolean");
  var result = { column: columnName, exists: exists, sessionId: "browser:" + controllerInstanceId + ":" + creativeState.session, snapshotId: creativeToken("browser", columnName), items: [], wildcard: null, coverage: null };
  if (!exists) return result;
  result.name = creativeObserved("browser", columnName + ".name", column.name(), "string");
  var count = creativeObserved("browser", columnName + ".count", column.entryCount(), "number");
  var offset = creativeObserved("browser", columnName + ".offset", bank.scrollPosition(), "number");
  if (!isIntegerInRange(count, 0, 2147483647) || !isIntegerInRange(offset, count === 0 ? -1 : 0, Math.max(0, count - 1))) throw creativeError("Browser column coverage is unavailable");
  result.coverage = { bankSize: 16, scrollPosition: offset, entryCount: count, complete: count <= 16 && offset <= 0 };
  result.canScrollForward = creativeObserved("browser", columnName + ".forward", bank.canScrollForwards(), "boolean");
  result.canScrollBackward = creativeObserved("browser", columnName + ".backward", bank.canScrollBackwards(), "boolean");
  result.wildcard = creativeBrowserItem(entry.wildcard, columnName + ".wildcard", -1, true);
  for (var i = 0; i < 16; i++) {
    var item = creativeBrowserItem(bank.getItemAt(i), columnName + "." + i, i, true);
    if (item.exists === true && (offset < 0 || offset + i >= count)) throw creativeError("Browser item existence contradicts column coverage");
    if (!item.available) result.coverage.complete = false;
    result.items.push(item);
  }
  return result;
}
function creativeInvalidateResults() {
  for (var i = 0; i < 32; i++) creativeInvalidate("browser", ["result." + i + ".exists", "result." + i + ".name", "result." + i + ".selected"]);
}
function creativeInvalidateRemoteControls() {
  for (var i = 0; i < 8; i++) creativeInvalidate("remote", [i + ".name", i + ".value"]);
}
function creativeSetValue(value, next) { return function () { value.set(next); }; }
function creativeFilterWrite(params, scroll) {
  requireArgumentCount(params, 3);
  if (scroll ? params[1] !== "forward" && params[1] !== "backward" : !isIntegerInRange(params[1], -1, 15)) throw invalidParams(scroll ? "direction must be forward or backward" : "itemIndex must be -1..15");
  var before = creativeFilterState(params[0]); creativeRequireToken(params[2], before.snapshotId);
  if (!before.exists) throw creativeError("Browser column does not exist in this session");
  var entry = creativeState.columns[params[0]], identity = creativeBrowserIdentity();
  if (scroll) {
    if (!(params[1] === "forward" ? before.canScrollForward : before.canScrollBackward)) throw creativeError("Browser column cannot scroll in this direction");
    var forward = params[1] === "forward", offset = before.coverage.scrollPosition, offsetKey = params[0] + ".offset";
    creativeInvalidate("browser", [offsetKey]);
    return creativeDispatch([function () { if (forward) entry.bank.scrollPageForwards(); else entry.bank.scrollPageBackwards(); }], "browser", function () { return creativeSeen("browser", [offsetKey]) && entry.bank.scrollPosition().get() !== offset; }, identity);
  }
  var selected = params[1] === -1 ? before.wildcard : before.items[params[1]];
  if (!selected.available || !selected.exists) throw creativeError("Existing filter item with fresh observed identity required");
  if (selected.selected) return creativeDispatch([], "browser", function () { return true; });
  var value = (params[1] === -1 ? entry.wildcard : entry.bank.getItemAt(params[1])).isSelected();
  var selectedKey = params[0] + "." + (params[1] === -1 ? "wildcard" : params[1]) + ".selected";
  creativeInvalidate("browser", [selectedKey]); creativeInvalidateResults();
  return creativeDispatch([creativeSetValue(value, true)], "browser", function () { return creativeSeen("browser", [selectedKey]) && value.get() === true; }, identity);
}
function creativeRemoteState() {
  requireSettledBank(); var device = cursorDeviceStatus();
  if (!device.exists) throw creativeError("An observed existing cursor device is required");
  var names = creativeStringArray(creativeObserved("remote", "names", remoteControlsBank.pageNames(), "object"), 1024);
  var count = creativeObserved("remote", "count", remoteControlsBank.pageCount(), "number");
  var index = creativeObserved("remote", "index", remoteControlsBank.selectedPageIndex(), "number");
  if (!isIntegerInRange(count, 0, 1024) || names.length !== count || !isIntegerInRange(index, count === 0 ? -1 : 0, Math.max(-1, count - 1))) throw creativeError("Remote page observations are unavailable or inconsistent");
  for (var n = 0; n < names.length; n++) if (typeof names[n] !== "string") throw creativeError("Remote page name is unavailable");
  return { deviceName: device.name, devicePosition: device.position, trackPosition: device.trackPosition, pageNames: names.slice(), pageCount: count, selectedPageIndex: index, snapshotId: creativeToken("remote") };
}
function creativeRemoteSelect(index, token) {
  if (!isIntegerInRange(index, 0, 1023)) throw invalidParams("Remote page index must be 0..1023");
  var before = creativeRemoteState(); creativeRequireToken(token, before.snapshotId);
  if (index >= before.pageCount) throw invalidParams("Remote page index exceeds observed page count");
  if (index === before.selectedPageIndex) return creativeDispatch([], "remote", function () { return true; });
  var identity = function () { return cursorTrack.position().get() === before.trackPosition && cursorDevice.position().get() === before.devicePosition && cursorDevice.exists().get() === true; };
  creativeInvalidate("remote", ["index"]); creativeInvalidateRemoteControls();
  return creativeDispatch([creativeSetValue(remoteControlsBank.selectedPageIndex(), index)], "remote", function () { return creativeSeen("remote", ["index"]) && remoteControlsBank.selectedPageIndex().get() === index; }, identity);
}
function creativeLoopState() {
  var enabled = creativeObserved("loop", "enabled", transport.isArrangerLoopEnabled(), "boolean");
  var start = creativeObserved("loop", "start", transport.arrangerLoopStart(), "number");
  var duration = creativeObserved("loop", "duration", transport.arrangerLoopDuration(), "number");
  if (!creativeNumber(start, 0, 1048576) || !creativeNumber(duration, 0, 1048576) || duration <= 0 || start + duration > 1048576) throw creativeError("Arranger loop exceeds the bridge's bounded time range");
  return { enabled: enabled, startBeats: start, durationBeats: duration, endBeats: start + duration, snapshotId: creativeToken("loop"), units: "quarter_note_beats" };
}
function creativeLoopWrite(params) {
  requireArgumentCount(params, 4);
  if (typeof params[0] !== "boolean" || !creativeNumber(params[1], 0, 1048576) || !creativeNumber(params[2], 0, 1048576) || params[2] <= 0 || params[1] + params[2] > 1048576) throw invalidParams("Loop requires enabled boolean, nonnegative start, positive duration and end <= 1048576 beats");
  requireStoppedStructure(); var before = creativeLoopState(); creativeRequireToken(params[3], before.snapshotId);
  var operations = [], changedKeys = [], projectName = application.projectName().get();
  if (before.startBeats !== params[1]) { operations.push(creativeSetValue(transport.arrangerLoopStart(), params[1])); changedKeys.push("start"); }
  if (before.durationBeats !== params[2]) { operations.push(creativeSetValue(transport.arrangerLoopDuration(), params[2])); changedKeys.push("duration"); }
  if (before.enabled !== params[0]) { operations.push(creativeSetValue(transport.isArrangerLoopEnabled(), params[0])); changedKeys.push("enabled"); }
  creativeInvalidate("loop", changedKeys);
  return creativeDispatch(operations, "loop", function () { return creativeSeen("loop", changedKeys) && transport.isArrangerLoopEnabled().get() === params[0] && Math.abs(transport.arrangerLoopStart().get() - params[1]) <= 0.000001 && Math.abs(transport.arrangerLoopDuration().get() - params[2]) <= 0.000001; }, function () { return application.projectName().get() === projectName; });
}
function creativeResultWindow() {
  var count = creativeObserved("browser", "results.count", popupBrowser.resultsColumn().entryCount(), "number");
  var offset = creativeObserved("browser", "results.offset", browserResultBank.scrollPosition(), "number");
  if (offset !== creativeState.observedResultOffset || !isIntegerInRange(count, 0, 2147483647) || !isIntegerInRange(offset, count === 0 ? -1 : 0, Math.max(0, count - 1))) throw creativeError("Browser result coverage is unavailable");
  return { count: count, offset: offset };
}
function creativeLegacyBrowser(method, params) {
  requireArgumentCount(params, method === "browser.select_result" ? 1 : 0);
  if (method === "browser.get_status") {
    var exists = creativeObserved("browser", "exists", popupBrowser.exists(), "boolean");
    return { exists: exists, title: exists ? creativeObserved("browser", "title", popupBrowser.title(), "string") : null,
      contentTypeNames: exists ? creativeStringArray(creativeObserved("browser", "contentTypes", popupBrowser.contentTypeNames(), "object"), 64) : [],
      selectedContentTypeIndex: exists ? creativeObserved("browser", "contentIndex", popupBrowser.selectedContentTypeIndex(), "number") : null,
      selectedContentTypeName: exists ? creativeObserved("browser", "contentName", popupBrowser.selectedContentTypeName(), "string") : null,
      sessionId: "browser:" + controllerInstanceId + ":" + creativeState.session };
  }
  creativeBrowserOpen();
  var items = [], i, window = creativeResultWindow();
  for (i = 0; i < 32; i++) {
    var observed = creativeBrowserItem(browserResultBank.getItemAt(i), "result." + i, i, false);
    if (observed.exists === true && (window.offset < 0 || window.offset + i >= window.count)) throw creativeError("Browser result existence contradicts coverage");
    if (observed.exists !== false) items.push(observed);
  }
  if (method === "browser.list_results") return items;
  var identity = creativeBrowserIdentity();
  if (method === "browser.select_result") {
    if (!isIntegerInRange(params[0], 0, 31)) throw invalidParams("Browser result index must be 0..31");
    var selected = creativeBrowserItem(browserResultBank.getItemAt(params[0]), "result." + params[0], params[0], false);
    if (!selected.available || !selected.exists) throw creativeError("Existing browser result with fresh observed identity required");
    if (selected.selected) return creativeDispatch([], "browser", function () { return true; });
    var selectedValue = browserResultBank.getItemAt(params[0]).isSelected(), selectedKey = "result." + params[0] + ".selected";
    creativeInvalidate("browser", [selectedKey]);
    return creativeDispatch([creativeSetValue(selectedValue, true)], "browser", function () { return creativeSeen("browser", [selectedKey]) && selectedValue.get() === true; }, identity);
  }
  if (method === "browser.commit" || method === "browser.cancel") {
    if (method === "browser.commit") {
      var selectedCount = 0;
      for (i = 0; i < items.length; i++) if (items[i].available && items[i].exists && items[i].selected) selectedCount += 1;
      if (selectedCount !== 1) throw creativeError("Exactly one observed browser result must be selected before commit");
    }
    var session = creativeState.session, command = method === "browser.commit" ? "commit" : "cancel";
    return creativeDispatch([function () { popupBrowser[command](); }], "browser", function () { return popupBrowser.exists().get() === false; }, function () { return creativeState.session === session + 1 && popupBrowser.exists().get() === false; });
  }
  var selectedIndex = -1;
  for (i = 0; i < items.length; i++) if (items[i].available && items[i].selected) {
    if (selectedIndex !== -1) throw creativeError("Browser selection is inconsistent");
    selectedIndex = items[i].index;
  }
  var nativeName = method === "browser.select_first_file" ? "selectFirstFile" : method === "browser.select_next_file" ? "selectNextFile" : "selectPreviousFile";
  if (!window.count) throw creativeError("Browser has no results to navigate");
  if (selectedIndex < 0 && nativeName !== "selectFirstFile") throw creativeError("Observed selection required before browser navigation");
  var selectedAbsolute = selectedIndex < 0 ? -1 : window.offset + selectedIndex;
  var desired = nativeName === "selectFirstFile" ? 0 : selectedAbsolute + (nativeName === "selectNextFile" ? 1 : -1);
  if (desired === selectedAbsolute || desired < 0 || desired >= window.count) return creativeDispatch([], "browser", function () { return true; });
  // Selection is the intended observed effect; bank-local indices can stay the
  // same while the window scrolls, so compare absolute positions instead.
  for (i = 0; i < 32; i++) creativeInvalidate("browser", ["result." + i + ".selected"]);
  return creativeDispatch([function () { popupBrowser[nativeName](); }], "browser", function () {
    var offset = browserResultBank.scrollPosition().get();
    if (offset !== creativeState.observedResultOffset) return false;
    for (var index = 0; index < 32; index++) if (creativeSeen("browser", ["result." + index + ".exists", "result." + index + ".selected"]) && browserResultBank.getItemAt(index).exists().get() === true && browserResultBank.getItemAt(index).isSelected().get() === true && offset + index === desired) return true;
    return false;
  }, identity);
}
function creativeLegacyRemote(method, params) {
  requireArgumentCount(params, method === "device.set_remote_control" ? 2 : 0);
  var pages = creativeRemoteState();
  if (!pages.pageCount) throw creativeError("Device has no observed remote-control page");
  if (method === "device.page_next" || method === "device.page_previous") {
    var direction = method === "device.page_next" ? 1 : -1;
    return creativeRemoteSelect((pages.selectedPageIndex + direction + pages.pageCount) % pages.pageCount, pages.snapshotId);
  }
  var controls = [];
  for (var i = 0; i < 8; i++) {
    var param = remoteControlsBank.getParameter(i), ready = creativeSeen("remote", [i + ".name", i + ".value"]);
    var name = ready ? creativeObserved("remote", i + ".name", param.name(), "string") : null;
    var value = ready ? creativeObserved("remote", i + ".value", param.value(), "number") : null;
    if (ready && !creativeNumber(value, 0, 1)) throw creativeError("Remote parameter value is unavailable");
    controls.push({ index: i, name: name, value: value, available: ready });
  }
  if (method === "device.get_remote_controls") return controls;
  if (!isIntegerInRange(params[0], 0, 7) || !creativeNumber(params[1], 0, 1)) throw invalidParams("Remote control requires index 0..7 and normalized value 0..1");
  if (!controls[params[0]].available) throw creativeError("Target remote control is not freshly observed after page selection");
  var parameter = remoteControlsBank.getParameter(params[0]).value(), next = params[1];
  if (controls[params[0]].value === next) return creativeDispatch([], "remote", function () { return true; });
  var valueKey = params[0] + ".value"; creativeInvalidate("remote", [valueKey]);
  return creativeDispatch([creativeSetValue(parameter, next)], "remote", function () { return creativeSeen("remote", [valueKey]) && Math.abs(parameter.get() - next) <= 0.000001; }, function () { return remoteControlsBank.selectedPageIndex().get() === pages.selectedPageIndex && cursorTrack.position().get() === pages.trackPosition && cursorDevice.position().get() === pages.devicePosition; });
}
function handleCreativeRequest(method, params) {
  var newMethod = isCreativeReadMethod(method) || method === "clip.set_note_expressions" || method === "browser.set_filter" || method === "browser.scroll_filter_items" || method === "device.remote_page_select" || method === "transport.set_arranger_loop";
  if (!creativeState || !creativeState.initialized) {
    if (newMethod) throw creativeError("Creative controller module is not initialized");
    return { handled: false };
  }
  guardCreativeLegacyRequest(method, params);
  var result;
  if (method === "clip.get_note_expressions" || method === "clip.set_note_expressions") result = creativeExpressions(params, method === "clip.set_note_expressions");
  else if (method === "browser.get_filter_items") { requireArgumentCount(params, 1); result = creativeFilterState(params[0]); }
  else if (method === "browser.set_filter" || method === "browser.scroll_filter_items") result = creativeFilterWrite(params, method === "browser.scroll_filter_items");
  else if (method === "device.remote_pages_get") { requireArgumentCount(params, 0); result = creativeRemoteState(); }
  else if (method === "device.remote_page_select") { requireArgumentCount(params, 2); result = creativeRemoteSelect(params[0], params[1]); }
  else if (method === "transport.get_arranger_loop") { requireArgumentCount(params, 0); result = creativeLoopState(); }
  else if (method === "transport.set_arranger_loop") result = creativeLoopWrite(params);
  else if (["browser.get_status", "browser.list_results", "browser.select_result", "browser.select_first_file", "browser.select_next_file", "browser.select_previous_file", "browser.commit", "browser.cancel"].indexOf(method) >= 0) result = creativeLegacyBrowser(method, params);
  else if (["device.get_remote_controls", "device.set_remote_control", "device.page_next", "device.page_previous"].indexOf(method) >= 0) result = creativeLegacyRemote(method, params);
  else return { handled: false };
  return { handled: true, result: result };
}
