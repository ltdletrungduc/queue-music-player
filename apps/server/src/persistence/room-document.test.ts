import { describe, expect, it } from 'vitest';
import type { RoomState, Song, Track } from '@qmp/shared';
import { fromDocument, toDocument } from './room-document.js';
import { emptyRoom } from '../room/reduce.js';

const song = (sourceId: string): Song => ({
  id: `youtube:${sourceId}`,
  source: 'youtube',
  sourceId,
  title: `Title ${sourceId}`,
  author: 'Someone',
  durationSeconds: 213,
  artworkUrl: `https://i.ytimg.test/${sourceId}.jpg`
});

const track = (id: string, orderKey: string, sourceId = id): Track => ({
  id,
  song: song(sourceId),
  orderKey,
  addedByNickname: 'Duc',
  addedAt: 1_700_000_000_000
});

/**
 * What the Room looks like after a real restart: written down, sent over a wire
 * as plain JSON, and read back. Anything that only survives inside this process
 * — an `undefined`, a shared reference — does not survive this.
 */
const roundTrip = (state: RoomState): RoomState =>
  fromDocument(JSON.parse(JSON.stringify(toDocument(state))));

describe('a Room store', () => {
  it('gives an empty Room when nothing has ever been saved', () => {
    expect(fromDocument(undefined)).toEqual(emptyRoom());
  });

  it('gives back the Queue it was given, Songs and all', () => {
    const before = { ...emptyRoom(), queue: [track('t1', 'a0'), track('t2', 'a1')] };
    expect(roundTrip(before)).toEqual(before);
  });

  it('keeps the Queue in order, whatever order it was written in', () => {
    const before = { ...emptyRoom(), queue: [track('t2', 'a2'), track('t1', 'a1')] };
    expect(roundTrip(before).queue.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('keeps one Song however many times it was queued', () => {
    const before = {
      ...emptyRoom(),
      queue: [track('t1', 'a0', 'same'), track('t2', 'a1', 'same'), track('t3', 'a2', 'other')]
    };

    const queue = roundTrip(before).queue;
    expect(queue.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(queue.map((t) => t.song.id)).toEqual(['youtube:same', 'youtube:same', 'youtube:other']);
  });

  it('does not bring Controllers back, because they reconnect for themselves', () => {
    const before = {
      ...emptyRoom(),
      queue: [track('t1', 'a0')],
      controllers: [{ id: 'c1', nickname: 'Duc', connectionId: 'conn-1', connectedAt: 1 }]
    };
    expect(roundTrip(before).controllers).toEqual([]);
  });

  it('remembers what was playing, so a restart does not lose the place', () => {
    const before = {
      ...emptyRoom(),
      nowPlaying: track('playing', 'a1'),
      queue: [track('waiting', 'a2')],
      history: [track('done', 'a0')]
    };
    expect(roundTrip(before)).toEqual({
      ...before,
      transport: { ...before.transport, isPlaying: true }
    });
  });

  it('comes back playing when something was playing', () => {
    expect(roundTrip({ ...emptyRoom(), nowPlaying: track('playing', 'a1') }).transport.isPlaying).toBe(
      true
    );
  });

  it('comes back silent when nothing was playing', () => {
    expect(roundTrip({ ...emptyRoom(), queue: [track('waiting', 'a1')] }).transport.isPlaying).toBe(
      false
    );
  });

  it('picks a restarted Track up where it left off', () => {
    const before = {
      ...emptyRoom(),
      nowPlaying: track('playing', 'a1'),
      transport: {
        isPlaying: true,
        volume: 0.5,
        volumeBeforeMute: null,
        positionSeconds: 91,
        positionReportedAt: 1234,
        startedAt: 1000,
        failedAttempts: 0
      }
    };
    expect(roundTrip(before).transport.positionSeconds).toBe(91);
  });

  it('does not carry a position over to a Track that was only waiting', () => {
    const before = {
      ...emptyRoom(),
      queue: [track('waiting', 'a1')],
      transport: { ...emptyRoom().transport, positionSeconds: 91 }
    };
    expect(roundTrip(before).transport.positionSeconds).toBe(0);
  });

  it('does not hand a position to the Track that came after the one it was measured in', () => {
    // A position is written far more often than the Room is, so a stale one is
    // always lying around by the time a Track changes.
    const document = {
      ...toDocument({ ...emptyRoom(), nowPlaying: track('now', 'a1') }),
      position: { trackId: 'the-one-before', seconds: 91 }
    };
    expect(fromDocument(document).transport.positionSeconds).toBe(0);
  });

  it('remembers why a Track could not be played', () => {
    const broken = { ...track('bad', 'a0'), unplayableReason: 'That video is private.' };
    expect(roundTrip({ ...emptyRoom(), history: [broken] }).history[0]?.unplayableReason).toBe(
      'That video is private.'
    );
  });

  it('leaves a Track that played properly unmarked', () => {
    const loaded = roundTrip({ ...emptyRoom(), history: [track('fine', 'a0')] });
    expect(loaded.history[0]?.unplayableReason).toBeUndefined();
    expect('unplayableReason' in loaded.history[0]!).toBe(false);
  });

  it('opens a Room saved before those fields existed', () => {
    // Pretend this Room predates the fields, as a real one would: written when
    // nothing was recorded about failing or about where the audio had reached.
    const older = {
      queue: [{ id: 't1', orderKey: 'a0', addedByNickname: 'Duc', addedAt: 1, song: song('t1') }]
    };

    const loaded = fromDocument(older);
    expect(loaded.queue[0]?.id).toBe('t1');
    expect(loaded.queue[0]?.unplayableReason).toBeUndefined();
    expect(loaded.transport.positionSeconds).toBe(0);
  });

  it('opens a Room somebody edited badly in the console', () => {
    // The reason to keep the Room somewhere it can be corrected by hand is that
    // it will be corrected by hand. A mangled Track costs that Track.
    const meddled = {
      queue: [track('good', 'a0'), { orderKey: 'a1' }, 'not a Track at all', null],
      history: 'cleared, apparently',
      playlists: [{ name: 'no id' }],
      position: 'about halfway'
    };

    const loaded = fromDocument(meddled);
    expect(loaded.queue.map((t) => t.id)).toEqual(['good']);
    expect(loaded.history).toEqual([]);
    expect(loaded.playlists).toEqual([]);
    expect(loaded.transport.positionSeconds).toBe(0);
  });

  it('keeps History most recent first across a restart', () => {
    const before = { ...emptyRoom(), history: [track('recent', 'a2'), track('older', 'a1')] };
    expect(roundTrip(before).history.map((t) => t.id)).toEqual(['recent', 'older']);
  });

  it('keeps a Song that is only in History', () => {
    const before = { ...emptyRoom(), history: [track('done', 'a0')] };
    expect(roundTrip(before).history[0]?.song.title).toBe('Title done');
  });

  it('replaces the previous Queue rather than accumulating', () => {
    // Every write is the whole Room, so a Queue that shrank comes back shorter.
    const first = toDocument({ ...emptyRoom(), queue: [track('t1', 'a0'), track('t2', 'a1')] });
    const second = toDocument({ ...emptyRoom(), queue: [track('t3', 'a0')] });
    expect(first).not.toEqual(second);
    expect(fromDocument(second).queue.map((t) => t.id)).toEqual(['t3']);
  });
});

describe('Playlists in the store', () => {
  const playlist = (id: string, trackIds: string[]) => ({
    id,
    name: `List ${id}`,
    createdByNickname: 'Duc',
    createdAt: 1_700_000_000_000,
    // A saved Track remembers a name, not a device: the phone that added it may
    // be long gone by the time the Playlist is used again.
    tracks: trackIds.map((t, i) => ({ ...track(t, `a${i}`) }))
  });

  it('gives back the Playlists it was given', () => {
    const before = { ...emptyRoom(), playlists: [playlist('p1', ['t1', 't2'])] };
    expect(roundTrip(before)).toEqual(before);
  });

  it('keeps a Playlist across a restart', () => {
    const before = { ...emptyRoom(), playlists: [playlist('p1', ['t1'])] };
    expect(roundTrip(before).playlists[0]?.tracks).toHaveLength(1);
  });

  it('will not hold the same Song twice, whatever it is told', () => {
    const twice = {
      ...emptyRoom(),
      playlists: [
        {
          ...playlist('p1', []),
          tracks: [{ ...track('t1', 'a0', 'same') }, { ...track('t2', 'a1', 'same') }]
        }
      ]
    };
    // A table used to promise this. Nothing about a document does, so the write
    // is refused rather than trusting the caller's good manners.
    expect(() => toDocument(twice)).toThrow(/once/);
  });

  it('keeps a Playlist separate from the Queue', () => {
    const loaded = roundTrip({
      ...emptyRoom(),
      queue: [track('q1', 'a0', 'shared')],
      playlists: [playlist('p1', ['s1'])]
    });

    expect(loaded.queue.map((t) => t.id)).toEqual(['q1']);
    expect(loaded.playlists[0]?.tracks.map((t) => t.id)).toEqual(['s1']);
  });
});
