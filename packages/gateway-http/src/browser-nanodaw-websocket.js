import { randomUUID } from "node:crypto";

import { validateCommandSnapshot } from "@beat-twin/commands";
import { GatewayCoreError } from "@beat-twin/gateway-core";
import { WebSocket, WebSocketServer } from "ws";

export const BROWSER_NANODAW_PROTOCOL = "beat-twin.nanodaw.v1";
const TOKEN_PROTOCOL_PREFIX = "beat-twin.pairing.";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
const DEFAULT_MAX_PENDING_REQUESTS = 32;

export class BrowserNanoDawProxyError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BrowserNanoDawProxyError";
    this.code = code;
  }
}

export function encodeBrowserPairingProtocol(token) {
  if (!isNonBlankString(token)) {
    throw new BrowserNanoDawProxyError("invalid_token", "pairing token is required");
  }
  return `${TOKEN_PROTOCOL_PREFIX}${Buffer.from(token, "utf8").toString("base64url")}`;
}

/**
 * Creates a transport-only BrowserNanoDawPort. It stores no Song or snapshot;
 * every read and atomic mutation is an authenticated RPC to the current browser.
 */
export function createBrowserNanoDawWebSocketProxy(options) {
  const config = validateOptions(options);
  const pending = new Map();
  let active = null;
  let connecting = false;
  let attachedServer = null;

  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxPayloadBytes,
    handleProtocols(protocols) {
      return protocols.has(BROWSER_NANODAW_PROTOCOL)
        ? BROWSER_NANODAW_PROTOCOL
        : false;
    },
  });

  const port = Object.freeze({
    kind: "browser-proxy",
    inspect: () => callBrowser("inspect", {}),
    executeCommandBatch: (request) => callBrowser("executeCommandBatch", { request }),
  });

  function status() {
    if (!active || active.socket.readyState !== WebSocket.OPEN) {
      return Object.freeze({ state: "disconnected", connected: false });
    }
    return Object.freeze({
      state: "connected",
      connected: true,
      sessionId: active.sessionId,
      connectedAt: active.connectedAt,
      actorId: active.actorId,
      pendingRequests: pending.size,
    });
  }

  function attach(server) {
    if (!server || typeof server.on !== "function") {
      throw new BrowserNanoDawProxyError("configuration_error", "HTTP server is required");
    }
    if (attachedServer) {
      throw new BrowserNanoDawProxyError("configuration_error", "proxy is already attached");
    }
    attachedServer = server;
    server.on("upgrade", onUpgrade);
    return api;
  }

  async function onUpgrade(request, socket, head) {
    try {
      const url = requestUrl(request);
      if (url.pathname !== config.path || url.search) {
        rejectUpgrade(socket, 404, "Not Found");
        return;
      }
      enforceLoopbackHost(request.headers.host);
      enforceOrigin(request.headers.origin, config.allowedOrigins);
      const protocols = parseProtocols(request.headers["sec-websocket-protocol"]);
      if (!protocols.includes(BROWSER_NANODAW_PROTOCOL)) {
        rejectUpgrade(socket, 400, "Bad Request");
        return;
      }
      const token = decodePairingToken(protocols);
      const authorization = await config.pairing.authorize(token, "daw.inspect");
      if (active || connecting) {
        rejectUpgrade(socket, 409, "Conflict");
        return;
      }
      connecting = true;

      try {
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          const session = Object.freeze({
            socket: webSocket,
            sessionId: `browser-${config.idGenerator()}`,
            connectedAt: new Date(config.now()).toISOString(),
            actorId: authorization.actorId,
          });
          active = session;
          bindSocket(session);
          webSocketServer.emit("connection", webSocket, request);
        });
      } finally {
        connecting = false;
      }
    } catch (error) {
      const status = error instanceof GatewayCoreError && error.code === "forbidden"
        ? 403
        : 401;
      rejectUpgrade(socket, status, status === 403 ? "Forbidden" : "Unauthorized");
    }
  }

  function bindSocket(session) {
    session.socket.on("message", (data, isBinary) => {
      if (isBinary) {
        protocolFailure(session, "binary frames are not accepted");
        return;
      }
      let message;
      try {
        message = JSON.parse(data.toString("utf8"));
      } catch {
        protocolFailure(session, "response is not valid JSON");
        return;
      }
      receiveResponse(session, message);
    });
    session.socket.once("close", () => disconnect(session, "browser session disconnected"));
    session.socket.once("error", () => disconnect(session, "browser session transport failed"));
  }

  function receiveResponse(session, message) {
    if (session !== active || !isPlainObject(message)) {
      protocolFailure(session, "response envelope is invalid");
      return;
    }
    const keys = Object.keys(message).sort();
    const expectedKeys = message.ok === true
      ? ["id", "ok", "result", "v"]
      : ["error", "id", "ok", "v"];
    if (
      message.v !== 1 ||
      !isNonBlankString(message.id) ||
      typeof message.ok !== "boolean" ||
      JSON.stringify(keys) !== JSON.stringify(expectedKeys)
    ) {
      protocolFailure(session, "response envelope is invalid");
      return;
    }
    const request = pending.get(message.id);
    if (!request) {
      protocolFailure(session, "response id is unknown");
      return;
    }
    pending.delete(message.id);
    clearTimeout(request.timer);

    if (!message.ok) {
      const remoteMessage = isPlainObject(message.error) && isNonBlankString(message.error.message)
        ? message.error.message
        : "browser rejected the request";
      request.reject(new BrowserNanoDawProxyError("remote_error", remoteMessage));
      return;
    }

    try {
      request.resolve(validateResult(request.method, request.params, message.result));
    } catch (error) {
      request.reject(error);
      protocolFailure(session, "browser returned an invalid result");
    }
  }

  function callBrowser(method, params) {
    const session = active;
    if (!session || session.socket.readyState !== WebSocket.OPEN) {
      throw new BrowserNanoDawProxyError("not_connected", "browser NanoDAW is not connected");
    }
    if (pending.size >= config.maxPendingRequests) {
      throw new BrowserNanoDawProxyError("busy", "browser request limit reached");
    }

    const id = `rpc-${config.idGenerator()}`;
    const frame = JSON.stringify({ v: 1, id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new BrowserNanoDawProxyError(
          method === "executeCommandBatch" ? "outcome_unknown" : "timeout",
          method === "executeCommandBatch"
            ? "browser response timed out after execution dispatch; mutation state is unknown"
            : "browser inspection timed out",
        ));
      }, config.requestTimeoutMs);
      pending.set(id, { method, params, resolve, reject, timer });
      session.socket.send(frame, (error) => {
        if (!error) return;
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        clearTimeout(request.timer);
        reject(new BrowserNanoDawProxyError(
          method === "executeCommandBatch" ? "outcome_unknown" : "transport_error",
          method === "executeCommandBatch"
            ? "browser transport failed after execution dispatch; mutation state is unknown"
            : "browser transport failed before inspection completed",
          { cause: error },
        ));
      });
    });
  }

  function disconnect(session, message) {
    if (session !== active) return;
    active = null;
    for (const [id, request] of pending) {
      pending.delete(id);
      clearTimeout(request.timer);
      request.reject(new BrowserNanoDawProxyError(
        request.method === "executeCommandBatch" ? "outcome_unknown" : "not_connected",
        request.method === "executeCommandBatch"
          ? `${message} after execution dispatch; mutation state is unknown`
          : message,
      ));
    }
  }

  function protocolFailure(session, message) {
    disconnect(session, `browser protocol failed: ${message}`);
    if (session.socket.readyState === WebSocket.OPEN) {
      session.socket.close(1002, "protocol error");
    }
  }

  async function close() {
    if (attachedServer) {
      attachedServer.off("upgrade", onUpgrade);
      attachedServer = null;
    }
    const session = active;
    if (session) {
      disconnect(session, "browser proxy closed");
      session.socket.close(1001, "gateway shutdown");
    }
    await new Promise((resolve) => webSocketServer.close(() => resolve()));
  }

  const api = Object.freeze({ port, status, attach, close });
  return api;
}

function validateResult(method, params, result) {
  if (method === "inspect") {
    if (!validateCommandSnapshot(result)) {
      throw new BrowserNanoDawProxyError("invalid_response", "browser returned an invalid snapshot");
    }
    return deepFreeze(result);
  }
  if (!isPlainObject(result) || result.requestId !== params.request.requestId) {
    throw new BrowserNanoDawProxyError("invalid_response", "browser returned an invalid batch result");
  }
  if (!validateCommandSnapshot(result.snapshot)) {
    throw new BrowserNanoDawProxyError("invalid_response", "browser batch snapshot is invalid");
  }
  return deepFreeze(result);
}

function validateOptions(options) {
  if (!isPlainObject(options) || typeof options.pairing?.authorize !== "function") {
    throw new BrowserNanoDawProxyError("configuration_error", "pairing authority is required");
  }
  if (!Array.isArray(options.allowedOrigins) || options.allowedOrigins.length === 0) {
    throw new BrowserNanoDawProxyError("configuration_error", "allowedOrigins is required");
  }
  const allowedOrigins = options.allowedOrigins.map((origin) => {
    if (!isNonBlankString(origin)) {
      throw new BrowserNanoDawProxyError("configuration_error", "allowedOrigins must contain strings");
    }
    return origin.trim();
  });
  if (new Set(allowedOrigins).size !== allowedOrigins.length) {
    throw new BrowserNanoDawProxyError("configuration_error", "allowedOrigins must be unique");
  }
  if (options.idGenerator !== undefined && typeof options.idGenerator !== "function") {
    throw new BrowserNanoDawProxyError("configuration_error", "idGenerator must be a function");
  }
  if (options.now !== undefined && typeof options.now !== "function") {
    throw new BrowserNanoDawProxyError("configuration_error", "now must be a function");
  }
  return Object.freeze({
    pairing: options.pairing,
    allowedOrigins: Object.freeze(allowedOrigins),
    path: options.path ?? "/v1/browser/nanodaw",
    requestTimeoutMs: integerOption(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    maxPayloadBytes: integerOption(options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES),
    maxPendingRequests: integerOption(options.maxPendingRequests, DEFAULT_MAX_PENDING_REQUESTS),
    idGenerator: options.idGenerator ?? randomUUID,
    now: options.now ?? Date.now,
  });
}

function integerOption(value, fallback) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1) {
    throw new BrowserNanoDawProxyError("configuration_error", "numeric options must be positive integers");
  }
  return result;
}

function parseProtocols(value) {
  if (!isNonBlankString(value)) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function decodePairingToken(protocols) {
  const encoded = protocols.find((protocol) => protocol.startsWith(TOKEN_PROTOCOL_PREFIX));
  if (!encoded) {
    throw new BrowserNanoDawProxyError("invalid_token", "pairing protocol is missing");
  }
  const value = encoded.slice(TOKEN_PROTOCOL_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new BrowserNanoDawProxyError("invalid_token", "pairing protocol is invalid");
  }
  const token = Buffer.from(value, "base64url").toString("utf8");
  if (!isNonBlankString(token)) {
    throw new BrowserNanoDawProxyError("invalid_token", "pairing token is invalid");
  }
  return token;
}

function requestUrl(request) {
  if (!isNonBlankString(request.url)) {
    throw new BrowserNanoDawProxyError("invalid_request", "upgrade URL is missing");
  }
  return new URL(request.url, "http://gateway.invalid");
}

function enforceLoopbackHost(host) {
  if (!isNonBlankString(host)) throw new BrowserNanoDawProxyError("invalid_host", "Host is required");
  const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname !== "127.0.0.1" && hostname !== "::1" && hostname !== "localhost") {
    throw new BrowserNanoDawProxyError("invalid_host", "non-loopback Host is forbidden");
  }
}

function enforceOrigin(origin, allowedOrigins) {
  if (!isNonBlankString(origin) || !allowedOrigins.includes(origin)) {
    throw new BrowserNanoDawProxyError("invalid_origin", "WebSocket Origin is not allowed");
  }
}

function rejectUpgrade(socket, status, reason) {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
