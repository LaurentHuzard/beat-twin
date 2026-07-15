#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  diagnoseBitwigConnection,
  inspectBitwigSession,
} from "../index.js";

const execFile = promisify(execFileCallback);

export const READINESS_STATES = Object.freeze([
  "process_not_running",
  "process_running_controller_unknown",
  "controller_port_unavailable",
  "controller_ready_mcp_unavailable",
  "ready_read_only",
  "ready_write_policy_enabled",
  "unknown",
]);

const BITWIG_EXECUTABLES = new Set(["bitwigstudio", "bitwig-studio"]);
const WRITE_POLICIES = new Set([
  "transport",
  "mixer_write",
  "clip_write",
  "scene_write",
  "device_write",
  "application_write",
]);

function executableName(value) {
  const firstArgument = value.trim().split(/\s+/, 1)[0] ?? "";
  return firstArgument.split("/").pop().toLowerCase();
}

export function parseLinuxProcessTable(output) {
  const matches = [];
  let parsedLineCount = 0;
  let malformedLineCount = 0;

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^\s*(\d+)\s+(\S+)\s*(.*)$/);
    if (!match) {
      malformedLineCount += 1;
      continue;
    }

    parsedLineCount += 1;
    const [, pid, command, argumentsString] = match;
    if (
      BITWIG_EXECUTABLES.has(executableName(command)) ||
      BITWIG_EXECUTABLES.has(executableName(argumentsString))
    ) {
      matches.push({ pid: Number(pid) });
    }
  }

  return { matches, parsedLineCount, malformedLineCount };
}

async function readLinuxProcessTable() {
  const { stdout } = await execFile("ps", ["-eo", "pid=,comm=,args="], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

export async function detectBitwigProcess({
  platform = process.platform,
  readProcessTable = readLinuxProcessTable,
} = {}) {
  if (platform !== "linux") {
    return {
      status: "unknown",
      running: null,
      platform,
      reason: "unsupported_platform",
      message: "Bitwig process detection is not supported on this platform.",
    };
  }

  try {
    const parsed = parseLinuxProcessTable(await readProcessTable());
    if (parsed.parsedLineCount === 0 || parsed.malformedLineCount > 0) {
      return {
        status: "unknown",
        running: null,
        platform,
        reason: "malformed_process_table",
        message: "The local process table format was not recognized safely.",
      };
    }
    const { matches } = parsed;
    if (matches.length === 0) {
      return {
        status: "process_not_running",
        running: false,
        platform,
        match_count: 0,
        message: "Bitwig Studio is not running.",
        next_action: "Start Bitwig Studio manually, then run this check again.",
      };
    }

    return {
      status: "process_running",
      running: true,
      platform,
      match_count: matches.length,
      message: "A Bitwig Studio process is running; controller readiness is not yet known.",
    };
  } catch (error) {
    return {
      status: "unknown",
      running: null,
      platform,
      reason: error?.code === "EACCES" || error?.code === "EPERM"
        ? "process_table_permission_denied"
        : "process_table_unavailable",
      message: "The local process table could not be inspected safely.",
    };
  }
}

export function hasEnabledWritePolicy(env = process.env) {
  const legacyEnable = String(env.BITWIG_MCP_ENABLE_WRITES ?? "")
    .trim()
    .toLowerCase();
  if (["1", "true", "yes", "on", "all"].includes(legacyEnable)) return true;
  return (env.BITWIG_MCP_WRITE_POLICY ?? "")
    .split(",")
    .some((policy) => WRITE_POLICIES.has(policy.trim().toLowerCase()));
}

function result(state, processDiagnostic, layers, message, nextAction = null) {
  const ready = state === "ready_read_only" || state === "ready_write_policy_enabled";
  return {
    schema_version: 1,
    dependency: "beat-twin-bitwig",
    state,
    ready,
    scope: "read-only-diagnostic",
    message,
    next_action: nextAction,
    layers,
    process: processDiagnostic,
    // Additive compatibility with the original read-only smoke contract.
    ok: ready,
    phase: layers.controller_protocol === true
      ? "read-only-inspection"
      : "tcp-connectivity",
    diagnostic: {
      connected: layers.controller_port === true,
      scope: "tcp-connectivity",
      status: layers.controller_port === true ? "listening" : "unavailable",
    },
    session: {
      connected: layers.controller_protocol === true,
      scope: layers.controller_protocol === true ? "read-only" : null,
    },
  };
}

async function unavailableMcpProbe() {
  return { available: false, reason: "mcp_probe_not_configured" };
}

export async function diagnoseReadOnlyReadiness({
  detectProcess = detectBitwigProcess,
  probeController = diagnoseBitwigConnection,
  probeControllerProtocol = inspectBitwigSession,
  probeMcp = unavailableMcpProbe,
  env = process.env,
} = {}) {
  const processDiagnostic = await detectProcess();
  const layers = {
    process: processDiagnostic.running,
    controller_port: null,
    controller_protocol: null,
    mcp: null,
  };

  if (processDiagnostic.status === "unknown") {
    return result("unknown", processDiagnostic, layers, processDiagnostic.message);
  }
  if (!processDiagnostic.running) {
    return result(
      "process_not_running",
      processDiagnostic,
      layers,
      processDiagnostic.message,
      processDiagnostic.next_action,
    );
  }
  if (typeof probeController !== "function") {
    return result(
      "process_running_controller_unknown",
      processDiagnostic,
      layers,
      "Bitwig is running, but controller readiness was not checked.",
      "Check that the Beat Twin controller is enabled in Bitwig.",
    );
  }

  let controller;
  try {
    controller = await probeController();
  } catch {
    controller = { connected: false };
  }
  layers.controller_port = Boolean(controller?.connected);
  if (!layers.controller_port) {
    return result(
      "controller_port_unavailable",
      processDiagnostic,
      layers,
      "Bitwig is running, but the Beat Twin controller port is unavailable.",
      "Enable the Beat Twin controller in Bitwig and retry.",
    );
  }

  let controllerProtocol;
  try {
    controllerProtocol = await probeControllerProtocol();
  } catch {
    controllerProtocol = { connected: false };
  }
  layers.controller_protocol = Boolean(
    controllerProtocol?.connected && controllerProtocol?.scope === "read-only",
  );
  if (!layers.controller_protocol) {
    return result(
      "process_running_controller_unknown",
      processDiagnostic,
      layers,
      "The controller port is open, but its read-only protocol could not be verified.",
      "Check the Beat Twin controller protocol and retry.",
    );
  }

  let mcp;
  try {
    mcp = await probeMcp();
  } catch {
    mcp = { connected: false };
  }
  layers.mcp = Boolean(mcp?.available && mcp?.scope === "read-only");
  if (!layers.mcp) {
    return result(
      "controller_ready_mcp_unavailable",
      processDiagnostic,
      layers,
      "The controller port is ready, but the read-only MCP inspection is unavailable.",
      "Start or repair the Beat Twin MCP process, then retry.",
    );
  }

  const writeEnabled = hasEnabledWritePolicy(env);
  layers.write_policy_enabled = writeEnabled;
  return result(
    writeEnabled ? "ready_write_policy_enabled" : "ready_read_only",
    processDiagnostic,
    layers,
    writeEnabled
      ? "Beat Twin is ready; an explicit write policy is enabled. This diagnostic made no writes."
      : "Beat Twin is ready for read-only inspection.",
  );
}

async function main() {
  const diagnostic = await diagnoseReadOnlyReadiness();
  console.log(JSON.stringify(diagnostic, null, 2));
  process.exitCode = diagnostic.ready ? 0 : 2;
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  main().catch(() => {
    console.log(JSON.stringify({
      schema_version: 1,
      dependency: "beat-twin-bitwig",
      state: "unknown",
      ready: false,
      scope: "read-only-diagnostic",
      message: "The read-only dependency diagnostic failed safely.",
    }, null, 2));
    process.exitCode = 1;
  });
}
