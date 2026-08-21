import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRoom, openRoomStore, saveRoom } from './room-store.js';
import { emptyRoom } from '../room/reduce.js';
import type { RoomState, Track } from '../room/types.js';

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'qmp-'));
  dirs.push(dir);
  return join(dir, 'room.sqlite');
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const track = (id: string, orderKey: string): Track => ({
  id,
  source: 'youtube',
  sourceId: `yt-${id}`,
  orderKey,
  addedByControllerId: 'c1',
  addedAt: 1_700_000_000_000
});

describe('a Room store', () => {
  it('gives an empty Room when nothing has ever been saved', () => {
    const store = openRoomStore(tempFile());
    expect(loadRoom(store)).toEqual(emptyRoom());
  });

  it('gives back the Queue it was given', () => {
    const store = openRoomStore(tempFile());
    const before: RoomState = { ...emptyRoom(), queue: [track('t1', 'a0'), track('t2', 'a1')] };
    saveRoom(store, before);
    expect(loadRoom(store)).toEqual(before);
  });

  it('keeps Up Next in order, whatever order it was written in', () => {
    const store = openRoomStore(tempFile());
    saveRoom(store, { ...emptyRoom(), queue: [track('t2', 'a2'), track('t1', 'a1')] });
    expect(loadRoom(store).queue.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('does not bring Controllers back, because they reconnect for themselves', () => {
    const store = openRoomStore(tempFile());
    saveRoom(store, { queue: [track('t1', 'a0')], controllers: [{ id: 'c1', connectedAt: 1 }] });
    expect(loadRoom(store).controllers).toEqual([]);
  });

  it('replaces the previous Queue rather than accumulating', () => {
    const store = openRoomStore(tempFile());
    saveRoom(store, { ...emptyRoom(), queue: [track('t1', 'a0'), track('t2', 'a1')] });
    saveRoom(store, { ...emptyRoom(), queue: [track('t3', 'a0')] });
    expect(loadRoom(store).queue.map((t) => t.id)).toEqual(['t3']);
  });

  it('survives the process going away', () => {
    const file = tempFile();
    const first = openRoomStore(file);
    const saved: RoomState = { ...emptyRoom(), queue: [track('t1', 'a0')] };
    saveRoom(first, saved);
    first.close();

    const second = openRoomStore(file);
    expect(loadRoom(second)).toEqual(saved);
  });
});
