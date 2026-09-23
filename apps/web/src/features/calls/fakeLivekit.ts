/** Held while non-null: every room's microphone step waits on it, so a test can put a
 *  `connect()` past `onPhase('connected')` and into the device prompt, then decide what
 *  happens next (drop the room, resolve, reject) before letting the prompt settle. One
 *  gate for every room rather than one per room, since no test here needs two different
 *  rooms' prompts open at once. */
export const micGate: { promise: Promise<void> | null; open: () => void } = {
  promise: null,
  open: () => {},
};

/** A stand-in for `livekit-client`, aliased in with `vi.mock('livekit-client', ...)`.
 *
 * Each Room's `connect()` stays open until a test resolves it with `finishConnect()`, so a
 * leave, a rejoin or a switch can be made to land mid-connect — which is the whole point:
 * the races this fixes only show up while something is still in flight. Modelled on
 * livekit-client 2.22.3's own behaviour, not guessed at: a `disconnect()` issued while
 * `connect()` is still outstanding aborts it, rejecting the connect promise with
 * `ConnectionError.cancelled('Client initiated disconnect')` and emitting `Disconnected`
 * — reproduced here as a plain `Error` and the same event, since the engine only checks
 * that the promise rejected and that the event fired, never the error's own shape.
 */

export const RoomEvent = {
  Reconnecting: 'reconnecting',
  Reconnected: 'reconnected',
  Disconnected: 'disconnected',
} as const;

/** Every Room a test has constructed, oldest first — a fresh `connect()` pushes one. */
export const rooms: Room[] = [];

export class Room {
  handlers = new Map<string, Array<() => void>>();
  state: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  micOn = false;
  disconnectCalls = 0;
  /** Set before `finishConnect()` to make the microphone step reject once. */
  micWillReject: unknown = null;
  private settle: { resolve: () => void; reject: (e: unknown) => void } | null = null;

  localParticipant = {
    setMicrophoneEnabled: async (on: boolean): Promise<void> => {
      if (micGate.promise) await micGate.promise;
      if (this.micWillReject) {
        const error = this.micWillReject;
        this.micWillReject = null;
        throw error;
      }
      this.micOn = on;
    },
    setCameraEnabled: async (): Promise<void> => {},
  };

  // `engine.ts` type-checks its own `new Room({...})` and `.connect(url, token)` calls
  // against the real `livekit-client` types, never against this class — `vi.mock` swaps
  // the implementation in only at runtime — so nothing here needs to accept, let alone
  // use, the arguments those calls pass.
  constructor() {
    rooms.push(this);
  }

  on(event: string, fn: () => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string): void {
    for (const fn of this.handlers.get(event) ?? []) fn();
  }

  connect(): Promise<void> {
    this.state = 'connecting';
    return new Promise<void>((resolve, reject) => {
      this.settle = { resolve, reject };
    });
  }

  /** Test hook: the signal connection completes.
   *
   * A no-op once `settle` is gone — a disconnect issued while connecting already
   * rejected this same promise, permanently, the way a real one would; a "the server
   * answered" that arrives after does not get to overwrite that with 'connected'. */
  finishConnect(): void {
    if (!this.settle) return;
    this.state = 'connected';
    this.settle.resolve();
    this.settle = null;
  }

  /** Mirrors livekit-client 2.22: a disconnect while connecting aborts the attempt. */
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    if (this.state === 'disconnected') return;
    if (this.state === 'connecting') {
      this.settle?.reject(new Error('Client initiated disconnect'));
      this.settle = null;
    }
    this.state = 'disconnected';
    this.micOn = false;
    this.emit(RoomEvent.Disconnected);
  }

  /** Test hook: the server drops us (e.g. DUPLICATE_IDENTITY, room closed). */
  serverDrop(): void {
    this.state = 'disconnected';
    this.micOn = false;
    this.emit(RoomEvent.Disconnected);
  }
}
