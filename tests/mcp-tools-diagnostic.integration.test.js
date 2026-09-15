import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as registry from "../index.js";
import { diagnoseToolConfiguration } from "../scripts/mcp-tools-diagnostic.js";

const cli = fileURLToPath(new URL("../scripts/mcp-tools-diagnostic.js", import.meta.url));
const applicationTool = "application_create_instrument_track";
const writePolicies = [...new Set(registry.TOOL_SPECS.map(({ policy }) => policy))]
  .filter((policy) => policy !== "read");

for (const [name, env, expectedPolicies] of [
  ["read-only", {}, ["read"]],
  ["application-write", { BITWIG_MCP_WRITE_POLICY: "application_write" }, ["read", "application_write"]],
  ["normalized selective policy", { BITWIG_MCP_WRITE_POLICY: " APPLICATION_WRITE,unknown,application_write " }, ["read", "application_write"]],
  ["all-writes", { BITWIG_MCP_ENABLE_WRITES: "1" }, ["read", ...writePolicies]],
  ["all-writes alias", { BITWIG_MCP_ENABLE_WRITES: " YES " }, ["read", ...writePolicies]],
  ["invalid policies stay read-only", { BITWIG_MCP_ENABLE_WRITES: "false", BITWIG_MCP_WRITE_POLICY: "all,invalid" }, ["read"]],
  ["discovery only", { BITWIG_MCP_TOOL_DISCOVERY: "1" }, ["read"]],
  ["discovery is exact opt-in", { BITWIG_MCP_TOOL_DISCOVERY: "true" }, ["read"]],
]) {
  test(`diagnostic matches the canonical registry: ${name}`, () => {
    const result = diagnoseToolConfiguration({ registry, env: Object.freeze(env) });
    assert.deepEqual(new Set(result.enabledPolicies), new Set(expectedPolicies));
    assert.deepEqual(result.exposedTools, registry.getToolDefinitions({ env }).map(({ name }) => name));
    assert.equal(result.exposedToolCount, result.exposedTools.length);
    assert.equal(result.clientToolCache, "not_inspected");
    assert.equal(result.dawConnection, "not_contacted");
    const target = diagnoseToolConfiguration({ registry, env, tool: applicationTool }).tool;
    assert.equal(target.status, expectedPolicies.includes("application_write") ? "exposed" : "policy_blocked");
    assert.equal(target.policy, "application_write");
    const discovery = diagnoseToolConfiguration({ registry, env, tool: "call_tool" }).tool;
    assert.equal(discovery.status, env.BITWIG_MCP_TOOL_DISCOVERY === "1" ? "exposed" : "tool_unavailable");
  });
}

test("unknown direct names and optional wrappers are not confused with policy denial", () => {
  for (const tool of ["__proto__", "not_a_tool", "nanodaw_confirm"]) {
    const result = diagnoseToolConfiguration({ registry, env: {}, tool });
    assert.equal(result.tool.status, "unknown_tool");
    assert.equal(result.tool.name, undefined);
  }
  const all = diagnoseToolConfiguration({ registry, env: {
    BITWIG_MCP_ENABLE_WRITES: "1", BITWIG_MCP_TOOL_DISCOVERY: "1",
  } });
  assert.equal(all.exposedToolCount, registry.TOOL_SPECS.length + 2);
  assert.deepEqual(all.disabledPolicies, []);
  assert.deepEqual(registry.getToolDefinitions({ env: {} }).map(({ name }) => name),
    registry.TOOL_SPECS.filter(({ policy }) => policy === "read").map(({ name }) => name));
});

test("CLI runs offline in every policy mode and does not leak synthetic configuration", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "beat-twin-diagnostic-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const guard = join(directory, "no-network.mjs");
  // Failure remains observable even if a future implementation catches it.
  // Existing socket objects may be constructed; no connection may be attempted.
  await writeFile(guard, `
    import net from 'node:net';
    import http from 'node:http';
    import https from 'node:https';
    import dns from 'node:dns';
    import dgram from 'node:dgram';
    import { syncBuiltinESMExports } from 'node:module';
    let attempted = false;
    const deny = () => { attempted = true; throw new Error('network forbidden'); };
    net.Socket.prototype.connect = deny;
    net.Server.prototype.listen = deny;
    net.connect = net.createConnection = deny;
    http.request = http.get = https.request = https.get = deny;
    dns.lookup = dns.resolve = deny;
    dns.promises.lookup = dns.promises.resolve = deny;
    dgram.createSocket = deny;
    globalThis.fetch = deny;
    syncBuiltinESMExports();
    process.on('exit', () => { if (attempted) process.exitCode = 99; });
  `);
  for (const env of [
    {}, { BITWIG_MCP_WRITE_POLICY: "application_write" },
    { BITWIG_MCP_ENABLE_WRITES: "1", BITWIG_MCP_TOOL_DISCOVERY: "1" },
  ]) {
    // Deliberately do not inherit developer NODE_OPTIONS, credentials or policies.
    const childEnv = {
      BITWIG_HOST: "synthetic_private_endpoint", BITWIG_PORT: "not-a-port",
      GATEWAY_TOKEN: "synthetic_private_token", ...env,
    };
    for (const [args, expectedCode, expectedStatus] of [
      [[], 0, undefined],
      [["--tool", applicationTool], env.BITWIG_MCP_WRITE_POLICY || env.BITWIG_MCP_ENABLE_WRITES ? 0 : 1,
        env.BITWIG_MCP_WRITE_POLICY || env.BITWIG_MCP_ENABLE_WRITES ? "exposed" : "policy_blocked"],
      [["--tool", "synthetic_private_token"], 1, "unknown_tool"],
    ]) {
      const result = spawnSync(process.execPath, ["--import", pathToFileURL(guard).href, cli, "--json", ...args], {
        env: childEnv, encoding: "utf8", timeout: 10000, maxBuffer: 256 * 1024,
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, expectedCode, result.stderr);
      assert.equal(result.stderr, "");
      assert.ok(!result.stdout.includes("synthetic_private"));
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.tool?.status, expectedStatus);
      assert.deepEqual(parsed.exposedTools, registry.getToolDefinitions({ env }).map(({ name }) => name));
    }
  }
});

test("diagnostic and both test files remain wired into package scripts and distribution", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["diagnose:tools"], "node scripts/mcp-tools-diagnostic.js");
  for (const name of ["test", "test:unit"]) {
    assert.ok(pkg.scripts[name].includes("tests/mcp-tools-diagnostic*.test.js"));
  }
  assert.ok(pkg.files.includes("scripts/mcp-tools-diagnostic.js"));
});
