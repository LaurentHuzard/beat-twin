import {
  createToneLiveAudioEngine,
  LiveAudioEngineFault,
  type LiveAudioEngine,
  type LiveAudioEnginePhase,
} from "@beat-twin/audio-tone";

import {
  createLiveAudioController,
  type LiveAudioController,
  type LiveAudioControllerHost,
} from "./liveAudioController";

export type BrowserAudioOwner = "preview" | "live" | "browser-smoke";

export type BrowserAudioLease = {
  readonly owner: BrowserAudioOwner;
  readonly engine: LiveAudioEngine;
  readonly release: () => void;
};

export type BrowserAudioLeaseCoordinator = {
  readonly acquire: (owner: BrowserAudioOwner) => Promise<BrowserAudioLease>;
  readonly getOwner: () => BrowserAudioOwner | null;
};

export type BrowserAudioLeaseAcquirer = (
  owner: BrowserAudioOwner,
) => Promise<BrowserAudioLease>;

/**
 * Preview and live performance are mutually exclusive owners of the singleton
 * Tone transport. A lease never disposes the shared engine by itself.
 */
export function createBrowserAudioLeaseCoordinator(
  createEngine: () => Promise<LiveAudioEngine>,
): BrowserAudioLeaseCoordinator {
  let enginePromise: Promise<LiveAudioEngine> | null = null;
  let activeLease: { readonly owner: BrowserAudioOwner; readonly token: symbol } | null = null;

  function getEngine(): Promise<LiveAudioEngine> {
    if (!enginePromise) {
      const pending = createEngine();
      const shared = pending.catch((error) => {
        if (enginePromise === shared) enginePromise = null;
        throw error;
      });
      enginePromise = shared;
    }
    return enginePromise;
  }

  return Object.freeze({
    async acquire(owner) {
      if (activeLease) {
        throw new LiveAudioEngineFault({
          code: "invalid_state",
          message: `browser audio is already owned by ${activeLease.owner}`,
        });
      }
      const token = Symbol(owner);
      activeLease = { owner, token };
      try {
        const engine = await getEngine();
        let released = false;
        return Object.freeze({
          owner,
          engine,
          release() {
            if (released) return;
            released = true;
            if (activeLease?.token === token) activeLease = null;
          },
        });
      } catch (error) {
        if (activeLease?.token === token) activeLease = null;
        throw error;
      }
    },
    getOwner: () => activeLease?.owner ?? null,
  });
}

const browserAudioCoordinator = createBrowserAudioLeaseCoordinator(
  createToneLiveAudioEngine,
);

export function acquireBrowserAudioLease(
  owner: BrowserAudioOwner,
): Promise<BrowserAudioLease> {
  return browserAudioCoordinator.acquire(owner);
}

export async function createBrowserLiveAudioController(
  host: LiveAudioControllerHost,
  acquireLease: BrowserAudioLeaseAcquirer = acquireBrowserAudioLease,
): Promise<LiveAudioController> {
  const lease = await acquireLease("live");
  const controller = createLiveAudioController({
    engine: lease.engine,
    host,
    engineOwnership: "shared",
  });
  let closed = false;
  return {
    ...controller,
    dispose() {
      if (closed) return;
      closed = true;
      try {
        const phase = lease.engine.getSnapshot().phase;
        if (requiresEmergencyStop(phase)) controller.emergencyStop();
      } finally {
        controller.dispose();
        lease.release();
      }
    },
  };
}

function requiresEmergencyStop(phase: LiveAudioEnginePhase): boolean {
  switch (phase) {
    case "initialized":
    case "blocked":
    case "ready":
    case "running":
    case "suspended":
      return true;
    case "new":
    case "stopped":
    case "disposed":
      return false;
    default:
      return assertNeverPhase(phase);
  }
}

function assertNeverPhase(phase: never): never {
  throw new Error(`unknown live audio engine phase: ${String(phase)}`);
}
