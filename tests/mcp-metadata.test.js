import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const example = JSON.parse(
  await readFile(new URL("../llm-mcp/mcp.example.json", import.meta.url), "utf8"),
);

test("publishes generic host dependency metadata without write policy or secrets", () => {
  const server = example.mcpServers?.["beat-twin"];

  assert.ok(server);
  assert.deepEqual(server.requiredProcesses, ["BitwigStudio"]);
  assert.equal(server.command, "node");
  assert.ok(Array.isArray(server.args));

  const env = server.env ?? {};
  assert.deepEqual(Object.keys(env).sort(), ["BITWIG_HOST", "BITWIG_PORT"]);
  assert.equal("BITWIG_MCP_WRITE_POLICY" in env, false);
  assert.equal("BITWIG_MCP_ENABLE_WRITES" in env, false);
  assert.equal(JSON.stringify(example).includes("token"), false);
  assert.equal(JSON.stringify(example).includes("secret"), false);
});
