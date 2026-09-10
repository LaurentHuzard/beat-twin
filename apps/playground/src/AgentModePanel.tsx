import { useEffect, useMemo, useRef, useState } from "react";
import { Cable, ShieldCheck, Sparkles, Unplug } from "lucide-react";

import {
  createAgentGatewaySession,
  type AgentGatewaySession,
  type AgentGatewaySessionOptions,
  type AgentPlanPreview,
  type BrowserCommandPort,
} from "./agentGateway";
import { usePlaygroundStore } from "./store";

type SessionFactory = (options: AgentGatewaySessionOptions) => AgentGatewaySession;
let sessionFactory: SessionFactory = createAgentGatewaySession;

export function setAgentGatewaySessionFactory(factory: SessionFactory): void {
  sessionFactory = factory;
}

export function resetAgentGatewaySessionFactory(): void {
  sessionFactory = createAgentGatewaySession;
}

type ConnectionState = "off" | "disconnected" | "connecting" | "connected";
type OperationState = "idle" | "running" | "preview" | "executing" | "completed" | "failed";

export function AgentModePanel({ developerMode = false }: { developerMode?: boolean }) {
  const song = usePlaygroundStore((state) => state.commandState.song);
  const [enabled, setEnabled] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState("http://127.0.0.1:8787");
  const [operatorSecret, setOperatorSecret] = useState("");
  const [request, setRequest] = useState("");
  const [mcpPlanId, setMcpPlanId] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("off");
  const [operation, setOperation] = useState<OperationState>("idle");
  const [preview, setPreview] = useState<AgentPlanPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sessionRef = useRef<AgentGatewaySession | null>(null);

  const musicalNames = new Map<string, string>();
  for (const track of song?.tracks ?? []) {
    musicalNames.set(track.id, track.name);
    for (const clip of track.clips) musicalNames.set(clip.id, clip.name);
  }
  for (const value of preview?.plan.commands ?? []) {
    if (value && typeof value === "object" && "id" in value && typeof value.id === "string" && "name" in value && typeof value.name === "string") {
      musicalNames.set(value.id, value.name);
    }
  }

  const gatewayPort = useMemo<BrowserCommandPort>(
    () => ({
      inspect: () => usePlaygroundStore.getState().inspectRemoteSession(),
      executeCommandBatch: (request) =>
        usePlaygroundStore.getState().executeRemoteCommandBatch(request),
    }),
    [],
  );

  useEffect(() => () => sessionRef.current?.disconnect(), []);

  const disable = () => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setEnabled(false);
    setConnection("off");
    setOperation("idle");
    setPreview(null);
    setOperatorSecret("");
    setMcpPlanId("");
    setMessage(null);
  };

  const toggleEnabled = () => {
    if (enabled) {
      disable();
      return;
    }
    setEnabled(true);
    setConnection("disconnected");
  };

  const connect = async () => {
    setConnection("connecting");
    setMessage(null);
    try {
      const session = sessionFactory({
        baseUrl: gatewayUrl,
        operatorSecret,
        actorId: "nanodaw-browser",
        port: gatewayPort,
        onConnectionChange: (connected) => {
          setConnection(connected ? "connected" : "disconnected");
        },
      });
      sessionRef.current = session;
      await session.connect();
      setOperatorSecret("");
      setConnection("connected");
      setMessage(developerMode ? "Gateway paired. NanoDAW remains the song owner." : "Twin is ready. Describe your next musical idea.");
    } catch (error) {
      sessionRef.current?.disconnect();
      sessionRef.current = null;
      setConnection("disconnected");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const generatePreview = async () => {
    const session = sessionRef.current;
    if (!session?.isConnected()) {
      setMessage("Connect Agent mode before requesting a preview.");
      return;
    }
    setOperation("running");
    setPreview(null);
    setMessage(null);
    try {
      const nextPreview = await session.run(request);
      setPreview(nextPreview);
      setOperation("preview");
      setMessage(developerMode ? "Preview only. No NanoDAW command has executed." : "Review your proposal. Your jam has not changed.");
    } catch (error) {
      setOperation("idle");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const loadMcpPlan = async () => {
    const session = sessionRef.current;
    if (!session?.isConnected()) {
      setMessage("Connect Agent mode before loading an MCP plan.");
      return;
    }
    setOperation("running");
    setPreview(null);
    setMessage(null);
    try {
      const nextPreview = await session.loadMcpPlan(mcpPlanId);
      setPreview(nextPreview);
      setOperation("preview");
      setMcpPlanId("");
      setMessage("MCP plan loaded for review. No NanoDAW command has executed.");
    } catch (error) {
      setOperation("idle");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const confirmAndApply = async () => {
    const session = sessionRef.current;
    if (!session?.isConnected()) {
      setMessage("Reconnect Agent mode before applying this preview.");
      return;
    }
    if (!preview) return;
    const planId = preview.plan.planId;
    setOperation("executing");
    setPreview(null);
    setMessage(null);
    try {
      const execution = await session.confirmAndExecute(planId);
      if (!execution.report.ok) {
        setOperation("failed");
        setMessage(
          `Plan was not applied (${execution.report.status}). Generate a fresh preview before trying again.`,
        );
        return;
      }
      setOperation("completed");
      setMessage(developerMode ? "Plan applied as one NanoDAW batch and saved locally." : "Proposal applied and saved locally.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setOperation("failed");
      setMessage(
        `Execution could not be verified. Do not retry this plan; inspect NanoDAW before generating a fresh preview. ${detail}`,
      );
    }
  };

  return (
    <section className="agent-mode-panel" aria-label="Agent mode">
      <div className="agent-mode-heading">
        <div>
          <span className="eyebrow">Composition companion</span>
          <h2>Twin</h2>
          <p>Describe an idea, review the musical changes, then choose whether to apply them.</p>
        </div>
        <div className={`agent-mode-state ${connection}`} role="status">
          {connection === "connected" ? <Cable size={16} /> : <Unplug size={16} />}
          {connectionLabel(connection)}
        </div>
        <button
          type="button"
          className="tool-button"
          onClick={toggleEnabled}
          disabled={operation === "executing"}
        >
          {enabled ? "Disable Agent mode" : "Enable Agent mode"}
        </button>
      </div>

      {enabled ? (
        <div className="agent-mode-body">
          <details className="twin-connection-settings" open={developerMode || undefined}>
            <summary>Connection settings</summary>
          <div className="agent-connect-grid">
            <label>
              Gateway URL
              <input
                aria-label="Gateway URL"
                value={gatewayUrl}
                onChange={(event) => setGatewayUrl(event.currentTarget.value)}
                disabled={connection === "connecting" || connection === "connected"}
              />
            </label>
            <label>
              Operator secret
              <input
                aria-label="Operator secret"
                type="password"
                autoComplete="off"
                value={operatorSecret}
                onChange={(event) => setOperatorSecret(event.currentTarget.value)}
                disabled={connection === "connecting" || connection === "connected"}
              />
            </label>
            <button
              type="button"
              className="tool-button"
              onClick={() => void connect()}
              disabled={!operatorSecret.trim() || connection === "connecting" || connection === "connected"}
            >
              <ShieldCheck size={16} />
              {connection === "connecting" ? "Pairing…" : "Pair Gateway"}
            </button>
          </div>

          </details>

          {connection === "connected" ? (
            <>
              {developerMode ? <div className="mcp-plan-grid">
                <label>
                  MCP plan id
                  <input
                    aria-label="MCP plan id"
                    value={mcpPlanId}
                    onChange={(event) => setMcpPlanId(event.currentTarget.value)}
                    placeholder="plan-…"
                  />
                </label>
                <button
                  type="button"
                  className="tool-button primary"
                  onClick={() => void loadMcpPlan()}
                  disabled={!mcpPlanId.trim() || operation === "running" || operation === "executing"}
                >
                  <ShieldCheck size={16} />
                  {operation === "running" ? "Loading…" : "Load MCP plan"}
                </button>
              </div>
              : null}
              <div className="agent-request-grid">
                <label>
                  Musical request
                  <textarea
                    aria-label="Agent musical request"
                    rows={2}
                    value={request}
                    onChange={(event) => setRequest(event.currentTarget.value)}
                    placeholder="Create a restrained one-track bass sketch"
                  />
                </label>
                <button
                  type="button"
                  className="tool-button primary"
                  onClick={() => void generatePreview()}
                  disabled={!request.trim() || operation === "running" || operation === "executing"}
                >
                  <Sparkles size={16} />
                  {operation === "running" ? "Generating…" : "Generate preview"}
                </button>
              </div>
            </>
          ) : null}

          {preview ? (
            <div className="agent-plan-preview" aria-label="Agent plan preview">
              <div>
                <span className="eyebrow">Ready for your review</span>
                <h3>Musical proposal</h3>
                <p>Review every change below before applying. Audio audition is not available for this proposal.</p>
                {developerMode ? <p>
                  Plan {preview.plan.planId} · revision {preview.plan.baseRevision} · {preview.plan.requiredScopes.join(", ")} · expires {formatExpiry(preview.plan.expiresAt)}
                </p> : null}
                <ul className="agent-plan-summary">
                  {preview.preview.summary.map((summary) => <li key={summary}>{summary}</li>)}
                </ul>
              </div>
              <ol>
                {preview.plan.commands.map((command, index) => (
                  <li key={index}>{describeMusicalChange(command, musicalNames)}</li>
                ))}
              </ol>
              {developerMode ? <details>
                <summary>Technical plan details</summary>
                <pre>{JSON.stringify(preview.plan, null, 2)}</pre>
              </details> : null}
              <button
                type="button"
                className="tool-button primary confirm-plan"
                onClick={() => void confirmAndApply()}
                disabled={operation === "executing" || connection !== "connected"}
              >
                {operation === "executing" ? "Applying…" : "Confirm and apply once"}
              </button>
              <button type="button" className="tool-button" onClick={() => {
                setPreview(null);
                setOperation("idle");
                setMessage("Proposal discarded. Your jam has not changed.");
              }}>Discard proposal</button>
            </div>
          ) : null}

          {message ? <p className="agent-mode-message">{message}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function connectionLabel(state: ConnectionState): string {
  if (state === "connected") return "Connected";
  if (state === "connecting") return "Pairing";
  if (state === "disconnected") return "Not connected";
  return "Off";
}

function describeMusicalChange(value: unknown, names: ReadonlyMap<string, string>): string {
  if (!value || typeof value !== "object" || !("type" in value)) return "Unrecognised change — inspect in Developer Mode before applying.";
  const command = value as Record<string, unknown>;
  const field = (key: string, fallback = "") => typeof command[key] === "string" || typeof command[key] === "number" ? String(command[key]) : fallback;
  // Describe the executable plan, not just the provider's freeform summary.
  const target = [field("trackId"), field("clipId")].filter(Boolean).map((id) => names.get(id) ?? id).join(" / ");
  switch (command.type) {
    case "CreateSong": return `Replace the current song with “${field("title", "Untitled Beat Twin Song")}”${field("bpm") ? ` at ${field("bpm")} BPM` : ""}.`;
    case "CreateTrack": return `Add track “${field("name", "New track")}” · ${field("instrumentId", "default instrument")}`;
    case "SetTrackInstrument": return `${target}: change instrument to ${field("instrumentId")}`;
    case "CreateClip": return `${target}: add clip “${field("name", "Untitled Clip")}” · ${field("lengthBeats", "4")} beats, starting at beat ${field("startBeat", "0")}`;
    case "AddNote": return `${target}: add MIDI note ${field("pitch")} at beat ${field("startBeat")} · ${field("lengthBeats", "1")} beats · velocity ${field("velocity", "100")}`;
    case "UpdateNote": return `${target}: edit note ${field("noteId")} · ${["pitch", "startBeat", "lengthBeats", "velocity"].filter((key) => field(key)).map((key) => `${key}: ${field(key)}`).join(", ")}`;
    case "RemoveNote": return `${target}: remove note ${field("noteId")}`;
    case "DuplicateClip": return `${target}: duplicate as “${field("name", "Copy")}”${field("startBeat") ? ` at beat ${field("startBeat")}` : ""}`;
    case "QuantizeClip": return `${target}: quantize to ${field("gridBeats")} beats`;
    case "TransposeClip": return `${target}: transpose ${field("semitones")} semitones`;
    case "SetTempo": return `Set tempo to ${field("bpm")} BPM`;
    case "StartPlayback": return `Start playback${field("positionBeats") ? ` at beat ${field("positionBeats")}` : ""}`;
    case "StopPlayback": return `Stop playback${field("positionBeats") ? ` at beat ${field("positionBeats")}` : ""}`;
    case "SetPlayhead": return `Move playhead to beat ${field("positionBeats")}`;
    default: return "Unrecognised change — inspect in Developer Mode before applying.";
  }
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "soon" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
