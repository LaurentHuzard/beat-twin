import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(packageRoot, "src");
const outputRoot = resolve(packageRoot, "dist");
const files = [
  "index.js",
  "index.d.ts",
  "browser-nanodaw-websocket.js",
  "browser-nanodaw-websocket.d.ts",
];

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
for (const file of files) copyFileSync(resolve(sourceRoot, file), resolve(outputRoot, file));
