#!/usr/bin/env node

import { BitwigProtocolClient } from "../../../index.js";

import {
  readRtxBitwigPreviewConfig,
  startRtxBitwigPreviewRuntime,
} from "./rtx-bitwig-preview-runtime.js";

const config = readRtxBitwigPreviewConfig();
const client = new BitwigProtocolClient({
  host: config.bitwigHost,
  port: config.bitwigPort,
});
const runtime = await startRtxBitwigPreviewRuntime({
  operatorSecret: config.operatorSecret,
  providerBaseUrl: config.providerBaseUrl,
  model: config.model,
  gatewayHost: config.gatewayHost,
  gatewayPort: config.gatewayPort,
  bitwigCall: (method, params) => client.send(method, params),
});

console.error(`Beat Twin RTX Bitwig preview runtime ready at ${runtime.baseUrl}`);
console.error(`Model: ${config.model}; Bitwig controller: ${config.bitwigHost}:${config.bitwigPort}`);
console.error("Preview-only: confirmation, execution, and Bitwig writes are unavailable.");

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
