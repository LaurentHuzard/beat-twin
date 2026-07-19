import {
  createTonePreviewEngine,
  scheduleSongNotes,
  type TonePreviewEngine,
} from "@beat-twin/audio-tone";
import {
  DEFAULT_BUILT_IN_INSTRUMENT_ID,
  type BuiltInInstrumentId,
  type Clip,
  type Song,
  type Track,
} from "@beat-twin/core";

export type PreviewPhase = "idle" | "playing" | "error";

export type PreviewState = {
  readonly phase: PreviewPhase;
  readonly label: string;
  readonly detail?: string;
};

export type PreviewAuditionNote = {
  readonly pitch: number;
  readonly velocity: number;
  readonly startBeat: number;
  readonly lengthBeats: number;
};

export type PreviewAudition = {
  readonly songTitle: string;
  readonly trackName: string;
  readonly instrumentId: BuiltInInstrumentId;
  readonly clipName: string;
  readonly bpm: number;
  readonly lengthBeats: number;
  readonly notes: readonly PreviewAuditionNote[];
  readonly song: Song;
};

export type PreviewAudioEngine = {
  readonly play: (audition: PreviewAudition) => Promise<void>;
  readonly stop: () => Promise<void>;
};

export const idlePreviewState: PreviewState = {
  phase: "idle",
  label: "Preview idle",
};

export function buildPreviewAudition(
  song: Song | null,
  selectedTrackId: string | null,
  selectedClipId: string | null,
): PreviewAudition | null {
  const target = resolvePreviewTarget(song, selectedTrackId, selectedClipId);
  if (!song || !target) {
    return null;
  }

  const auditionSong = buildAuditionSong(song, target);
  const scheduledNotes = scheduleSongNotes(auditionSong);

  return {
    songTitle: song.title,
    trackName: target.track.name,
    instrumentId: target.track.instrumentId ?? DEFAULT_BUILT_IN_INSTRUMENT_ID,
    clipName: target.clip.name,
    bpm: song.transport.bpm,
    lengthBeats: target.clip.lengthBeats,
    song: auditionSong,
    notes: scheduledNotes.map((event) => ({
      pitch: event.pitch,
      velocity: event.velocity,
      startBeat: event.startBeat,
      lengthBeats: event.durationBeats,
    })),
  };
}

export function createBrowserPreviewAudioEngine(): PreviewAudioEngine {
  return new TonePackagePreviewAudioEngine();
}

type PreviewTarget = {
  readonly track: Track;
  readonly clip: Clip;
};

function resolvePreviewTarget(
  song: Song | null,
  selectedTrackId: string | null,
  selectedClipId: string | null,
): PreviewTarget | null {
  if (!song) {
    return null;
  }

  if (selectedClipId) {
    for (const track of song.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === selectedClipId);
      if (clip) {
        return { track, clip };
      }
    }
  }

  const selectedTrack = selectedTrackId
    ? song.tracks.find((candidate) => candidate.id === selectedTrackId)
    : null;
  const selectedTrackClip = selectedTrack?.clips[0] ?? null;
  if (selectedTrack && selectedTrackClip) {
    return { track: selectedTrack, clip: selectedTrackClip };
  }

  for (const track of song.tracks) {
    const clip = track.clips[0];
    if (clip) {
      return { track, clip };
    }
  }

  return null;
}

class TonePackagePreviewAudioEngine implements PreviewAudioEngine {
  private enginePromise: Promise<TonePreviewEngine> | null = null;

  async play(audition: PreviewAudition): Promise<void> {
    await this.stop();

    if (audition.notes.length === 0) {
      throw new Error("Selected clip has no playable notes.");
    }

    const engine = await this.getEngine();
    await engine.start(audition.song, { delaySeconds: 0.04 });
  }

  async stop(): Promise<void> {
    const engine = this.enginePromise ? await this.enginePromise : null;
    engine?.stop();
  }

  private getEngine(): Promise<TonePreviewEngine> {
    this.enginePromise ??= createTonePreviewEngine();
    return this.enginePromise;
  }
}

function buildAuditionSong(song: Song, target: PreviewTarget): Song {
  return {
    ...song,
    id: `${song.id}:preview:${target.clip.id}`,
    transport: {
      ...song.transport,
      positionBeats: 0,
      isPlaying: false,
      isRecording: false,
    },
    tracks: [
      {
        ...target.track,
        clips: [
          {
            ...target.clip,
            startBeat: 0,
          },
        ],
      },
    ],
  };
}
