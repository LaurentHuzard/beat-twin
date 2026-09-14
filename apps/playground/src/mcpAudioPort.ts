import { createCommandState, executeCommandBatch, type CommandBatchResult, type CommandSnapshot, type ExecuteCommandBatchRequest } from "@beat-twin/commands";
import { DEFAULT_BUILT_IN_INSTRUMENT_ID, type Song } from "@beat-twin/core";
import { type LiveMidiClipMaterial } from "@beat-twin/audio-tone";
import { acquireBrowserAudioLease, type BrowserAudioLease } from "./browserAudioRuntime";

/** Browser-owned arrangement audition, using the same exclusive audio engine as JAM/EDIT. */
export function createMcpAudioPort(options: {
  inspect: () => CommandSnapshot;
  execute: (request: ExecuteCommandBatchRequest) => CommandBatchResult;
  acquire?: () => Promise<BrowserAudioLease>;
  onPlaying?: (playing: boolean) => void;
}) {
  let lease: BrowserAudioLease | null = null;
  let busy = false;
  let generation = 0;
  const stop = () => {
    generation += 1;
    const active = lease;
    lease = null;
    if (active) {
      options.onPlaying?.(false);
      try { active.engine.stop(); } finally { active.release(); }
    }
  };
  return {
    inspect: options.inspect,
    isBusy: () => busy,
    isPlaying: () => lease !== null,
    stop,
    dispose: stop,
    executeCommandBatch: async (request: ExecuteCommandBatchRequest): Promise<CommandBatchResult> => {
      if (busy) throw new Error("Browser audio execution unavailable");
      busy = true;
      let prepared: BrowserAudioLease | null = null;
      try {
        const before = options.inspect();
        const projected = executeCommandBatch(createCommandState(before.song, before.revision), request);
        if (!projected.ok) return projected;
        const song = projected.snapshot.song;
        const play = song?.transport.isPlaying === true;
        if (play) {
          const materials = songMaterials(song);
          // Stop an owned previous arrangement before rescheduling. Never steal JAM/EDIT audio.
          stop();
          const ticket = generation;
          prepared = await (options.acquire ?? (() => acquireBrowserAudioLease("song")))();
          if (generation !== ticket) throw new Error("Browser audio preparation cancelled");
          const engine = prepared.engine;
          engine.initialize(song.transport.bpm);
          engine.reset();
          await engine.unlock();
          const scheduled = await engine.scheduleTransitions(materials.map(({ trackId, material }) => ({ kind: "launch" as const, transitionId: `${request.requestId}:${trackId}`, groupId: request.requestId, trackId, targetBeat: 0, material })));
          if (!scheduled.ok) throw new Error(scheduled.error.message);
          if (generation !== ticket) throw new Error("Browser audio preparation cancelled");
        }
        // The store rechecks CAS after asynchronous audio preparation.
        const result = options.execute(request);
        if (!result.ok) return result;
        if (prepared) {
          prepared.engine.start(0);
          lease = prepared;
          options.onPlaying?.(true);
          prepared = null;
        } else stop();
        return result;
      } finally {
        if (prepared) {
          try { prepared.engine.stop(); } finally { prepared.release(); }
        }
        busy = false;
      }
    },
  };
}

export function songMaterials(song: Song): readonly { trackId: string; material: LiveMidiClipMaterial }[] {
  const lengthBeats = Math.max(0, ...song.tracks.flatMap((track) => track.clips.map((clip) => clip.startBeat + clip.lengthBeats)));
  if (!Number.isFinite(lengthBeats) || lengthBeats <= 0 || lengthBeats > 4096) throw new Error("Song needs a bounded playable arrangement");
  const offset = song.transport.positionBeats % lengthBeats;
  const materials = song.tracks.filter((track) => track.kind === "instrument" && track.clips.length > 0).map((track) => ({
    trackId: `song:${track.id}`,
    material: {
      kind: "midi" as const, materialId: `song:${song.id}:${track.id}`, version: 0, clipId: `arrangement:${track.id}`,
      instrumentId: track.instrumentId ?? DEFAULT_BUILT_IN_INSTRUMENT_ID,
      lengthBeats,
      notes: track.clips.flatMap((clip) => clip.pattern.notes.flatMap((note) => {
        const startBeat = (clip.startBeat + note.startBeat - offset + lengthBeats) % lengthBeats;
        const duration = Math.min(note.lengthBeats, lengthBeats);
        const firstLength = Math.min(duration, lengthBeats - startBeat);
        const first = { ...note, id: `${clip.id}:${note.id}`, startBeat, lengthBeats: firstLength };
        return duration > firstLength
          ? [first, { ...note, id: `${clip.id}:${note.id}:continuation`, startBeat: 0, lengthBeats: duration - firstLength }]
          : [first];
      })),
    },
  }));
  if (!materials.some(({ material }) => material.notes.length > 0)) throw new Error("Song has no playable notes");
  if (materials.length > 32 || materials.reduce((count, { material }) => count + material.notes.length, 0) > 8192) throw new Error("Song exceeds browser audition limits");
  return materials;
}
