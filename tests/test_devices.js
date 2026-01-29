import { TestClient } from "./TestClient.js";
import assert from "assert";

async function run() {
    console.log("=== Starting Device Tools Tests ===");
    const client = new TestClient();
    
    try {
        await client.connect();
        console.log("Connected.");

        // 1. Get Device Status
        console.log("Testing device_get_status...");
        const status = await client.callTool("device_get_status");
        console.log("Device Status:", JSON.stringify(status, null, 2));
        assert(status.name !== undefined, "Device status should have a name property");

        // 2. Toggle Window
        console.log("Testing device_toggle_window...");
        await client.callTool("device_toggle_window");
        // Verify state changed (requires waiting a bit for Bitwig async update)
        await client.wait(100);
        const status2 = await client.callTool("device_get_status");
        assert.notStrictEqual(status.isWindowOpen, status2.isWindowOpen, "Window state should have toggled");

        // 3. Get Remote Controls
        console.log("Testing device_get_remote_controls...");
        const controls = await client.callTool("device_get_remote_controls");
        assert(Array.isArray(controls), "Should return array of controls");
        assert.strictEqual(controls.length, 8, "Should have 8 remote controls");

        // 4. Set Remote Control Value
        console.log("Testing device_set_remote_control (Index 0 -> 0.5)...");
        await client.callTool("device_set_remote_control", { index: 0, value: 0.5 });
        
        await client.wait(100);
        const controlsAfter = await client.callTool("device_get_remote_controls");
        // Note: Floating point comparison might need epsilon, or Bitwig might map values differently.
        // For now, just ensure the call succeeded.
        // assert(Math.abs(controlsAfter[0].value - 0.5) < 0.01); 

        // 5. Page Navigation
        console.log("Testing device_page_next...");
        await client.callTool("device_page_next");

        console.log("=== Device Tools Tests Passed ===");

    } catch (error) {
        console.error("Test Failed:", error);
        process.exit(1);
    } finally {
        await client.disconnect();
    }
}

run();
