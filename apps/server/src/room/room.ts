import { reduce } from './reduce.js';
import { deferWrites, type DeferOptions } from '../persistence/deferred-writes.js';
import type { RoomStore } from '../persistence/room-store.js';
import type { Command, Effect, RoomState, Song } from './types.js';

export type RoomRuntime = {
  /** The current Room, as sent to Controllers. */
  snapshot: () => RoomState;
  /** A Song the Room knows about, wherever the Track holding it happens to sit. */
  findSong: (songId: string) => Song | undefined;
  dispatch: (command: Command) => Effect[];
  /** Finishes writing the Room down and lets the store go. */
  close: () => Promise<void>;
};

export type Clock = {
  now: () => number;
  newId: () => string;
};

/**
 * Owns the Room: restores it from the store on creation, and keeps the store in
 * step as Commands arrive. Effects are handed back to the caller rather than
 * performed here, so the transport stays the only thing that knows about sockets.
 *
 * Creating a Runtime waits for the store; `dispatch` never does. The Room is
 * read once, and from then on the reducer in memory is what the Room is — the
 * store is told afterwards. See ADR-0004.
 */
export async function createRoomRuntime(
  store: RoomStore,
  clock: Clock,
  options: DeferOptions = {}
): Promise<RoomRuntime> {
  const restored = await store.load();
  const writes = deferWrites(store, options);

  // A restored Track picks up where it left off, but it starts *now*, not at the
  // epoch, or everything that measures elapsed playback reads the Room as having
  // just begun in 1970.
  let room: RoomState = restored.nowPlaying
    ? {
        ...restored,
        transport: { ...restored.transport, positionReportedAt: clock.now(), startedAt: clock.now() }
      }
    : restored;

  return {
    snapshot: () => room,

    findSong: (songId) =>
      [room.nowPlaying, ...room.queue, ...room.history].find((t) => t?.song.id === songId)?.song,

    dispatch(command) {
      const { state, effects } = reduce(room, command, { now: clock.now(), newId: clock.newId });
      const before = room;
      room = state;

      // Controllers coming and going are not written down, so most Commands
      // touch no store at all. Everything that is written down is checked, not
      // just the Queue: gating on the Queue alone quietly lost every Playlist,
      // because saving one never changes the Queue.
      if (
        state.queue !== before.queue ||
        state.nowPlaying !== before.nowPlaying ||
        state.history !== before.history ||
        state.playlists !== before.playlists
      ) {
        writes.room(state);
      } else if (
        state.nowPlaying &&
        state.transport.positionSeconds !== before.transport.positionSeconds
      ) {
        // Once a second while a Track plays. Far too often for a whole-Room
        // rewrite, and the only reason a restart can pick a Track up mid-way.
        writes.position(state.nowPlaying.id, state.transport.positionSeconds);
      }

      return effects;
    },

    async close() {
      await writes.drain();
      await store.close();
    }
  };
}
