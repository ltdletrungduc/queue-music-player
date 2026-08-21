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
    nickname
  });

  it('appears in the Room under their Nickname', () => {
    const { state } = reduce(emptyRoom(), connect('c1'), ctx());
    expect(state.controllers).toEqual([{ id: 'c1', nickname: 'Duc', connectedAt: 1_000 }]);
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
    expect(second.state.controllers).toEqual([{ id: 'c1', nickname: 'Duc again', connectedAt: 2 }]);
  });

  it('leaves the Queue alone', () => {
    const before = withTracks('zzzzzzzzzzz', 'aaaaaaaaaaa');
    const { state } = reduce(before, connect('c2'), ctx());
    expect(state.queue).toBe(before.queue);
  });
});

describe('a Controller disconnecting', () => {
  const disconnect = (controllerId: string): Command => ({ type: 'controller/disconnected', controllerId });

  it('leaves the Room', () => {
    const two = reduce(
      reduce(emptyRoom(), { type: 'controller/connected', controllerId: 'c1', nickname: 'Duc' }, ctx()).state,
      { type: 'controller/connected', controllerId: 'c2', nickname: 'Mai' },
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
