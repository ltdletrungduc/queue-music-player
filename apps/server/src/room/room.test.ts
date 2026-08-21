import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoomRuntime } from './room.js';
import { openRoomStore, saveRoom } from '../persistence/room-store.js';
import { emptyRoom } from './reduce.js';
import type { Track } from './types.js';

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'qmp-'));
  dirs.push(dir);
  return join(dir, 'room.sqlite');
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const clock = { now: () => 1_000, newId: () => 'generated-id' };

const track = (id: string, orderKey: string): Track => ({
  id,
  source: 'youtube',
  sourceId: `yt-${id}`,
  orderKey,
  addedByControllerId: 'c1',
  addedAt: 1_700_000_000_000
});

describe('starting the server', () => {
  it('comes up with an empty Room the first time', () => {
    const runtime = createRoomRuntime(openRoomStore(tempFile()), clock);
    expect(runtime.snapshot()).toEqual(emptyRoom());
  });

  it('comes back up with the Queue the last run left behind', () => {
    const file = tempFile();
    const queue = [track('t1', 'a0'), track('t2', 'a1')];

    const first = openRoomStore(file);
    saveRoom(first, { ...emptyRoom(), queue });
    first.close();

    const restarted = createRoomRuntime(openRoomStore(file), clock);
    expect(restarted.snapshot().queue).toEqual(queue);
  });

  it('comes back up with nobody connected, however many were here before', () => {
    const file = tempFile();
    const before = createRoomRuntime(openRoomStore(file), clock);
    before.dispatch({ type: 'controller/connected', controllerId: 'c1' });
    expect(before.snapshot().controllers).toHaveLength(1);

    const restarted = createRoomRuntime(openRoomStore(file), clock);
    expect(restarted.snapshot().controllers).toEqual([]);
  });
});

describe('dispatching a Command', () => {
  it('moves the Room on and hands back what the transport must do', () => {
    const runtime = createRoomRuntime(openRoomStore(tempFile()), clock);
    const effects = runtime.dispatch({ type: 'controller/connected', controllerId: 'c1' });

    expect(runtime.snapshot().controllers).toEqual([{ id: 'c1', connectedAt: 1_000 }]);
    expect(effects).toEqual([{ type: 'broadcast-snapshot' }]);
  });
});
