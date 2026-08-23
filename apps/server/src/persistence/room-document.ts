import type { Playlist, RoomState, Song, SourceName, Track } from '@qmp/shared';
import { emptyRoom } from '../room/reduce.js';

/**
 * The Room as one plain document, which is what Firestore stores and what
 * somebody looking at the console reads. Nothing in here is Firestore-specific,
 * so the mapping — where all the judgement lives — is tested on its own.
 *
 * There are no tables and no join. A Song is written wherever the Track holding
 * it is written, which duplicates a little text and removes the row that used to
 * have to be kept alive for whichever list still pointed at it.
 */
export type RoomDocument = {
  queue: TrackDocument[];
  nowPlaying: TrackDocument | null;
  /** Most recent first — the order it is read back in, so nothing derives it. */
  history: TrackDocument[];
  playlists: PlaylistDocument[];
  /**
   * How far the audio had reached, and which Track it had reached it in. The
   * Track is named so a position cannot be inherited by whatever plays next.
   */
  position: { trackId: string | null; seconds: number };
};

export type TrackDocument = {
  id: string;
  orderKey: string;
  addedByNickname: string;
  addedAt: number;
  unplayableReason?: string;
  song: Song;
};

export type PlaylistDocument = {
  id: string;
  name: string;
  createdByNickname: string;
  createdAt: number;
  tracks: TrackDocument[];
};

/**
 * `undefined` is not a value a document can hold, so an absent reason is an
 * absent field rather than a present one saying nothing.
 */
const toTrackDocument = (track: Track): TrackDocument => ({
  id: track.id,
  orderKey: track.orderKey,
  addedByNickname: track.addedByNickname,
  addedAt: track.addedAt,
  ...(track.unplayableReason === undefined ? {} : { unplayableReason: track.unplayableReason }),
  song: track.song
});

const toPlaylistDocument = (playlist: Playlist): PlaylistDocument => {
  const songIds = new Set<string>();
  for (const track of playlist.tracks) {
    // A Song belongs to a Playlist at most once. A table used to promise this
    // and a document cannot, so the promise is kept here instead — refusing the
    // write rather than quietly storing the same Song twice.
    if (songIds.has(track.song.id)) {
      throw new Error(
        `Playlist ${playlist.id} holds ${track.song.id} twice. A Song appears in a Playlist once.`
      );
    }
    songIds.add(track.song.id);
  }

  return {
    id: playlist.id,
    name: playlist.name,
    createdByNickname: playlist.createdByNickname,
    createdAt: playlist.createdAt,
    tracks: playlist.tracks.map(toTrackDocument)
  };
};

/**
 * Controllers and Player connections are deliberately absent: they are live
 * connections, so after a restart nobody is here until their browser says
 * otherwise.
 */
export function toDocument(state: RoomState): RoomDocument {
  return {
    queue: state.queue.map(toTrackDocument),
    nowPlaying: state.nowPlaying ? toTrackDocument(state.nowPlaying) : null,
    history: state.history.map(toTrackDocument),
    playlists: state.playlists.map(toPlaylistDocument),
    position: {
      trackId: state.nowPlaying?.id ?? null,
      seconds: state.nowPlaying ? state.transport.positionSeconds : 0
    }
  };
}

/**
 * Reading is forgiving, because the point of moving the Room into a console is
 * that somebody can correct it there. A field that is missing, or replaced by
 * something that is not a Track, costs that entry rather than the evening.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function toSong(value: unknown): Song | null {
  if (!isRecord(value) || typeof value['id'] !== 'string') return null;
  return {
    id: value['id'],
    source: text(value['source'], 'youtube') as SourceName,
    sourceId: text(value['sourceId']),
    title: text(value['title']),
    author: text(value['author']),
    durationSeconds: number(value['durationSeconds']),
    artworkUrl: text(value['artworkUrl'])
  };
}

function toTrack(value: unknown): Track | null {
  if (!isRecord(value) || typeof value['id'] !== 'string') return null;
  const song = toSong(value['song']);
  if (!song) return null;

  const reason = value['unplayableReason'];
  return {
    id: value['id'],
    orderKey: text(value['orderKey']),
    addedByNickname: text(value['addedByNickname']),
    addedAt: number(value['addedAt']),
    ...(typeof reason === 'string' && reason ? { unplayableReason: reason } : {}),
    song
  };
}

const toTracks = (value: unknown): Track[] =>
  (Array.isArray(value) ? value : []).map(toTrack).filter((t): t is Track => t !== null);

/**
 * The orderKey is what says where a Track sits, not the order the array happens
 * to be in — so a Track appended by hand in the console lands where it belongs.
 * History is the exception: it is stored most recent first and has no key that
 * recovers that, so its order is the array's.
 */
const inOrder = (tracks: Track[]): Track[] =>
  [...tracks].sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));

function toPlaylist(value: unknown): Playlist | null {
  if (!isRecord(value) || typeof value['id'] !== 'string') return null;
  return {
    id: value['id'],
    name: text(value['name']),
    createdByNickname: text(value['createdByNickname']),
    createdAt: number(value['createdAt']),
    tracks: inOrder(toTracks(value['tracks']))
  };
}

export function fromDocument(value: unknown): RoomState {
  const blank = emptyRoom();
  if (!isRecord(value)) return blank;

  const nowPlaying = toTrack(value['nowPlaying']);
  const position = isRecord(value['position']) ? value['position'] : {};

  return {
    ...blank,
    queue: inOrder(toTracks(value['queue'])),
    nowPlaying,
    history: toTracks(value['history']),
    playlists: (Array.isArray(value['playlists']) ? value['playlists'] : [])
      .map(toPlaylist)
      .filter((p): p is Playlist => p !== null),
    // A Room that was playing comes back playing, and picks the Track up where
    // it left off rather than at the beginning.
    transport: {
      ...blank.transport,
      isPlaying: nowPlaying !== null,
      positionSeconds:
        nowPlaying && position['trackId'] === nowPlaying.id ? number(position['seconds']) : 0
    }
  };
}
