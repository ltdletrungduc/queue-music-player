import type { RoomState, Song } from '@qmp/shared';

export type { Controller, RoomState, Song, SourceName, Track } from '@qmp/shared';

export type Command =
  | { type: 'controller/connected'; controllerId: string; nickname: string }
  | { type: 'controller/disconnected'; controllerId: string }
  | { type: 'track/added'; song: Song; controllerId: string; nickname: string };

/**
 * Work the reducer wants done but will not do itself, so that it stays pure and
 * every side effect is observable in tests as plain data.
 */
export type Effect = { type: 'broadcast-snapshot' };

/** Everything the reducer would otherwise reach into the world for. */
export type Ctx = {
  now: number;
  newId: () => string;
};

export type Reduced = {
  state: RoomState;
  effects: Effect[];
};
