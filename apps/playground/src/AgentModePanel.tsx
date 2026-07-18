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

export function AgentModePanel() {
  const [enabled, setEnabled] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState("http://127.0.0.1:8787");
  const [operatorSecret, setOperatorSecret] = useState("");
  const [request, setRequest] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("off");
  const [operation, setOperation] = useState<OperationState>("idle");
  const [preview, setPreview] = useState<AgentPlanPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sessionRef = useRef<AgentGatewaySession | null>(null);

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
      setMessage("Gateway paired. NanoDAW remains the song owner.");
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
      setMessage("Preview only. No NanoDAW command has executed.");
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
      setMessage("Plan applied as one NanoDAW batch and saved locally.");
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
          <span className="eyebrow">Optional local agent</span>
          <h2>Agent mode</h2>
          <p>Standalone editing stays available before, during, and after a connection.</p>
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

          {connection === "connected" ? (
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
          ) : null}

          {preview ? (
            <div className="agent-plan-preview" aria-label="Agent plan preview">
              <div>
                <span className="eyebrow">Human confirmation required</span>
                <h3>{preview.plan.commands.length} proposed commands</h3>
                <p>
                  Revision {preview.plan.baseRevision} · {preview.plan.requiredScopes.join(", ")} · expires {formatExpiry(preview.plan.expiresAt)}
                </p>
                <ul className="agent-plan-summary">
                  {preview.preview.summary.map((summary) => <li key={summary}>{summary}</li>)}
                </ul>
              </div>
              <ol>
                {preview.plan.commands.map((command, index) => (
                  <li key={`${commandName(command)}-${index}`}>{commandName(command)}</li>
                ))}
              </ol>
              <button
                type="button"
                className="tool-button primary confirm-plan"
                onClick={() => void confirmAndApply()}
                disabled={operation === "executing" || connection !== "connected"}
              >
                {operation === "executing" ? "Applying…" : "Confirm and apply once"}
              </button>
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

function commandName(command: unknown): string {
  if (command && typeof command === "object" && "type" in command && typeof command.type === "string") {
    if (
      command.type === "CreateTrack" &&
      "instrumentId" in command &&
      typeof command.instrumentId === "string"
    ) {
      return `${command.type} · ${command.instrumentId}`;
    }
    return command.type;
  }
  return "Unknown command";
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "soon" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
