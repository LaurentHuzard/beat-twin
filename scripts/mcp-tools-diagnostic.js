#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = "Usage: node scripts/mcp-tools-diagnostic.js [--json] [--tool NAME] | --help";
const RELOAD_HINT = "Use the same repository version and environment as the MCP server. If a tool is exposed here but absent in the client, verify its server configuration, restart the MCP server and reload the client tool list. A stale cache is only one possible cause; this command cannot inspect it.";

/**
 * Project canonical registry metadata only. Never dispatch, connect, or parse
 * permissions here: getToolDefinitions remains the single policy authority.
 */
export function diagnoseToolConfiguration({ registry, env = process.env, tool } = {}) {
  const { TOOL_SPECS, getToolDefinitions } = registry;
  // Do not copy arbitrary environment variables into diagnostics or callbacks.
  const policyEnv = {
    BITWIG_MCP_ENABLE_WRITES: env.BITWIG_MCP_ENABLE_WRITES,
    BITWIG_MCP_WRITE_POLICY: env.BITWIG_MCP_WRITE_POLICY,
    BITWIG_MCP_TOOL_DISCOVERY: env.BITWIG_MCP_TOOL_DISCOVERY,
  };
  const exposedTools = getToolDefinitions({ env: policyEnv }).map(({ name }) => name);
  const exposed = new Set(exposedTools);
  // Enumerate known names through the same registry, in a detached metadata-only
  // configuration. This neither changes process.env nor enables a live server.
  const known = new Set(getToolDefinitions({ env: {
    BITWIG_MCP_ENABLE_WRITES: "1", BITWIG_MCP_TOOL_DISCOVERY: "1",
  } }).map(({ name }) => name));
  const specs = new Map(TOOL_SPECS.map((spec) => [spec.name, spec]));
  const policies = [...new Set(TOOL_SPECS.map(({ policy }) => policy))];
  const enabledPolicies = new Set(TOOL_SPECS
    .filter(({ name }) => exposed.has(name)).map(({ policy }) => policy));
  const result = {
    scope: "local-mcp-configuration",
    enabledPolicies: policies.filter((policy) => enabledPolicies.has(policy)),
    disabledPolicies: policies.filter((policy) => !enabledPolicies.has(policy)),
    exposedToolCount: exposedTools.length,
    exposedTools,
    dawConnection: "not_contacted",
    clientToolCache: "not_inspected",
    reloadHint: RELOAD_HINT,
    safety: "Policy-enabled does not mean live-ready or human-authorized. No tool is called or retried.",
  };
  if (tool !== undefined) {
    if (!known.has(tool)) {
      // Unknown input might itself be a pasted secret: do not echo it.
      result.tool = { status: "unknown_tool", hint: "The name is not in this version of the Bitwig MCP registry. Check spelling, repository version and target server (Bitwig versus NanoDAW)." };
    } else {
      const spec = specs.get(tool);
      const status = exposed.has(tool) ? "exposed" : spec ? "policy_blocked" : "tool_unavailable";
      result.tool = {
        name: tool,
        ...(spec ? { policy: spec.policy } : {}),
        status,
        hint: status === "exposed" ? RELOAD_HINT
          : status === "policy_blocked"
            ? "This tool is hidden by the effective write policy. A client reload alone will not enable it. Do not enable writes without explicit human authorization."
            : "Optional discovery is disabled. BITWIG_MCP_TOOL_DISCOVERY=1 exposes these wrappers without enabling write policies; restart the MCP server and reload the client list after configuration changes.",
      };
    }
  }
  return result;
}

function formatText(result) {
  return [
    "Beat Twin MCP: local configuration only (DAW not contacted; client cache not inspected)",
    `Enabled policies: ${result.enabledPolicies.join(", ") || "none"}`,
    `Disabled policies: ${result.disabledPolicies.join(", ") || "none"}`,
    `Exposed tools (${result.exposedToolCount}): ${result.exposedTools.join(", ")}`,
    ...(result.tool ? [`Tool: ${result.tool.name ?? "unrecognized name"} -> ${result.tool.status}`, result.tool.hint] : []),
    ...(result.tool?.hint === RELOAD_HINT ? [] : [RELOAD_HINT]),
    result.safety,
  ].join("\n") + "\n";
}

export async function runDiagnostic(argv, {
  env = process.env,
  loadRegistry = () => import("../index.js"),
  stdout = (text) => process.stdout.write(text),
  stderr = (text) => process.stderr.write(text),
} = {}) {
  const json = argv.includes("--json");
  const fail = (error, message) => {
    if (json) stdout(JSON.stringify({ error, message }) + "\n");
    else stderr(`${error}: ${message}\n`);
    return 2;
  };
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    stdout(`${USAGE}\nOffline metadata only. Exit: 0 listed/exposed, 1 unavailable tool, 2 usage/load failure.\n`);
    return 0;
  }
  let tool;
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!["--json", "--tool"].includes(arg) || seen.has(arg)) return fail("invalid_arguments", USAGE);
    seen.add(arg);
    if (arg === "--tool") {
      tool = argv[++i];
      if (typeof tool !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(tool)) {
        return fail("invalid_arguments", USAGE);
      }
    }
  }
  try {
    const registry = await loadRegistry();
    const result = diagnoseToolConfiguration({ registry, env, tool });
    stdout(json ? JSON.stringify(result) + "\n" : formatText(result));
    return result.tool && result.tool.status !== "exposed" ? 1 : 0;
  } catch {
    // Module errors can include sensitive paths or environment values.
    return fail("diagnostic_unavailable", "Cannot inspect local registry metadata. Check this checkout and its documented Node version; no tool was intentionally called.");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runDiagnostic(process.argv.slice(2));
}
