import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import {
  compileSongPatchV1,
  previewSongPatchV1,
} from "@beat-twin/agent-contract";
import {
  validateDawCapabilities,
  validateDawHealth,
  validateDawSnapshot,
} from "@beat-twin/daw-contract";
import {
  deriveRequiredCommandScopes,
  GatewayCoreError,
  MAX_PAIRING_TTL_MS,
} from "@beat-twin/gateway-core";
import { LiteRtProviderError } from "@beat-twin/litert-provider";

export const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
export const DEFAULT_PAIRING_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_PAIRING_MAX_REQUESTS = 1_000;
export const DEFAULT_ADAPTER_EXECUTION_TIMEOUT_MS = 30_000;
export const DEFAULT_PAIRING_SCOPES = Object.freeze([
  "gateway.read",
  "daw.list",
  "daw.inspect",
  "agent.run",
  "plan.create",
  "plan.confirm",
  "plan.execute",
  "song.write",
]);

const JSON_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
});

export class GatewayHttpError extends Error {
  constructor(code, message, status = 400, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GatewayHttpError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Creates a dependency-injected HTTP handler. The returned handler never owns
 * DAW state: every inspection and execution goes through the injected adapters.
 */
export function createGatewayRequestHandler(options) {
  const config = validateOptions(options);

  return async function gatewayRequestHandler(request, response) {
    const cors = corsHeaders(request, config);
    try {
      enforceRequestHost(request);
      enforceOrigin(request, config);

      if (request.method === "OPTIONS") {
        handlePreflight(request, response, cors);
        return;
      }

      const url = parseRequestUrl(request);
      if (url.search.length > 0) {
        throw new GatewayHttpError("invalid_request", "query parameters are not accepted");
      }

      if (request.method === "POST" && url.pathname === "/v1/pair") {
        const body = await readJsonObject(request, config.bodyLimitBytes);
        assertExactKeys(body, ["operatorSecret"], ["actorId"]);
        if (!isNonBlankString(body.operatorSecret)) {
          throw new GatewayHttpError("invalid_request", "operatorSecret must be a non-empty string");
        }
        if (!secretsEqual(body.operatorSecret, config.operatorSecret)) {
          throw new GatewayHttpError("unauthenticated", "operator secret is invalid", 401);
        }
        if (body.actorId !== undefined && !isNonBlankString(body.actorId)) {
          throw new GatewayHttpError("invalid_request", "actorId must be a non-empty string");
        }
        const grant = await config.pairing.issue({
          actorId: body.actorId?.trim() ?? "gateway-operator",
          scopes: config.pairingScopes,
          ttlMs: config.pairingTtlMs,
          maxRequests: config.pairingMaxRequests,
        });
        sendJson(response, 201, grant, cors);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/health") {
        const token = bearerToken(request);
        await config.pairing.authorize(token, "gateway.read");
        const [modelHealth, dawHealth] = await Promise.all([
          inspectModelHealth(config.provider),
          Promise.all([...config.adapters.values()].map((adapter) => safeAdapterHealth(adapter))),
        ]);
        const status = modelHealth.ok && dawHealth.every((entry) => entry.status !== "unavailable")
          ? "healthy"
          : "degraded";
        sendJson(response, 200, { status, model: modelHealth, daws: dawHealth }, cors);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/daws") {
        const token = bearerToken(request);
        await config.pairing.authorize(token, "daw.list");
        const daws = await Promise.all([...config.adapters.values()].map(async (adapter) => {
          const health = await adapter.health();
          const capabilities = await adapter.capabilities();
          requireValidAdapterValue(validateDawHealth(health, adapter.id), adapter.id, "health");
          requireValidAdapterValue(
            validateDawCapabilities(capabilities, adapter.id),
            adapter.id,
            "capabilities",
          );
          return { id: adapter.id, health, capabilities };
        }));
        sendJson(response, 200, { daws }, cors);
        return;
      }

      const sessionMatch = /^\/v1\/sessions\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && sessionMatch) {
        const token = bearerToken(request);
        await config.pairing.authorize(token, "daw.inspect");
        const adapter = requireAdapter(config.adapters, decodePathSegment(sessionMatch[1]));
        const [capabilities, session] = await Promise.all([
          adapter.capabilities(),
          adapter.inspect(),
        ]);
        requireValidAdapterValue(
          validateDawCapabilities(capabilities, adapter.id),
          adapter.id,
          "capabilities",
        );
        requireValidAdapterValue(
          validateDawSnapshot(session, adapter.id, capabilities.capabilityVersion),
          adapter.id,
          "snapshot",
        );
        sendJson(response, 200, { session }, cors);
        return;
      }

      const statusMatch = /^\/v1\/plans\/([^/]+)\/status$/.exec(url.pathname);
      if (request.method === "GET" && statusMatch) {
        const token = bearerToken(request);
        await config.pairing.authorize(token, "plan.execute");
        const planId = decodePathSegment(statusMatch[1]);
        const status = config.planStore.getExecutionStatus(planId);
        if (!status) {
          throw new GatewayHttpError("route_not_found", "plan status not found", 404);
        }
        sendJson(response, 200, { execution: status }, cors);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/agent/runs") {
        const token = bearerToken(request);
        await config.pairing.authorize(token, "agent.run");
        const body = await readJsonObject(request, config.bodyLimitBytes);
        assertExactKeys(body, ["dawId", "request"]);
        if (!isNonBlankString(body.dawId) || !isNonBlankString(body.request)) {
          throw new GatewayHttpError("invalid_request", "dawId and request must be non-empty strings");
        }
        if (body.request.length > config.maxAgentRequestCharacters) {
          throw new GatewayHttpError("invalid_request", "agent request is too long", 413);
        }

        const adapter = requireAdapter(config.adapters, body.dawId);
        const [health, capabilities, snapshot] = await Promise.all([
          adapter.health(),
          adapter.capabilities(),
          adapter.inspect(),
        ]);
        validateAdapterInspection(adapter, health, capabilities, snapshot);

        const requestId = `request-${config.idGenerator()}`;
        const planId = `plan-${config.idGenerator()}`;
        const run = await config.provider.runAgent({
          request: body.request,
          handlers: {
            list_daw_targets: () =>
              [...config.adapters.values()].map((candidate) => ({ id: candidate.id })),
            inspect_session: ({ dawId }) => {
              if (dawId !== adapter.id) {
                throw new GatewayHttpError(
                  "target_mismatch",
                  `agent run is fixed to ${adapter.id}`,
                  422,
                );
              }
              return snapshot;
            },
            propose_song_patch: () => ({ previewOnly: true, dawId: adapter.id }),
          },
        });

        const compileOptions = { idSeed: requestId, snapshot: snapshot.commandSnapshot };
        const commands = compileSongPatchV1(run.patch, compileOptions);
        const preview = previewSongPatchV1(run.patch, compileOptions);
        const requiredScopes = deriveRequiredCommandScopes(commands);
        validatePlanCapabilities(capabilities, commands, requiredScopes);
        const plan = await config.planStore.createPlan({
          token,
          plan: {
            planId,
            requestId,
            adapterId: adapter.id,
            capabilityVersion: capabilities.capabilityVersion,
            baseRevision: snapshot.commandSnapshot.revision,
            commands,
            requiredScopes,
          },
        });

        sendJson(response, 201, {
          runId: requestId,
          dawId: adapter.id,
          model: run.model,
          steps: run.steps,
          patch: run.patch,
          preview,
          plan,
        }, cors);
        return;
      }

      const confirmMatch = /^\/v1\/plans\/([^/]+)\/confirm$/.exec(url.pathname);
      if (request.method === "POST" && confirmMatch) {
        const token = bearerToken(request);
        await requireEmptyBody(request, config.bodyLimitBytes);
        const planId = decodePathSegment(confirmMatch[1]);
        const confirmation = await config.planStore.confirm({ token, planId });
        sendJson(response, 200, { planId, ...confirmation }, cors);
        return;
      }

      const executeMatch = /^\/v1\/plans\/([^/]+)\/execute$/.exec(url.pathname);
      if (request.method === "POST" && executeMatch) {
        const token = bearerToken(request);
        const body = await readJsonObject(request, config.bodyLimitBytes);
        assertExactKeys(body, ["confirmationToken"]);
        if (!isNonBlankString(body.confirmationToken)) {
          throw new GatewayHttpError(
            "invalid_request",
            "confirmationToken must be a non-empty string",
          );
        }
        const planId = decodePathSegment(executeMatch[1]);
        const plan = await config.planStore.consumeExecution({
          token,
          planId,
          confirmationToken: body.confirmationToken,
        });
        const adapter = requireAdapter(config.adapters, plan.adapterId);
        let report;
        try {
          // Deliberately exactly once. A consumed confirmation is never retried.
          report = await withTimeout(
            adapter.execute(plan),
            config.adapterExecutionTimeoutMs,
            "adapter execution timed out",
          );
        } catch (error) {
          await preserveExecutionUncertainty(
            config.planStore,
            planId,
            "adapter outcome is unknown after execution dispatch",
          );
          throw new GatewayHttpError(
            "partial_execution",
            "adapter outcome is unknown after execution dispatch; do not retry",
            502,
            { cause: error },
          );
        }
        let recorded;
        try {
          recorded = await config.planStore.recordExecution({ planId, report });
        } catch (error) {
          await preserveExecutionUncertainty(
            config.planStore,
            planId,
            "DAW execution completed but its report could not be verified or recorded",
          );
          throw new GatewayHttpError(
            "partial_execution",
            "DAW execution completed but its report could not be verified or recorded; do not retry",
            502,
            { cause: error },
          );
        }
        sendJson(response, 200, { report: recorded }, cors);
        return;
      }

      throw new GatewayHttpError("route_not_found", "route not found", 404);
    } catch (error) {
      sendError(response, error, cors);
    }
  };
}

export function createGatewayHttpServer(options) {
  return createServer(createGatewayRequestHandler(options));
}

export async function listenGatewayHttp(options, listen = {}) {
  const host = listen.host ?? "127.0.0.1";
  assertAllowedListenHost(host);
  const port = listen.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new GatewayHttpError("configuration_error", "port must be an integer from 0 to 65535", 500);
  }
  const server = createGatewayHttpServer(options);
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port });
  });
  return server;
}

export function assertAllowedListenHost(host) {
  if (!isNonBlankString(host)) {
    throw new GatewayHttpError("configuration_error", "listen host must be a non-empty string", 500);
  }
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized !== "127.0.0.1" && normalized !== "::1") {
    throw new GatewayHttpError(
      "non_loopback_forbidden",
      `refusing non-loopback listen host ${host}`,
      500,
    );
  }
}

function validateOptions(options) {
  if (!isPlainObject(options)) {
    throw new GatewayHttpError("configuration_error", "gateway options are required", 500);
  }
  if (!isNonBlankString(options.operatorSecret)) {
    throw new GatewayHttpError("configuration_error", "operatorSecret must be configured", 500);
  }
  if (options.operatorSecret.length < 16) {
    throw new GatewayHttpError(
      "configuration_error",
      "operatorSecret must contain at least 16 characters",
      500,
    );
  }
  if (!options.provider || typeof options.provider.runAgent !== "function" || typeof options.provider.listModels !== "function") {
    throw new GatewayHttpError("configuration_error", "provider must implement LiteRtProvider", 500);
  }
  if (!options.pairing || typeof options.pairing.issue !== "function" || typeof options.pairing.authorize !== "function") {
    throw new GatewayHttpError("configuration_error", "pairing must implement PairingAuthority", 500);
  }
  if (
    !options.planStore ||
    [
      "createPlan",
      "confirm",
      "consumeExecution",
      "recordExecution",
      "recordExecutionUncertainty",
      "getExecutionStatus",
    ].some(
      (method) => typeof options.planStore[method] !== "function",
    )
  ) {
    throw new GatewayHttpError("configuration_error", "planStore must implement GatewayPlanStore", 500);
  }
  if (!(options.adapters instanceof Map) || options.adapters.size === 0) {
    throw new GatewayHttpError("configuration_error", "adapters must be a non-empty Map", 500);
  }

  const adapters = new Map();
  for (const [id, adapter] of options.adapters) {
    if ((id !== "nanodaw" && id !== "bitwig") || adapter?.id !== id) {
      throw new GatewayHttpError("configuration_error", "adapter map keys must match adapter ids", 500);
    }
    for (const method of ["health", "capabilities", "inspect", "execute"]) {
      if (typeof adapter[method] !== "function") {
        throw new GatewayHttpError("configuration_error", `adapter ${id} lacks ${method}()`, 500);
      }
    }
    adapters.set(id, adapter);
  }

  const bodyLimitBytes = integerRange(
    options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
    1,
    1024 * 1024,
    "bodyLimitBytes",
  );
  const pairingTtlMs = integerRange(
    options.pairingTtlMs ?? DEFAULT_PAIRING_TTL_MS,
    1,
    MAX_PAIRING_TTL_MS,
    "pairingTtlMs",
  );
  const pairingMaxRequests = integerRange(
    options.pairingMaxRequests ?? DEFAULT_PAIRING_MAX_REQUESTS,
    1,
    1_000_000,
    "pairingMaxRequests",
  );
  const maxAgentRequestCharacters = integerRange(
    options.maxAgentRequestCharacters ?? 4_000,
    1,
    100_000,
    "maxAgentRequestCharacters",
  );
  const adapterExecutionTimeoutMs = integerRange(
    options.adapterExecutionTimeoutMs ?? DEFAULT_ADAPTER_EXECUTION_TIMEOUT_MS,
    1,
    120_000,
    "adapterExecutionTimeoutMs",
  );
  const pairingScopes = uniqueNonBlankStrings(options.pairingScopes ?? DEFAULT_PAIRING_SCOPES, "pairingScopes");
  const corsOrigins = uniqueNonBlankStrings(options.corsOrigins ?? [], "corsOrigins");
  if (typeof options.idGenerator !== "undefined" && typeof options.idGenerator !== "function") {
    throw new GatewayHttpError("configuration_error", "idGenerator must be a function", 500);
  }

  return Object.freeze({
    operatorSecret: options.operatorSecret,
    provider: options.provider,
    pairing: options.pairing,
    planStore: options.planStore,
    adapters,
    bodyLimitBytes,
    pairingTtlMs,
    pairingMaxRequests,
    pairingScopes,
    maxAgentRequestCharacters,
    adapterExecutionTimeoutMs,
    corsOrigins,
    idGenerator: options.idGenerator ?? randomUUID,
  });
}

function validateAdapterInspection(adapter, health, capabilities, snapshot) {
  requireValidAdapterValue(validateDawHealth(health, adapter.id), adapter.id, "health");
  requireValidAdapterValue(
    validateDawCapabilities(capabilities, adapter.id),
    adapter.id,
    "capabilities",
  );
  requireValidAdapterValue(
    validateDawSnapshot(snapshot, adapter.id, capabilities.capabilityVersion),
    adapter.id,
    "snapshot",
  );
  if (health.status === "unavailable") {
    throw new GatewayHttpError("adapter_unavailable", `adapter ${adapter.id} is unavailable`, 503);
  }
}

function requireValidAdapterValue(validation, adapterId, label) {
  if (!validation.ok) {
    throw new GatewayHttpError(
      "invalid_adapter_response",
      `adapter ${adapterId} returned invalid ${label}: ${validation.error.message}`,
      502,
    );
  }
}

function validatePlanCapabilities(capabilities, commands, requiredScopes) {
  const supported = new Set(capabilities.supportedCommands);
  const unsupported = commands.find((command) => !supported.has(command.type));
  if (unsupported) {
    throw new GatewayHttpError(
      "unsupported_capability",
      `adapter does not support ${unsupported.type}`,
      422,
    );
  }
  const scopes = new Set(capabilities.scopes);
  const unavailableScope = requiredScopes.find((scope) => !scopes.has(scope));
  if (unavailableScope) {
    throw new GatewayHttpError(
      "unsupported_capability",
      `adapter does not expose scope ${unavailableScope}`,
      422,
    );
  }
}

async function preserveExecutionUncertainty(planStore, planId, message) {
  try {
    await planStore.recordExecutionUncertainty({ planId, message });
  } catch {
    // recordExecutionUncertainty stores terminal uncertainty before auditing it.
    // Never obscure the post-mutation response or retry DAW execution.
  }
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function inspectModelHealth(provider) {
  try {
    const models = await provider.listModels();
    return { ok: true, modelCount: models.length };
  } catch {
    return { ok: false };
  }
}

async function safeAdapterHealth(adapter) {
  try {
    const health = await adapter.health();
    requireValidAdapterValue(validateDawHealth(health, adapter.id), adapter.id, "health");
    return health;
  } catch {
    return { adapterId: adapter.id, status: "unavailable" };
  }
}

function requireAdapter(adapters, dawId) {
  if (dawId !== "nanodaw" && dawId !== "bitwig") {
    throw new GatewayHttpError("invalid_daw", "dawId must be nanodaw or bitwig", 404);
  }
  const adapter = adapters.get(dawId);
  if (!adapter) {
    throw new GatewayHttpError("adapter_unavailable", `adapter ${dawId} is not configured`, 503);
  }
  return adapter;
}

function bearerToken(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") {
    throw new GatewayHttpError("unauthenticated", "Bearer token is required", 401);
  }
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match) {
    throw new GatewayHttpError("unauthenticated", "Authorization must use Bearer", 401);
  }
  return match[1];
}

async function readJsonObject(request, limit) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new GatewayHttpError("unsupported_media_type", "Content-Type must be application/json", 415);
  }
  const bytes = await readBody(request, limit);
  if (bytes.length === 0) {
    throw new GatewayHttpError("invalid_json", "JSON body is required");
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new GatewayHttpError("invalid_json", "request body is not valid JSON");
  }
  if (!isPlainObject(value)) {
    throw new GatewayHttpError("invalid_json", "JSON body must be an object");
  }
  return value;
}

async function requireEmptyBody(request, limit) {
  const bytes = await readBody(request, limit);
  if (bytes.length !== 0) {
    throw new GatewayHttpError("invalid_request", "confirmation request body must be empty");
  }
}

async function readBody(request, limit) {
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new GatewayHttpError("invalid_request", "Content-Length is invalid");
    }
    if (Number(declaredLength) > limit) {
      throw new GatewayHttpError("payload_too_large", "request body exceeds limit", 413);
    }
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) {
        throw new GatewayHttpError("payload_too_large", "request body exceeds limit", 413);
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof GatewayHttpError) throw error;
    throw new GatewayHttpError("invalid_request", "request body could not be read", 400, { cause: error });
  }
  return Buffer.concat(chunks, size);
}

function assertExactKeys(value, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new GatewayHttpError("invalid_request", `unknown field ${unknown}`);
  }
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing) {
    throw new GatewayHttpError("invalid_request", `missing field ${missing}`);
  }
}

function parseRequestUrl(request) {
  if (typeof request.url !== "string") {
    throw new GatewayHttpError("invalid_request", "request URL is missing");
  }
  try {
    return new URL(request.url, "http://gateway.invalid");
  } catch {
    throw new GatewayHttpError("invalid_request", "request URL is invalid");
  }
}

function decodePathSegment(value) {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes("/") || decoded.includes("\\") || decoded.length === 0) throw new Error();
    return decoded;
  } catch {
    throw new GatewayHttpError("invalid_request", "path parameter is invalid");
  }
}

function enforceRequestHost(request) {
  const host = request.headers.host;
  if (!isNonBlankString(host)) {
    throw new GatewayHttpError("invalid_host", "Host header is required", 400);
  }
  let hostname;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    throw new GatewayHttpError("invalid_host", "Host header is invalid", 400);
  }
  if (!isLoopbackHostname(hostname)) {
    throw new GatewayHttpError("non_loopback_forbidden", "non-loopback Host is forbidden", 403);
  }
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || normalized === "127.0.0.1";
}

function enforceOrigin(request, config) {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (typeof origin !== "string" || !config.corsOrigins.includes(origin)) {
    throw new GatewayHttpError("cors_forbidden", "request Origin is not allowed", 403);
  }
}

function corsHeaders(request, config) {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !config.corsOrigins.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "false",
    vary: "Origin",
  };
}

function handlePreflight(request, response, cors) {
  const requestedMethod = request.headers["access-control-request-method"];
  if (!requestedMethod || !["GET", "POST"].includes(requestedMethod)) {
    throw new GatewayHttpError("cors_forbidden", "CORS method is not allowed", 403);
  }
  response.writeHead(204, {
    ...JSON_HEADERS,
    ...cors,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
  });
  response.end();
}

function sendJson(response, status, value, extraHeaders = {}) {
  if (response.headersSent || response.destroyed) return;
  const body = JSON.stringify(value);
  response.writeHead(status, { ...JSON_HEADERS, ...extraHeaders });
  response.end(body);
}

function sendError(response, error, extraHeaders) {
  const normalized = normalizeError(error);
  sendJson(response, normalized.status, {
    error: { code: normalized.code, message: normalized.message },
  }, extraHeaders);
}

function normalizeError(error) {
  if (error instanceof GatewayHttpError) return error;
  if (error instanceof GatewayCoreError) {
    const statuses = {
      invalid_request: 400,
      unauthenticated: 401,
      forbidden: 403,
      quota_exceeded: 429,
      policy_blocked: 403,
      conflict: 409,
      plan_expired: 410,
      confirmation_expired: 410,
      confirmation_used: 409,
    };
    return new GatewayHttpError(error.code, error.message, statuses[error.code] ?? 400);
  }
  if (error instanceof LiteRtProviderError) {
    const status = error.code === "timeout"
      ? 504
      : error.code === "configuration_error"
        ? 500
        : error.code === "http_error"
          ? 502
          : 422;
    return new GatewayHttpError(error.code, error.message, status);
  }
  return new GatewayHttpError("internal_error", "internal gateway error", 500);
}

function secretsEqual(left, right) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function integerRange(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new GatewayHttpError(
      "configuration_error",
      `${name} must be an integer from ${minimum} to ${maximum}`,
      500,
    );
  }
  return value;
}

function uniqueNonBlankStrings(value, name) {
  if (!Array.isArray(value) || value.some((item) => !isNonBlankString(item))) {
    throw new GatewayHttpError("configuration_error", `${name} must contain non-empty strings`, 500);
  }
  const normalized = value.map((item) => item.trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new GatewayHttpError("configuration_error", `${name} must not contain duplicates`, 500);
  }
  return Object.freeze(normalized);
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
