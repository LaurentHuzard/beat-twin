import assert from "node:assert/strict";
import test from "node:test";
import { GatewayPlanStore, PairingAuthority } from "@beat-twin/gateway-core";
import { listenGatewayHttp } from "../src/index.js";

test("pairing capacity returns 503 without evicting an authorized session", async () => {
  const pairing = new PairingAuthority({ audit: () => {}, retention: { capacity: 1 } });
  const planStore = new GatewayPlanStore({ pairing, audit: () => {}, policy: () => true });
  const unused = async () => { throw new Error("No provider or adapter call expected"); };
  const server = await listenGatewayHttp({
    operatorSecret: "synthetic retention fixture secret",
    pairing, planStore,
    provider: { listModels: unused, runAgent: unused },
    adapters: new Map([["nanodaw", {
      id: "nanodaw", health: unused, capabilities: unused, inspect: unused, execute: unused,
    }]]),
  }, { host: "127.0.0.1", port: 0 });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const pair = () => fetch(`http://127.0.0.1:${address.port}/v1/pair`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operatorSecret: "synthetic retention fixture secret" }),
    });
    const first = await pair();
    assert.equal(first.status, 201);
    const { token } = await first.json();
    const second = await pair();
    assert.equal(second.status, 503);
    assert.equal((await second.json()).error.code, "capacity_exceeded");
    await pairing.authorize(token, "gateway.read");
    assert.equal(pairing.retentionStatus().records, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
