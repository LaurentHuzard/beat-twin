import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createCommandRuntime, createCommandState } from "@beat-twin/commands";
import {
  BROWSER_NANODAW_PROTOCOL,
  encodeBrowserPairingProtocol,
} from "@beat-twin/gateway-http";
import { WebSocket } from "ws";

import { createNanoDawMcpRuntime } from "../src/runtime.ts";

const ORIGIN = "http://127.0.0.1:5173";
const OPERATOR_SECRET = "correct horse battery staple";
const PATCH = Object.freeze({
  schemaVersion: 2,
  tempoBpm: 118,
  track: Object.freeze({
    kind: "instrument",
    name: "Runtime Bass",
    instrumentId: "bass",
    clip: Object.freeze({
      name: "Runtime clip",
      lengthBeats: 4,
      notes: Object.freeze([
        Object.freeze({ pitch: 36, velocity: 110, startBeat: 0, lengthBeats: 1 }),
      ]),
    }),
  }),
});

test("app owns startup, review, browser CAS execution, and clean shutdown", async () => {
  const runtime = await createNanoDawMcpRuntime({
    operatorSecret: OPERATOR_SECRET,
    allowedOrigins: [ORIGIN],
    host: "127.0.0.1",
    port: 0,
  });
  const commandRuntime = createCommandRuntime(createCommandState());
  let browser: WebSocket | undefined;

  try {
    const pairing = await jsonFetch(`${runtime.baseUrl}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operatorSecret: OPERATOR_SECRET }),
    });
    assert.equal(pairing.response.status, 201);
    const token = requireString(pairing.body.token);

    browser = new WebSocket(
      `${runtime.baseUrl.replace("http://", "ws://")}/v1/browser/nanodaw`,
      [BROWSER_NANODAW_PROTOCOL, encodeBrowserPairingProtocol(token)],
      { origin: ORIGIN },
    );
    browser.on("message", (data) => {
      const request = JSON.parse(data.toString("utf8"));
      try {
        const result = request.method === "inspect"
          ? commandRuntime.inspect()
          : commandRuntime.executeCommandBatch(request.params.request);
        browser?.send(JSON.stringify({ v: 1, id: request.id, ok: true, result }));
      } catch (error) {
        browser?.send(JSON.stringify({
          v: 1,
          id: request.id,
          ok: false,
          error: { message: error instanceof Error ? error.message : String(error) },
        }));
      }
    });
    await once(browser, "open");

    const review = await runtime.service.prepareInstrumentClip(PATCH);
    const authorization = { authorization: `Bearer ${token}` };
    const loaded = await jsonFetch(
      `${runtime.baseUrl}/v1/mcp/plans/${encodeURIComponent(review.plan.planId)}`,
      { headers: authorization },
    );
    assert.equal(loaded.response.status, 200);
    assert.equal(loaded.body.plan.planId, review.plan.planId);
    assert.equal(commandRuntime.inspect().revision, 0);

    const confirmed = await jsonFetch(
      `${runtime.baseUrl}/v1/plans/${encodeURIComponent(review.plan.planId)}/confirm`,
      { method: "POST", headers: authorization },
    );
    assert.equal(confirmed.response.status, 200);
    const confirmationToken = requireString(confirmed.body.confirmationToken);

    const executed = await jsonFetch(
      `${runtime.baseUrl}/v1/plans/${encodeURIComponent(review.plan.planId)}/execute`,
      {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: JSON.stringify({ confirmationToken }),
      },
    );
    assert.equal(executed.response.status, 200);
    assert.equal(executed.body.report.status, "succeeded");
    assert.equal(executed.body.report.finalSnapshot.revision, 1);
    assert.equal(commandRuntime.inspect().revision, 1);

    const browserClosed = once(browser, "close");
    await runtime.close();
    await browserClosed;
    await runtime.close();
    await assert.rejects(() => fetch(`${runtime.baseUrl}/v1/health`));
  } finally {
    if (browser && browser.readyState !== WebSocket.CLOSED) browser.terminate();
    await runtime.close();
  }
});

async function jsonFetch(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const body = await response.json() as Record<string, any>;
  return { response, body };
}

function requireString(value: unknown): string {
  assert.equal(typeof value, "string");
  return value as string;
}
