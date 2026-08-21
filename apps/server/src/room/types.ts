/**
 * One entry in the Queue: a reference to a piece of audio at a Source, plus who
 * added it and where it sits in the order. Title, duration and artwork arrive
 * with the Source Provider; they are not known yet.
 */
export type Track = {
  id: string;
  source: 'youtube';
  sourceId: string;
  /** Fractional index, so a reorder rewrites one row and concurrent drags converge. */
  orderKey: string;
  addedByControllerId: string;
  addedAt: number;
};

export type Controller = {
  id: string;
  connectedAt: number;
};

export type RoomState = {
  queue: Track[];
  controllers: Controller[];
};

export type Command =
  | { type: 'controller/connected'; controllerId: string }
  | { type: 'controller/disconnected'; controllerId: string };

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
