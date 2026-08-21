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
  added_at               INTEGER NOT NULL,
  unplayable_reason      TEXT,
  /* How far into this Track the audio had reached. Only ever set on the one playing. */
  position_seconds       REAL NOT NULL DEFAULT 0
);
`;

/**
 * Columns added after a Room already existed. `CREATE TABLE IF NOT EXISTS` will
 * not add them to a table that is already there, so a Room from an earlier
 * version would otherwise fail on the first write rather than at startup.
 */
function addMissingColumns(db: RoomStore): void {
  const columns = db
    .prepare<[string], { name: string }>('SELECT name FROM pragma_table_info(?)')
    .all('tracks')
    .map((row) => row.name);

  if (!columns.includes('unplayable_reason')) {
    db.exec('ALTER TABLE tracks ADD COLUMN unplayable_reason TEXT');
  }
  if (!columns.includes('position_seconds')) {
    db.exec('ALTER TABLE tracks ADD COLUMN position_seconds REAL NOT NULL DEFAULT 0');
  }
}

export function openRoomStore(file: string): RoomStore {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  addMissingColumns(db);
  return db;
}

type TrackRow = {
  id: string;
  state: 'queued' | 'playing' | 'played';
  order_key: string;
  added_by_controller_id: string;
  added_by_nickname: string;
  added_at: number;
  unplayable_reason: string | null;
  position_seconds: number;
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
  ...(r.unplayable_reason === null ? {} : { unplayableReason: r.unplayable_reason }),
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
              t.unplayable_reason, t.position_seconds,
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
    // A Room that was playing comes back playing, and picks the Track up where
    // it left off rather than at the beginning.
    transport: {
      ...blank.transport,
      isPlaying: nowPlaying !== null,
      positionSeconds: rows.find((r) => r.state === 'playing')?.position_seconds ?? 0
    }
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
       (id, song_id, state, order_key, played_rank, added_by_controller_id, added_by_nickname,
      added_at, unplayable_reason, position_seconds)
     VALUES (@id, @songId, @state, @orderKey, @playedRank, @addedByControllerId, @addedByNickname,
             @addedAt, @unplayableReason, @positionSeconds)`
  );
  const clearTracks = db.prepare('DELETE FROM tracks');

  const write = (
    track: Track,
    trackState: TrackRow['state'],
    playedRank: number | null,
    positionSeconds = 0
  ) => {
    upsertSong.run(track.song);
    insertTrack.run({
      id: track.id,
      songId: track.song.id,
      state: trackState,
      orderKey: track.orderKey,
      playedRank,
      addedByControllerId: track.addedByControllerId,
      addedByNickname: track.addedByNickname,
      addedAt: track.addedAt,
      unplayableReason: track.unplayableReason ?? null,
      positionSeconds
    });
  };

  db.transaction(() => {
    clearTracks.run();
    // History is ordered most recent first, which no natural column recovers,
    // so its position is written down rather than derived.
    state.history.forEach((track, rank) => write(track, 'played', rank));
    if (state.nowPlaying) write(state.nowPlaying, 'playing', null, state.transport.positionSeconds);
    for (const track of state.queue) write(track, 'queued', null);
  })();
}
