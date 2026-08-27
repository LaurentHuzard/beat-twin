import { createServer } from "node:http";

import {
  BitwigAdapter,
  validateBitwigTargetInspection,
} from "@beat-twin/bitwig-adapter";
import {
  GatewayPlanStore,
  PairingAuthority,
} from "@beat-twin/gateway-core";
import { createLiteRtProvider } from "@beat-twin/litert-provider";

import {
  assertAllowedListenHost,
  createGatewayRequestHandler,
} from "./index.js";

export const RTX_BITWIG_PREVIEW_SCOPES = Object.freeze([
  "gateway.read",
  "daw.list",
  "daw.inspect",
  "agent.run",
  "plan.create",
  "song.write",
]);

export function readRtxBitwigPreviewConfig(env = process.env) {
  const operatorSecret = requireSecret(env.BEAT_TWIN_OPERATOR_SECRET);
  const providerBaseUrl = requireHttpUrl(env.LITERT_BASE_URL, "LITERT_BASE_URL");
  const model = requireNonBlank(env.LITERT_MODEL, "LITERT_MODEL");
  const gatewayHost = env.BEAT_TWIN_GATEWAY_HOST?.trim() || "127.0.0.1";
  assertAllowedListenHost(gatewayHost);
  const gatewayPort = parsePort(env.BEAT_TWIN_GATEWAY_PORT, 8788, "BEAT_TWIN_GATEWAY_PORT");
  const bitwigHost = env.BITWIG_HOST?.trim() || "127.0.0.1";
  assertAllowedListenHost(bitwigHost);
  const bitwigPort = parsePort(env.BITWIG_PORT, 8888, "BITWIG_PORT");

  return Object.freeze({
    operatorSecret,
    providerBaseUrl,
    model,
    gatewayHost,
    gatewayPort,
    bitwigHost,
    bitwigPort,
  });
}

export async function startRtxBitwigPreviewRuntime(options) {
  const config = validateRuntimeOptions(options);
  const audit = config.audit ?? (() => undefined);
  const pairing = new PairingAuthority({ audit });
  const planStore = new GatewayPlanStore({
    pairing,
    audit,
    policy: (plan) =>
      plan.adapterId === "bitwig" &&
      plan.requiredScopes.length === 1 &&
      plan.requiredScopes[0] === "song.write",
  });
  const provider = config.provider ?? createLiteRtProvider({
    baseUrl: config.providerBaseUrl,
    model: config.model,
    fetch: config.fetch,
  });
  const readOnlyPort = Object.freeze({
    inspectTarget: async () => validateBitwigTargetInspection(
      await config.bitwigCall("target.inspect", []),
    ),
    authenticate: async () => {
      throw new Error("Bitwig authentication is unavailable in preview-only runtime");
    },
    mutate: async () => {
      throw new Error("Bitwig mutation is unavailable in preview-only runtime");
    },
  });
  const adapter = new BitwigAdapter({
    port: readOnlyPort,
    verifyDigest: (plan) => planStore.getPlan(plan.planId)?.digest === plan.digest,
  });
  const handler = createGatewayRequestHandler({
    operatorSecret: config.operatorSecret,
    pairing,
    planStore,
    provider,
    adapters: new Map([["bitwig", adapter]]),
    pairingScopes: RTX_BITWIG_PREVIEW_SCOPES,
    previewOnly: true,
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });

  await listen(server, config.gatewayHost, config.gatewayPort);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("RTX Bitwig preview runtime did not expose a TCP address");
  }
  const hostname = config.gatewayHost === "::1" ? "[::1]" : config.gatewayHost;

  return Object.freeze({
    baseUrl: `http://${hostname}:${address.port}`,
    close: () => closeServer(server),
  });
}

function validateRuntimeOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("RTX Bitwig preview runtime options are required");
  }
  const operatorSecret = requireSecret(options.operatorSecret);
  const gatewayHost = options.gatewayHost ?? "127.0.0.1";
  assertAllowedListenHost(gatewayHost);
  const gatewayPort = parseRuntimePort(options.gatewayPort ?? 0, "gatewayPort");
  if (typeof options.bitwigCall !== "function") {
    throw new Error("bitwigCall must be a function");
  }
  if (options.provider === undefined) {
    requireHttpUrl(options.providerBaseUrl, "providerBaseUrl");
    requireNonBlank(options.model, "model");
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new Error("fetch must be a function");
  }
  if (options.audit !== undefined && typeof options.audit !== "function") {
    throw new Error("audit must be a function");
  }
  return Object.freeze({ ...options, operatorSecret, gatewayHost, gatewayPort });
}

function requireSecret(value) {
  const secret = requireNonBlank(value, "BEAT_TWIN_OPERATOR_SECRET");
  if (secret.length < 16) {
    throw new Error("BEAT_TWIN_OPERATOR_SECRET must contain at least 16 characters");
  }
  return secret;
}

function requireNonBlank(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireHttpUrl(value, label) {
  let url;
  if (value instanceof URL) {
    url = value;
  } else {
    const raw = requireNonBlank(value, label);
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${label} must be a valid HTTP URL`);
    }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  return url;
}

function parsePort(value, fallback, label) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer from 0 to 65535`);
  return parseRuntimePort(Number(value), label);
}

function parseRuntimePort(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error(`${label} must be an integer from 0 to 65535`);
  }
  return value;
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
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
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
