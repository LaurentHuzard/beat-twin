import { expect, test } from "@playwright/test";

test("standalone settings make no unsupported claim about optional connections", async ({ page }, testInfo) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", request => {
    if (request.method() !== "GET") requests.push(request.method());
  });
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await expect(page).toHaveTitle("NanoDAW");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Runtime mode")).toContainText("Standalone");
  await expect(page.getByLabel("Runtime mode")).toContainText("Check their connection in Bitwig Remote or TWIN.");
  await expect(page.getByLabel("Runtime mode")).not.toContainText("not enabled");
  await expect(page.getByRole("button", { name: "Open Jam", exact: true })).toBeDisabled();
  const icon = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(icon).toMatch(/^data:image\/svg\+xml,/);
  expect(await page.evaluate(async href => {
    const image = new Image();
    image.src = href!;
    await image.decode();
    return image.naturalWidth;
  }, icon)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.screenshot({ path: testInfo.outputPath("beat-settings.png"), fullPage: true });
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
