import { generateKeyBetween } from 'fractional-indexing';
export { emptyRoom } from '@qmp/shared';
import type { Command, Ctx, Reduced, RoomState, Track } from './types.js';

const unchanged = (state: RoomState): Reduced => ({ state, effects: [] });
const broadcast = (state: RoomState): Reduced => ({ state, effects: [{ type: 'broadcast-snapshot' }] });

/**
 * Nothing sounds while the Room is idle, so the moment a Track is waiting it is
 * pulled out of the Queue and into Now Playing. This is what makes adding to an
 * empty Queue start the music without anyone pressing anything.
 */
function startNextIfIdle(state: RoomState): RoomState {
  if (state.nowPlaying !== null) return state;
  const [next, ...rest] = state.queue;
  if (!next) return state;
  return { ...state, nowPlaying: next, queue: rest };
}

export function reduce(state: RoomState, command: Command, ctx: Ctx): Reduced {
  switch (command.type) {
    case 'controller/connected': {
      const others = state.controllers.filter((c) => c.id !== command.controllerId);
      return broadcast({
        ...state,
        controllers: [
          ...others,
          { id: command.controllerId, nickname: command.nickname, connectedAt: ctx.now }
        ]
      });
    }

    case 'controller/disconnected': {
      if (!state.controllers.some((c) => c.id === command.controllerId)) return unchanged(state);
      return broadcast({
        ...state,
        controllers: state.controllers.filter((c) => c.id !== command.controllerId)
      });
    }

    case 'track/added': {
      // Ordering spans the Queue only; Now Playing has left it.
      const last = state.queue.at(-1)?.orderKey ?? null;
      const track: Track = {
        id: ctx.newId(),
        song: command.song,
        orderKey: generateKeyBetween(last, null),
        addedByControllerId: command.controllerId,
        addedByNickname: command.nickname,
        addedAt: ctx.now
      };
      return broadcast(startNextIfIdle({ ...state, queue: [...state.queue, track] }));
    }

    case 'track/ended': {
      const finished = state.nowPlaying;
      // A Player that reconnects, or a second one, can report a Track that has
      // already been dealt with. Only the Track actually sounding may end.
      if (!finished || finished.id !== command.trackId) return unchanged(state);
      return broadcast(
        startNextIfIdle({
          ...state,
          nowPlaying: null,
          history: [finished, ...state.history]
        })
      );
    }
  }
}
