// @ts-nocheck
// Source for the Bitwig JS-only controller; build with pnpm build:bridge.
loadAPI(15);

var midiProfileEnabled = false;
host.defineController("Beat Twin", midiProfileEnabled ? "Beat Twin MIDI" : "Beat Twin", "0.1",
  midiProfileEnabled ? "acb64b9b-08ce-4c39-8d8f-e9983c5559bd" : "761be710-90df-4577-8094-01314323214c", "Laurent Huzard");
if (midiProfileEnabled) host.defineMidiPorts(1, 0);

var transport;
var arranger;
var cueMarkerBank;
var masterTrack;
var masterCursorMatches;
var returnCursorMatches = [];
var effectTrackBank;
var advancedState = {
  transport: { version: 0, flushedVersion: -1, settledVersion: -1, seen: {} },
  arranger: { version: 0, flushedVersion: -1, settledVersion: -1, seen: {} },
  cues: { version: 0, flushedVersion: -1, settledVersion: -1, seen: {} }
};
var application;
var trackBank;
var sceneBank;
var cursorTrack;
var cursorDevice;
var cursorClip;
var boundedCursorClip;
var inspectionClip;
var inspectionTrack;
var inspectionSlot;
var inspectionVersion = 0;
var inspectionSettledVersion = -1;
var inspectionFlushedVersion = -1;
var remoteControlsBank;
var deviceBanks = [];
var deviceCursorMatches = [];
var mainCursorMatches = [];
var targetTracks = [];
var targetSlots = [];
var popupBrowser;
var browserResultBank;
var bridgeConnection = null;
var bridgeExiting = false;
var controllerInstanceId;
var cursorClipTrack;
var cursorClipSlot;
var targetGeneration = 0;
var lastTargetSignature = null;
var bankNavigation = null;
var constructionPending = null;
var constructionReadAccess = false;
var sceneSelected = [];
var project;
var groove;
var drumPadBank;
var drumPadSelected = [];
var globalUiPending = 0;
var mixValueObservations = {};

var BRIDGE_PROTOCOL_VERSION = "beat-twin-bitwig-v2";
var TARGET_GRID_STEPS = 64;
var TARGET_STEP_SIZE_BEATS = 0.25;

// Connection state
var isConnected = false;

function init() {
  transport = host.createTransport();

  // Mark values we need to read as interested
  transport.tempo().value().markInterested();
  transport.getPosition().markInterested();
  transport.isPlaying().markInterested();
  transport.isArrangerRecordEnabled().markInterested();
  watchMixValue(transport.isPlaying(), "playing", "mixSafety");
  watchMixValue(transport.isArrangerRecordEnabled(), "recording", "mixSafety");

  watchAdvancedValue(transport.isMetronomeEnabled(), "metronome", "transport");
  watchAdvancedValue(transport.isPunchInEnabled(), "punchIn", "transport");
  watchAdvancedValue(transport.isPunchOutEnabled(), "punchOut", "transport");
  watchAdvancedValue(transport.isArrangerOverdubEnabled(), "arrangerOverdub", "transport");
  watchAdvancedValue(transport.isClipLauncherOverdubEnabled(), "launcherOverdub", "transport");

  arranger = host.createArranger();
  var panels = arrangerPanelValues();
  for (var panelName in panels) watchAdvancedValue(panels[panelName], panelName, "arranger");
  cueMarkerBank = arranger.createCueMarkerBank(32);
  watchAdvancedValue(cueMarkerBank.itemCount(), "count", "cues");
  cueMarkerBank.itemCount().addValueObserver(observeConstructionChange);
  watchAdvancedValue(cueMarkerBank.scrollPosition(), "offset", "cues");
  for (var cueIndex = 0; cueIndex < 32; cueIndex++) {
    var marker = cueMarkerBank.getItemAt(cueIndex);
    watchAdvancedValue(marker.exists(), cueIndex + ".exists", "cues");
    watchAdvancedValue(marker.name(), cueIndex + ".name", "cues");
    watchAdvancedValue(marker.position(), cueIndex + ".position", "cues");
    watchAdvancedValue(marker.getColor(), cueIndex + ".color", "cues");
    marker.name().addValueObserver(observeConstructionChange);
    marker.position().addValueObserver(observeConstructionChange);
    marker.exists().addValueObserver(observeConstructionChange);
  }

  application = host.createApplication();
  project = host.getProject();
  application.projectName().markInterested();
  initParityGlobals();

  controllerInstanceId = createControllerInstanceId();

  // --- Track Control Setup ---
  // Create a Cursor Track (follows selection)
  cursorTrack = host.createCursorTrack("MCP_CURSOR", "Cursor Track", 0, 0, true);

  // Mark interested for Cursor Track
  cursorTrack.volume().markInterested();
  cursorTrack.pan().markInterested();
  cursorTrack.mute().markInterested();
  cursorTrack.solo().markInterested();
  cursorTrack.arm().markInterested();
  cursorTrack.name().markInterested();

  // --- Cursor Clip Setup ---
  // Gives MCP a focused step sequencer surface for writing note steps into the
  // currently selected clip.
  cursorClip = host.createCursorClip(16, 128);
  cursorClip.getLoopLength().markInterested();
  cursorClip.getLoopStart().markInterested();
  cursorClip.getPlayStart().markInterested();
  cursorClip.getPlayStop().markInterested();
  cursorClip.playingStep().markInterested();

  // This private read cursor is anchored once. Read requests never move a
  // viewport or selection, so getStep cannot accidentally read a previous page.
  inspectionClip = host.createLauncherCursorClip(TARGET_GRID_STEPS, 128);
  inspectionClip.setStepSize(TARGET_STEP_SIZE_BEATS);
  inspectionClip.scrollToStep(0);
  inspectionClip.scrollToKey(0);
  inspectionTrack = inspectionClip.getTrack();
  inspectionSlot = inspectionClip.clipLauncherSlot();
  var inspectionValues = [inspectionClip.exists(), inspectionClip.getLoopLength(), inspectionClip.getLoopStart(),
    inspectionTrack.exists(), inspectionTrack.position(), inspectionSlot.exists(),
    inspectionSlot.sceneIndex(), inspectionSlot.hasContent(), application.projectName()];
  for (var readIndex = 0; readIndex < inspectionValues.length; readIndex++) {
    inspectionValues[readIndex].markInterested();
    inspectionValues[readIndex].addValueObserver(invalidateInspection);
    inspectionValues[readIndex].addValueObserver(observeConstructionChange);
  }
  inspectionClip.addNoteStepObserver(invalidateInspection);
  inspectionClip.addNoteStepObserver(observeConstructionChange);

  // Agent-mode writes use a dedicated cursor clip so the historical MCP note
  // tools cannot shift its step/key viewport behind the adapter's back.
  boundedCursorClip = host.createLauncherCursorClip(TARGET_GRID_STEPS, 128);
  boundedCursorClip.setStepSize(TARGET_STEP_SIZE_BEATS);
  boundedCursorClip.exists().markInterested();
  boundedCursorClip.getLoopLength().markInterested();

  cursorClipTrack = boundedCursorClip.getTrack();
  cursorClipTrack.exists().markInterested();
  cursorClipTrack.position().markInterested();
  cursorClipTrack.name().markInterested();

  cursorClipSlot = boundedCursorClip.clipLauncherSlot();
  cursorClipSlot.exists().markInterested();
  cursorClipSlot.sceneIndex().markInterested();
  cursorClipSlot.name().markInterested();
  cursorClipSlot.hasContent().markInterested();

  application.projectName().addValueObserver(refreshTargetGeneration);
  cursorClipTrack.exists().addValueObserver(refreshTargetGeneration);
  cursorClipTrack.position().addValueObserver(refreshTargetGeneration);
  cursorClipSlot.exists().addValueObserver(refreshTargetGeneration);
  cursorClipSlot.sceneIndex().addValueObserver(refreshTargetGeneration);

  cursorClip.addStepDataObserver(function (x, y, state) {
    if (isConnected) {
      // Step events are currently only visible in Bitwig's controller log; the
      // Node bridge ignores unsolicited messages unless they match a request id.
      println("Beat Twin clip.step_update " + JSON.stringify({ x: x, y: y, state: state }));
    }
  });

  cursorClip.addPlayingStepObserver(function (step) {
    if (isConnected) {
      println("Beat Twin clip.play_step " + step);
    }
  });

  // --- Cursor Device Setup ---
  cursorDevice = cursorTrack.createCursorDevice("MCP_DEVICE", "Cursor Device", 0, CursorDeviceFollowMode.FOLLOW_SELECTION);
  cursorDevice.name().markInterested();
  cursorDevice.isWindowOpen().markInterested();
  cursorDevice.isExpanded().markInterested();
  initDrumPads();
  
  // Remote Controls (8 knobs/macros)
  remoteControlsBank = cursorDevice.createCursorRemoteControlsPage(8);
  for (var i = 0; i < 8; i++) {
    var param = remoteControlsBank.getParameter(i);
    param.name().markInterested();
    param.value().markInterested();
    param.setIndication(true);
  }

  // Create Main Track Bank (8 tracks, 8 sends, 8 scenes)
  trackBank = host.createMainTrackBank(8, 8, 8);
  trackBank.itemCount().markInterested();
  watchMixValue(trackBank.itemCount(), "count", "mainBank");
  trackBank.scrollPosition().markInterested();
  trackBank.scrollPosition().addValueObserver(observeBankNavigationPosition);
  trackBank.canScrollForwards().markInterested();
  trackBank.canScrollBackwards().markInterested();

  // Mark interested for Track Bank
  for (var i = 0; i < 8; i++) {
    var track = trackBank.getItemAt(i);
    track.exists().markInterested();
    track.position().markInterested();
    track.volume().markInterested();
    track.pan().markInterested();
    track.mute().markInterested();
    track.solo().markInterested();
    track.arm().markInterested();
    track.name().markInterested();
    track.color().markInterested();
    watchMixValue(track.exists(), "exists", "mainTrack" + i);
    watchMixValue(track.position(), "position", "mainTrack" + i);
    watchMixValue(track.trackType(), "type", "mainTrack" + i);
    var mainMatchesCursor = track.createEqualsValue(cursorTrack);
    mainCursorMatches.push(mainMatchesCursor);
    watchMixValue(mainMatchesCursor, "cursorMatch", "mainTrack" + i);
    for (var sendIndex = 0; sendIndex < 8; sendIndex++) {
      var send = track.sendBank().getItemAt(sendIndex);
      watchMixValue(send.exists(), "exists", "send" + i + ":" + sendIndex);
      watchMixValue(send, "level", "send" + i + ":" + sendIndex);
    }
    track.exists().addValueObserver(refreshTargetGeneration);
    track.position().addValueObserver(refreshTargetGeneration);
    targetTracks.push(track);
    targetSlots.push([]);

    var deviceBank = track.createDeviceBank(8);
    var deviceMatches = [];
    watchMixValue(deviceBank.itemCount(), "count", "devices" + i);
    for (var d = 0; d < 8; d++) {
      var device = deviceBank.getItemAt(d);
      device.exists().markInterested();
      device.name().markInterested();
      device.isEnabled().markInterested();
      watchMixValue(device.exists(), "exists", "device" + i + ":" + d);
      watchMixValue(device.position(), "position", "device" + i + ":" + d);
      watchMixValue(device.isEnabled(), "enabled", "device" + i + ":" + d);
      var sameCursorDevice = device.createEqualsValue(cursorDevice);
      deviceMatches.push(sameCursorDevice);
      watchMixValue(sameCursorDevice, "cursorMatch", "device" + i + ":" + d);
    }
    deviceBanks.push(deviceBank);
    deviceCursorMatches.push(deviceMatches);
    
    // Clip Launcher Slots
    var clipLauncher = track.clipLauncherSlotBank();
    for (var j = 0; j < 8; j++) {
      var slot = clipLauncher.getItemAt(j);
      slot.exists().markInterested();
      slot.sceneIndex().markInterested();
      slot.name().markInterested();
      slot.hasContent().markInterested();
      slot.color().markInterested();
      slot.hasContent().addValueObserver(observeConstructionChange);
      slot.name().addValueObserver(observeConstructionChange);
      slot.isSelected().markInterested();
      slot.isPlaying().markInterested();
      slot.isRecording().markInterested();
      slot.isPlaybackQueued().markInterested();
      slot.exists().addValueObserver(refreshTargetGeneration);
      slot.sceneIndex().addValueObserver(refreshTargetGeneration);
      slot.isSelected().addValueObserver(refreshTargetGeneration);
      targetSlots[i].push(slot);
    }
  }
  
  // Create Scene Bank (8 scenes)
  sceneBank = host.createSceneBank(8);
  watchMixValue(sceneBank.itemCount(), "count", "scenes");
  for (var i = 0; i < 8; i++) {
     var scene = sceneBank.getScene(i);
     scene.exists().markInterested();
     scene.name().markInterested();
     scene.sceneIndex().markInterested();
     scene.clipCount().markInterested();
     scene.exists().addValueObserver(observeConstructionChange);
     scene.sceneIndex().addValueObserver(observeConstructionChange);
     scene.clipCount().addValueObserver(observeConstructionChange);
     observeSceneSelection(i, scene);
  }

  masterTrack = host.createMasterTrack(0);
  watchMixValue(masterTrack.exists(), "exists", "master");
  watchMixValue(masterTrack.volume(), "level", "master");
  masterCursorMatches = masterTrack.createEqualsValue(cursorTrack);
  watchMixValue(masterCursorMatches, "cursorMatch", "master");
  effectTrackBank = host.createEffectTrackBank(8, 8);
  watchMixValue(effectTrackBank.itemCount(), "count", "returns");
  watchMixValue(effectTrackBank.scrollPosition(), "offset", "returns");
  for (var returnIndex = 0; returnIndex < 8; returnIndex++) {
    var returnTrack = effectTrackBank.getItemAt(returnIndex);
    watchChannelValues(returnTrack, "return" + returnIndex, false);
    var returnMatchesCursor = returnTrack.createEqualsValue(cursorTrack);
    returnCursorMatches.push(returnMatchesCursor);
    watchMixValue(returnMatchesCursor, "cursorMatch", "return" + returnIndex);
  }
  watchChannelValues(cursorTrack, "cursorTrack", true);
  var selectedDeviceValues = { exists: cursorDevice.exists(), name: cursorDevice.name(), position: cursorDevice.position(),
    isEnabled: cursorDevice.isEnabled(), isWindowOpen: cursorDevice.isWindowOpen(), isExpanded: cursorDevice.isExpanded(),
    hasNext: cursorDevice.hasNext(), hasPrevious: cursorDevice.hasPrevious() };
  for (var deviceKey in selectedDeviceValues) watchMixValue(selectedDeviceValues[deviceKey], deviceKey, "cursorDevice");
  var selectedClipValues = { exists: inspectionClip.exists(), loopLength: inspectionClip.getLoopLength(),
    loopStart: inspectionClip.getLoopStart(), playStart: inspectionClip.getPlayStart(), playStop: inspectionClip.getPlayStop(),
    color: inspectionClip.color(), trackExists: inspectionTrack.exists(), trackPosition: inspectionTrack.position(),
    slotExists: inspectionSlot.exists(), slotSceneIndex: inspectionSlot.sceneIndex() };
  for (var clipKey in selectedClipValues) watchMixValue(selectedClipValues[clipKey], clipKey, "cursorClip");

  // --- Popup Browser Setup ---
  popupBrowser = host.createPopupBrowser();
  popupBrowser.exists().markInterested();
  watchMixValue(popupBrowser.exists(), "exists", "mixBrowser");
  popupBrowser.exists().addValueObserver(observeConstructionChange);
  popupBrowser.title().markInterested();
  popupBrowser.contentTypeNames().markInterested();
  popupBrowser.selectedContentTypeIndex().markInterested();
  popupBrowser.selectedContentTypeName().markInterested();
  browserResultBank = popupBrowser.resultsColumn().createItemBank(32);
  for (var r = 0; r < 32; r++) {
    var browserItem = browserResultBank.getItemAt(r);
    browserItem.exists().markInterested();
    browserItem.name().markInterested();
    browserItem.isSelected().markInterested();
  }

  if (typeof initMidi === "function") initMidi();
  if (typeof initCreative === "function") initCreative();
  println("Beat Twin Initialized");

  connectLocalBridge();
}

// Bitwig exposes no listen-address or peer-address API. Never open a listener.
// Poll while disconnected: Bitwig may log a failed attempt without a callback.
function connectLocalBridge() {
  if (bridgeExiting) return;
  host.scheduleTask(connectLocalBridge, 2000);
  if (bridgeConnection) return;
  try {
  host.connectToRemoteHost("127.0.0.1", 8889, function (remoteConnection) {
    if (bridgeExiting || bridgeConnection) {
      if (remoteConnection) remoteConnection.disconnect();
      return;
    }
    if (!remoteConnection) return;
    bridgeConnection = remoteConnection;
    isConnected = true;
    var receiveBuffer = "";
    var bridgeSession = { authenticated: true };
    remoteConnection.setDisconnectCallback(function () {
      if (typeof cleanupMidi === "function") cleanupMidi("bridge_disconnect");
      bridgeConnection = null;
      isConnected = false;
      receiveBuffer = "";
      bridgeSession.authenticated = false;
    });
    remoteConnection.setReceiveCallback(function (data) {
      receiveBuffer += bytesToString(data);
      receiveBuffer = drainReceiveBuffer(receiveBuffer, remoteConnection, bridgeSession);
    });
  });
  } catch (connectionError) {
    // The relay may start later than Bitwig; the next poll retries connection only.
  }
}

function bytesToString(data) {
  var msgString = "";
  for (var i = 0; i < data.length; i++) {
    msgString += String.fromCharCode(data[i]);
  }
  return msgString;
}

function drainReceiveBuffer(buffer, connection, bridgeSession) {
  while (buffer.length > 0) {
    if (buffer.charAt(0) === "{") {
      try {
        handleRequest(JSON.parse(buffer), connection, bridgeSession);
        return "";
      } catch (rawError) {
        println("Error parsing raw JSON: " + rawError);
        sendError(connection, null, -32700, "Parse error");
        return "";
      }
    }

    if (buffer.length < 4) return buffer;

    var bodyLength = (
      (buffer.charCodeAt(0) << 24) |
      (buffer.charCodeAt(1) << 16) |
      (buffer.charCodeAt(2) << 8) |
      buffer.charCodeAt(3)
    ) >>> 0;

    if (bodyLength < 1 || bodyLength > 1048576) {
      println("Invalid frame length: " + bodyLength);
      sendError(connection, null, -32700, "Parse error");
      return "";
    }

    if (buffer.length < bodyLength + 4) return buffer;

    var body = buffer.substring(4, bodyLength + 4);
    buffer = buffer.substring(bodyLength + 4);

    try {
      handleRequest(JSON.parse(body), connection, bridgeSession);
    } catch (frameError) {
      println("Error parsing framed JSON: " + frameError);
      sendError(connection, null, -32700, "Parse error");
    }
  }

  return buffer;
}

function resolveCursorClipStep(step) {
  var stepNumber = Math.max(0, Math.floor(step));
  var pageStart = Math.floor(stepNumber / 16) * 16;
  cursorClip.scrollToStep(pageStart);
  return stepNumber - pageStart;
}

function invalidParams(message) {
  var err = new Error(message);
  err.jsonrpcCode = -32602;
  return err;
}

function bridgeError(code, message) {
  var err = new Error(message);
  err.jsonrpcCode = code;
  return err;
}

function createControllerInstanceId() {
  return "btw_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 0x7fffffff).toString(36);
}

function isBridgeReadMethod(method) {
  return method === "ping" ||
    method === "note_input.get_status" ||
    (typeof isCreativeReadMethod === "function" && isCreativeReadMethod(method)) ||
    method === "application.get_status" ||
    method === "application.list_actions" ||
    method === "project.get_status" ||
    method === "groove.get_status" ||
    method === "drumpad.get_status" ||
    method === "arranger.get_cue_markers" ||
    method === "bridge.identity" ||
    method === "target.inspect" ||
    method === "cursor_track.get_status" ||
    method === "cursor_device.get_status" ||
    method === "cursor_clip.get_status" ||
    method === "mixer.master.get_volume" ||
    method === "mixer.track.get_send" ||
    method === "mixer.return.list" ||
    method === "transport.get_punch_status" ||
    method === "transport.get_overdub_status" ||
    method === "arranger.get_status" ||
    method === "arranger.cues.list" ||
    method === "transport.getTempo" ||
    method === "transport.getPosition" ||
    method === "transport.getIsPlaying" ||
    method === "transport.getIsRecording" ||
    method === "project.get_summary" ||
    method === "track.list" ||
    method === "track.get_info" ||
    method === "clip.get_color" ||
    method === "clip.get_grid" ||
    method === "clip.get_status" ||
    method === "clip.get_notes" ||
    method === "track.bank.get_status" ||
    method === "scene.list" ||
    method === "clip.get_info" ||
    method === "track.selected.get_status" ||
    method === "device.get_status" ||
    method === "device.get_remote_controls" ||
    method === "device.list" ||
    method === "browser.get_status" ||
    method === "browser.list_results";
}

function selectedBankTarget() {
  var selected = null;
  for (var trackIndex = 0; trackIndex < targetTracks.length; trackIndex++) {
    for (var slotIndex = 0; slotIndex < targetSlots[trackIndex].length; slotIndex++) {
      var slot = targetSlots[trackIndex][slotIndex];
      if (!slot.isSelected().get()) {
        continue;
      }
      if (selected !== null) {
        return { ambiguous: true };
      }
      selected = {
        ambiguous: false,
        track: targetTracks[trackIndex],
        slot: slot
      };
    }
  }
  return selected;
}

function currentTargetState() {
  if (bankNavigation !== null || constructionPending !== null || globalUiPending > 0) {
    return { available: false, track: null, slot: null, trackPosition: -1, slotSceneIndex: -1 };
  }
  var selected = selectedBankTarget();
  if (selected && selected.ambiguous) {
    return {
      available: false,
      track: null,
      slot: null,
      trackPosition: -1,
      slotSceneIndex: -1
    };
  }
  if (selected) {
    var bankTrackPosition = selected.track.position().get();
    var bankSlotSceneIndex = selected.slot.sceneIndex().get();
    return {
      available: selected.track.exists().get() && selected.slot.exists().get() && bankTrackPosition >= 0 && bankSlotSceneIndex >= 0,
      track: selected.track,
      slot: selected.slot,
      trackPosition: bankTrackPosition,
      slotSceneIndex: bankSlotSceneIndex
    };
  }

  var cursorTrackPosition = cursorClipTrack.position().get();
  var cursorSlotSceneIndex = cursorClipSlot.sceneIndex().get();
  return {
    available: cursorClipTrack.exists().get() && cursorClipSlot.exists().get() && cursorTrackPosition >= 0 && cursorSlotSceneIndex >= 0,
    track: cursorClipTrack,
    slot: cursorClipSlot,
    trackPosition: cursorTrackPosition,
    slotSceneIndex: cursorSlotSceneIndex
  };
}

function boundedCursorMatches(target) {
  return target.available &&
    boundedCursorClip.exists().get() &&
    cursorClipTrack.exists().get() &&
    cursorClipSlot.exists().get() &&
    cursorClipTrack.position().get() === target.trackPosition &&
    cursorClipSlot.sceneIndex().get() === target.slotSceneIndex;
}

function targetSignature() {
  var target = currentTargetState();
  return [
    application.projectName().get(),
    target.available,
    target.trackPosition,
    target.slotSceneIndex
  ].join("|");
}

function refreshTargetGeneration() {
  if (constructionPending !== null) constructionPending.version += 1;
  if (bankNavigation !== null) bankNavigation.version += 1;
  var nextSignature = targetSignature();
  if (lastTargetSignature !== null && nextSignature !== lastTargetSignature) {
    targetGeneration += 1;
  }
  lastTargetSignature = nextSignature;
}

function anchorBoundedGrid() {
  boundedCursorClip.scrollToStep(0);
  boundedCursorClip.scrollToKey(0);
}

function currentTargetBinding() {
  requireSettledBank();
  refreshTargetGeneration();
  var target = currentTargetState();
  return {
    controllerInstanceId: controllerInstanceId,
    projectName: application.projectName().get(),
    trackPosition: target.trackPosition,
    slotSceneIndex: target.slotSceneIndex,
    targetGeneration: targetGeneration
  };
}

function sameTargetBinding(left, right) {
  return left && right &&
    left.controllerInstanceId === right.controllerInstanceId &&
    left.projectName === right.projectName &&
    left.trackPosition === right.trackPosition &&
    left.slotSceneIndex === right.slotSceneIndex &&
    left.targetGeneration === right.targetGeneration;
}

function requireCurrentTarget(binding) {
  if (!binding || typeof binding !== "object") {
    throw invalidParams("Missing target binding");
  }
  var current = currentTargetBinding();
  if (!sameTargetBinding(binding, current)) {
    throw bridgeError(-32003, "Target identity changed; create and confirm a fresh plan");
  }
  var target = currentTargetState();
  if (!target.available) {
    throw bridgeError(-32004, "No stable launcher target is selected");
  }
  return target;
}

function isIntegerInRange(value, minimum, maximum) {
  return typeof value === "number" && isFinite(value) && Math.floor(value) === value && value >= minimum && value <= maximum;
}

function isQuarterBeat(value) {
  return typeof value === "number" && isFinite(value) && value > 0 && Math.abs(value * 4 - Math.round(value * 4)) < 0.0000001;
}

function readTargetNotes(target) {
  if (!target.available || !target.slot.hasContent().get() || !boundedCursorMatches(target)) {
    return [];
  }
  anchorBoundedGrid();
  var notes = [];
  for (var step = 0; step < TARGET_GRID_STEPS; step++) {
    for (var pitch = 0; pitch < 128; pitch++) {
      var note = boundedCursorClip.getStep(0, step, pitch);
      if (String(note.state()) === "NoteOn") {
        notes.push({
          channel: note.channel(),
          step: step,
          pitch: pitch,
          velocity: Math.max(1, Math.min(127, Math.round(note.velocity() * 127))),
          durationBeats: note.duration()
        });
      }
    }
  }
  return notes;
}

function inspectBoundTarget(bridgeSession) {
  var target = currentTargetState();
  var binding = currentTargetBinding();
  var clipExists = boundedCursorMatches(target);
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    controllerInstanceId: controllerInstanceId,
    projectName: binding.projectName,
    writeAuthenticated: Boolean(bridgeSession.authenticated),
    target: {
      available: target.available,
      binding: binding,
      trackName: target.available ? target.track.name().get() : "",
      slotName: target.available ? target.slot.name().get() : "",
      hasContent: target.available ? target.slot.hasContent().get() : false,
      clipExists: clipExists,
      clipLengthBeats: clipExists ? boundedCursorClip.getLoopLength().get() : null
    },
    transport: {
      tempoBpm: transport.tempo().value().getRaw(),
      positionBeats: transport.getPosition().get(),
      isPlaying: transport.isPlaying().get()
    },
    grid: {
      stepSizeBeats: TARGET_STEP_SIZE_BEATS,
      maxSteps: TARGET_GRID_STEPS
    },
    notes: target.available ? readTargetNotes(target) : []
  };
}

function isValidTrackIndex(index) {
  return typeof index === "number" && index >= 0 && index < 8 && Math.floor(index) === index;
}

function requireSettledBank() {
  if (globalUiPending > 0) throw bridgeError(-32004, "Global UI command is awaiting controller update cycles; its effect remains unverified");
  if (constructionPending !== null && !constructionReadAccess) throw bridgeError(-32004, "Construction is awaiting observed state; retry after controller updates");
  if (bankNavigation !== null) throw bridgeError(-32004, "Track bank navigation is synchronizing; retry after controller updates");
}

function beginBankNavigation(position, destination) {
  requireSettledBank();
  // Revoke confirmed bindings before touching any retargetable host proxy.
  targetGeneration += 1;
  bankNavigation = { from: position, destination: destination, observed: false,
    version: 0, flushedVersion: -1 };
  invalidateInspection();
}

function observeBankNavigationPosition(position) {
  if (bankNavigation === null) return;
  bankNavigation.version += 1;
  bankNavigation.observed = isIntegerInRange(position, 0, 2147483647) &&
    (bankNavigation.destination === null ? position !== bankNavigation.from : position === bankNavigation.destination);
}

function requireBankIndex(index, label) {
  if (!isIntegerInRange(index, 0, 7)) throw invalidParams(label + " must be an integer from 0 to 7");
  return index;
}

function requireExistingTrack(index) {
  requireSettledBank();
  var track = trackBank.getItemAt(requireBankIndex(index, "Track index"));
  if (track.exists().get() !== true || !isIntegerInRange(track.position().get(), 0, 2147483647)) {
    throw bridgeError(-32004, "Track is unavailable in the current bank window");
  }
  return track;
}

function requirePortName(name) {
  if (typeof name !== "string" || name.length < 1 || name.length > 128 ||
      name.trim().length === 0 || /[\x00-\x1f\x7f-\x9f]/.test(name)) {
    throw invalidParams("Name must contain 1 to 128 characters without control characters");
  }
  return name;
}

function inspectTrack(index) {
  requireSettledBank();
  var track = trackBank.getItemAt(requireBankIndex(index, "Track index"));
  var exists = track.exists().get();
  if (typeof exists !== "boolean") throw bridgeError(-32004, "Track state is unavailable");
  var position = track.position().get();
  if (exists && !isIntegerInRange(position, 0, 2147483647)) throw bridgeError(-32004, "Track identity is unavailable");
  return { index: index, exists: exists, position: exists ? position : null,
    name: exists ? track.name().get() : null,
    volume: exists ? track.volume().get() : null, pan: exists ? track.pan().get() : null,
    mute: exists ? track.mute().get() : null, solo: exists ? track.solo().get() : null,
    arm: exists ? track.arm().get() : null,
    color: exists ? { red: track.color().red(), green: track.color().green(), blue: track.color().blue() } : null };
}

function inspectTracks() {
  var tracks = [];
  for (var index = 0; index < 8; index++) tracks.push(inspectTrack(index));
  return tracks;
}

function inspectSlot(trackIndex, slotIndex) {
  requireBankIndex(trackIndex, "Track index");
  requireBankIndex(slotIndex, "Slot index");
  var track = inspectTrack(trackIndex);
  var slot = trackBank.getItemAt(trackIndex).clipLauncherSlotBank().getItemAt(slotIndex);
  var slotExists = slot.exists().get();
  if (typeof slotExists !== "boolean") throw bridgeError(-32004, "Slot state is unavailable");
  var exists = track.exists && slotExists;
  var sceneIndex = slot.sceneIndex().get();
  if (exists && !isIntegerInRange(sceneIndex, 0, 2147483647)) throw bridgeError(-32004, "Slot identity is unavailable");
  var content = exists ? slot.hasContent().get() : false;
  if (typeof content !== "boolean") throw bridgeError(-32004, "Slot content state is unavailable");
  return { trackIndex: trackIndex, trackPosition: track.position, slotIndex: slotIndex,
    slotSceneIndex: exists ? sceneIndex : null, exists: exists, hasContent: content,
    name: exists ? slot.name().get() : null,
    isSelected: exists ? slot.isSelected().get() : false,
    isPlaying: exists ? slot.isPlaying().get() : false,
    isRecording: exists ? slot.isRecording().get() : false,
    isPlaybackQueued: exists ? slot.isPlaybackQueued().get() : false };
}

function inspectScenes() {
  var scenes = [];
  for (var index = 0; index < 8; index++) {
    var scene = sceneBank.getScene(index);
    var exists = scene.exists().get();
    var position = scene.sceneIndex().get();
    if (typeof exists !== "boolean" || (exists && !isIntegerInRange(position, 0, 2147483647))) {
      throw bridgeError(-32004, "Scene state is unavailable");
    }
    scenes.push({ index: index, exists: exists, sceneIndex: exists ? position : null,
      name: exists ? scene.name().get() : null });
  }
  return scenes;
}

function inspectTrackWindow() {
  requireSettledBank();
  var position = trackBank.scrollPosition().get();
  var count = trackBank.itemCount().get();
  if (!isIntegerInRange(position, 0, 2147483647) || !isIntegerInRange(count, 0, 2147483647)) {
    throw bridgeError(-32004, "Track bank position or count is unavailable");
  }
  return { size: 8, scrollPosition: position, trackCount: count };
}

function invalidateInspection() {
  inspectionVersion += 1;
  inspectionSettledVersion = -1;
}

function watchAdvancedValue(value, key, group) {
  if (!advancedState[group]) advancedState[group] = { version: 0, flushedVersion: -1, settledVersion: -1, seen: {} };
  value.markInterested();
  value.addValueObserver(function () {
    var state = advancedState[group];
    state.seen[key] = true;
    state.version += 1;
    state.settledVersion = -1;
  });
}

function requireObservedAdvanced(key, group) {
  var state = advancedState[group];
  if (state.seen[key] !== true || state.settledVersion !== state.version) throw bridgeError(-32004, "Requested " + group + " state is not observed and settled yet");
}

function observedBoolean(value, key, group) {
  requireObservedAdvanced(key, group);
  var current = value.get();
  if (typeof current !== "boolean") throw bridgeError(-32004, "Boolean state is unavailable");
  return current;
}

function invalidateAdvancedValue(key, group) {
  var state = advancedState[group];
  state.seen[key] = false;
  state.version += 1;
  state.settledVersion = -1;
}

function setObservedBoolean(value, key, group, next) {
  var current = observedBoolean(value, key, group);
  if (current === next) return;
  invalidateAdvancedValue(key, group);
  value.set(next);
}

function arrangerPanelValues() {
  return { timeline: arranger.isTimelineVisible(), io: arranger.isIoSectionVisible(),
    clip_launcher: arranger.isClipLauncherVisible(), effect_tracks: arranger.areEffectTracksVisible(),
    double_row_height: arranger.hasDoubleRowTrackHeight(), cue_markers: arranger.areCueMarkersVisible(),
    playback_follow: arranger.isPlaybackFollowEnabled() };
}

function requireArgumentCount(params, count) {
  if (params === undefined && count === 0) return;
  if (!Array.isArray(params) || params.length !== count) throw invalidParams("Expected exactly " + count + " parameters");
}

function requireBooleanArgument(value) {
  if (typeof value !== "boolean") throw invalidParams("Expected boolean state");
  return value;
}

function inspectCue(index) {
  if (!isIntegerInRange(index, 0, 31)) throw invalidParams("Cue index must be an integer from 0 to 31");
  requireObservedAdvanced(index + ".exists", "cues");
  var marker = cueMarkerBank.getItemAt(index);
  var exists = marker.exists().get();
  if (typeof exists !== "boolean") throw bridgeError(-32004, "Cue existence is unavailable");
  if (!exists) return null;
  requireObservedAdvanced(index + ".name", "cues");
  requireObservedAdvanced(index + ".position", "cues");
  requireObservedAdvanced(index + ".color", "cues");
  var name = marker.name().get();
  var position = marker.position().get();
  var color = marker.getColor();
  var rgb = { r: color.red(), g: color.green(), b: color.blue() };
  if (typeof name !== "string" || typeof position !== "number" || !isFinite(position) || position < 0) throw bridgeError(-32004, "Cue metadata is unavailable");
  for (var colorName in rgb) {
    if (typeof rgb[colorName] !== "number" || !isFinite(rgb[colorName]) || rgb[colorName] < 0 || rgb[colorName] > 1) throw bridgeError(-32004, "Cue color is unavailable");
  }
  return { index: index, name: name, positionBeats: position, color: rgb };
}

function inspectCueWindow() {
  requireObservedAdvanced("count", "cues");
  requireObservedAdvanced("offset", "cues");
  var count = cueMarkerBank.itemCount().get();
  var offset = cueMarkerBank.scrollPosition().get();
  if (!isIntegerInRange(count, 0, 2147483647) || !isIntegerInRange(offset, 0, Math.max(0, count - 1))) throw bridgeError(-32004, "Cue bank count or offset is unavailable");
  return { bankSize: 32, scrollPosition: offset, projectMarkerCount: count, complete: offset === 0 && count <= 32 };
}

function watchMixValue(value, key, group) {
  if (key === "volume" || key === "pan" || key === "level") {
    // Automation changes current levels continuously; it must not invalidate
    // settled proxy identity or unrelated reads on every frame.
    if (!advancedState[group]) advancedState[group] = { version: 0, flushedVersion: -1, settledVersion: -1, seen: {} };
    var observation = { numericCallbackReceived: false, awaitingNumericCallback: false, displayReceived: false };
    mixValueObservations[group + "." + key] = observation;
    advancedState[group].seen[key] = false;
    value.markInterested();
    value.addValueObserver(function () {
      observation.numericCallbackReceived = true;
      observation.awaitingNumericCallback = false;
      advancedState[group].seen[key] = true;
    });
    // Bitwig 6.1's ranged-value proxy suppresses the initial numeric callback
    // when its subscribed value is the default zero. Value.markInterested/get
    // still provides the current host cache (API 2). A real display callback
    // supplies initialization evidence; it is NOT a numeric observation.
    if (typeof value.displayedValue === "function") {
      var display = value.displayedValue();
      display.markInterested();
      display.addValueObserver(function (text) {
        var received = typeof text === "string" && text.length > 0;
        if (observation.displayReceived !== received) {
          observation.displayReceived = received;
          advancedState[group].version += 1;
          advancedState[group].settledVersion = -1;
        }
      });
    }
  } else {
    watchAdvancedValue(value, key, group);
    value.addValueObserver(observeConstructionChange);
  }
}

function watchChannelValues(track, group, cursor) {
  var values = { exists: track.exists(), position: track.position(), name: track.name(),
    volume: track.volume(), pan: track.pan(), mute: track.mute(), solo: track.solo() };
  if (cursor) { values.arm = track.arm(); values.type = track.trackType(); values.color = track.color(); }
  for (var key in values) watchMixValue(values[key], key, group);
}

function requireNormalized(value) {
  if (typeof value !== "number" || !isFinite(value) || value < 0 || value > 1) throw invalidParams("Value must be a finite normalized number from 0 to 1");
  return value;
}

function mixObserved(value, key, group, type) {
  requireObservedAdvanced(key, group);
  var result = value.get();
  if (typeof result !== type || (type === "number" && !isFinite(result))) throw bridgeError(-32004, "Mixer/cursor state unavailable");
  return result;
}

function mixNormalized(value, key, group) {
  var state = advancedState[group];
  var observation = mixValueObservations[group + "." + key];
  var initialCurrent = observation && !observation.numericCallbackReceived &&
    !observation.awaitingNumericCallback && observation.displayReceived;
  if (!state || state.settledVersion !== state.version || (state.seen[key] !== true && !initialCurrent)) {
    throw bridgeError(-32004, "Requested " + group + " state is not observed and settled yet");
  }
  var result = value.get();
  if (typeof result !== "number" || !isFinite(result) || result < 0 || result > 1) throw bridgeError(-32004, "Normalized mixer state unavailable");
  // Only the known suppressed initial zero uses the current-value contract.
  // Changed nonzero values still require their numeric callback.
  if (state.seen[key] !== true && result !== 0) throw bridgeError(-32004, "Normalized numeric callback is pending");
  return result;
}

function invalidateMixNormalized(key, group) {
  advancedState[group].seen[key] = false;
  var observation = mixValueObservations[group + "." + key];
  if (observation) observation.awaitingNumericCallback = true;
}

function mixObservationDiagnostics() {
  var initialCurrent = [], pending = [];
  for (var id in mixValueObservations) {
    var observation = mixValueObservations[id];
    if (observation.awaitingNumericCallback) pending.push(id);
    else if (!observation.numericCallbackReceived && observation.displayReceived) initialCurrent.push(id);
  }
  return { valueSource: "interested_host_cached_getter", initialZeroReadiness: "nonempty_display_callback_and_settled_identity",
    initialZeroWithoutNumericCallback: initialCurrent, awaitingNumericCallback: pending,
    mutationConfirmation: "numeric_callback_required" };
}

function setMixNormalized(value, key, group, next, cursorKey, cursorMatches) {
  requireNormalized(next);
  var current = mixNormalized(value, key, group);
  if (current === next) return;
  if (cursorKey && mixObserved(cursorMatches, "cursorMatch", group, "boolean")) {
    invalidateMixNormalized(cursorKey, "cursorTrack");
  }
  invalidateMixNormalized(key, group);
  targetGeneration += 1;
  // An absolute MCP command has no physical fader to cross a takeover point.
  // Preserve observation/readback guards while bypassing hardware takeover.
  value.setImmediately(next);
}

function observedColor(color, key, group) {
  requireObservedAdvanced(key, group);
  var result = { red: color.red(), green: color.green(), blue: color.blue() };
  for (var component in result) {
    if (typeof result[component] !== "number" || !isFinite(result[component]) || result[component] < 0 || result[component] > 1) throw bridgeError(-32004, "Color state unavailable");
  }
  return result;
}

function mixChannelStatus(track, group, cursor) {
  var exists = mixObserved(track.exists(), "exists", group, "boolean");
  var result = { exists: exists, name: null, position: null, volume: null, pan: null, mute: null, solo: null };
  if (cursor) { result.type = null; result.arm = null; result.color = null; }
  if (!exists) return result;
  result.name = mixObserved(track.name(), "name", group, "string");
  result.position = mixObserved(track.position(), "position", group, "number");
  if (!isIntegerInRange(result.position, 0, 2147483647)) throw bridgeError(-32004, "Track identity unavailable");
  result.volume = mixNormalized(track.volume(), "volume", group);
  result.pan = mixNormalized(track.pan(), "pan", group);
  result.mute = mixObserved(track.mute(), "mute", group, "boolean");
  result.solo = mixObserved(track.solo(), "solo", group, "boolean");
  if (cursor) {
    result.type = mixObserved(track.trackType(), "type", group, "string");
    result.arm = mixObserved(track.arm(), "arm", group, "boolean");
    result.color = observedColor(track.color(), "color", group);
  }
  return result;
}

function requireStoppedStructure() {
  requireSettledBank();
  if (mixObserved(transport.isPlaying(), "playing", "mixSafety", "boolean") !== false ||
      mixObserved(transport.isArrangerRecordEnabled(), "recording", "mixSafety", "boolean") !== false) throw bridgeError(-32004, "Stop transport and recording before structural operations");
}

function initParityGlobals() {
  var appValues = { projectName: application.projectName(), panelLayout: application.panelLayout(),
    displayProfile: application.displayProfile(), engine: application.hasActiveEngine(),
    canUndo: application.canUndo(), canRedo: application.canRedo() };
  for (var key in appValues) watchMixValue(appValues[key], key, "application");
  watchMixValue(project.hasSoloedTracks(), "solo", "project");
  watchMixValue(project.hasMutedTracks(), "mute", "project");
  watchMixValue(project.hasArmedTracks(), "arm", "project");
  groove = host.createGroove();
  var grooveValues = grooveParameters();
  for (var grooveKey in grooveValues) watchMixValue(grooveValues[grooveKey], "level", "groove." + grooveKey);
}

function grooveParameters() {
  return { enabled: groove.getEnabled(), shuffleAmount: groove.getShuffleAmount(),
    shuffleRate: groove.getShuffleRate(), accentAmount: groove.getAccentAmount(),
    accentRate: groove.getAccentRate(), accentPhase: groove.getAccentPhase() };
}

function initDrumPads() {
  drumPadBank = cursorDevice.createDrumPadBank(16);
  watchMixValue(cursorDevice.hasDrumPads(), "hasPads", "drums");
  watchMixValue(drumPadBank.scrollPosition(), "offset", "drums");
  watchMixValue(drumPadBank.itemCount(), "count", "drums");
  watchMixValue(drumPadBank.canScrollForwards(), "forward", "drums");
  watchMixValue(drumPadBank.canScrollBackwards(), "backward", "drums");
  for (var index = 0; index < 16; index++) {
    var pad = drumPadBank.getItemAt(index);
    var values = { exists: pad.exists(), name: pad.name(), volume: pad.volume(), mute: pad.mute(), solo: pad.solo() };
    for (var key in values) watchMixValue(values[key], key, "pad" + index);
    observePadSelection(pad, index);
  }
}

function observePadSelection(pad, index) {
  pad.addIsSelectedInEditorObserver(function (selected) {
    drumPadSelected[index] = selected;
    var state = advancedState["pad" + index];
    state.seen.selected = true; state.version += 1; state.settledVersion = -1;
    observeConstructionChange();
  });
}

function parityDispatch(scope, command) {
  return { status: "dispatched", command: command, scope: scope, verified: false, effectVerified: false };
}

function dispatchGlobalUi(command, object, method) {
  requireStoppedStructure();
  // Layout and cursor selection are not keyboard focus. No fabricated target
  // acknowledgement: a global command may legally have no observable effect.
  targetGeneration += 1; invalidateInspection(); globalUiPending = 2;
  if (/^application\.(undo|redo|cut|paste|delete|duplicate|enter)$/.test(command) && advancedState.application) {
    advancedState.application.seen.canUndo = false;
    advancedState.application.seen.canRedo = false;
  }
  object[method]();
  var result = parityDispatch("global_ui", command);
  result.focusVerified = false;
  return result;
}

function optionalObservedBoolean(value, key, group) {
  var state = advancedState[group];
  if (!state || !state.seen[key] || state.settledVersion !== state.version) return null;
  var current = value.get();
  return typeof current === "boolean" ? current : null;
}

function inspectDrumWindow() {
  requireSettledBank();
  var device = cursorDeviceStatus();
  if (!device.exists || mixObserved(cursorDevice.hasDrumPads(), "hasPads", "drums", "boolean") !== true) throw bridgeError(-32004, "Selected existing device with drum pads required");
  var offset = mixObserved(drumPadBank.scrollPosition(), "offset", "drums", "number");
  var count = mixObserved(drumPadBank.itemCount(), "count", "drums", "number");
  if (!isIntegerInRange(count, 0, 128) || !isIntegerInRange(offset, 0, Math.max(0, count - 1))) throw bridgeError(-32004, "Drum bank observations unavailable");
  return { bankSize: 16, scrollPosition: offset, padCount: count, complete: offset === 0 && count <= 16 };
}

function requireDrumPad(index) {
  if (!isIntegerInRange(index, 0, 15)) throw invalidParams("Drum pad index must be an integer from 0 to 15");
  var window = inspectDrumWindow();
  var pad = drumPadBank.getItemAt(index);
  if (window.scrollPosition + index >= window.padCount || mixObserved(pad.exists(), "exists", "pad" + index, "boolean") !== true) throw bridgeError(-32004, "Existing observed drum pad required");
  return pad;
}

function drumIdentity() {
  var trackPosition = cursorTrack.position().get(), devicePosition = cursorDevice.position().get();
  return function () { return cursorTrack.position().get() === trackPosition && cursorDevice.position().get() === devicePosition; };
}

function beginParityObserved(matches, identity) {
  // Reuse the construction barrier: real callbacks must match the expected
  // outcome, then two quiet flush cycles release bank-relative writes.
  beginConstruction(matches, identity);
}

function invalidateProjectChannels(key) {
  if (channelValue(cursorTrack, key).get() === true) advancedState.cursorTrack.seen[key] = false;
  if (key !== "arm") {
    for (var i = 0; i < 8; i++) {
      if (channelValue(effectTrackBank.getItemAt(i), key).get() === true) advancedState["return" + i].seen[key] = false;
    }
  }
}

function observedCount(bank, group) {
  var count = mixObserved(bank.itemCount(), "count", group, "number");
  if (!isIntegerInRange(count, 0, 2147483647)) throw bridgeError(-32004, "Bank count unavailable");
  return count;
}

function beginTrackStructure(bank, expectedCount, group) {
  requireSettledBank();
  var projectName = application.projectName().get();
  targetGeneration += 1;
  invalidateInspection();
  // Track positions are expected to move. Keep project scope and exact count
  // instead of imposing the immutable bank identity used for clip construction.
  advancedState[group].seen.count = false;
  constructionPending = { matches: function () { return advancedState[group].seen.count === true && bank.itemCount().get() === expectedCount; },
    identity: function () { return application.projectName().get() === projectName; },
    observed: false, failed: false, version: 0, flushedVersion: -1 };
}

function requireBankDevice(trackIndex, deviceIndex) {
  var track = requireExistingTrack(trackIndex);
  requireBankIndex(deviceIndex, "Device index");
  var group = "device" + trackIndex + ":" + deviceIndex;
  var device = deviceBanks[trackIndex].getItemAt(deviceIndex);
  if (mixObserved(device.exists(), "exists", group, "boolean") !== true ||
      !isIntegerInRange(mixObserved(device.position(), "position", group, "number"), 0, 2147483647)) throw bridgeError(-32004, "Existing device required");
  return device;
}

function cursorDeviceStatus() {
  var track = mixChannelStatus(cursorTrack, "cursorTrack", true);
  var exists = mixObserved(cursorDevice.exists(), "exists", "cursorDevice", "boolean");
  var result = { exists: exists && track.exists, trackPosition: track.position, name: null, position: null,
    isEnabled: null, isWindowOpen: null, isExpanded: null };
  if (!result.exists) return result;
  result.name = mixObserved(cursorDevice.name(), "name", "cursorDevice", "string");
  result.position = mixObserved(cursorDevice.position(), "position", "cursorDevice", "number");
  if (!isIntegerInRange(result.position, 0, 2147483647)) throw bridgeError(-32004, "Device identity unavailable");
  result.isEnabled = mixObserved(cursorDevice.isEnabled(), "isEnabled", "cursorDevice", "boolean");
  result.isWindowOpen = mixObserved(cursorDevice.isWindowOpen(), "isWindowOpen", "cursorDevice", "boolean");
  result.isExpanded = mixObserved(cursorDevice.isExpanded(), "isExpanded", "cursorDevice", "boolean");
  return result;
}

function cursorTrackIdentity(position) {
  return function () { return cursorTrack.exists().get() === true && cursorTrack.position().get() === position; };
}

function channelValue(track, key) {
  // Computed member lookup can resolve Java bean properties to their values
  // rather than callable methods in the host's JavaScript interop.
  switch (key) {
    case "volume": return track.volume();
    case "pan": return track.pan();
    case "mute": return track.mute();
    case "solo": return track.solo();
    case "arm": return track.arm();
    default: throw invalidParams("Unknown channel value");
  }
}

function invalidateLegacyBankField(index, key, next) {
  var track = requireExistingTrack(index);
  if (channelValue(track, key).get() === next) return;
  invalidateProjectAggregate(key);
  if (mixObserved(mainCursorMatches[index], "cursorMatch", "mainTrack" + index, "boolean")) invalidateMixNormalized(key, "cursorTrack");
}

function invalidateProjectAggregate(key) {
  if (advancedState.project && (key === "mute" || key === "solo" || key === "arm")) advancedState.project.seen[key] = false;
}

function invalidateLegacySelectedField(key, next) {
  if (key === "volume" || key === "pan") mixNormalized(channelValue(cursorTrack, key), key, "cursorTrack");
  else requireObservedAdvanced(key, "cursorTrack");
  if (channelValue(cursorTrack, key).get() === next) return;
  var affected = [];
  if (key === "volume" && mixObserved(masterCursorMatches, "cursorMatch", "master", "boolean")) affected.push(["master", "level"]);
  if (["volume", "pan", "mute", "solo"].indexOf(key) >= 0) {
    for (var i = 0; i < 8; i++) {
      if (mixObserved(returnCursorMatches[i], "cursorMatch", "return" + i, "boolean")) affected.push(["return" + i, key]);
    }
  }
  invalidateMixNormalized(key, "cursorTrack");
  for (var i = 0; i < affected.length; i++) invalidateMixNormalized(affected[i][1], affected[i][0]);
}

function readInspectionNotes(trackIndex, slotIndex) {
  var slot = inspectSlot(trackIndex, slotIndex);
  if (!slot.exists || !slot.hasContent || slot.isSelected !== true ||
      inspectionClip.exists().get() !== true || inspectionTrack.exists().get() !== true ||
      inspectionSlot.exists().get() !== true || inspectionSlot.hasContent().get() !== true ||
      inspectionTrack.position().get() !== slot.trackPosition ||
      inspectionSlot.sceneIndex().get() !== slot.slotSceneIndex) {
    throw bridgeError(-32004, "Select the requested existing launcher clip and wait for cursor synchronization");
  }
  if (inspectionSettledVersion !== inspectionVersion) {
    throw bridgeError(-32004, "Note inspection is synchronizing; retry after controller updates");
  }
  var length = inspectionClip.getLoopLength().get();
  if (typeof length !== "number" || !isFinite(length) || length <= 0) throw bridgeError(-32004, "Clip length is unavailable");
  var notes = [];
  for (var step = 0; step < TARGET_GRID_STEPS; step++) {
    for (var pitch = 0; pitch < 128; pitch++) {
      var note = inspectionClip.getStep(0, step, pitch);
      if (!note) throw bridgeError(-32004, "Note grid is unavailable");
      var state = String(note.state());
      if (state !== "NoteOn" && state !== "NoteSustain" && state !== "Empty") {
        throw bridgeError(-32004, "Note grid state is unavailable");
      }
      if (state === "NoteOn") {
        var velocity = note.velocity();
        var duration = note.duration();
        if (note.channel() !== 0 || note.x() !== step || note.y() !== pitch ||
            typeof velocity !== "number" || !isFinite(velocity) || velocity < 0 || velocity > 1 ||
            typeof duration !== "number" || !isFinite(duration) || duration <= 0) {
          throw bridgeError(-32004, "Note grid data is unavailable");
        }
        notes.push({ channel: 0, step: step, pitch: pitch,
          velocity: Math.max(1, Math.round(velocity * 127)), durationBeats: duration });
      }
    }
  }
  return { trackIndex: trackIndex, trackPosition: slot.trackPosition, slotIndex: slotIndex,
    slotSceneIndex: slot.slotSceneIndex, clipLengthBeats: length,
    coverage: { startStep: 0, stepCount: TARGET_GRID_STEPS, stepSizeBeats: TARGET_STEP_SIZE_BEATS,
      minPitch: 0, maxPitch: 127, channels: [0], completeClip: false }, notes: notes };
}

function observeSceneSelection(index, scene) {
  scene.addIsSelectedInEditorObserver(function (selected) {
    sceneSelected[index] = selected;
    observeConstructionChange();
  });
}

function observeConstructionChange() {
  if (constructionPending === null) return;
  constructionPending.version += 1;
  constructionPending.observed = constructionMatches();
}

function constructionBankIdentity() {
  var identity = [application.projectName().get(), trackBank.scrollPosition().get()];
  for (var i = 0; i < 8; i++) {
    var track = trackBank.getItemAt(i);
    identity.push(track.exists().get(), track.position().get());
  }
  return identity.join("|");
}

function constructionMatches() {
  try {
    return constructionPending !== null && constructionPending.identity() && constructionPending.matches();
  } catch (unavailableState) {
    return false;
  }
}

function cursorConstructionIdentity() {
  var trackPosition = inspectionTrack.position().get();
  var slotPosition = inspectionSlot.sceneIndex().get();
  return function () {
    return inspectionTrack.exists().get() === true && inspectionSlot.exists().get() === true &&
      inspectionTrack.position().get() === trackPosition && inspectionSlot.sceneIndex().get() === slotPosition;
  };
}

function slotConstructionIdentity(trackIndex, slot) {
  var track = trackBank.getItemAt(trackIndex);
  var trackPosition = track.position().get();
  var slotPosition = slot.sceneIndex().get();
  return function () {
    return track.exists().get() === true && slot.exists().get() === true &&
      track.position().get() === trackPosition && slot.sceneIndex().get() === slotPosition;
  };
}

function beginConstruction(matches, identity) {
  requireSettledBank();
  var bankIdentity = constructionBankIdentity();
  targetGeneration += 1;
  invalidateInspection();
  constructionPending = { matches: matches, identity: function () {
    return constructionBankIdentity() === bankIdentity && (!identity || identity());
  }, observed: false, failed: false, version: 0, flushedVersion: -1 };
}

function canReadConstructionFailure(method) {
  if (constructionPending === null || !constructionPending.failed || inspectionSettledVersion !== inspectionVersion) return false;
  var reads = ["clip.get_notes", "clip.get_status", "clip.get_grid", "clip.get_color", "track.list", "track.get_info", "project.get_summary", "cursor_track.get_status", "cursor_device.get_status", "cursor_clip.get_status", "mixer.master.get_volume", "mixer.track.get_send", "mixer.return.list"];
  try { return reads.indexOf(method) >= 0 && constructionPending.identity(); } catch (unavailableState) { return false; }
}

function safeHostError(error) {
  return String(error && error.message || error).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 300);
}

function constructionResult() {
  return { status: "dispatched", verified: false, requiresReadback: true };
}

function requireConstructionSlot(trackIndex, slotIndex, occupied) {
  var status = inspectSlot(trackIndex, slotIndex);
  if (!status.exists || status.hasContent !== occupied) throw bridgeError(-32004, occupied ? "Existing clip required" : "Known empty destination required");
  if (status.isPlaying !== false || status.isRecording !== false || status.isPlaybackQueued !== false) {
    throw bridgeError(-32004, "Clip must be stopped, not recording, and not queued");
  }
  return trackBank.getItemAt(trackIndex).clipLauncherSlotBank().getItemAt(slotIndex);
}

function requireConstructionCursor(trackIndex, slotIndex, requireZeroLoop) {
  var slot = requireConstructionSlot(trackIndex, slotIndex, true);
  readInspectionNotes(trackIndex, slotIndex);
  if (requireZeroLoop && inspectionClip.getLoopStart().get() !== 0) throw bridgeError(-32004, "Bounded note construction requires loop start at zero");
  return slot;
}

function requireScene(index) {
  requireSettledBank();
  var scene = sceneBank.getScene(requireBankIndex(index, "Scene index"));
  if (scene.exists().get() !== true || !isIntegerInRange(scene.sceneIndex().get(), 0, 2147483647)) throw bridgeError(-32004, "Existing scene required");
  return scene;
}

function sceneConstructionSignature() {
  var count = sceneBank.itemCount().get();
  if (!isIntegerInRange(count, 0, 2147483647)) throw bridgeError(-32004, "Scene count unavailable");
  var signature = [count];
  for (var i = 0; i < 8; i++) {
    var scene = sceneBank.getScene(i);
    signature.push(scene.exists().get(), scene.sceneIndex().get(), scene.clipCount().get());
  }
  return signature.join("|");
}

function validateNoteBatch(notes, clear, length) {
  if (!Array.isArray(notes) || notes.length < 1 || notes.length > 256) throw invalidParams("Provide 1 to 256 note coordinates");
  var used = {};
  for (var i = 0; i < notes.length; i++) {
    var note = notes[i];
    if (!note || typeof note !== "object" || Array.isArray(note) ||
        !isIntegerInRange(note.step, 0, 63) || !isIntegerInRange(note.pitch, 0, 127)) throw invalidParams("Note coordinates must use steps 0-63 and pitches 0-127");
    var keys = Object.keys(note);
    var allowed = clear ? ["step", "pitch"] : ["step", "pitch", "velocity", "durationBeats"];
    for (var k = 0; k < keys.length; k++) if (allowed.indexOf(keys[k]) < 0) throw invalidParams("Unexpected note field");
    var coordinate = note.step + ":" + note.pitch;
    if (used[coordinate]) throw invalidParams("Duplicate note coordinates");
    used[coordinate] = true;
    var state = String(inspectionClip.getStep(0, note.step, note.pitch).state());
    if (clear) {
      if (state !== "NoteOn") throw bridgeError(-32004, "Clear requires an observed note start at every coordinate");
      continue;
    }
    if (!isIntegerInRange(note.velocity, 1, 127) || !isQuarterBeat(note.durationBeats) ||
        note.step * 0.25 + note.durationBeats > Math.min(16, length)) throw invalidParams("Note velocity or duration is outside the bounded clip");
    var end = note.step + note.durationBeats * 4;
    for (var step = note.step; step < end; step++) {
      if (String(inspectionClip.getStep(0, step, note.pitch).state()) !== "Empty") throw bridgeError(-32005, "Note insertion would overlap existing or unknown note data");
    }
    for (var previous = 0; previous < i; previous++) {
      var other = notes[previous];
      if (other.pitch === note.pitch && note.step < other.step + other.durationBeats * 4 && other.step < end) throw invalidParams("Batch notes overlap on the same pitch");
    }
  }
}

function dispatchNoteBatch(notes, clear) {
  var dispatched = 0;
  beginConstruction(function () {
    for (var i = 0; i < notes.length; i++) {
      var note = notes[i];
      var observed = inspectionClip.getStep(0, note.step, note.pitch);
      if (String(observed.state()) !== (clear ? "Empty" : "NoteOn")) return false;
      if (!clear && (Math.round(observed.velocity() * 127) !== note.velocity || Math.abs(observed.duration() - note.durationBeats) > 0.000001)) return false;
    }
    return true;
  }, cursorConstructionIdentity());
  try {
    for (var i = 0; i < notes.length; i++) {
      var note = notes[i];
      if (clear) inspectionClip.clearStep(0, note.step, note.pitch);
      else inspectionClip.setStep(0, note.step, note.pitch, note.velocity, note.durationBeats);
      dispatched += 1;
    }
  } catch (error) {
    constructionPending.failed = true;
    return { status: "partial", dispatchedCount: dispatched, totalCount: notes.length,
      verified: false, requiresReadback: true, uncertain: true, recovery: "readback_then_reload_controller", error: safeHostError(error) };
  }
  return { status: "dispatched", dispatchedCount: dispatched, totalCount: notes.length, verified: false, requiresReadback: true };
}

function handleRequest(request, connection, bridgeSession) {
  if (!request.method) {
    sendError(connection, request.id, -32600, "Invalid Request");
    return;
  }

  var result;
  try {
    if (
      request.method !== "bridge.authenticate" &&
      !isBridgeReadMethod(request.method) &&
      !bridgeSession.authenticated
    ) {
      throw bridgeError(-32001, "Write authentication is required");
    }

    constructionReadAccess = canReadConstructionFailure(request.method);
    // During bank retargeting, only bank-independent bridge/transport traffic
    // is safe. This also covers legacy bank-relative mutation handlers.
    if ((bankNavigation !== null || constructionPending !== null || globalUiPending > 0) && request.method !== "ping" &&
        request.method.indexOf("bridge.") !== 0 && request.method.indexOf("transport.") !== 0 &&
        request.method !== "note_input.get_status" && request.method !== "note_input.send_note_off" && request.method !== "note_input.all_notes_off") {
      requireSettledBank();
    }

    if (typeof guardCreativeLegacyRequest === "function") guardCreativeLegacyRequest(request.method, request.params);
    var extensionReply = typeof handleMidiRequest === "function" ? handleMidiRequest(request.method, request.params) : { handled: false };
    if (!extensionReply.handled && typeof handleCreativeRequest === "function") extensionReply = handleCreativeRequest(request.method, request.params);
    if (extensionReply.handled) {
      sendResponse(connection, request.id, extensionReply.result);
      return;
    }

    switch (request.method) {
      case "project.save": case "project.save_as":
        requireArgumentCount(request.params, 1);
        var expectedProjectName = request.params[0];
        if (typeof expectedProjectName !== "string" || expectedProjectName.length < 1 || expectedProjectName.length > 256 || expectedProjectName.trim().length === 0 || /[\x00-\x1f\x7f-\x9f]/.test(expectedProjectName)) throw invalidParams("Expected project name must contain 1-256 characters without control characters");
        requireStoppedStructure();
        var saveProjectName = mixObserved(application.projectName(), "projectName", "application", "string");
        if (saveProjectName !== expectedProjectName) throw bridgeError(-32003, "Project name changed; inspect the active project before requesting save");
        var saveActionId = request.method === "project.save" ? "Save" : "Save as";
        if (typeof application.getAction !== "function") throw bridgeError(-32004, "Project save action is unavailable");
        var saveAction = application.getAction(saveActionId);
        if (!saveAction || typeof saveAction.getId !== "function" || saveAction.getId() !== saveActionId || typeof saveAction.invoke !== "function") throw bridgeError(-32004, "Expected project save action is unavailable");
        // Lookup is not an acknowledgement and names are not persistent IDs.
        // Recheck the observed target immediately before the only host write.
        if (mixObserved(application.projectName(), "projectName", "application", "string") !== expectedProjectName) throw bridgeError(-32003, "Project name changed during save preparation");
        requireStoppedStructure();
        saveAction.invoke();
        // API 1 Action.invoke() has no completion result. Save may open a
        // dialog for an unnamed project, and Save as always needs a target.
        // Do not create a mutation barrier that waits for a nonexistent ack.
        result = { status: "dispatched", command: request.method, actionId: saveActionId,
          projectName: expectedProjectName, identityScope: "project_name_only", projectPath: null,
          verified: false, saved: null, mayOpenDialog: true, requiresUserInteraction: true,
          requiresReadback: true, persistenceVerified: false };
        break;
      case "application.list_actions":
        requireArgumentCount(request.params, 2);
        var actionOffset = request.params[0], actionLimit = request.params[1];
        if (!isIntegerInRange(actionOffset, 0, 4096) || !isIntegerInRange(actionLimit, 1, 64)) throw invalidParams("Action offset must be 0-4096 and limit must be 1-64");
        if (typeof application.getActions !== "function") throw bridgeError(-32004, "Application action catalogue is unavailable");
        var hostActions = application.getActions();
        if (!hostActions || !isIntegerInRange(hostActions.length, 0, 2147483647)) throw bridgeError(-32004, "Application action catalogue is unavailable");
        var actionItems = [], actionEnd = Math.min(hostActions.length, actionOffset + actionLimit);
        for (var actionIndex = actionOffset; actionIndex < actionEnd; actionIndex++) {
          var hostAction = hostActions[actionIndex];
          if (!hostAction || typeof hostAction.getId !== "function" || typeof hostAction.getName !== "function") throw bridgeError(-32004, "Application action metadata is unavailable");
          var actionId = hostAction.getId(), actionName = hostAction.getName();
          if (typeof actionId !== "string" || actionId.length < 1 || actionId.length > 256 || typeof actionName !== "string" || actionName.length > 512) throw bridgeError(-32004, "Application action metadata is unavailable or exceeds bounds");
          actionItems.push({ id: actionId, name: actionName });
        }
        var nextActionOffset = actionOffset + actionItems.length;
        result = { actions: actionItems, count: hostActions.length,
          coverage: { offset: actionOffset, limit: actionLimit, returned: actionItems.length,
            hasMore: nextActionOffset < hostActions.length,
            nextOffset: nextActionOffset < hostActions.length && nextActionOffset <= 4096 ? nextActionOffset : null,
            complete: actionOffset === 0 && actionItems.length === hostActions.length } };
        break;
      case "application.get_status":
        requireArgumentCount(request.params, 0);
        result = { projectName: mixObserved(application.projectName(), "projectName", "application", "string"),
          panelLayout: mixObserved(application.panelLayout(), "panelLayout", "application", "string"),
          displayProfile: mixObserved(application.displayProfile(), "displayProfile", "application", "string"),
          hasActiveEngine: observedBoolean(application.hasActiveEngine(), "engine", "application"),
          canUndo: optionalObservedBoolean(application.canUndo(), "canUndo", "application"),
          canRedo: optionalObservedBoolean(application.canRedo(), "canRedo", "application"),
          keyboardFocus: null, clipboardContents: null, scope: "global_ui" };
        result.availabilityObserved = result.canUndo !== null && result.canRedo !== null;
        break;
      case "application.undo": case "application.redo": case "application.cut": case "application.copy":
      case "application.paste": case "application.delete": case "application.duplicate":
      case "application.select_all": case "application.select_none": case "application.enter":
      case "application.escape": case "application.zoom_in": case "application.zoom_out":
        requireArgumentCount(request.params, 0);
        var appCommands = { undo: "undo", redo: "redo", cut: "cut", copy: "copy", paste: "paste", "delete": "remove",
          duplicate: "duplicate", select_all: "selectAll", select_none: "selectNone", enter: "enter", escape: "escape", zoom_in: "zoomIn", zoom_out: "zoomOut" };
        if (request.method === "application.undo" && !observedBoolean(application.canUndo(), "canUndo", "application")) throw bridgeError(-32004, "No observed undo action is available");
        if (request.method === "application.redo" && !observedBoolean(application.canRedo(), "canRedo", "application")) throw bridgeError(-32004, "No observed redo action is available");
        result = dispatchGlobalUi(request.method, application, appCommands[request.method.substring(12)]);
        break;
      case "application.arrow_key":
        requireArgumentCount(request.params, 1);
        var arrowCommands = { left: "arrowKeyLeft", right: "arrowKeyRight", up: "arrowKeyUp", down: "arrowKeyDown" };
        var direction = request.params[0];
        if (typeof direction !== "string" || !Object.prototype.hasOwnProperty.call(arrowCommands, direction)) throw invalidParams("Arrow direction must be left, right, up or down");
        result = dispatchGlobalUi(request.method, application, arrowCommands[direction]);
        break;
      case "arranger.zoom":
        requireArgumentCount(request.params, 1);
        var zoomCommands = { in_all: "zoomInLaneHeightsAll", out_all: "zoomOutLaneHeightsAll", in_selected: "zoomInLaneHeightsSelected", out_selected: "zoomOutLaneHeightsSelected" };
        var zoomAction = request.params[0];
        if (typeof zoomAction !== "string" || !Object.prototype.hasOwnProperty.call(zoomCommands, zoomAction)) throw invalidParams("Unknown arranger zoom action");
        result = dispatchGlobalUi(request.method, arranger, zoomCommands[zoomAction]);
        break;
      case "project.get_status":
        requireArgumentCount(request.params, 0);
        result = { scope: "entire_project", hasSoloedTracks: optionalObservedBoolean(project.hasSoloedTracks(), "solo", "project"),
          hasMutedTracks: optionalObservedBoolean(project.hasMutedTracks(), "mute", "project"),
          hasArmedTracks: optionalObservedBoolean(project.hasArmedTracks(), "arm", "project") };
        result.availabilityObserved = result.hasSoloedTracks !== null && result.hasMutedTracks !== null && result.hasArmedTracks !== null;
        break;
      case "project.unsolo_all": case "project.unmute_all": case "project.unarm_all":
        requireArgumentCount(request.params, 0);
        requireStoppedStructure();
        var projectKey = request.method === "project.unsolo_all" ? "solo" : request.method === "project.unmute_all" ? "mute" : "arm";
        var projectValue = projectKey === "solo" ? project.hasSoloedTracks() : projectKey === "mute" ? project.hasMutedTracks() : project.hasArmedTracks();
        if (observedBoolean(projectValue, projectKey, "project")) {
          invalidateAdvancedValue(projectKey, "project"); targetGeneration += 1; invalidateInspection();
          invalidateProjectChannels(projectKey);
          if (projectKey === "solo") project.unsoloAll(); else if (projectKey === "mute") project.unmuteAll(); else project.unarmAll();
        }
        result = parityDispatch("entire_project", request.method);
        break;
      case "groove.get_status":
        requireArgumentCount(request.params, 0);
        var grooveValues = grooveParameters(); result = { scope: "entire_project", units: "normalized_0_to_1" };
        for (var grooveKey in grooveValues) result[grooveKey] = mixNormalized(grooveValues[grooveKey], "level", "groove." + grooveKey);
        if (result.enabled !== 0 && result.enabled !== 1) throw bridgeError(-32004, "Groove enabled parameter is not a known binary value");
        result.enabled = result.enabled === 1;
        break;
      case "groove.set_enabled": case "groove.set_shuffle_amount":
        requireArgumentCount(request.params, 1);
        var grooveKey = request.method === "groove.set_enabled" ? "enabled" : "shuffleAmount";
        var grooveNext = grooveKey === "enabled" ? (requireBooleanArgument(request.params[0]) ? 1 : 0) : requireNormalized(request.params[0]);
        setMixNormalized(grooveParameters()[grooveKey], "level", "groove." + grooveKey, grooveNext);
        result = parityDispatch("entire_project", request.method);
        break;
      case "drumpad.get_status":
        requireArgumentCount(request.params, 0);
        var drumWindow = inspectDrumWindow(); var pads = [];
        for (var padIndex = 0; padIndex < 16; padIndex++) {
          var drumPad = drumPadBank.getItemAt(padIndex), padGroup = "pad" + padIndex;
          var padExists = mixObserved(drumPad.exists(), "exists", padGroup, "boolean");
          if (padExists && drumWindow.scrollPosition + padIndex >= drumWindow.padCount) throw bridgeError(-32004, "Drum pad count and existence are inconsistent");
          var padInfo = { index: padIndex, absoluteIndex: drumWindow.scrollPosition + padIndex, exists: padExists, name: null, volume: null, mute: null, solo: null, selected: null };
          if (padExists) {
            padInfo.name = mixObserved(drumPad.name(), "name", padGroup, "string");
            padInfo.volume = mixNormalized(drumPad.volume(), "volume", padGroup);
            padInfo.mute = observedBoolean(drumPad.mute(), "mute", padGroup); padInfo.solo = observedBoolean(drumPad.solo(), "solo", padGroup);
            requireObservedAdvanced("selected", padGroup);
            if (typeof drumPadSelected[padIndex] !== "boolean") throw bridgeError(-32004, "Drum selection is unavailable");
            padInfo.selected = drumPadSelected[padIndex];
          }
          pads.push(padInfo);
        }
        result = { pads: pads, coverage: drumWindow, scope: "selected_device" };
        break;
      case "drumpad.set_volume": case "drumpad.set_mute": case "drumpad.set_solo":
        requireArgumentCount(request.params, 2);
        var padNext = request.method === "drumpad.set_volume" ? requireNormalized(request.params[1]) : requireBooleanArgument(request.params[1]);
        var drumPad = requireDrumPad(request.params[0]), padGroup = "pad" + request.params[0];
        if (request.method === "drumpad.set_volume") setMixNormalized(drumPad.volume(), "volume", padGroup, padNext);
        else { targetGeneration += 1; setObservedBoolean(request.method === "drumpad.set_mute" ? drumPad.mute() : drumPad.solo(), request.method === "drumpad.set_mute" ? "mute" : "solo", padGroup, padNext); }
        result = parityDispatch("selected_device", request.method);
        break;
      case "drumpad.select":
        requireArgumentCount(request.params, 1);
        var drumPad = requireDrumPad(request.params[0]), selectedPadIndex = request.params[0];
        requireObservedAdvanced("selected", "pad" + selectedPadIndex);
        if (typeof drumPadSelected[selectedPadIndex] !== "boolean") throw bridgeError(-32004, "Drum selection is unavailable");
        if (!drumPadSelected[selectedPadIndex]) {
          advancedState["pad" + selectedPadIndex].seen.selected = false;
          beginParityObserved(function () { return advancedState["pad" + selectedPadIndex].seen.selected && drumPadSelected[selectedPadIndex] === true; }, drumIdentity());
          drumPad.selectInEditor();
        }
        result = parityDispatch("selected_device", request.method);
        break;
      case "drumpad.scroll_forward": case "drumpad.scroll_backward":
        requireArgumentCount(request.params, 0);
        var beforeDrumWindow = inspectDrumWindow();
        var drumForward = request.method === "drumpad.scroll_forward";
        if (!observedBoolean(drumForward ? drumPadBank.canScrollForwards() : drumPadBank.canScrollBackwards(), drumForward ? "forward" : "backward", "drums")) throw bridgeError(-32004, "Drum bank cannot scroll in this direction");
        advancedState.drums.seen.offset = false;
        beginParityObserved(function () { return advancedState.drums.seen.offset && drumPadBank.scrollPosition().get() !== beforeDrumWindow.scrollPosition; }, drumIdentity());
        if (drumForward) drumPadBank.scrollForwards(); else drumPadBank.scrollBackwards();
        result = parityDispatch("selected_device", request.method);
        break;
      case "transport.add_cue_marker": case "arranger.cues.create":
        requireArgumentCount(request.params, 0); requireStoppedStructure();
        var beforeCues = inspectCueWindow();
        var cuePosition = transport.getPosition().get();
        if (typeof cuePosition !== "number" || !isFinite(cuePosition) || cuePosition < 0) throw bridgeError(-32004, "Known nonnegative transport position required");
        advancedState.cues.seen.count = false;
        beginParityObserved(function () { return advancedState.cues.seen.count && cueMarkerBank.itemCount().get() === beforeCues.projectMarkerCount + 1; });
        transport.addCueMarkerAtPlaybackPosition(); result = constructionResult();
        break;
      case "arranger.cues.rename":
        requireArgumentCount(request.params, 2);
        var cueName = request.params[1];
        if (typeof cueName !== "string" || cueName.trim().length < 1 || cueName.length > 128 || /[\x00-\x1f\x7f-\x9f]/.test(cueName)) throw invalidParams("Cue name must contain 1 to 128 printable characters");
        requireStoppedStructure(); var renameWindow = inspectCueWindow(), renameCue = inspectCue(request.params[0]);
        if (renameCue === null || renameWindow.scrollPosition + request.params[0] >= renameWindow.projectMarkerCount) throw bridgeError(-32004, "Existing observed cue required");
        if (renameCue.name !== cueName) {
          var renameCueIndex = request.params[0], renameMarker = cueMarkerBank.getItemAt(renameCueIndex);
          advancedState.cues.seen[renameCueIndex + ".name"] = false;
          beginParityObserved(function () { return advancedState.cues.seen[renameCueIndex + ".name"] && renameMarker.name().get() === cueName; }, function () { return cueMarkerBank.scrollPosition().get() === renameWindow.scrollPosition && renameMarker.exists().get() === true && renameMarker.position().get() === renameCue.positionBeats; });
          renameMarker.name().set(cueName);
        }
        result = constructionResult();
        break;
      case "bridge.authenticate":
        bridgeSession.authenticated = true;
        result = {
          authenticated: true,
          authentication: "local-only",
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          controllerInstanceId: controllerInstanceId
        };
        break;

      case "bridge.identity":
        result = {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          controllerInstanceId: controllerInstanceId,
          projectName: application.projectName().get(),
          writeAuthentication: "local-only",
          controllerProfile: midiProfileEnabled ? "midi" : "standard",
          midiAvailable: midiProfileEnabled && typeof midiNoteInput !== "undefined" && midiNoteInput !== null,
          injectedMidiChannelIgnored: true
        };
        break;

      case "target.inspect":
        result = inspectBoundTarget(bridgeSession);
        break;

      case "target.set_track_name":
        var renameBinding = request.params && request.params[0];
        var trackName = request.params && request.params[1];
        var renameTarget = requireCurrentTarget(renameBinding);
        if (typeof trackName !== "string" || trackName.length < 1 || trackName.length > 64) {
          throw invalidParams("Track name must contain 1-64 characters");
        }
        renameTarget.track.setName(trackName);
        result = "OK";
        break;

      case "target.set_tempo":
        var tempoBinding = request.params && request.params[0];
        var targetTempoBpm = request.params && request.params[1];
        requireCurrentTarget(tempoBinding);
        if (typeof targetTempoBpm !== "number" || !isFinite(targetTempoBpm) || targetTempoBpm < 40 || targetTempoBpm > 240) {
          throw invalidParams("Tempo must be between 40 and 240 BPM");
        }
        transport.tempo().value().setRaw(targetTempoBpm);
        result = "OK";
        break;

      case "target.create_clip":
        var createBinding = request.params && request.params[0];
        var targetLengthBeats = request.params && request.params[1];
        var createTarget = requireCurrentTarget(createBinding);
        if (!isIntegerInRange(targetLengthBeats, 1, 16)) {
          throw invalidParams("Clip length must be an integer from 1 to 16 beats");
        }
        if (createTarget.slot.hasContent().get()) {
          throw bridgeError(-32005, "Target launcher slot is not empty");
        }
        createTarget.slot.createEmptyClip(targetLengthBeats);
        result = "OK";
        break;

      case "target.set_note":
        var noteBinding = request.params && request.params[0];
        var noteStep = request.params && request.params[1];
        var notePitch = request.params && request.params[2];
        var noteVelocity = request.params && request.params[3];
        var noteDuration = request.params && request.params[4];
        var noteTarget = requireCurrentTarget(noteBinding);
        if (!noteTarget.slot.hasContent().get() || !boundedCursorMatches(noteTarget)) {
          throw bridgeError(-32006, "Target launcher clip is unavailable");
        }
        if (!isIntegerInRange(noteStep, 0, TARGET_GRID_STEPS - 1)) {
          throw invalidParams("Note step must be an integer from 0 to 63");
        }
        if (!isIntegerInRange(notePitch, 0, 127)) {
          throw invalidParams("Note pitch must be an integer from 0 to 127");
        }
        if (!isIntegerInRange(noteVelocity, 1, 127)) {
          throw invalidParams("Note velocity must be an integer from 1 to 127");
        }
        if (!isQuarterBeat(noteDuration) || noteStep * TARGET_STEP_SIZE_BEATS + noteDuration > boundedCursorClip.getLoopLength().get()) {
          throw invalidParams("Note duration must be quarter-beat aligned and stay inside the clip");
        }
        anchorBoundedGrid();
        boundedCursorClip.setStep(0, noteStep, notePitch, noteVelocity, noteDuration);
        result = "OK";
        break;

      case "target.clear_note":
        var clearBinding = request.params && request.params[0];
        var clearStep = request.params && request.params[1];
        var clearPitch = request.params && request.params[2];
        var clearTarget = requireCurrentTarget(clearBinding);
        if (!clearTarget.slot.hasContent().get() || !boundedCursorMatches(clearTarget)) {
          throw bridgeError(-32006, "Target launcher clip is unavailable");
        }
        if (!isIntegerInRange(clearStep, 0, TARGET_GRID_STEPS - 1) || !isIntegerInRange(clearPitch, 0, 127)) {
          throw invalidParams("Clear target must use a step from 0-63 and pitch from 0-127");
        }
        anchorBoundedGrid();
        boundedCursorClip.clearStep(0, clearStep, clearPitch);
        result = "OK";
        break;

      // --- Transport ---
      case "transport.play":
        transport.play();
        result = "OK";
        break;
      case "transport.stop":
        transport.stop();
        result = "OK";
        break;
      case "transport.restart":
        transport.restart();
        result = "OK";
        break;
      case "transport.record":
        transport.record();
        result = "OK";
        break;
      case "transport.getTempo":
        // Tempo is a bit complex in Bitwig API, usually requires an observer.
        // For immediate sync return, we might need to cache observed values.
        // OR we just return the currently cached value.
        result = transport.tempo().value().getRaw();
        break;
      case "transport.setTempo":
        if (request.params && request.params[0] !== undefined) {
          transport.tempo().value().setRaw(request.params[0]);
          result = "OK";
        } else {
          throw invalidParams("Missing tempo parameter");
        }
        break;
      case "transport.getPosition":
        result = transport.getPosition().get();
        break;
      case "transport.setPosition":
        if (request.params && request.params[0] !== undefined) {
          transport.getPosition().set(request.params[0]);
          result = "OK";
        } else {
          throw invalidParams("Missing position parameter");
        }
        break;
      case "transport.getIsPlaying":
        result = transport.isPlaying().get();
        break;
      case "transport.getIsRecording":
        result = transport.isArrangerRecordEnabled().get();
        break;

      case "track.delete":
      case "track.duplicate":
        requireArgumentCount(request.params, 1);
        requireStoppedStructure();
        var structureTrack = requireExistingTrack(request.params[0]);
        var structureType = mixObserved(structureTrack.trackType(), "type", "mainTrack" + request.params[0], "string");
        if (["Instrument", "Audio", "Hybrid"].indexOf(structureType) < 0) throw bridgeError(-32004, "Only individual instrument, audio or hybrid tracks can be deleted or duplicated");
        var trackCount = observedCount(trackBank, "mainBank");
        var countDelta = request.method === "track.delete" ? -1 : 1;
        if (trackCount + countDelta < 0) throw bridgeError(-32004, "Track count unavailable");
        beginTrackStructure(trackBank, trackCount + countDelta, "mainBank");
        if (countDelta < 0) structureTrack.deleteObject(); else structureTrack.duplicate();
        result = constructionResult();
        break;
      case "application.createEffectTrack":
        requireArgumentCount(request.params, 0);
        requireStoppedStructure();
        var returnCount = observedCount(effectTrackBank, "returns");
        beginTrackStructure(effectTrackBank, returnCount + 1, "returns");
        application.createEffectTrack(-1);
        result = constructionResult();
        break;
      case "cursor_track.get_status":
        requireArgumentCount(request.params, 0);
        result = mixChannelStatus(cursorTrack, "cursorTrack", true);
        break;
      case "cursor_device.get_status":
        requireArgumentCount(request.params, 0);
        result = cursorDeviceStatus();
        break;
      case "cursor_clip.get_status":
        requireArgumentCount(request.params, 0);
        var clipExists = mixObserved(inspectionClip.exists(), "exists", "cursorClip", "boolean");
        result = { exists: clipExists, scope: "selected_launcher", trackPosition: null, slotSceneIndex: null,
          loopLength: null, loopStart: null, playStart: null, playStop: null, color: null };
        if (clipExists) {
          if (mixObserved(inspectionTrack.exists(), "trackExists", "cursorClip", "boolean") !== true || mixObserved(inspectionSlot.exists(), "slotExists", "cursorClip", "boolean") !== true) throw bridgeError(-32004, "Launcher clip identity unavailable");
          result.trackPosition = mixObserved(inspectionTrack.position(), "trackPosition", "cursorClip", "number");
          result.slotSceneIndex = mixObserved(inspectionSlot.sceneIndex(), "slotSceneIndex", "cursorClip", "number");
          if (!isIntegerInRange(result.trackPosition, 0, 2147483647) || !isIntegerInRange(result.slotSceneIndex, 0, 2147483647)) throw bridgeError(-32004, "Launcher clip identity unavailable");
          result.loopLength = mixObserved(inspectionClip.getLoopLength(), "loopLength", "cursorClip", "number");
          result.loopStart = mixObserved(inspectionClip.getLoopStart(), "loopStart", "cursorClip", "number");
          result.playStart = mixObserved(inspectionClip.getPlayStart(), "playStart", "cursorClip", "number");
          result.playStop = mixObserved(inspectionClip.getPlayStop(), "playStop", "cursorClip", "number");
          if (result.loopLength <= 0 || result.loopStart < 0 || result.playStart < 0 || result.playStop < result.playStart) throw bridgeError(-32004, "Launcher clip time bounds unavailable");
          result.color = observedColor(inspectionClip.color(), "color", "cursorClip");
        }
        break;
      case "device.bypass":
        requireArgumentCount(request.params, 3);
        var bypassState = requireBooleanArgument(request.params[2]);
        var bypassDevice = requireBankDevice(request.params[0], request.params[1]);
        var bypassGroup = "device" + request.params[0] + ":" + request.params[1];
        var bypassEnabled = mixObserved(bypassDevice.isEnabled(), "enabled", bypassGroup, "boolean");
        var affectsCursor = mixObserved(deviceCursorMatches[request.params[0]][request.params[1]], "cursorMatch", bypassGroup, "boolean");
        if (bypassEnabled !== !bypassState) {
          targetGeneration += 1;
          if (affectsCursor) invalidateAdvancedValue("isEnabled", "cursorDevice");
        }
        setObservedBoolean(bypassDevice.isEnabled(), "enabled", "device" + request.params[0] + ":" + request.params[1], !bypassState);
        result = constructionResult();
        break;
      case "device.delete":
        requireArgumentCount(request.params, 2);
        requireStoppedStructure();
        var deletedDevice = requireBankDevice(request.params[0], request.params[1]);
        var deletedDeviceBank = deviceBanks[request.params[0]];
        var oldDeviceCount = observedCount(deletedDeviceBank, "devices" + request.params[0]);
        if (oldDeviceCount < 1) throw bridgeError(-32004, "Device count unavailable");
        var deviceCountGroup = "devices" + request.params[0];
        beginConstruction(function () { return advancedState[deviceCountGroup].seen.count === true && deletedDeviceBank.itemCount().get() === oldDeviceCount - 1; });
        advancedState[deviceCountGroup].seen.count = false;
        deletedDevice.deleteObject();
        result = constructionResult();
        break;
      case "device.select_next":
      case "device.select_previous":
      case "device.select_first":
      case "device.select_last":
        requireArgumentCount(request.params, 0);
        var oldDevice = cursorDeviceStatus();
        if (!oldDevice.exists) throw bridgeError(-32004, "Existing selected device required");
        var hasNext = mixObserved(cursorDevice.hasNext(), "hasNext", "cursorDevice", "boolean");
        var hasPrevious = mixObserved(cursorDevice.hasPrevious(), "hasPrevious", "cursorDevice", "boolean");
        var selection = request.method.substring("device.select_".length);
        if ((selection === "next" && !hasNext) || (selection === "previous" && !hasPrevious)) throw bridgeError(-32004, "No device in the requested direction");
        if ((selection === "first" && !hasPrevious) || (selection === "last" && !hasNext)) { result = constructionResult(); break; }
        beginConstruction(function () {
          if (cursorDevice.exists().get() !== true || cursorDevice.position().get() === oldDevice.position) return false;
          if (selection === "first") return cursorDevice.hasPrevious().get() === false;
          if (selection === "last") return cursorDevice.hasNext().get() === false;
          return true;
        }, cursorTrackIdentity(oldDevice.trackPosition));
        if (selection === "next") cursorDevice.selectNext();
        else if (selection === "previous") cursorDevice.selectPrevious();
        else if (selection === "first") cursorDevice.selectFirst();
        else cursorDevice.selectLast();
        result = constructionResult();
        break;
      case "device.browse_insert_before":
      case "device.browse_insert_after":
      case "device.browse_replace":
        requireArgumentCount(request.params, 0);
        var browserDevice = cursorDeviceStatus();
        if (!browserDevice.exists || mixObserved(popupBrowser.exists(), "exists", "mixBrowser", "boolean") !== false) throw bridgeError(-32004, "Select an existing device and close the current browser");
        beginConstruction(function () { return popupBrowser.exists().get() === true; }, function () {
          return cursorTrackIdentity(browserDevice.trackPosition)() && cursorDevice.exists().get() === true && cursorDevice.position().get() === browserDevice.position;
        });
        if (request.method === "device.browse_insert_before") cursorDevice.beforeDeviceInsertionPoint().browse();
        else if (request.method === "device.browse_insert_after") cursorDevice.afterDeviceInsertionPoint().browse();
        else cursorDevice.replaceDeviceInsertionPoint().browse();
        result = constructionResult();
        break;
      case "mixer.master.get_volume":
        requireArgumentCount(request.params, 0);
        if (mixObserved(masterTrack.exists(), "exists", "master", "boolean") !== true) throw bridgeError(-32004, "Master track unavailable");
        result = mixNormalized(masterTrack.volume(), "level", "master");
        break;
      case "mixer.master.set_volume":
        requireArgumentCount(request.params, 1);
        requireNormalized(request.params[0]);
        if (mixObserved(masterTrack.exists(), "exists", "master", "boolean") !== true) throw bridgeError(-32004, "Master track unavailable");
        setMixNormalized(masterTrack.volume(), "level", "master", request.params[0], "volume", masterCursorMatches);
        result = constructionResult();
        break;
      case "mixer.track.get_send":
      case "mixer.track.set_send":
        var setSend = request.method === "mixer.track.set_send";
        requireArgumentCount(request.params, setSend ? 3 : 2);
        if (setSend) requireNormalized(request.params[2]);
        var sendTrack = requireExistingTrack(request.params[0]);
        requireObservedAdvanced("exists", "mainTrack" + request.params[0]);
        requireObservedAdvanced("position", "mainTrack" + request.params[0]);
        requireBankIndex(request.params[1], "Send index");
        var sendGroup = "send" + request.params[0] + ":" + request.params[1];
        var send = sendTrack.sendBank().getItemAt(request.params[1]);
        if (mixObserved(send.exists(), "exists", sendGroup, "boolean") !== true) throw bridgeError(-32004, "Existing send required");
        if (setSend) { setMixNormalized(send, "level", sendGroup, request.params[2]); result = constructionResult(); }
        else result = mixNormalized(send, "level", sendGroup);
        break;
      case "mixer.return.list":
        requireArgumentCount(request.params, 0);
        var totalReturns = observedCount(effectTrackBank, "returns");
        var returnOffset = mixObserved(effectTrackBank.scrollPosition(), "offset", "returns", "number");
        if (!isIntegerInRange(returnOffset, 0, Math.max(0, totalReturns - 1))) throw bridgeError(-32004, "Return bank offset unavailable");
        var returns = [];
        var existingReturns = 0;
        for (var returnIndex = 0; returnIndex < 8; returnIndex++) {
          var returnState = mixChannelStatus(effectTrackBank.getItemAt(returnIndex), "return" + returnIndex, false);
          returnState.index = returnIndex;
          if (returnState.exists) existingReturns += 1;
          returns.push(returnState);
        }
        if (existingReturns !== Math.min(8, totalReturns - returnOffset)) throw bridgeError(-32004, "Return bank observations inconsistent");
        result = { returns: returns, coverage: { bankSize: 8, scrollPosition: returnOffset,
          projectReturnCount: totalReturns, complete: returnOffset === 0 && totalReturns <= 8 } };
        break;
      case "mixer.return.volume":
      case "mixer.return.pan":
        requireArgumentCount(request.params, 2);
        requireBankIndex(request.params[0], "Return index");
        requireNormalized(request.params[1]);
        var returnTrack = effectTrackBank.getItemAt(request.params[0]);
        var returnGroup = "return" + request.params[0];
        if (!mixChannelStatus(returnTrack, returnGroup, false).exists) throw bridgeError(-32004, "Existing return required");
        var returnProperty = request.method === "mixer.return.volume" ? "volume" : "pan";
        setMixNormalized(returnProperty === "volume" ? returnTrack.volume() : returnTrack.pan(), returnProperty, returnGroup, request.params[1], returnProperty, returnCursorMatches[request.params[0]]);
        result = constructionResult();
        break;

      case "transport.toggle_metronome":
        requireArgumentCount(request.params, 0);
        observedBoolean(transport.isMetronomeEnabled(), "metronome", "transport");
        invalidateAdvancedValue("metronome", "transport");
        transport.isMetronomeEnabled().toggle();
        result = constructionResult();
        break;
      case "transport.time_signature":
        requireArgumentCount(request.params, 2);
        if (!isIntegerInRange(request.params[0], 1, 32) || [1, 2, 4, 8, 16, 32].indexOf(request.params[1]) < 0) throw invalidParams("Time signature requires numerator 1-32 and denominator 1,2,4,8,16,32");
        transport.timeSignature().set(request.params[0] + "/" + request.params[1]);
        result = constructionResult();
        break;
      case "transport.tap_tempo":
        requireArgumentCount(request.params, 0);
        transport.tapTempo();
        result = constructionResult();
        break;
      case "transport.toggle_punch_in":
      case "transport.toggle_punch_out":
        requireArgumentCount(request.params, 0);
        var togglePunchIn = request.method === "transport.toggle_punch_in";
        var punchToggle = togglePunchIn ? transport.isPunchInEnabled() : transport.isPunchOutEnabled();
        observedBoolean(punchToggle, togglePunchIn ? "punchIn" : "punchOut", "transport");
        invalidateAdvancedValue(togglePunchIn ? "punchIn" : "punchOut", "transport");
        punchToggle.toggle();
        result = constructionResult();
        break;
      case "transport.set_punch_in":
      case "transport.set_punch_out":
        requireArgumentCount(request.params, 1);
        var punchState = requireBooleanArgument(request.params[0]);
        var punchValue = request.method === "transport.set_punch_in" ? transport.isPunchInEnabled() : transport.isPunchOutEnabled();
        setObservedBoolean(punchValue, request.method === "transport.set_punch_in" ? "punchIn" : "punchOut", "transport", punchState);
        result = constructionResult();
        break;
      case "transport.get_punch_status":
        requireArgumentCount(request.params, 0);
        result = { punchIn: observedBoolean(transport.isPunchInEnabled(), "punchIn", "transport"),
          punchOut: observedBoolean(transport.isPunchOutEnabled(), "punchOut", "transport") };
        break;
      case "transport.toggle_arranger_overdub":
      case "transport.toggle_launcher_overdub":
        requireArgumentCount(request.params, 0);
        var arrangerOverdub = request.method === "transport.toggle_arranger_overdub";
        var overdubValue = arrangerOverdub ? transport.isArrangerOverdubEnabled() : transport.isClipLauncherOverdubEnabled();
        observedBoolean(overdubValue, arrangerOverdub ? "arrangerOverdub" : "launcherOverdub", "transport");
        invalidateAdvancedValue(arrangerOverdub ? "arrangerOverdub" : "launcherOverdub", "transport");
        overdubValue.toggle();
        result = constructionResult();
        break;
      case "transport.get_overdub_status":
        requireArgumentCount(request.params, 0);
        result = { arranger: observedBoolean(transport.isArrangerOverdubEnabled(), "arrangerOverdub", "transport"),
          launcher: observedBoolean(transport.isClipLauncherOverdubEnabled(), "launcherOverdub", "transport") };
        break;
      case "transport.continue_playback":
      case "transport.return_to_zero":
      case "transport.fast_forward":
      case "transport.rewind":
      case "transport.nudge_forward":
      case "transport.nudge_backward":
        requireArgumentCount(request.params, 0);
        if (request.method === "transport.continue_playback") transport.continuePlayback();
        else if (request.method === "transport.return_to_zero") transport.setPosition(0);
        else if (request.method === "transport.fast_forward") transport.fastForward();
        else if (request.method === "transport.rewind") transport.rewind();
        else {
          var nudge = request.method === "transport.nudge_forward" ? 1 : -1;
          var currentPosition = transport.getPosition().get();
          if (typeof currentPosition !== "number" || !isFinite(currentPosition) || currentPosition < 0 ||
              currentPosition + nudge < 0 || currentPosition + nudge > 9007199254740991) throw bridgeError(-32004, "Nudge requires a known nonnegative destination position");
          transport.incPosition(nudge, false);
        }
        result = constructionResult();
        break;
      case "arranger.get_status":
        requireArgumentCount(request.params, 0);
        var panels = arrangerPanelValues();
        result = { isTimelineVisible: observedBoolean(panels.timeline, "timeline", "arranger"),
          isIoSectionVisible: observedBoolean(panels.io, "io", "arranger"),
          isClipLauncherVisible: observedBoolean(panels.clip_launcher, "clip_launcher", "arranger"),
          areEffectTracksVisible: observedBoolean(panels.effect_tracks, "effect_tracks", "arranger"),
          hasDoubleRowTrackHeight: observedBoolean(panels.double_row_height, "double_row_height", "arranger"),
          areCueMarkersVisible: observedBoolean(panels.cue_markers, "cue_markers", "arranger"),
          isPlaybackFollowEnabled: observedBoolean(panels.playback_follow, "playback_follow", "arranger") };
        break;
      case "arranger.set_panel_visibility":
        requireArgumentCount(request.params, 2);
        var panels = arrangerPanelValues();
        var panel = request.params[0];
        if (typeof panel !== "string" || !Object.prototype.hasOwnProperty.call(panels, panel)) throw invalidParams("Unknown arranger panel");
        setObservedBoolean(panels[panel], panel, "arranger", requireBooleanArgument(request.params[1]));
        result = constructionResult();
        break;
      case "arranger.get_cue_markers":
      case "arranger.cues.list":
        requireArgumentCount(request.params, 0);
        var coverage = inspectCueWindow();
        var markers = [];
        for (var cueIndex = 0; cueIndex < 32; cueIndex++) {
          var cue = inspectCue(cueIndex);
          if (cue !== null) { cue.absoluteIndex = coverage.scrollPosition + cueIndex; markers.push(cue); }
        }
        if (markers.length !== Math.min(32, Math.max(0, coverage.projectMarkerCount - coverage.scrollPosition))) throw bridgeError(-32004, "Cue bank observations are inconsistent");
        result = { markers: markers, coverage: coverage };
        break;
      case "arranger.jump_to_cue_marker":
      case "arranger.cues.jump":
        requireArgumentCount(request.params, 1);
        var cueWindow = inspectCueWindow();
        var launchCue = inspectCue(request.params[0]);
        if (launchCue === null || cueWindow.scrollPosition + request.params[0] >= cueWindow.projectMarkerCount) throw bridgeError(-32004, "Existing observed cue required");
        cueMarkerBank.getItemAt(request.params[0]).launch(true);
        result = constructionResult();
        break;

      case "clip.get_color":
        var readColorStatus = inspectSlot(request.params && request.params[0], request.params && request.params[1]);
        if (!readColorStatus.exists || !readColorStatus.hasContent) throw bridgeError(-32004, "Existing clip required");
        var readColor = trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().getItemAt(request.params[1]).color();
        result = { r: readColor.red(), g: readColor.green(), b: readColor.blue() };
        for (var colorKey in result) {
          if (typeof result[colorKey] !== "number" || !isFinite(result[colorKey]) || result[colorKey] < 0 || result[colorKey] > 1) throw bridgeError(-32004, "Clip color unavailable");
        }
        break;
      case "clip.set_color":
        var paintSlot = requireConstructionSlot(request.params && request.params[0], request.params && request.params[1], true);
        for (var component = 2; component < 5; component++) {
          var componentValue = request.params && request.params[component];
          if (typeof componentValue !== "number" || !isFinite(componentValue) || componentValue < 0 || componentValue > 1) throw invalidParams("Colors must be finite numbers from 0 to 1");
        }
        paintSlot.color().set(request.params[2], request.params[3], request.params[4]);
        result = constructionResult();
        break;
      case "clip.rename":
        var clipName = requirePortName(request.params && request.params[2]);
        var renameSlot = requireConstructionCursor(request.params && request.params[0], request.params && request.params[1], false);
        if (renameSlot.name().get() !== clipName) {
          beginConstruction(function () { return renameSlot.name().get() === clipName; }, cursorConstructionIdentity());
          inspectionClip.setName(clipName);
        }
        result = constructionResult();
        break;
      case "clip.delete":
        var deleteSlot = requireConstructionSlot(request.params && request.params[0], request.params && request.params[1], true);
        beginConstruction(function () { return deleteSlot.hasContent().get() === false; }, slotConstructionIdentity(request.params[0], deleteSlot));
        trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().deleteClip(request.params[1]);
        result = constructionResult();
        break;
      case "clip.duplicate":
        var copySource = requireConstructionSlot(request.params && request.params[0], request.params && request.params[1], true);
        var copyDestination = requireConstructionSlot(request.params && request.params[0], request.params && request.params[2], false);
        if (request.params[1] === request.params[2]) throw invalidParams("Copy destination must differ from source");
        beginConstruction(function () { return copyDestination.hasContent().get() === true; }, slotConstructionIdentity(request.params[0], copyDestination));
        copyDestination.replaceInsertionPoint().copySlotsOrScenes(copySource);
        result = constructionResult();
        break;
      case "clip.browse_insert":
        var browseSlot = requireConstructionSlot(request.params && request.params[0], request.params && request.params[1], false);
        if (popupBrowser.exists().get() !== false) throw bridgeError(-32004, "Close the existing browser first");
        beginConstruction(function () { return popupBrowser.exists().get() === true; }, slotConstructionIdentity(request.params[0], browseSlot));
        browseSlot.browseToInsertClip();
        result = constructionResult();
        break;
      case "scene.select":
        var sceneIndex = request.params && request.params[0];
        var selectScene = requireScene(sceneIndex);
        if (sceneSelected[sceneIndex] !== true) {
          beginConstruction(function () { return sceneSelected[sceneIndex] === true; });
          selectScene.selectInEditor();
        }
        result = constructionResult();
        break;
      case "scene.delete":
        var deleteScene = requireScene(request.params && request.params[0]);
        if (transport.isPlaying().get() !== false || transport.isArrangerRecordEnabled().get() !== false) throw bridgeError(-32004, "Stop transport and recording before deleting a scene");
        var oldSceneCount = sceneBank.itemCount().get();
        if (!isIntegerInRange(oldSceneCount, 1, 2147483647)) throw bridgeError(-32004, "Scene count unavailable");
        beginConstruction(function () { return sceneBank.itemCount().get() === oldSceneCount - 1; });
        deleteScene.deleteObject();
        result = constructionResult();
        break;
      case "scene.create_from_playing":
        var oldSceneSignature = sceneConstructionSignature();
        if (transport.isPlaying().get() !== true) throw bridgeError(-32004, "Scene capture requires playing launcher clips");
        beginConstruction(function () { return sceneConstructionSignature() !== oldSceneSignature; });
        project.createSceneFromPlayingLauncherClips();
        result = constructionResult();
        break;
      case "clip.set_notes":
      case "clip.clear_notes":
        requireConstructionCursor(request.params && request.params[0], request.params && request.params[1], true);
        var batch = request.params && request.params[2];
        var clearBatch = request.method === "clip.clear_notes";
        validateNoteBatch(batch, clearBatch, inspectionClip.getLoopLength().get());
        result = dispatchNoteBatch(batch, clearBatch);
        break;
      case "clip.set_loop_length":
        requireConstructionCursor(request.params && request.params[0], request.params && request.params[1], true);
        var newLength = request.params && request.params[2];
        var previousLength = inspectionClip.getLoopLength().get();
        if (!isQuarterBeat(newLength) || newLength > 16 || newLength < previousLength) throw invalidParams("Loop length must extend the current loop in quarter beats up to 16 beats");
        if (newLength !== previousLength) {
          beginConstruction(function () { return inspectionClip.getLoopLength().get() === newLength; }, cursorConstructionIdentity());
          inspectionClip.getLoopLength().set(newLength);
        }
        result = constructionResult();
        break;

      // Bank-local indices are deliberately distinct from absolute project positions.
      case "project.get_summary":
        result = { projectName: application.projectName().get(), bank: inspectTrackWindow(),
          transport: { tempoBpm: transport.tempo().value().getRaw(), positionBeats: transport.getPosition().get(),
            isPlaying: transport.isPlaying().get(), isRecording: transport.isArrangerRecordEnabled().get() },
          tracks: inspectTracks(), scenes: inspectScenes() };
        var creativeMutation = typeof creativeMutationStatus === "function" ? creativeMutationStatus() : null;
        if (creativeMutation !== null) result.creativeMutation = creativeMutation;
        result.observation = { mixer: mixObservationDiagnostics() };
        if (typeof creativeObservationDiagnostics === "function") result.observation.creative = creativeObservationDiagnostics();
        break;
      case "track.list":
        result = inspectTracks();
        break;
      case "track.get_info":
        result = inspectTrack(request.params && request.params[0]);
        break;
      case "clip.get_status":
        result = inspectSlot(request.params && request.params[0], request.params && request.params[1]);
        break;
      case "clip.get_grid":
        var gridTracks = inspectTracks();
        for (var gridTrack = 0; gridTrack < 8; gridTrack++) {
          gridTracks[gridTrack].slots = [];
          for (var gridSlot = 0; gridSlot < 8; gridSlot++) gridTracks[gridTrack].slots.push(inspectSlot(gridTrack, gridSlot));
        }
        result = { tracks: gridTracks, window: { trackCount: 8, slotCount: 8 }, bank: inspectTrackWindow() };
        break;
      case "clip.get_notes":
        result = readInspectionNotes(request.params && request.params[0], request.params && request.params[1]);
        break;
      case "track.bank.scroll_forward":
      case "track.bank.scroll_backward":
        var navigationWindow = inspectTrackWindow();
        var forward = request.method === "track.bank.scroll_forward";
        var canScroll = forward ? trackBank.canScrollForwards().get() : trackBank.canScrollBackwards().get();
        if (canScroll !== true) throw bridgeError(-32004, "Track bank cannot scroll in this direction");
        beginBankNavigation(navigationWindow.scrollPosition, null);
        if (forward) trackBank.scrollForwards(); else trackBank.scrollBackwards();
        result = "OK";
        break;
      case "track.bank.scroll_to_position":
        var bankPosition = request.params && request.params[0];
        var bankWindow = inspectTrackWindow();
        if (!isIntegerInRange(bankPosition, 0, bankWindow.trackCount - 1)) throw invalidParams("Position must identify an existing project track");
        if (bankPosition !== bankWindow.scrollPosition) {
          beginBankNavigation(bankWindow.scrollPosition, bankPosition);
          trackBank.scrollPosition().set(bankPosition);
        }
        result = "OK";
        break;
      case "track.scroll_into_view":
        var visibleTrack = requireExistingTrack(request.params && request.params[0]);
        visibleTrack.makeVisibleInArranger();
        visibleTrack.makeVisibleInMixer();
        result = "OK";
        break;
      case "track.rename":
        var renameTrack = requireExistingTrack(request.params && request.params[0]);
        renameTrack.name().set(requirePortName(request.params && request.params[1]));
        result = "OK";
        break;
      case "track.set_color":
        var colorTrack = requireExistingTrack(request.params && request.params[0]);
        for (var colorIndex = 1; colorIndex <= 3; colorIndex++) {
          var colorValue = request.params && request.params[colorIndex];
          if (typeof colorValue !== "number" || !isFinite(colorValue) || colorValue < 0 || colorValue > 1) throw invalidParams("Color components must be finite numbers from 0 to 1");
        }
        colorTrack.color().set(request.params[1], request.params[2], request.params[3]);
        result = "OK";
        break;
      case "scene.rename":
        var renameScene = sceneBank.getScene(requireBankIndex(request.params && request.params[0], "Scene index"));
        if (renameScene.exists().get() !== true || !isIntegerInRange(renameScene.sceneIndex().get(), 0, 2147483647)) throw bridgeError(-32004, "Scene is unavailable");
        renameScene.name().set(requirePortName(request.params && request.params[1]));
        result = "OK";
        break;

      // --- Track Bank Control ---
      case "track.bank.get_status":
        var tracks = [];
        for (var i = 0; i < 8; i++) {
          var t = trackBank.getItemAt(i);
          tracks.push({
            index: i,
            name: t.name().get(),
            volume: t.volume().get(),
            pan: t.pan().get(),
            mute: t.mute().get(),
            solo: t.solo().get(),
            arm: t.arm().get(),
            color: {
              red: t.color().red(),
              green: t.color().green(),
              blue: t.color().blue()
            }
          });
        }
        result = tracks;
        break;

      case "track.bank.volume":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          requireNormalized(request.params[1]);
          invalidateLegacyBankField(request.params[0], "volume", request.params[1]);
          trackBank.getItemAt(request.params[0]).volume().setImmediately(request.params[1]);
          result = "OK";
        } else throw invalidParams("Missing parameters");
        break;

      case "track.bank.pan":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          requireNormalized(request.params[1]);
          invalidateLegacyBankField(request.params[0], "pan", request.params[1]);
          trackBank.getItemAt(request.params[0]).pan().setImmediately(request.params[1]);
          result = "OK";
        } else throw invalidParams("Missing parameters");
        break;

      case "track.bank.mute":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          invalidateLegacyBankField(request.params[0], "mute", request.params[1]);
          trackBank.getItemAt(request.params[0]).mute().set(request.params[1]);
          result = "OK";
        } else throw invalidParams("Missing parameters");
        break;

      case "track.bank.solo":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          invalidateLegacyBankField(request.params[0], "solo", request.params[1]);
          trackBank.getItemAt(request.params[0]).solo().set(request.params[1]);
          result = "OK";
        } else throw invalidParams("Missing parameters");
        break;

      case "track.bank.select":
        if (request.params && request.params[0] !== undefined) {
          trackBank.getItemAt(request.params[0]).selectInMixer();
          result = "OK";
        } else throw invalidParams("Missing parameters");
        break;

      // --- Clip Launcher ---
      case "clip.launch":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          // track index, slot index
          trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().getItemAt(request.params[1]).launch();
          result = "OK";
        } else throw invalidParams("Missing parameters");
        break;

      case "clip.record":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          // track index, slot index
          trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().getItemAt(request.params[1]).record();
          result = "OK";
        } else throw invalidParams("Missing parameters");
        break;

      case "clip.stop":
         if (request.params && request.params[0] !== undefined) {
            // track index
            trackBank.getItemAt(request.params[0]).stop();
            result = "OK";
         } else throw invalidParams("Missing parameters");
         break;

      case "scene.launch":
        if (request.params && request.params[0] !== undefined) {
          sceneBank.getScene(request.params[0]).launch();
          result = "OK";
        } else throw invalidParams("Missing parameters");
        break;

      case "scene.list":
        var scenes = [];
        for (var i = 0; i < 8; i++) {
           var s = sceneBank.getScene(i);
           scenes.push({
             index: i,
             name: s.name().get()
           });
        }
        result = scenes;
        break;

      case "scene.create":
        requireArgumentCount(request.params, 0);
        requireSettledBank();
        if (transport.isPlaying().get() !== false || transport.isArrangerRecordEnabled().get() !== false) throw bridgeError(-32004, "Stop transport and recording before creating a scene");
        var sceneCountBeforeCreate = observedCount(sceneBank, "scenes");
        if (!isIntegerInRange(sceneCountBeforeCreate, 0, 2147483646)) throw bridgeError(-32004, "Scene count unavailable");
        beginConstruction(function () { return advancedState.scenes.seen.count === true && sceneBank.itemCount().get() === sceneCountBeforeCreate + 1; });
        invalidateAdvancedValue("count", "scenes");
        project.createScene();
        result = constructionResult();
        break;

      case "clip.create":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined && request.params[2] !== undefined) {
          // track index, slot index, length in beats
          trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().getItemAt(request.params[1]).createEmptyClip(request.params[2]);
          result = "OK";
        } else throw invalidParams("Missing parameters (trackIndex, slotIndex, length)");
        break;

      case "clip.select_slot":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          var selectSlot = trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().getItemAt(request.params[1]);
          selectSlot.select();
          result = "OK";
        } else throw invalidParams("Missing parameters (trackIndex, slotIndex)");
        break;

      case "clip.show_in_editor":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          var editorSlot = trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().getItemAt(request.params[1]);
          editorSlot.select();
          editorSlot.showInEditor();
          result = "OK";
        } else throw invalidParams("Missing parameters (trackIndex, slotIndex)");
        break;

      case "clip.get_info":
        result = {
          loopLength: cursorClip.getLoopLength().get(),
          loopStart: cursorClip.getLoopStart().get(),
          playStart: cursorClip.getPlayStart().get(),
          playStop: cursorClip.getPlayStop().get(),
          playingStep: cursorClip.playingStep().get()
        };
        break;

      case "clip.set_note":
        if (
          request.params &&
          request.params[0] !== undefined &&
          request.params[1] !== undefined &&
          request.params[2] !== undefined &&
          request.params[3] !== undefined
        ) {
          // step, pitch, velocity, duration
          cursorClip.setStep(0, resolveCursorClipStep(request.params[0]), request.params[1], request.params[2], request.params[3]);
          result = "OK";
        } else throw invalidParams("Missing parameters (step, pitch, velocity, duration)");
        break;

      case "clip.clear_note":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          // step, pitch
          cursorClip.clearStep(0, resolveCursorClipStep(request.params[0]), request.params[1]);
          result = "OK";
        } else throw invalidParams("Missing parameters (step, pitch)");
        break;

      case "clip.toggle_note":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          // step, pitch, velocity
          var toggleVelocity = request.params[2] !== undefined ? request.params[2] : 127;
          cursorClip.toggleStep(resolveCursorClipStep(request.params[0]), request.params[1], toggleVelocity);
          result = "OK";
        } else throw invalidParams("Missing parameters (step, pitch)");
        break;

      // --- Selected Track Control ---
      case "track.selected.get_status":
        result = {
          name: cursorTrack.name().get(),
          volume: cursorTrack.volume().get(),
          pan: cursorTrack.pan().get(),
          mute: cursorTrack.mute().get(),
          solo: cursorTrack.solo().get(),
          arm: cursorTrack.arm().get()
        };
        break;

      case "track.selected.volume":
        if (request.params && request.params[0] !== undefined) {
          requireNormalized(request.params[0]);
          invalidateLegacySelectedField("volume", request.params[0]);
          cursorTrack.volume().setImmediately(request.params[0]);
          result = "OK";
        } else throw invalidParams("Missing parameter");
        break;

      case "track.selected.pan":
        if (request.params && request.params[0] !== undefined) {
          requireNormalized(request.params[0]);
          invalidateLegacySelectedField("pan", request.params[0]);
          cursorTrack.pan().setImmediately(request.params[0]);
          result = "OK";
        } else throw invalidParams("Missing parameter");
        break;

      case "track.selected.mute":
        if (request.params && request.params[0] !== undefined) {
          invalidateLegacySelectedField("mute", request.params[0]);
          if (cursorTrack.mute().get() !== request.params[0]) invalidateProjectAggregate("mute");
          cursorTrack.mute().set(request.params[0]);
          result = "OK";
        } else throw invalidParams("Missing parameter");
        break;

      case "track.selected.solo":
        if (request.params && request.params[0] !== undefined) {
          invalidateLegacySelectedField("solo", request.params[0]);
          if (cursorTrack.solo().get() !== request.params[0]) invalidateProjectAggregate("solo");
          cursorTrack.solo().set(request.params[0]);
          result = "OK";
        } else throw invalidParams("Missing parameter");
        break;

      case "track.selected.arm":
        if (request.params && request.params[0] !== undefined) {
          invalidateLegacySelectedField("arm", request.params[0]);
          if (cursorTrack.arm().get() !== request.params[0]) invalidateProjectAggregate("arm");
          cursorTrack.arm().set(request.params[0]);
          result = "OK";
        } else throw invalidParams("Missing parameter");
        break;

      case "ping":
        result = "pong";
        break;

      case "application.createInstrumentTrack":
        application.createInstrumentTrack(-1); // -1 means add at end
        result = "OK";
        break;
      
      case "application.createAudioTrack":
        application.createAudioTrack(-1);
        result = "OK";
        break;

      // --- Device Control ---
      case "device.get_status":
        result = {
          name: cursorDevice.name().get(),
          isWindowOpen: cursorDevice.isWindowOpen().get(),
          isExpanded: cursorDevice.isExpanded().get()
        };
        break;

      case "device.toggle_window":
        cursorDevice.isWindowOpen().toggle();
        result = "OK";
        break;

      case "device.toggle_expanded":
        cursorDevice.isExpanded().toggle();
        result = "OK";
        break;

      case "device.get_remote_controls":
        var controls = [];
        for (var i = 0; i < 8; i++) {
          var param = remoteControlsBank.getParameter(i);
          controls.push({
            index: i,
            name: param.name().get(),
            value: param.value().get()
          });
        }
        result = controls;
        break;

      case "device.set_remote_control":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          remoteControlsBank.getParameter(request.params[0]).value().set(request.params[1]);
          result = "OK";
        } else throw invalidParams("Missing parameters (index, value)");
        break;

      case "device.page_next":
        remoteControlsBank.selectNextPage(true);
        result = "OK";
        break;

      case "device.page_previous":
        remoteControlsBank.selectPreviousPage(true);
        result = "OK";
        break;

      case "device.list":
        if (request.params && request.params[0] !== undefined) {
          var trackIndex = request.params[0];
          if (!isValidTrackIndex(trackIndex)) throw invalidParams("Invalid trackIndex (expected integer 0-7)");
          var devices = [];
          for (var di = 0; di < 8; di++) {
            var listedDevice = deviceBanks[trackIndex].getItemAt(di);
            if (listedDevice.exists().get()) {
              devices.push({
                index: di,
                name: listedDevice.name().get(),
                enabled: listedDevice.isEnabled().get()
              });
            }
          }
          result = devices;
        } else throw invalidParams("Missing trackIndex parameter");
        break;

      case "device.browse_insert":
        if (request.params && request.params[0] !== undefined) {
          var insertTrackIndex = request.params[0];
          if (!isValidTrackIndex(insertTrackIndex)) throw invalidParams("Invalid trackIndex (expected integer 0-7)");
          var insertPosition = request.params[1] !== undefined ? request.params[1] : 0;
          trackBank.getItemAt(insertTrackIndex).selectInMixer();
          deviceBanks[insertTrackIndex].browseToInsertDevice(insertPosition);
          result = "OK";
        } else throw invalidParams("Missing parameters (trackIndex, position)");
        break;

      case "device.browse_start":
        if (request.params && request.params[0] !== undefined) {
          var startTrackIndex = request.params[0];
          if (!isValidTrackIndex(startTrackIndex)) throw invalidParams("Invalid trackIndex (expected integer 0-7)");
          var startTrack = trackBank.getItemAt(startTrackIndex);
          startTrack.selectInMixer();
          startTrack.startOfDeviceChainInsertionPoint().browse();
          result = "OK";
        } else throw invalidParams("Missing trackIndex parameter");
        break;

      case "device.browse_end":
        if (request.params && request.params[0] !== undefined) {
          var endTrackIndex = request.params[0];
          if (!isValidTrackIndex(endTrackIndex)) throw invalidParams("Invalid trackIndex (expected integer 0-7)");
          var endTrack = trackBank.getItemAt(endTrackIndex);
          endTrack.selectInMixer();
          endTrack.endOfDeviceChainInsertionPoint().browse();
          result = "OK";
        } else throw invalidParams("Missing trackIndex parameter");
        break;

      // --- Browser Control ---
      case "browser.get_status":
        result = {
          exists: popupBrowser.exists().get(),
          title: popupBrowser.title().get(),
          contentTypeNames: popupBrowser.contentTypeNames().get(),
          selectedContentTypeIndex: popupBrowser.selectedContentTypeIndex().get(),
          selectedContentTypeName: popupBrowser.selectedContentTypeName().get()
        };
        break;

      case "browser.list_results":
        var items = [];
        for (var bi = 0; bi < 32; bi++) {
          var item = browserResultBank.getItemAt(bi);
          var name = item.name().get();
          if (item.exists().get() || (name && name.length > 0)) {
            items.push({ index: bi, exists: item.exists().get(), name: name, selected: item.isSelected().get() });
          }
        }
        result = items;
        break;

      case "browser.select_result":
        if (request.params && request.params[0] !== undefined) {
          popupBrowser.selectFirstFile();
          // In Bitwig 5's popup browser, commit() lands on the previous result
          // unless we advance one extra step from the first visible item.
          for (var si = 0; si <= request.params[0]; si++) {
            popupBrowser.selectNextFile();
          }
          result = "OK";
        } else throw invalidParams("Missing index parameter");
        break;

      case "browser.select_first_file":
        popupBrowser.selectFirstFile();
        result = "OK";
        break;

      case "browser.select_next_file":
        popupBrowser.selectNextFile();
        result = "OK";
        break;

      case "browser.select_previous_file":
        popupBrowser.selectPreviousFile();
        result = "OK";
        break;

      case "browser.commit":
        popupBrowser.commit();
        result = "OK";
        break;

      case "browser.cancel":
        popupBrowser.cancel();
        result = "OK";
        break;

      default:
        sendError(connection, request.id, -32601, "Method not found: " + request.method);
        return;
    }

    // Success response
    sendResponse(connection, request.id, result);

  } catch (e) {
    var code = (e && e.jsonrpcCode) ? e.jsonrpcCode : -32603;
    if (constructionPending !== null && code === -32603) constructionPending.failed = true;
    var message = safeHostError(e);
    if (constructionPending !== null && constructionPending.failed) message += "; writes locked: read back observed state, then reload the controller before new writes";
    var prefix = code === -32602 ? "Invalid params: " : "Internal error: ";
    sendError(connection, request.id, code, prefix + message);
  } finally {
    constructionReadAccess = false;
  }
}

function sendResponse(connection, id, result) {
  var response = {
    jsonrpc: "2.0",
    id: id,
    result: result
  };
  sendJSON(connection, response);
}

function sendError(connection, id, code, message) {
  var response = {
    jsonrpc: "2.0",
    id: id,
    error: {
      code: code,
      message: message
    }
  };
  sendJSON(connection, response);
}

function sendJSON(connection, data) {
  var str = JSON.stringify(data) + "\n"; // Newline delimiter
  // Convert string to byte array
  // Explicitly converting char codes to Java byte array-like structure if needed, 
  // but Bitwig SDK usually handles string-compatible byte arrays or we use a helper.
  // However, setReceiveCallback gives us raw bytes, send expects raw bytes.

  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
  }
  connection.send(bytes);
}

function flush() {
  if (globalUiPending > 0) globalUiPending -= 1;
  for (var group in advancedState) {
    var state = advancedState[group];
    if (state.flushedVersion === state.version) state.settledVersion = state.version;
    state.flushedVersion = state.version;
  }
  if (constructionPending !== null && constructionPending.observed && !constructionPending.failed) {
    if (constructionMatches() && constructionPending.flushedVersion === constructionPending.version) {
      constructionPending = null;
      refreshTargetGeneration();
    } else {
      constructionPending.flushedVersion = constructionPending.version;
    }
  }
  if (bankNavigation !== null && bankNavigation.observed) {
    var observedPosition = trackBank.scrollPosition().get();
    var positionMatches = bankNavigation.destination === null ? observedPosition !== bankNavigation.from : observedPosition === bankNavigation.destination;
    if (isIntegerInRange(observedPosition, 0, 2147483647) && positionMatches &&
        bankNavigation.flushedVersion === bankNavigation.version) {
      bankNavigation = null;
      refreshTargetGeneration();
    } else {
      bankNavigation.flushedVersion = bankNavigation.version;
    }
  }
  // Require two completed update cycles without identity/note changes. A read
  // never initiates scrolling and never guesses that pending data is empty.
  if (inspectionFlushedVersion === inspectionVersion) inspectionSettledVersion = inspectionVersion;
  inspectionFlushedVersion = inspectionVersion;
  if (typeof flushCreative === "function") flushCreative();
}

function exit() {
  bridgeExiting = true;
  if (typeof cleanupMidi === "function") cleanupMidi("controller_exit");
  if (bridgeConnection) bridgeConnection.disconnect();
  println("Beat Twin Exited");
}
