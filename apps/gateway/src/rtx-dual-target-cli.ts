#!/usr/bin/env node

import { startLocalBitwigRelay } from "./local-bitwig-relay.ts";

import { BitwigProtocolClient } from "../../../index.js";

import { startRtxDualTargetRuntime } from "./rtx-dual-target-runtime.ts";
import { readRtxBitwigPreviewConfig } from "./rtx-bitwig-preview-runtime.ts";

const config = readRtxBitwigPreviewConfig(process.env, { localPairing: true });
const allowedOrigins = (process.env.BEAT_TWIN_ALLOWED_ORIGINS ??
  "http://127.0.0.1:5173,http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const relay = await startLocalBitwigRelay();
const client = new BitwigProtocolClient({
  host: config.bitwigHost,
  port: config.bitwigPort,
});
const runtime = await startRtxDualTargetRuntime({
  providerBaseUrl: config.providerBaseUrl,
  model: config.model,
  apiKey: config.apiKey,
  providerTimeoutMs: config.providerTimeoutMs,
  thinkingBudgetTokens: config.thinkingBudgetTokens,
  gatewayHost: config.gatewayHost,
  gatewayPort: config.gatewayPort,
  allowedOrigins,
  bitwigCall: (method, params, options) => client.send(method, params, options),
});

console.error(`Beat Twin RTX dual-target runtime ready at ${runtime.baseUrl}`);
console.error(`Model: ${config.model}; Bitwig controller: ${config.bitwigHost}:${config.bitwigPort}`);
console.error("NanoDAW remains browser-owned. Every target requires its own exact confirmation.");

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  client.destroy();
  await runtime.close();
  await relay.close();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void close().then(() => process.exit(0), (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  });
}
