import assert from "node:assert/strict";
import test from "node:test";
import { createSong, createTrack, addTrack, createClip, addClip, createNote, addNote } from "@beat-twin/core";
import { createCommandState, executeCommandBatch } from "../src/index.ts";

test("track/clip edits are atomic and restoration preserves instrument, position and notes", () => {
  let song = addTrack(createSong({ id: "s" }), createTrack({ id: "t", name: "Bass", instrumentId: "bass" }));
  song = addClip(song, "t", createClip({ id: "c", trackId: "t", lengthBeats: 4 }));
  song = addNote(song, "t", "c", createNote({ id: "n", pitch: 36, startBeat: 1, lengthBeats: 1 }));
  const state = createCommandState(song);
  const bad = executeCommandBatch(state, { requestId: "bad", expectedRevision: 0, commands: [{ type: "RenameTrack", trackId: "t", name: "Changed" }, { type: "UpdateClip", trackId: "t", clipId: "c", lengthBeats: 1 }] });
  assert.equal(bad.ok, false); assert.deepEqual(bad.snapshot.song, song); assert.equal(bad.snapshot.revision, 0);
  const edit = executeCommandBatch(state, { requestId: "edit", expectedRevision: 0, commands: [{ type: "RenameTrack", trackId: "t", name: "Changed" }, { type: "UpdateClip", trackId: "t", clipId: "c", name: "Verse", startBeat: 4, lengthBeats: 8 }, { type: "DeleteClip", trackId: "t", clipId: "c" }] });
  assert.equal(edit.ok, true); assert.equal(edit.snapshot.revision, 1); assert.equal(edit.snapshot.song!.tracks[0]!.clips.length, 0);
  const restored = executeCommandBatch(edit.state, { requestId: "restore", expectedRevision: 1, commands: [{ type: "RestoreTrack", track: song.tracks[0]!, index: 0 }] });
  assert.equal(restored.ok, true); assert.deepEqual(restored.snapshot.song, song);
  const deleted = executeCommandBatch(restored.state, { requestId: "delete", expectedRevision: 2, commands: [{ type: "DeleteTrack", trackId: "t" }] });
  assert.equal(deleted.ok, true); assert.equal(deleted.snapshot.song!.tracks.length, 0);
  const invalid = executeCommandBatch(deleted.state, { requestId: "invalid", expectedRevision: 3, commands: [{ type: "RestoreTrack", track: { ...song.tracks[0]!, kind: "invalid" } as never, index: 0 }] });
  assert.equal(invalid.ok, false); assert.deepEqual(invalid.snapshot, deleted.snapshot);
});
