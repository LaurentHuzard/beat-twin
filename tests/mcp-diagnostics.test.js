import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as bridge from "../index.js";

const script = fileURLToPath(new URL("../scripts/mcp-diagnostics.js", import.meta.url));
const readNames = [
  "bitwig_session_inspect", "bitwig_arrangement_plan", "transport_get_tempo",
  "transport_get_position", "transport_playing_status", "track_bank_get_status",
  "scene_list", "clip_get_info", "track_selected_get_status", "device_get_status",
  "device_get_remote_controls", "device_list", "browser_get_status", "browser_list_results",
];
const applicationNames = ["application_create_instrument_track", "application_create_audio_track"];
const writePolicies = ["transport", "mixer_write", "clip_write", "scene_write", "device_write", "application_write"];
const modes = [
  { label: "read-only", env: {}, policies: ["read"], count: 14 },
  { label: "selective-writes", env: { BITWIG_MCP_WRITE_POLICY: "application_write" }, policies: ["read", "application_write"], count: 16 },
  { label: "all-writes", env: { BITWIG_MCP_ENABLE_WRITES: "1" }, policies: ["read", ...writePolicies], count: 57 },
];
const parseToolText = (response) => JSON.parse(response.content[0].text);

function cli(args = [], env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", timeout: 5000,
    env: { ...process.env, BITWIG_MCP_ENABLE_WRITES: "", BITWIG_MCP_WRITE_POLICY: "", BITWIG_MCP_TOOL_DISCOVERY: "", ...env },
  });
}

function fixture(t, content, name = "client-tools.json") {
  const directory = mkdtempSync(join(tmpdir(), "beat-twin-diagnostic-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, name);
  writeFileSync(path, content);
  return path;
}

for (const mode of modes) {
  test(`diagnostic reports ${mode.label} without network or environment mutation`, (t) => {
    const connect = t.mock.method(net.Socket.prototype, "connect", () => { throw new Error("Network forbidden"); });
    const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Network forbidden"); });
    const env = Object.freeze({ ...mode.env, BITWIG_MCP_TOOL_DISCOVERY: "1", BITWIG_HOST: "DO_NOT_CONNECT" });
    const before = { ...env };
    const report = bridge.getMcpDiagnostics({ env });
    assert.equal(report.scope, "local-mcp-configuration");
    assert.equal(report.surface, "bitwig");
    assert.equal(report.daw_checked, false);
    assert.equal(report.mode, mode.label);
    assert.deepEqual(report.enabled_policies, mode.policies);
    assert.deepEqual(report.disabled_policies, writePolicies.filter((policy) => !mode.policies.includes(policy)));
    assert.equal(report.tool_count, mode.count + 2);
    assert.equal(report.discovery_enabled, true);
    assert.deepEqual(report.exposed_tools, bridge.getToolDefinitions({ env }).map((tool) => tool.name));
    assert.deepEqual(report.exposed_tools.slice(-2), ["search_tools", "call_tool"]);
    assert.deepEqual(report.client_tool_list, { status: "not_checked" });
    assert.match(report.reload_hint, /restart.*server.*reload/i);
    assert.deepEqual(env, before);
    assert.equal(connect.mock.callCount(), 0);
    assert.equal(fetch.mock.callCount(), 0);
  });

  test(`CLI ${mode.label} exits without DAW access and lists only the expected tools`, () => {
    const result = cli(["--json"], mode.env);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.tool_count, mode.count);
    assert.equal(report.discovery_enabled, false);
    assert.equal(report.exposed_tools.includes("application_create_instrument_track"), mode.label !== "read-only");
    assert.equal(report.exposed_tools.includes("transport_play"), mode.label === "all-writes");
    assert.ok(!report.exposed_tools.includes("call_tool"));
    assert.ok(!report.exposed_tools.includes("confirm"));
    assert.ok(!report.exposed_tools.includes("execute"));
  });

  test(`write policies remain enforced in ${mode.label} using fake calls only`, async () => {
    const examples = [
      ["transport_play", "transport"], ["track_selected_set_arm", "mixer_write"],
      ["clip_launch", "clip_write"], ["scene_create", "scene_write"],
      ["browser_commit", "device_write"], ["application_create_instrument_track", "application_write"],
    ];
    for (const [name, policy] of examples) {
      const calls = [];
      const response = await bridge.handleToolCall({ params: { name, arguments: { state: false, trackIndex: 0, slotIndex: 0 } } }, {
        env: mode.env, call: async (...args) => { calls.push(args); return "fake"; },
      });
      if (mode.policies.includes(policy)) {
        assert.equal(response.isError, undefined, name);
        assert.equal(calls.length, 1, name);
        assert.equal(calls[0][2].requiresAuthentication, true, name);
      } else {
        assert.equal(parseToolText(response).error, "policy_blocked", name);
        assert.equal(calls.length, 0, name);
      }
    }
  });
}

test("default diagnostic is exactly the historical read-only catalog", () => {
  const report = bridge.getMcpDiagnostics({ env: {} });
  assert.deepEqual(report.exposed_tools, readNames);
  assert.deepEqual(bridge.getMcpDiagnostics({ env: modes[1].env }).exposed_tools.filter((name) => !readNames.includes(name)), applicationNames);
});

test("policy normalization, ignored entries and all-writes precedence reuse canonical semantics", () => {
  for (const enabled of ["1", "true", " YES ", "On", "all"]) {
    const report = bridge.getMcpDiagnostics({ env: { BITWIG_MCP_ENABLE_WRITES: enabled, BITWIG_MCP_WRITE_POLICY: "application_write" } });
    assert.equal(report.mode, "all-writes");
    assert.equal(report.tool_count, 57);
  }
  const env = { BITWIG_MCP_ENABLE_WRITES: "false", BITWIG_MCP_WRITE_POLICY: " APPLICATION_WRITE ,invalid,application_write ", BITWIG_MCP_TOOL_DISCOVERY: "true" };
  const report = bridge.getMcpDiagnostics({ env });
  assert.deepEqual(report.enabled_policies, ["read", "application_write"]);
  assert.equal(report.discovery_enabled, false, "discovery retains its existing exact-1 opt-in");
  assert.deepEqual(bridge.getMcpDiagnostics({ env: { BITWIG_MCP_WRITE_POLICY: "invalid" } }).enabled_policies, ["read"]);
});

test("diagnostics never disclose raw environment values or unrecognized client names", () => {
  const secret = "SENSITIVE_DO_NOT_PRINT";
  const report = bridge.getMcpDiagnostics({
    env: { BITWIG_HOST: secret, BITWIG_PORT: secret, BITWIG_MCP_WRITE_POLICY: secret, BITWIG_MCP_ENABLE_WRITES: secret, BITWIG_MCP_TOOL_DISCOVERY: secret, PROVIDER_API_KEY: secret },
    clientToolNames: [...readNames, secret],
  });
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.equal(report.client_tool_list.unrecognized_count, 1);
});

test("matching names ignore order and duplicates without claiming live cache verification", () => {
  const report = bridge.getMcpDiagnostics({ env: {}, clientToolNames: [...readNames].reverse().concat(readNames[0]) });
  assert.deepEqual(report.client_tool_list, { status: "matches", missing: [], no_longer_exposed: [], unrecognized_count: 0 });
  assert.equal(report.daw_checked, false);
});

test("an old read-only list identifies newly exposed application tools", () => {
  const report = bridge.getMcpDiagnostics({ env: modes[1].env, clientToolNames: readNames });
  assert.equal(report.client_tool_list.status, "mismatch");
  assert.equal(report.client_tool_list.error, "tool_list_mismatch");
  assert.deepEqual(report.client_tool_list.missing, applicationNames);
  assert.deepEqual(report.client_tool_list.no_longer_exposed, []);
  assert.match(report.client_tool_list.hint, /stale/i);
  assert.match(report.client_tool_list.hint, /different.*environment.*version/i);
});

test("revoked policies and disabled discovery are visible in supplied old client lists", () => {
  const report = bridge.getMcpDiagnostics({ env: {}, clientToolNames: [...readNames, ...applicationNames, "search_tools", "call_tool"] });
  assert.equal(report.client_tool_list.error, "tool_list_mismatch");
  assert.deepEqual(report.client_tool_list.no_longer_exposed, [...applicationNames, "search_tools", "call_tool"].sort());
  assert.deepEqual(report.client_tool_list.missing, []);
});

test("an explicitly empty list is compared, not treated as absent", () => {
  assert.deepEqual(bridge.getMcpDiagnostics({ env: {}, clientToolNames: [] }).client_tool_list.missing, readNames);
});

test("invalid or oversized client-name input is rejected without echoing it", () => {
  for (const clientToolNames of [null, {}, "SECRET", [null], [""], ["\nSECRET"], ["x".repeat(129)], Array(1), Array(513).fill("x")]) {
    assert.throws(() => bridge.getMcpDiagnostics({ env: {}, clientToolNames }), { code: "invalid_client_tool_list" });
  }
});

test("unknown direct tools differ from policy-hidden and feature-disabled tools before dispatch", async () => {
  let calls = 0;
  const call = async () => { calls += 1; throw new Error("DAW access forbidden"); };
  for (const [name, expected] of [["unknown_SECRET", "unknown_tool"], ["application_create_instrument_track", "policy_blocked"], ["call_tool", "tool_unavailable"]]) {
    const result = await bridge.handleToolCall({ params: { name } }, { env: {}, call });
    assert.equal(result.isError, true);
    assert.equal(parseToolText(result).error, expected);
    assert.ok(!JSON.stringify(result).includes("SECRET"));
  }
  assert.equal(calls, 0);
});

test("real dispatch failures remain failures and are not mislabeled as stale lists", async () => {
  const result = await bridge.handleToolCall({ params: { name: "transport_get_tempo" } }, {
    env: {}, call: async () => { throw new Error("fake connection failure"); },
  });
  assert.equal(parseToolText(result).error, "tool_call_failed");
});

test("CLI text and help are compact and JSON is a single parseable record", () => {
  const text = cli();
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /local.*Bitwig.*no DAW/i);
  assert.ok(text.stdout.trim().split("\n").length < 12);
  const help = cli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--client-tools/);
  const json = cli(["--json"]);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(json.stdout.trim().split("\n").length, 1);
});

test("CLI compares a full tools/list result and ignores descriptions and schemas", (t) => {
  const path = fixture(t, JSON.stringify({ tools: readNames.map((name) => ({ name, description: "SECRET", inputSchema: { secret: "SECRET" } })) }));
  const result = cli(["--json", "--client-tools", path]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).client_tool_list.status, "matches");
  assert.ok(!result.stdout.includes("SECRET"));
});

test("CLI reports name mismatch with exit 1, without leaking arbitrary names or paths", (t) => {
  const path = fixture(t, JSON.stringify([...readNames, "SECRET"]), "SECRET.json");
  const result = cli(["--client-tools", path, "--json"], modes[1].env);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).client_tool_list.error, "tool_list_mismatch");
  assert.ok(!result.stdout.includes("SECRET"));
  const text = cli(["--client-tools", path], modes[1].env);
  assert.equal(text.status, 1);
  assert.match(text.stdout, /tool_list_mismatch/);
  assert.match(text.stdout, /application_create_instrument_track/);
  assert.ok(!text.stdout.includes("SECRET"));
});

test("CLI rejects malformed, oversized, incomplete and wrong-shaped snapshots", (t) => {
  for (const [text, error] of [
    ["{SECRET", "invalid_client_tool_list"],
    [" ".repeat(65537), "client_tool_list_unreadable"],
    [JSON.stringify({ tools: [], nextCursor: "SECRET" }), "incomplete_client_tool_list"],
    [JSON.stringify({ tools: [null] }), "invalid_client_tool_list"],
    [JSON.stringify({ error: "SECRET" }), "invalid_client_tool_list"],
    [JSON.stringify(Array(513).fill("x")), "invalid_client_tool_list"],
  ]) {
    const path = fixture(t, text, "SECRET.json");
    const result = cli(["--json", "--client-tools", path]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).error, error);
    assert.ok(!result.stdout.includes("SECRET"));
  }
});

test("CLI refuses unknown arguments and missing/unreadable inputs with exit 2", () => {
  for (const args of [["--SECRET"], ["--client-tools"], ["--client-tools", "--json"], ["--json", "--json"], ["--client-tools", "/missing/SECRET.json"]]) {
    const result = cli(args);
    assert.equal(result.status, 2, result.stderr);
    assert.ok(!result.stdout.includes("SECRET"));
  }
});

test("CLI rejects non-regular files rather than reading indefinitely", { skip: process.platform === "win32" }, () => {
  const result = cli(["--json", "--client-tools", "/dev/null"]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).error, "client_tool_list_unreadable");
});
