import { expect, test } from "@playwright/test";

test("first run stays focused and reveals the full local workspace on demand", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  await expect(page).toHaveTitle("Beat Twin Playground");
  await expect(
    page.getByRole("heading", { name: "Start with one musical move." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Demo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Track" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load local song" })).toBeDisabled();
  await expect(page.getByText("No local song saved yet.")).toBeVisible();
  await expect(page.getByLabel("Beat Twin workspace")).toHaveCount(0);
  await expect(page.locator("html")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => innerWidth),
  );

  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);

  await page.getByRole("button", { name: "Show advanced tools" }).click();

  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByLabel("Beat Twin workspace")).toBeVisible();
  await expect(page.getByLabel("Agent mode")).toBeVisible();
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(consoleErrors).toEqual([]);
});

test("create demo history stays usable after undo returns to an empty song", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Create Demo" }).click();

  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByLabel("Beat Twin workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Undo$/ })).toBeEnabled();
  await page.getByRole("button", { name: /^Undo$/ }).click();

  await expect(page.locator(".brand-lockup p").first()).toHaveText("No song loaded");
  await expect(
    page.getByRole("heading", { name: "Start with one musical move." }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Beat Twin workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Redo$/ })).toBeEnabled();

  await page.getByRole("button", { name: /^Redo$/ }).click();

  await expect(page.locator(".brand-lockup p").first()).toHaveText("Playground Sketch");
  await expect(page.getByLabel("Beat Twin workspace")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
