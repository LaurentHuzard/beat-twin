import { readFileSync } from "node:fs";

const baseUrl = requireLoopbackUrl(
  process.env.BEAT_TWIN_GATEWAY_URL ?? "http://127.0.0.1:8788",
);
const operatorSecret = readSecret(process.env);
const request = process.env.BEAT_TWIN_PREVIEW_REQUEST?.trim() ||
  "Inspecte NanoDAW et Bitwig puis propose la même boucle électronique minimale à 132 BPM.";

const pairing = await requestJson(new URL("/v1/pair", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ operatorSecret, actorId: "dual-target-preview" }),
}, 201);
const run = await requestJson(new URL("/v1/agent/dual-target-runs", baseUrl), {
  method: "POST",
  headers: {
    authorization: `Bearer ${pairing.token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    dawIds: ["nanodaw", "bitwig"],
    request,
  }),
}, 201);

console.log(JSON.stringify({
  mode: "dual-target-preview",
  model: run.model,
  steps: run.steps,
  toolCalls: run.toolCalls,
  patch: run.patch,
  targets: run.targets,
  confirmationsCreated: 0,
  executionsDispatched: 0,
}, null, 2));

function readSecret(env) {
  const file = env.BEAT_TWIN_OPERATOR_SECRET_FILE?.trim();
  if (file) return readFileSync(file, "utf8").trim();
  const secret = env.BEAT_TWIN_OPERATOR_SECRET?.trim();
  if (!secret) {
    throw new Error("BEAT_TWIN_OPERATOR_SECRET_FILE or BEAT_TWIN_OPERATOR_SECRET is required");
  }
  return secret;
}

function requireLoopbackUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || (host !== "127.0.0.1" && host !== "::1" && host !== "localhost")) {
    throw new Error("BEAT_TWIN_GATEWAY_URL must be a loopback HTTP URL");
  }
  return url;
}

async function requestJson(url, init, expectedStatus) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (response.status !== expectedStatus) {
    const code = body?.error?.code ?? "unknown_error";
    const message = body?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`${code}: ${message}`);
  }
  return body;
}
