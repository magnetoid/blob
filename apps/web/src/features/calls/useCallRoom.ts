import { useSyncExternalStore } from 'react';
import { room, subscribe } from './engine.ts';

/** The Room of the call you are in, re-rendering when you join or leave. */
export function useCallRoom() {
  return useSyncExternalStore(subscribe, room, () => null);
}
