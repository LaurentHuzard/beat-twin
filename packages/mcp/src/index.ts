import {
  SONG_PATCH_V2_JSON_SCHEMA,
  compileSongPatch,
  previewSongPatch,
  safeValidateSongPatchV2,
  type SongPatchPreview,
  type SongPatchV2,
} from "@beat-twin/agent-contract";
import { BUILT_IN_INSTRUMENTS } from "@beat-twin/core";
import {
  validateDawCapabilities,
  validateDawSnapshot,
  type DawAdapter,
  type ExecutablePlan,
} from "@beat-twin/daw-contract";
import {
  deriveRequiredCommandScopes,
  GatewayPlanStore,
  MAX_PAIRING_TTL_MS,
  PairingAuthority,
} from "@beat-twin/gateway-core";
import {
  BoundedRetentionMap,
  type RetentionClock,
  type RetentionPolicy,
  type RetentionStore,
} from "@beat-twin/retention";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export const NANODAW_MCP_TOOL_NAMES = Object.freeze([
  "nanodaw_list_instruments",
  "nanodaw_inspect",
  "nanodaw_prepare_instrument_clip",
] as const);

const INTERNAL_SCOPES = Object.freeze(["plan.create", "song.write"]);

export type NanoDawMcpReview = {
  readonly patch: SongPatchV2;
  readonly preview: SongPatchPreview;
  readonly plan: ExecutablePlan;
};

export type NanoDawMcpServiceOptions = {
  readonly adapter: DawAdapter;
  readonly pairing: PairingAuthority;
  readonly planStore: GatewayPlanStore;
  readonly idGenerator?: () => string;
  readonly clock?: RetentionClock;
  readonly reviewRetention?: Partial<RetentionPolicy>;
  readonly reviewStore?: RetentionStore<string, NanoDawMcpReview>;
};

export type NanoDawMcpService = {
  readonly listInstruments: () => readonly Readonly<Record<string, string>>[];
  readonly inspect: () => Promise<unknown>;
  readonly prepareInstrumentClip: (input: unknown) => Promise<NanoDawMcpReview>;
  readonly getReview: (planId: string) => NanoDawMcpReview | null;
  readonly retentionStatus: () => Readonly<{ reviews: number; capacity: number }>;
};

export const DEFAULT_MCP_REVIEW_RETENTION = Object.freeze({
  capacity: 2_048,
  ttlMs: 2 * 60 * 1_000,
} satisfies RetentionPolicy);

export async function createNanoDawMcpService(
  options: NanoDawMcpServiceOptions,
): Promise<NanoDawMcpService> {
  const idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
  const grant = await options.pairing.issue({
    actorId: "nanodaw-mcp",
    scopes: INTERNAL_SCOPES,
    ttlMs: MAX_PAIRING_TTL_MS,
    maxRequests: 10_000,
  });
  const reviews = new BoundedRetentionMap<string, NanoDawMcpReview>({
    name: "NanoDAW MCP reviews",
    policy: { ...DEFAULT_MCP_REVIEW_RETENTION, ...options.reviewRetention },
    clock: options.clock,
    store: options.reviewStore,
    expiresAt: (review) => Date.parse(review.plan.expiresAt),
  });
  const pendingReviewPlanIds = new Set<string>();

  return Object.freeze({
    listInstruments: () => BUILT_IN_INSTRUMENTS,
    inspect: async () => options.adapter.inspect(),
    prepareInstrumentClip: async (input: unknown) => {
      const validation = safeValidateSongPatchV2(input);
      if (!validation.ok) {
        const first = validation.issues[0];
        throw new TypeError(first ? `${first.path}: ${first.message}` : "Invalid SongPatchV2");
      }

      const [capabilities, snapshot] = await Promise.all([
        options.adapter.capabilities(),
        options.adapter.inspect(),
      ]);
      requireValid(validateDawCapabilities(capabilities, "nanodaw"), "NanoDAW capabilities");
      requireValid(
        validateDawSnapshot(snapshot, "nanodaw", capabilities.capabilityVersion),
        "NanoDAW snapshot",
      );

      const requestId = `mcp-${idGenerator()}`;
      const planId = `plan-${idGenerator()}`;
      try {
        reviews.assertCanAdd(planId, pendingReviewPlanIds.size);
      } catch (error) {
        throw new Error(`MCP review retention unavailable: ${errorMessage(error)}`);
      }
      pendingReviewPlanIds.add(planId);
      try {
        const compileOptions = { idSeed: requestId, snapshot: snapshot.commandSnapshot };
        const commands = compileSongPatch(validation.value, compileOptions);
        const preview = previewSongPatch(validation.value, compileOptions);
        const requiredScopes = deriveRequiredCommandScopes(commands);
        requireSupported(capabilities.supportedCommands, commands.map((command) => command.type));
        requireSupported(capabilities.scopes, requiredScopes);

        const plan = await options.planStore.createPlan({
          token: grant.token,
          plan: {
            planId,
            requestId,
            adapterId: "nanodaw",
            capabilityVersion: capabilities.capabilityVersion,
            baseRevision: snapshot.commandSnapshot.revision,
            commands,
            requiredScopes,
          },
        });
        const review = deepFreeze({ patch: validation.value, preview, plan });
        try {
          reviews.set(plan.planId, review);
        } catch (error) {
          throw new Error(`MCP review retention unavailable: ${errorMessage(error)}`);
        }
        return review;
      } finally {
        pendingReviewPlanIds.delete(planId);
      }
    },
    getReview: (planId: string) => reviews.get(planId) ?? null,
    retentionStatus: () => Object.freeze({ reviews: reviews.size, capacity: reviews.capacity }),
  });
}

export function getNanoDawMcpToolDefinitions() {
  return [
    {
      name: "nanodaw_list_instruments",
      description: "List the bounded built-in NanoDAW instrument catalog.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: {
        title: "List NanoDAW instruments",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "nanodaw_inspect",
      description: "Inspect the connected browser-owned NanoDAW song without mutation.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: {
        title: "Inspect NanoDAW",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "nanodaw_prepare_instrument_clip",
      description:
        "Prepare one exact built-in instrument track and MIDI clip plan. This tool cannot confirm or execute the plan; the user must review and apply it in NanoDAW.",
      inputSchema: SONG_PATCH_V2_JSON_SCHEMA,
      annotations: {
        title: "Prepare NanoDAW instrument clip",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
  ];
}

export function createNanoDawMcpServer(service: NanoDawMcpService): Server {
  const server = new Server(
    { name: "beat-twin-nanodaw", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getNanoDawMcpToolDefinitions(),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = request.params.arguments ?? {};
      if (request.params.name === "nanodaw_list_instruments") {
        requireEmptyArgs(args);
        return toolResult({ instruments: service.listInstruments() });
      }
      if (request.params.name === "nanodaw_inspect") {
        requireEmptyArgs(args);
        return toolResult({ session: await service.inspect() });
      }
      if (request.params.name === "nanodaw_prepare_instrument_clip") {
        const review = await service.prepareInstrumentClip(args);
        return toolResult({
          planId: review.plan.planId,
          reviewPath: `/v1/mcp/plans/${encodeURIComponent(review.plan.planId)}`,
          message: "Prepared only. Load this plan in NanoDAW for human review and confirmation.",
          preview: review.preview,
          plan: review.plan,
        });
      }
      throw new Error(`Unknown NanoDAW MCP tool: ${request.params.name}`);
    } catch (error) {
      return toolError(error);
    }
  });

  return server;
}

function requireEmptyArgs(value: unknown): void {
  if (!isRecord(value) || Object.keys(value).length > 0) {
    throw new TypeError("Tool arguments must be an empty object");
  }
}

function requireValid(
  validation: { readonly ok: boolean; readonly error?: { readonly message: string } },
  label: string,
): void {
  if (!validation.ok) throw new Error(`${label} are invalid: ${validation.error?.message ?? "unknown error"}`);
}

function requireSupported(available: readonly string[], requested: readonly string[]): void {
  const supported = new Set(available);
  const missing = requested.find((value) => !supported.has(value));
  if (missing) throw new Error(`NanoDAW does not support ${missing}`);
}

function toolResult(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: "tool_call_failed", message }) }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
