import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TOOL_SPECS, getToolDefinitions } from "../index.js";

test("all 164 historical rows reconcile with native, external, adapted and optional source entries", async () => {
  const text = await readFile(new URL("../docs/BITWIG_MCP_PARITY.md", import.meta.url), "utf8");
  const rows = [...text.matchAll(/^\| `([^`]+)` \| ([^|]+) \|/gm)].map((match) => ({ name: match[1], category: match[2].trim() }));
  assert.equal(rows.length, 164);
  assert.equal(new Set(rows.map((row) => row.name)).size, 164);
  const direct = new Map(TOOL_SPECS.map((tool) => [tool.name, tool]));
  const exposed = new Set(getToolDefinitions({ env: { BITWIG_MCP_ENABLE_WRITES: "1", BITWIG_MCP_TOOL_DISCOVERY: "1" } }).map((tool) => tool.name));
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.category] = (counts[row.category] ?? 0) + 1;
    if (row.category === "Stub") {
      assert.equal(row.name, "arranger_cues_color");
      assert.equal(exposed.has(row.name), false);
    } else if (row.category === "Discovery alias") {
      assert.equal(direct.has(row.name), false);
      assert.equal(exposed.has(row.name), true);
    } else {
      assert.equal(direct.has(row.name), true, row.name);
      if (row.category === "External adapter") assert.equal(direct.get(row.name)?.policy, "audio_capture");
      if (row.category === "Adapted 6") assert.equal(row.name, "browser_set_filter");
    }
  }
  assert.deepEqual(counts, {
    "Discovery alias": 2, Current: 47, "External adapter": 6,
    "Ported 1": 13, "Ported 2": 9, "Ported 3": 21, "Ported 4": 22,
    "Ported 5": 33, "Ported 6": 9, "Adapted 6": 1, Stub: 1,
  });
});
