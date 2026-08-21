import Database from 'better-sqlite3';
import type { RoomState, Song, SourceName, Track } from '@qmp/shared';
import { emptyRoom } from '../room/reduce.js';

export type RoomStore = Database.Database;

/**
 * The Queue, Now Playing and History are the same rows in different states, so
 * a Track moving between them is one column changing rather than a row moving
 * between tables.
 */
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

CREATE TABLE IF NOT EXISTS tracks (
  id                     TEXT PRIMARY KEY,
  song_id                TEXT NOT NULL REFERENCES songs(id),
  state                  TEXT NOT NULL CHECK (state IN ('queued', 'playing', 'played')),
  order_key              TEXT NOT NULL,
  played_rank            INTEGER,
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
  state: 'queued' | 'playing' | 'played';
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

const toTrack = (r: TrackRow): Track => ({
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
});

/**
 * Controllers are deliberately absent: they are live connections, so after a
 * restart nobody is here until their browser says otherwise.
 */
export function loadRoom(db: RoomStore): RoomState {
  const rows = db
    .prepare<[], TrackRow>(
      `SELECT t.id, t.state, t.order_key, t.added_by_controller_id, t.added_by_nickname, t.added_at,
              s.id AS song_id, s.source, s.source_id, s.title, s.author,
              s.duration_seconds, s.artwork_url
         FROM tracks t
         JOIN songs s ON s.id = t.song_id
        ORDER BY t.played_rank, t.order_key`
    )
    .all();

  const inState = (state: TrackRow['state']) => rows.filter((r) => r.state === state).map(toTrack);

  const nowPlaying = inState('playing')[0] ?? null;
  const blank = emptyRoom();

  return {
    ...blank,
    queue: inState('queued'),
    nowPlaying,
    history: inState('played'),
    // Where the audio had reached is not written down, so a restarted Room picks
    // its Track up from the beginning. It does pick it up, though: a Room that
    // was playing before should not come back silent.
    transport: { ...blank.transport, isPlaying: nowPlaying !== null }
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
    `INSERT INTO tracks
       (id, song_id, state, order_key, played_rank, added_by_controller_id, added_by_nickname, added_at)
     VALUES (@id, @songId, @state, @orderKey, @playedRank, @addedByControllerId, @addedByNickname, @addedAt)`
  );
  const clearTracks = db.prepare('DELETE FROM tracks');

  const write = (track: Track, trackState: TrackRow['state'], playedRank: number | null) => {
    upsertSong.run(track.song);
    insertTrack.run({
      id: track.id,
      songId: track.song.id,
      state: trackState,
      orderKey: track.orderKey,
      playedRank,
      addedByControllerId: track.addedByControllerId,
      addedByNickname: track.addedByNickname,
      addedAt: track.addedAt
    });
  };

  db.transaction(() => {
    clearTracks.run();
    // History is ordered most recent first, which no natural column recovers,
    // so its position is written down rather than derived.
    state.history.forEach((track, rank) => write(track, 'played', rank));
    if (state.nowPlaying) write(state.nowPlaying, 'playing', null);
    for (const track of state.queue) write(track, 'queued', null);
  })();
}
