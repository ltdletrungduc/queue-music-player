import { timingSafeEqual } from 'node:crypto';

export type Role = 'controller' | 'player';

/** The two secrets that guard the Room, kept apart on purpose. */
export type Access = {
  /** Lets someone shape the Queue from their phone. */
  joinCode: string;
  /** Lets a device take the speaker. Never the same gate as the Join Code. */
  playerPassword: string;
};

export type Credentials = {
  role?: unknown;
  joinCode?: unknown;
  playerPassword?: unknown;
};

export type Admission = { ok: true; role: Role } | { ok: false; reason: string };

/** Reads a variable the Room needs to open, saying why when it is missing. */
function required(env: Record<string, string | undefined>, name: string, why: string): string {
  const value = (env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is not set. ${why} See .env.example.`);
  return value;
}

const UNGUARDED =
  'The Room will not open without it: starting anyway would leave it unguarded to ' +
  'anyone who finds the address.';

export function readAccess(env: Record<string, string | undefined>): Access {
  return {
    joinCode: required(env, 'JOIN_CODE', UNGUARDED),
    playerPassword: required(env, 'PLAYER_PASSWORD', UNGUARDED)
  };
}

export type FirebaseConfig = {
  projectId: string;
  /** Absent when talking to the emulator, which asks for none. */
  credentials?: { clientEmail: string; privateKey: string };
  /** Set to develop against the local emulator instead of a real project. */
  emulatorHost?: string;
};

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

/**
 * Compares without letting the time taken say how much of the secret was right.
 * The Room is small and the stakes are low, but there is no reason to hand that
 * away when the correct comparison is this cheap.
 */
function matches(expected: string, offered: unknown): boolean {
  if (typeof offered !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(offered);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function admits(access: Access, credentials: Credentials): Admission {
  if (credentials.role === 'player') {
    return matches(access.playerPassword, credentials.playerPassword)
      ? { ok: true, role: 'player' }
      : { ok: false, reason: 'That password is not right.' };
  }

  if (credentials.role === 'controller') {
    return matches(access.joinCode, credentials.joinCode)
      ? { ok: true, role: 'controller' }
      : { ok: false, reason: 'That code is not right.' };
  }

  return { ok: false, reason: 'Say whether you are a phone or the speaker.' };
}
