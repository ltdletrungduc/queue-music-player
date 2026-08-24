import { describe, expect, it, vi } from 'vitest';
import type { RoomState, Song, Track } from '@qmp/shared';
import { deferWrites } from './deferred-writes.js';
import { createMemoryRoomStore } from './memory-room-store.js';
import { UnwritableRoom, type RoomStore } from './room-store.js';
import { emptyRoom } from '../room/reduce.js';

const song = (id: string): Song => ({
  id: `youtube:${id}`,
  source: 'youtube',
  sourceId: id,
  title: `Title ${id}`,
  author: 'Someone',
  durationSeconds: 213,
  artworkUrl: `https://i.ytimg.test/${id}.jpg`
});

const track = (id: string, orderKey: string): Track => ({
  id,
  song: song(id),
  orderKey,
  addedByNickname: 'Duc',
  addedAt: 1_700_000_000_000
});

const withQueue = (...ids: string[]): RoomState => ({
  ...emptyRoom(),
  queue: ids.map((id, i) => track(id, `a${i}`))
});

/** A Playlist holding the same Song twice, as a hand-edited Room might. */
const roomThatCannotBeWritten = (): RoomState => ({
  ...emptyRoom(),
  playlists: [
    {
      id: 'p1',
      name: 'Edited by hand, badly',
      createdByNickname: 'Duc',
      createdAt: 1_700_000_000_000,
      tracks: [track('t1', 'a0'), { ...track('t2', 'a1'), song: song('t1') }]
    }
  ]
});

/** A store that answers only when told to, so a write can be caught in the air. */
function heldStore() {
  const held: (() => void)[] = [];
  const saved: RoomState[] = [];
  const store: RoomStore = {
    async load() {
      return emptyRoom();
    },
    save(state) {
      saved.push(state);
      return new Promise<void>((resolve) => held.push(resolve));
    },
    async savePosition() {},
    async close() {}
  };
  /** Answers every write in the air, and waits for what follows them to start. */
  const release = async () => {
    held.splice(0).forEach((done) => done());
    await new Promise((settled) => setTimeout(settled, 0));
  };
  return { store, saved, release };
}

describe('writing the Room down without waiting for it', () => {
  it('hands a Room to the store without the caller waiting', async () => {
    const store = createMemoryRoomStore();
    const writes = deferWrites(store);

    writes.room(withQueue('t1'));
    // Nothing has been written yet — that is the whole point.
    expect(store.document()).toBeUndefined();

    await writes.drain();
    expect(store.document()?.queue.map((t) => t.id)).toEqual(['t1']);
  });

  it('writes the newest Room once rather than every Room in turn', async () => {
    const { store, saved, release } = heldStore();
    const writes = deferWrites(store);

    writes.room(withQueue('first'));
    writes.room(withQueue('second'));
    writes.room(withQueue('third'));

    // One write in the air, and only the last of the rest waiting behind it.
    expect(saved).toHaveLength(1);
    await release();
    expect(saved).toHaveLength(2);
    await release();
    await writes.drain();

    expect(saved.map((s) => s.queue[0]?.id)).toEqual(['first', 'third']);
  });

  it('drops a position that arrives too soon after the last one', async () => {
    const store = createMemoryRoomStore(withQueue('t1'));
    const writes = deferWrites(store, { positionEveryMs: 60_000 });

    writes.position('t1', 10);
    await writes.drain();
    writes.position('t1', 11);
    await writes.drain();

    expect(store.document()?.position).toEqual({ trackId: 't1', seconds: 10 });
  });

  it('lets the Room supersede a position waiting behind it', async () => {
    const { store, saved, release } = heldStore();
    const positions: number[] = [];
    const writes = deferWrites(
      { ...store, savePosition: async (_id, s) => void positions.push(s) },
      { positionEveryMs: 0 }
    );

    writes.room(withQueue('first'));
    writes.position('t1', 30);
    writes.room(withQueue('second'));
    await release();
    await release();
    await writes.drain();

    // The second Room carries the position with it; writing the older one after
    // it would cost a round trip and say nothing new.
    expect(saved.map((s) => s.queue[0]?.id)).toEqual(['first', 'second']);
    expect(positions).toEqual([]);
  });
});

describe('when the store cannot be reached', () => {
  it('keeps the Room and tries again', async () => {
    vi.useFakeTimers();
    try {
      const store = createMemoryRoomStore();
      const failures: unknown[] = [];
      const writes = deferWrites(store, { retryMs: 1_000, onError: (e) => failures.push(e) });

      store.breakWrites(true);
      writes.room(withQueue('t1'));
      await vi.advanceTimersByTimeAsync(0);
      expect(failures).toHaveLength(1);
      expect(store.document()).toBeUndefined();

      store.breakWrites(false);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(store.document()?.queue.map((t) => t.id)).toEqual(['t1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries what is newest, not what failed', async () => {
    vi.useFakeTimers();
    try {
      const store = createMemoryRoomStore();
      const writes = deferWrites(store, { retryMs: 1_000, onError: () => {} });

      store.breakWrites(true);
      writes.room(withQueue('stale'));
      await vi.advanceTimersByTimeAsync(0);

      // The night carried on while the connection was away.
      writes.room(withQueue('stale', 'added while offline'));
      store.breakWrites(false);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(store.document()?.queue).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('when the Room cannot be written down', () => {
  it('drops it rather than retrying a write that cannot succeed', async () => {
    vi.useFakeTimers();
    try {
      const store = createMemoryRoomStore();
      const failures: unknown[] = [];
      const writes = deferWrites(store, { retryMs: 1_000, onError: (e) => failures.push(e) });

      writes.room(roomThatCannotBeWritten());
      await vi.advanceTimersByTimeAsync(0);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toBeInstanceOf(UnwritableRoom);

      // Nothing is waiting to be tried again: a second attempt sends the same
      // Room, so it would fail the same way for the rest of the night.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(failures).toHaveLength(1);

      // And the night carries on — the next Room that can be written is.
      writes.room(withQueue('t1'));
      await writes.drain();
      expect(store.document()?.queue.map((t) => t.id)).toEqual(['t1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles a drain instead of waiting on a write that never lands', async () => {
    const writes = deferWrites(createMemoryRoomStore(), { onError: () => {} });

    writes.room(roomThatCannotBeWritten());

    await expect(writes.drain()).resolves.toBeUndefined();
  });
});
