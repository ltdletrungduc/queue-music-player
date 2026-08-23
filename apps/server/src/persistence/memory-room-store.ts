import type { RoomState } from '@qmp/shared';
import { fromDocument, toDocument, type RoomDocument } from './room-document.js';
import type { RoomStore } from './room-store.js';

/**
 * A store that remembers nothing past the process, for tests that are about the
 * Room rather than about Firestore. It goes through the same document mapping,
 * so a Room that survives this survives a real restart for the same reasons.
 */
export type MemoryRoomStore = RoomStore & {
  /** What is written down right now, as a real store would hold it. */
  document: () => RoomDocument | undefined;
  /** Fails every write from now on, as an absent connection does. */
  breakWrites: (broken: boolean) => void;
};

export function createMemoryRoomStore(initial?: RoomState): MemoryRoomStore {
  let document = initial ? toDocument(initial) : undefined;
  let broken = false;

  const refuseIfBroken = async () => {
    if (broken) throw new Error('The store cannot be reached.');
  };

  return {
    async load() {
      return fromDocument(document);
    },

    async save(state) {
      await refuseIfBroken();
      document = toDocument(state);
    },

    async savePosition(trackId, positionSeconds) {
      await refuseIfBroken();
      if (document) document.position = { trackId, seconds: positionSeconds };
    },

    async close() {},

    document: () => document,
    breakWrites: (value) => void (broken = value)
  };
}
