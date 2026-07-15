import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../bitwig-controller/BeatTwin/BeatTwin.control.js", import.meta.url),
  "utf8",
);

test("controller keeps reads open while gating every other method behind session authentication", () => {
  assert.match(source, /bridgeSecretSetting = host\.getPreferences\(\)\.getStringSetting/);
  assert.match(source, /request\.method !== "bridge\.authenticate"/);
  assert.match(source, /!isBridgeReadMethod\(request\.method\)/);
  assert.match(source, /!bridgeSession\.authenticated/);
  assert.match(source, /throw bridgeError\(-32001, "Write authentication is required"\)/);
  assert.doesNotMatch(source, /sendResponse\([^\n]+bridgeSecretSetting\.get/);
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
