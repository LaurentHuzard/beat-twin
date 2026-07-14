export type MusicalClock = {
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly originBeat: number;
  readonly originTimeSeconds: number;
};

type TransitionBase<Action> = {
  readonly id: string;
  readonly trackId: string;
  readonly action: Action;
  readonly requestedAtBeat: number;
  readonly targetBeat: number;
};

export type PendingTransition<Action> = TransitionBase<Action> & {
  readonly status: "pending";
};

export type ScheduledTransition<Action> = TransitionBase<Action> & {
  readonly status: "scheduled";
};

export type ExecutedTransition<Action> = TransitionBase<Action> & {
  readonly status: "executed";
  readonly observedAtBeat: number;
};

export type FailedTransition<Action> = TransitionBase<Action> & {
  readonly status: "failed";
  readonly observedAtBeat: number;
  readonly error: string;
};

export type CancelledTransition<Action> = TransitionBase<Action> & {
  readonly status: "cancelled";
  readonly cancelledAtBeat: number;
  readonly reason: "player" | "replaced";
};

export type LiveTransition<Action> =
  | PendingTransition<Action>
  | ScheduledTransition<Action>
  | ExecutedTransition<Action>
  | FailedTransition<Action>
  | CancelledTransition<Action>;

export type LiveSessionState<Action, TrackObservation> = {
  readonly transitions: readonly LiveTransition<Action>[];
  readonly openTransitionByTrack: Readonly<Record<string, string>>;
  readonly observedTrackState: Readonly<Record<string, TrackObservation>>;
};

export type QueueTransitionInput<Action> = {
  readonly id: string;
  readonly trackId: string;
  readonly action: Action;
  readonly requestedAtBeat: number;
  readonly beatsPerBar?: number;
};

export type EngineTransitionObservation<TrackObservation> =
  | {
      readonly transitionId: string;
      readonly outcome: "executed";
      readonly observedAtBeat: number;
      readonly trackState: TrackObservation;
    }
  | {
      readonly transitionId: string;
      readonly outcome: "failed";
      readonly observedAtBeat: number;
      readonly error: string;
    };

export function createMusicalClock(input: {
  readonly bpm: number;
  readonly beatsPerBar?: number;
  readonly originBeat?: number;
  readonly originTimeSeconds?: number;
}): MusicalClock {
  return Object.freeze({
    bpm: assertPositiveFinite(input.bpm, "bpm"),
    beatsPerBar: assertPositiveFinite(input.beatsPerBar ?? 4, "beatsPerBar"),
    originBeat: assertNonNegativeFinite(input.originBeat ?? 0, "originBeat"),
    originTimeSeconds: assertFinite(input.originTimeSeconds ?? 0, "originTimeSeconds"),
  });
}

export function beatAtTime(clock: MusicalClock, timeSeconds: number): number {
  const elapsedSeconds = assertFinite(timeSeconds, "timeSeconds") - clock.originTimeSeconds;
  return clock.originBeat + elapsedSeconds * (clock.bpm / 60);
}

export function nextBarBeat(currentBeat: number, beatsPerBar = 4): number {
  const beat = assertNonNegativeFinite(currentBeat, "currentBeat");
  const barLength = assertPositiveFinite(beatsPerBar, "beatsPerBar");
  return (Math.floor(beat / barLength) + 1) * barLength;
}

export function createLiveSessionState<Action, TrackObservation>(): LiveSessionState<
  Action,
  TrackObservation
> {
  return freezeState({
    transitions: [],
    openTransitionByTrack: {},
    observedTrackState: {},
  });
}

export function queueTransition<Action, TrackObservation>(
  state: LiveSessionState<Action, TrackObservation>,
  input: QueueTransitionInput<Action>,
): LiveSessionState<Action, TrackObservation> {
  assertIdentifier(input.id, "transition id");
  assertIdentifier(input.trackId, "track id");
  if (state.transitions.some((transition) => transition.id === input.id)) {
    throw new Error(`transition id ${input.id} already exists`);
  }

  let transitions = state.transitions;
  const openTransitionId = state.openTransitionByTrack[input.trackId];
  if (openTransitionId) {
    const openTransition = requireTransition(state, openTransitionId);
    if (openTransition.status !== "pending") {
      throw new Error(
        `transition ${openTransitionId} is already scheduled and cannot be replaced locally`,
      );
    }
    transitions = replaceTransition(transitions, openTransitionId, {
      ...openTransition,
      status: "cancelled",
      cancelledAtBeat: input.requestedAtBeat,
      reason: "replaced",
    });
  }

  const transition: PendingTransition<Action> = Object.freeze({
    id: input.id,
    trackId: input.trackId,
    action: input.action,
    requestedAtBeat: assertNonNegativeFinite(input.requestedAtBeat, "requestedAtBeat"),
    targetBeat: nextBarBeat(input.requestedAtBeat, input.beatsPerBar),
    status: "pending",
  });

  return freezeState({
    transitions: [...transitions, transition],
    openTransitionByTrack: {
      ...state.openTransitionByTrack,
      [input.trackId]: transition.id,
    },
    observedTrackState: state.observedTrackState,
  });
}

export function markTransitionScheduled<Action, TrackObservation>(
  state: LiveSessionState<Action, TrackObservation>,
  transitionId: string,
): LiveSessionState<Action, TrackObservation> {
  const transition = requireTransition(state, transitionId);
  if (transition.status !== "pending") {
    throw new Error(`transition ${transitionId} is ${transition.status}, not pending`);
  }

  return freezeState({
    ...state,
    transitions: replaceTransition(state.transitions, transitionId, {
      ...transition,
      status: "scheduled",
    }),
  });
}

export function cancelPendingTransition<Action, TrackObservation>(
  state: LiveSessionState<Action, TrackObservation>,
  trackId: string,
  cancelledAtBeat: number,
): LiveSessionState<Action, TrackObservation> {
  const transitionId = state.openTransitionByTrack[trackId];
  if (!transitionId) {
    return state;
  }

  const transition = requireTransition(state, transitionId);
  if (transition.status !== "pending") {
    throw new Error(
      `transition ${transitionId} is already scheduled and requires engine cancellation`,
    );
  }

  return freezeState({
    transitions: replaceTransition(state.transitions, transitionId, {
      ...transition,
      status: "cancelled",
      cancelledAtBeat: assertNonNegativeFinite(cancelledAtBeat, "cancelledAtBeat"),
      reason: "player",
    }),
    openTransitionByTrack: omitKey(state.openTransitionByTrack, trackId),
    observedTrackState: state.observedTrackState,
  });
}

export function observeTransition<Action, TrackObservation>(
  state: LiveSessionState<Action, TrackObservation>,
  observation: EngineTransitionObservation<TrackObservation>,
): LiveSessionState<Action, TrackObservation> {
  const transition = requireTransition(state, observation.transitionId);
  if (transition.status !== "pending" && transition.status !== "scheduled") {
    throw new Error(
      `transition ${transition.id} is already ${transition.status} and cannot be observed again`,
    );
  }

  const observedAtBeat = assertNonNegativeFinite(
    observation.observedAtBeat,
    "observedAtBeat",
  );
  if (observation.outcome === "executed" && observedAtBeat < transition.targetBeat) {
    throw new Error(
      `transition ${transition.id} cannot execute before target beat ${transition.targetBeat}`,
    );
  }
  if (observation.outcome === "failed" && observedAtBeat < transition.requestedAtBeat) {
    throw new Error(
      `transition ${transition.id} cannot fail before request beat ${transition.requestedAtBeat}`,
    );
  }

  if (observation.outcome === "executed" && transition.status !== "scheduled") {
    throw new Error(`transition ${transition.id} must be scheduled before execution`);
  }

  const resolvedTransition: LiveTransition<Action> =
    observation.outcome === "executed"
      ? Object.freeze({ ...transition, status: "executed", observedAtBeat })
      : Object.freeze({
          ...transition,
          status: "failed",
          observedAtBeat,
          error: observation.error,
        });

  return freezeState({
    transitions: replaceTransition(state.transitions, transition.id, resolvedTransition),
    openTransitionByTrack:
      state.openTransitionByTrack[transition.trackId] === transition.id
        ? omitKey(state.openTransitionByTrack, transition.trackId)
        : state.openTransitionByTrack,
    observedTrackState:
      observation.outcome === "executed"
        ? {
            ...state.observedTrackState,
            [transition.trackId]: observation.trackState,
          }
        : state.observedTrackState,
  });
}

export function getTransition<Action, TrackObservation>(
  state: LiveSessionState<Action, TrackObservation>,
  transitionId: string,
): LiveTransition<Action> | undefined {
  return state.transitions.find((transition) => transition.id === transitionId);
}

export function getOpenTransition<Action, TrackObservation>(
  state: LiveSessionState<Action, TrackObservation>,
  trackId: string,
): LiveTransition<Action> | undefined {
  const transitionId = state.openTransitionByTrack[trackId];
  return transitionId ? getTransition(state, transitionId) : undefined;
}

function requireTransition<Action, TrackObservation>(
  state: LiveSessionState<Action, TrackObservation>,
  transitionId: string,
): LiveTransition<Action> {
  const transition = getTransition(state, transitionId);
  if (!transition) {
    throw new Error(`transition ${transitionId} does not exist`);
  }
  return transition;
}

function replaceTransition<Action>(
  transitions: readonly LiveTransition<Action>[],
  transitionId: string,
  replacement: LiveTransition<Action>,
): readonly LiveTransition<Action>[] {
  return transitions.map((transition) =>
    transition.id === transitionId ? replacement : transition,
  );
}

function omitKey<Value>(
  values: Readonly<Record<string, Value>>,
  key: string,
): Readonly<Record<string, Value>> {
  const { [key]: _removed, ...remaining } = values;
  return remaining;
}

function freezeState<Action, TrackObservation>(
  state: LiveSessionState<Action, TrackObservation>,
): LiveSessionState<Action, TrackObservation> {
  return Object.freeze({
    transitions: Object.freeze([...state.transitions]),
    openTransitionByTrack: Object.freeze({ ...state.openTransitionByTrack }),
    observedTrackState: Object.freeze({ ...state.observedTrackState }),
  });
}

function assertIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} must not be empty`);
  }
}

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function assertNonNegativeFinite(value: number, label: string): number {
  const finiteValue = assertFinite(value, label);
  if (finiteValue < 0) {
    throw new Error(`${label} must be greater than or equal to 0`);
  }
  return finiteValue;
}

function assertPositiveFinite(value: number, label: string): number {
  const finiteValue = assertFinite(value, label);
  if (finiteValue <= 0) {
    throw new Error(`${label} must be greater than 0`);
  }
  return finiteValue;
}
