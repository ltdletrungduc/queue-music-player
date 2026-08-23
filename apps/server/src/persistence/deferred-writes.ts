import type { RoomState } from '@qmp/shared';
import type { RoomStore } from './room-store.js';

/**
 * The Room reduces a Command and writes the result in the same breath, and the
 * socket handlers that call `dispatch` do not wait for it. A store a network
 * away cannot be written in that breath, so writes are handed here instead:
 * `dispatch` stays synchronous, and the Room accepts that what is on screen may
 * be a moment ahead of what is stored. See ADR-0004.
 *
 * Only the newest Room is ever written. Every save is the whole Room, so three
 * reorders in a second are one write of the third, not three writes in a queue.
 */
export type DeferredWrites = {
  room: (state: RoomState) => void;
  position: (trackId: string, positionSeconds: number) => void;
  /** Resolves once nothing is waiting to be written. */
  drain: () => Promise<void>;
};

export type DeferOptions = {
  /** How long to wait before trying again after a failed write. */
  retryMs?: number;
  /**
   * The least time between two position writes. A position arrives every second
   * while a Track plays, which is far more often than a restart needs; this is
   * how much of a Track a restart may replay.
   */
  positionEveryMs?: number;
  /** Told about every failed write, including ones that will be retried. */
  onError?: (error: unknown) => void;
};

type Position = { trackId: string; positionSeconds: number };

export function deferWrites(store: RoomStore, options: DeferOptions = {}): DeferredWrites {
  const retryMs = options.retryMs ?? 5_000;
  const positionEveryMs = options.positionEveryMs ?? 5_000;
  const onError = options.onError ?? (() => {});

  let pendingRoom: RoomState | null = null;
  let pendingPosition: Position | null = null;
  let writing = false;
  let retrying: NodeJS.Timeout | undefined;
  let lastPositionAt = 0;
  const idle: (() => void)[] = [];

  const settled = () => !writing && pendingRoom === null && pendingPosition === null;

  function announceIfIdle(): void {
    if (!settled()) return;
    while (idle.length) idle.pop()!();
  }

  function pump(): void {
    if (writing || retrying !== undefined) return;

    // The Room supersedes a position: a whole-Room write carries the position
    // with it, so writing the older one afterwards would undo nothing but cost
    // a round trip.
    const room = pendingRoom;
    const position = room === null ? pendingPosition : null;
    if (room === null && position === null) return;

    pendingRoom = null;
    pendingPosition = null;
    writing = true;

    const written = room
      ? store.save(room)
      : store.savePosition(position!.trackId, position!.positionSeconds);

    void written
      .catch((error: unknown) => {
        onError(error);
        // Put it back, unless something newer has arrived in the meantime — the
        // night carries on while the connection is away, and catches up when it
        // returns.
        if (room && pendingRoom === null) pendingRoom = room;
        if (position && pendingRoom === null && pendingPosition === null) {
          pendingPosition = position;
        }
        retrying = setTimeout(() => {
          retrying = undefined;
          pump();
        }, retryMs);
        retrying.unref?.();
      })
      .finally(() => {
        writing = false;
        pump();
        announceIfIdle();
      });
  }

  return {
    room(state) {
      pendingRoom = state;
      pump();
    },

    position(trackId, positionSeconds) {
      const now = Date.now();
      // Dropped rather than delayed: another report is a second away, so waiting
      // for this one would only write a staler number later.
      if (now - lastPositionAt < positionEveryMs) return;
      lastPositionAt = now;
      pendingPosition = { trackId, positionSeconds };
      pump();
    },

    drain() {
      if (settled()) return Promise.resolve();
      // A write being retried is still pending, so a drain waits for the retry
      // rather than for the failure.
      return new Promise<void>((resolve) => idle.push(resolve));
    }
  };
}
