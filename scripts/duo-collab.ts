import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import {
  runDuoCollaboration,
  type DuoEndpoint,
} from "./duo-collab-core.ts";

type Scenario = {
  readonly task?: string;
  readonly witnessEvidence?: string;
};

const args = parseArgs(process.argv.slice(2));
if (args.help === "true") {
  printHelp();
  process.exit(0);
}

const scenario = args.scenario === undefined
  ? {}
  : await loadScenario(args.scenario);

const task = args.task ?? scenario.task;
const witnessEvidence = args["witness-file"] !== undefined
  ? await readFile(args["witness-file"], "utf8")
  : args.witness ?? scenario.witnessEvidence;

if (!task?.trim() || !witnessEvidence?.trim()) {
  printHelp();
  throw new Error("task and witness evidence are required");
}

const mue: DuoEndpoint = {
  id: "mue",
  role: "analyst",
  baseUrl: process.env.MUE_BASE_URL ?? "http://mue.orbit:8003/",
  model: process.env.MUE_MODEL ?? "gemma4_e4b",
  apiKey: process.env.MUE_API_KEY ?? process.env.LITERT_API_KEY,
};

const androidBaseUrl = process.env.ANDROID_BASE_URL?.trim();
if (!androidBaseUrl) {
  throw new Error("ANDROID_BASE_URL is required");
}

const android: DuoEndpoint = {
  id: "android",
  role: "witness",
  baseUrl: androidBaseUrl,
  model: process.env.ANDROID_MODEL ?? "android-scout",
  apiKey: process.env.ANDROID_API_KEY,
};

const transcript = await runDuoCollaboration({
  task,
  witnessEvidence,
  mue,
  android,
});

const output = JSON.stringify(transcript, null, 2) + "\n";
if (args.out) {
  await writeFile(args.out, output, "utf8");
  console.error("TwinPilot Duo transcript written to " + args.out);
} else {
  process.stdout.write(output);
}

async function loadScenario(path: string): Promise<Scenario> {
  const raw = await readFile(path, "utf8");
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("scenario must be a JSON object");
  }
  return value as Scenario;
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--help" || token === "-h") {
      result.help = "true";
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error("unexpected argument: " + token);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("missing value for --" + key);
    }
    result[key] = value;
    index += 1;
  }
  return result;
}

function printHelp(): void {
  console.log([
    "TwinPilot Duo Android <-> MUE spike",
    "",
    "Usage:",
    "  pnpm duo:spike -- --scenario experiments/duo/scenarios/private-evidence.json",
    "  pnpm duo:spike -- --task \"...\" --witness \"...\" [--out /tmp/duo.json]",
    "  pnpm duo:spike -- --task \"...\" --witness-file /path/to/evidence.txt",
    "",
    "Environment:",
    "  ANDROID_BASE_URL   required, e.g. http://android-a:8080/",
    "  ANDROID_MODEL      default: android-scout",
    "  ANDROID_API_KEY    optional",
    "  MUE_BASE_URL       default: http://mue.orbit:8003/",
    "  MUE_MODEL          default: gemma4_e4b",
    "  MUE_API_KEY        optional; falls back to LITERT_API_KEY",
  ].join("\n"));
}
