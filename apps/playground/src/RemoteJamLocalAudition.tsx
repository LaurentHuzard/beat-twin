import { useEffect, useRef, useState } from "react";

import {
  acquireNanoDawRemoteJamAudio,
  type NanoJamSoundPort,
} from "./remoteJamTonePort";

/**
 * Developer-only acoustic smoke. This is intentionally NOT a remote connection
 * and does not impersonate a verified Remote Jam peer/session.
 */
export function RemoteJamLocalAudition() {
  const portRef = useRef<NanoJamSoundPort | null>(null);
  const pendingRef = useRef<Promise<NanoJamSoundPort> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const [status, setStatus] = useState<"idle" | "unlocking" | "ready" | "error">("idle");
  const [message, setMessage] = useState("This checks the browser synth only. No network peer is connected.");

  function clearTimer() {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }

  function close() {
    clearTimer();
    const port = portRef.current;
    portRef.current = null;
    port?.dispose();
  }

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      close();
      const pending = pendingRef.current;
      if (pending) void pending.then((port) => port.dispose(), () => undefined);
    };
  }, []);

  async function enable() {
    if (pendingRef.current || portRef.current) return;
    setStatus("unlocking");
    try {
      const pending = acquireNanoDawRemoteJamAudio();
      pendingRef.current = pending;
      const port = await pending;
      pendingRef.current = null;
      if (!aliveRef.current) { port.dispose(); return; }
      portRef.current = port;
      setStatus("ready");
      setMessage("Local Tone.js instrument armed. This is not an authenticated Remote Jam session.");
    } catch (error) {
      pendingRef.current = null;
      if (aliveRef.current) {
        setStatus("error");
        setMessage("Could not unlock local synth: " + String(error));
      }
    }
  }

  function audition() {
    const port = portRef.current;
    if (!port) return;
    try {
      clearTimer();
      port.panic();
      port.noteOn(60, 96);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        try { port.noteOff(60); }
        catch (error) {
          close();
          setStatus("error");
          setMessage("Local synth release failed: " + String(error));
        }
      }, 300);
    } catch (error) {
      close();
      setStatus("error");
      setMessage("Local synth test failed: " + String(error));
    }
  }

  function stop() {
    try { close(); }
    finally {
      setStatus("idle");
      setMessage("Local test ended. No remote peer or WebRTC session was touched.");
    }
  }

  return (
    <section aria-label="Remote Jam local sound test" className="remote-jam-local-audition">
      <h3>Remote Jam / NanoDAW · Local sound test</h3>
      <p>{message}</p>
      <div className="remote-jam-local-audition-actions">
        <button type="button" onClick={() => void enable()} disabled={status === "unlocking" || status === "ready"}>
          {status === "unlocking" ? "Unlocking…" : "Enable local synth"}
        </button>
        <button type="button" onClick={audition} disabled={status !== "ready"}>Play C4 (300 ms)</button>
        <button type="button" onClick={stop} disabled={status === "idle"}>Stop / release</button>
      </div>
    </section>
  );
}
