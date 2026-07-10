import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LITERT_AGENT_TOOL_NAMES,
  LITERT_AGENT_TOOL_SPECS,
  LiteRtProviderError,
  createLiteRtProvider,
  parseChatCompletionResponse,
  parseModelsResponse,
  type LiteRtAgentToolHandlers,
} from "../src/index.ts";

const fixtureUrl = new URL("../../../tests/fixtures/litert-s25-tool-call.json", import.meta.url);

function validPatch() {
  return {
    schemaVersion: 1,
    tempoBpm: 120,
    track: {
      kind: "instrument",
      name: "SimpleOneBeat",
      clip: {
        name: "OneBeatHit",
        lengthBeats: 1,
        notes: [{ pitch: 60, velocity: 100, startBeat: 0, lengthBeats: 1 }],
      },
    },
  } as const;
}

function modelsResponse(...ids: string[]) {
  return {
    object: "list",
    data: ids.map((id) => ({ id, object: "model", created: 0, owned_by: "litert-lm" })),
  };
}

function completion(
  calls: Array<{ id: string; name: string; arguments: string }> | undefined,
  finishReason = calls ? "tool_calls" : "stop",
) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1,
    model: "gemma4-e2b",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          ...(calls
            ? {
                tool_calls: calls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        },
        finish_reason: finishReason,
      },
    ],
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function queueFetch(
  values: unknown[],
  requests: Array<{ url: string; init?: RequestInit }> = [],
): typeof fetch {
  let index = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    if (index >= values.length) {
      throw new Error("unexpected fetch");
    }
    return jsonResponse(values[index++]);
  }) as typeof fetch;
}

function handlers(overrides: Partial<LiteRtAgentToolHandlers> = {}): LiteRtAgentToolHandlers {
  return {
    list_daw_targets: () => [{ id: "nanodaw" }, { id: "bitwig" }],
    inspect_session: ({ dawId }) => ({ adapterId: dawId, revision: 7 }),
    propose_song_patch: () => ({ accepted: true }),
    ...overrides,
  };
}

function assertProviderError(code: LiteRtProviderError["code"]): (error: unknown) => boolean {
  return (error: unknown) => error instanceof LiteRtProviderError && error.code === code;
}

test("parses the real S25 LiteRT-LM tool-call fixture", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as {
    model: string;
    response: unknown;
  };
  const parsed = parseChatCompletionResponse(fixture.response);

  assert.equal(parsed.model, fixture.model);
  assert.equal(parsed.choice.finishReason, "tool_calls");
  assert.equal(parsed.choice.message.toolCalls?.length, 1);
  assert.equal(parsed.choice.message.toolCalls?.[0]?.function.name, "propose_song_patch");
  assert.deepEqual(
    JSON.parse(parsed.choice.message.toolCalls?.[0]?.function.arguments ?? "null"),
    validPatch(),
  );
  assert.ok(Object.isFrozen(parsed));
});

test("exposes exactly the three read/propose tools and never confirm or execute", () => {
  assert.deepEqual(LITERT_AGENT_TOOL_NAMES, [
    "list_daw_targets",
    "inspect_session",
    "propose_song_patch",
  ]);
  assert.deepEqual(
    LITERT_AGENT_TOOL_SPECS.map((tool) => tool.function.name),
    LITERT_AGENT_TOOL_NAMES,
  );
  const names = LITERT_AGENT_TOOL_SPECS.map((tool) => tool.function.name);
  assert.equal(names.includes("confirm" as never), false);
  assert.equal(names.includes("execute" as never), false);
  const proposalSchema = LITERT_AGENT_TOOL_SPECS[2].function.parameters;
  assert.equal("$schema" in proposalSchema, false);
  assert.equal("additionalProperties" in proposalSchema, false);
  assert.ok(Object.isFrozen(LITERT_AGENT_TOOL_SPECS));
});

test("runs the real fixture through validation without mutating a DAW", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as {
    model: string;
    response: unknown;
  };
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let proposed: unknown;
  const provider = createLiteRtProvider({
    baseUrl: "http://192.168.1.97:9379",
    model: fixture.model,
    fetch: queueFetch([modelsResponse(fixture.model), fixture.response], requests),
  });
  const result = await provider.runAgent({
    request: "Create one note",
    handlers: handlers({
      propose_song_patch: (patch) => {
        proposed = patch;
        return { previewOnly: true };
      },
    }),
  });

  assert.deepEqual(result.patch, validPatch());
  assert.deepEqual(proposed, validPatch());
  assert.equal(result.steps, 1);
  assert.deepEqual(result.proposalResult, { previewOnly: true });
  assert.deepEqual(
    requests.map(({ url }) => new URL(url).pathname),
    ["/v1/models", "/v1/chat/completions"],
  );
  const body = JSON.parse(String(requests[1]?.init?.body)) as { tools: unknown[]; messages: unknown[] };
  assert.deepEqual(body.tools, LITERT_AGENT_TOOL_SPECS);
  assert.equal(body.messages.length, 2);
});

test("executes read tools across steps and returns only after a valid proposal", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const provider = createLiteRtProvider({
    baseUrl: new URL("http://phone.local:9379/"),
    fetch: queueFetch(
      [
        modelsResponse("gemma4-e2b"),
        completion([{ id: "call-list", name: "list_daw_targets", arguments: "{}" }]),
        completion([
          {
            id: "call-inspect",
            name: "inspect_session",
            arguments: '{"dawId":"nanodaw"}',
          },
        ]),
        completion([
          {
            id: "call-propose",
            name: "propose_song_patch",
            arguments: JSON.stringify(validPatch()),
          },
        ]),
      ],
      requests,
    ),
  });
  const called: string[] = [];
  const result = await provider.runAgent({
    request: "Inspect then propose",
    handlers: handlers({
      list_daw_targets: () => {
        called.push("list");
        return [{ id: "nanodaw" }];
      },
      inspect_session: ({ dawId }) => {
        called.push(`inspect:${dawId}`);
        return { revision: 4 };
      },
      propose_song_patch: () => {
        called.push("propose");
      },
    }),
  });

  assert.equal(result.steps, 3);
  assert.deepEqual(called, ["list", "inspect:nanodaw", "propose"]);
  assert.deepEqual(
    result.toolCalls.map(({ name }) => name),
    ["list_daw_targets", "inspect_session", "propose_song_patch"],
  );
  const thirdRequest = JSON.parse(String(requests[3]?.init?.body)) as {
    messages: Array<Record<string, unknown>>;
  };
  assert.deepEqual(
    thirdRequest.messages.slice(-2).map((message) => message.role),
    ["assistant", "tool"],
  );
  assert.equal(thirdRequest.messages.at(-1)?.tool_call_id, "call-inspect");
});

test("rejects unknown tools before invoking any handler", async () => {
  let invoked = false;
  const provider = createLiteRtProvider({
    baseUrl: "http://phone.local:9379/",
    fetch: queueFetch([
      modelsResponse("gemma4-e2b"),
      completion([{ id: "call-1", name: "execute", arguments: "{}" }]),
    ]),
  });

  await assert.rejects(
    provider.runAgent({
      request: "Mutate",
      handlers: handlers({ list_daw_targets: () => (invoked = true) }),
    }),
    assertProviderError("unknown_tool"),
  );
  assert.equal(invoked, false);
});

test("rejects malformed JSON and strictly validates each tool's arguments", async () => {
  for (const [name, args] of [
    ["list_daw_targets", '{"extra":true}'],
    ["inspect_session", '{"dawId":"ableton"}'],
    ["inspect_session", "{"],
    ["propose_song_patch", JSON.stringify({ ...validPatch(), playback: true })],
  ] as const) {
    const provider = createLiteRtProvider({
      baseUrl: "http://phone.local:9379/",
      fetch: queueFetch([
        modelsResponse("gemma4-e2b"),
        completion([{ id: `call-${name}`, name, arguments: args }]),
      ]),
    });
    await assert.rejects(
      provider.runAgent({ request: "Bad args", handlers: handlers() }),
      assertProviderError("invalid_tool_arguments"),
    );
  }
});

test("rejects duplicate call IDs in one response and across model steps", async () => {
  assert.throws(
    () =>
      parseChatCompletionResponse(
        completion([
          { id: "same", name: "list_daw_targets", arguments: "{}" },
          { id: "same", name: "list_daw_targets", arguments: "{}" },
        ]),
      ),
    assertProviderError("duplicate_tool_call_id"),
  );

  const provider = createLiteRtProvider({
    baseUrl: "http://phone.local:9379/",
    fetch: queueFetch([
      modelsResponse("gemma4-e2b"),
      completion([{ id: "same", name: "list_daw_targets", arguments: "{}" }]),
      completion([{ id: "same", name: "inspect_session", arguments: '{"dawId":"nanodaw"}' }]),
    ]),
  });
  await assert.rejects(
    provider.runAgent({ request: "Duplicate", handlers: handlers() }),
    assertProviderError("duplicate_tool_call_id"),
  );
});

test("rejects normal finish without a proposal and has no JSON prompt fallback", async () => {
  const provider = createLiteRtProvider({
    baseUrl: "http://phone.local:9379/",
    fetch: queueFetch([modelsResponse("gemma4-e2b"), completion(undefined)]),
  });
  await assert.rejects(
    provider.runAgent({ request: "Return JSON in content", handlers: handlers() }),
    assertProviderError("missing_proposal"),
  );
});

test("enforces the configured step limit and never permits more than four", async () => {
  assert.throws(
    () => createLiteRtProvider({ baseUrl: "http://phone.local:9379/", maxSteps: 5 }),
    assertProviderError("configuration_error"),
  );

  const provider = createLiteRtProvider({
    baseUrl: "http://phone.local:9379/",
    maxSteps: 2,
    fetch: queueFetch([
      modelsResponse("gemma4-e2b"),
      completion([{ id: "call-1", name: "list_daw_targets", arguments: "{}" }]),
      completion([{ id: "call-2", name: "list_daw_targets", arguments: "{}" }]),
    ]),
  });
  await assert.rejects(
    provider.runAgent({ request: "Loop", handlers: handlers() }),
    assertProviderError("step_limit"),
  );
});

test("times out even when an injected fetch never settles", async () => {
  const provider = createLiteRtProvider({
    baseUrl: "http://phone.local:9379/",
    timeoutMs: 10,
    fetch: (() => new Promise<Response>(() => undefined)) as typeof fetch,
  });
  await assert.rejects(provider.listModels(), assertProviderError("timeout"));
});

test("strictly parses model and completion response envelopes", () => {
  assert.deepEqual(parseModelsResponse(modelsResponse("gemma")), [
    { id: "gemma", object: "model", created: 0, ownedBy: "litert-lm" },
  ]);
  assert.throws(
    () => parseModelsResponse({ data: [{ id: "same" }, { id: "same" }] }),
    assertProviderError("invalid_response"),
  );
  assert.throws(
    () => parseChatCompletionResponse({ ...completion(undefined), choices: [] }),
    assertProviderError("invalid_response"),
  );
  assert.throws(
    () => parseChatCompletionResponse(completion(undefined, "tool_calls")),
    assertProviderError("invalid_response"),
  );
});

test("rejects a completion attributed to a model other than the requested model", async () => {
  const mismatched = { ...completion(undefined), model: "other-model" };
  const provider = createLiteRtProvider({
    baseUrl: "http://phone.local:9379/",
    model: "gemma",
    fetch: queueFetch([modelsResponse("gemma"), mismatched]),
  });
  await assert.rejects(
    provider.runAgent({ request: "Wrong model", handlers: handlers() }),
    assertProviderError("invalid_response"),
  );
});
