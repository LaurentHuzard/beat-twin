/**
 * Opt-in Remote Jam MIDI performer. Remote Jam owns communication; Beat Twin
 * owns musical interpretation and Bitwig. No sockets, clocks, agents or audio.
 */
export const REMOTE_JAM_DELIVERY_VERSION = "midi-delivery-v1";

export type RemoteJamEventType =
  | "clock" | "start" | "stop" | "continue" | "tempo"
  | "note_on" | "note_off" | "control_change";

export type RemoteJamFrame = Readonly<{
  version: typeof REMOTE_JAM_DELIVERY_VERSION;
  session_id: string;
  stream_id: string;
  sequence: number;
  sent_ns: number;
  play_ns: number;
  deadline_ns: number;
  event: Readonly<{
    event_id: string;
    event_type: RemoteJamEventType;
    occurred_at: string;
    source_peer_id: string;
    target_peer_id: string;
    payload: Readonly<Record<string, number>>;
  }>;
}>;

export type RemoteJamSession = Readonly<{
  sessionId: string;
  streamId: string;
  sourcePeerId: string;
  targetPeerId: string;
}>;

export type RemoteJamStatus = "dispatched_unverified" | "unsupported" | "duplicate" | "faulted";
export type RemoteJamResult = Readonly<{
  status: RemoteJamStatus;
  eventId: string;
  sequence: number;
  detail: string;
}>;

export interface RemoteJamMidiPort {
  status(): Promise<Readonly<{
    available: boolean;
    profile: string;
    cleanupError?: string | null;
    trackedInjectedPitches?: readonly number[];
  }>>;
  noteOn(pitch: number, velocity: number): Promise<void>;
  noteOff(pitch: number, velocity: number): Promise<void>;
  panic(): Promise<void>;
}

export type RemoteJamBitwigRpc = (
  method: string,
  params: readonly unknown[],
  options: Readonly<{ requiresAuthentication: true }>,
) => Promise<unknown>;

// The caller must enforce a separate human arm + midi_write policy.
// requiresAuthentication alone does not grant that permission.
export function createRemoteJamBitwigPort(call: RemoteJamBitwigRpc): RemoteJamMidiPort {
  const authenticated = { requiresAuthentication: true } as const;
  return Object.freeze({
    status: async () => {
      const value = await call("note_input.get_status", [], authenticated);
      if (!record(value) || typeof value.available !== "boolean" || typeof value.profile !== "string") {
        throw new Error("Bitwig MIDI status is unavailable or malformed");
      }
      return {
        available: value.available,
        profile: value.profile,
        cleanupError: typeof value.cleanupError === "string" ? value.cleanupError : null,
        trackedInjectedPitches: Array.isArray(value.trackedInjectedPitches) ? value.trackedInjectedPitches as number[] : [],
      };
    },
    noteOn: async (pitch: number, velocity: number) => {
      await call("note_input.send_note_on", [0, pitch, velocity], authenticated);
    },
    noteOff: async (pitch: number, velocity: number) => {
      await call("note_input.send_note_off", [0, pitch, velocity], authenticated);
    },
    panic: async () => { await call("note_input.all_notes_off", [], authenticated); },
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keysExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value;
}
function safeInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
const FRAME_KEYS = ["version", "session_id", "stream_id", "sequence", "sent_ns", "play_ns", "deadline_ns", "event"];
const EVENT_KEYS = ["event_id", "event_type", "occurred_at", "source_peer_id", "target_peer_id", "payload"];
const EVENT_TYPES = ["clock", "start", "stop", "continue", "tempo", "note_on", "note_off", "control_change"];
const MAX_TIME_NS = Number.MAX_SAFE_INTEGER;

// Frame shape is validated but a frame is NOT evidence that the peer is authenticated.
export function parseRemoteJamFrame(value: unknown): RemoteJamFrame {
  if (!record(value) || !keysExactly(value, FRAME_KEYS)) throw new Error("invalid remote MIDI envelope fields");
  if (value.version !== REMOTE_JAM_DELIVERY_VERSION || !id(value.session_id) || !id(value.stream_id)) {
    throw new Error("invalid remote MIDI envelope version or identity");
  }
  if (!safeInt(value.sequence, 1, MAX_TIME_NS) || !safeInt(value.sent_ns, 0, MAX_TIME_NS)
    || !safeInt(value.play_ns, value.sent_ns, MAX_TIME_NS)
    || !safeInt(value.deadline_ns, value.play_ns, MAX_TIME_NS)) {
    throw new Error("invalid remote MIDI sequence or timing bounds");
  }
  const e = value.event;
  if (!record(e) || !keysExactly(e, EVENT_KEYS) || !id(e.event_id) || !id(e.source_peer_id)
    || !id(e.target_peer_id) || !EVENT_TYPES.includes(e.event_type as string)
    || typeof e.occurred_at !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(e.occurred_at)
    || !Number.isFinite(Date.parse(e.occurred_at)) || !record(e.payload)) {
    throw new Error("invalid remote MIDI event identity or payload");
  }
  const p = e.payload;
  switch (e.event_type) {
    case "note_on": case "note_off":
      if (!keysExactly(p, ["channel", "note", "velocity"]) || !safeInt(p.channel, 1, 16)
        || !safeInt(p.note, 0, 127) || !safeInt(p.velocity, 0, 127)) {
        throw new Error("invalid remote MIDI note payload");
      }
      break;
    case "control_change":
      if (!keysExactly(p, ["channel", "controller", "value"]) || !safeInt(p.channel, 1, 16)
        || !safeInt(p.controller, 0, 127) || !safeInt(p.value, 0, 127)) {
        throw new Error("invalid remote MIDI CC payload");
      }
      break;
    case "tempo":
      if (!keysExactly(p, ["bpm"]) || typeof p.bpm !== "number"
        || !Number.isFinite(p.bpm) || p.bpm <= 0 || p.bpm > 1000) {
        throw new Error("invalid remote MIDI tempo payload");
      }
      break;
    default:
      if (!keysExactly(p, [])) throw new Error("unexpected remote MIDI payload");
  }
  return value as RemoteJamFrame;
}

export class RemoteJamBitwigConsumer {
  readonly #port: RemoteJamMidiPort;
  readonly #allowed: () => boolean;
  readonly #authenticated: (session: RemoteJamSession) => boolean;
  #session: RemoteJamSession | null = null;
  #sequence = 0;
  #notes = new Set<number>();
  #faulted = false;
  #generation = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: {
    port: RemoteJamMidiPort;
    isWriteAuthorized: () => boolean;
    isAuthenticatedPeer: (session: RemoteJamSession) => boolean;
  }) {
    this.#port = options.port;
    this.#allowed = options.isWriteAuthorized;
    this.#authenticated = options.isAuthenticatedPeer;
  }

  get armed(): boolean { return this.#session !== null && !this.#faulted; }
  get heldNotes(): number { return this.#notes.size; }

  async arm(session: RemoteJamSession): Promise<void> {
    if (this.#session || this.#faulted) throw new Error("disarm/clear fault before arming another session");
    if (![session.sessionId, session.streamId, session.sourcePeerId, session.targetPeerId].every(id)
      || session.sourcePeerId === session.targetPeerId || !this.#allowed() || !this.#authenticated(session)) {
      throw new Error("explicit peer authorization and valid session identity required");
    }
    const generation = this.#generation;
    await this.#serialize(async () => {
      if (generation !== this.#generation || !this.#allowed() || !this.#authenticated(session)) throw new Error("arming revoked");
      const status = await this.#port.status();
      if (!status.available || status.profile !== "midi" || status.cleanupError
        || (status.trackedInjectedPitches?.length ?? 0) !== 0) {
        throw new Error("Bitwig MIDI profile must be ready and free of tracked injected notes; routing requires manual verification");
      }
      if (generation !== this.#generation || !this.#allowed() || !this.#authenticated(session)) throw new Error("arming revoked");
      if (this.#session || this.#faulted) throw new Error("another session already armed");
      this.#session = Object.freeze({ ...session });
      this.#sequence = 0;
      this.#notes.clear();
    });
  }

  // Invalid frames fail closed. Caller supplies only authenticated local feed.
  async accept(input: unknown): Promise<RemoteJamResult> {
    const generation = this.#generation;
    return this.#serialize(async () => {
      let frame: RemoteJamFrame;
      try { frame = parseRemoteJamFrame(input); }
      catch (error) {
        if (this.#session) await this.#failSafe();
        throw error;
      }
      const event = frame.event;
      const result = (status: RemoteJamStatus, detail: string): RemoteJamResult =>
        Object.freeze({ status, eventId: event.event_id, sequence: frame.sequence, detail });
      const session = this.#session;
      if (generation !== this.#generation || !session || this.#faulted) {
        return result("faulted", "not armed or authorization revoked");
      }
      let authorized = false;
      try { authorized = this.#allowed() && this.#authenticated(session); } catch { /* fail closed */ }
      if (!authorized) {
        await this.#failSafe();
        return result("faulted", "authorization revoked; MIDI panic attempted");
      }
      if (frame.session_id !== session.sessionId || frame.stream_id !== session.streamId
        || event.source_peer_id !== session.sourcePeerId || event.target_peer_id !== session.targetPeerId) {
        return result("faulted", "foreign session/stream/peer refused");
      }
      if (frame.sequence <= this.#sequence) return result("duplicate", "old or duplicate sequence refused");
      if (frame.sequence !== this.#sequence + 1) {
        await this.#failSafe();
        return result("faulted", "sequence gap; MIDI panic issued; new arming required");
      }
      this.#sequence = frame.sequence;
      const payload = event.payload;
      if (event.event_type === "stop") {
        try { await this.#port.panic(); this.#notes.clear(); }
        catch (error) { await this.#failSafe(); throw new Error("stop cleanup uncertain: " + String(error)); }
        return result("unsupported", "stop releases MIDI notes only; Bitwig transport was not controlled");
      }
      if (event.event_type !== "note_on" && event.event_type !== "note_off") {
        return result("unsupported", event.event_type + " is not a verified Bitwig live MIDI operation");
      }
      if (payload.channel !== 1) {
        return result("unsupported", "Bitwig NoteInput injection supports only channel 0 (remote channel 1)");
      }
      const pitch = payload.note;
      const off = event.event_type === "note_off" || payload.velocity === 0;
      try {
        if (off) {
          if (!this.#notes.has(pitch)) return result("unsupported", "note is not active in this session");
          await this.#port.noteOff(pitch, payload.velocity);
          this.#notes.delete(pitch);
        } else {
          if (this.#notes.has(pitch) || this.#notes.size >= 32) {
            return result("unsupported", "note already held or polyphony limit reached");
          }
          await this.#port.noteOn(pitch, payload.velocity);
          this.#notes.add(pitch);
        }
      } catch (error) {
        await this.#failSafe();
        throw new Error("Bitwig MIDI dispatch outcome uncertain; panic attempted: " + String(error));
      }
      return result("dispatched_unverified", "Bitwig note dispatched; audio/timing not measured");
    });
  }

  // Synchronous revocation; queued panic runs after any in-flight host write.
  async disarm(): Promise<void> {
    this.#generation += 1;
    this.#session = null;
    this.#faulted = false;
    await this.#serialize(async () => {
      try { await this.#port.panic(); }
      catch (error) {
        this.#faulted = true;
        throw new Error("MIDI cleanup uncertain: " + String(error));
      } finally {
        this.#notes.clear();
        this.#sequence = 0;
      }
    });
  }

  async #failSafe(): Promise<void> {
    this.#faulted = true;
    this.#session = null;
    this.#generation++;
    try { await this.#port.panic(); }
    catch { /* fault remains latched; never claim cleanup success */ }
    this.#notes.clear();
  }

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const job = this.#queue.then(task);
    this.#queue = job.then(() => undefined, () => undefined);
    return job;
  }
}
