/**
 * BT-RJ-003: explicit browser WebRTC connection to the existing Go Remote Jam
 * RJ-003B wire. Dev-only signaling is same-origin through a loopback Vite proxy.
 * Network arrival is NOT clock-synchronized and does not invoke agents/MCP.
 */
import { decodeNanoJamWireMessage, NanoDawRemoteJamMidiSink, type NanoJamSession } from "./remoteJamMidiSink";
import { acquireNanoDawRemoteJamAudio, type NanoJamSoundPort } from "./remoteJamTonePort";
import { signRjSDP, verifyRjSDP, type RjRole, type SignalIdentity } from "./remoteJamBrowserProtocol";

const HUB_PATH = "/api/remote-jam-hub";
const DC_LABEL = "remote-jam-midi-v1";
const MAX_WIRE = 4096;
const SIGNAL_TIMEOUT_MS = 60_000;
const MAX_SCTP_BUFFER = 64 * 1024;
const ENCODER = new TextEncoder();

export type BrowserJamOptions = SignalIdentity & Readonly<{
  role: RjRole;
  streamId: string;
  secret: string;
  signal: AbortSignal;
  onStatus: (status: BrowserJamStatus, detail: string) => void;
  onStats: (stats: BrowserJamStats) => void;
  onClosed: (reason: string) => void;
}>;
export type BrowserJamStatus = "connecting" | "signaling" | "authenticated" | "connected" | "closed" | "error";
export type BrowserJamStats = Readonly<{
  receivedMidi: number;
  dispatchedNotes: number;
  lastEvent: string;
  rttP95Ms: number | null;
  rttSamples: number;
  clockSync: "not_measured";
  audioProof: "not_measured";
}>;
export type BrowserJamHandle = Readonly<{
  sendNote(pitch: number): void;
  close(): void;
  stats(): BrowserJamStats;
}>;

type HubEvent = Readonly<{
  room_id: string;
  peer_id: string;
  target_peer_id: string;
  event_type: string;
  payload: unknown;
}>;
type Probe = Readonly<{
  type: "ping" | "pong";
  session: string;
  from: string;
  to: string;
  seq: number;
}>;

function checkConfiguration(config: BrowserJamOptions): void {
  const ids = [config.roomId, config.sessionId, config.streamId, config.localPeerId, config.remotePeerId];
  if (ids.some((value) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))
    || config.localPeerId === config.remotePeerId
    || config.secret.trim().length < 32 || config.secret.trim().length > 256
    || (config.role !== "offer" && config.role !== "answer")) {
    throw Error("Invalid room, session, peers or shared key");
  }
  if (config.signal.aborted) throw Error("Remote Jam join cancelled");
}

function deadline(config: BrowserJamOptions): number {
  return Date.now() + SIGNAL_TIMEOUT_MS;
}
async function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw Error("Remote Jam join cancelled");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(Error("Remote Jam join cancelled")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
function makeHub(config: BrowserJamOptions) {
  async function request(method: "GET" | "POST", path: string, payload?: unknown): Promise<{ status: number; body: unknown }> {
    if (config.signal.aborted) throw Error("Remote Jam join cancelled");
    const response = await fetch(HUB_PATH + path, {
      method,
      headers: {
        Authorization: "Bearer " + config.secret.trim(),
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      credentials: "omit",
      cache: "no-store",
      signal: config.signal,
      referrerPolicy: "no-referrer",
    });
    // Never log the secret, SDP or full untrusted hub response.
    if (!response.ok && response.status !== 409 && response.status !== 404) {
      throw Error("Remote Jam hub rejected request: HTTP " + response.status);
    }
    const data: unknown = await response.json().catch(() => null);
    return { status: response.status, body: data };
  }
  return {
    async join(): Promise<void> {
      const room = await request("POST", "/rooms", { room_id: config.roomId });
      if (room.status !== 201 && room.status !== 409) throw Error("Could not create/join room");
      const joined = await request("POST", "/rooms/" + config.roomId + "/peers", { peer_id: config.localPeerId });
      if (joined.status !== 201 && joined.status !== 409) throw Error("Could not join room as peer");
    },
    async postSignal(kind: RjRole, sdp: string): Promise<void> {
      const signed = await signRjSDP(config, kind, sdp, config.secret.trim());
      const until = deadline(config);
      while (!config.signal.aborted && Date.now() < until) {
        const response = await request("POST", "/rooms/" + config.roomId + "/signals", {
          from_peer_id: config.localPeerId,
          to_peer_id: config.remotePeerId,
          type: kind,
          payload: signed,
        });
        if (response.status === 202) return;
        if (response.status !== 404) throw Error("Could not post authenticated SDP");
        await pause(250, config.signal);
      }
      throw Error("Remote Jam signaling timed out waiting for the other peer");
    },
    async awaitSignal(kind: RjRole): Promise<string> {
      const until = deadline(config);
      while (!config.signal.aborted && Date.now() < until) {
        const response = await request("GET", "/rooms/" + config.roomId + "/events");
        if (response.status !== 200 || !Array.isArray(response.body)) {
          throw Error("Remote Jam event history unavailable");
        }
        const events = response.body as HubEvent[];
        if (events.length > 256) throw Error("Remote Jam signaling history exhausted");
        for (let i = events.length - 1; i >= 0; i--) {
          const event = events[i]!;
          if (event.room_id !== config.roomId || event.peer_id !== config.remotePeerId
            || event.target_peer_id !== config.localPeerId || event.event_type !== kind) continue;
          try {
            const verified = await verifyRjSDP(event.payload, config, kind, config.secret.trim());
            return verified.sdp;
          } catch { /* Ignore stale or invalid signed offers; do not install their SDP. */ }
        }
        await pause(250, config.signal);
      }
      throw Error("Remote Jam authenticated SDP was not received before timeout");
    },
  };
}
function whenGathered(pc: RTCPeerConnection, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const done = (error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancelled);
      pc.removeEventListener("icegatheringstatechange", check);
      if (error) reject(error);
      else if (!pc.localDescription?.sdp) reject(Error("Missing gathered local SDP"));
      else resolve(pc.localDescription.sdp);
    };
    const cancelled = () => done(Error("SDP gathering cancelled"));
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    signal.addEventListener("abort", cancelled, { once: true });
    pc.addEventListener("icegatheringstatechange", check);
    timer = setTimeout(() => done(Error("SDP candidate gathering timed out")), 20_000);
    check();
  });
}

export async function joinBrowserRemoteJam(
  options: BrowserJamOptions,
  acquireAudio: () => Promise<NanoJamSoundPort> = acquireNanoDawRemoteJamAudio,
): Promise<BrowserJamHandle> {
  checkConfiguration(options);
  const config = { ...options, secret: options.secret.trim() };
  const identity: NanoJamSession = {
    sessionId: config.sessionId, streamId: config.streamId,
    sourcePeerId: config.remotePeerId, targetPeerId: config.localPeerId,
  };
  let pc: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let sink: NanoDawRemoteJamMidiSink | null = null;
  let audio: NanoJamSoundPort | null = null;
  let authenticated = false;
  let closed = false;
  let opened = false;
  let outboundSequence = 0;
  let pingSequence = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  const noteTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const pending = new Map<number, number>();
  const samples: number[] = [];
  const counts = { receivedMidi: 0, dispatchedNotes: 0, lastEvent: "none" };

  function stats(): BrowserJamStats {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      ...counts, rttP95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1]! : null,
      rttSamples: sorted.length, clockSync: "not_measured", audioProof: "not_measured",
    };
  }
  function emitStatus(status: BrowserJamStatus, detail: string) {
    if (!closed || status === "closed" || status === "error") config.onStatus(status, detail);
  }
  function shutdown(reason: string, isError = false): void {
    if (closed) return;
    closed = true;
    config.signal.removeEventListener("abort", aborted);
    authenticated = false;
    for (const timer of noteTimers.values()) clearTimeout(timer);
    noteTimers.clear();
    if (pingTimer !== null) clearInterval(pingTimer);
    pending.clear();
    try { sink?.disarm(); } catch { /* Do not claim successful silence. */ }
    try { channel?.close(); } catch {}
    try { pc?.close(); } catch {}
    try { audio?.dispose(); } catch {}
    config.onStatus(isError ? "error" : "closed", reason);
    config.onClosed(reason);
  }
  function send(data: string): void {
    if (closed || channel?.readyState !== "open") throw Error("Remote Jam DataChannel not connected");
    if (ENCODER.encode(data).byteLength > MAX_WIRE || channel.bufferedAmount > MAX_SCTP_BUFFER) {
      throw Error("Remote Jam outbound MIDI queue limit exceeded");
    }
    channel.send(data);
  }
  function sendMidi(kind: "note_on" | "note_off" | "stop", payload: Record<string, number>) {
    if (outboundSequence >= 4096) throw Error("Remote Jam stream exhausted; reconnect with a fresh epoch");
    const current = ++outboundSequence;
    const sent = Math.max(0, Math.floor(performance.now() * 1_000_000));
    send(JSON.stringify({
      version: "midi-delivery-v1", session_id: config.sessionId, stream_id: config.streamId,
      sequence: current, sent_ns: sent, play_ns: sent + 1_000_000,
      deadline_ns: sent + 1_000_000_000,
      event: {
        event_id: "browser-" + current + "-" + config.localPeerId,
        event_type: kind, occurred_at: new Date().toISOString(),
        source_peer_id: config.localPeerId, target_peer_id: config.remotePeerId, payload,
      },
    }));
  }
  function sendNote(pitch: number) {
    if (closed || !authenticated || !opened) throw Error("Remote Jam must be connected");
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw Error("Invalid MIDI pitch");
    if (noteTimers.has(pitch)) return;
    if (noteTimers.size >= 8) throw Error("Demo pad polyphony exceeded");
    sendMidi("note_on", { channel: 1, note: pitch, velocity: 96 });
    const timer = setTimeout(() => {
      noteTimers.delete(pitch);
      try { sendMidi("note_off", { channel: 1, note: pitch, velocity: 0 }); }
      catch { shutdown("Remote MIDI note-off could not be sent; connection closed", true); }
    }, 350);
    noteTimers.set(pitch, timer);
  }
  function onMessage(data: unknown) {
    if (closed || !authenticated || typeof data !== "string"
      || ENCODER.encode(data).byteLength > MAX_WIRE) {
      shutdown("Unexpected or oversized Remote Jam message", true);
      return;
    }
    try {
      const value: unknown = JSON.parse(data);
      if (value !== null && typeof value === "object" && !Array.isArray(value)
        && ("type" in value) && ((value as Probe).type === "ping" || (value as Probe).type === "pong")) {
        const probe = value as Probe;
        const keys = Object.keys(value);
        if (keys.length !== 5 || !["type", "session", "from", "to", "seq"].every((key) => keys.includes(key))
          || probe.session !== config.sessionId || probe.from !== config.remotePeerId
          || probe.to !== config.localPeerId || !Number.isSafeInteger(probe.seq) || probe.seq <= 0) {
          throw Error("Invalid authenticated RTT probe");
        }
        if (probe.type === "ping") {
          send(JSON.stringify({ ...probe, type: "pong", from: config.localPeerId, to: config.remotePeerId }));
        } else {
          const started = pending.get(probe.seq);
          if (started !== undefined) {
            pending.delete(probe.seq);
            samples.push(performance.now() - started);
            if (samples.length > 256) samples.shift();
            config.onStats(stats());
          }
        }
        return;
      }
      const frame = decodeNanoJamWireMessage(data);
      const receipt = sink?.accept(frame);
      counts.receivedMidi++;
      counts.lastEvent = frame.event.event_type + ": " + receipt?.status;
      if (receipt?.status === "dispatched_unverified") counts.dispatchedNotes++;
      config.onStats(stats());
      if (!receipt || receipt.status === "faulted") throw Error("NanoDAW MIDI session fault");
    } catch {
      shutdown("Remote Jam invalid MIDI or unauthorized input; audio released", true);
    }
  }
  function installChannel(dc: RTCDataChannel) {
    if (channel || dc.label !== DC_LABEL || !dc.ordered || dc.maxRetransmits !== null
      || dc.maxPacketLifeTime !== null) {
      try { dc.close(); } catch {}
      shutdown("Unexpected WebRTC datachannel policy", true);
      return;
    }
    channel = dc;
    dc.onmessage = ({ data }) => onMessage(data);
    dc.onerror = () => shutdown("WebRTC datachannel error", true);
    dc.onclose = () => shutdown("WebRTC datachannel closed, notes released");
    dc.onopen = () => {
      if (closed || !pc || !authenticated) return;
      try {
        sink = new NanoDawRemoteJamMidiSink({
          port: audio!,
          isOperatorArmed: () => !closed && !config.signal.aborted,
          isAuthenticatedPeer: (session) => authenticated && !closed
            && session.sessionId === identity.sessionId
            && session.streamId === identity.streamId
            && session.sourcePeerId === identity.sourcePeerId
            && session.targetPeerId === identity.targetPeerId,
        });
        sink.arm(identity);
        opened = true;
        emitStatus("connected", "Authenticated MIDI channel open; audio not independently measured");
        config.onStats(stats());
        pingTimer = setInterval(() => {
          try {
            if (pending.size >= 8) throw Error("RTT probes unanswered");
            const seq = ++pingSequence;
            pending.set(seq, performance.now());
            send(JSON.stringify({
              type: "ping", session: config.sessionId, from: config.localPeerId,
              to: config.remotePeerId, seq,
            }));
          } catch { shutdown("WebRTC RTT diagnostics failed", true); }
        }, 1000);
      } catch { shutdown("Browser audio arming failed; sound released", true); }
    };
  }
  const aborted = () => shutdown("Remote Jam session cancelled");
  config.signal.addEventListener("abort", aborted, { once: true });
  try {
    // Must be entered by an actual click: Tone.start happens before networking.
    emitStatus("connecting", "Unlocking browser sound after explicit user action");
    audio = await acquireAudio();
    if (closed || config.signal.aborted) {
      audio.dispose(); audio = null;
      throw Error("Session cancelled during audio unlock");
    }
    const hub = makeHub(config);
    await hub.join();
    if (closed) throw Error("Session cancelled before WebRTC setup");
    pc = new RTCPeerConnection({ iceServers: [] });
    pc.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(pc?.connectionState ?? "")) {
        shutdown("WebRTC peer disconnected; emergency note release", true);
      }
    };
    pc.ondatachannel = ({ channel: remote }) => {
      if (config.role !== "answer") { remote.close(); shutdown("Unexpected second datachannel", true); }
      else installChannel(remote);
    };
    if (config.role === "offer") installChannel(pc.createDataChannel(DC_LABEL, { ordered: true }));
    emitStatus("signaling", "Waiting for authenticated Remote Jam SDP");

    if (config.role === "offer") {
      await pc.setLocalDescription(await pc.createOffer());
      const sdp = await whenGathered(pc, config.signal);
      await hub.postSignal("offer", sdp);
      const answer = await hub.awaitSignal("answer");
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } else {
      const offer = await hub.awaitSignal("offer");
      await pc.setRemoteDescription({ type: "offer", sdp: offer });
      await pc.setLocalDescription(await pc.createAnswer());
      const sdp = await whenGathered(pc, config.signal);
      await hub.postSignal("answer", sdp);
    }
    if (closed) throw Error("Remote Jam connection closed during handshake");
    authenticated = true;
    emitStatus("authenticated", "Signed SDP verified; waiting for encrypted MIDI channel");
    // Channel may open before the async SDP posting promise resolves.
    if (channel?.readyState === "open") channel.onopen?.(new Event("open"));

    const until = deadline(config);
    while (!opened && !closed && Date.now() < until) await pause(100, config.signal);
    if (!opened || closed) throw Error("Authenticated MIDI channel did not open");
    return Object.freeze({ sendNote, close: () => shutdown("User left Remote Jam; all notes released"), stats });
  } catch (error) {
    shutdown("Remote Jam connection failed; local sound released", true);
    throw error;
  }
}
