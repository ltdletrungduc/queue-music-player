import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fromDocument, toDocument } from './room-document.js';
import type { RoomStore } from './room-store.js';

/**
 * There is exactly one Room, addressed as `main`, so there is exactly one
 * document. Somebody correcting the Room in the Firebase console opens this and
 * nothing else.
 */
const ROOM_DOCUMENT = 'rooms/main';

export type FirebaseConfig = {
  projectId: string;
  /** Absent when talking to the emulator, which asks for none. */
  credentials?: { clientEmail: string; privateKey: string };
  /** Set to develop against the local emulator instead of a real project. */
  emulatorHost?: string;
};

function required(env: Record<string, string | undefined>, name: string, why: string): string {
  const value = (env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is not set. ${why} See .env.example.`);
  return value;
}

/**
 * The Room will not come up without somewhere to remember itself. Starting
 * anyway would mean serving an empty Room and then writing that emptiness over
 * whatever was there, which is worse than not starting.
 */
export function readFirebaseConfig(env: Record<string, string | undefined>): FirebaseConfig {
  const projectId = required(
    env,
    'FIREBASE_PROJECT_ID',
    'The Room is remembered in Firestore, and that names which project holds it.'
  );

  // The emulator wants a project and no credentials, which is how this runs
  // without a Google account.
  const emulatorHost = (env['FIRESTORE_EMULATOR_HOST'] ?? '').trim();
  if (emulatorHost) return { projectId, emulatorHost };

  return {
    projectId,
    credentials: {
      clientEmail: required(
        env,
        'FIREBASE_CLIENT_EMAIL',
        'A service account is how this machine proves it may read the Room.'
      ),
      // Multi-line in the file it came from, one line with \n in it by the time
      // it reaches an environment variable.
      privateKey: required(
        env,
        'FIREBASE_PRIVATE_KEY',
        'A service account is how this machine proves it may read the Room.'
      ).replace(/\\n/g, '\n')
    }
  };
}

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
