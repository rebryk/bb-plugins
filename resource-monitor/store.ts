import { useSyncExternalStore } from "react";
import { DEFAULT_LOOK, type Look, type Sample } from "./shared";

const HISTORY_LENGTH = 30;

type MonitorState = { samples: readonly Sample[]; look: Look };

// Host-drawn icons get no plugin context, so SDK hooks throw inside them.
// A component with that context fills this store, and the icon reads it.
let state: MonitorState = { samples: [], look: DEFAULT_LOOK };
const listeners = new Set<() => void>();

function update(next: Partial<MonitorState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const setSamples = (samples: readonly Sample[]) =>
  update({ samples: samples.slice(-HISTORY_LENGTH) });

export const addSample = (sample: Sample) =>
  setSamples([...state.samples, sample]);

export const setLook = (look: Partial<Look>) =>
  update({ look: { ...state.look, ...look } });

export const useMonitor = () => useSyncExternalStore(subscribe, () => state);
