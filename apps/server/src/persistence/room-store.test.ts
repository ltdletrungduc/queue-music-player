import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Song, Track } from '@qmp/shared';
import { loadRoom, openRoomStore, saveRoom } from './room-store.js';
import { emptyRoom } from '../room/reduce.js';

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'qmp-'));
  dirs.push(dir);
  return join(dir, 'room.sqlite');
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

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
  addedByControllerId: 'c1',
  addedByNickname: 'Duc',
  addedAt: 1_700_000_000_000
});

const countRows = (file: string, table: string): number => {
  const db = openRoomStore(file);
  const row = db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get();
  db.close();
  return row?.n ?? 0;
};

describe('a Room store', () => {
  it('gives an empty Room when nothing has ever been saved', () => {
    expect(loadRoom(openRoomStore(tempFile()))).toEqual(emptyRoom());
  });

  it('gives back the Queue it was given, Songs and all', () => {
    const store = openRoomStore(tempFile());
    const before = { ...emptyRoom(), queue: [track('t1', 'a0'), track('t2', 'a1')] };
    saveRoom(store, before);
    expect(loadRoom(store)).toEqual(before);
  });

  it('keeps the Queue in order, whatever order it was written in', () => {
    const store = openRoomStore(tempFile());
    saveRoom(store, { ...emptyRoom(), queue: [track('t2', 'a2'), track('t1', 'a1')] });
    expect(loadRoom(store).queue.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('stores one Song however many times it was queued', () => {
    const file = tempFile();
    const store = openRoomStore(file);
    saveRoom(store, {
      ...emptyRoom(),
      queue: [track('t1', 'a0', 'same'), track('t2', 'a1', 'same'), track('t3', 'a2', 'other')]
    });
    store.close();

    expect(countRows(file, 'queue_tracks')).toBe(3);
    expect(countRows(file, 'songs')).toBe(2);
  });

  it('does not bring Controllers back, because they reconnect for themselves', () => {
    const store = openRoomStore(tempFile());
    saveRoom(store, {
      queue: [track('t1', 'a0')],
      controllers: [{ id: 'c1', nickname: 'Duc', connectedAt: 1 }]
    });
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
    const saved = { ...emptyRoom(), queue: [track('t1', 'a0')] };
    saveRoom(first, saved);
    first.close();

    expect(loadRoom(openRoomStore(file))).toEqual(saved);
  });
});
