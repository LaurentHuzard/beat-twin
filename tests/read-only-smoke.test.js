import assert from "node:assert/strict";
import test from "node:test";

import {
  detectBitwigProcess,
  diagnoseReadOnlyReadiness,
  parseLinuxProcessTable,
} from "../scripts/read-only-smoke.js";

const running = () => ({
  status: "process_running",
  running: true,
  platform: "linux",
  match_count: 1,
  message: "running",
});

test("Linux process matching finds Bitwig executables without text false positives", () => {
  const fixture = [
    " 101 BitwigStudio /opt/bitwig-studio/bitwig-studio",
    " 102 bitwig-studio /opt/bitwig-studio/bitwig-studio --safe-mode",
    " 103 node node watcher.js BitwigStudio",
    " 104 grep grep bitwig-studio",
    " 105 bitwig-helper /opt/bitwig-helper",
  ].join("\n");
  assert.deepEqual(parseLinuxProcessTable(fixture), {
    matches: [{ pid: 101 }, { pid: 102 }],
    parsedLineCount: 5,
    malformedLineCount: 0,
  });
});

test("process detection reports absent, permission denied, and unsupported safely", async () => {
  assert.equal((await detectBitwigProcess({ readProcessTable: async () => "1 init /sbin/init" })).status, "process_not_running");

  const denied = await detectBitwigProcess({ readProcessTable: async () => {
    const error = new Error("private host detail");
    error.code = "EACCES";
    throw error;
  } });
  assert.equal(denied.status, "unknown");
  assert.equal(denied.reason, "process_table_permission_denied");
  assert.doesNotMatch(JSON.stringify(denied), /private host detail/);

  const unsupported = await detectBitwigProcess({ platform: "darwin" });
  assert.equal(unsupported.status, "unknown");
  assert.equal(unsupported.running, null);

  const malformed = await detectBitwigProcess({
    readProcessTable: async () => "this is not ps output",
  });
  assert.equal(malformed.status, "unknown");
  assert.equal(malformed.reason, "malformed_process_table");
});

test("readiness returns the earliest failing layer", async (t) => {
  const cases = [
    ["process_not_running", { detectProcess: async () => ({ status: "process_not_running", running: false, message: "stopped", next_action: "start manually" }) }],
    ["process_running_controller_unknown", { detectProcess: running, probeController: null }],
    ["controller_port_unavailable", { detectProcess: running, probeController: async () => ({ connected: false }) }],
    ["process_running_controller_unknown", { detectProcess: running, probeController: async () => ({ connected: true }), probeControllerProtocol: async () => ({ connected: false }) }],
    ["controller_ready_mcp_unavailable", { detectProcess: running, probeController: async () => ({ connected: true }), probeControllerProtocol: async () => ({ connected: true, scope: "read-only" }) }],
    ["ready_read_only", { detectProcess: running, probeController: async () => ({ connected: true }), probeControllerProtocol: async () => ({ connected: true, scope: "read-only" }), probeMcp: async () => ({ available: true, scope: "read-only" }), env: {} }],
    ["ready_write_policy_enabled", { detectProcess: running, probeController: async () => ({ connected: true }), probeControllerProtocol: async () => ({ connected: true, scope: "read-only" }), probeMcp: async () => ({ available: true, scope: "read-only" }), env: { BITWIG_MCP_WRITE_POLICY: "transport" } }],
    ["ready_write_policy_enabled", { detectProcess: running, probeController: async () => ({ connected: true }), probeControllerProtocol: async () => ({ connected: true, scope: "read-only" }), probeMcp: async () => ({ available: true, scope: "read-only" }), env: { BITWIG_MCP_ENABLE_WRITES: "true" } }],
  ];

  for (const [state, options] of cases) {
    await t.test(state, async () => {
      const diagnostic = await diagnoseReadOnlyReadiness(options);
      assert.equal(diagnostic.state, state);
      assert.equal(diagnostic.scope, "read-only-diagnostic");
      assert.equal(diagnostic.ready, state.startsWith("ready_"));
      assert.equal(diagnostic.ok, diagnostic.ready);
      assert.equal(
        diagnostic.phase,
        diagnostic.layers.controller_protocol === true
          ? "read-only-inspection"
          : "tcp-connectivity",
      );
      assert.ok("diagnostic" in diagnostic);
      assert.ok("session" in diagnostic);
    });
  }
});

test("TwinPilot-safe output does not expose process arguments, secrets, or probe errors", async () => {
  const diagnostic = await diagnoseReadOnlyReadiness({
    detectProcess: running,
    probeController: async () => { throw new Error("tcp://secret-host:8888 token=secret"); },
    env: { SECRET_TOKEN: "secret", BITWIG_MCP_WRITE_POLICY: "" },
  });
  const output = JSON.stringify(diagnostic);
  assert.equal(diagnostic.state, "controller_port_unavailable");
  assert.doesNotMatch(output, /secret|8888|token/i);
});
