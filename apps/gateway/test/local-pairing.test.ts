import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { GatewayPlanStore, PairingAuthority } from "@beat-twin/gateway-core";
import { listenGatewayHttp } from "../src/index.js";

const origin = "http://beat-twin.orbit";
test("local pairing needs no secret, rejects cross-origin and rebound-host requests, and retains token gates", async t => {
  const pairing = new PairingAuthority({ audit: () => {} });
  const server = await listenGatewayHttp({ pairingMode: "local", pairing,
    planStore: new GatewayPlanStore({ pairing, audit: () => {}, policy: () => true }), adapters: new Map([["nanodaw", { id: "nanodaw",
      health: async () => ({ adapterId: "nanodaw", status: "unavailable" }),
      capabilities: async () => ({}), inspect: async () => ({}), execute: async () => { throw new Error("must not execute"); },
    }]]), corsOrigins: [origin],
    provider: { runAgent: async () => { throw new Error("must not run"); }, listModels: async () => [] },
  }, { host: "127.0.0.1", port: 0 });
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pair = (headers: Record<string, string>, body = {}) => fetch(`${base}/v1/pair`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await pair({})).status, 403);
  assert.equal((await pair({ origin: "http://evil.example" })).status, 403);
  assert.equal((await pair({ origin: "null" })).status, 403);
  const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${base}/v1/pair`, { method: "POST", headers: {
      origin, host: "evil.example", "content-type": "application/json",
    } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    req.on("error", reject); req.end("{}");
  });
  assert.equal(reboundStatus, 403);
  assert.equal((await pair({ origin }, { scopes: ["*"] })).status, 400);
  assert.equal((await pair({ origin }, { operatorSecret: "unused" })).status, 400);
  assert.equal((await fetch(`${base}/v1/health`, { headers: { origin } })).status, 401);
  const response = await pair({ origin }, { actorId: "local-browser" });
  assert.equal(response.status, 201);
  const grant = await response.json(); assert.ok(grant.token);
  assert.equal((await fetch(`${base}/v1/health`, { headers: { origin, authorization: `Bearer ${grant.token}` } })).status, 200);
});
