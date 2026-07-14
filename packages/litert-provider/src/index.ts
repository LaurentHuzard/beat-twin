import {
  SONG_PATCH_V1_TOOL_SCHEMA,
  validateSongPatchV1,
  type SongPatchV1,
} from "@beat-twin/agent-contract";

export const LITERT_AGENT_TOOL_NAMES = Object.freeze([
  "list_daw_targets",
  "inspect_session",
  "propose_song_patch",
] as const);

export const DEFAULT_LITERT_AGENT_SYSTEM_PROMPT =
  "Inspect DAW sessions when useful, then propose exactly one strict SongPatchV1. Never confirm or execute a plan.";

export type LiteRtAgentToolName = (typeof LITERT_AGENT_TOOL_NAMES)[number];

export const LITERT_AGENT_TOOL_SPECS = deepFreeze([
  {
    type: "function",
    function: {
      name: "list_daw_targets",
      description: "List DAW targets available to inspect. This never mutates a DAW.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_session",
      description: "Inspect one DAW session without mutating it.",
      parameters: {
        type: "object",
        required: ["dawId"],
        properties: {
          dawId: { type: "string", enum: ["nanodaw", "bitwig"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_song_patch",
      description: "Propose a strict SongPatchV1. This never confirms or executes a plan.",
      parameters: SONG_PATCH_V1_TOOL_SCHEMA,
    },
  },
] as const);

export type LiteRtModel = {
  readonly id: string;
  readonly object?: "model";
  readonly created?: number;
  readonly ownedBy?: string;
};

export type LiteRtToolCall = {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
};

export type LiteRtChatCompletion = {
  readonly id: string;
  readonly object: "chat.completion";
  readonly created: number;
  readonly model: string;
  readonly choice: {
    readonly index: 0;
    readonly message: {
      readonly role: "assistant";
      readonly content: string | null;
      readonly toolCalls?: readonly LiteRtToolCall[];
    };
    readonly finishReason: string | null;
  };
};

export type InspectSessionArguments = {
  readonly dawId: "nanodaw" | "bitwig";
};

/**
 * These handlers form a read/propose-only capability boundary. Implementations
 * must not mutate a DAW; confirmation and execution intentionally do not exist
 * in this interface or in the model-visible tool list.
 */
export type LiteRtAgentToolHandlers = {
  readonly list_daw_targets: () => unknown | Promise<unknown>;
  readonly inspect_session: (args: InspectSessionArguments) => unknown | Promise<unknown>;
  readonly propose_song_patch: (patch: SongPatchV1) => unknown | Promise<unknown>;
};

export type LiteRtProviderOptions = {
  readonly baseUrl: string | URL;
  readonly model?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  /** Must remain between one and four. The default and absolute maximum are four. */
  readonly maxSteps?: number;
  readonly apiKey?: string;
};

export type RunLiteRtAgentInput = {
  readonly request: string;
  readonly handlers: LiteRtAgentToolHandlers;
  readonly systemPrompt?: string;
};

export type LiteRtAgentRunResult = {
  readonly model: string;
  readonly patch: SongPatchV1;
  readonly proposalResult: unknown;
  readonly steps: number;
  readonly toolCalls: readonly {
    readonly step: number;
    readonly id: string;
    readonly name: LiteRtAgentToolName;
  }[];
};

export type LiteRtProviderErrorCode =
  | "configuration_error"
  | "timeout"
  | "http_error"
  | "invalid_response"
  | "unknown_tool"
  | "invalid_tool_arguments"
  | "duplicate_tool_call_id"
  | "missing_proposal"
  | "step_limit"
  | "handler_error";

export class LiteRtProviderError extends Error {
  readonly code: LiteRtProviderErrorCode;
  readonly status?: number;

  constructor(code: LiteRtProviderErrorCode, message: string, options: { cause?: unknown; status?: number } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LiteRtProviderError";
    this.code = code;
    this.status = options.status;
  }
}

export interface LiteRtProvider {
  readonly toolSpecs: typeof LITERT_AGENT_TOOL_SPECS;
  listModels(): Promise<readonly LiteRtModel[]>;
  runAgent(input: RunLiteRtAgentInput): Promise<LiteRtAgentRunResult>;
}

export function createLiteRtProvider(options: LiteRtProviderOptions): LiteRtProvider {
  const config = validateOptions(options);

  async function listModels(): Promise<readonly LiteRtModel[]> {
    const payload = await requestJson(config, "v1/models", { method: "GET" });
    return parseModelsResponse(payload);
  }

  async function runAgent(input: RunLiteRtAgentInput): Promise<LiteRtAgentRunResult> {
    if (!isPlainRecord(input) || !isNonBlankString(input.request)) {
      throw new LiteRtProviderError("configuration_error", "request must be a non-empty string");
    }
    if (!isPlainRecord(input.handlers)) {
      throw new LiteRtProviderError("configuration_error", "handlers must be an object");
    }
    for (const name of LITERT_AGENT_TOOL_NAMES) {
      if (typeof input.handlers[name] !== "function") {
        throw new LiteRtProviderError("configuration_error", `handler ${name} must be a function`);
      }
    }
    if (input.systemPrompt !== undefined && !isNonBlankString(input.systemPrompt)) {
      throw new LiteRtProviderError("configuration_error", "systemPrompt must be a non-empty string");
    }

    const models = await listModels();
    const model = resolveModel(config.model, models);
    const messages: ChatRequestMessage[] = [
      {
        role: "system",
        content:
          input.systemPrompt ??
          DEFAULT_LITERT_AGENT_SYSTEM_PROMPT,
      },
      { role: "user", content: input.request },
    ];
    const seenCallIds = new Set<string>();
    const callLog: Array<{ step: number; id: string; name: LiteRtAgentToolName }> = [];

    for (let step = 1; step <= config.maxSteps; step += 1) {
      const payload = await requestJson(config, "v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          temperature: 0,
          messages,
          tools: LITERT_AGENT_TOOL_SPECS,
          tool_choice: "auto",
        }),
      });
      const completion = parseChatCompletionResponse(payload);
      if (completion.model !== model) {
        throw new LiteRtProviderError(
          "invalid_response",
          `chat completion model ${completion.model} does not match requested model ${model}`,
        );
      }
      const calls = completion.choice.message.toolCalls;

      if (!calls) {
        throw new LiteRtProviderError(
          "missing_proposal",
          `model finished with ${completion.choice.finishReason ?? "null"} before proposing a SongPatchV1`,
        );
      }

      for (const call of calls) {
        if (seenCallIds.has(call.id)) {
          throw new LiteRtProviderError(
            "duplicate_tool_call_id",
            `duplicate tool call id: ${call.id}`,
          );
        }
        seenCallIds.add(call.id);
      }

      const parsedCalls = calls.map((call) => ({
        call,
        name: parseToolName(call.function.name),
        args: parseToolArguments(call.function.name, call.function.arguments),
      }));
      const proposalCalls = parsedCalls.filter(({ name }) => name === "propose_song_patch");
      if (proposalCalls.length > 0) {
        if (parsedCalls.length !== 1 || proposalCalls.length !== 1) {
          throw new LiteRtProviderError(
            "invalid_response",
            "propose_song_patch must be the only tool call in its model step",
          );
        }
        const proposal = proposalCalls[0]!;
        let patch: SongPatchV1;
        try {
          patch = validateSongPatchV1(proposal.args);
        } catch (error) {
          throw new LiteRtProviderError(
            "invalid_tool_arguments",
            "propose_song_patch arguments are not a valid SongPatchV1",
            { cause: error },
          );
        }
        callLog.push({ step, id: proposal.call.id, name: proposal.name });
        const proposalResult = await invokeHandler(
          "propose_song_patch",
          () => input.handlers.propose_song_patch(patch),
        );
        return deepFreeze({ model, patch, proposalResult, steps: step, toolCalls: callLog });
      }

      messages.push({
        role: "assistant",
        content: completion.choice.message.content,
        tool_calls: calls.map(toRequestToolCall),
      });

      for (const parsed of parsedCalls) {
        callLog.push({ step, id: parsed.call.id, name: parsed.name });
        const result =
          parsed.name === "list_daw_targets"
            ? await invokeHandler(parsed.name, () => input.handlers.list_daw_targets())
            : await invokeHandler(parsed.name, () =>
                input.handlers.inspect_session(parsed.args as InspectSessionArguments),
              );
        messages.push({
          role: "tool",
          tool_call_id: parsed.call.id,
          content: serializeToolResult(parsed.name, result),
        });
      }
    }

    throw new LiteRtProviderError(
      "step_limit",
      `model did not propose a SongPatchV1 within ${config.maxSteps} steps`,
    );
  }

  return Object.freeze({ toolSpecs: LITERT_AGENT_TOOL_SPECS, listModels, runAgent });
}

export function parseModelsResponse(value: unknown): readonly LiteRtModel[] {
  if (!isPlainRecord(value) || !Array.isArray(value.data)) {
    throw invalidResponse("/v1/models must return an object with a data array");
  }
  if (value.object !== undefined && value.object !== "list") {
    throw invalidResponse("/v1/models object must be list when present");
  }

  const seenIds = new Set<string>();
  const models = value.data.map((entry, index): LiteRtModel => {
    if (!isPlainRecord(entry) || !isNonBlankString(entry.id)) {
      throw invalidResponse(`/v1/models data[${index}].id must be a non-empty string`);
    }
    if (seenIds.has(entry.id)) {
      throw invalidResponse(`/v1/models contains duplicate model id ${entry.id}`);
    }
    seenIds.add(entry.id);
    if (entry.object !== undefined && entry.object !== "model") {
      throw invalidResponse(`/v1/models data[${index}].object must be model when present`);
    }
    if (entry.created !== undefined && !isNonNegativeInteger(entry.created)) {
      throw invalidResponse(`/v1/models data[${index}].created must be a non-negative integer`);
    }
    if (entry.owned_by !== undefined && !isNonBlankString(entry.owned_by)) {
      throw invalidResponse(`/v1/models data[${index}].owned_by must be a non-empty string`);
    }
    return deepFreeze({
      id: entry.id,
      ...(entry.object === undefined ? {} : { object: entry.object }),
      ...(entry.created === undefined ? {} : { created: entry.created }),
      ...(entry.owned_by === undefined ? {} : { ownedBy: entry.owned_by }),
    });
  });

  return Object.freeze(models);
}

export function parseChatCompletionResponse(value: unknown): LiteRtChatCompletion {
  if (!isPlainRecord(value)) {
    throw invalidResponse("/v1/chat/completions must return an object");
  }
  if (!isNonBlankString(value.id)) {
    throw invalidResponse("chat completion id must be a non-empty string");
  }
  if (value.object !== "chat.completion") {
    throw invalidResponse("chat completion object must equal chat.completion");
  }
  if (!isNonNegativeInteger(value.created)) {
    throw invalidResponse("chat completion created must be a non-negative integer");
  }
  if (!isNonBlankString(value.model)) {
    throw invalidResponse("chat completion model must be a non-empty string");
  }
  if (!Array.isArray(value.choices) || value.choices.length !== 1) {
    throw invalidResponse("chat completion choices must contain exactly one choice");
  }

  const rawChoice = value.choices[0];
  if (!isPlainRecord(rawChoice) || rawChoice.index !== 0 || !isPlainRecord(rawChoice.message)) {
    throw invalidResponse("chat completion choice 0 is malformed");
  }
  if (rawChoice.finish_reason !== null && typeof rawChoice.finish_reason !== "string") {
    throw invalidResponse("chat completion finish_reason must be a string or null");
  }
  const rawMessage = rawChoice.message;
  if (rawMessage.role !== "assistant") {
    throw invalidResponse("chat completion message role must be assistant");
  }
  if (rawMessage.content !== null && typeof rawMessage.content !== "string") {
    throw invalidResponse("chat completion message content must be a string or null");
  }

  let toolCalls: readonly LiteRtToolCall[] | undefined;
  if (rawMessage.tool_calls !== undefined) {
    if (!Array.isArray(rawMessage.tool_calls) || rawMessage.tool_calls.length === 0) {
      throw invalidResponse("chat completion tool_calls must be a non-empty array when present");
    }
    const ids = new Set<string>();
    toolCalls = Object.freeze(
      rawMessage.tool_calls.map((rawCall, index): LiteRtToolCall => {
        if (
          !isPlainRecord(rawCall) ||
          !isNonBlankString(rawCall.id) ||
          rawCall.type !== "function" ||
          !isPlainRecord(rawCall.function) ||
          !isNonBlankString(rawCall.function.name) ||
          typeof rawCall.function.arguments !== "string"
        ) {
          throw invalidResponse(`chat completion tool_calls[${index}] is malformed`);
        }
        if (ids.has(rawCall.id)) {
          throw new LiteRtProviderError(
            "duplicate_tool_call_id",
            `duplicate tool call id: ${rawCall.id}`,
          );
        }
        ids.add(rawCall.id);
        return deepFreeze({
          id: rawCall.id,
          type: "function" as const,
          function: { name: rawCall.function.name, arguments: rawCall.function.arguments },
        });
      }),
    );
    if (rawChoice.finish_reason !== "tool_calls") {
      throw invalidResponse("a response with tool_calls must finish with tool_calls");
    }
  } else if (rawChoice.finish_reason === "tool_calls") {
    throw invalidResponse("finish_reason tool_calls requires message.tool_calls");
  }

  return deepFreeze({
    id: value.id,
    object: "chat.completion" as const,
    created: value.created,
    model: value.model,
    choice: {
      index: 0 as const,
      message: {
        role: "assistant" as const,
        content: rawMessage.content,
        ...(toolCalls === undefined ? {} : { toolCalls }),
      },
      finishReason: rawChoice.finish_reason,
    },
  });
}

type ValidatedConfig = {
  readonly baseUrl: URL;
  readonly model?: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
  readonly maxSteps: number;
  readonly apiKey?: string;
};

type ChatRequestMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

function validateOptions(options: LiteRtProviderOptions): ValidatedConfig {
  if (!isPlainRecord(options)) {
    throw new LiteRtProviderError("configuration_error", "provider options must be an object");
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(options.baseUrl);
  } catch (error) {
    throw new LiteRtProviderError("configuration_error", "baseUrl must be a valid URL", {
      cause: error,
    });
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new LiteRtProviderError("configuration_error", "baseUrl must use http or https");
  }
  if (baseUrl.username || baseUrl.password) {
    throw new LiteRtProviderError("configuration_error", "baseUrl must not contain credentials");
  }
  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname += "/";
  }
  if (options.model !== undefined && !isNonBlankString(options.model)) {
    throw new LiteRtProviderError("configuration_error", "model must be a non-empty string");
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new LiteRtProviderError("configuration_error", "fetch must be a function");
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new LiteRtProviderError("configuration_error", "timeoutMs must be a positive integer");
  }
  const maxSteps = options.maxSteps ?? 4;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 4) {
    throw new LiteRtProviderError("configuration_error", "maxSteps must be an integer from 1 to 4");
  }
  if (options.apiKey !== undefined && !isNonBlankString(options.apiKey)) {
    throw new LiteRtProviderError("configuration_error", "apiKey must be a non-empty string");
  }
  const configuredFetch = options.fetch ?? globalThis.fetch;
  if (typeof configuredFetch !== "function") {
    throw new LiteRtProviderError("configuration_error", "no fetch implementation is available");
  }

  return Object.freeze({
    baseUrl,
    ...(options.model === undefined ? {} : { model: options.model }),
    fetch: configuredFetch,
    timeoutMs,
    maxSteps,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
  });
}

async function requestJson(
  config: ValidatedConfig,
  path: "v1/models" | "v1/chat/completions",
  init: { method: "GET" | "POST"; body?: string },
): Promise<unknown> {
  const url = new URL(path, config.baseUrl);
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new LiteRtProviderError("timeout", `${url.pathname} timed out`));
    }, config.timeoutMs);
  });

  try {
    const response = await Promise.race([
      config.fetch(url, {
        method: init.method,
        headers: {
          accept: "application/json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...(config.apiKey === undefined
            ? {}
            : { authorization: `Bearer ${config.apiKey}` }),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: controller.signal,
      }),
      timeout,
    ]);
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch (error) {
      throw new LiteRtProviderError(
        "invalid_response",
        `${url.pathname} returned non-JSON HTTP ${response.status}`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new LiteRtProviderError(
        "http_error",
        `${url.pathname} returned HTTP ${response.status}`,
        { status: response.status },
      );
    }
    return body;
  } catch (error) {
    if (error instanceof LiteRtProviderError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new LiteRtProviderError("timeout", `${url.pathname} timed out`, { cause: error });
    }
    throw new LiteRtProviderError("http_error", `${url.pathname} request failed`, {
      cause: error,
    });
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

function resolveModel(configured: string | undefined, models: readonly LiteRtModel[]): string {
  if (configured !== undefined) {
    if (!models.some((model) => model.id === configured)) {
      throw new LiteRtProviderError(
        "configuration_error",
        `configured model ${configured} is not returned by /v1/models`,
      );
    }
    return configured;
  }
  const first = models[0];
  if (!first) {
    throw new LiteRtProviderError("invalid_response", "/v1/models returned no models");
  }
  return first.id;
}

function parseToolName(value: string): LiteRtAgentToolName {
  if ((LITERT_AGENT_TOOL_NAMES as readonly string[]).includes(value)) {
    return value as LiteRtAgentToolName;
  }
  throw new LiteRtProviderError("unknown_tool", `model requested unknown tool: ${value}`);
}

function parseToolArguments(name: string, serialized: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new LiteRtProviderError("invalid_tool_arguments", `${name} arguments are not JSON`, {
      cause: error,
    });
  }
  if (!isPlainRecord(value)) {
    throw new LiteRtProviderError("invalid_tool_arguments", `${name} arguments must be an object`);
  }

  if (name === "list_daw_targets") {
    if (Object.keys(value).length !== 0) {
      throw new LiteRtProviderError(
        "invalid_tool_arguments",
        "list_daw_targets accepts no arguments",
      );
    }
  } else if (name === "inspect_session") {
    const keys = Object.keys(value);
    if (
      keys.length !== 1 ||
      keys[0] !== "dawId" ||
      (value.dawId !== "nanodaw" && value.dawId !== "bitwig")
    ) {
      throw new LiteRtProviderError(
        "invalid_tool_arguments",
        "inspect_session requires exactly one dawId: nanodaw or bitwig",
      );
    }
  }
  return value;
}

async function invokeHandler(name: LiteRtAgentToolName, invoke: () => unknown): Promise<unknown> {
  try {
    return await invoke();
  } catch (error) {
    throw new LiteRtProviderError("handler_error", `${name} handler failed`, { cause: error });
  }
}

function serializeToolResult(name: LiteRtAgentToolName, value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("result is not JSON serializable");
    }
    return serialized;
  } catch (error) {
    throw new LiteRtProviderError("handler_error", `${name} handler returned non-JSON data`, {
      cause: error,
    });
  }
}

function toRequestToolCall(call: LiteRtToolCall): {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
} {
  return {
    id: call.id,
    type: "function",
    function: { name: call.function.name, arguments: call.function.arguments },
  };
}

function invalidResponse(message: string): LiteRtProviderError {
  return new LiteRtProviderError("invalid_response", message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}
