/**
 * BT-RJ-002: local NanoDAW note performer. No socket, DOM, Tone transport,
 * MCP or agent calls. The caller MUST feed it from a separately authenticated
 * Remote Jam transport and explicitly arm audio after a user gesture.
 */
export const REMOTE_JAM_FRAME_VERSION = "midi-delivery-v1";
export const MAX_REMOTE_JAM_FRAME_BYTES = 4096;
export const MAX_REMOTE_JAM_NOTES = 32;
export const MAX_REMOTE_JAM_EVENTS = 4096;
export const REMOTE_JAM_NOTE_LEASE_MS = 10_000;

export type NanoJamSession = Readonly<{
  sessionId: string;
  streamId: string;
  sourcePeerId: string;
  targetPeerId: string;
}>;

export type NanoJamNotePort = Readonly<{
  noteOn(pitch: number, velocity: number): void;
  noteOff(pitch: number): void;
  panic(): void;
}>;

export type NanoJamOutcome = "dispatched_unverified" | "duplicate" | "unsupported" | "faulted";
export type NanoJamReceipt = Readonly<{
  status: NanoJamOutcome;
  eventId: string;
  sequence: number;
  detail: string;
}>;

type RemoteEvent = Readonly<{
  event_id: string;
  event_type: string;
  occurred_at: string;
  source_peer_id: string;
  target_peer_id: string;
  payload: Readonly<Record<string, number>>;
}>;
export type NanoJamFrame = Readonly<{
  version: typeof REMOTE_JAM_FRAME_VERSION;
  session_id: string;
  stream_id: string;
  sequence: number;
  sent_ns: number;
  play_ns: number;
  deadline_ns: number;
  event: RemoteEvent;
}>;

const FRAME_KEYS = ["version", "session_id", "stream_id", "sequence", "sent_ns", "play_ns", "deadline_ns", "event"] as const;
const EVENT_KEYS = ["event_id", "event_type", "occurred_at", "source_peer_id", "target_peer_id", "payload"] as const;
const TYPE_NAMES = ["clock", "start", "stop", "continue", "tempo", "note_on", "note_off", "control_change"];

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactly(value: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}
function identity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value;
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Bound UTF-8 *before* JSON.parse in a future authenticated DataChannel. */
export function decodeNanoJamWireMessage(data: string): NanoJamFrame {
  if (new TextEncoder().encode(data).length > MAX_REMOTE_JAM_FRAME_BYTES) {
    throw new Error("Remote Jam MIDI wire message exceeds 4 KiB");
  }
  return parseNanoJamFrame(JSON.parse(data) as unknown);
}

/** Exactly the JSON field layout emitted by Remote Jam internal/midirelay.Frame. */
export function parseNanoJamFrame(raw: unknown): NanoJamFrame {
  // Transport MUST bound bytes before JSON.parse. This secondary bound also
  // protects direct object invocations (not a substitute for ingress limits).
  const encoded = JSON.stringify(raw);
  if (encoded === undefined || encoded.length > MAX_REMOTE_JAM_FRAME_BYTES || encoded.length < 2) {
    throw new Error("Remote Jam MIDI frame exceeds limits");
  }
  if (!object(raw) || !exactly(raw, FRAME_KEYS) || raw.version !== REMOTE_JAM_FRAME_VERSION
    || !identity(raw.session_id) || !identity(raw.stream_id)
    || !integer(raw.sequence, 1, Number.MAX_SAFE_INTEGER)
    || !integer(raw.sent_ns, 0, Number.MAX_SAFE_INTEGER)
    || !integer(raw.play_ns, raw.sent_ns, Number.MAX_SAFE_INTEGER)
    || !integer(raw.deadline_ns, raw.play_ns, Number.MAX_SAFE_INTEGER)) {
    throw new Error("invalid Remote Jam frame version, identity or timing");
  }
  const event = raw.event;
  if (!object(event) || !exactly(event, EVENT_KEYS)
    || !identity(event.event_id) || !identity(event.source_peer_id)
    || !identity(event.target_peer_id) || typeof event.event_type !== "string"
    || !TYPE_NAMES.includes(event.event_type) || typeof event.occurred_at !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(event.occurred_at)
    || !Number.isFinite(Date.parse(event.occurred_at)) || !object(event.payload)) {
    throw new Error("invalid Remote Jam MIDI event");
  }
  const p = event.payload;
  switch (event.event_type) {
    case "note_on":
    case "note_off":
      if (!exactly(p, ["channel", "note", "velocity"]) || !integer(p.channel, 1, 16)
        || !integer(p.note, 0, 127) || !integer(p.velocity, 0, 127)) {
        throw new Error("invalid MIDI note payload");
      }
      break;
    case "tempo":
      if (!exactly(p, ["bpm"]) || typeof p.bpm !== "number"
        || !Number.isFinite(p.bpm) || p.bpm <= 0 || p.bpm > 1000) {
        throw new Error("invalid MIDI tempo payload");
      }
      break;
    case "control_change":
      if (!exactly(p, ["channel", "controller", "value"]) || !integer(p.channel, 1, 16)
        || !integer(p.controller, 0, 127) || !integer(p.value, 0, 127)) {
        throw new Error("invalid MIDI control payload");
      }
      break;
    default:
      if (!exactly(p, [])) throw new Error("unexpected MIDI payload fields");
  }
  return raw as NanoJamFrame;
}

type Clock = Readonly<{
  nowMs(): number;
  schedule(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  cancel(handle: ReturnType<typeof setTimeout>): void;
}>;

const defaultClock: Clock = {
  nowMs: () => performance.now(),
  schedule: (callback, ms) => setTimeout(callback, ms),
  cancel: (handle) => clearTimeout(handle),
};

/**
 * Synchronous dispatch means no unbounded async sound-write queue. Every
 * arrival checks an independent authorization capability, not a peer ID string.
 */
export class NanoDawRemoteJamMidiSink {
  readonly #port: NanoJamNotePort;
  readonly #authorized: () => boolean;
  readonly #authenticated: (session: NanoJamSession) => boolean;
  readonly #clock: Clock;
  readonly #held = new Map<number, ReturnType<typeof setTimeout>>();
  #session: NanoJamSession | null = null;
  #lastSequence = 0;
  #faulted = false;
  #windowStart = 0;
  #windowCount = 0;
  #leaseEpoch = 0;

  constructor(options: {
    port: NanoJamNotePort;
    isOperatorArmed: () => boolean;
    isAuthenticatedPeer: (session: NanoJamSession) => boolean;
    clock?: Clock;
  }) {
    this.#port = options.port;
    this.#authorized = options.isOperatorArmed;
    this.#authenticated = options.isAuthenticatedPeer;
    this.#clock = options.clock ?? defaultClock;
  }

  get armed(): boolean { return this.#session !== null && !this.#faulted; }
  get heldNotes(): number { return this.#held.size; }
  get faulted(): boolean { return this.#faulted; }

  arm(session: NanoJamSession): void {
    if (this.#session !== null || this.#faulted) throw new Error("disarm and clear fault before rearming");
    if (![session.sessionId, session.streamId, session.sourcePeerId, session.targetPeerId].every(identity)
      || session.sourcePeerId === session.targetPeerId || !this.#allowed(session)) {
      throw new Error("explicit authenticated session and operator arm required");
    }
    // Enforce a clean instrument before the first remotely supplied note.
    try { this.#port.panic(); }
    catch (error) { this.#faulted = true; throw new Error("initial MIDI panic failed: " + String(error)); }
    if (!this.#allowed(session)) { this.#fault(); throw new Error("arming authorization revoked"); }
    this.#leaseEpoch += 1;
    this.#session = Object.freeze({ ...session });
    this.#lastSequence = 0;
    this.#windowCount = 0;
    this.#windowStart = this.#clock.nowMs();
  }

  /** Frames must already have crossed a *trusted*, authenticated connection. */
  accept(raw: unknown): NanoJamReceipt {
    if (!this.armed) return Object.freeze({ status: "faulted", eventId: "", sequence: 0, detail: "not armed" });
    let frame: NanoJamFrame;
    try { frame = parseNanoJamFrame(raw); }
    catch (error) { this.#fault(); throw error; }
    const event = frame.event;
    const receipt = (status: NanoJamOutcome, detail: string): NanoJamReceipt =>
      Object.freeze({ status, eventId: event.event_id, sequence: frame.sequence, detail });
    const session = this.#session;
    if (!session || !this.#allowed(session)) {
      this.#fault();
      return receipt("faulted", "operator or peer authorization revoked; panic attempted");
    }
    if (frame.session_id !== session.sessionId || frame.stream_id !== session.streamId
      || event.source_peer_id !== session.sourcePeerId || event.target_peer_id !== session.targetPeerId) {
      this.#fault();
      return receipt("faulted", "foreign session or stream; panic attempted");
    }
    if (frame.sequence <= this.#lastSequence) return receipt("duplicate", "old sequence dropped");
    if (frame.sequence !== this.#lastSequence + 1 || frame.sequence > MAX_REMOTE_JAM_EVENTS) {
      this.#fault();
      return receipt("faulted", "stream gap or exhausted epoch; panic attempted");
    }
    const now = this.#clock.nowMs();
    if (now - this.#windowStart >= 1000) { this.#windowStart = now; this.#windowCount = 0; }
    if (++this.#windowCount > 128) {
      this.#fault();
      return receipt("faulted", "incoming MIDI event rate exceeded; panic attempted");
    }
    this.#lastSequence = frame.sequence;
    if (event.event_type === "stop") {
      try { this.#releaseAll(); }
      catch (error) { this.#fault(); throw new Error("stop cleanup uncertain: " + String(error)); }
      return receipt("unsupported", "notes released; remote Stop does not control NanoDAW transport");
    }
    if (event.event_type !== "note_on" && event.event_type !== "note_off") {
      return receipt("unsupported", "tempo/clock/transport/CC needs independent qualified scheduling");
    }
    const { channel, note, velocity } = event.payload;
    if (channel !== 1) return receipt("unsupported", "only remote MIDI channel 1 is available");
    try {
      if (event.event_type === "note_off" || velocity === 0) {
        if (!this.#held.has(note)) return receipt("unsupported", "note not held");
        this.#release(note);
      } else {
        if (this.#held.has(note)) return receipt("unsupported", "note already held");
        if (this.#held.size >= MAX_REMOTE_JAM_NOTES) return receipt("unsupported", "polyphony cap reached");
        this.#port.noteOn(note, velocity);
        const epoch = this.#leaseEpoch;
        const timer = this.#clock.schedule(() => {
          if (epoch !== this.#leaseEpoch || !this.#held.has(note)) return;
          try { this.#release(note); }
          catch { this.#fault(); }
        }, REMOTE_JAM_NOTE_LEASE_MS);
        this.#held.set(note, timer);
      }
    } catch (error) {
      this.#fault();
      throw new Error("remote MIDI dispatch uncertain; panic attempted: " + String(error));
    }
    return receipt("dispatched_unverified", "local synth command issued; no audio or timing evidence");
  }

  /** Call immediately on network close, page leave, revocation and user stop. */
  disarm(): void {
    this.#session = null;
    this.#faulted = true;
    this.#leaseEpoch += 1;
    this.#releaseTimers();
    try {
      this.#port.panic();
      this.#faulted = false;
      this.#lastSequence = 0;
    } catch (error) {
      throw new Error("cannot safely rearm, note cleanup failed: " + String(error));
    }
  }

  #allowed(session: NanoJamSession): boolean {
    try { return this.#authorized() === true && this.#authenticated(session) === true; }
    catch { return false; }
  }
  #release(pitch: number): void {
    const timer = this.#held.get(pitch);
    if (timer === undefined) return;
    this.#port.noteOff(pitch);
    this.#clock.cancel(timer);
    this.#held.delete(pitch);
  }
  #releaseTimers(): void {
    for (const timer of this.#held.values()) this.#clock.cancel(timer);
    this.#held.clear();
  }
  #releaseAll(): void {
    this.#port.panic();
    this.#releaseTimers();
  }
  #fault(): void {
    this.#session = null;
    this.#faulted = true;
    this.#leaseEpoch += 1;
    this.#releaseTimers();
    try { this.#port.panic(); } catch { /* Never claim safe cleanup. */ }
  }
}
