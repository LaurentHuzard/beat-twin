#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { BitwigProtocolClient } from "../../../index.js";

import { startRtxDualTargetRuntime } from "./rtx-dual-target-runtime.js";
import { readRtxBitwigPreviewConfig } from "./rtx-bitwig-preview-runtime.js";

const operatorSecret = readSecret(
  process.env.BEAT_TWIN_OPERATOR_SECRET_FILE,
  process.env.BEAT_TWIN_OPERATOR_SECRET,
  "BEAT_TWIN_OPERATOR_SECRET_FILE or BEAT_TWIN_OPERATOR_SECRET is required",
);
const config = readRtxBitwigPreviewConfig({
  ...process.env,
  BEAT_TWIN_OPERATOR_SECRET: operatorSecret,
});
const bridgeSecret = readBridgeSecret(process.env);
const allowedOrigins = (process.env.BEAT_TWIN_ALLOWED_ORIGINS ??
  "http://127.0.0.1:5173,http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const client = new BitwigProtocolClient({
  host: config.bitwigHost,
  port: config.bitwigPort,
  bridgeSecret,
});
const runtime = await startRtxDualTargetRuntime({
  operatorSecret: config.operatorSecret,
  bridgeSecret,
  providerBaseUrl: config.providerBaseUrl,
  model: config.model,
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
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void close().then(() => process.exit(0), (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  });
}

function readBridgeSecret(env) {
  return readSecret(
    env.BITWIG_BRIDGE_SECRET_FILE,
    env.BITWIG_BRIDGE_SECRET,
    "BITWIG_BRIDGE_SECRET_FILE or BITWIG_BRIDGE_SECRET is required",
  );
}

function readSecret(fileValue, directValue, message) {
  const file = fileValue?.trim();
  if (file) return readFileSync(file, "utf8").trim();
  const secret = directValue?.trim();
  if (!secret) throw new Error(message);
  return secret;
}
