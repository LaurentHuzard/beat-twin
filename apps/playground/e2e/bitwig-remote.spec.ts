import { expect, test } from "@playwright/test";

const disconnectedSnapshot = {
  bridge: {
    scope: "loopback",
    sessionTool: "bitwig_session_inspect",
  },
  commands: [],
  session: {
    connected: false,
    error: "Synthetic browser QA: Bitwig is not running.",
    setup_hint: "Start Bitwig Studio and enable the Beat Twin controller, then refresh.",
  },
};

test("Bitwig Remote stays honest and inert while the DAW is unavailable", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const commandRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/bitwig/command")) {
      commandRequests.push(request.url());
    }
  });
  await page.route("**/api/bitwig/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(disconnectedSnapshot) }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Open Bitwig Remote" }).click();

  await expect(page.getByRole("main", { name: "Bitwig Remote" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bitwig is not connected" })).toBeVisible();
  await expect(page.getByLabel("Bridge security")).toContainText("Secrets stay server-side");
  await expect(page.getByRole("button", { name: "Play" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop" })).toBeDisabled();
  await expect(page.getByText(/transport writes are locked/i)).toBeVisible();
  await expect(page.locator("html")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => innerWidth),
  );
  expect(commandRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("bitwig-remote.png"), fullPage: true });

  await page.getByRole("button", { name: "NanoDAW" }).click();
  await expect(page.getByRole("heading", { name: "Start with one musical move." })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("Bitwig command endpoint rejects untrusted and non-JSON requests before dispatch", async ({
  request,
  baseURL,
}) => {
  const payload = JSON.stringify({
    tool: "transport_play",
    arguments: {},
    confirmation: "transport_play",
  });
  const untrusted = await request.post("/api/bitwig/command", {
    headers: {
      Origin: "https://example.com",
      "Content-Type": "application/json",
    },
    data: payload,
  });
  expect(untrusted.status()).toBe(403);
  await expect(untrusted.json()).resolves.toMatchObject({ error: "untrusted_origin" });

  const wrongMediaType = await request.post("/api/bitwig/command", {
    headers: {
      Origin: baseURL ?? "http://127.0.0.1:5522",
      "Content-Type": "text/plain",
    },
    data: payload,
  });
  expect(wrongMediaType.status()).toBe(415);
  await expect(wrongMediaType.json()).resolves.toMatchObject({
    error: "unsupported_media_type",
  });
});
