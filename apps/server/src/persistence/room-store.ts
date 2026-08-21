import Database from 'better-sqlite3';
import { emptyRoom } from '../room/reduce.js';
import type { RoomState, Track } from '../room/types.js';

export type RoomStore = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS queue_tracks (
  id                     TEXT PRIMARY KEY,
  source                 TEXT NOT NULL,
  source_id              TEXT NOT NULL,
  order_key              TEXT NOT NULL,
  added_by_controller_id TEXT NOT NULL,
  added_at               INTEGER NOT NULL
);
`;

export function openRoomStore(file: string): RoomStore {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

type TrackRow = {
  id: string;
  source: string;
  source_id: string;
  order_key: string;
  added_by_controller_id: string;
  added_at: number;
};

/**
 * Controllers are deliberately absent: they are live connections, so after a
 * restart nobody is here until their browser says otherwise.
 */
export function loadRoom(db: RoomStore): RoomState {
  const rows = db
    .prepare<[], TrackRow>(
      `SELECT id, source, source_id, order_key, added_by_controller_id, added_at
         FROM queue_tracks
        ORDER BY order_key`
    )
    .all();

  return {
    ...emptyRoom(),
    queue: rows.map(
      (r): Track => ({
        id: r.id,
        source: r.source as Track['source'],
        sourceId: r.source_id,
        orderKey: r.order_key,
        addedByControllerId: r.added_by_controller_id,
        addedAt: r.added_at
      })
    )
  };
}

export function saveRoom(db: RoomStore, state: RoomState): void {
  const clear = db.prepare('DELETE FROM queue_tracks');
  const insert = db.prepare(
    `INSERT INTO queue_tracks (id, source, source_id, order_key, added_by_controller_id, added_at)
     VALUES (@id, @source, @sourceId, @orderKey, @addedByControllerId, @addedAt)`
  );

  db.transaction(() => {
    clear.run();
    for (const track of state.queue) insert.run(track);
  })();
}
