import { randomBytes } from "node:crypto";

import { BitwigProtocolClient } from "../index.js";
import {
  readRtxBitwigPreviewConfig,
  startRtxBitwigPreviewRuntime,
} from "../apps/gateway/src/rtx-bitwig-preview-runtime.js";

const operatorSecret = randomBytes(32).toString("hex");
const config = readRtxBitwigPreviewConfig({
  ...process.env,
  BEAT_TWIN_OPERATOR_SECRET: operatorSecret,
  BEAT_TWIN_GATEWAY_PORT: "0",
});
const client = new BitwigProtocolClient({
  host: config.bitwigHost,
  port: config.bitwigPort,
  logger: { error: () => undefined },
});
let latestInspection;
const runtime = await startRtxBitwigPreviewRuntime({
  operatorSecret,
  providerBaseUrl: config.providerBaseUrl,
  model: config.model,
  gatewayHost: config.gatewayHost,
  gatewayPort: 0,
  bitwigCall: async (method, params) => {
    const result = await client.send(method, params);
    if (method === "target.inspect") latestInspection = structuredClone(result);
    return result;
  },
});

try {
  const pairing = await requestJson(`${runtime.baseUrl}/v1/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operatorSecret }),
  }, 201);
  const authorization = { authorization: `Bearer ${pairing.token}` };
  const health = await requestJson(`${runtime.baseUrl}/v1/health`, {
    headers: authorization,
  });
  const session = await requestJson(`${runtime.baseUrl}/v1/sessions/bitwig`, {
    headers: authorization,
  });
  const run = await requestJson(`${runtime.baseUrl}/v1/agent/runs`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({
      dawId: "bitwig",
      request:
        process.env.BEAT_TWIN_PREVIEW_REQUEST ??
        "Inspecte ma session Bitwig puis propose une boucle électronique minimale à 132 BPM.",
    }),
  }, 201);

  console.log(JSON.stringify({
    mode: "preview-only",
    model: run.model,
    steps: run.steps,
    health,
    inspectedSession: session.session,
    inspectedTarget: latestInspection,
    patch: run.patch,
    preview: run.preview,
    plan: run.plan,
    writesAvailable: false,
  }, null, 2));
} finally {
  client.destroy();
  await runtime.close();
}

async function requestJson(url, init, expectedStatus = 200) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (response.status !== expectedStatus) {
    const code = body?.error?.code ?? "unknown_error";
    const message = body?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`${code}: ${message}`);
  }
  return body;
}
