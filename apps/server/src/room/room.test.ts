import { describe, expect, it } from 'vitest';
import { createRoomRuntime } from './room.js';
import { createMemoryRoomStore } from '../persistence/memory-room-store.js';
import { emptyRoom } from './reduce.js';
import type { RoomState, Song, Track } from './types.js';

const clock = { now: () => 1_000, newId: () => 'generated-id' };

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

/** A store already holding a Room, as it would be on the night after. */
const storeHolding = (state: RoomState) => createMemoryRoomStore(state);

describe('starting the server', () => {
  it('comes up with an empty Room the first time', async () => {
    const runtime = await createRoomRuntime(createMemoryRoomStore(), clock);
    expect(runtime.snapshot()).toEqual(emptyRoom());
  });

  it('comes back up with the Queue the last run left behind', async () => {
    const queue = [track('t1', 'a0'), track('t2', 'a1')];
    const restarted = await createRoomRuntime(storeHolding({ ...emptyRoom(), queue }), clock);
    expect(restarted.snapshot().queue).toEqual(queue);
  });

  it('starts the clock when it comes back, not at the epoch', async () => {
    const store = storeHolding({ ...emptyRoom(), nowPlaying: track('t1', 'a0') });

    const restarted = await createRoomRuntime(store, clock);
    expect(restarted.snapshot().transport.positionReportedAt).toBe(1_000);
    expect(restarted.snapshot().transport.startedAt).toBe(1_000);
  });

  it('comes back up with nobody connected, however many were here before', async () => {
    const store = createMemoryRoomStore();
    const before = await createRoomRuntime(store, clock);
    before.dispatch({ type: 'controller/connected', controllerId: 'c1', connectionId: 'conn-1', nickname: 'Duc' });
    expect(before.snapshot().controllers).toHaveLength(1);
    await before.close();

    const restarted = await createRoomRuntime(store, clock);
    expect(restarted.snapshot().controllers).toEqual([]);
  });

  it('will not come up when the Room cannot be read', async () => {
    const unreachable = {
      ...createMemoryRoomStore(),
      load: () => Promise.reject(new Error('The store cannot be reached.'))
    };
    // Serving an empty Room and then writing that emptiness over the real one is
    // worse than not starting, so this is left to the caller to fail on.
    await expect(createRoomRuntime(unreachable, clock)).rejects.toThrow(/cannot be reached/);
  });
});

describe('dispatching a Command', () => {
  it('moves the Room on and hands back what the transport must do', async () => {
    const runtime = await createRoomRuntime(createMemoryRoomStore(), clock);
    const effects = runtime.dispatch({ type: 'controller/connected', controllerId: 'c1', connectionId: 'conn-1', nickname: 'Duc' });

    expect(runtime.snapshot().controllers).toEqual([
      { id: 'c1', nickname: 'Duc', connectionId: 'conn-1', connectedAt: 1_000 }
    ]);
    expect(effects).toEqual([{ type: 'broadcast-snapshot' }]);
  });

  it('answers before the store has been told', async () => {
    const store = createMemoryRoomStore();
    const runtime = await createRoomRuntime(store, clock);

    runtime.dispatch({ type: 'playlist/renamed', playlistId: 'nope', name: 'x', nickname: 'Duc' });
    runtime.dispatch({
      type: 'playlist/track-saved',
      playlistId: null,
      song: song('t1'),
      nickname: 'Duc'
    });

    // The Room has moved on; the store has not heard about it yet. That is the
    // trade this makes — see ADR-0004.
    expect(runtime.snapshot().playlists).toHaveLength(1);
    expect(store.document()?.playlists ?? []).toEqual([]);

    await runtime.close();
    expect(store.document()?.playlists).toHaveLength(1);
  });

  it('writes the Room down when a Playlist changes and nothing else does', async () => {
    const store = createMemoryRoomStore();
    const runtime = await createRoomRuntime(store, clock);

    runtime.dispatch({
      type: 'playlist/track-saved',
      playlistId: null,
      newPlaylistName: 'Later',
      song: song('t1'),
      nickname: 'Duc'
    });
    await runtime.close();

    expect(store.document()?.playlists[0]?.name).toBe('Later');
  });

  it('does not write the Room down when only a Controller came or went', async () => {
    const store = createMemoryRoomStore();
    const runtime = await createRoomRuntime(store, clock);

    runtime.dispatch({ type: 'controller/connected', controllerId: 'c1', connectionId: 'conn-1', nickname: 'Duc' });
    await runtime.close();

    expect(store.document()).toBeUndefined();
  });
});
