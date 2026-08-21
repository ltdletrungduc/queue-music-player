import { reduce } from './reduce.js';
import { loadRoom, saveRoom, type RoomStore } from '../persistence/room-store.js';
import type { Command, Effect, RoomState } from './types.js';

export type RoomRuntime = {
  /** The current Room, as sent to Controllers. */
  snapshot: () => RoomState;
  dispatch: (command: Command) => Effect[];
};

export type Clock = {
  now: () => number;
  newId: () => string;
};

/**
 * Owns the Room: restores it from the store on creation, and keeps the store in
 * step as Commands arrive. Effects are handed back to the caller rather than
 * performed here, so the transport stays the only thing that knows about sockets.
 */
export function createRoomRuntime(store: RoomStore, clock: Clock): RoomRuntime {
  let room = loadRoom(store);

  return {
    snapshot: () => room,
    dispatch(command) {
      const { state, effects } = reduce(room, command, { now: clock.now(), newId: clock.newId });
      // Controllers coming and going never touch the Queue, and the Queue is all
      // that is persisted, so most Commands should not write to disk at all.
      if (state.queue !== room.queue) saveRoom(store, state);
      room = state;
      return effects;
    }
  };
}
