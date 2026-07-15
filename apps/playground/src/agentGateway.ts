import {
  validateCommandSnapshot,
  type CommandBatchResult,
  type CommandSnapshot,
  type ExecuteCommandBatchRequest,
} from "@beat-twin/commands";

export const BROWSER_NANODAW_PROTOCOL = "beat-twin.nanodaw.v1";
const TOKEN_PROTOCOL_PREFIX = "beat-twin.pairing.";

export type BrowserCommandPort = {
  readonly inspect: () => CommandSnapshot;
  readonly executeCommandBatch: (
    request: ExecuteCommandBatchRequest,
  ) => CommandBatchResult;
};

export type AgentPlanPreview = {
  readonly runId: string;
  readonly dawId: "nanodaw";
  readonly model: string;
  readonly steps: number;
  readonly patch: unknown;
  readonly preview: {
    readonly summary: readonly string[];
    readonly commands: readonly unknown[];
  };
  readonly plan: {
    readonly planId: string;
    readonly adapterId: "nanodaw";
    readonly baseRevision: number;
    readonly requiredScopes: readonly string[];
    readonly expiresAt: string;
    readonly commands: readonly unknown[];
  };
};

export type AgentExecution = {
  readonly report: {
    readonly ok: boolean;
    readonly status: string;
    readonly planId: string;
    readonly finalSnapshot: CommandSnapshot;
  };
};

export type AgentGatewaySessionOptions = {
  readonly baseUrl: string;
  readonly operatorSecret: string;
  readonly port: BrowserCommandPort;
  readonly actorId?: string;
  readonly fetchImpl?: typeof fetch;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly onConnectionChange?: (connected: boolean) => void;
};

export type AgentGatewaySession = {
  readonly connect: () => Promise<void>;
  readonly run: (request: string) => Promise<AgentPlanPreview>;
  readonly confirmAndExecute: (planId: string) => Promise<AgentExecution>;
  readonly disconnect: () => void;
  readonly isConnected: () => boolean;
};

export function createAgentGatewaySession(
  options: AgentGatewaySessionOptions,
): AgentGatewaySession {
  const {
    actorId,
    baseUrl: baseUrlInput,
    fetchImpl: providedFetch,
    onConnectionChange,
    port,
    WebSocketImpl: ProvidedWebSocket,
  } = options;
  const baseUrl = validateBaseUrl(baseUrlInput);
  let operatorSecret: string | null = options.operatorSecret;
  if (!operatorSecret.trim()) {
    throw new Error("Operator secret is required.");
  }
  const fetchImpl = providedFetch ?? fetch;
  const WebSocketImpl = ProvidedWebSocket ?? WebSocket;
  let token: string | null = null;
  let socket: WebSocket | null = null;

  async function connect(): Promise<void> {
    disconnect();
    if (!operatorSecret) {
      throw new Error("Pairing credentials have already been consumed.");
    }
    const pairBody = await requestJson(fetchImpl, new URL("/v1/pair", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operatorSecret,
        ...(actorId?.trim() ? { actorId: actorId.trim() } : {}),
      }),
    });
    operatorSecret = null;
    if (!isPlainObject(pairBody) || !isNonBlankString(pairBody.token)) {
      throw new Error("Gateway pairing response is invalid.");
    }
    token = pairBody.token;

    const webSocketUrl = new URL("/v1/browser/nanodaw", baseUrl);
    webSocketUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    const nextSocket = new WebSocketImpl(webSocketUrl, [
      BROWSER_NANODAW_PROTOCOL,
      encodeBrowserPairingProtocol(token),
    ]);
    socket = nextSocket;
    bindBrowserPort(nextSocket, port);
    nextSocket.addEventListener("close", () => {
      if (socket !== nextSocket) return;
      socket = null;
      token = null;
      onConnectionChange?.(false);
    });
    try {
      await waitForSocketOpen(nextSocket);
    } catch (error) {
      disconnect();
      throw error;
    }
    onConnectionChange?.(true);
  }

  async function run(request: string): Promise<AgentPlanPreview> {
    const activeToken = requireConnectedToken();
    if (!request.trim()) throw new Error("Agent request is required.");
    const body = await requestJson(fetchImpl, new URL("/v1/agent/runs", baseUrl), {
      method: "POST",
      headers: authorizationHeaders(activeToken, true),
      body: JSON.stringify({ dawId: "nanodaw", request: request.trim() }),
    });
    return validatePlanPreview(body);
  }

  async function confirmAndExecute(planId: string): Promise<AgentExecution> {
    const activeToken = requireConnectedToken();
    if (!isNonBlankString(planId)) throw new Error("Plan id is required.");
    const confirmation = await requestJson(
      fetchImpl,
      new URL(`/v1/plans/${encodeURIComponent(planId)}/confirm`, baseUrl),
      { method: "POST", headers: authorizationHeaders(activeToken, false) },
    );
    if (!isPlainObject(confirmation) || !isNonBlankString(confirmation.confirmationToken)) {
      throw new Error("Gateway confirmation response is invalid.");
    }
    const execution = await requestJson(
      fetchImpl,
      new URL(`/v1/plans/${encodeURIComponent(planId)}/execute`, baseUrl),
      {
        method: "POST",
        headers: authorizationHeaders(activeToken, true),
        body: JSON.stringify({ confirmationToken: confirmation.confirmationToken }),
      },
    );
    return validateExecution(execution, planId);
  }

  function disconnect(): void {
    const current = socket;
    socket = null;
    token = null;
    if (current && current.readyState < WebSocketImpl.CLOSING) {
      current.close(1000, "agent mode disabled");
    }
    onConnectionChange?.(false);
  }

  function requireConnectedToken(): string {
    if (!token || !socket || socket.readyState !== WebSocketImpl.OPEN) {
      throw new Error("Agent mode is not connected.");
    }
    return token;
  }

  return Object.freeze({
    connect,
    run,
    confirmAndExecute,
    disconnect,
    isConnected: () => Boolean(token && socket?.readyState === WebSocketImpl.OPEN),
  });
}

export function encodeBrowserPairingProtocol(token: string): string {
  const bytes = new TextEncoder().encode(token);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${TOKEN_PROTOCOL_PREFIX}${btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")}`;
}

function bindBrowserPort(socket: WebSocket, port: BrowserCommandPort): void {
  socket.addEventListener("message", (event) => {
    void respondToGateway(socket, port, event.data);
  });
}

async function respondToGateway(
  socket: WebSocket,
  port: BrowserCommandPort,
  raw: unknown,
): Promise<void> {
  let id = "invalid";
  try {
    if (typeof raw !== "string") throw new Error("Binary frames are not accepted.");
    const message: unknown = JSON.parse(raw);
    if (!isPlainObject(message) || message.v !== 1 || !isNonBlankString(message.id)) {
      throw new Error("Gateway request envelope is invalid.");
    }
    id = message.id;
    if (message.method === "inspect" && isEmptyParams(message.params)) {
      send(socket, { v: 1, id, ok: true, result: port.inspect() });
      return;
    }
    if (
      message.method === "executeCommandBatch" &&
      isPlainObject(message.params) &&
      isPlainObject(message.params.request)
    ) {
      const result = await port.executeCommandBatch(
        message.params.request as unknown as ExecuteCommandBatchRequest,
      );
      send(socket, { v: 1, id, ok: true, result });
      return;
    }
    throw new Error("Gateway method is not supported.");
  } catch {
    send(socket, {
      v: 1,
      id,
      ok: false,
      error: { code: "browser_request_failed", message: "Browser rejected the gateway request." },
    });
  }
}

function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(value));
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Browser connection to the Gateway failed."));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Gateway closed the browser connection before pairing completed."));
    };
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: URL,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(url, init);
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = isPlainObject(body) && isPlainObject(body.error) && isNonBlankString(body.error.message)
      ? body.error.message
      : `Gateway request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

function validatePlanPreview(value: unknown): AgentPlanPreview {
  if (
    !isPlainObject(value) ||
    !isNonBlankString(value.runId) ||
    value.dawId !== "nanodaw" ||
    !isNonBlankString(value.model) ||
    !Number.isInteger(value.steps) ||
    !isPlainObject(value.preview) ||
    !isNonBlankStringArray(value.preview.summary) ||
    !Array.isArray(value.preview.commands) ||
    !isPlainObject(value.plan) ||
    !isNonBlankString(value.plan.planId) ||
    value.plan.adapterId !== "nanodaw" ||
    !Number.isInteger(value.plan.baseRevision) ||
    !isNonBlankStringArray(value.plan.requiredScopes) ||
    !isNonBlankString(value.plan.expiresAt) ||
    !Array.isArray(value.plan.commands)
  ) {
    throw new Error("Gateway plan preview is invalid.");
  }
  return value as unknown as AgentPlanPreview;
}

function validateExecution(value: unknown, planId: string): AgentExecution {
  if (
    !isPlainObject(value) ||
    !isPlainObject(value.report) ||
    typeof value.report.ok !== "boolean" ||
    !isNonBlankString(value.report.status) ||
    value.report.planId !== planId ||
    !validateCommandSnapshot(value.report.finalSnapshot)
  ) {
    throw new Error("Gateway execution response is invalid.");
  }
  return value as unknown as AgentExecution;
}

function authorizationHeaders(token: string, json: boolean): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

function validateBaseUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Gateway URL is invalid.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !["127.0.0.1", "::1", "localhost"].includes(hostname) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Gateway URL must be a loopback HTTP origin.");
  }
  return url;
}

function isEmptyParams(value: unknown): boolean {
  return isPlainObject(value) && Object.keys(value).length === 0;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonBlankStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonBlankString);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
