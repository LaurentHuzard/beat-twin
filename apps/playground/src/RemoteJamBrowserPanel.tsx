import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  joinBrowserRemoteJam,
  type BrowserJamHandle,
  type BrowserJamStats,
  type BrowserJamStatus,
} from "./remoteJamBrowserPeer";

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function newEpoch(): string {
  return "session-" + randomSuffix();
}
const PADS = [
  { key: "a", pitch: 60, label: "C4" }, { key: "s", pitch: 62, label: "D4" },
  { key: "d", pitch: 64, label: "E4" }, { key: "f", pitch: 65, label: "F4" },
  { key: "g", pitch: 67, label: "G4" }, { key: "h", pitch: 69, label: "A4" },
  { key: "j", pitch: 71, label: "B4" }, { key: "k", pitch: 72, label: "C5" },
] as const;
const EMPTY_STATS: BrowserJamStats = {
  receivedMidi: 0, dispatchedNotes: 0, lastEvent: "none",
  rttP95Ms: null, rttSamples: 0, clockSync: "not_measured", audioProof: "not_measured",
};

/** Opt-in localhost developer panel. Room secrets live only in React state. */
export function RemoteJamBrowserPanel() {
  const [room, setRoom] = useState("nanodaw-rehearsal");
  const [session, setSession] = useState(newEpoch);
  const [stream, setStream] = useState(() => "epoch-" + randomSuffix());
  const [localPeer, setLocalPeer] = useState("browser-b");
  const [remotePeer, setRemotePeer] = useState("beat-a");
  const [role, setRole] = useState<"offer" | "answer">("answer");
  const [secret, setSecret] = useState("");
  const [phase, setPhase] = useState<BrowserJamStatus | "idle">("idle");
  const [detail, setDetail] = useState("No Remote Jam connection. Local HTTP hub proxy must be enabled.");
  const [stats, setStats] = useState<BrowserJamStats>(EMPTY_STATS);
  const [issue, setIssue] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const peerRef = useRef<BrowserJamHandle | null>(null);
  const aliveRef = useRef(true);
  const busy = phase === "connecting" || phase === "signaling" || phase === "authenticated";
  const connected = phase === "connected";

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      peerRef.current?.close();
      peerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!connected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const pad = PADS.find((value) => value.key === event.key.toLowerCase());
      if (pad) {
        event.preventDefault();
        try { peerRef.current?.sendNote(pad.pitch); }
        catch (error) { setIssue(String(error)); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connected]);

  function leave() {
    abortRef.current?.abort();
    abortRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    setPhase("idle");
    setDetail("Disconnected. Local notes released (sound tail not measured).");
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (abortRef.current || peerRef.current || secret.trim().length < 32) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("connecting");
    setStats(EMPTY_STATS);
    setIssue(null);
    try {
      // Called from a real click/submit gesture before network negotiation.
      const peer = await joinBrowserRemoteJam({
        roomId: room, sessionId: session, streamId: stream,
        localPeerId: localPeer, remotePeerId: remotePeer,
        role, secret, signal: controller.signal,
        onStatus: (status, message) => {
          if (!aliveRef.current || controller.signal.aborted) return;
          setPhase(status);
          setDetail(message);
        },
        onStats: (value) => { if (aliveRef.current) setStats(value); },
        onClosed: (reason) => {
          if (!aliveRef.current) return;
          abortRef.current = null;
          peerRef.current = null;
          setPhase("closed");
          setDetail(reason);
        },
      });
      if (!aliveRef.current || controller.signal.aborted) {
        peer.close();
        return;
      }
      peerRef.current = peer;
    } catch (error) {
      if (controller.signal.aborted || !aliveRef.current) return;
      abortRef.current = null;
      setPhase("error");
      setIssue(String(error));
    }
  }

  function sendDemo(pitch: number) {
    try { peerRef.current?.sendNote(pitch); }
    catch (error) { setIssue(String(error)); }
  }

  return (
    <section className="remote-jam-browser" aria-label="Remote Jam browser peer" aria-live="polite">
      <h3>Remote Jam · Browser instrument</h3>
      <p>
        Development preview: NanoDAW can receive MIDI from an authenticated Go Remote Jam peer.
        This is not an Internet-ready room service, synchronized DAW clock or an audio stream.
      </p>
      <form onSubmit={(event) => void join(event)}>
        <div className="remote-jam-browser-fields">
          <label>Room ID<input value={room} onChange={(event) => setRoom(event.target.value)} disabled={busy || connected} required /></label>
          <label>Session ID<input value={session} onChange={(event) => setSession(event.target.value)} disabled={busy || connected} required /></label>
          <label>Stream epoch<input value={stream} onChange={(event) => setStream(event.target.value)} disabled={busy || connected} required /></label>
          <label>My peer ID<input value={localPeer} onChange={(event) => setLocalPeer(event.target.value)} disabled={busy || connected} required /></label>
          <label>Remote peer ID<input value={remotePeer} onChange={(event) => setRemotePeer(event.target.value)} disabled={busy || connected} required /></label>
          <label>My role
            <select value={role} onChange={(event) => setRole(event.target.value as "offer" | "answer")} disabled={busy || connected}>
              <option value="answer">Answer (Go peer offers)</option>
              <option value="offer">Offer (Go peer answers)</option>
            </select>
          </label>
          <label>Room key (not saved)
            <input type="password" autoComplete="off" spellCheck={false} value={secret}
              onChange={(event) => setSecret(event.target.value)} disabled={busy || connected}
              required minLength={32} aria-label="Remote Jam room secret" />
          </label>
        </div>
        <div className="remote-jam-browser-actions">
          <button type="submit" disabled={busy || connected || secret.trim().length < 32}>
            {busy ? "Connecting…" : "Join room and enable sound"}
          </button>
          <button type="button" onClick={leave} disabled={phase === "idle" || phase === "closed"}>Leave / release all notes</button>
        </div>
      </form>
      <div className="remote-jam-browser-pads" aria-label="Remote Jam MIDI pad keyboard">
        {PADS.map((pad) => (
          <button key={pad.pitch} type="button" disabled={!connected}
            onClick={() => sendDemo(pad.pitch)}
            aria-label={`Send ${pad.label} to remote peer`}>
            {pad.label}<small>{pad.key.toUpperCase()}</small>
          </button>
        ))}
      </div>
      <p className="remote-jam-browser-note">Pads send 350 ms MIDI notes; the other peer must own an audio instrument to hear them.</p>
      <p role="status">State: <strong>{phase}</strong>. {detail}</p>
      {issue ? <p role="alert">Connection problem: {issue}</p> : null}
      <dl className="remote-jam-browser-stats">
        <div><dt>Received events</dt><dd>{stats.receivedMidi}</dd></div>
        <div><dt>Note commands sent to synth</dt><dd>{stats.dispatchedNotes}</dd></div>
        <div><dt>Last event</dt><dd>{stats.lastEvent}</dd></div>
        <div><dt>RTT p95</dt><dd>{stats.rttP95Ms === null ? "Not measured" : stats.rttP95Ms.toFixed(1) + " ms"}</dd></div>
        <div><dt>RTT samples</dt><dd>{stats.rttSamples}</dd></div>
        <div><dt>One-way MIDI drift</dt><dd>Not measured</dd></div>
      </dl>
      <p className="remote-jam-browser-note">
        The Go peer needs the same room/session/stream, reverse peer IDs, same private key
        and opposite role. Restart with a new room/session/epoch after a failed handshake.
      </p>
    </section>
  );
}
