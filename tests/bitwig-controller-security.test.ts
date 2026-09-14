import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../bitwig-controller/BeatTwin/BeatTwin.control.js", import.meta.url),
  "utf8",
);

test("controller uses outbound loopback with no secret setting or network listener", () => {
  assert.match(source, /host.connectToRemoteHost\("127.0.0.1", 8889/);
  assert.doesNotMatch(source, /createRemoteConnection|bridgeSecretSetting|Bridge secret/);
  assert.match(source, /authentication: "local-only"/);
});

test("controller exposes bounded target identity and exact note readback methods", () => {
  assert.match(source, /case "bridge\.identity":/);
  assert.match(source, /case "target\.inspect":/);
  assert.match(source, /controllerInstanceId/);
  assert.match(source, /trackPosition/);
  assert.match(source, /slotSceneIndex/);
  assert.match(source, /targetGeneration/);
  assert.match(source, /boundedCursorClip\.getStep\(0, step, pitch\)/);
  assert.match(source, /boundedCursorClip\.scrollToStep\(0\)/);
  assert.match(source, /boundedCursorClip\.scrollToKey\(0\)/);
  assert.match(source, /TARGET_GRID_STEPS = 64/);
  assert.match(source, /TARGET_STEP_SIZE_BEATS = 0\.25/);
});

test("controller binds a human-selected empty bank slot before falling back to a clip cursor", () => {
  assert.match(source, /var targetTracks = \[\]/);
  assert.match(source, /var targetSlots = \[\]/);
  assert.match(source, /slot\.isSelected\(\)\.markInterested\(\)/);
  assert.match(source, /slot\.isSelected\(\)\.addValueObserver\(refreshTargetGeneration\)/);
  const selectedTarget = source.indexOf("var selected = selectedBankTarget()");
  const cursorFallback = source.indexOf("var cursorTrackPosition = cursorClipTrack.position().get()");
  assert.ok(selectedTarget >= 0 && selectedTarget < cursorFallback);
  assert.match(source, /selected\.track\.exists\(\)\.get\(\)/);
  assert.match(source, /selected\.slot\.exists\(\)\.get\(\)/);
  assert.match(source, /return \{ ambiguous: true \}/);
  assert.match(source, /createTarget\.slot\.createEmptyClip\(targetLengthBeats\)/);
  assert.doesNotMatch(source, /cursorClipSlot\.createEmptyClip\(targetLengthBeats\)/);
  assert.match(source, /boundedCursorMatches\(noteTarget\)/);
});

test("target writes validate binding and musical bounds before mutation", () => {
  const bindingCheck = source.indexOf("requireCurrentTarget(noteBinding)");
  const noteMutation = source.indexOf("boundedCursorClip.setStep(0, noteStep");
  assert.ok(bindingCheck >= 0 && bindingCheck < noteMutation);
  assert.match(source, /Note step must be an integer from 0 to 63/);
  assert.match(source, /Note pitch must be an integer from 0 to 127/);
  assert.match(source, /Note velocity must be an integer from 1 to 127/);
  assert.match(source, /Target identity changed; create and confirm a fresh plan/);
  assert.match(source, /case "target\.set_tempo":/);
  assert.match(source, /targetTempoBpm < 40 \|\| targetTempoBpm > 240/);
});

test("controller retries failed connections, uses no secret and stops reconnecting on exit", async () => {
  const { runInNewContext } = await import("node:vm");
  const scheduled: (() => void)[] = [];
  let attempts = 0, disconnected: (() => void) | undefined;
  const replies: string[] = [];
  const connection = { setDisconnectCallback(callback: () => void) { disconnected = callback; },
    setReceiveCallback() {}, disconnect() { disconnected?.(); },
    send(bytes: number[]) { replies.push(String.fromCharCode(...bytes)); } };
  const context: any = { loadAPI() {}, println() {}, host: {
    defineController() {}, scheduleTask(task: () => void) { scheduled.push(task); },
    connectToRemoteHost(host: string, port: number, callback: (connection: unknown) => void) {
      assert.equal(host, "127.0.0.1"); assert.equal(port, 8889);
      attempts++;
      if (attempts === 1) throw new Error("relay not started yet");
      if (attempts === 2) return; // Bitwig may log failure without invoking callback.
      callback(connection);
    },
  } };
  runInNewContext(source, context);
  context.connectLocalBridge();
  scheduled.shift()!(); scheduled.shift()!();
  assert.equal(attempts, 3); assert.equal(context.isConnected, true);
  scheduled.shift()!(); assert.equal(attempts, 3);
  context.handleRequest({ method: "bridge.authenticate", params: [], id: 1 }, connection, { authenticated: true });
  assert.equal(JSON.parse(replies[0]).result.authentication, "local-only");
  disconnected!(); scheduled.shift()!(); assert.equal(attempts, 4);
  context.exit(); scheduled.shift()!(); assert.equal(attempts, 4);
});
