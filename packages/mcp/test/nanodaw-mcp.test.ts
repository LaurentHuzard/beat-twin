import assert from "node:assert/strict";
import test from "node:test";

import type { DawAdapter } from "@beat-twin/daw-contract";
import { GatewayPlanStore, PairingAuthority } from "@beat-twin/gateway-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  NANODAW_MCP_TOOL_NAMES,
  createNanoDawMcpServer,
  createNanoDawMcpService,
  getNanoDawMcpToolDefinitions,
} from "../src/index.ts";

const PATCH = Object.freeze({
  schemaVersion: 2,
  tempoBpm: 118,
  track: Object.freeze({
    kind: "instrument",
    name: "Night Bass",
    instrumentId: "bass",
    clip: Object.freeze({
      name: "Verse",
      lengthBeats: 4,
      notes: Object.freeze([
        Object.freeze({ pitch: 36, velocity: 110, startBeat: 0, lengthBeats: 1 }),
      ]),
    }),
  }),
});

function fixture() {
  const pairing = new PairingAuthority({ audit: () => undefined });
  const planStore = new GatewayPlanStore({
    pairing,
    audit: () => undefined,
    policy: (plan) => plan.adapterId === "nanodaw",
  });
  let executions = 0;
  const adapter: DawAdapter = {
    id: "nanodaw",
    health: async () => ({
      adapterId: "nanodaw",
      status: "healthy",
      checkedAt: "2026-07-18T12:00:00.000Z",
    }),
    capabilities: async () => ({
      adapterId: "nanodaw",
      capabilityVersion: "nanodaw-v2",
      supportedCommands: ["CreateSong", "CreateTrack", "CreateClip", "AddNote", "SetTempo"],
      scopes: ["song.write"],
      limitations: [],
    }),
    inspect: async () => ({
      adapterId: "nanodaw",
      capabilityVersion: "nanodaw-v2",
      observedAt: "2026-07-18T12:00:00.000Z",
      commandSnapshot: { song: null, revision: 0 },
    }),
    execute: async () => {
      executions += 1;
      throw new Error("MCP preparation must not execute the adapter");
    },
  };
  return { adapter, pairing, planStore, executions: () => executions };
}

test("publishes inspect and preparation tools without confirmation or execution", () => {
  assert.deepEqual(
    getNanoDawMcpToolDefinitions().map((tool) => tool.name),
    NANODAW_MCP_TOOL_NAMES,
  );
  assert.equal(NANODAW_MCP_TOOL_NAMES.some((name) => /confirm|execute|apply/.test(name)), false);
});

test("prepares one immutable instrument clip plan without mutating NanoDAW", async () => {
  const context = fixture();
  const ids = ["request", "plan"];
  const service = await createNanoDawMcpService({
    adapter: context.adapter,
    pairing: context.pairing,
    planStore: context.planStore,
    idGenerator: () => ids.shift() ?? "extra",
  });

  const review = await service.prepareInstrumentClip(PATCH);
  assert.equal(review.plan.planId, "plan-plan");
  assert.equal(review.plan.requestId, "mcp-request");
  assert.equal(review.plan.baseRevision, 0);
  assert.equal(review.plan.requiredScopes.includes("song.write"), true);
  assert.equal(review.plan.commands.some((command) => command.type === "CreateTrack"), true);
  assert.equal(
    review.plan.commands.some(
      (command) => command.type === "CreateTrack" && command.instrumentId === "bass",
    ),
    true,
  );
  assert.equal(review.plan.commands.some((command) => command.type === "CreateClip"), true);
  assert.equal(review.plan.commands.some((command) => command.type === "AddNote"), true);
  assert.equal(service.getReview(review.plan.planId), review);
  assert.equal(context.planStore.getExecutionStatus(review.plan.planId)?.state, "pending");
  assert.equal(context.executions(), 0);
});

test("rejects an unknown built-in instrument before creating a plan", async () => {
  const context = fixture();
  const service = await createNanoDawMcpService(context);
  await assert.rejects(
    service.prepareInstrumentClip({
      ...PATCH,
      track: { ...PATCH.track, instrumentId: "arbitrary-plugin" },
    }),
    /instrumentId/i,
  );
  assert.equal(context.executions(), 0);
});

test("uses the runtime UUID generator without losing its Crypto receiver", async () => {
  const context = fixture();
  const service = await createNanoDawMcpService(context);
  const review = await service.prepareInstrumentClip(PATCH);
  assert.match(review.plan.requestId, /^mcp-[0-9a-f-]{36}$/);
  assert.match(review.plan.planId, /^plan-[0-9a-f-]{36}$/);
  assert.equal(context.executions(), 0);
});

test("bounds MCP reviews and only frees them after the plan expiry boundary", async () => {
  const context = fixture();
  const ids = ["first-request", "first-plan", "blocked-request", "blocked-plan", "next-request", "next-plan"];
  let now = Date.now();
  const service = await createNanoDawMcpService({
    ...context,
    idGenerator: () => ids.shift() ?? "extra",
    clock: { now: () => now },
    reviewRetention: { capacity: 1, ttlMs: 120_000 },
  });
  const first = await service.prepareInstrumentClip(PATCH);
  await assert.rejects(service.prepareInstrumentClip(PATCH), /review retention.*capacity/i);
  assert.deepEqual(service.retentionStatus(), { reviews: 1, capacity: 1 });
  assert.equal(context.planStore.retentionStatus().plans, 1);

  now = Date.parse(first.plan.expiresAt);
  const next = await service.prepareInstrumentClip(PATCH);
  assert.equal(next.plan.planId, "plan-next-plan");
  assert.equal(service.getReview(first.plan.planId), null);
  assert.equal(service.retentionStatus().reviews, 1);
  assert.equal(context.executions(), 0);
});

test("serves the bounded tool surface over the MCP protocol", async () => {
  const context = fixture();
  const ids = ["protocol-request", "protocol-plan"];
  const service = await createNanoDawMcpService({
    adapter: context.adapter,
    pairing: context.pairing,
    planStore: context.planStore,
    idGenerator: () => ids.shift() ?? "protocol-extra",
  });
  const server = createNanoDawMcpServer(service);
  const client = new Client({ name: "nanodaw-mcp-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), NANODAW_MCP_TOOL_NAMES);
    const result = await client.callTool({
      name: "nanodaw_prepare_instrument_clip",
      arguments: PATCH,
    });
    assert.equal(result.isError, undefined);
    assert.equal(
      (result.structuredContent as { planId?: string } | undefined)?.planId,
      "plan-protocol-plan",
    );
    assert.equal(context.executions(), 0);
  } finally {
    await client.close();
    await server.close();
  }
});
