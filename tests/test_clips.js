import { TestClient } from "./TestClient.js";
import assert from "assert";

async function run() {
    console.log("=== Starting Clip Launcher Tests ===");
    const client = new TestClient();
    
    try {
        await client.connect();
        console.log("Connected.");

        // 1. List Scenes
        console.log("Listing scenes...");
        const scenes = await client.callTool("scene_list");
        console.log(`Found ${scenes.length} scenes.`);
        assert(Array.isArray(scenes), "scene_list should return an array");
        // assert(scenes.length === 8, "Should have 8 scenes based on script init");

        // 2. Launch Scene 0
        console.log("Launching Scene 0...");
        const launchRes = await client.callTool("scene_launch", { sceneIndex: 0 });
        assert.strictEqual(launchRes, "OK");
        await client.wait(500); // Wait for launch quantization

        // 3. Launch Clip (Track 0, Slot 1)
        console.log("Launching Clip (Track 0, Slot 1)...");
        const clipRes = await client.callTool("clip_launch", { trackIndex: 0, slotIndex: 1 });
        assert.strictEqual(clipRes, "OK");
        await client.wait(500);

        // 4. Stop Track 0
        console.log("Stopping Track 0...");
        const stopRes = await client.callTool("clip_stop", { trackIndex: 0 });
        assert.strictEqual(stopRes, "OK");

        console.log("=== Clip Launcher Tests Passed ===");

    } catch (error) {
        console.error("Test Failed:", error);
        process.exit(1);
    } finally {
        await client.disconnect();
    }
}

run();
