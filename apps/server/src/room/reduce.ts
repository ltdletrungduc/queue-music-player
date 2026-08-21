import { generateKeyBetween } from 'fractional-indexing';
export { emptyRoom } from '@qmp/shared';
import type { Command, Ctx, Reduced, RoomAction, RoomState, Track } from './types.js';

const unchanged = (state: RoomState): Reduced => ({ state, effects: [] });
const broadcast = (state: RoomState): Reduced => ({ state, effects: [{ type: 'broadcast-snapshot' }] });

/**
 * Nothing sounds while the Room is idle, so the moment a Track is waiting it is
 * pulled out of the Queue and into Now Playing. This is what makes adding to an
 * empty Queue start the music without anyone pressing anything.
 *
 * A Track arriving in Now Playing always plays: whatever the Room was doing
 * before, someone wanting this Track next is the more recent wish.
 */
function startNextOrGoIdle(state: RoomState, now: number): RoomState {
  if (state.nowPlaying !== null) return state;
  const [next, ...rest] = state.queue;
  if (!next) {
    return state.transport.isPlaying
      ? { ...state, transport: { ...state.transport, isPlaying: false } }
      : state;
  }

  return {
    ...state,
    nowPlaying: next,
    queue: rest,
    transport: { ...state.transport, isPlaying: true, positionSeconds: 0, positionReportedAt: now }
  };
}

/** Retires the Track that is sounding and brings the next one up. */
function retireNowPlaying(state: RoomState, now: number): RoomState {
  const finished = state.nowPlaying;
  if (!finished) return state;
  return startNextOrGoIdle({ ...state, nowPlaying: null, history: [finished, ...state.history] }, now);
}

const attributed = (state: RoomState, action: RoomAction): RoomState => ({ ...state, lastAction: action });

const clamp = (value: number) => Math.min(1, Math.max(0, value));

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
      return broadcast(startNextOrGoIdle({ ...state, queue: [...state.queue, track] }, ctx.now));
    }

    case 'track/ended': {
      // A Player that reconnects, or a second one, can report a Track that has
      // already been dealt with. Only the Track actually sounding may end.
      if (state.nowPlaying?.id !== command.trackId) return unchanged(state);
      return broadcast(retireNowPlaying(state, ctx.now));
    }

    case 'transport/paused': {
      if (!state.transport.isPlaying) return unchanged(state);
      return broadcast(
        attributed({ ...state, transport: { ...state.transport, isPlaying: false } }, {
          nickname: command.nickname,
          did: 'paused',
          at: ctx.now
        })
      );
    }

    case 'transport/resumed': {
      if (state.transport.isPlaying || !state.nowPlaying) return unchanged(state);
      return broadcast(
        attributed(
          {
            ...state,
            // The clock starts again from here. Without this, everyone's progress
            // bar counts the whole pause as time played and leaps to the end.
            transport: { ...state.transport, isPlaying: true, positionReportedAt: ctx.now }
          },
          { nickname: command.nickname, did: 'resumed', at: ctx.now }
        )
      );
    }

    case 'transport/skipped': {
      // Same rule as ending: only the Track actually sounding may be skipped.
      if (state.nowPlaying?.id !== command.trackId) return unchanged(state);
      return broadcast(
        attributed(retireNowPlaying(state, ctx.now), {
          nickname: command.nickname,
          did: 'skipped',
          at: ctx.now
        })
      );
    }

    case 'transport/volume': {
      const volume = clamp(command.volume);
      if (volume === state.transport.volume) return unchanged(state);
      return broadcast(
        attributed({ ...state, transport: { ...state.transport, volume } }, {
          nickname: command.nickname,
          did: 'volume',
          volume,
          at: ctx.now
        })
      );
    }

    case 'player/position': {
      // A report about a Track that has already moved on would drag the progress
      // bar backwards into a Track nobody is hearing.
      if (state.nowPlaying?.id !== command.trackId) return unchanged(state);
      return broadcast({
        ...state,
        transport: {
          ...state.transport,
          positionSeconds: command.positionSeconds,
          positionReportedAt: ctx.now
        }
      });
    }
  }
}
