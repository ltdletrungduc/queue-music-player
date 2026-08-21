import type { RoomState, Song } from '@qmp/shared';

export type { Controller, RoomAction, RoomState, Song, SourceName, Track, Transport } from '@qmp/shared';

export type Command =
  | { type: 'controller/connected'; controllerId: string; nickname: string }
  | { type: 'controller/disconnected'; controllerId: string }
  | { type: 'track/added'; song: Song; controllerId: string; nickname: string }
  | { type: 'track/ended'; trackId: string }
  /** Place a waiting Track after another, or at the front when nothing precedes it. */
  | { type: 'track/moved'; trackId: string; afterTrackId: string | null; nickname: string }
  | { type: 'track/play-next'; trackId: string; nickname: string }
  | { type: 'track/removed'; trackId: string; nickname: string }
  | { type: 'transport/paused'; nickname: string }
  | { type: 'transport/resumed'; nickname: string }
  | { type: 'transport/skipped'; trackId: string; nickname: string }
  | { type: 'transport/previous'; trackId: string; nickname: string }
  | { type: 'transport/volume'; volume: number; nickname: string }
  | { type: 'player/position'; trackId: string; positionSeconds: number };

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
