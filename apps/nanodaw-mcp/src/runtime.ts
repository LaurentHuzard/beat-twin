import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  createBrowserNanoDawWebSocketProxy,
  createGatewayRequestHandler,
  type GatewayHandler,
} from "@beat-twin/gateway-http";
import {
  GatewayCoreError,
  GatewayPlanStore,
  PairingAuthority,
  type AuditSink,
} from "@beat-twin/gateway-core";
import { NanoDawAdapter } from "@beat-twin/nanodaw-adapter";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  createNanoDawMcpServer,
  createNanoDawMcpService,
  type NanoDawMcpReview,
  type NanoDawMcpService,
} from "@beat-twin/nanodaw-mcp";

export type NanoDawMcpRuntimeOptions = {
  readonly operatorSecret: string;
  readonly allowedOrigins: readonly string[];
  readonly host?: "127.0.0.1" | "::1";
  readonly port?: number;
  readonly audit?: AuditSink;
};

export type NanoDawMcpRuntime = {
  readonly baseUrl: string;
  readonly service: NanoDawMcpService;
  readonly startStdio: () => Promise<void>;
  readonly close: () => Promise<void>;
};

export async function createNanoDawMcpRuntime(
  options: NanoDawMcpRuntimeOptions,
): Promise<NanoDawMcpRuntime> {
  const audit = options.audit ?? (() => undefined);
  const pairing = new PairingAuthority({ audit });
  const planStore = new GatewayPlanStore({
    pairing,
    audit,
    policy: (plan) =>
      plan.adapterId === "nanodaw" &&
      plan.requiredScopes.every((scope) => scope === "song.write" || scope === "transport.write"),
  });
  const browserProxy = createBrowserNanoDawWebSocketProxy({
    pairing,
    allowedOrigins: options.allowedOrigins,
  });
  const adapter = new NanoDawAdapter({
    port: browserProxy.port,
    verifyDigest: (candidate) => {
      const stored = planStore.getPlan(candidate.planId);
      return stored?.digest === candidate.digest && stored.requestId === candidate.requestId;
    },
  });
  const service = await createNanoDawMcpService({ adapter, pairing, planStore });
  const fallback = createGatewayRequestHandler({
    operatorSecret: options.operatorSecret,
    pairing,
    planStore,
    provider: {
      listModels: async () => [],
      runAgent: async () => {
        throw new Error("This runtime exposes structured NanoDAW MCP planning only");
      },
    },
    adapters: new Map([["nanodaw", adapter]]),
    corsOrigins: options.allowedOrigins,
  });
  const handler = createNanoDawMcpReviewHandler({
    allowedOrigins: options.allowedOrigins,
    fallback,
    pairing,
    service,
  });
  const httpServer = createServer((request, response) => {
    void handler(request, response);
  });
  browserProxy.attach(httpServer);

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  await listen(httpServer, host, port);
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("NanoDAW MCP gateway did not expose a TCP address");
  }
  const hostname = host === "::1" ? "[::1]" : host;
  const baseUrl = `http://${hostname}:${address.port}`;
  const mcpServer = createNanoDawMcpServer(service);
  let stdioStarted = false;
  let closed = false;

  return Object.freeze({
    baseUrl,
    service,
    startStdio: async () => {
      if (closed) throw new Error("NanoDAW MCP runtime is closed");
      if (stdioStarted) throw new Error("NanoDAW MCP stdio transport is already connected");
      stdioStarted = true;
      await mcpServer.connect(new StdioServerTransport());
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled([
        mcpServer.close(),
        browserProxy.close(),
        closeServer(httpServer),
      ]);
    },
  });
}

export function createNanoDawMcpReviewHandler(options: {
  readonly allowedOrigins: readonly string[];
  readonly fallback: GatewayHandler;
  readonly pairing: PairingAuthority;
  readonly service: NanoDawMcpService;
}): GatewayHandler {
  const origins = new Set(options.allowedOrigins);

  return async (request, response) => {
    const url = requestUrl(request);
    const match = /^\/v1\/mcp\/plans\/([^/]+)$/.exec(url.pathname);
    if (request.method !== "GET" || !match) {
      await options.fallback(request, response);
      return;
    }

    try {
      enforceLoopbackHost(request);
      if (url.search) throw new ReviewHttpError(400, "invalid_request", "query parameters are not accepted");
      const origin = request.headers.origin;
      if (origin !== undefined && (typeof origin !== "string" || !origins.has(origin))) {
        throw new ReviewHttpError(403, "cors_forbidden", "request Origin is not allowed");
      }
      await options.pairing.authorize(bearerToken(request), "plan.confirm");
      const planId = decodePathSegment(match[1]!);
      const review = options.service.getReview(planId);
      if (!review) throw new ReviewHttpError(404, "route_not_found", "MCP plan not found");
      if (Date.parse(review.plan.expiresAt) <= Date.now()) {
        throw new ReviewHttpError(410, "plan_expired", "MCP plan expired");
      }
      sendJson(response, 200, toBrowserPreview(review), corsHeaders(origin, origins));
    } catch (error) {
      const normalized = normalizeReviewError(error);
      sendJson(
        response,
        normalized.status,
        { error: { code: normalized.code, message: normalized.message } },
        corsHeaders(request.headers.origin, origins),
      );
    }
  };
}

function toBrowserPreview(review: NanoDawMcpReview) {
  return {
    runId: review.plan.requestId,
    dawId: "nanodaw",
    model: "structured-mcp",
    steps: 0,
    patch: review.patch,
    preview: review.preview,
    plan: review.plan,
  };
}

class ReviewHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReviewHttpError";
    this.status = status;
    this.code = code;
  }
}

function normalizeReviewError(error: unknown): ReviewHttpError {
  if (error instanceof ReviewHttpError) return error;
  if (error instanceof GatewayCoreError) {
    if (error.code === "unauthenticated") return new ReviewHttpError(401, error.code, error.message);
    if (error.code === "forbidden") return new ReviewHttpError(403, error.code, error.message);
    if (error.code === "quota_exceeded") return new ReviewHttpError(429, error.code, error.message);
    return new ReviewHttpError(400, error.code, error.message);
  }
  return new ReviewHttpError(500, "internal_error", "internal NanoDAW MCP error");
}

function requestUrl(request: IncomingMessage): URL {
  if (typeof request.url !== "string") {
    throw new ReviewHttpError(400, "invalid_request", "request URL is missing");
  }
  return new URL(request.url, "http://nanodaw.invalid");
}

function enforceLoopbackHost(request: IncomingMessage): void {
  const host = request.headers.host;
  if (typeof host !== "string") throw new ReviewHttpError(400, "invalid_host", "Host is required");
  const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname !== "127.0.0.1" && hostname !== "::1" && hostname !== "localhost") {
    throw new ReviewHttpError(403, "non_loopback_forbidden", "non-loopback Host is forbidden");
  }
}

function bearerToken(request: IncomingMessage): string {
  const value = request.headers.authorization;
  const match = typeof value === "string" ? /^Bearer ([^\s]+)$/.exec(value) : null;
  if (!match) throw new ReviewHttpError(401, "unauthenticated", "Bearer token is required");
  return match[1]!;
}

function decodePathSegment(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.includes("/") || decoded.includes("\\")) throw new Error();
    return decoded;
  } catch {
    throw new ReviewHttpError(400, "invalid_request", "path parameter is invalid");
  }
}

function corsHeaders(
  origin: string | string[] | undefined,
  origins: ReadonlySet<string>,
): Readonly<Record<string, string>> {
  if (typeof origin === "string" && origins.has(origin)) {
    return { "access-control-allow-origin": origin, vary: "Origin" };
  }
  return {};
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>>,
): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function listen(
  server: ReturnType<typeof createServer>,
  host: string,
  port: number,
): Promise<void> {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("NanoDAW MCP port must be an integer from 0 to 65535");
  }
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
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
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
