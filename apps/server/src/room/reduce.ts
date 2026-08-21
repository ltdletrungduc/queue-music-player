import type { Command, Ctx, Reduced, RoomState } from './types.js';

export const emptyRoom = (): RoomState => ({ queue: [], controllers: [] });

const unchanged = (state: RoomState): Reduced => ({ state, effects: [] });

export function reduce(state: RoomState, command: Command, ctx: Ctx): Reduced {
  switch (command.type) {
    case 'controller/connected': {
      const others = state.controllers.filter((c) => c.id !== command.controllerId);
      return {
        state: {
          ...state,
          controllers: [...others, { id: command.controllerId, connectedAt: ctx.now }]
        },
        effects: [{ type: 'broadcast-snapshot' }]
      };
    }

    case 'controller/disconnected': {
      if (!state.controllers.some((c) => c.id === command.controllerId)) return unchanged(state);
      return {
        state: {
          ...state,
          controllers: state.controllers.filter((c) => c.id !== command.controllerId)
        },
        effects: [{ type: 'broadcast-snapshot' }]
      };
    }
  }
}
