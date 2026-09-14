import { describe, expect, it, vi } from "vitest";
import { createCommandRuntime, createCommandState } from "@beat-twin/commands";
import { addClip, addNote, addTrack, createClip, createNote, createSong, createTrack } from "@beat-twin/core";
import type { BrowserAudioLease } from "./browserAudioRuntime";
import { createMcpAudioPort, songMaterials } from "./mcpAudioPort";

function fixture() {
  let song = createSong({ id: "s" });
  for (const id of ["bass", "drums"]) {
    song = addTrack(song, createTrack({ id, instrumentId: id as "bass" | "drums" }));
    song = addClip(song, id, createClip({ id: `${id}-c`, trackId: id, lengthBeats: 4 }));
    song = addNote(song, id, `${id}-c`, createNote({ id: `${id}-n`, pitch: 36, startBeat: 0, lengthBeats: 1 }));
  }
  const runtime = createCommandRuntime(createCommandState(song));
  const engine = { initialize: vi.fn(), reset: vi.fn(), unlock: vi.fn(async () => {}), scheduleTransitions: vi.fn(async (_requests: unknown) => ({ ok: true })), start: vi.fn(), stop: vi.fn() };
  const release = vi.fn();
  const lease = { owner: "song", engine, release } as unknown as BrowserAudioLease;
  const execute = vi.fn((request) => runtime.executeCommandBatch(request));
  const acquire = vi.fn(async () => lease);
  const port = createMcpAudioPort({ inspect: () => runtime.inspect(), execute, acquire });
  return { song, runtime, engine, release, execute, acquire, port, lease };
}

describe("confirmed browser song audio", () => {
  it("schedules all instrument tracks, then applies one batch and starts; stop releases the lease", async () => {
    const f = fixture();
    const played = await f.port.executeCommandBatch({ requestId: "play", expectedRevision: 0, commands: [{ type: "StartPlayback" }] });
    expect(played.ok).toBe(true);
    expect(f.runtime.inspect().revision).toBe(1);
    expect(f.engine.scheduleTransitions.mock.calls[0]![0]).toHaveLength(2);
    expect(f.engine.start).toHaveBeenCalledWith(0);
    expect(f.port.isPlaying()).toBe(true);
    const stopped = await f.port.executeCommandBatch({ requestId: "stop", expectedRevision: 1, commands: [{ type: "StopPlayback" }] });
    expect(stopped.ok).toBe(true); expect(f.release).toHaveBeenCalledTimes(1); expect(f.port.isPlaying()).toBe(false);
  });
  it("does not acquire audio or mutate for stale requests", async () => {
    const f = fixture();
    const result = await f.port.executeCommandBatch({ requestId: "stale", expectedRevision: 8, commands: [{ type: "StartPlayback" }] });
    expect(result.ok).toBe(false); expect(f.acquire).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
  it("rechecks revision after unlock and frees prepared audio without starting on a race", async () => {
    const f = fixture();
    f.engine.unlock.mockImplementation(async () => { f.runtime.executeCommandBatch({ requestId: "human-edit", expectedRevision: 0, commands: [{ type: "SetTempo", bpm: 140 }] }); });
    const result = await f.port.executeCommandBatch({ requestId: "race", expectedRevision: 0, commands: [{ type: "StartPlayback" }] });
    expect(result.ok).toBe(false); expect(f.engine.start).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it("rejects autoplay/lease failure without applying the document", async () => {
    const f = fixture();
    f.engine.unlock.mockRejectedValue(new Error("autoplay rejected"));
    await expect(f.port.executeCommandBatch({ requestId: "blocked", expectedRevision: 0, commands: [{ type: "StartPlayback" }] })).rejects.toThrow("autoplay rejected");
    expect(f.execute).not.toHaveBeenCalled(); expect(f.runtime.inspect().revision).toBe(0); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it("a stop during preparation cancels the pending start", async () => {
    const f = fixture();
    f.engine.unlock.mockImplementation(async () => { f.port.stop(); });
    await expect(f.port.executeCommandBatch({ requestId: "cancel", expectedRevision: 0, commands: [{ type: "StartPlayback" }] })).rejects.toThrow("cancelled");
    expect(f.execute).not.toHaveBeenCalled(); expect(f.engine.start).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it("splits a sustained note crossing the seek/loop boundary into valid scheduled segments", () => {
    const f = fixture();
    const song = { ...f.song, transport: { ...f.song.transport, positionBeats: 0.5 } };
    const notes = songMaterials(song)[0]!.material.notes;
    expect(notes.map((note) => [note.startBeat, note.lengthBeats])).toEqual([[3.5, 0.5], [0, 0.5]]);
    expect(notes.every((note) => note.startBeat + note.lengthBeats <= 4)).toBe(true);
  });
  it("keeps instrument identity and rotates arrangement notes for a playhead offset", () => {
    const f = fixture();
    const materials = songMaterials({ ...f.song, transport: { ...f.song.transport, positionBeats: 1 } });
    expect(materials.map(({ material }) => material.instrumentId)).toEqual(["bass", "drums"]);
    expect(materials[0]!.material.notes[0]!.startBeat).toBe(3);
  });
});
