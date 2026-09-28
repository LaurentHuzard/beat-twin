import assert from "node:assert/strict";
import test from "node:test";
import { callEar, EarClientError, getEarBaseUrl } from "../lib/ear-client.ts";

const env = { BITWIG_EAR_BASE_URL: "http://127.0.0.1:8765" };
const json = (value, init = {}) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" }, ...init });
const absentFetch = async () => { assert.fail("this Ear request must not access the network"); };
const rejectsCode = async (promise, code) => assert.rejects(promise, (error) => error instanceof EarClientError && error.code === code);

test("Ear is opt-in and unconfigured status performs no network operation", async () => {
  assert.deepEqual(await callEar("ear_status", {}, { env: {}, fetch: absentFetch }), { configured: false, connected: false, externalService: true, audioCaptured: false });
  for (const [name, args] of [["ear_get_levels", {}], ["ear_list_devices", {}], ["ear_set_device", { index: 0 }], ["ear_listen", {}], ["ear_analyze", {}]]) {
    await rejectsCode(callEar(name, args, { env: {}, fetch: absentFetch }), "ear_unconfigured");
  }
});

test("Ear only permits literal loopback origins without URL smuggling", () => {
  for (const value of ["http://127.0.0.1", "http://127.0.0.1:1/", "https://[::1]:65535"]) assert.ok(getEarBaseUrl({ BITWIG_EAR_BASE_URL: value }) instanceof URL);
  for (const value of ["http://localhost:8765", "http://127.1", "http://2130706433", "http://0x7f000001", "http://0177.0.0.1", "http://127.0.0.2", "http://[::ffff:127.0.0.1]", "http://example.com", "https://127.0.0.1.evil", "file:///tmp/ear", "http://user:secret@127.0.0.1", "http://127.0.0.1/path", "http://127.0.0.1/?a=1", "http://127.0.0.1/#fragment", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1\\@evil", "http://127.0.0.1:80//"]) {
    assert.throws(() => getEarBaseUrl({ BITWIG_EAR_BASE_URL: value }), (error) => error.code === "ear_invalid_configuration", value);
  }
});

test("all six Ear endpoints preserve opaque synthetic JSON and use bounded redirect-free requests", async () => {
  const cases = [
    ["ear_status", {}, "/levels", "GET"], ["ear_get_levels", {}, "/levels", "GET"],
    ["ear_list_devices", {}, "/devices", "GET"], ["ear_set_device", { index: 0 }, "/device/0", "POST"],
    ["ear_listen", {}, "/listen?seconds=5", "GET"], ["ear_listen", { seconds: 10 }, "/listen?seconds=10", "GET"],
    ["ear_analyze", {}, "/analyze?seconds=1", "GET"], ["ear_analyze", { seconds: 0.25 }, "/analyze?seconds=0.25", "GET"],
  ];
  for (const [name, args, path, method] of cases) {
    const fixture = { synthetic: true, sourceSpecificField: [0, false, null, "opaque"] };
    const calls = [];
    const result = await callEar(name, args, { env, fetch: async (url, init) => { calls.push([url, init]); return json(fixture); } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0].href, env.BITWIG_EAR_BASE_URL + path);
    assert.equal(calls[0][1].method, method);
    assert.equal(calls[0][1].redirect, "error");
    assert.ok(calls[0][1].signal instanceof AbortSignal);
    assert.deepEqual(result, { configured: true, connected: true, externalService: true, operation: name, payloadSchema: "external-unverified", payload: fixture });
    assert.equal(Object.hasOwn(result, "bpm"), false);
  }
});

test("Ear client rejects unknown endpoints and invalid durations before fetch", async () => {
  for (const [name, args] of [["ear_set_device", { index: -1 }], ["ear_set_device", { index: 0.1 }], ["ear_set_device", { index: "0" }], ["ear_set_device", {}], ["ear_listen", { seconds: 0 }], ["ear_listen", { seconds: 1.5 }], ["ear_listen", { seconds: null }], ["ear_analyze", { seconds: null }], ["ear_analyze", { seconds: Infinity }], ["ear_analyze", { seconds: 10.01 }], ["ear_status", { url: "http://evil" }]]) {
    await rejectsCode(callEar(name, args, { env, fetch: absentFetch }), "ear_invalid_arguments");
  }
  await rejectsCode(callEar("arbitrary_path", {}, { env, fetch: absentFetch }), "ear_unknown_tool");
  for (const args of [null, [], 1, "input"]) await rejectsCode(callEar("ear_status", args, { env, fetch: absentFetch }), "ear_invalid_arguments");
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 15001 }, { maxResponseBytes: 0 }, { maxResponseBytes: 8388609 }]) await rejectsCode(callEar("ear_status", {}, { env, fetch: absentFetch, ...options }), "ear_invalid_configuration");
});

test("Ear policy is checked on entry and again immediately before HTTP dispatch", async () => {
  await rejectsCode(callEar("ear_status", {}, { env, fetch: absentFetch, authorize: () => false }), "policy_blocked");
  let checks = 0;
  await rejectsCode(callEar("ear_status", {}, { env, fetch: absentFetch, authorize: () => ++checks === 1 }), "policy_blocked");
  assert.equal(checks, 2);
});

test("Ear rejects redirects, HTTP errors, non-JSON and invalid UTF-8 without leaking response contents", async () => {
  for (const [response, code] of [
    [json({ private: "do-not-leak" }, { status: 302, headers: { location: "http://evil", "content-type": "application/json" } }), "ear_http_error"],
    [json({ private: "do-not-leak" }, { status: 500 }), "ear_http_error"],
    [new Response("private response", { headers: { "content-type": "text/plain" } }), "ear_invalid_response"],
    [new Response("{bad-json private", { headers: { "content-type": "application/json" } }), "ear_invalid_response"],
    [new Response(Uint8Array.from([0xff]), { headers: { "content-type": "application/json" } }), "ear_invalid_response"],
  ]) {
    let calls = 0;
    await assert.rejects(callEar("ear_status", {}, { env, fetch: async () => { calls++; return response; } }), (error) => error.code === code && !/private|do-not-leak/.test(error.message));
    assert.equal(calls, 1);
  }
  const redirected = json({ synthetic: true });
  Object.defineProperty(redirected, "redirected", { value: true });
  await rejectsCode(callEar("ear_status", {}, { env, fetch: async () => redirected }), "ear_redirect_forbidden");
});

test("Ear bounds declared and streamed byte lengths independently", async () => {
  await rejectsCode(callEar("ear_get_levels", {}, { env, maxResponseBytes: 8, fetch: async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "9" } }) }), "ear_response_too_large");
  await rejectsCode(callEar("ear_get_levels", {}, { env, maxResponseBytes: 8, fetch: async () => new Response("{\"data\":123}", { headers: { "content-type": "application/json" } }) }), "ear_response_too_large");
  await rejectsCode(callEar("ear_get_levels", {}, { env, maxResponseBytes: 8, fetch: async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "invalid" } }) }), "ear_response_too_large");
  const exact = await callEar("ear_get_levels", {}, { env, maxResponseBytes: 2, fetch: async () => new Response("{}", { headers: { "content-type": "application/json" } }) });
  assert.deepEqual(exact.payload, {});
});

test("Ear deadline covers connection and hanging body streams without retries", async () => {
  let calls = 0;
  let signal;
  await rejectsCode(callEar("ear_listen", {}, { env, timeoutMs: 5, fetch: async (_url, init) => { calls++; signal = init.signal; return new Promise(() => {}); } }), "ear_timeout");
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await rejectsCode(callEar("ear_analyze", {}, { env, timeoutMs: 5, fetch: async () => new Response(body, { headers: { "content-type": "application/json" } }) }), "ear_timeout");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("Ear connection failures are sanitized and never automatically replayed", async () => {
  let calls = 0;
  await assert.rejects(callEar("ear_set_device", { index: 3 }, { env, fetch: async () => { calls++; throw new Error("secret external connection detail"); } }), (error) => error.code === "ear_connection_error" && !/secret/.test(error.message));
  assert.equal(calls, 1);
});

test("Ear revocation after fetch or during streaming cancels audio delivery and response bodies", async () => {
  let authorized = true;
  let cancelled = false;
  let requestSignal;
  const pendingBody = new ReadableStream({ cancel() { cancelled = true; } });
  await rejectsCode(callEar("ear_listen", {}, { env, authorize: () => authorized, fetch: async (_url, init) => {
    requestSignal = init.signal;
    authorized = false;
    return new Response(pendingBody, { headers: { "content-type": "application/json" } });
  } }), "policy_blocked");
  assert.equal(cancelled, true);
  assert.equal(requestSignal.aborted, true);

  authorized = true;
  cancelled = false;
  let reads = 0;
  const streamingBody = new ReadableStream({
    pull(controller) {
      if (++reads === 2) authorized = false;
      controller.enqueue(new TextEncoder().encode(reads === 1 ? '{"secret":' : '"audio"}'));
    },
    cancel() { cancelled = true; },
  });
  await rejectsCode(callEar("ear_analyze", {}, { env, authorize: () => authorized, fetch: async () => new Response(streamingBody, { headers: { "content-type": "application/json" } }) }), "policy_blocked");
  assert.equal(cancelled, true);
});
