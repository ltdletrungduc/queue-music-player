import { describe, expect, it } from 'vitest';
import type { Song } from '@qmp/shared';
import { emptyRoom, reduce } from './reduce.js';
import type { Command, Ctx, RoomState } from './types.js';

let ids = 0;
const ctx = (now = 1_000): Ctx => ({ now, newId: () => `id-${++ids}` });

const song = (sourceId: string): Song => ({
  id: `youtube:${sourceId}`,
  source: 'youtube',
  sourceId,
  title: `Title ${sourceId}`,
  author: 'Someone',
  durationSeconds: 213,
  artworkUrl: `https://i.ytimg.test/${sourceId}.jpg`
});

const add = (sourceId: string, nickname = 'Duc'): Command => ({
  type: 'track/added',
  song: song(sourceId),
  controllerId: 'c1',
  nickname
});

const withTracks = (...sourceIds: string[]): RoomState =>
  sourceIds.reduce((state, id) => reduce(state, add(id), ctx()).state, emptyRoom());

describe('an empty Room', () => {
  it('has an empty Queue', () => {
    expect(emptyRoom().queue).toEqual([]);
  });

  it('has nobody connected', () => {
    expect(emptyRoom().controllers).toEqual([]);
  });
});

describe('a Controller connecting', () => {
  const connect = (controllerId: string, nickname = 'Duc'): Command => ({
    type: 'controller/connected',
    controllerId,
    connectionId: `conn-${controllerId}`,
    nickname
  });

  it('appears in the Room under their Nickname', () => {
    const { state } = reduce(emptyRoom(), connect('c1'), ctx());
    expect(state.controllers).toEqual([{ id: 'c1', nickname: 'Duc', connectionId: 'conn-c1', connectedAt: 1_000 }]);
  });

  it('causes everyone to be told the new state', () => {
    const { effects } = reduce(emptyRoom(), connect('c1'), ctx());
    expect(effects).toEqual([{ type: 'broadcast-snapshot' }]);
  });

  it('is recorded at the time the Room was told, not the wall clock', () => {
    const { state } = reduce(emptyRoom(), connect('c1'), ctx(55));
    expect(state.controllers[0]?.connectedAt).toBe(55);
  });

  it('does not appear twice when the same device reconnects', () => {
    const first = reduce(emptyRoom(), connect('c1'), ctx(1));
    const second = reduce(first.state, connect('c1', 'Duc again'), ctx(2));
    expect(second.state.controllers).toEqual([
      { id: 'c1', nickname: 'Duc again', connectionId: 'conn-c1', connectedAt: 2 }
    ]);
  });

  it('leaves the Queue alone', () => {
    const before = withTracks('zzzzzzzzzzz', 'aaaaaaaaaaa');
    const { state } = reduce(before, connect('c2'), ctx());
    expect(state.queue).toBe(before.queue);
  });
});

describe('a Controller disconnecting', () => {
  const disconnect = (controllerId: string): Command => ({
    type: 'controller/disconnected',
    controllerId,
    connectionId: `conn-${controllerId}`
  });

  it('leaves the Room', () => {
    const two = reduce(
      reduce(emptyRoom(), { type: 'controller/connected', controllerId: 'c1', connectionId: 'conn-c1', nickname: 'Duc' }, ctx()).state,
      { type: 'controller/connected', controllerId: 'c2', connectionId: 'conn-c2', nickname: 'Mai' },
      ctx()
    ).state;
    const { state } = reduce(two, disconnect('c1'), ctx());
    expect(state.controllers.map((c) => c.id)).toEqual(['c2']);
  });

  it('changes nothing when they were never here', () => {
    const before = emptyRoom();
    const { state, effects } = reduce(before, disconnect('nobody'), ctx());
    expect(state).toBe(before);
    expect(effects).toEqual([]);
  });
});

describe('adding a Track', () => {
  // The first Track added to an idle Room starts playing, so anything about the
  // Queue itself is asserted against a Room that is already sounding.
  const playing = () => withTracks('zzzzzzzzzzz');

  it('puts it in the Queue behind whatever is already playing', () => {
    const { state } = reduce(playing(), add('aaaaaaaaaaa'), ctx());
    expect(state.queue.map((t) => t.song.sourceId)).toEqual(['aaaaaaaaaaa']);
    expect(state.nowPlaying?.song.sourceId).toBe('zzzzzzzzzzz');
  });

  it('attributes it to whoever pasted the link', () => {
    const { state } = reduce(playing(), add('aaaaaaaaaaa', 'Duc'), ctx(77));
    expect(state.queue[0]).toMatchObject({
      addedByControllerId: 'c1',
      addedByNickname: 'Duc',
      addedAt: 77
    });
  });

  it('puts each new Track after the ones already waiting', () => {
    const state = withTracks('zzzzzzzzzzz', 'aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc');
    const keys = state.queue.map((t) => t.orderKey);
    expect(state.queue.map((t) => t.song.sourceId)).toEqual([
      'aaaaaaaaaaa',
      'bbbbbbbbbbb',
      'ccccccccccc'
    ]);
    expect([...keys].sort()).toEqual(keys);
  });

  it('lets the same Song be queued more than once', () => {
    const state = withTracks('zzzzzzzzzzz', 'aaaaaaaaaaa', 'aaaaaaaaaaa');
    expect(state.queue).toHaveLength(2);
    expect(state.queue[0]?.song.id).toBe(state.queue[1]?.song.id);
    expect(state.queue[0]?.id).not.toBe(state.queue[1]?.id);
  });

  it('tells everyone', () => {
    const { effects } = reduce(playing(), add('aaaaaaaaaaa'), ctx());
    expect(effects).toEqual([{ type: 'broadcast-snapshot' }]);
  });

  it('gives the Queue a new array, so the Room knows to persist it', () => {
    const before = playing();
    const { state } = reduce(before, add('aaaaaaaaaaa'), ctx());
    expect(state.queue).not.toBe(before.queue);
  });
});

describe('the reducer itself', () => {
  it('leaves the state it was given untouched', () => {
    const before = withTracks('aaaaaaaaaaa');
    const snapshot = structuredClone(before);
    reduce(before, add('bbbbbbbbbbb'), ctx());
    expect(before).toEqual(snapshot);
  });

  it('gives the same answer twice for the same inputs', () => {
    const fixed: Ctx = { now: 7, newId: () => 'fixed' };
    const a = reduce(emptyRoom(), add('aaaaaaaaaaa'), fixed);
    const b = reduce(emptyRoom(), add('aaaaaaaaaaa'), fixed);
    expect(a).toEqual(b);
  });
});

describe('the Queue playing itself', () => {
  const ended = (state: RoomState): Command => ({
    type: 'track/ended',
    trackId: state.nowPlaying?.id ?? 'nothing-is-playing'
  });

  it('starts the first Track the moment it is added to an idle Room', () => {
    const { state } = reduce(emptyRoom(), add('aaaaaaaaaaa'), ctx());
    expect(state.nowPlaying?.song.sourceId).toBe('aaaaaaaaaaa');
    expect(state.queue).toEqual([]);
  });

  it('leaves later Tracks waiting rather than interrupting', () => {
    const state = withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb');
    expect(state.nowPlaying?.song.sourceId).toBe('aaaaaaaaaaa');
    expect(state.queue.map((t) => t.song.sourceId)).toEqual(['bbbbbbbbbbb']);
  });

  it('moves a finished Track into History and starts the next', () => {
    const before = withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb');
    const { state } = reduce(before, ended(before), ctx());

    expect(state.nowPlaying?.song.sourceId).toBe('bbbbbbbbbbb');
    expect(state.history.map((t) => t.song.sourceId)).toEqual(['aaaaaaaaaaa']);
    expect(state.queue).toEqual([]);
  });

  it('keeps History most recent first', () => {
    let state = withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc');
    state = reduce(state, ended(state), ctx()).state;
    state = reduce(state, ended(state), ctx()).state;
    expect(state.history.map((t) => t.song.sourceId)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa']);
  });

  it('goes idle when the last Track finishes', () => {
    const before = withTracks('aaaaaaaaaaa');
    const { state } = reduce(before, ended(before), ctx());

    expect(state.nowPlaying).toBeNull();
    expect(state.queue).toEqual([]);
    expect(state.history).toHaveLength(1);
  });

  it('starts playing again when something is added to an idle Room', () => {
    const drained = ((r) => reduce(r, ended(r), ctx()))(withTracks('aaaaaaaaaaa')).state;
    const { state } = reduce(drained, add('bbbbbbbbbbb'), ctx());

    expect(state.nowPlaying?.song.sourceId).toBe('bbbbbbbbbbb');
    expect(state.queue).toEqual([]);
  });

  it('does nothing when told a Track ended in an already idle Room', () => {
    const idle = emptyRoom();
    const { state, effects } = reduce(idle, ended(idle), ctx());
    expect(state).toBe(idle);
    expect(effects).toEqual([]);
  });

  it('tells everyone when a Track ends', () => {
    const { effects } = ((r) => reduce(r, ended(r), ctx()))(withTracks('aaaaaaaaaaa'));
    expect(effects).toEqual([{ type: 'broadcast-snapshot' }]);
  });

  it('never puts the same Track in two places at once', () => {
    const state = ((r) => reduce(r, ended(r), ctx()).state)(withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb'));
    const ids = [...state.queue, ...state.history, state.nowPlaying]
      .filter((t) => t !== null)
      .map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ignores a Track ending that is not the one sounding', () => {
    const before = withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb');
    const { state, effects } = reduce(before, { type: 'track/ended', trackId: 'some-older-track' }, ctx());

    expect(state).toBe(before);
    expect(effects).toEqual([]);
  });
});

describe('driving the Transport from a phone', () => {
  const playing = () => withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb');
  const pause = (nickname = 'Duc'): Command => ({ type: 'transport/paused', nickname });
  const resume = (nickname = 'Duc'): Command => ({ type: 'transport/resumed', nickname });
  const skip = (state: RoomState, nickname = 'Duc'): Command => ({
    type: 'transport/skipped',
    trackId: state.nowPlaying?.id ?? 'nothing',
    nickname
  });

  it('is playing as soon as a Track starts', () => {
    expect(playing().transport.isPlaying).toBe(true);
  });

  it('stops when someone pauses', () => {
    const { state } = reduce(playing(), pause(), ctx());
    expect(state.transport.isPlaying).toBe(false);
  });

  it('starts again when someone resumes', () => {
    const paused = reduce(playing(), pause(), ctx()).state;
    expect(reduce(paused, resume(), ctx()).state.transport.isPlaying).toBe(true);
  });

  it('says who paused', () => {
    const { state } = reduce(playing(), pause('Mai'), ctx(99));
    expect(state.lastAction).toEqual({ nickname: 'Mai', did: 'paused', at: 99 });
  });

  it('starts the clock again on resume, so a long pause is not counted as time played', () => {
    const before = playing();
    const atPause = reduce(before, pause(), ctx(10_000)).state;
    const resumed = reduce(atPause, resume(), ctx(310_000)).state;

    // Five minutes paused. Everyone's progress bar measures from this instant,
    // so without it they would all leap five minutes into the Track.
    expect(resumed.transport.positionReportedAt).toBe(310_000);
    expect(resumed.transport.positionSeconds).toBe(atPause.transport.positionSeconds);
  });

  it('does nothing when pausing what is already paused', () => {
    const paused = reduce(playing(), pause(), ctx()).state;
    const { state, effects } = reduce(paused, pause(), ctx());
    expect(state).toBe(paused);
    expect(effects).toEqual([]);
  });

  it('moves a skipped Track into History and starts the next', () => {
    const before = playing();
    const { state } = reduce(before, skip(before), ctx());

    expect(state.nowPlaying?.song.sourceId).toBe('bbbbbbbbbbb');
    expect(state.history.map((t) => t.song.sourceId)).toEqual(['aaaaaaaaaaa']);
  });

  it('says who skipped', () => {
    const before = playing();
    const { state } = reduce(before, skip(before, 'Mai'), ctx(42));
    expect(state.lastAction).toEqual({ nickname: 'Mai', did: 'skipped', at: 42 });
  });

  it('says who started it again', () => {
    const paused = reduce(playing(), pause(), ctx()).state;
    const { state } = reduce(paused, resume('Mai'), ctx(12));
    expect(state.lastAction).toEqual({ nickname: 'Mai', did: 'resumed', at: 12 });
  });

  it('leaves the Room idle and the Queue empty when the last Track is skipped', () => {
    const before = withTracks('aaaaaaaaaaa');
    const { state } = reduce(before, skip(before), ctx());

    expect(state.nowPlaying).toBeNull();
    expect(state.queue).toEqual([]);
    expect(state.transport.isPlaying).toBe(false);
    expect(state.history).toHaveLength(1);
  });

  it('ignores a skip aimed at a Track that already moved on', () => {
    const before = playing();
    const { state, effects } = reduce(
      before,
      { type: 'transport/skipped', trackId: 'a-track-that-already-ended', nickname: 'Duc' },
      ctx()
    );
    expect(state).toBe(before);
    expect(effects).toEqual([]);
  });

  it('ignores a skip when nothing is playing', () => {
    const idle = emptyRoom();
    const { state } = reduce(idle, { type: 'transport/skipped', trackId: 'x', nickname: 'Duc' }, ctx());
    expect(state).toBe(idle);
  });

  it('changes the volume and says who did', () => {
    const { state } = reduce(playing(), { type: 'transport/volume', volume: 0.4, nickname: 'Mai' }, ctx(7));
    expect(state.transport.volume).toBe(0.4);
    expect(state.lastAction).toEqual({ nickname: 'Mai', did: 'volume', volume: 0.4, at: 7 });
  });

  it.each([
    [1.7, 1],
    [-2, 0]
  ])('keeps a volume of %s within reach', (asked, expected) => {
    const { state } = reduce(playing(), { type: 'transport/volume', volume: asked, nickname: 'Duc' }, ctx());
    expect(state.transport.volume).toBe(expected);
  });

  it('resumes when a Track is added to a Room that had run dry', () => {
    const before = withTracks('aaaaaaaaaaa');
    const drained = reduce(before, skip(before), ctx()).state;
    expect(drained.transport.isPlaying).toBe(false);

    const { state } = reduce(drained, add('ccccccccccc'), ctx());
    expect(state.transport.isPlaying).toBe(true);
  });
});

describe('the Player reporting where the audio has reached', () => {
  const playing = () => withTracks('aaaaaaaaaaa');
  const heard = (state: RoomState, positionSeconds: number): Command => ({
    type: 'player/position',
    trackId: state.nowPlaying?.id ?? 'nothing',
    positionSeconds
  });

  it('records the position and when it was reported', () => {
    const before = playing();
    const { state } = reduce(before, heard(before, 12.5), ctx(5_000));
    expect(state.transport.positionSeconds).toBe(12.5);
    expect(state.transport.positionReportedAt).toBe(5_000);
  });

  it('ignores a report about a Track that has already moved on', () => {
    const before = playing();
    const { state, effects } = reduce(
      before,
      { type: 'player/position', trackId: 'an-older-track', positionSeconds: 3 },
      ctx()
    );
    expect(state).toBe(before);
    expect(effects).toEqual([]);
  });

  it('starts a new Track from the beginning', () => {
    const before = withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb');
    const advanced = reduce(before, heard(before, 30), ctx()).state;
    const { state } = reduce(advanced, { type: 'track/ended', trackId: advanced.nowPlaying!.id }, ctx(88));

    expect(state.transport.positionSeconds).toBe(0);
    expect(state.transport.positionReportedAt).toBe(88);
  });
});

describe('going back', () => {
  const previous = (state: RoomState, nickname = 'Duc'): Command => ({
    type: 'transport/previous',
    trackId: state.nowPlaying?.id ?? 'nothing',
    nickname
  });

  /** A Room playing 'bbbbbbbbbbb', having already played 'aaaaaaaaaaa'. */
  const partWayThrough = (secondsIn: number, startedAtMs = 0): RoomState => {
    const twoTracks = withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb');
    const ended = reduce(twoTracks, { type: 'track/ended', trackId: twoTracks.nowPlaying!.id }, ctx(startedAtMs)).state;
    return {
      ...ended,
      transport: { ...ended.transport, positionSeconds: secondsIn, positionReportedAt: startedAtMs }
    };
  };

  it('restarts the current Track when it is well under way', () => {
    const before = partWayThrough(30);
    const { state } = reduce(before, previous(before), ctx(60_000));

    expect(state.nowPlaying?.song.sourceId).toBe('bbbbbbbbbbb');
    expect(state.transport.positionSeconds).toBe(0);
    expect(state.history.map((t) => t.song.sourceId)).toEqual(['aaaaaaaaaaa']);
  });

  it('tells the Player to seek when it restarts a Track it is already playing', () => {
    const before = partWayThrough(30);
    const { state } = reduce(before, previous(before), ctx(60_000));
    expect(state.transport.startedAt).toBe(60_000);
    expect(state.transport.startedAt).not.toBe(before.transport.startedAt);
  });

  it('goes back to the last Track when pressed straight away', () => {
    const before = partWayThrough(1);
    const { state } = reduce(before, previous(before), ctx(1_000));

    expect(state.nowPlaying?.song.sourceId).toBe('aaaaaaaaaaa');
    expect(state.history).toEqual([]);
    expect(state.transport.positionSeconds).toBe(0);
  });

  it('puts the Track it left at the front of the Queue, not the back', () => {
    const before = reduce(partWayThrough(1), add('ccccccccccc'), ctx()).state;
    const { state } = reduce(before, previous(before), ctx(1_000));

    expect(state.queue.map((t) => t.song.sourceId)).toEqual(['bbbbbbbbbbb', 'ccccccccccc']);
    const keys = state.queue.map((t) => t.orderKey);
    expect([...keys].sort()).toEqual(keys);
  });

  it('counts time that has passed since the Player last reported', () => {
    // Reported at 2s, ten seconds ago: the Track is really twelve seconds in.
    const before = partWayThrough(2, 1_000);
    const { state } = reduce(before, previous(before), ctx(11_000));
    expect(state.nowPlaying?.song.sourceId).toBe('bbbbbbbbbbb');
  });

  it('starts everyone\'s progress bar again from this instant', () => {
    // The same reason resume restamps: every Controller measures forward from
    // the last report, so a Track sent back to the top must move that mark too.
    const before = partWayThrough(30, 1_000);
    const { state } = reduce(before, previous(before), ctx(500_000));

    expect(state.transport.positionReportedAt).toBe(500_000);
    expect(state.transport.positionSeconds).toBe(0);
  });

  it('plays, even if the Room was paused when it was pressed', () => {
    const started = partWayThrough(1, 1_000);
    const paused = reduce(started, { type: 'transport/paused', nickname: 'Duc' }, ctx(2_000)).state;
    const { state } = reduce(paused, previous(paused), ctx(3_000));

    expect(state.transport.isPlaying).toBe(true);
  });

  it('does not count time while the Room is paused', () => {
    const started = partWayThrough(1, 1_000);
    const paused = reduce(started, { type: 'transport/paused', nickname: 'Duc' }, ctx(2_000)).state;
    const { state } = reduce(paused, previous(paused), ctx(600_000));

    expect(state.nowPlaying?.song.sourceId).toBe('aaaaaaaaaaa');
  });

  it('restarts rather than failing when there is nothing to go back to', () => {
    const before = withTracks('aaaaaaaaaaa');
    const { state } = reduce(before, previous(before), ctx(1));

    expect(state.nowPlaying?.song.sourceId).toBe('aaaaaaaaaaa');
    expect(state.queue).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.transport.positionSeconds).toBe(0);
  });

  it('says who went back, and who merely restarted', () => {
    const early = partWayThrough(1);
    expect(reduce(early, previous(early, 'Mai'), ctx(500)).state.lastAction).toEqual({
      nickname: 'Mai',
      did: 'previous',
      at: 500
    });

    const late = partWayThrough(30);
    expect(reduce(late, previous(late, 'Mai'), ctx(60_000)).state.lastAction).toEqual({
      nickname: 'Mai',
      did: 'restarted',
      at: 60_000
    });
  });

  it('ignores a press aimed at a Track that already moved on', () => {
    const before = partWayThrough(30);
    const { state, effects } = reduce(
      before,
      { type: 'transport/previous', trackId: 'an-older-track', nickname: 'Duc' },
      ctx()
    );
    expect(state).toBe(before);
    expect(effects).toEqual([]);
  });

  it('does nothing when the Room is idle', () => {
    const idle = emptyRoom();
    const { state } = reduce(idle, { type: 'transport/previous', trackId: 'x', nickname: 'Duc' }, ctx());
    expect(state).toBe(idle);
  });
});

describe('shaping the Queue', () => {
  /** A Room playing 'zzzzzzzzzzz', with a, b and c waiting in that order. */
  const queued = () => withTracks('zzzzzzzzzzz', 'aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc');
  const idOf = (state: RoomState, sourceId: string) =>
    state.queue.find((t) => t.song.sourceId === sourceId)!.id;
  const waiting = (state: RoomState) => state.queue.map((t) => t.song.sourceId);
  const inKeyOrder = (state: RoomState) => {
    const keys = state.queue.map((t) => t.orderKey);
    return [...keys].every((k, i) => i === 0 || keys[i - 1]! < k);
  };

  const move = (state: RoomState, sourceId: string, afterSourceId: string | null): Command => ({
    type: 'track/moved',
    trackId: idOf(state, sourceId),
    afterTrackId: afterSourceId === null ? null : idOf(state, afterSourceId),
    nickname: 'Duc'
  });

  it('moves a Track to the end', () => {
    const before = queued();
    const { state } = reduce(before, move(before, 'aaaaaaaaaaa', 'ccccccccccc'), ctx());
    expect(waiting(state)).toEqual(['bbbbbbbbbbb', 'ccccccccccc', 'aaaaaaaaaaa']);
    expect(inKeyOrder(state)).toBe(true);
  });

  it('moves a Track to the front', () => {
    const before = queued();
    const { state } = reduce(before, move(before, 'ccccccccccc', null), ctx());
    expect(waiting(state)).toEqual(['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(inKeyOrder(state)).toBe(true);
  });

  it('moves a Track into the middle', () => {
    const before = queued();
    const { state } = reduce(before, move(before, 'ccccccccccc', 'aaaaaaaaaaa'), ctx());
    expect(waiting(state)).toEqual(['aaaaaaaaaaa', 'ccccccccccc', 'bbbbbbbbbbb']);
    expect(inKeyOrder(state)).toBe(true);
  });

  it('rewrites only the Track that moved', () => {
    const before = queued();
    const { state } = reduce(before, move(before, 'ccccccccccc', null), ctx());

    const changed = state.queue.filter((track) => {
      const was = before.queue.find((t) => t.id === track.id);
      return was?.orderKey !== track.orderKey;
    });
    expect(changed.map((t) => t.song.sourceId)).toEqual(['ccccccccccc']);
  });

  it('leaves a Track where it already was', () => {
    const before = queued();
    const { state } = reduce(before, move(before, 'bbbbbbbbbbb', 'aaaaaaaaaaa'), ctx());
    expect(waiting(state)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
  });

  it('cannot move Now Playing, which is not in the Queue', () => {
    const before = queued();
    const { state, effects } = reduce(
      before,
      { type: 'track/moved', trackId: before.nowPlaying!.id, afterTrackId: null, nickname: 'Duc' },
      ctx()
    );
    expect(state).toBe(before);
    expect(effects).toEqual([]);
  });

  it('ignores a move anchored to a Track that has gone', () => {
    const before = queued();
    const { state } = reduce(
      before,
      { type: 'track/moved', trackId: idOf(before, 'aaaaaaaaaaa'), afterTrackId: 'long-gone', nickname: 'Duc' },
      ctx()
    );
    expect(state).toBe(before);
  });

  it('survives two people dragging at once', () => {
    const before = queued();
    // Both moves are decided against the same Queue, as two phones would.
    const first = move(before, 'ccccccccccc', null);
    const second = move(before, 'aaaaaaaaaaa', 'bbbbbbbbbbb');

    const after = reduce(reduce(before, first, ctx()).state, second, ctx()).state;

    // Both moves land: c to the front, then a after b. Nothing is lost, nothing
    // is duplicated, and the order is the one the two moves describe together.
    expect(waiting(after)).toEqual(['ccccccccccc', 'bbbbbbbbbbb', 'aaaaaaaaaaa']);
    expect(new Set(after.queue.map((t) => t.id)).size).toBe(3);
    expect(inKeyOrder(after)).toBe(true);
  });

  it('plays a Track next without interrupting what is sounding', () => {
    const before = queued();
    const { state } = reduce(
      before,
      { type: 'track/play-next', trackId: idOf(before, 'ccccccccccc'), nickname: 'Mai' },
      ctx(9)
    );

    expect(state.nowPlaying?.song.sourceId).toBe('zzzzzzzzzzz');
    expect(waiting(state)).toEqual(['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(state.lastAction).toEqual({ nickname: 'Mai', did: 'play-next', at: 9 });
  });

  it('removes a Track from the Queue', () => {
    const before = queued();
    const { state } = reduce(
      before,
      { type: 'track/removed', trackId: idOf(before, 'bbbbbbbbbbb'), nickname: 'Mai' },
      ctx(3)
    );

    expect(waiting(state)).toEqual(['aaaaaaaaaaa', 'ccccccccccc']);
    expect(state.lastAction).toEqual({ nickname: 'Mai', did: 'removed', at: 3 });
  });

  it('cannot remove Now Playing, which is not in the Queue', () => {
    const before = queued();
    const { state, effects } = reduce(
      before,
      { type: 'track/removed', trackId: before.nowPlaying!.id, nickname: 'Duc' },
      ctx()
    );
    expect(state).toBe(before);
    expect(effects).toEqual([]);
  });

  it('ignores removing a Track that has already gone', () => {
    const before = queued();
    const { state } = reduce(before, { type: 'track/removed', trackId: 'long-gone', nickname: 'Duc' }, ctx());
    expect(state).toBe(before);
  });

  it('tells everyone about a move', () => {
    const before = queued();
    const { effects } = reduce(before, move(before, 'ccccccccccc', null), ctx());
    expect(effects).toEqual([{ type: 'broadcast-snapshot' }]);
  });
});

describe('a Track that will not play', () => {
  const playing = () => withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb');
  const failed = (state: RoomState, reason = 'Could not open that Song.'): Command => ({
    type: 'track/failed',
    trackId: state.nowPlaying?.id ?? 'nothing',
    reason
  });

  it('tries once more before giving up on it', () => {
    const before = playing();
    const { state } = reduce(before, failed(before), ctx(500));

    expect(state.nowPlaying?.song.sourceId).toBe('aaaaaaaaaaa');
    expect(state.transport.failedAttempts).toBe(1);
    // A fresh playthrough, so the Player has something to act on rather than
    // sitting on a source it has already given up on.
    expect(state.transport.startedAt).toBe(500);
    expect(state.transport.positionSeconds).toBe(0);
  });

  it('gives up on the second failure and moves on', () => {
    const before = playing();
    const once = reduce(before, failed(before), ctx()).state;
    const { state } = reduce(once, failed(once, 'Still nothing.'), ctx());

    expect(state.nowPlaying?.song.sourceId).toBe('bbbbbbbbbbb');
    expect(state.transport.failedAttempts).toBe(0);
  });

  it('keeps the Track it gave up on, with the reason', () => {
    const before = playing();
    const once = reduce(before, failed(before), ctx()).state;
    const { state } = reduce(once, failed(once, 'That video is private.'), ctx());

    const abandoned = state.history[0];
    expect(abandoned?.song.sourceId).toBe('aaaaaaaaaaa');
    expect(abandoned?.unplayableReason).toBe('That video is private.');
  });

  it('leaves a Track that played properly unmarked', () => {
    const before = playing();
    const { state } = reduce(before, { type: 'track/ended', trackId: before.nowPlaying!.id }, ctx());
    expect(state.history[0]?.unplayableReason).toBeUndefined();
  });

  it('forgets earlier failures once a Track is playing', () => {
    const before = playing();
    const once = reduce(before, failed(before), ctx()).state;
    const { state } = reduce(once, { type: 'track/ended', trackId: once.nowPlaying!.id }, ctx());
    expect(state.transport.failedAttempts).toBe(0);
  });

  it('goes idle when the Track it gave up on was the last one', () => {
    const one = withTracks('aaaaaaaaaaa');
    const once = reduce(one, failed(one), ctx()).state;
    const { state } = reduce(once, failed(once), ctx());

    expect(state.nowPlaying).toBeNull();
    expect(state.transport.isPlaying).toBe(false);
    expect(state.history[0]?.unplayableReason).toBeDefined();
  });

  it('ignores a failure about a Track that already moved on', () => {
    const before = playing();
    const { state, effects } = reduce(
      before,
      { type: 'track/failed', trackId: 'an-older-track', reason: 'nope' },
      ctx()
    );
    expect(state).toBe(before);
    expect(effects).toEqual([]);
  });
});

describe('whether anything is attached to the speaker', () => {
  const connected = (connectionId = 'p1'): Command => ({ type: 'player/connected', connectionId });
  const gone = (connectionId = 'p1'): Command => ({ type: 'player/disconnected', connectionId });

  it('starts with nothing attached', () => {
    expect(emptyRoom().playerConnections).toEqual([]);
  });

  it('knows when the speaker arrives and leaves', () => {
    const here = reduce(emptyRoom(), connected(), ctx()).state;
    expect(here.playerConnections).toEqual(['p1']);
    expect(reduce(here, gone(), ctx()).state.playerConnections).toEqual([]);
  });

  it('keeps wanting to play while the speaker is away, so it picks up on return', () => {
    const room = reduce(withTracks('aaaaaaaaaaa'), connected(), ctx()).state;
    const without = reduce(room, gone(), ctx()).state;

    // The Transport is what the Room wants, not what is audible. Forgetting the
    // wish is what left a reconnecting Player sitting silent.
    expect(without.transport.isPlaying).toBe(true);
    expect(without.playerConnections).toEqual([]);
  });

  it('leaves the Queue alone when the speaker goes away', () => {
    const room = reduce(withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb'), connected(), ctx()).state;
    const { state } = reduce(room, gone(), ctx());
    expect(state.queue.map((t) => t.song.sourceId)).toEqual(['bbbbbbbbbbb']);
    expect(state.nowPlaying?.song.sourceId).toBe('aaaaaaaaaaa');
  });

  it('ignores a departure from a connection that is no longer the speaker', () => {
    const first = reduce(emptyRoom(), connected('p1'), ctx()).state;
    const second = reduce(first, connected('p2'), ctx()).state;
    const { state } = reduce(second, gone('p1'), ctx());

    // The old connection dying after the new one arrived must not silence a
    // speaker that is plainly attached.
    expect(state.playerConnections).toEqual(['p2']);
  });

  it('is still attached when a second speaker comes and goes', () => {
    const first = reduce(emptyRoom(), connected('p1'), ctx()).state;
    const both = reduce(first, connected('p2'), ctx()).state;
    const { state } = reduce(both, gone('p2'), ctx());

    expect(state.playerConnections).toEqual(['p1']);
  });
});

describe('a Controller whose connection is replaced', () => {
  const connect = (connectionId: string, controllerId = 'c1'): Command => ({
    type: 'controller/connected',
    controllerId,
    connectionId,
    nickname: 'Duc'
  });
  const drop = (connectionId: string, controllerId = 'c1'): Command => ({
    type: 'controller/disconnected',
    controllerId,
    connectionId
  });

  it('is still here when the connection it replaced finally dies', () => {
    // A reload opens the new connection before the old one is reaped.
    const first = reduce(emptyRoom(), connect('conn-1'), ctx()).state;
    const reloaded = reduce(first, connect('conn-2'), ctx()).state;
    const { state } = reduce(reloaded, drop('conn-1'), ctx());

    expect(state.controllers.map((c) => c.id)).toEqual(['c1']);
  });

  it('leaves when the connection that is actually theirs dies', () => {
    const here = reduce(emptyRoom(), connect('conn-1'), ctx()).state;
    const { state } = reduce(here, drop('conn-1'), ctx());
    expect(state.controllers).toEqual([]);
  });
});

describe('a Track that gets another go', () => {
  it('is not still struck through when it comes back round', () => {
    const before = withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb');
    const failedOnce = reduce(before, { type: 'track/failed', trackId: before.nowPlaying!.id, reason: 'x' }, ctx()).state;
    const givenUp = reduce(failedOnce, { type: 'track/failed', trackId: failedOnce.nowPlaying!.id, reason: 'x' }, ctx()).state;

    expect(givenUp.history[0]?.unplayableReason).toBe('x');

    // Previous brings it back: it is a Track again, not a failure.
    const back = reduce(givenUp, { type: 'transport/previous', trackId: givenUp.nowPlaying!.id, nickname: 'Duc' }, ctx()).state;
    expect(back.nowPlaying?.song.sourceId).toBe('aaaaaaaaaaa');
    expect(back.nowPlaying?.unplayableReason).toBeUndefined();
  });
});
