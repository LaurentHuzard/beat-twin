import {
  deserializeSong,
  serializeSong,
  type Song,
} from "@beat-twin/core";

export const PLAYGROUND_SONG_STORAGE_KEY = "beat-twin.playground.song.v1";

export type StorageLike = {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
};

export function exportSongJson(song: Song): string {
  return serializeSong(song);
}

export function importSongJson(source: string): Song {
  return deserializeSong(source);
}

export function saveSongToStorage(
  song: Song,
  storage: StorageLike | null = getBrowserStorage(),
): string {
  if (!storage) {
    throw new Error("Browser storage is unavailable.");
  }

  const json = exportSongJson(song);
  storage.setItem(PLAYGROUND_SONG_STORAGE_KEY, json);
  return json;
}

export function loadSongFromStorage(
  storage: StorageLike | null = getBrowserStorage(),
): Song | null {
  if (!storage) {
    throw new Error("Browser storage is unavailable.");
  }

  const json = storage.getItem(PLAYGROUND_SONG_STORAGE_KEY);
  return json ? importSongJson(json) : null;
}

export function clearSongFromStorage(
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) {
    throw new Error("Browser storage is unavailable.");
  }

  storage.removeItem(PLAYGROUND_SONG_STORAGE_KEY);
}

export function hasSavedSong(storage: StorageLike | null = getBrowserStorage()): boolean {
  return Boolean(storage?.getItem(PLAYGROUND_SONG_STORAGE_KEY));
}

function getBrowserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
