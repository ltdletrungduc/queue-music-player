import { generateKeyBetween } from 'fractional-indexing';
import type { Command, Ctx, Reduced, RoomState } from './types.js';

export const emptyRoom = (): RoomState => ({ queue: [], controllers: [] });

const unchanged = (state: RoomState): Reduced => ({ state, effects: [] });
const broadcast = (state: RoomState): Reduced => ({ state, effects: [{ type: 'broadcast-snapshot' }] });

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
      const last = state.queue.at(-1)?.orderKey ?? null;
      return broadcast({
        ...state,
        queue: [
          ...state.queue,
          {
            id: ctx.newId(),
            song: command.song,
            orderKey: generateKeyBetween(last, null),
            addedByControllerId: command.controllerId,
            addedByNickname: command.nickname,
            addedAt: ctx.now
          }
        ]
      });
    }
  }
}
