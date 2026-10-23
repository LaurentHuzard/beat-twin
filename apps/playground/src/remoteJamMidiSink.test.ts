import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_REMOTE_JAM_NOTES,
  decodeNanoJamWireMessage,
  NanoDawRemoteJamMidiSink,
  parseNanoJamFrame,
  REMOTE_JAM_NOTE_LEASE_MS,
  type NanoJamNotePort,
  type NanoJamSession,
} from "./remoteJamMidiSink";

const SESSION: NanoJamSession = Object.freeze({
  sessionId: "jam-1", streamId: "epoch-1", sourcePeerId: "beat-a", targetPeerId: "beat-b",
});
type EventName = "note_on" | "note_off" | "tempo" | "start" | "stop" | "clock" | "control_change";
function frame(sequence: number, eventType: EventName = "note_on", payload?: Record<string, number>) {
  const defaultPayload = eventType === "note_on"
    ? { channel: 1, note: 60, velocity: 97 }
    : eventType === "note_off"
      ? { channel: 1, note: 60, velocity: 0 }
      : eventType === "tempo"
        ? { bpm: 120 }
        : eventType === "control_change"
          ? { channel: 1, controller: 7, value: 64 }
          : {};
  return {
    version: "midi-delivery-v1",
    session_id: SESSION.sessionId,
    stream_id: SESSION.streamId,
    sequence,
    sent_ns: (sequence - 1) * 1_000_000,
    play_ns: sequence * 1_000_000,
    deadline_ns: (sequence + 1) * 1_000_000,
    event: {
      event_id: "event-" + sequence,
      event_type: eventType,
      occurred_at: "2026-10-23T18:00:00Z",
      source_peer_id: SESSION.sourcePeerId,
      target_peer_id: SESSION.targetPeerId,
      payload: payload ?? defaultPayload,
    },
  };
}

function rig() {
  const calls: unknown[][] = [];
  let operator = true;
  let authenticated = true;
  let now = 0;
  let fail = false;
  let failPanic = false;
  const port: NanoJamNotePort = {
    noteOn(pitch, velocity) {
      calls.push(["on", pitch, velocity]);
      if (fail) throw Error("synth failure");
    },
    noteOff(pitch) {
      calls.push(["off", pitch]);
      if (fail) throw Error("synth release failure");
    },
    panic() {
      calls.push(["panic"]);
      if (failPanic) throw Error("synth panic failure");
    },
  };
  const sink = new NanoDawRemoteJamMidiSink({
    port,
    isOperatorArmed: () => operator,
    isAuthenticatedPeer: () => authenticated,
    clock: {
      nowMs: () => now,
      schedule: (callback, ms) => setTimeout(callback, ms),
      cancel: (handle) => clearTimeout(handle),
    },
  });
  return {
    sink, calls,
    revokeOperator() { operator = false; },
    revokeAuthentication() { authenticated = false; },
    advanceNow(delta: number) { now += delta; },
    failSound() { fail = true; },
    failPanic() { failPanic = true; },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("Remote Jam NanoDAW sink", () => {
  it("rejects invalid wire frame fields before audio", () => {
    const valid = frame(1);
    expect(parseNanoJamFrame(valid).event.payload.note).toBe(60);
    const invalid = [
      { ...valid, version: "unknown" },
      { ...valid, extra: "hidden" },
      { ...valid, sequence: 0 },
      { ...valid, play_ns: -1 },
      { ...valid, deadline_ns: 0 },
      { ...valid, session_id: "" },
      { ...valid, event: { ...valid.event, occurred_at: "not-a-date" } },
      { ...valid, event: { ...valid.event, source_peer_id: "" } },
      frame(1, "note_on", { channel: 0, note: 60, velocity: 80 }),
      frame(1, "note_on", { channel: 1, note: 128, velocity: 80 }),
      frame(1, "note_on", { channel: 1, note: 60, velocity: 128 }),
      frame(1, "note_on", { channel: 1, note: 60, velocity: 99, extra: 1 }),
      frame(1, "tempo", { bpm: Infinity }),
      frame(1, "stop", { bpm: 120 }),
      { ...valid, event: { ...valid.event, event_type: "unknown" } },
      { ...valid, event: { ...valid.event, unauthorized: 1 } },
      { ...valid, event: { ...valid.event, event_id: "x".repeat(129) } },
      { ...valid, event: { ...valid.event, payload: { note: "C4" } } },
    ];
    for (const input of invalid) expect(() => parseNanoJamFrame(input)).toThrow();
    expect(() => parseNanoJamFrame({ ...valid, bogus: "x".repeat(5000) })).toThrow();
  });

  it("bounds UTF-8 JSON before parse and recognizes the exact Go envelope", () => {
    const wire = JSON.stringify(frame(1));
    expect(decodeNanoJamWireMessage(wire).event.event_type).toBe("note_on");
    expect(() => decodeNanoJamWireMessage(wire + " ".repeat(5_000))).toThrow(/4 KiB/);
    expect(() => decodeNanoJamWireMessage("{bad json")).toThrow();
  });

  it("ignores an old lease callback after a fresh stream has been armed", () => {
    const callbacks: Array<() => void> = [];
    const calls: unknown[][] = [];
    const sink = new NanoDawRemoteJamMidiSink({
      port: {
        noteOn: (pitch) => { calls.push(["on", pitch]); },
        noteOff: (pitch) => { calls.push(["off", pitch]); },
        panic: () => { calls.push(["panic"]); },
      },
      isOperatorArmed: () => true,
      isAuthenticatedPeer: () => true,
      clock: {
        nowMs: () => 0,
        schedule: (callback) => {
          callbacks.push(callback);
          return callbacks.length as unknown as ReturnType<typeof setTimeout>;
        },
        cancel: () => undefined, // Intentionally deliver a cancelled stale callback.
      },
    });
    sink.arm(SESSION);
    sink.accept(frame(1));
    sink.disarm();
    sink.arm({ ...SESSION, streamId: "epoch-2" });
    const current = frame(1);
    sink.accept({ ...current, stream_id: "epoch-2" });
    callbacks[0]!(); // late callback from prior stream
    expect(sink.heldNotes).toBe(1);
    callbacks[1]!();
    expect(sink.heldNotes).toBe(0);
    expect(calls.filter((call) => call[0] === "off")).toEqual([["off", 60]]);
    sink.disarm();
  });

  it("refuses unauthenticated or unarmed sessions", () => {
    const h = rig();
    expect(h.sink.accept(frame(1)).status).toBe("faulted");
    h.revokeOperator();
    expect(() => h.sink.arm(SESSION)).toThrow(/authenticated session/);
    const other = rig();
    other.revokeAuthentication();
    expect(() => other.sink.arm(SESSION)).toThrow(/authenticated session/);
    expect(other.calls).toEqual([]);
  });

  it("renders channel-1 notes with exact pitch and note-off; no async scheduler", () => {
    const h = rig();
    h.sink.arm(SESSION);
    expect(h.sink.accept(frame(1)).status).toBe("dispatched_unverified");
    expect(h.sink.heldNotes).toBe(1);
    expect(h.sink.accept(frame(2, "note_off")).status).toBe("dispatched_unverified");
    expect(h.sink.heldNotes).toBe(0);
    expect(h.calls).toEqual([["panic"], ["on", 60, 97], ["off", 60]]);
    h.sink.disarm();
    expect(h.calls.at(-1)).toEqual(["panic"]);
  });

  it("passes unsupported start/tempo/clock/CC without mutating local transport", () => {
    const h = rig();
    h.sink.arm(SESSION);
    for (const [i, type] of (["start", "tempo", "clock", "control_change"] as EventName[]).entries()) {
      expect(h.sink.accept(frame(i + 1, type)).status).toBe("unsupported");
    }
    expect(h.calls).toEqual([["panic"]]);
    expect(h.sink.accept(frame(5, "note_on", { channel: 2, note: 62, velocity: 90 })).status).toBe("unsupported");
    expect(h.calls).toEqual([["panic"]]);
  });

  it("converts note_on velocity zero to note off and stop to local note panic only", () => {
    const h = rig();
    h.sink.arm(SESSION);
    h.sink.accept(frame(1));
    expect(h.sink.accept(frame(2, "note_on", { channel: 1, note: 60, velocity: 0 })).status).toBe("dispatched_unverified");
    h.sink.accept(frame(3));
    expect(h.sink.accept(frame(4, "stop")).status).toBe("unsupported");
    expect(h.sink.heldNotes).toBe(0);
    expect(h.calls.at(-1)).toEqual(["panic"]);
  });

  it("drops duplicates but faults on gaps and refuses new commands until disarm", () => {
    const h = rig();
    h.sink.arm(SESSION);
    h.sink.accept(frame(1));
    expect(h.sink.accept(frame(1)).status).toBe("duplicate");
    expect(h.sink.accept(frame(3)).status).toBe("faulted");
    expect(h.sink.faulted).toBe(true);
    expect(h.sink.heldNotes).toBe(0);
    expect(h.calls.at(-1)).toEqual(["panic"]);
    expect(() => h.sink.arm(SESSION)).toThrow(/disarm/);
    expect(h.sink.accept(frame(2)).status).toBe("faulted");
  });

  it("foreign source and malformed payload disarm and release held notes", () => {
    const h = rig();
    h.sink.arm(SESSION);
    h.sink.accept(frame(1));
    const foreign = frame(2);
    expect(h.sink.accept({ ...foreign, event: { ...foreign.event, source_peer_id: "impostor" } }).status).toBe("faulted");
    expect(h.sink.heldNotes).toBe(0);
    const second = rig();
    second.sink.arm(SESSION);
    second.sink.accept(frame(1));
    expect(() => second.sink.accept({ ...frame(2), event: { ...frame(2).event, payload: { note: 60 } } })).toThrow();
    expect(second.sink.faulted).toBe(true);
  });

  it("revocation faults even for a valid note-off, and disarm permits explicit rearm", () => {
    const h = rig();
    h.sink.arm(SESSION);
    h.sink.accept(frame(1));
    h.revokeAuthentication();
    expect(h.sink.accept(frame(2, "note_off")).status).toBe("faulted");
    expect(h.sink.heldNotes).toBe(0);
    h.sink.disarm();
    expect(() => h.sink.arm(SESSION)).toThrow(/authenticated session/);
  });

  it("enforces a polyphony cap and fails closed on synthetic sound failure", () => {
    const h = rig();
    h.sink.arm(SESSION);
    for (let n = 0; n < MAX_REMOTE_JAM_NOTES; n += 1) {
      expect(h.sink.accept(frame(n + 1, "note_on", { channel: 1, note: n, velocity: 75 })).status)
        .toBe("dispatched_unverified");
    }
    expect(h.sink.heldNotes).toBe(MAX_REMOTE_JAM_NOTES);
    expect(h.sink.accept(frame(33, "note_on", { channel: 1, note: 99, velocity: 80 })).status).toBe("unsupported");
    h.failSound();
    expect(() => h.sink.accept(frame(34, "note_off", { channel: 1, note: 0, velocity: 0 }))).toThrow(/uncertain/);
    expect(h.sink.faulted).toBe(true);
    expect(h.calls.at(-1)).toEqual(["panic"]);
  });

  it("expires orphaned notes after the maximum lease, with no DAW transport command", () => {
    vi.useFakeTimers();
    const h = rig();
    h.sink.arm(SESSION);
    h.sink.accept(frame(1));
    expect(h.sink.heldNotes).toBe(1);
    vi.advanceTimersByTime(REMOTE_JAM_NOTE_LEASE_MS);
    expect(h.sink.heldNotes).toBe(0);
    expect(h.calls.at(-1)).toEqual(["off", 60]);
    h.sink.disarm();
  });

  it("clears note leases on disconnect and does not resurrect notes", () => {
    vi.useFakeTimers();
    const h = rig();
    h.sink.arm(SESSION);
    h.sink.accept(frame(1));
    h.sink.disarm();
    const count = h.calls.length;
    vi.advanceTimersByTime(REMOTE_JAM_NOTE_LEASE_MS + 100);
    expect(h.calls).toHaveLength(count);
    expect(h.sink.accept(frame(2)).status).toBe("faulted");
  });

  it("latches cleanup failures and refuses rearming until successful panic", () => {
    const h = rig();
    h.sink.arm(SESSION);
    h.failPanic();
    expect(() => h.sink.disarm()).toThrow(/cleanup failed/);
    expect(h.sink.faulted).toBe(true);
    expect(() => h.sink.arm(SESSION)).toThrow(/disarm/);
  });

  it("faults after sustained invalid event rates instead of silently playing", () => {
    const h = rig();
    h.sink.arm(SESSION);
    for (let n = 1; n <= 128; n += 1) expect(h.sink.accept(frame(n, "clock")).status).toBe("unsupported");
    expect(h.sink.accept(frame(129, "clock")).status).toBe("faulted");
    expect(h.sink.faulted).toBe(true);
  });
});
