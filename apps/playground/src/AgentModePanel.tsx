import { useEffect, useMemo, useRef, useState } from "react";
import { Cable, ShieldCheck, Sparkles, Unplug } from "lucide-react";

import {
  createAgentGatewaySession,
  type AgentGatewaySession,
  type AgentGatewaySessionOptions,
  type AgentPlanPreview,
  type McpPlanInbox,
} from "./agentGateway";
import { createMcpAudioPort } from "./mcpAudioPort";
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
  const [songAudioPlaying, setSongAudioPlaying] = useState(false);
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
  const [inbox, setInbox] = useState<McpPlanInbox | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const handledMcpPlans = useRef(new Map<string, number>());

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

  const gatewayPort = useMemo(
    () => createMcpAudioPort({
      onPlaying: setSongAudioPlaying,
      inspect: () => usePlaygroundStore.getState().inspectRemoteSession(),
      execute: (request) =>
        usePlaygroundStore.getState().executeRemoteCommandBatch(request),
    }),
    [],
  );

  useEffect(() => () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.disconnect();
    const wasPlaying = gatewayPort.isPlaying();
    gatewayPort.dispose();
    if (wasPlaying && usePlaygroundStore.getState().commandState.song?.transport.isPlaying) usePlaygroundStore.getState().dispatch({ type: "StopPlayback" });
  }, [gatewayPort]);

  useEffect(() => {
    if (connection !== "connected") return;
    const session = sessionRef.current;
    if (!session) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const next = await session.listMcpPlans();
        if (cancelled || sessionRef.current !== session) return;
        const now = Date.now();
        for (const [id, expiry] of handledMcpPlans.current) {
          if (expiry <= now) handledMcpPlans.current.delete(id);
        }
        setInbox(next);
        setInboxError(null);
        if (next) timer = setTimeout(() => void refresh(), 10_000);
      } catch (error) {
        if (cancelled || sessionRef.current !== session) return;
        setInbox(null);
        setInboxError(error instanceof Error ? error.message : "Proposal discovery unavailable.");
        // Stop on authentication, quota or network failures; no retry storm.
      }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [connection]);

  useEffect(() => usePlaygroundStore.subscribe((state, previous) => {
    if (state.commandState !== previous.commandState && gatewayPort.isPlaying() && !gatewayPort.isBusy()) {
      gatewayPort.stop();
      if (state.commandState.song?.transport.isPlaying) state.dispatch({ type: "StopPlayback" });
    }
  }), [gatewayPort]);

  const stopSongAudio = () => {
    gatewayPort.stop();
    if (usePlaygroundStore.getState().commandState.song?.transport.isPlaying) usePlaygroundStore.getState().dispatch({ type: "StopPlayback" });
  };

  const disable = () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.disconnect();
    setEnabled(false);
    stopSongAudio();
    setConnection("off");
    setOperation("idle");
    setPreview(null);
    setOperatorSecret("");
    setMcpPlanId("");
    setMessage(null);
    setInbox(null);
    setInboxError(null);
    handledMcpPlans.current.clear();
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
    let session: AgentGatewaySession | null = null;
    try {
      session = sessionFactory({
        baseUrl: gatewayUrl,
        operatorSecret,
        actorId: "nanodaw-browser",
        port: gatewayPort,
        onConnectionChange: (connected) => {
          if (sessionRef.current !== session) return;
          if (!connected) stopSongAudio();
          setConnection(connected ? "connected" : "disconnected");
        },
      });
      sessionRef.current = session;
      await session.connect();
      if (sessionRef.current !== session) { session.disconnect(); return; }
      setOperatorSecret("");
      setConnection("connected");
      setMessage(developerMode ? "Gateway paired. NanoDAW remains the song owner." : "Twin is ready. Describe your next musical idea.");
    } catch (error) {
      if (session && sessionRef.current !== session) return;
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
      if (sessionRef.current !== session) return;
      setPreview(nextPreview);
      setOperation("preview");
      setMessage(developerMode ? "Preview only. No NanoDAW command has executed." : "Review your proposal. Your jam has not changed.");
    } catch (error) {
      if (sessionRef.current !== session) return;
      setOperation("idle");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const loadMcpPlan = async (planId = mcpPlanId) => {
    const session = sessionRef.current;
    if (!session?.isConnected()) {
      setMessage("Connect Agent mode before loading an MCP plan.");
      return;
    }
    setOperation("running");
    setPreview(null);
    setMessage(null);
    try {
      const nextPreview = await session.loadMcpPlan(planId);
      if (sessionRef.current !== session) return;
      handledMcpPlans.current.set(nextPreview.plan.planId, Date.parse(nextPreview.plan.expiresAt));
      setPreview(nextPreview);
      setOperation("preview");
      setMcpPlanId("");
      setMessage("MCP plan loaded for review. No NanoDAW command has executed.");
    } catch (error) {
      if (sessionRef.current !== session) return;
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
          `Execution did not report success (${execution.report.status}). Do not retry this plan; inspect NanoDAW before generating a fresh preview.`,
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
      {songAudioPlaying ? <div role="status" className="mcp-song-audio">Song audio playing <button type="button" className="tool-button" onClick={stopSongAudio}>Stop song audio</button></div> : null}
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
              {inbox ? <div aria-label="Incoming MCP proposals">
                <p>External agent proposals arrive here. Choose one to review; your jam stays unchanged.</p>
                <ul>
                  {inbox.plans.filter((plan) => Date.parse(plan.expiresAt) > Date.now() &&
                    !handledMcpPlans.current.has(plan.planId)).map((plan) => <li key={plan.planId}>
                    <button type="button" className="tool-button" onClick={() => void loadMcpPlan(plan.planId)}
                      disabled={operation === "running" || operation === "executing" || preview !== null}>
                      Review {plan.name} · {plan.instrumentId}
                    </button>
                  </li>)}
                </ul>
                {!inbox.agentAvailable ? <p>This gateway accepts external MCP proposals only. Configure LITERT_BASE_URL and LITERT_MODEL to generate ideas here.</p> : null}
              </div> : null}
              {inboxError ? <p role="status">{inboxError}</p> : null}
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
                  disabled={inbox?.agentAvailable === false || !request.trim() || operation === "running" || operation === "executing"}
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
    case "RenameTrack": return `${target}: rename to “${field("name")}”`;
    case "DeleteTrack": return `${target}: DELETE track and ALL its clips and notes`;
    case "DeleteClip": return `${target}: DELETE clip and ALL its notes`;
    case "UpdateClip": return `${target}: edit clip · ${["name", "startBeat", "lengthBeats"].filter((key) => field(key)).map((key) => `${key}: ${field(key)}`).join(", ")}`;
    case "RestoreTrack": {
      const track = command.track as { name?: string; id?: string; instrumentId?: string; clips?: { pattern?: { notes?: unknown[] } }[] } | undefined;
      const clips = track?.clips ?? [];
      return `Restore “${track?.name ?? track?.id ?? "track"}” · ${track?.instrumentId ?? "instrument"} · ${clips.length} clips · ${clips.reduce((count, clip) => count + (clip.pattern?.notes?.length ?? 0), 0)} notes · position ${field("index")}`;
    }
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
