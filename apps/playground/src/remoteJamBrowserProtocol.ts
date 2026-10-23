/**
 * Browser counterpart of Remote Jam internal/lanwire.SignedSDP (rj-lan-signal-v1).
 * Uses an explicit shared room key, not a peer ID as authentication. The key is
 * never stored or logged. Group-key holders may impersonate each other.
 */
export const RJ_SIGNAL_VERSION = "rj-lan-signal-v1";
const encoder = new TextEncoder();
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_SDP = 65_536;
const MAX_SIGNAL = MAX_SDP + 2_048;
const SIGNAL_TTL_MS = 120_000;

export type RjRole = "offer" | "answer";
export type RjSignal = Readonly<{
  version: typeof RJ_SIGNAL_VERSION;
  room_id: string;
  session_id: string;
  from_peer_id: string;
  to_peer_id: string;
  kind: RjRole;
  issued_at: string;
  sdp: string;
  mac: string;
}>;
export type SignalIdentity = Readonly<{
  roomId: string;
  sessionId: string;
  localPeerId: string;
  remotePeerId: string;
}>;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function checkId(value: string) {
  if (!ID.test(value)) throw Error("Invalid Remote Jam room/session/peer identifier");
}
function normalizeGoTime(value: string): string {
  // Preserve Go's nanosecond precision (Date loses the final six digits).
  // Both this browser and the Remote Jam CLI sign timestamps in UTC.
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) throw Error("Invalid UTC signaling time");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return match[1] + (fraction ? "." + fraction : "") + "Z";
}
function goJSON(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case "<": return "\\u003c";
      case ">": return "\\u003e";
      case "&": return "\\u0026";
      case "\u2028": return "\\u2028";
      default: return "\\u2029";
    }
  });
}
/** Encode exact Go struct field order with MAC set to empty string. */
export function canonicalRjSignal(signal: RjSignal): string {
  return goJSON({
    version: signal.version,
    room_id: signal.room_id,
    session_id: signal.session_id,
    from_peer_id: signal.from_peer_id,
    to_peer_id: signal.to_peer_id,
    kind: signal.kind,
    issued_at: normalizeGoTime(signal.issued_at),
    sdp: signal.sdp,
    mac: "",
  });
}
function verifyShape(s: RjSignal): void {
  if (s.version !== RJ_SIGNAL_VERSION || !ID.test(s.room_id)
    || !ID.test(s.session_id) || !ID.test(s.from_peer_id)
    || !ID.test(s.to_peer_id) || s.from_peer_id === s.to_peer_id
    || (s.kind !== "offer" && s.kind !== "answer")
    || !s.sdp.includes("a=fingerprint:") || encoder.encode(s.sdp).length < 20
    || encoder.encode(s.sdp).length > MAX_SDP) {
    throw Error("Invalid Remote Jam authenticated SDP");
  }
}
async function hmac(secret: string, data: string): Promise<string> {
  // Requires a secure context (localhost or HTTPS); Web Crypto is not optional.
  if (encoder.encode(secret).length < 32 || encoder.encode(secret).length > 256) {
    throw Error("Room secret must contain 32..256 UTF-8 bytes");
  }
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function signRjSDP(
  identity: SignalIdentity, kind: RjRole, sdp: string, secret: string, now = new Date(),
): Promise<RjSignal> {
  for (const id of [identity.roomId, identity.sessionId, identity.localPeerId, identity.remotePeerId]) checkId(id);
  const draft: RjSignal = {
    version: RJ_SIGNAL_VERSION,
    room_id: identity.roomId,
    session_id: identity.sessionId,
    from_peer_id: identity.localPeerId,
    to_peer_id: identity.remotePeerId,
    kind,
    issued_at: normalizeGoTime(now.toISOString()),
    sdp,
    mac: "",
  };
  verifyShape(draft);
  return { ...draft, mac: await hmac(secret, canonicalRjSignal(draft)) };
}
export async function verifyRjSDP(
  raw: unknown, identity: SignalIdentity, kind: RjRole, secret: string, now = new Date(),
): Promise<RjSignal> {
  if (!record(raw) || encoder.encode(JSON.stringify(raw)).length > MAX_SIGNAL) {
    throw Error("Malformed or oversized Remote Jam signal");
  }
  const fields = ["version", "room_id", "session_id", "from_peer_id", "to_peer_id", "kind", "issued_at", "sdp", "mac"];
  if (Object.keys(raw).length !== fields.length || fields.some((field) => !Object.hasOwn(raw, field))
    || fields.some((field) => typeof raw[field] !== "string")) {
    throw Error("Invalid signed SDP fields");
  }
  const value = raw as RjSignal;
  verifyShape(value);
  if (value.room_id !== identity.roomId || value.session_id !== identity.sessionId
    || value.from_peer_id !== identity.remotePeerId || value.to_peer_id !== identity.localPeerId
    || value.kind !== kind) throw Error("Remote Jam signal session/peer mismatch");
  const age = now.getTime() - new Date(value.issued_at).getTime();
  if (!Number.isFinite(age) || age > SIGNAL_TTL_MS || age < -15_000) throw Error("Expired/future Remote Jam signal");
  if (!/^[a-f0-9]{64}$/i.test(value.mac)) throw Error("Missing/invalid SDP MAC");
  const expected = await hmac(secret, canonicalRjSignal(value));
  // Constant-work comparison, plus WebRTC's own DTLS fingerprint validation.
  const a = encoder.encode(value.mac.toLowerCase()), b = encoder.encode(expected);
  let diff = 0;
  for (let i = 0; i < b.length; i++) diff |= a[i]! ^ b[i]!;
  if (diff !== 0) throw Error("Remote Jam SDP HMAC authentication failed");
  return value;
}
