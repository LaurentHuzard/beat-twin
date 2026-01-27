loadAPI(25);
host.defineController("TestVendor", "SimpleTest", "1.1", "550e8400-e29b-41d4-a716-446655440001", "Test");
host.defineMidiPorts(0, 0);
function init() {
    println("SIMPLE TEST (API 1) LOADED!");
    host.showPopupNotification("Simple Test Loaded (API 1312)");
}
function exit() { }
function flush() { }
