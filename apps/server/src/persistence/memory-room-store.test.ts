import { describe, expect, it } from 'vitest';
import { createMemoryRoomStore } from './memory-room-store.js';

describe('the in-memory store standing in for Firestore', () => {
  it('remembers a position written before the Room ever was', async () => {
    // Firestore's `set(…, { merge: true })` creates the document, so a Room
    // whose first write is a position must be remembered, not dropped. The
    // double has to do the same or it lies about what a restart keeps.
    const store = createMemoryRoomStore();

    await store.savePosition('t1', 42);

    expect(store.document()?.position).toEqual({ trackId: 't1', seconds: 42 });
  });

  it('leaves the Queue alone when it writes a position', async () => {
    const store = createMemoryRoomStore();

    await store.savePosition('t1', 5);

    expect(store.document()?.queue).toEqual([]);
  });
});
