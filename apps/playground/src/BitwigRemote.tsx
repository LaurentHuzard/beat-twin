import {
  Activity,
  ArrowLeft,
  LockKeyhole,
  Play,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  bitwigControllerClient,
  type BitwigControllerClient,
  type BitwigWebSnapshot,
} from "./bitwigControllerClient";

const transportActions = Object.freeze([
  { tool: "transport_restart", label: "Restart", icon: RotateCcw },
  { tool: "transport_play", label: "Play", icon: Play },
  { tool: "transport_stop", label: "Stop", icon: Square },
]);

type BitwigRemoteProps = {
  readonly onClose: () => void;
  readonly client?: BitwigControllerClient;
};

function displayValue(value: unknown, fallback = "—"): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return fallback;
}

function namedItems(value: unknown): readonly string[] {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "tracks" in value
      ? (value as { readonly tracks?: unknown }).tracks
      : [];

  if (!Array.isArray(source)) return [];
  return source.slice(0, 8).map((item, index) => {
    if (item && typeof item === "object") {
      const record = item as Readonly<Record<string, unknown>>;
      return displayValue(record.name, `Track ${displayValue(record.index, String(index + 1))}`);
    }
    return displayValue(item, `Track ${index + 1}`);
  });
}

function namedObject(value: unknown): string {
  if (value && typeof value === "object" && "name" in value) {
    return displayValue((value as { readonly name?: unknown }).name);
  }
  return displayValue(value);
}

export function BitwigRemote({
  onClose,
  client = bitwigControllerClient,
}: BitwigRemoteProps) {
  const [snapshot, setSnapshot] = useState<BitwigWebSnapshot | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [pendingTool, setPendingTool] = useState<string | null>(null);
  const [executingTool, setExecutingTool] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const inspect = useCallback(async (signal?: AbortSignal) => {
    setPendingTool(null);
    setPhase("loading");
    setError(null);
    try {
      const nextSnapshot = await client.inspect(signal);
      setSnapshot(nextSnapshot);
      setPhase("ready");
    } catch (inspectionError) {
      if (signal?.aborted) return;
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : "The local Bitwig bridge could not be inspected.",
      );
      setPhase("error");
    }
  }, [client]);

  useEffect(() => {
    const controller = new AbortController();
    void inspect(controller.signal);
    return () => controller.abort();
  }, [inspect]);

  useEffect(() => {
    if (pendingTool) confirmButtonRef.current?.focus();
  }, [pendingTool]);

  const confirmCommand = useCallback(async () => {
    if (!pendingTool) return;
    const tool = pendingTool;
    setPendingTool(null);
    setExecutingTool(tool);
    setNotice(null);
    try {
      await client.execute(tool);
      setNotice(`${transportActions.find((action) => action.tool === tool)?.label ?? tool} acknowledged by Bitwig.`);
      await inspect();
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Bitwig command failed.");
      setPhase("error");
    } finally {
      setExecutingTool(null);
    }
  }, [client, inspect, pendingTool]);

  const session = snapshot?.session;
  const connected = session?.connected === true;
  const enabledCommands = new Set(snapshot?.commands.map((command) => command.name) ?? []);
  const tracks = namedItems(session?.trackBank);

  return (
    <main className="bitwig-remote" aria-label="Bitwig Remote">
      <header className="bitwig-remote-header">
        <button type="button" className="bitwig-back" onClick={onClose}>
          <ArrowLeft size={18} />
          <span>NanoDAW</span>
        </button>
        <div className="bitwig-brand">
          <div className="brand-mark" aria-hidden="true"><Waves size={24} /></div>
          <div>
            <p className="eyebrow">Beat Twin / local control surface</p>
            <h1>Bitwig Remote</h1>
          </div>
        </div>
        <button
          type="button"
          className="bitwig-refresh"
          onClick={() => void inspect()}
          disabled={phase === "loading" || executingTool !== null}
        >
          <RefreshCw size={17} className={phase === "loading" ? "is-spinning" : undefined} />
          <span>Refresh</span>
        </button>
      </header>

      <section className="bitwig-security-strip" aria-label="Bridge security">
        <LockKeyhole size={18} />
        <div>
          <strong>Secrets stay server-side</strong>
          <span>Loopback, same-origin, current MCP policy</span>
        </div>
        <span className={`connection-pill ${connected ? "connected" : "offline"}`}>
          {phase === "loading" ? "Checking" : connected ? "Connected" : "Offline"}
        </span>
      </section>

      {phase === "error" && !snapshot ? (
        <section className="bitwig-empty-state" role="alert">
          <Activity size={28} />
          <h2>Local bridge unavailable</h2>
          <p>{error}</p>
          <button type="button" className="tool-button" onClick={() => void inspect()}>
            Retry inspection
          </button>
        </section>
      ) : (
        <div className="bitwig-console">
          <section className="bitwig-transport" aria-label="Bitwig transport">
            <div className="bitwig-section-heading">
              <div>
                <p className="eyebrow">Transport</p>
                <h2>{connected ? "Session online" : "Bitwig is not connected"}</h2>
              </div>
              <div className="bitwig-tempo">
                <strong>{displayValue(session?.transport?.tempo)}</strong>
                <span>BPM</span>
              </div>
            </div>

            <div className="bitwig-position" aria-label="Bitwig session position">
              <span>Position</span>
              <strong>{displayValue(session?.transport?.position, "No signal")}</strong>
              <small>{session?.transport?.isRecording === true ? "Recording" : "Not recording"}</small>
            </div>

            <div className="bitwig-transport-actions" role="group" aria-label="Bitwig transport commands">
              {transportActions.map(({ tool, label, icon: Icon }) => {
                const isEnabled = connected && enabledCommands.has(tool);
                return (
                  <button
                    key={tool}
                    type="button"
                    className={tool === "transport_play" ? "primary" : undefined}
                    onClick={() => setPendingTool(tool)}
                    disabled={!isEnabled || executingTool !== null}
                    title={isEnabled ? `${label} in Bitwig` : "Enable the transport write policy and connect Bitwig"}
                  >
                    <Icon size={20} />
                    <span>{executingTool === tool ? "Sending…" : label}</span>
                  </button>
                );
              })}
            </div>

            {!enabledCommands.has("transport_play") ? (
              <p className="bitwig-policy-note">
                Transport writes are locked. Enable the server-side <code>transport</code> policy to reveal them.
              </p>
            ) : null}
            {!connected ? (
              <p className="bitwig-offline-copy" role="status">
                {session?.setup_hint ?? "Start Bitwig Studio and enable the Beat Twin controller, then refresh."}
              </p>
            ) : null}
            {notice ? <p className="bitwig-notice" role="status">{notice}</p> : null}
            {error && snapshot ? <p className="bitwig-command-error" role="alert">{error}</p> : null}
          </section>

          <aside className="bitwig-session-stack" aria-label="Bitwig session overview">
            <section>
              <div className="bitwig-card-title">
                <SlidersHorizontal size={17} />
                <h2>Selected channel</h2>
              </div>
              <strong>{namedObject(session?.selectedTrack)}</strong>
              <span>{tracks.length > 0 ? `${tracks.length} tracks visible` : "No track bank data"}</span>
            </section>
            <section>
              <div className="bitwig-card-title">
                <Activity size={17} />
                <h2>Selected device</h2>
              </div>
              <strong>{namedObject(session?.selectedDevice)}</strong>
              <span>Read-only session inspection</span>
            </section>
            <section className="bitwig-track-list">
              <p className="eyebrow">Track bank</p>
              {tracks.length > 0 ? (
                <ol>{tracks.map((track, index) => <li key={`${track}-${index}`}>{track}</li>)}</ol>
              ) : (
                <p>Track names appear here once the controller responds.</p>
              )}
            </section>
          </aside>
        </div>
      )}

      {pendingTool ? (
        <aside className="bitwig-confirmation" role="dialog" aria-modal="false" aria-labelledby="bitwig-confirm-title">
          <div>
            <p className="eyebrow">External write</p>
            <h2 id="bitwig-confirm-title">
              Confirm {transportActions.find((action) => action.tool === pendingTool)?.label} in Bitwig?
            </h2>
            <p>This action targets the live Bitwig transport. It does not change the NanoDAW song.</p>
          </div>
          <div className="bitwig-confirm-actions">
            <button type="button" onClick={() => setPendingTool(null)}>Cancel</button>
            <button ref={confirmButtonRef} type="button" className="primary" onClick={() => void confirmCommand()}>
              Confirm once
            </button>
          </div>
        </aside>
      ) : null}
    </main>
  );
}
