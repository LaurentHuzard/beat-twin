import {
  LiveAudioEngineFault,
  scheduleSongNotes,
  type LiveMidiClipMaterial,
} from "@beat-twin/audio-tone";
import {
  DEFAULT_BUILT_IN_INSTRUMENT_ID,
  type BuiltInInstrumentId,
  type Clip,
  type Song,
  type Track,
} from "@beat-twin/core";

import {
  acquireBrowserAudioLease,
  type BrowserAudioLease,
} from "./browserAudioRuntime";

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
  return createPreviewAudioEngineFromLiveRuntime({
    acquireLease: () => acquireBrowserAudioLease("preview"),
  });
}

export function createPreviewAudioEngineFromLiveRuntime(runtime: {
  readonly acquireLease: () => Promise<PreviewAudioLease>;
}): PreviewAudioEngine {
  return new TonePackagePreviewAudioEngine(runtime.acquireLease);
}

type PreviewAudioLease = Pick<BrowserAudioLease, "engine" | "release">;

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
  private lease: PreviewAudioLease | null = null;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly acquireLease: () => Promise<PreviewAudioLease>) {}

  play(audition: PreviewAudition): Promise<void> {
    return this.enqueue(() => this.playNow(audition));
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.stopNow());
  }

  private async playNow(audition: PreviewAudition): Promise<void> {
    this.stopNow();

    if (audition.notes.length === 0) {
      throw new Error("Selected clip has no playable notes.");
    }

    const lease = await this.acquireLease();
    this.lease = lease;
    const { engine } = lease;

    try {
      engine.initialize(audition.bpm);
      engine.reset();
      await engine.unlock();

      const track = audition.song.tracks[0];
      const clip = track?.clips[0];
      if (!track || !clip || track.kind !== "instrument") {
        throw new LiveAudioEngineFault({
          code: "unsupported_material",
          message: "Preview requires one instrument clip",
        });
      }
      const material: LiveMidiClipMaterial = Object.freeze({
        kind: "midi",
        materialId: `${audition.song.id}:${track.id}:${clip.id}@preview`,
        version: 0,
        clipId: clip.id,
        instrumentId: track.instrumentId ?? DEFAULT_BUILT_IN_INSTRUMENT_ID,
        lengthBeats: clip.lengthBeats,
        notes: Object.freeze(clip.pattern.notes.map((note) => Object.freeze({ ...note }))),
      });
      const scheduled = await engine.scheduleTransitions([
        {
          kind: "launch",
          transitionId: `preview:${track.id}:${clip.id}`,
          groupId: null,
          trackId: `preview:${track.id}`,
          targetBeat: 0,
          material,
        },
      ]);
      if (!scheduled.ok) throw new LiveAudioEngineFault(scheduled.error);
      engine.start(0);
    } catch (error) {
      if (this.lease === lease) {
        this.lease = null;
        const phase = engine.getSnapshot().phase;
        if (phase !== "new" && phase !== "disposed") engine.stop();
        lease.release();
      }
      throw error;
    }
  }

  private stopNow(): void {
    const lease = this.lease;
    if (!lease) return;
    this.lease = null;
    const phase = lease.engine.getSnapshot().phase;
    if (phase !== "new" && phase !== "disposed") lease.engine.stop();
    lease.release();
  }

  private enqueue(operation: () => void | Promise<void>): Promise<void> {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
