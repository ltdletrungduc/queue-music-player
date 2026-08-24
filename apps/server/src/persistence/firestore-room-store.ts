import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fromDocument, toDocument } from './room-document.js';
import type { RoomStore } from './room-store.js';
import type { FirebaseConfig } from '../access.js';

/**
 * There is exactly one Room, addressed as `main`, so there is exactly one
 * document. Somebody correcting the Room in the Firebase console opens this and
 * nothing else.
 */
const ROOM_DOCUMENT = 'rooms/main';

export function openRoomStore(config: FirebaseConfig): RoomStore {
  // The Firestore client decides to skip authentication by reading this itself,
  // and there is no setting that says the same thing. Writing it here rather
  // than leaving it to whatever happens to be in the environment keeps the
  // config the only thing that says where the Room is.
  if (config.emulatorHost) process.env['FIRESTORE_EMULATOR_HOST'] = config.emulatorHost;

  const app = initializeApp({
    projectId: config.projectId,
    ...(config.credentials
      ? { credential: cert({ projectId: config.projectId, ...config.credentials }) }
      : {})
  });
  const document = getFirestore(app).doc(ROOM_DOCUMENT);

  return {
    async load() {
      return fromDocument((await document.get()).data());
    },

    async save(state) {
      // The whole Room, replacing what was there: the Queue is a list, and a
      // list that shrank has to come back shorter rather than merged longer.
      await document.set(toDocument(state));
    },

    async savePosition(trackId, positionSeconds) {
      // Merged, not set, so this touches the one field and leaves the Queue
      // alone — and so it still works on a Room that has never been saved.
      await document.set({ position: { trackId, seconds: positionSeconds } }, { merge: true });
    },

    async close() {
      await deleteApp(app);
    }
  };
}
