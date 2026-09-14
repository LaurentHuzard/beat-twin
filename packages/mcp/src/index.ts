import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { ExecutableBeatTwinCommand } from "@beat-twin/commands";
import { EXTRA_DEFINITIONS, OPERATION_MAP } from "./catalog.ts";
import { createMusicalPreparation } from "./musical.ts";
import {
  SONG_PATCH_V2_JSON_SCHEMA,
  compileSongPatch,
  previewSongPatch,
  safeValidateSongPatchV2,
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
  ...EXTRA_DEFINITIONS.map((tool) => tool.name),
] as const);

const INTERNAL_SCOPES = Object.freeze(["plan.create", "song.write", "transport.write"]);

export type NanoDawMcpReview = {
  readonly patch: SongPatchV2 | null;
  readonly title?: string;
  readonly recovery?: readonly ExecutableBeatTwinCommand[];
  readonly preview: { readonly summary: readonly string[]; readonly commands: readonly ExecutableBeatTwinCommand[] };
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
  readonly status: () => Promise<unknown>;
  readonly prepareMusical: (name: string, args: Record<string, unknown>) => Promise<NanoDawMcpReview>;
  readonly executionStatus: (planId: string) => unknown;
  readonly prepareInstrumentClip: (input: unknown) => Promise<NanoDawMcpReview>;
  readonly getReview: (planId: string) => NanoDawMcpReview | null;
  readonly listReviews: () => readonly NanoDawMcpReview[];
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
  const listReviews = () => {
    const now = options.clock?.now() ?? Date.now();
    for (const [id, review] of reviews.entries()) {
      if (Date.parse(review.plan.expiresAt) <= now) reviews.delete(id);
    }
    return Object.freeze(reviews.entries().filter(([id]) => options.planStore.getExecutionStatus(id)?.state === "pending").map(([, review]) => review));
  };

  const getReview = (id: string) => reviews.get(id) ?? null;
  const reserve = (id: string) => {
    listReviews();
    if (reviews.size + pendingReviewPlanIds.size >= 32) throw new Error("MCP review inbox is full; wait for retained plans to expire");
    try { reviews.assertCanAdd(id, pendingReviewPlanIds.size); }
    catch (error) { throw new Error(`MCP review retention unavailable: ${errorMessage(error)}`); }
    pendingReviewPlanIds.add(id);
  };
  const prepareMusical = createMusicalPreparation({ options, token: grant.token, id: idGenerator, getReview, reserve,
    release: (id) => { pendingReviewPlanIds.delete(id); },
    save: (review) => { reviews.set(review.plan.planId, deepFreeze(review)); },
  });
  return Object.freeze({
    prepareMusical,
    status: async () => ({ health: await options.adapter.health(), capabilities: await options.adapter.capabilities(), confirmation: "browser-only" }),
    executionStatus: (id: string) => {
      if (!getReview(id)) throw new Error("MCP review not found or expired");
      return options.planStore.getExecutionStatus(id);
    },
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
      reserve(planId);
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
    listReviews,
    retentionStatus: () => Object.freeze({ reviews: reviews.size, capacity: reviews.capacity }),
  });
}

function legacyToolDefinitions() {
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

export function getNanoDawMcpToolDefinitions() {
  return [...legacyToolDefinitions(), ...EXTRA_DEFINITIONS];
}

export function createNanoDawMcpServer(service: NanoDawMcpService): Server {
  const server = new Server({ name: "beat-twin-nanodaw", version: "0.1.0" }, { capabilities: { tools: {} } });
  const definitions = getNanoDawMcpToolDefinitions();
  const registry = new Map(definitions.map((tool) => [tool.name, tool]));
  const validator = new AjvJsonSchemaValidator();
  const validators = new Map(definitions.map((tool) => [tool.name, validator.getValidator(tool.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0])]));
  const call = async (name: string, input: unknown): Promise<ReturnType<typeof toolResult>> => {
    const definition = registry.get(name);
    if (!definition) throw new Error(`unknown_tool: ${name}`);
    const encoded = JSON.stringify(input);
    if (!encoded || Buffer.byteLength(encoded, "utf8") > 65536) throw new Error("invalid_arguments: arguments exceed 64 KiB");
    const args = JSON.parse(encoded) as Record<string, unknown>;
    if (!validators.get(name)!(args).valid) throw new Error("invalid_arguments: input does not match tool schema");
    if (name === "search_tools") {
      const terms = ((args.query ?? "") as string).toLowerCase().trim().split(/\s+/).filter(Boolean);
      const matches = definitions.filter((tool) => !["search_tools", "call_tool"].includes(tool.name)).filter((tool) => terms.every((term) => `${tool.name} ${tool.description}`.toLowerCase().includes(term)));
      const offset = (args.offset ?? 0) as number;
      const tools = matches.slice(offset, offset + ((args.limit ?? 10) as number));
      return toolResult({ tools, total: matches.length, nextOffset: offset + tools.length < matches.length ? offset + tools.length : null });
    }
    if (name === "call_tool") {
      if (["search_tools", "call_tool"].includes(args.name as string)) throw new Error("recursive_tool_call: generic tools cannot call generic tools");
      return call(args.name as string, args.arguments ?? {});
    }
    if (name === "nanodaw_list_instruments") return toolResult({ instruments: service.listInstruments() });
    if (name === "nanodaw_inspect") return toolResult({ session: await service.inspect() });
    if (name === "nanodaw_get_status") return toolResult({ status: await service.status() });
    if (name === "nanodaw_get_execution_report") return toolResult({ execution: service.executionStatus(args.planId as string) });
    if (name === "nanodaw_get_plan") {
      const review = service.getReview(args.planId as string);
      if (!review) throw new Error("MCP review not found or expired");
      return reviewResult(review);
    }
    if (name === "nanodaw_prepare_instrument_clip") return reviewResult(await service.prepareInstrumentClip(args));
    if (OPERATION_MAP.has(name) || name === "nanodaw_prepare_batch" || name === "nanodaw_undo") return reviewResult(await service.prepareMusical(name, args));
    throw new Error(`unknown_tool: ${name}`);
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try { return await call(request.params.name, request.params.arguments ?? {}); }
    catch (error) { return toolError(error); }
  });
  return server;
}

function reviewResult(review: NanoDawMcpReview) {
  return toolResult({ planId: review.plan.planId, reviewPath: `/v1/mcp/plans/${encodeURIComponent(review.plan.planId)}`, message: "Prepared only. Load this plan in NanoDAW for human review and confirmation.", preview: review.preview, plan: review.plan, recoveryAvailable: Boolean(review.recovery?.length) });
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
  const prefix = message.split(":", 1)[0];
  const code = ["unknown_tool", "recursive_tool_call", "invalid_arguments", "stale_revision"].includes(prefix!) ? prefix : "tool_call_failed";
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }) }],
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
