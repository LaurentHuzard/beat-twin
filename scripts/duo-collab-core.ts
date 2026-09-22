import { createHash } from "node:crypto";

export type DuoAgentId = "mue" | "android";
export type DuoPhase = "independent" | "challenge" | "synthesis";

export type DuoEndpoint = {
  readonly id: DuoAgentId;
  readonly role: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
};

export type DuoTurn = {
  readonly phase: DuoPhase;
  readonly agent: DuoAgentId;
  readonly role: string;
  readonly model: string;
  readonly content: string;
  readonly latencyMs: number;
};

export type DuoTranscript = {
  readonly schemaVersion: "beat-twin.duo.v1";
  readonly task: string;
  readonly witnessEvidenceSha256: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly turns: readonly DuoTurn[];
  readonly finalSynthesis: string;
};

export type DuoRunInput = {
  readonly task: string;
  readonly witnessEvidence: string;
  readonly mue: DuoEndpoint;
  readonly android: DuoEndpoint;
};

export type DuoRunOptions = {
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
};

export class DuoCollaborationError extends Error {
  readonly code:
    | "configuration_error"
    | "provider_http_error"
    | "provider_timeout"
    | "provider_invalid_response";

  constructor(
    code: DuoCollaborationError["code"],
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DuoCollaborationError";
    this.code = code;
  }
}

const MUE_SYSTEM = [
  "You are MUE, the analyst in a two-agent collaboration experiment.",
  "Use only evidence present in your messages. Never invent observations.",
  "Do not expose private chain-of-thought. Return a concise decision record with:",
  "CLAIM, EVIDENCE, UNCERTAINTY, NEXT_CHECK.",
].join(" ");

const ANDROID_SYSTEM = [
  "You are the Android witness/scout in a two-agent collaboration experiment.",
  "Treat the witness evidence in your user message as your local observation.",
  "Use only evidence present in your messages. Never invent observations.",
  "Do not expose private chain-of-thought. Return a concise decision record with:",
  "CLAIM, EVIDENCE, UNCERTAINTY, NEXT_CHECK.",
].join(" ");

export async function runDuoCollaboration(
  input: DuoRunInput,
  options: DuoRunOptions = {},
): Promise<DuoTranscript> {
  validateInput(input);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new DuoCollaborationError("configuration_error", "no fetch implementation is available");
  }
  const now = options.now ?? (() => performance.now());
  const startedAt = new Date().toISOString();

  const [mueInitial, androidInitial] = await Promise.all([
    complete(
      input.mue,
      [
        { role: "system", content: MUE_SYSTEM },
        {
          role: "user",
          content: [
            "PHASE: independent",
            "Answer before seeing the Android agent response.",
            "TASK:\n" + input.task,
            "You do not have the Android-only witness evidence yet. Say so when it matters.",
          ].join("\n\n"),
        },
      ],
      fetchImpl,
      now,
    ),
    complete(
      input.android,
      [
        { role: "system", content: ANDROID_SYSTEM },
        {
          role: "user",
          content: [
            "PHASE: independent",
            "Answer before seeing the MUE response.",
            "TASK:\n" + input.task,
            "ANDROID-ONLY WITNESS EVIDENCE:\n" + input.witnessEvidence,
          ].join("\n\n"),
        },
      ],
      fetchImpl,
      now,
    ),
  ]);

  const [mueChallenge, androidChallenge] = await Promise.all([
    complete(
      input.mue,
      [
        { role: "system", content: MUE_SYSTEM },
        {
          role: "user",
          content: [
            "PHASE: challenge",
            "TASK:\n" + input.task,
            "YOUR INITIAL RESPONSE:\n" + mueInitial.content,
            "ANDROID INITIAL RESPONSE:\n" + androidInitial.content,
            "Challenge the peer response. State what you ACCEPT, CHALLENGE, still consider MISSING, and whether you REVISE your claim.",
          ].join("\n\n"),
        },
      ],
      fetchImpl,
      now,
    ),
    complete(
      input.android,
      [
        { role: "system", content: ANDROID_SYSTEM },
        {
          role: "user",
          content: [
            "PHASE: challenge",
            "TASK:\n" + input.task,
            "YOUR INITIAL RESPONSE:\n" + androidInitial.content,
            "MUE INITIAL RESPONSE:\n" + mueInitial.content,
            "Challenge the peer response. State what you ACCEPT, CHALLENGE, still consider MISSING, and whether you REVISE your claim.",
          ].join("\n\n"),
        },
      ],
      fetchImpl,
      now,
    ),
  ]);

  const synthesis = await complete(
    input.mue,
    [
      {
        role: "system",
        content: [
          MUE_SYSTEM,
          "You are now the synthesizer, not an authority.",
          "Preserve explicit disagreement and missing evidence instead of smoothing it away.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          "PHASE: synthesis",
          "TASK:\n" + input.task,
          "MUE INITIAL:\n" + mueInitial.content,
          "ANDROID INITIAL:\n" + androidInitial.content,
          "MUE CHALLENGE:\n" + mueChallenge.content,
          "ANDROID CHALLENGE:\n" + androidChallenge.content,
          "Produce FINAL, SUPPORTING_EVIDENCE, REMAINING_DISAGREEMENTS, and NEXT_TEST.",
        ].join("\n\n"),
      },
    ],
    fetchImpl,
    now,
  );

  const turns: DuoTurn[] = [
    toTurn("independent", input.mue, mueInitial),
    toTurn("independent", input.android, androidInitial),
    toTurn("challenge", input.mue, mueChallenge),
    toTurn("challenge", input.android, androidChallenge),
    toTurn("synthesis", input.mue, synthesis),
  ];

  return Object.freeze({
    schemaVersion: "beat-twin.duo.v1" as const,
    task: input.task,
    witnessEvidenceSha256: createHash("sha256").update(input.witnessEvidence).digest("hex"),
    startedAt,
    completedAt: new Date().toISOString(),
    turns: Object.freeze(turns),
    finalSynthesis: synthesis.content,
  });
}

export function resolveChatCompletionUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    throw new DuoCollaborationError("configuration_error", "provider baseUrl must be a valid URL", {
      cause: error,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DuoCollaborationError("configuration_error", "provider baseUrl must use http or https");
  }
  if (url.username || url.password) {
    throw new DuoCollaborationError("configuration_error", "provider baseUrl must not contain credentials");
  }

  const cleanPath = url.pathname.replace(/\/+$/, "");
  url.pathname = cleanPath.endsWith("/v1")
    ? cleanPath + "/chat/completions"
    : cleanPath + "/v1/chat/completions";
  url.search = "";
  url.hash = "";
  return url;
}

type ChatMessage = {
  readonly role: "system" | "user";
  readonly content: string;
};

type Completion = {
  readonly model: string;
  readonly content: string;
  readonly latencyMs: number;
};

async function complete(
  endpoint: DuoEndpoint,
  messages: readonly ChatMessage[],
  fetchImpl: typeof globalThis.fetch,
  now: () => number,
): Promise<Completion> {
  const url = resolveChatCompletionUrl(endpoint.baseUrl);
  const controller = new AbortController();
  const timeoutMs = endpoint.timeoutMs ?? 60_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = now();

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(endpoint.apiKey === undefined
          ? {}
          : { authorization: "Bearer " + endpoint.apiKey }),
      },
      body: JSON.stringify({
        model: endpoint.model,
        temperature: 0,
        max_tokens: endpoint.maxTokens ?? 600,
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new DuoCollaborationError(
        "provider_http_error",
        endpoint.id + " provider returned HTTP " + response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new DuoCollaborationError(
        "provider_invalid_response",
        endpoint.id + " provider returned non-JSON content",
        { cause: error },
      );
    }

    const parsed = parseCompletion(payload, endpoint);
    return {
      ...parsed,
      latencyMs: Math.max(0, Math.round(now() - start)),
    };
  } catch (error) {
    if (error instanceof DuoCollaborationError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new DuoCollaborationError(
        "provider_timeout",
        endpoint.id + " provider timed out after " + timeoutMs + " ms",
        { cause: error },
      );
    }
    throw new DuoCollaborationError(
      "provider_http_error",
      endpoint.id + " provider request failed",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseCompletion(payload: unknown, endpoint: DuoEndpoint): Omit<Completion, "latencyMs"> {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new DuoCollaborationError(
      "provider_invalid_response",
      endpoint.id + " provider response has no choices",
    );
  }
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new DuoCollaborationError(
      "provider_invalid_response",
      endpoint.id + " provider choice is malformed",
    );
  }
  const content = choice.message.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new DuoCollaborationError(
      "provider_invalid_response",
      endpoint.id + " provider returned no textual content",
    );
  }
  return {
    model: typeof payload.model === "string" && payload.model.trim().length > 0
      ? payload.model
      : endpoint.model,
    content: content.trim(),
  };
}

function toTurn(
  phase: DuoPhase,
  endpoint: DuoEndpoint,
  completion: Completion,
): DuoTurn {
  return Object.freeze({
    phase,
    agent: endpoint.id,
    role: endpoint.role,
    model: completion.model,
    content: completion.content,
    latencyMs: completion.latencyMs,
  });
}

function validateInput(input: DuoRunInput): void {
  if (!isRecord(input) || !nonBlank(input.task) || !nonBlank(input.witnessEvidence)) {
    throw new DuoCollaborationError(
      "configuration_error",
      "task and witnessEvidence must be non-empty strings",
    );
  }
  validateEndpoint(input.mue, "mue");
  validateEndpoint(input.android, "android");
}

function validateEndpoint(endpoint: DuoEndpoint, expectedId: DuoAgentId): void {
  if (!isRecord(endpoint) || endpoint.id !== expectedId) {
    throw new DuoCollaborationError(
      "configuration_error",
      expectedId + " endpoint must use id " + expectedId,
    );
  }
  if (!nonBlank(endpoint.role) || !nonBlank(endpoint.baseUrl) || !nonBlank(endpoint.model)) {
    throw new DuoCollaborationError(
      "configuration_error",
      expectedId + " endpoint role, baseUrl and model are required",
    );
  }
  if (
    endpoint.timeoutMs !== undefined &&
    (!Number.isSafeInteger(endpoint.timeoutMs) || endpoint.timeoutMs <= 0)
  ) {
    throw new DuoCollaborationError(
      "configuration_error",
      expectedId + " timeoutMs must be a positive integer",
    );
  }
  if (
    endpoint.maxTokens !== undefined &&
    (!Number.isSafeInteger(endpoint.maxTokens) || endpoint.maxTokens <= 0)
  ) {
    throw new DuoCollaborationError(
      "configuration_error",
      expectedId + " maxTokens must be a positive integer",
    );
  }
  resolveChatCompletionUrl(endpoint.baseUrl);
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
