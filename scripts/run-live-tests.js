#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testsDir = path.join(rootDir, "tests");

function runTest(file) {
  return new Promise((resolve, reject) => {
    console.log(`\nRunning ${file}...`);
    const child = spawn("node", [path.join(testsDir, file)], {
      cwd: rootDir,
      stdio: "inherit",
      env: {
        ...process.env,
        BITWIG_MCP_ENABLE_WRITES: process.env.BITWIG_MCP_ENABLE_WRITES ?? "1",
      },
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Live test ${file} failed with code ${code}`));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node scripts/run-live-tests.js [test_name_filter]");
    console.log("Runs legacy live MCP tests against a local Bitwig session.");
    return;
  }

  const files = fs
    .readdirSync(testsDir)
    .filter((file) => file.startsWith("test_") && file.endsWith(".js"));

  const targetFiles =
    args.length > 0 ? files.filter((file) => file.includes(args[0])) : files;

  if (targetFiles.length === 0) {
    console.log("No live tests found matching the requested filter.");
    return;
  }

  for (const file of targetFiles) {
    await runTest(file);
  }

  console.log("\nLive tests completed successfully.");
}

main().catch((error) => {
  console.error("\nLive test suite failed:", error.message);
  process.exit(1);
});
