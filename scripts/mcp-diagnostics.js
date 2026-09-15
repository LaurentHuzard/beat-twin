#!/usr/bin/env node
// Offline configuration inspection. No SDK, socket, provider or DAW calls.
import { constants, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getMcpDiagnostics } from "../index.js";

const MAX_FILE_BYTES = 65536;
const help = `Usage: node scripts/mcp-diagnostics.js [--json] [--client-tools FILE]
Inspect local Bitwig MCP policies and tool names without contacting a DAW.
--client-tools FILE  Compare a complete tools/list result or a JSON name array.
--json               Emit one JSON record (including errors).
--help               Show this help.
Exit codes: 0 report/match, 1 tool-list mismatch, 2 invalid arguments/input.
`;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function readClientNames(path) {
  let descriptor;
  let text;
  try {
    // Non-blocking open plus a regular-file check prevents FIFO/device hangs.
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error();
    // Bound the read even if the file grows after fstat; never load arbitrary size.
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(descriptor, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > MAX_FILE_BYTES) throw new Error();
    text = bytes.toString("utf8", 0, size);
  } catch {
    throw failure("client_tool_list_unreadable", "Client tool list must be a readable regular JSON file no larger than 65536 bytes.");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw failure("invalid_client_tool_list", "Client tool list must contain valid JSON.");
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.tools)) {
    if (parsed.nextCursor !== undefined && parsed.nextCursor !== null) {
      throw failure("incomplete_client_tool_list", "Collect all tools/list pages before comparing the client tool list.");
    }
    return parsed.tools.map((tool) => tool?.name);
  }
  throw failure("invalid_client_tool_list", "Expected a JSON tool-name array or a complete tools/list result with a tools array.");
}

export function runMcpDiagnostics(args = process.argv.slice(2), env = process.env) {
  // Detect JSON mode before validation so even argument failures are parseable.
  const json = args.includes("--json");
  try {
    let clientFile;
    let seenJson = false;
    if (args.length === 1 && args[0] === "--help") {
      console.log(help.trimEnd());
      return 0;
    }
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--json" && !seenJson) {
        seenJson = true;
      } else if (args[i] === "--client-tools" && clientFile === undefined &&
                 args[i + 1] && !args[i + 1].startsWith("--")) {
        clientFile = args[++i];
      } else {
        throw failure("invalid_arguments", "Use --json once and/or --client-tools FILE once, or --help alone.");
      }
    }
    const report = getMcpDiagnostics({
      env,
      ...(clientFile === undefined ? {} : { clientToolNames: readClientNames(clientFile) }),
    });
    if (json) {
      console.log(JSON.stringify(report));
    } else {
      const comparison = report.client_tool_list;
      const lines = [
        "Local Bitwig MCP configuration (no DAW access)",
        `Mode: ${report.mode}; enabled: ${report.enabled_policies.join(", ")}; disabled: ${report.disabled_policies.join(", ") || "none"}`,
        `Discovery: ${report.discovery_enabled ? "enabled" : "disabled"}; tools (${report.tool_count}): ${report.exposed_tools.join(", ")}`,
        `Client list: ${comparison.error ?? comparison.status}`,
      ];
      if (comparison.status === "mismatch") {
        lines.push(`Missing: ${comparison.missing.join(", ") || "none"}; no longer exposed: ${comparison.no_longer_exposed.join(", ") || "none"}; unrecognized: ${comparison.unrecognized_count}`);
        lines.push(comparison.hint);
      }
      lines.push(report.reload_hint);
      console.log(lines.join("\n"));
    }
    return report.client_tool_list.status === "mismatch" ? 1 : 0;
  } catch (error) {
    const allowed = new Set(["invalid_arguments", "invalid_client_tool_list", "incomplete_client_tool_list", "client_tool_list_unreadable"]);
    // No raw OS/parser errors, paths, configuration values or client names.
    const result = allowed.has(error?.code)
      ? { error: error.code, message: error.message }
      : { error: "diagnostic_failed", message: "Local MCP diagnostics could not be completed." };
    console.log(json ? JSON.stringify(result) : `${result.error}: ${result.message}`);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = runMcpDiagnostics();
}
