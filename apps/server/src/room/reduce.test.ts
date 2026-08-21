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
    const before = withTracks('aaaaaaaaaaa');
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
  it('puts it in the Queue', () => {
    const { state } = reduce(emptyRoom(), add('aaaaaaaaaaa'), ctx());
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.song.sourceId).toBe('aaaaaaaaaaa');
  });

  it('attributes it to whoever pasted the link', () => {
    const { state } = reduce(emptyRoom(), add('aaaaaaaaaaa', 'Duc'), ctx(77));
    expect(state.queue[0]).toMatchObject({
      addedByControllerId: 'c1',
      addedByNickname: 'Duc',
      addedAt: 77
    });
  });

  it('puts each new Track after the ones already waiting', () => {
    const state = withTracks('aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc');
    const keys = state.queue.map((t) => t.orderKey);
    expect(state.queue.map((t) => t.song.sourceId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
    expect([...keys].sort()).toEqual(keys);
  });

  it('lets the same Song be queued more than once', () => {
    const state = withTracks('aaaaaaaaaaa', 'aaaaaaaaaaa');
    expect(state.queue).toHaveLength(2);
    expect(state.queue[0]?.song.id).toBe(state.queue[1]?.song.id);
    expect(state.queue[0]?.id).not.toBe(state.queue[1]?.id);
  });

  it('tells everyone', () => {
    const { effects } = reduce(emptyRoom(), add('aaaaaaaaaaa'), ctx());
    expect(effects).toEqual([{ type: 'broadcast-snapshot' }]);
  });

  it('gives the Queue a new array, so the Room knows to persist it', () => {
    const before = emptyRoom();
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
