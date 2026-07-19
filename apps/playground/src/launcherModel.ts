import type { Track } from "@beat-twin/core";

export const LIVE_LAUNCHER_TRACK_COUNT = 2;
export const LIVE_LAUNCHER_SLOT_COUNT = 2;

export type EmptyLauncherSlot = {
  readonly slotIndex: number;
  readonly startBeat: number;
};

export function findNextEmptyLauncherSlot(
  track: Track,
  sourceClipId: string,
): EmptyLauncherSlot | null {
  const sourceIndex = track.clips.findIndex((clip) => clip.id === sourceClipId);
  if (sourceIndex < 0 || sourceIndex >= LIVE_LAUNCHER_SLOT_COUNT) return null;
  const source = track.clips[sourceIndex]!;
  for (
    let slotIndex = sourceIndex + 1;
    slotIndex < LIVE_LAUNCHER_SLOT_COUNT;
    slotIndex += 1
  ) {
    if (track.clips[slotIndex]) continue;
    return Object.freeze({
      slotIndex,
      startBeat:
        source.startBeat + source.lengthBeats * (slotIndex - sourceIndex),
    });
  }
  return null;
}
