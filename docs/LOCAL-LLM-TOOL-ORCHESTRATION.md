# Local LLM Tool Orchestration

## Decision

Beat Twin becomes the stable orchestration boundary between an LLM and one or more DAWs.

The LLM does not target Bitwig, Ableton, Ardour, or the browser mini-DAW directly. It selects typed Beat Twin tools. Beat Twin validates the call, applies policy, executes it through a DAW adapter, and returns a structured result to the model.

```text
User
  -> local or remote LLM
  -> OpenAI-compatible tool call
  -> Beat Twin tool gateway
  -> policy + validation + preview
  -> DAW adapter
  -> Bitwig | mini-DAW | Ableton | Ardour
```

The first validated runtime is LiteRT-LM running Gemma 4 E2B on Android and exposed on the local network through its OpenAI-compatible server. The architecture must not depend on LiteRT-LM or Gemma: any provider able to emit OpenAI-style tool calls can use the same gateway.

## Why This Shape

- Keeps prompts and musical intents independent from a specific DAW.
- Reuses Beat Twin's existing tool descriptions and write-policy gates.
- Avoids parsing free-form prose or prompt-enforced JSON.
- Allows local, offline orchestration from a phone without moving the DAW runtime.
- Preserves a plan-only and read-only default.
- Makes adapter capability differences explicit instead of hiding them in prompts.

## Core Boundaries

### 1. LLM Provider

A provider sends chat messages and Beat Twin tool definitions to an OpenAI-compatible endpoint.

Initial providers:

- `litert-lm`: Gemma on Android, accessed over LAN or a trusted tunnel.
- `openai-compatible`: generic endpoint for llama.cpp, Ollama-compatible bridges, hosted services, or future runtimes.

Provider configuration is data, not architecture:

```ts
export type LlmProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
};
```

### 2. Beat Twin Tool Gateway

The gateway owns the agent loop:

1. Build the model-visible tool catalogue from Beat Twin tool definitions.
2. Send messages and tools to the provider.
3. Parse returned `tool_calls`.
4. Validate every function name and argument object.
5. Apply read/write policy before execution.
6. Dispatch through the selected DAW adapter.
7. Append structured tool results to the conversation.
8. Continue until the model returns a final answer or the loop limit is reached.

The gateway must reject:

- unknown tools;
- malformed JSON arguments;
- calls unsupported by the selected adapter;
- writes not enabled by policy;
- excessive tool-call loops;
- calls that exceed configured batch or note limits.

### 3. Canonical Tool Registry

The existing `TOOL_SPECS` registry is the current source of truth for the Bitwig MCP surface and its policy classification. It should be extracted behind a reusable module instead of duplicated for LLM tool calling.

Target shape:

```text
packages/tool-registry
  -> canonical names
  -> JSON schemas
  -> descriptions
  -> read/write policy classes
  -> capability tags

MCP server
  -> consumes tool-registry

LLM tool gateway
  -> consumes tool-registry

DAW adapters
  -> declare supported capabilities
```

The initial slice may expose only a narrow subset even though the registry contains more tools.

### 4. DAW Adapter

Adapters translate canonical Beat Twin commands into runtime-specific operations.

```ts
export interface DawAdapter {
  readonly id: string;
  readonly capabilities: ReadonlySet<string>;
  execute(call: ValidatedToolCall): Promise<ToolExecutionResult>;
}
```

Initial adapters:

- `bitwig`: wraps the current JSON-RPC bridge.
- `playground`: applies commands to the browser mini-DAW song model.

Future adapters:

- `ableton`
- `ardour`

An adapter must not silently emulate unsupported behavior. It returns a typed `unsupported_capability` result.

## First Tool Surface

Do not expose all existing tools to Gemma on day one. Start with a compact, observable musical surface:

### Read

- `session_get_snapshot`
- `transport_get_state`
- `track_list`
- `clip_get_info`

### Plan

- `arrangement_create_plan`

### Narrow writes

- `transport_set_tempo`
- `track_create`
- `clip_create`
- `clip_add_notes`
- `transport_play`
- `transport_stop`

Exact names may be mapped to existing canonical tools during implementation. The important constraint is a small catalogue with stable schemas.

## Safety Model

Local does not mean trusted.

- Read-only and plan-only remain the default.
- Model-visible write tools are filtered by the active policy before the request is sent.
- Every returned call is checked again before dispatch.
- Destructive or broad writes require explicit user approval or a future confirmation boundary.
- Tool results include the selected adapter, policy class, normalized arguments, and execution status.
- The Android endpoint should stay on a trusted LAN or behind a tunnel. It must not be exposed directly to the public internet.
- A maximum iteration count prevents recursive tool-call spirals.

## Minimal Agent Loop

```ts
for (let step = 0; step < maxSteps; step += 1) {
  const response = await provider.complete({
    messages,
    tools: registry.forPolicy(policy, adapter.capabilities),
  });

  if (!response.toolCalls.length) {
    return response.message;
  }

  for (const rawCall of response.toolCalls) {
    const call = registry.validate(rawCall);
    policy.assertAllowed(call);
    const result = await adapter.execute(call);
    messages.push(asToolResultMessage(call, result));
  }
}

throw new Error("Agent tool loop exceeded its configured limit");
```

## Android Development Topology

```text
Samsung S25
  LiteRT-LM
  Gemma 4 E2B
  http://PHONE_IP:9379/v1
        |
        | trusted Wi-Fi or tunnel
        v
Laptop
  Beat Twin agent gateway
  Bitwig adapter or playground adapter
        |
        v
DAW
```

Suggested local provider configuration:

```env
BEAT_TWIN_LLM_BASE_URL=http://192.168.x.x:9379/v1
BEAT_TWIN_LLM_MODEL=gemma4-e2b
BEAT_TWIN_LLM_API_KEY=local-unused
BEAT_TWIN_AGENT_MAX_STEPS=8
BEAT_TWIN_DAW_ADAPTER=bitwig
```

The phone only performs inference. Beat Twin remains on the laptop, close to the DAW and its trusted-local control bridge.

## Delivery Slices

### Slice 0: Contract and fixtures

- Capture the successful Gemma tool-call response as a fixture.
- Define normalized provider response and tool-call types.
- Add validation tests for valid, malformed, unknown, and policy-blocked calls.

### Slice 1: Provider client

- Add an OpenAI-compatible chat client with configurable base URL and model.
- Support non-streaming tool calls first.
- Keep API-key handling optional for local endpoints.

### Slice 2: Reusable tool registry

- Extract reusable schemas and policy metadata from `TOOL_SPECS`.
- Keep MCP behavior backward-compatible.
- Export an OpenAI tool-definition projection.

### Slice 3: Agent loop

- Implement bounded multi-turn tool execution.
- Add structured logs and tool-result messages.
- Default to read-only or plan-only.

### Slice 4: Bitwig vertical slice

- Connect the agent loop to the existing Bitwig JSON-RPC bridge.
- Validate one read flow and one narrowly enabled write flow.
- Add a manual smoke checklist using Gemma 4 E2B on Android.

### Slice 5: Mini-DAW adapter

- Execute the same canonical intent against the Playground song model.
- Demonstrate that one prompt can target Bitwig or the mini-DAW by configuration only.

## Acceptance Scenario

Given Gemma 4 E2B running through LiteRT-LM on the phone, and Beat Twin running on the laptop:

1. The user asks: `Create a four-bar broken techno groove at 138 BPM.`
2. Gemma emits one or more canonical Beat Twin tool calls.
3. Beat Twin validates and previews the calls.
4. With write policy disabled, no DAW mutation occurs and the user receives the required policy classes.
5. With the narrow policy enabled, the selected adapter executes the groove.
6. Changing `BEAT_TWIN_DAW_ADAPTER` switches between Bitwig and the mini-DAW without changing the user prompt or LLM provider.

## Non-Goals

- No direct Gemma-to-Bitwig coupling.
- No public unauthenticated mobile inference endpoint.
- No automatic exposure of every MCP tool.
- No silent fallback from unsupported adapter operations.
- No autonomous unbounded composition loop.
- No replacement of MCP. MCP and LLM tool calling are two projections over the same Beat Twin capability layer.
