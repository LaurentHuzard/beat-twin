import { expect, test } from "@playwright/test";
import { fixtureMidi } from "../src/test/midiFixture";

test("local MIDI preview is readonly and explicit keyboard add is undoable", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/");
  await page.getByRole("button", { name: "Start Jam" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const panel = page.getByRole("region", { name: "Import MIDI", exact: true });
  const storage = await page.evaluate(() => localStorage.getItem("beat-twin.playground.song.v1"));
  const fileBox = await panel.getByLabel("Local MIDI file").boundingBox();
  expect(fileBox!.height).toBeGreaterThanOrEqual(44);
  const choose = async () => panel.getByLabel("Local MIDI file").setInputFiles({ name:"seed.mid", mimeType:"audio/midi", buffer:Buffer.from(fixtureMidi()) });
  await choose();
  const add = panel.getByRole("button",{name:"Add MIDI tracks"});
  await expect(add).toBeVisible();
  await expect(panel).toContainText("1 new track · 1 note · Source 120.00 BPM");
  await expect(panel).toContainText("Current tempo stays at 124 BPM");
  expect(await page.evaluate(() => localStorage.getItem("beat-twin.playground.song.v1"))).toBe(storage);
  await panel.getByRole("button",{name:"Discard MIDI preview"}).click();
  await expect(panel.getByLabel("Local MIDI file")).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("beat-twin.playground.song.v1"))).toBe(storage);
  await choose();
  await panel.getByText("Review notes in Seed · Ch 1",{exact:true}).focus();
  const summaryBox = await panel.getByText("Review notes in Seed · Ch 1",{exact:true}).boundingBox();
  expect(summaryBox!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Enter");
  const noteTable = panel.getByRole("table",{name:"Notes in Seed · Ch 1"});
  await expect(noteTable).toBeVisible();
  await expect(noteTable.getByRole("row").nth(1)).toContainText("6010001");
  await add.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(add).toBeFocused();
  await page.screenshot({path:testInfo.outputPath("preview.png"),fullPage:true});
  if (testInfo.project.name === "desktop-chromium") {
    await page.setViewportSize({width:768,height:1024});
    await expect(add).toBeVisible();
    await page.screenshot({path:testInfo.outputPath("preview-tablet.png"),fullPage:true});
  }
  if (process.env.BEAT_MIDI_AXE_SCRIPT) {
    await page.addScriptTag({ path: process.env.BEAT_MIDI_AXE_SCRIPT });
    const audit = await page.evaluate(async () => (window as any).axe.run(document.querySelector('[aria-label="Import MIDI"]')));
    await testInfo.attach("midi-panel-axe", { body: JSON.stringify({violations:audit.violations,incomplete:audit.incomplete,passes:audit.passes.length}), contentType:"application/json" });
    expect(audit.violations).toEqual([]);
    expect(audit.incomplete).toEqual([]);
  }
  const box = await add.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x+box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("status")).toContainText("MIDI tracks added");
  await expect(panel.getByLabel("Local MIDI file")).toBeFocused();
  const imported = JSON.parse((await page.evaluate(() => localStorage.getItem("beat-twin.playground.song.v1")))!);
  expect(imported.tracks.length).toBe(3);
  expect(imported.transport.bpm).toBe(124);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("beat-twin.playground.song.v1")))!)).toEqual(JSON.parse(storage!));
  expect(errors).toEqual([]);
});

test("real stale preview and malformed file refuse without an extra song save, corrected file recovers", async ({page}) => {
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.emulateMedia({reducedMotion:"reduce"});await page.goto("/");
  await page.getByRole("button",{name:"Start Jam"}).click();
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  const panel=page.getByRole("region",{name:"Import MIDI",exact:true});
  const choose=()=>panel.getByLabel("Local MIDI file").setInputFiles({name:"synthetic.mid",mimeType:"audio/midi",buffer:Buffer.from(fixtureMidi())});
  await choose();await panel.getByRole("button",{name:"Add MIDI tracks"}).click();
  await choose();await expect(panel.getByRole("button",{name:"Add MIDI tracks"})).toBeEnabled();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(panel.getByRole("alert")).toContainText("Song changed since preview");
  await expect(panel.getByRole("button",{name:"Add MIDI tracks"})).toBeDisabled();
  const before=await page.evaluate(()=>localStorage.getItem("beat-twin.playground.song.v1"));
  await panel.getByLabel("Local MIDI file").setInputFiles({name:"malformed.mid",mimeType:"audio/midi",buffer:Buffer.alloc(14)});
  await expect(panel.getByRole("alert")).toContainText("Invalid Standard MIDI header");
  await expect(panel.getByRole("button",{name:"Add MIDI tracks"})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem("beat-twin.playground.song.v1"))).toBe(before);
  await choose();await expect(panel.getByRole("button",{name:"Add MIDI tracks"})).toBeEnabled();
  expect(await page.evaluate(()=>localStorage.getItem("beat-twin.playground.song.v1"))).toBe(before);
  expect(errors).toEqual([]);
});

test("focused chooser survives deferred reading, same-file selection and errors without stealing another control's focus", async ({page}) => {
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      return new Promise<ArrayBuffer>((resolve,reject) => {
        (window as any).__releaseMidiRead = () => { read.call(this).then(resolve,reject); };
      });
    };
  });
  await page.emulateMedia({reducedMotion:"reduce"});await page.goto("/");
  await page.getByRole("button",{name:"Start Jam"}).click();
  const settings=page.getByRole("button",{name:"Settings",exact:true});await settings.click();
  const panel=page.getByRole("region",{name:"Import MIDI",exact:true});
  const input=panel.getByLabel("Local MIDI file");
  for(const leave of [false,true]) {
    await input.focus();
    await input.setInputFiles({name:"same.mid",mimeType:"audio/midi",buffer:Buffer.from(fixtureMidi())});
    await expect(panel.getByRole("status")).toContainText("Reading local MIDI");
    await expect(input).toBeFocused();
    if(leave)await settings.focus();
    await page.evaluate(() => { (window as any).__releaseMidiRead(); });
    await expect(panel.getByRole("button",{name:"Add MIDI tracks"})).toBeVisible();
    await expect(leave?settings:input).toBeFocused();
    expect(await input.inputValue()).toBe("");
  }
  await input.focus();await input.setInputFiles({name:"bad.mid",mimeType:"audio/midi",buffer:Buffer.alloc(14)});
  await page.evaluate(() => { (window as any).__releaseMidiRead(); });
  await expect(panel.getByRole("alert")).toContainText("Invalid Standard MIDI header");await expect(input).toBeFocused();
  await input.setInputFiles({name:"large.mid",mimeType:"audio/midi",buffer:Buffer.alloc(1024*1024+1)});
  await expect(panel.getByRole("alert")).toContainText("no larger than 1 MiB");await expect(input).toBeFocused();
  await input.setInputFiles({name:"pending.mid",mimeType:"audio/midi",buffer:Buffer.from(fixtureMidi())});
  await expect(panel.getByRole("status")).toContainText("Reading local MIDI");
  await input.setInputFiles({name:"large.mid",mimeType:"audio/midi",buffer:Buffer.alloc(1024*1024+1)});
  await expect(panel.getByRole("status")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__releaseMidiRead(); });
  await expect(panel.getByRole("alert")).toContainText("no larger than 1 MiB");
  await expect(panel.getByRole("button",{name:"Add MIDI tracks"})).toHaveCount(0);
});
