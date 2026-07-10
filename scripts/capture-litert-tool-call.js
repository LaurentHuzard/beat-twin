import { writeFile } from "node:fs/promises";

import { SONG_PATCH_V1_JSON_SCHEMA } from "../packages/agent-contract/dist/index.js";

const baseUrl = requireHttpUrl(process.env.LITERT_BASE_URL);
const apiKey = process.env.LITERT_API_KEY?.trim();
const requestedModel = process.env.LITERT_MODEL?.trim();
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex === -1 ? null : process.argv[outputIndex + 1];

if (outputIndex !== -1 && !outputPath) {
  throw new Error("--output requires a file path");
}

const headers = {
  accept: "application/json",
  ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
};
const models = await requestJson(new URL("v1/models", baseUrl), { headers });
const model = requestedModel ?? models?.data?.[0]?.id;
if (typeof model !== "string" || model.length === 0) {
  throw new Error("LiteRT-LM /v1/models did not return a usable model id");
}

const response = await requestJson(new URL("v1/chat/completions", baseUrl), {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "You propose bounded Beat Twin song patches by calling propose_song_patch.",
      },
      {
        role: "user",
        content: "Propose one instrument track with a one-beat quantized clip and one MIDI note at 120 BPM.",
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "propose_song_patch",
          description: "Propose a strict SongPatchV1. This never executes or confirms a plan.",
          parameters: SONG_PATCH_V1_JSON_SCHEMA,
        },
      },
    ],
  }),
});

const toolCalls = response?.choices?.[0]?.message?.tool_calls;
if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
  process.stderr.write(`${JSON.stringify(response, null, 2)}\n`);
  throw new Error("G1 failed: LiteRT-LM response contains no choices[0].message.tool_calls");
}

const fixture = {
  capturedAt: new Date().toISOString(),
  serverOrigin: baseUrl.origin,
  model,
  response,
};
const serialized = `${JSON.stringify(fixture, null, 2)}\n`;

if (outputPath) {
  await writeFile(outputPath, serialized, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ ok: true, outputPath, toolCallCount: toolCalls.length }));
} else {
  process.stdout.write(serialized);
}

function requireHttpUrl(value) {
  if (!value?.trim()) {
    throw new Error("LITERT_BASE_URL is required, for example http://192.168.1.20:9379/");
  }
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LITERT_BASE_URL must use http or https");
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url.pathname} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`${url.pathname} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}
