import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@beat-twin/audio-tone": fileURLToPath(
        new URL("../../packages/audio-tone/src/index.ts", import.meta.url),
      ),
      "@beat-twin/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
      "@beat-twin/commands": fileURLToPath(
        new URL("../../packages/commands/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
