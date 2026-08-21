import Database from 'better-sqlite3';
import type { Playlist, RoomState, Song, SourceName, Track } from '@qmp/shared';
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
  added_by_nickname      TEXT NOT NULL,
  added_at               INTEGER NOT NULL,
  unplayable_reason      TEXT,
  /* How far into this Track the audio had reached. Only ever set on the one playing. */
  position_seconds       REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS playlists (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  created_by_nickname  TEXT NOT NULL,
  created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id                     TEXT PRIMARY KEY,
  playlist_id            TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id                TEXT NOT NULL REFERENCES songs(id),
  order_key              TEXT NOT NULL,
  added_by_nickname      TEXT NOT NULL,
  added_at               INTEGER NOT NULL,
  /* A Song belongs to a Playlist at most once, whatever the caller believes. */
  UNIQUE (playlist_id, song_id)
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
  // Once carried on every Track and read by nothing. A Nickname is what a Track
  // is attributed to; the device that typed it was never consulted again.
  if (columns.includes('added_by_controller_id')) {
    db.exec('ALTER TABLE tracks DROP COLUMN added_by_controller_id');
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
      `SELECT t.id, t.state, t.order_key, t.added_by_nickname, t.added_at,
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
    playlists: loadPlaylists(db),
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

type PlaylistTrackRow = {
  playlist_id: string;
  id: string;
  order_key: string;
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

function loadPlaylists(db: RoomStore): Playlist[] {
  const lists = db
    .prepare<[], { id: string; name: string; created_by_nickname: string; created_at: number }>(
      'SELECT id, name, created_by_nickname, created_at FROM playlists ORDER BY created_at'
    )
    .all();

  const rows = db
    .prepare<[], PlaylistTrackRow>(
      `SELECT p.playlist_id, p.id, p.order_key, p.added_by_nickname, p.added_at,
              s.id AS song_id, s.source, s.source_id, s.title, s.author,
              s.duration_seconds, s.artwork_url
         FROM playlist_tracks p
         JOIN songs s ON s.id = p.song_id
        ORDER BY p.order_key`
    )
    .all();

  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    createdByNickname: list.created_by_nickname,
    createdAt: list.created_at,
    tracks: rows
      .filter((r) => r.playlist_id === list.id)
      .map((r) => ({
        id: r.id,
        orderKey: r.order_key,
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
      }))
  }));
}

/**
 * Writes only where the audio has reached. Called every second while a Track
 * plays, so it must not be the whole-Room rewrite that everything else uses.
 */
export function savePosition(db: RoomStore, trackId: string, positionSeconds: number): void {
  db.prepare('UPDATE tracks SET position_seconds = ? WHERE id = ?').run(positionSeconds, trackId);
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
       (id, song_id, state, order_key, played_rank, added_by_nickname,
      added_at, unplayable_reason, position_seconds)
     VALUES (@id, @songId, @state, @orderKey, @playedRank, @addedByNickname,
             @addedAt, @unplayableReason, @positionSeconds)`
  );
  const clearTracks = db.prepare('DELETE FROM tracks');
  const clearPlaylists = db.prepare('DELETE FROM playlists');
  const clearPlaylistTracks = db.prepare('DELETE FROM playlist_tracks');
  const insertPlaylist = db.prepare(
    `INSERT INTO playlists (id, name, created_by_nickname, created_at)
     VALUES (@id, @name, @createdByNickname, @createdAt)`
  );
  const insertPlaylistTrack = db.prepare(
    `INSERT INTO playlist_tracks (id, playlist_id, song_id, order_key, added_by_nickname, added_at)
     VALUES (@id, @playlistId, @songId, @orderKey, @addedByNickname, @addedAt)`
  );

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

    clearPlaylistTracks.run();
    clearPlaylists.run();
    for (const playlist of state.playlists) {
      insertPlaylist.run({
        id: playlist.id,
        name: playlist.name,
        createdByNickname: playlist.createdByNickname,
        createdAt: playlist.createdAt
      });
      for (const track of playlist.tracks) {
        upsertSong.run(track.song);
        insertPlaylistTrack.run({
          id: track.id,
          playlistId: playlist.id,
          songId: track.song.id,
          orderKey: track.orderKey,
          addedByNickname: track.addedByNickname,
          addedAt: track.addedAt
        });
      }
    }
  })();
}
