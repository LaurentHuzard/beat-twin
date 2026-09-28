// @ts-nocheck
// Concatenated with the controller. The standard profile never opens MIDI ports.
var midiNoteInput = null;
var midiActiveNotes = {};
var midiSequence = 0;
var midiSustain = false;
var midiSustainToken = 0;
var midiPedals = {};
var midiLastCleanupError = null;
var MIDI_MAX_LEASE_MS = 10000;

function initMidi() {
  if (!midiProfileEnabled) return;
  midiNoteInput = host.getMidiInPort(0).createNoteInput("Beat Twin MCP Notes", "8?????", "9?????", "A?????", "B?????", "D?????", "E?????");
  // Require explicit track input routing when this optional profile is enabled.
  midiNoteInput.includeInAllInputs().set(false);
}

function midiInteger(value, minimum, maximum, label) {
  if (!isIntegerInRange(value, minimum, maximum)) throw invalidParams(label + " must be an integer from " + minimum + " to " + maximum);
  return value;
}

function requireMidiInput() {
  if (!midiProfileEnabled || midiNoteInput === null) throw bridgeError(-32004, "MIDI input unavailable: select the separate Beat Twin MIDI controller profile and configure its input routing");
}

function midiNoteCount() {
  var count = 0;
  for (var key in midiActiveNotes) if (Object.prototype.hasOwnProperty.call(midiActiveNotes, key)) count += 1;
  return count;
}

function midiStatus() {
  var notes = [];
  for (var key in midiActiveNotes) if (Object.prototype.hasOwnProperty.call(midiActiveNotes, key)) notes.push(Number(key));
  notes.sort(function (a, b) { return a - b; });
  return { available: midiProfileEnabled && midiNoteInput !== null, profile: midiProfileEnabled ? "midi" : "standard",
    routing: "explicit_note_input_track_routing", injectedMidiChannelIgnored: true, translationTablesApplyToInjectedMidi: false,
    trackedInjectedPitches: notes, sustainPending: midiSustain, maximumLeaseMs: MIDI_MAX_LEASE_MS,
    cleanupError: midiLastCleanupError, physicalInputNotesTracked: false };
}

function midiEmit(status, data1, data2) {
  midiNoteInput.sendRawMidiEvent(status, data1, data2);
}

function midiClearSustain() {
  if (!midiSustain) return;
  for (var pedal in midiPedals) {
    if (Object.prototype.hasOwnProperty.call(midiPedals, pedal)) {
      midiEmit(176, Number(pedal), 0);
      delete midiPedals[pedal];
    }
  }
  midiSustain = false;
  midiSustainToken += 1;
}

function midiLeaseRelease(pitch, token, attempt) {
  var active = midiActiveNotes[pitch];
  if (!active || active.token !== token || midiNoteInput === null) return;
  try {
    // Sustained notes must not outlive their lease when an earlier CC64 is on.
    midiClearSustain();
    midiEmit(128, pitch, 0);
    delete midiActiveNotes[pitch];
  } catch (error) {
    midiLastCleanupError = safeHostError(error);
    if (attempt < 3 && !bridgeExiting) {
      try { host.scheduleTask(function () { midiLeaseRelease(pitch, token, attempt + 1); }, 1000); } catch (scheduleError) { midiLastCleanupError = safeHostError(scheduleError); }
    }
  }
}

function midiStartNote(pitch, velocity, duration) {
  if (Object.prototype.hasOwnProperty.call(midiActiveNotes, pitch)) throw bridgeError(-32004, "Injected pitch is already active; release it before retriggering");
  var token = ++midiSequence;
  midiActiveNotes[pitch] = { token: token };
  try {
    // Schedule before sending: a scheduler failure must never create a voice.
    host.scheduleTask(function () { midiLeaseRelease(pitch, token, 0); }, duration);
  } catch (scheduleError) {
    delete midiActiveNotes[pitch];
    throw scheduleError;
  }
  try { midiEmit(144, pitch, velocity); }
  catch (sendError) { midiLeaseRelease(pitch, token, 0); throw sendError; }
}

function midiStopNote(pitch, velocity) {
  midiClearSustain();
  midiEmit(128, pitch, velocity);
  delete midiActiveNotes[pitch];
}

function midiSetSustain(controller, value) {
  var token = midiSustainToken + 1;
  if (value >= 64) {
    if (Object.prototype.hasOwnProperty.call(midiPedals, controller)) throw bridgeError(-32004, "Injected hold pedal is already active; release it before renewing");
    host.scheduleTask(function () {
      if (!midiPedals[controller] || midiPedals[controller].token !== token) return;
      cleanupMidi("sustain_lease");
    }, MIDI_MAX_LEASE_MS);
    midiSustainToken = token;
    // Mark uncertain state before dispatch so host exceptions still trigger cleanup.
    midiSustain = true;
    midiPedals[controller] = { token: token };
  }
  try { midiEmit(176, controller, value); }
  catch (error) { cleanupMidi("sustain_dispatch_error"); throw error; }
  if (value < 64) {
    delete midiPedals[controller];
    midiSustain = false;
    for (var pedal in midiPedals) if (Object.prototype.hasOwnProperty.call(midiPedals, pedal)) midiSustain = true;
    if (!midiSustain) midiSustainToken += 1;
  }
}

function cleanupMidi(reason) {
  if (midiNoteInput === null) return { released: true, reason: reason, available: false };
  var errors = [];
  function attempt(status, data1, data2) {
    try { midiEmit(status, data1, data2); return true; }
    catch (error) { errors.push(safeHostError(error)); return false; }
  }
  // These releases never consult MCP permissions or bridge authentication.
  var pedalsReleased = true;
  for (var p = 0; p < 3; p++) {
    var controller = [64, 66, 69][p];
    if (attempt(176, controller, 0)) delete midiPedals[controller]; else pedalsReleased = false;
  }
  if (pedalsReleased) { midiSustain = false; midiSustainToken += 1; }
  for (var pitch in midiActiveNotes) {
    if (Object.prototype.hasOwnProperty.call(midiActiveNotes, pitch) && attempt(128, Number(pitch), 0)) delete midiActiveNotes[pitch];
  }
  var allOff = attempt(176, 123, 0), allSoundOff = attempt(176, 120, 0);
  if (allOff && allSoundOff && !midiSustain) midiActiveNotes = {};
  midiLastCleanupError = errors.length ? errors.join("; ").slice(0, 300) : null;
  return { released: errors.length === 0, reason: reason, available: true, remainingTrackedNotes: midiNoteCount(), error: midiLastCleanupError };
}

function requireMidiConfigurationIdle() {
  if (midiNoteCount() > 0 || midiSustain) throw bridgeError(-32004, "Release injected notes and sustain before changing MIDI input configuration");
}

function midiTranslationTable(table) {
  if (!Array.isArray(table) || table.length !== 128) throw invalidParams("Translation table must contain exactly 128 entries");
  var copied = [];
  for (var i = 0; i < 128; i++) copied.push(midiInteger(table[i], -1, 127, "Translation value"));
  return copied;
}

function handleMidiRequest(method, params) {
  var supported = ["note_input.get_status", "note_input.all_notes_off", "note_input.send_raw_midi", "note_input.send_note_on", "note_input.send_note_off", "note_input.play_note",
    "note_input.assign_poly_aftertouch_to_expression", "note_input.set_use_expressive_midi", "note_input.set_key_translation_table", "note_input.set_velocity_translation_table"];
  if (supported.indexOf(method) < 0) return { handled: false };
  if (method === "note_input.get_status") {
    requireArgumentCount(params, 0);
    return { handled: true, result: midiStatus() };
  }
  requireMidiInput();
  var result = { status: "dispatched", verified: false, injectedMidiChannelIgnored: true };
  if (method === "note_input.all_notes_off") {
    requireArgumentCount(params, 0);
    result = cleanupMidi("requested");
    if (!result.released) throw bridgeError(-32004, "MIDI cleanup remains uncertain: " + result.error);
  } else if (method === "note_input.send_raw_midi") {
    requireArgumentCount(params, 3);
    var status = midiInteger(params[0], 128, 224, "Status");
    if (status % 16 !== 0) throw invalidParams("Injected raw MIDI channel must be zero; channel bits are ignored by the API");
    var data1 = midiInteger(params[1], 0, 127, "Data byte 1"), data2 = midiInteger(params[2], 0, 127, "Data byte 2");
    if ((status === 192 || status === 208) && data2 !== 0) throw invalidParams("Two-byte MIDI messages require data2 zero");
    if (status === 144 && data2 > 0) midiStartNote(data1, data2, MIDI_MAX_LEASE_MS);
    else if (status === 128 || status === 144) midiStopNote(data1, data2);
    else if (status === 176 && (data1 === 64 || data1 === 66 || data1 === 69)) midiSetSustain(data1, data2);
    else if (status === 176 && (data1 === 120 || data1 === 123)) {
      var cleanup = cleanupMidi("raw_all_notes_off");
      if (!cleanup.released) throw bridgeError(-32004, "MIDI cleanup remains uncertain: " + cleanup.error);
    } else midiEmit(status, data1, data2);
  } else if (method === "note_input.send_note_on" || method === "note_input.send_note_off" || method === "note_input.play_note") {
    var isOff = method === "note_input.send_note_off", isPlay = method === "note_input.play_note";
    requireArgumentCount(params, isPlay ? 4 : 3);
    midiInteger(params[0], 0, 0, "Injected MIDI channel");
    var pitch = midiInteger(params[1], 0, 127, "Pitch"), velocity = midiInteger(params[2], isOff ? 0 : 1, 127, "Velocity");
    var duration = isPlay ? midiInteger(params[3], 1, MIDI_MAX_LEASE_MS, "Duration in milliseconds") : MIDI_MAX_LEASE_MS;
    if (isOff) midiStopNote(pitch, velocity); else midiStartNote(pitch, velocity, duration);
    if (!isOff) result.leaseMs = duration;
  } else if (method === "note_input.assign_poly_aftertouch_to_expression") {
    requireArgumentCount(params, 3);
    var channel = midiInteger(params[0], 0, 15, "Input MIDI channel"), expression = params[1], pitchRange = midiInteger(params[2], 1, 24, "Pitch range");
    var expressions = ["NONE", "PITCH_DOWN", "PITCH_UP", "GAIN_DOWN", "GAIN_UP", "PAN_LEFT", "PAN_RIGHT", "TIMBRE_DOWN", "TIMBRE_UP"];
    if (typeof expression !== "string" || expressions.indexOf(expression) < 0) throw invalidParams("Unknown Bitwig NoteInput.NoteExpression constant");
    requireMidiConfigurationIdle();
    // Bitwig's JavaScript binding exposes the nested Java enum as NoteExpression.
    midiNoteInput.assignPolyphonicAftertouchToExpression(channel, NoteExpression[expression], pitchRange);
  } else if (method === "note_input.set_use_expressive_midi") {
    requireArgumentCount(params, 3);
    var enabled = requireBooleanArgument(params[0]), base = params[1], bend = midiInteger(params[2], 1, 96, "Pitch bend range");
    if (base !== 0 && base !== 15) throw invalidParams("MPE base channel must be 0 or 15");
    requireMidiConfigurationIdle(); midiNoteInput.setUseExpressiveMidi(enabled, base, bend);
  } else {
    requireArgumentCount(params, 1);
    var table = midiTranslationTable(params[0]); requireMidiConfigurationIdle();
    if (method === "note_input.set_key_translation_table") midiNoteInput.setKeyTranslationTable(table);
    else midiNoteInput.setVelocityTranslationTable(table);
  }
  return { handled: true, result: result };
}
