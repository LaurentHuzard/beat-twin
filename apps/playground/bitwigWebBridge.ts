import {
  getToolDefinitions,
  handleToolCall,
} from "../../index.js";

const WEB_TRANSPORT_TOOLS = Object.freeze([
  "transport_restart",
  "transport_play",
  "transport_stop",
]);

type BitwigCall = (
  method: string,
  params?: readonly unknown[],
  options?: { readonly requiresAuthentication?: boolean },
) => Promise<unknown>;

type BridgeEnvironment = Readonly<Record<string, string | undefined>>;

type ToolDefinition = {
  readonly name: string;
  readonly description: string;
};

type ToolResponse = {
  readonly content?: readonly { readonly text?: string }[];
  readonly isError?: boolean;
};

export class BitwigWebBridgeError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "BitwigWebBridgeError";
    this.status = status;
    this.code = code;
  }
}

function parseToolResponse(response: ToolResponse): unknown {
  const text = response.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new BitwigWebBridgeError(
      502,
      "invalid_mcp_response",
      "The current MCP bridge returned no JSON payload.",
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new BitwigWebBridgeError(
      502,
      "invalid_mcp_response",
      "The current MCP bridge returned malformed JSON.",
    );
  }
}

function readPolicy(description: string): string {
  return /^\[policy:([^\]]+)]/.exec(description)?.[1] ?? "unknown";
}

export function createBitwigWebBridge({
  env = process.env,
  call,
}: {
  readonly env?: BridgeEnvironment;
  readonly call?: BitwigCall;
} = {}) {
  const requestOptions = call ? { env, call } : { env };

  function visibleTransportTools(): readonly ToolDefinition[] {
    const definitions = getToolDefinitions({ env }) as readonly ToolDefinition[];
    return definitions.filter((tool) => WEB_TRANSPORT_TOOLS.includes(tool.name));
  }

  return {
    async inspect() {
      const response = (await handleToolCall(
        {
          params: {
            name: "bitwig_session_inspect",
            arguments: {},
          },
        },
        requestOptions,
      )) as ToolResponse;
      const session = parseToolResponse(response);

      if (response.isError) {
        throw new BitwigWebBridgeError(
          502,
          "inspection_failed",
          "The current MCP bridge could not inspect Bitwig.",
        );
      }

      return {
        bridge: {
          scope: "loopback",
          sessionTool: "bitwig_session_inspect",
        },
        commands: visibleTransportTools().map((tool) => ({
          name: tool.name,
          policy: readPolicy(tool.description),
        })),
        session,
      };
    },

    async execute(input: unknown) {
      if (!input || typeof input !== "object") {
        throw new BitwigWebBridgeError(400, "invalid_request", "A JSON command is required.");
      }

      const { tool, arguments: args, confirmation } = input as {
        readonly tool?: unknown;
        readonly arguments?: unknown;
        readonly confirmation?: unknown;
      };

      if (typeof tool !== "string" || !WEB_TRANSPORT_TOOLS.includes(tool)) {
        throw new BitwigWebBridgeError(
          400,
          "unsupported_web_command",
          "The web controller only accepts its bounded transport command set.",
        );
      }

      if (confirmation !== tool) {
        throw new BitwigWebBridgeError(
          409,
          "confirmation_required",
          `Confirm ${tool} explicitly before executing it.`,
        );
      }

      const enabledTool = visibleTransportTools().find((candidate) => candidate.name === tool);
      if (!enabledTool) {
        throw new BitwigWebBridgeError(
          403,
          "policy_blocked",
          `The current MCP write policy does not expose ${tool}.`,
        );
      }

      const response = (await handleToolCall(
        {
          params: {
            name: tool,
            arguments: args && typeof args === "object" ? args : {},
          },
        },
        requestOptions,
      )) as ToolResponse;
      const result = parseToolResponse(response);

      if (response.isError) {
        const message =
          result && typeof result === "object" && "message" in result
            ? String(result.message)
            : `The MCP bridge rejected ${tool}.`;
        throw new BitwigWebBridgeError(409, "command_failed", message);
      }

      return { ok: true, tool, result };
    },
  };
}

export const bitwigWebTransportTools = WEB_TRANSPORT_TOOLS;
