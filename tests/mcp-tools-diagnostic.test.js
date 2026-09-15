import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseToolConfiguration, runDiagnostic } from "../scripts/mcp-tools-diagnostic.js";

// Small injected metadata fixtures test reporting, NOT the real policy parser.
// Canonical registry and subprocess coverage is in the integration test file.
const specs = [
  { name: "ping", policy: "read", description: "do-not-print-description" },
  { name: "create_track", policy: "application_write" },
  { name: "play", policy: "transport" },
];
const definitions = [...specs, { name: "search_tools" }, { name: "call_tool" }];
const registryFor = (names = ["ping"]) => ({
  TOOL_SPECS: specs,
  getToolDefinitions: ({ env }) =>
    env.BITWIG_MCP_ENABLE_WRITES === "1" && env.BITWIG_MCP_TOOL_DISCOVERY === "1"
      ? definitions
      : definitions.filter(({ name }) => names.includes(name)),
});
const capture = async (argv, options = {}) => {
  let stdout = "";
  let stderr = "";
  const code = await runDiagnostic(argv, {
    env: {}, loadRegistry: async () => registryFor(), ...options,
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
  });
  return { code, stdout, stderr };
};

test("reports only metadata projections and never claims live/cache evidence", () => {
  const result = diagnoseToolConfiguration({ registry: registryFor(), env: {} });
  assert.equal(result.scope, "local-mcp-configuration");
  assert.deepEqual(result.enabledPolicies, ["read"]);
  assert.deepEqual(result.disabledPolicies, ["application_write", "transport"]);
  assert.deepEqual(result.exposedTools, ["ping"]);
  assert.equal(result.exposedToolCount, 1);
  assert.equal(result.dawConnection, "not_contacted");
  assert.equal(result.clientToolCache, "not_inspected");
  assert.equal(result.tool, undefined);
  assert.ok(!JSON.stringify(result).includes("do-not-print-description"));
});

for (const [name, status, exposed, policy] of [
  ["ping", "exposed", ["ping"], "read"],
  ["create_track", "policy_blocked", ["ping"], "application_write"],
  ["create_track", "exposed", ["ping", "create_track"], "application_write"],
  ["search_tools", "tool_unavailable", ["ping"], undefined],
  ["call_tool", "exposed", ["ping", "call_tool"], undefined],
  ["__proto__", "unknown_tool", ["ping"], undefined],
]) {
  test(`classifies ${name} as ${status}`, () => {
    const result = diagnoseToolConfiguration({ registry: registryFor(exposed), env: {}, tool: name });
    assert.equal(result.tool.status, status);
    assert.equal(result.tool.policy, policy);
    assert.equal(result.tool.name, status === "unknown_tool" ? undefined : name);
    assert.equal(result.clientToolCache, "not_inspected");
  });
}

test("does not echo unknown names, environment values, endpoints or secrets", async () => {
  const secret = "synthetic_secret_sentinel";
  const env = Object.freeze({
    BITWIG_MCP_WRITE_POLICY: secret, BITWIG_HOST: secret,
    BITWIG_PORT: secret, GATEWAY_TOKEN: secret, HOME: secret,
  });
  const result = await capture(["--json", "--tool", secret], { env });
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).tool.status, "unknown_tool");
  assert.equal(result.stderr, "");
  assert.ok(!result.stdout.includes(secret));
});

test("asks the canonical registry for metadata without mutating caller configuration", () => {
  const env = Object.freeze({ BITWIG_MCP_WRITE_POLICY: "application_write", SECRET: "private" });
  const calls = [];
  const registry = registryFor(["ping", "create_track"]);
  const getDefinitions = registry.getToolDefinitions;
  registry.getToolDefinitions = (options) => { calls.push(options.env); return getDefinitions(options); };
  const result = diagnoseToolConfiguration({ registry, env });
  assert.deepEqual(result.enabledPolicies, ["read", "application_write"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].BITWIG_MCP_WRITE_POLICY, "application_write");
  assert.equal(calls[0].SECRET, undefined);
  assert.notEqual(calls[0], env);
  assert.equal(env.BITWIG_MCP_ENABLE_WRITES, undefined);
  result.exposedTools.push("tampered");
  assert.deepEqual(diagnoseToolConfiguration({ registry, env }).exposedTools, ["ping", "create_track"]);
});

test("JSON and text output are useful; targeted failures return 1", async () => {
  const json = await capture(["--json"]);
  assert.equal(json.code, 0);
  assert.equal(JSON.parse(json.stdout).exposedToolCount, 1);
  assert.equal(json.stderr, "");
  const text = await capture(["--tool", "create_track"]);
  assert.equal(text.code, 1);
  assert.match(text.stdout, /policy_blocked/);
  assert.match(text.stdout, /application_write/);
  assert.match(text.stdout, /restart.*reload/i);
  assert.equal((await capture(["--tool", "ping"])).code, 0);
});

test("help and invalid arguments never load the registry or reflect caller input", async () => {
  const loadRegistry = () => { assert.fail("must not load registry"); };
  for (const flag of ["--help", "-h"]) {
    const result = await capture([flag], { loadRegistry });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Usage:/);
  }
  for (const argv of [
    ["--tool"], ["--tool", ""], ["--tool", "x".repeat(129)],
    ["--tool", "bad\nname"], ["--tool", "../../private"],
    ["--tool", "ping", "--tool", "play"], ["--json", "--json"],
    ["--json", "--token=synthetic_private"], ["unexpected"], ["--help", "--json"],
    ["--tool", "--json"],
  ]) {
    const result = await capture(argv, { loadRegistry });
    assert.equal(result.code, 2, JSON.stringify(argv));
    const output = result.stdout + result.stderr;
    assert.match(output, /invalid_arguments/);
    assert.ok(!output.includes("synthetic_private"));
    if (argv.includes("--json")) assert.equal(JSON.parse(result.stdout).error, "invalid_arguments");
  }
});

test("load failures are bounded, generic, and do not print paths or error secrets", async () => {
  const result = await capture(["--json"], {
    loadRegistry: () => { throw new Error("synthetic_private_path_and_token"); },
  });
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stdout).error, "diagnostic_unavailable");
  assert.ok(!(result.stdout + result.stderr).includes("synthetic_private"));
});
