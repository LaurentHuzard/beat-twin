import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("settings exports a local MIDI using keyboard and leaves saved song untouched", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Start Jam" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const button = page.getByRole("button", { name: "Export MIDI", exact: true });
  await expect(button).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  await button.focus();
  await expect(button).toBeFocused();
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("beat-twin.mid");
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 4).toString()).toBe("MThd");
  expect(bytes.readUInt16BE(8)).toBe(1);
  expect(bytes.readUInt16BE(12)).toBe(480);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storage);
  await expect(page.getByRole("region", { name: "Settings" }).getByRole("status")).toContainText("MIDI download requested");
  await expect(button).toBeFocused();
  const box = await button.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.screenshot({ path: `/tmp/beat-midi-${testInfo.project.name}.png`, fullPage: true });
  if (testInfo.project.name === "desktop-chromium") {
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(button).toBeVisible();
    await page.screenshot({ path: "/tmp/beat-midi-tablet.png", fullPage: true });
  }
  expect(errors).toEqual([]);
});
