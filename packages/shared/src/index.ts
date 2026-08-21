/**
 * The Room's vocabulary, shared by the server that owns it and the Controllers
 * that display it. See CONTEXT.md for what each term means.
 */

export type SourceName = 'youtube';

/** A piece of audio at a Source, independent of anywhere it appears. */
export type Song = {
  id: string;
  source: SourceName;
  sourceId: string;
  title: string;
  author: string;
  durationSeconds: number;
  artworkUrl: string;
};

/** Where a Song appears in the Queue, and who put it there. */
export type Track = {
  id: string;
  song: Song;
  /** Fractional index, so a reorder rewrites one row and concurrent drags converge. */
  orderKey: string;
  addedByControllerId: string;
  addedByNickname: string;
  addedAt: number;
};

export type Controller = {
  id: string;
  nickname: string;
  connectedAt: number;
};

export type RoomState = {
  queue: Track[];
  controllers: Controller[];
};

/** What came of trying to add a pasted link to the Queue. */
export type AddResult = { ok: true; song: Song } | { ok: false; reason: string };
