#!/usr/bin/env node

import {
  diagnoseBitwigConnection,
  inspectBitwigSession,
} from "../index.js";

function countItems(value) {
  return Array.isArray(value) ? value.length : 0;
}

function summarizeReadErrors(readErrors) {
  return Object.fromEntries(
    Object.entries(readErrors ?? {}).filter(([, error]) => Boolean(error)),
  );
}

async function main() {
  const diagnostic = await diagnoseBitwigConnection();
  if (!diagnostic.connected) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          phase: "tcp-connectivity",
          diagnostic,
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  const inspection = await inspectBitwigSession();
  const readErrors = summarizeReadErrors(inspection.read_errors);
  const ok = inspection.connected && inspection.scope === "read-only";

  console.log(
    JSON.stringify(
      {
        ok,
        phase: "read-only-inspection",
        diagnostic,
        session: {
          connected: inspection.connected,
          scope: inspection.scope,
          tempo: inspection.transport?.tempo ?? null,
          position: inspection.transport?.position ?? null,
          is_playing: inspection.transport?.isPlaying ?? null,
          is_recording: inspection.transport?.isRecording ?? null,
          visible_tracks: countItems(inspection.trackBank),
          visible_scenes: countItems(inspection.scenes),
          selected_track: inspection.selectedTrack?.name ?? null,
          selected_device: inspection.selectedDevice?.name ?? null,
          read_errors: readErrors,
        },
      },
      null,
      2,
    ),
  );

  process.exit(ok ? 0 : 2);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        phase: "read-only-inspection",
        error: error.message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
