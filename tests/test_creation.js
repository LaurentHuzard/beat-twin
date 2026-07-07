// Live-only test: requires Bitwig Studio + write policy; run via `pnpm test:live`.
import { TestClient } from "./TestClient.js";
import assert from "assert";

async function run() {
    console.log("=== Starting Creation Tools Tests ===");
    const client = new TestClient();
    
    try {
        await client.connect();
        console.log("Connected.");

        // 1. Create a Scene
        console.log("Testing scene_create...");
        const sceneRes = await client.callTool("scene_create");
        const sceneOk = sceneRes && sceneRes.result !== undefined ? sceneRes.result : sceneRes;
        assert.strictEqual(sceneOk, "OK");

        // 2. Create a Clip (Track 0, Slot 3, 4 beats)
        console.log("Testing clip_create (Track 0, Slot 3, 4 beats)...");
        const clipRes = await client.callTool("clip_create", { 
            trackIndex: 0, 
            slotIndex: 3, 
            lengthBeats: 4
        });
        const clipOk = clipRes && clipRes.result !== undefined ? clipRes.result : clipRes;
        assert.strictEqual(clipOk, "OK");

        console.log("=== Creation Tools Tests Passed ===");

    } catch (error) {
        console.error("Test Failed:", error);
        process.exit(1);
    } finally {
        await client.disconnect();
    }
}

run();
