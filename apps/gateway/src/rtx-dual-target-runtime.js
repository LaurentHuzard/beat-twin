import { createServer } from "node:http";

import {
  BitwigAdapter,
  createRpcBitwigBridgePort,
} from "@beat-twin/bitwig-adapter";
import {
  GatewayPlanStore,
  PairingAuthority,
} from "@beat-twin/gateway-core";
import { createLiteRtProvider } from "@beat-twin/litert-provider";
import { NanoDawAdapter } from "@beat-twin/nanodaw-adapter";

import {
  assertAllowedListenHost,
  createBrowserNanoDawWebSocketProxy,
  createGatewayRequestHandler,
} from "./index.js";

export async function startRtxDualTargetRuntime(options) {
  const config = validateOptions(options);
  const audit = config.audit ?? (() => undefined);
  const pairing = new PairingAuthority({ audit });
  const planStore = new GatewayPlanStore({
    pairing,
    audit,
    policy: (plan) => {
      if (plan.adapterId === "bitwig") {
        return plan.requiredScopes.length === 1 && plan.requiredScopes[0] === "song.write";
      }
      return plan.adapterId === "nanodaw" && plan.requiredScopes.every(
        (scope) => scope === "song.write" || scope === "transport.write",
      );
    },
  });
  const browserProxy = createBrowserNanoDawWebSocketProxy({
    pairing,
    allowedOrigins: config.allowedOrigins,
  });
  const nanodaw = new NanoDawAdapter({
    port: browserProxy.port,
    verifyDigest: (plan) => {
      const stored = planStore.getPlan(plan.planId);
      return stored?.digest === plan.digest && stored.requestId === plan.requestId;
    },
  });
  const bitwig = new BitwigAdapter({
    port: createRpcBitwigBridgePort({
      call: config.bitwigCall,
      bridgeSecret: config.bridgeSecret,
    }),
    verifyDigest: (plan) => {
      const stored = planStore.getPlan(plan.planId);
      return stored?.digest === plan.digest && stored.requestId === plan.requestId;
    },
  });
  const provider = config.provider ?? createLiteRtProvider({
    baseUrl: config.providerBaseUrl,
    model: config.model,
    timeoutMs: config.providerTimeoutMs,
    thinkingBudgetTokens: config.thinkingBudgetTokens,
    fetch: config.fetch,
  });
  const handler = createGatewayRequestHandler({
    operatorSecret: config.operatorSecret,
    pairing,
    planStore,
    provider,
    adapters: new Map([
      ["nanodaw", nanodaw],
      ["bitwig", bitwig],
    ]),
    corsOrigins: config.allowedOrigins,
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  browserProxy.attach(server);

  try {
    await listen(server, config.gatewayHost, config.gatewayPort);
  } catch (error) {
    await browserProxy.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") {
    await Promise.allSettled([browserProxy.close(), closeServer(server)]);
    throw new Error("RTX dual-target runtime did not expose a TCP address");
  }
  const hostname = config.gatewayHost === "::1" ? "[::1]" : config.gatewayHost;

  return Object.freeze({
    baseUrl: `http://${hostname}:${address.port}`,
    browserStatus: () => browserProxy.status(),
    close: async () => {
      await browserProxy.close();
      await closeServer(server);
    },
  });
}

function validateOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("RTX dual-target runtime options are required");
  }
  const operatorSecret = requireSecret(options.operatorSecret, "operatorSecret");
  const bridgeSecret = requireSecret(options.bridgeSecret, "bridgeSecret");
  const gatewayHost = options.gatewayHost ?? "127.0.0.1";
  assertAllowedListenHost(gatewayHost);
  const gatewayPort = options.gatewayPort ?? 0;
  if (!Number.isInteger(gatewayPort) || gatewayPort < 0 || gatewayPort > 65_535) {
    throw new Error("gatewayPort must be an integer from 0 to 65535");
  }
  if (!Array.isArray(options.allowedOrigins) || options.allowedOrigins.length === 0) {
    throw new Error("allowedOrigins must contain at least one browser origin");
  }
  if (typeof options.bitwigCall !== "function") {
    throw new Error("bitwigCall must be a function");
  }
  if (options.provider === undefined) {
    requireHttpUrl(options.providerBaseUrl, "providerBaseUrl");
    requireNonBlank(options.model, "model");
  }
  const providerTimeoutMs = options.providerTimeoutMs ?? 60_000;
  if (!Number.isSafeInteger(providerTimeoutMs) || providerTimeoutMs <= 0) {
    throw new Error("providerTimeoutMs must be a positive integer");
  }
  const thinkingBudgetTokens = options.thinkingBudgetTokens ?? 512;
  if (!Number.isSafeInteger(thinkingBudgetTokens) || thinkingBudgetTokens < 0) {
    throw new Error("thinkingBudgetTokens must be a non-negative integer");
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new Error("fetch must be a function");
  }
  if (options.audit !== undefined && typeof options.audit !== "function") {
    throw new Error("audit must be a function");
  }
  return Object.freeze({
    ...options,
    operatorSecret,
    bridgeSecret,
    gatewayHost,
    gatewayPort,
    providerTimeoutMs,
    thinkingBudgetTokens,
    allowedOrigins: Object.freeze([...options.allowedOrigins]),
  });
}

function requireSecret(value, label) {
  const secret = requireNonBlank(value, label);
  if (secret.length < 16) throw new Error(`${label} must contain at least 16 characters`);
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
  try {
    url = value instanceof URL ? value : new URL(requireNonBlank(value, label));
  } catch {
    throw new Error(`${label} must be a valid HTTP URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  return url;
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
