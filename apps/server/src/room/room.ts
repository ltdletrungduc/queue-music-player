import { reduce } from './reduce.js';
import { loadRoom, savePosition, saveRoom, type RoomStore } from '../persistence/room-store.js';
import type { Command, Effect, RoomState, Song } from './types.js';

export type RoomRuntime = {
  /** The current Room, as sent to Controllers. */
  snapshot: () => RoomState;
  /** A Song the Room knows about, wherever the Track holding it happens to sit. */
  findSong: (songId: string) => Song | undefined;
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
  const restored = loadRoom(store);
  // Where the audio had reached is not written down, so a restored Track starts
  // from the top — but it starts *now*, not at the epoch, or everything that
  // measures elapsed playback reads the Room as having just begun in 1970.
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
      // touch no disk at all. Everything that is written down is checked, not
      // just the Queue: gating on the Queue alone quietly lost every Playlist,
      // because saving one never changes the Queue.
      if (
        state.queue !== before.queue ||
        state.nowPlaying !== before.nowPlaying ||
        state.history !== before.history ||
        state.playlists !== before.playlists
      ) {
        saveRoom(store, state);
      } else if (
        state.nowPlaying &&
        state.transport.positionSeconds !== before.transport.positionSeconds
      ) {
        // Once a second while a Track plays. Far too often for a whole-Room
        // rewrite, and the only reason a restart can pick a Track up mid-way.
        savePosition(store, state.nowPlaying.id, state.transport.positionSeconds);
      }

      return effects;
    }
  };
}
