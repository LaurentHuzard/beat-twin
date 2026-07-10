import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_SPECS } from "../index.js";

const snapshot = JSON.parse(
  await readFile(new URL("./fixtures/tool-specs.snapshot.json", import.meta.url), "utf8"),
);

test("keeps the historical 57-tool Bitwig MCP surface stable", () => {
  const tools = TOOL_SPECS.map(({ name, policy }) => [name, policy]);
  const schemas = TOOL_SPECS.map(({ name, policy, inputSchema }) => ({
    name,
    policy,
    inputSchema,
  }));
  const digest = createHash("sha256").update(JSON.stringify(schemas)).digest("hex");

  assert.equal(TOOL_SPECS.length, snapshot.count);
  assert.equal(new Set(TOOL_SPECS.map(({ name }) => name)).size, snapshot.count);
  assert.deepEqual(tools, snapshot.tools);
  assert.equal(digest, snapshot.schemaDigest);
});
