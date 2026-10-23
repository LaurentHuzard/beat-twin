import { createHmac, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalRjSignal, signRjSDP, verifyRjSDP, type RjSignal,
} from "./remoteJamBrowserProtocol";

const secret = "a".repeat(64);
const identity = { roomId: "rehearsal-01", sessionId: "take-01", localPeerId: "browser-b", remotePeerId: "beat-a" };
const sdp = "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 01:02:03:04\r\n";
const when = new Date("2026-10-24T00:35:12.123Z");

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe("Remote Jam signed SDP / Go wire compatibility", () => {
  it("generates same signature as Go canonical encoding/json struct including empty MAC", async () => {
    const signed = await signRjSDP(identity, "answer", sdp, secret, when);
    expect(signed.issued_at).toBe("2026-10-24T00:35:12.123Z");
    const independentGoStruct = JSON.stringify({
      version: signed.version, room_id: signed.room_id, session_id: signed.session_id,
      from_peer_id: signed.from_peer_id, to_peer_id: signed.to_peer_id,
      kind: signed.kind, issued_at: signed.issued_at, sdp: signed.sdp, mac: "",
    });
    expect(signed.mac).toBe(createHmac("sha256", secret).update(independentGoStruct).digest("hex"));
    expect(canonicalRjSignal(signed)).toBe(independentGoStruct);
  });

  it("verifies a Go-originated nanosecond timestamp without losing fractional digits", async () => {
    const signed = await signRjSDP(
      { ...identity, localPeerId: "beat-a", remotePeerId: "browser-b" },
      "offer", sdp, secret, when,
    );
    const goTimestamp: RjSignal = { ...signed, issued_at: "2026-10-24T00:35:12.123456789Z" };
    const mac = createHmac("sha256", secret).update(canonicalRjSignal(goTimestamp)).digest("hex");
    const verified = await verifyRjSDP({ ...goTimestamp, mac }, identity, "offer", secret, when);
    expect(verified.issued_at).toBe("2026-10-24T00:35:12.123456789Z");
    expect(verified.mac).toBe(mac);
  });

  it("refuses altered session, invalid MAC, stale message, oversized SDP and unknown fields", async () => {
    const remoteIdentity = { ...identity, localPeerId: "beat-a", remotePeerId: "browser-b" };
    const valid = await signRjSDP(remoteIdentity, "offer", sdp, secret, when);
    await expect(verifyRjSDP(valid, identity, "offer", secret, when)).resolves.toMatchObject({ kind: "offer" });
    const broken: unknown[] = [
      { ...valid, mac: "0".repeat(64) },
      { ...valid, room_id: "evil" },
      { ...valid, from_peer_id: "attacker" },
      { ...valid, sdp: sdp + "a=candidate:changed" },
      { ...valid, extra: "field" },
      { ...valid, issued_at: "tomorrow" },
    ];
    for (const value of broken) {
      await expect(verifyRjSDP(value, identity, "offer", secret, when)).rejects.toThrow();
    }
    await expect(verifyRjSDP(valid, identity, "offer", secret, new Date(when.getTime() + 130_000))).rejects.toThrow(/Expired/);
    await expect(verifyRjSDP(valid, identity, "offer", "other".repeat(10), when)).rejects.toThrow(/HMAC/);
    await expect(signRjSDP(remoteIdentity, "offer", sdp, "short", when)).rejects.toThrow(/32/);
    await expect(signRjSDP(remoteIdentity, "offer", sdp + "x".repeat(66_000), secret, when)).rejects.toThrow(/SDP/);
  });

  it("matches an independent Go standard-library SignedSDP/HMAC fixture with nanos and HTML escapes", async () => {
    // Produced independently with encoding/json, time.Parse(RFC3339Nano),
    // crypto/hmac and crypto/sha256. Does not rely on the TS encoder.
    const key = "a123456789012345678901234567890123456789012345678901234567890123";
    const goFixture: RjSignal = {
      version: "rj-lan-signal-v1",
      room_id: "rehearsal-01",
      session_id: "take-01",
      from_peer_id: "beat-a",
      to_peer_id: "browser-b",
      kind: "offer",
      issued_at: "2026-10-24T00:35:12.123456789Z",
      sdp: "v=0\r\na=fingerprint:sha-256 01:02:03:04\r\na=foo:<>&\u2028\u2029\r\n",
      mac: "dba5ed650e82436401e21f797a75a6a47362cec1895f96739163a5e98fbc6981",
    };
    const tested = await verifyRjSDP(
      goFixture,
      { roomId: "rehearsal-01", sessionId: "take-01", localPeerId: "browser-b", remotePeerId: "beat-a" },
      "offer", key, new Date("2026-10-24T00:35:12.123Z"),
    );
    expect(tested.mac).toBe(goFixture.mac);
  });

  it("handles HTML escaped bytes exactly as Go encoding/json", async () => {
    const escaped = sdp + "a=foo:<>&\u2028\u2029\r\n";
    const signed = await signRjSDP(identity, "answer", escaped, secret, when);
    const canonical = canonicalRjSignal(signed);
    expect(canonical).toContain("\\u003c\\u003e\\u0026\\u2028\\u2029");
    expect(signed.mac).toBe(createHmac("sha256", secret).update(canonical).digest("hex"));
  });
});
