import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { joinBrowserRemoteJam, type BrowserJamStats } from "./remoteJamBrowserPeer";
import { signRjSDP } from "./remoteJamBrowserProtocol";

const secret = "b".repeat(64);
const IDS = {
  roomId: "test-room", sessionId: "take-001", streamId: "epoch-001",
  localPeerId: "browser-b", remotePeerId: "beat-a",
} as const;
const sdp = "v=0\r\na=fingerprint:sha-256 01:02:03:04\r\na=candidate:1 1 udp 100 127.0.0.1 55000 typ host\r\n";

class FakeChannel {
  label = "remote-jam-midi-v1";
  ordered = true;
  maxRetransmits = null;
  maxPacketLifeTime = null;
  readyState = "open";
  bufferedAmount = 0;
  sent: string[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(message: string) { this.sent.push(message); }
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.();
  }
  receive(message: string) { this.onmessage?.({ data: message }); }
}
class FakePeer {
  static active: FakePeer | null = null;
  channel = new FakeChannel();
  localDescription: { sdp: string } | null = null;
  iceGatheringState = "complete";
  connectionState = "connected";
  ondatachannel: ((event: { channel: FakeChannel }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() { FakePeer.active = this; }
  addEventListener() {}
  removeEventListener() {}
  async setRemoteDescription() {
    this.ondatachannel?.({ channel: this.channel });
  }
  async createAnswer() { return { type: "answer" as const, sdp }; }
  async setLocalDescription() { this.localDescription = { sdp }; }
  close() { this.connectionState = "closed"; this.onconnectionstatechange?.(); }
}
function rjFrame(seq: number, eventType: "note_on" | "note_off", velocity: number) {
  return JSON.stringify({
    version: "midi-delivery-v1", session_id: IDS.sessionId, stream_id: IDS.streamId,
    sequence: seq, sent_ns: seq * 1_000_000, play_ns: seq * 1_000_000 + 1,
    deadline_ns: seq * 1_000_000 + 10_000_000,
    event: {
      event_id: "note-" + seq, event_type: eventType,
      occurred_at: "2026-10-24T00:30:00Z",
      source_peer_id: IDS.remotePeerId, target_peer_id: IDS.localPeerId,
      payload: { channel: 1, note: 60, velocity },
    },
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakePeer.active = null;
});

describe("NanoDAW ↔ Remote Jam browser connection composition", () => {
  it("authenticates Go SDP before dispatch, responds to probes, and panics on channel closure", async () => {
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("RTCPeerConnection", FakePeer);
    const authenticatedOffer = await signRjSDP({
      ...IDS, localPeerId: IDS.remotePeerId, remotePeerId: IDS.localPeerId,
    }, "offer", sdp, secret);

    const requests: { url: string; method: string; auth: string | null }[] = [];
    const fakeFetch = vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      const headers = new Headers(init.headers);
      requests.push({ url, method, auth: headers.get("Authorization") });
      const payload = method === "GET"
        ? [{ room_id: IDS.roomId, peer_id: IDS.remotePeerId, target_peer_id: IDS.localPeerId,
            event_type: "offer", payload: authenticatedOffer }]
        : {};
      return { status: method === "GET" ? 200 : url.endsWith("/signals") ? 202 : 201,
        ok: true, json: async () => payload };
    });
    vi.stubGlobal("fetch", fakeFetch);
    const calls: unknown[][] = [];
    const port = {
      noteOn: (pitch: number, velocity: number) => calls.push(["on", pitch, velocity]),
      noteOff: (pitch: number) => calls.push(["off", pitch]),
      panic: () => calls.push(["panic"]),
      dispose: () => calls.push(["dispose"]),
    };
    const acquire = vi.fn(async () => port);
    const onStatus = vi.fn(), onStats = vi.fn(), onClosed = vi.fn();
    const handle = await joinBrowserRemoteJam({
      ...IDS, role: "answer", secret, signal: new AbortController().signal,
      onStatus, onStats, onClosed,
    }, acquire);
    expect(acquire).toHaveBeenCalledOnce();
    expect(requests.every((entry) => entry.url.startsWith("/api/remote-jam-hub/"))).toBe(true);
    expect(requests.every((entry) => entry.auth === "Bearer " + secret)).toBe(true);
    expect(onStatus).toHaveBeenCalledWith("connected", expect.any(String));

    const channel = FakePeer.active!.channel;
    channel.receive(rjFrame(1, "note_on", 98));
    channel.receive(rjFrame(2, "note_off", 0));
    expect(calls).toContainEqual(["on", 60, 98]);
    expect(calls).toContainEqual(["off", 60]);
    expect(handle.stats().receivedMidi).toBe(2);
    expect(handle.stats().dispatchedNotes).toBe(2);
    expect(handle.stats().audioProof).toBe("not_measured");
    expect(handle.stats().clockSync).toBe("not_measured");

    channel.receive(JSON.stringify({ type: "ping", session: IDS.sessionId, from: IDS.remotePeerId, to: IDS.localPeerId, seq: 1 }));
    expect(channel.sent.some((item) => JSON.parse(item).type === "pong")).toBe(true);
    handle.sendNote(64);
    expect(channel.sent.some((item) => JSON.parse(item).event?.event_type === "note_on")).toBe(true);

    channel.close();
    expect(calls.at(-1)).toEqual(["dispose"]);
    expect(calls.some((item) => item[0] === "panic")).toBe(true);
    expect(onClosed).toHaveBeenCalledOnce();
    expect(() => handle.sendNote(65)).toThrow();
  });

  it("rejects an invalid SDP until abort, never arming local notes or leaking sound", async () => {
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("RTCPeerConnection", FakePeer);
    const badOffer = await signRjSDP({
      ...IDS, localPeerId: IDS.remotePeerId, remotePeerId: IDS.localPeerId,
    }, "offer", sdp, secret);
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true, status: init.method === "GET" ? 200 : 201,
      json: async () => init.method === "GET"
        ? [{ room_id: IDS.roomId, peer_id: IDS.remotePeerId, target_peer_id: IDS.localPeerId,
             event_type: "offer", payload: { ...badOffer, mac: "0".repeat(64) } }]
        : {},
    })));
    const panic = vi.fn(), dispose = vi.fn();
    const pending = joinBrowserRemoteJam({
      ...IDS, role: "answer", secret, signal: controller.signal,
      onStatus: vi.fn(), onStats: vi.fn(), onClosed: vi.fn(),
    }, async () => ({ noteOn: vi.fn(), noteOff: vi.fn(), panic, dispose }));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
