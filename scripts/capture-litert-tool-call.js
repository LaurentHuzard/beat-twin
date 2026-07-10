import { writeFile } from "node:fs/promises";

import { validateSongPatchV1 } from "../packages/agent-contract/dist/index.js";
import {
  DEFAULT_LITERT_AGENT_SYSTEM_PROMPT,
  LITERT_AGENT_TOOL_SPECS,
  parseChatCompletionResponse,
} from "../packages/litert-provider/dist/index.js";

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

const request = {
  model,
  temperature: 0,
  messages: [
    {
      role: "system",
      content: DEFAULT_LITERT_AGENT_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: "Propose one instrument track with a one-beat quantized clip and one MIDI note at 120 BPM.",
    },
  ],
  tools: LITERT_AGENT_TOOL_SPECS,
  tool_choice: "auto",
};

const response = await requestJson(new URL("v1/chat/completions", baseUrl), {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify(request),
});

let completion;
try {
  completion = parseChatCompletionResponse(response);
} catch (error) {
  process.stderr.write(`${JSON.stringify(response, null, 2)}\n`);
  throw new Error(`G1 failed: invalid LiteRT-LM completion: ${errorMessage(error)}`);
}
const toolCalls = completion.choice.message.toolCalls;
if (
  !toolCalls ||
  toolCalls.length !== 1 ||
  toolCalls[0].function.name !== "propose_song_patch"
) {
  process.stderr.write(`${JSON.stringify(response, null, 2)}\n`);
  throw new Error("G1 failed: exact runtime request did not return one propose_song_patch tool call");
}
try {
  validateSongPatchV1(JSON.parse(toolCalls[0].function.arguments));
} catch (error) {
  throw new Error(`G1 failed: propose_song_patch arguments are invalid: ${errorMessage(error)}`);
}

const fixture = {
  capturedAt: new Date().toISOString(),
  serverOrigin: "http://s25.local:9379",
  serverOriginRedacted: true,
  model,
  requestProfile: "litert-provider-three-tools-v1",
  request,
  response,
};
const serialized = `${JSON.stringify(fixture, null, 2)}\n`;

if (outputPath) {
  await writeFile(outputPath, serialized, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ ok: true, outputPath, toolCallCount: toolCalls.length }));
} else {
  process.stdout.write(serialized);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
