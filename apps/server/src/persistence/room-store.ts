import type { RoomState } from '@qmp/shared';

/**
 * What the Room asks of whatever remembers it. Nothing here names a database:
 * the Room keeps Songs, Tracks and Playlists, and asks only that they still be
 * there after a restart. See ADR-0004.
 *
 * Every method is asynchronous, because the store may be a network away. The
 * Room does not wait for any of them — see deferred-writes.ts for how a
 * synchronous `dispatch` still reaches an asynchronous store.
 */
export type RoomStore = {
  /** The Room as it was last written down. Read once, when the server starts. */
  load(): Promise<RoomState>;
  /** The whole Room as it now stands, replacing whatever was there. */
  save(state: RoomState): Promise<void>;
  /**
   * Only how far into a Track the audio has reached. Kept apart from `save`
   * because it is written while a Track plays rather than when one changes, and
   * it must not be the whole-Room rewrite that everything else uses.
   */
  savePosition(trackId: string, positionSeconds: number): Promise<void>;
  close(): Promise<void>;
};
