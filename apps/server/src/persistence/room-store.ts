import Database from 'better-sqlite3';
import type { RoomState, Song, SourceName, Track } from '@qmp/shared';
import { emptyRoom } from '../room/reduce.js';

export type RoomStore = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  id               TEXT PRIMARY KEY,
  source           TEXT NOT NULL,
  source_id        TEXT NOT NULL,
  title            TEXT NOT NULL,
  author           TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  artwork_url      TEXT NOT NULL,
  UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS queue_tracks (
  id                     TEXT PRIMARY KEY,
  song_id                TEXT NOT NULL REFERENCES songs(id),
  order_key              TEXT NOT NULL,
  added_by_controller_id TEXT NOT NULL,
  added_by_nickname      TEXT NOT NULL,
  added_at               INTEGER NOT NULL
);
`;

export function openRoomStore(file: string): RoomStore {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

type TrackRow = {
  id: string;
  order_key: string;
  added_by_controller_id: string;
  added_by_nickname: string;
  added_at: number;
  song_id: string;
  source: string;
  source_id: string;
  title: string;
  author: string;
  duration_seconds: number;
  artwork_url: string;
};

/**
 * Controllers are deliberately absent: they are live connections, so after a
 * restart nobody is here until their browser says otherwise.
 */
export function loadRoom(db: RoomStore): RoomState {
  const rows = db
    .prepare<[], TrackRow>(
      `SELECT t.id, t.order_key, t.added_by_controller_id, t.added_by_nickname, t.added_at,
              s.id AS song_id, s.source, s.source_id, s.title, s.author,
              s.duration_seconds, s.artwork_url
         FROM queue_tracks t
         JOIN songs s ON s.id = t.song_id
        ORDER BY t.order_key`
    )
    .all();

  return {
    ...emptyRoom(),
    queue: rows.map(
      (r): Track => ({
        id: r.id,
        orderKey: r.order_key,
        addedByControllerId: r.added_by_controller_id,
        addedByNickname: r.added_by_nickname,
        addedAt: r.added_at,
        song: {
          id: r.song_id,
          source: r.source as SourceName,
          sourceId: r.source_id,
          title: r.title,
          author: r.author,
          durationSeconds: r.duration_seconds,
          artworkUrl: r.artwork_url
        }
      })
    )
  };
}

export function saveRoom(db: RoomStore, state: RoomState): void {
  const upsertSong = db.prepare<Song>(
    `INSERT INTO songs (id, source, source_id, title, author, duration_seconds, artwork_url)
     VALUES (@id, @source, @sourceId, @title, @author, @durationSeconds, @artworkUrl)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title, author = excluded.author,
       duration_seconds = excluded.duration_seconds, artwork_url = excluded.artwork_url`
  );
  const insertTrack = db.prepare(
    `INSERT INTO queue_tracks (id, song_id, order_key, added_by_controller_id, added_by_nickname, added_at)
     VALUES (@id, @songId, @orderKey, @addedByControllerId, @addedByNickname, @addedAt)`
  );
  const clearTracks = db.prepare('DELETE FROM queue_tracks');

  db.transaction(() => {
    clearTracks.run();
    for (const track of state.queue) {
      upsertSong.run(track.song);
      insertTrack.run({
        id: track.id,
        songId: track.song.id,
        orderKey: track.orderKey,
        addedByControllerId: track.addedByControllerId,
        addedByNickname: track.addedByNickname,
        addedAt: track.addedAt
      });
    }
  })();
}
